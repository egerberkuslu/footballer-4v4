// VAR sahne tarafi: kayit, otomatik tetikleme (yalniz ince pozisyonlar), sahada inceleme akisi,
// tekrar oynatma (top, ag, oyuncular, hakem), kamera devralma ve 3B grafikler.
// Akis (mac): var-start -> hakem monitore yurur (canli, yayin kamerasi) -> monitor + tam ekran tekrar
//   (sim zamani akar; top elde tutulur, canli durum her kare geri konur) -> var-decision -> canli duruma donus, hakem TV isareti (K uygular).
// Antrenmanda hakem yok: dogrudan tam ekran tekrar + karar karti.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { ctl } from '../control/store'
import { game } from '../game/store'
import type { GameEvent, Player, Referee, TeamId } from '../game/types'
import { isGuest } from '../mp/role'
import { BALL_R, GOAL_H, GOAL_W, PITCH_W } from '../pitch'
import type { World } from '../sim'
import { LineGraphics, OffsideGraphics, lineFrame } from './graphics'
import {
  LINE_TOL,
  OFFSIDE_TOL,
  eventVerdict,
  inMouth,
  judgeTrack,
  lineDisplay,
  lineDist,
  offsideDisplay,
  segMaxD,
  type Verdict,
} from './judge'
import { VAR_MONITOR, VAR_SCREEN_Y } from './monitor'
import { REC_HZ, Recorder } from './recorder'
import { bumpVar, requestVar, setAuto, skipVar, startRemoteReview, endRemoteReview, toast, varReq, varState, type VarCase } from './store'
import { VarMonitor, monitorLink } from './VarMonitor'

const SPEED = 0.25
const HW = GOAL_W / 2
const OFFSIDE_BODY = 0.25 // K ile ayni: vucudun en ileri noktasi (kollar haric)

type BodyPt = { x: number; y: number; z: number; name: string }
type CamKind = 'yayin' | 'kus' | 'cizgi' | 'analiz' | 'ofs-yayin' | 'ofs-kus' | 'ofs-yan'
type View = 'full' | 'monitor'
type Step =
  | { type: 'walk'; dur: number }
  | { type: 'intro' | 'outro'; dur: number }
  | { type: 'play'; cam: CamKind; view: View; ta: number; tb: number }
  | { type: 'freeze'; cam: CamKind; view: View; dur: number }
  | { type: 'signal' | 'verdict'; dur: number }

const CAM_NAME: Record<CamKind, string> = {
  yayin: 'Yayın açısı',
  kus: 'Kuş bakışı',
  cizgi: 'Gol çizgisi kamerası',
  analiz: 'Sanal çizgi analizi',
  'ofs-yayin': 'Yayın açısı · pas anı',
  'ofs-kus': 'Kuş bakışı · ofsayt çizgisi',
  'ofs-yan': 'Yan açı · ofsayt çizgisi',
}

type Actor = Pick<Player, 'x' | 'z' | 'vx' | 'vz' | 'facing' | 'anim' | 'animT' | 'hasBall'>
const copyActor = (p: Actor): Actor => ({ x: p.x, z: p.z, vx: p.vx, vz: p.vz, facing: p.facing, anim: p.anim, animT: p.animT, hasBall: p.hasBall })

type Snapshot = {
  held: boolean
  live: boolean
  ball: World['ball']
  pos: Float32Array
  prev: Float32Array
  vel: Float32Array
  players: Actor[]
}

type Review = {
  c: VarCase
  mac: boolean // hakemli akis
  remote: boolean // misafir: karar host'tan
  ka: number
  kb: number
  kc: number // kritik kare (tam sayi: aralik basi)
  kcf: number // kritik an (kesirli kare, alt-kare cozum)
  tc: number
  plan: Step[]
  i: number
  t: number
  tp: number
  live: Snapshot | null // tekrar basinda alinan canli durum (geri yukleme)
  liveRef: Referee | null // tekrar sirasinda K'nin yazdigi canli hakem
  overrode: boolean
  fBall: number | null // top + agin tekrar karesi (-0,4'te yazilir: Ball/Goal 0'da okur)
  cam0: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; target: THREE.Vector3; enabled: boolean }
  look: THREE.Vector3
  // ofsayt cizgileri (kritik karede)
  ofs?: { defX: number; attX: number; rz: number; defPt?: BodyPt; attPt?: BodyPt }
  ana?: { side: number; ang: number; lift: number }
}

// ofsayt zinciri: bir takimin hucumu boyunca paslar; rakip dokununca biter
type Batch = { t: number; passer: number; margins: Map<number, number>; involved: number | null; rpos: Map<number, { x: number; z: number }> }

export function VarScene({ world }: { world: World }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const rec = useMemo(() => new Recorder(world), [world])
  const review = useRef<Review | null>(null)
  const ex = useRef({ active: false, blocked: false, maxD: -Infinity, startK: 0, still: 0 })
  const chain = useRef<{ team: TeamId; batches: Batch[] } | null>(null)
  // gfx: 0 gizli, 1 grafik, 2 grafik + etiket
  const [shown, setShown] = useState<{ c: VarCase; gfx: number; ofs?: Review['ofs'] } | null>(null)
  const goalChain = useRef<{ ch: { team: TeamId; batches: Batch[] }; t: number } | null>(null)
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Vector3() }), [])

  // --- oyun olaylari: ofsayt zinciri ---
  useEffect(
    () =>
      game.on((e: GameEvent) => {
        if (e.type === 'offside-check') {
          const p = game.players[e.passer]
          const r = game.players[e.receiver]
          if (!p || !r) return
          let ch = chain.current
          if (!ch || ch.team !== p.team) ch = chain.current = { team: p.team, batches: [] }
          let b = ch.batches[ch.batches.length - 1]
          if (!b || b.passer !== e.passer || Math.abs(b.t - world.time) > 1e-6) {
            b = { t: world.time, passer: e.passer, margins: new Map(), involved: null, rpos: new Map() }
            ch.batches.push(b)
            if (ch.batches.length > 8) ch.batches.shift()
          }
          b.margins.set(e.receiver, e.margin)
          b.rpos.set(e.receiver, { x: r.x, z: r.z })
        } else if (e.type === 'touch') {
          const ch = chain.current
          const p = game.players[e.player]
          if (!ch || !p) return
          if (p.team !== ch.team) {
            chain.current = null
            return
          }
          const b = ch.batches[ch.batches.length - 1]
          if (b && b.involved === null && e.player !== b.passer && b.margins.has(e.player)) b.involved = e.player
        } else if (e.type === 'goal') {
          const ch = chain.current
          chain.current = null
          goalChain.current = ch && ch.team === e.team ? { ch, t: world.time } : null
          if (!ch || ch.team !== e.team || isGuest() || varState.auto === 'kapali' || review.current) return
          const c = offsideCase(ch, OFFSIDE_TOL, 'offside')
          if (c) begin(c)
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world],
  )

  // ince ofsayt: zincirdeki en son, mudahil alicili ve |margin| <= tol pas
  function offsideCase(ch: { team: TeamId; batches: Batch[] }, tol: number, reason: 'offside' | 'manual'): VarCase | null {
    for (let i = ch.batches.length - 1; i >= 0; i--) {
      const b = ch.batches[i]
      if (b.involved === null || world.time - b.t > 15) continue
      const m = b.margins.get(b.involved)!
      if (Math.abs(m) > tol) return null // en son mudahil pas net: inceleme yok
      if (b.t < rec.time(0)) return null // kayit disinda kaldi
      const rp = b.rpos.get(b.involved)!
      return { kind: 'offside', reason, team: ch.team, dir: game.match.attackDir[ch.team], passer: b.passer, receiver: b.involved, margin: m, rx: rp.x, rz: rp.z }
    }
    return null
  }

  // test/ayiklama erisimi
  useEffect(() => {
    varState.recBytes = rec.bytes()
    Object.assign(window, {
      __var: {
        state: varState,
        rec,
        trigger: requestVar,
        skip: skipVar,
        setAuto,
        startRemoteReview,
        endRemoteReview,
        debug: () => ({ chain: chain.current, goal: goalChain.current, ex: { ...ex.current } }),
        judgeAt: (x: number, y: number, z: number, side: 1 | -1 = attackSide()) =>
          judgeTrack({ get: (_k, o) => Object.assign(o, { x, y, z }) }, 0, 0, side),
        place: (x: number, y: number, z: number) => {
          const b = world.ball
          b.x = b.px = x
          b.y = b.py = y
          b.z = b.pz = z
          b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0
        },
      },
    })
  }, [rec, world])

  // son dokunan takimin hucum yonu (macta); antrenmanda sutcu = hucum edilen kale
  const attackSide = (): 1 | -1 => {
    const lt = game.match.lastTouch
    return ctl.mode === 'mac' && lt ? game.match.attackDir[lt.team] : world.side
  }

  // --- inceleme kurma ---
  function nearestFrame(score: (k: number) => number) {
    let best = Infinity
    let bk = rec.count - 1
    for (let k = 0; k < rec.count; k++) {
      const s = score(k)
      if (s < best) {
        best = s
        bk = k
      }
    }
    return bk
  }

  function begin(c: VarCase, remote = false, lineWin?: [number, number]) {
    if (review.current || rec.count < 2) return
    const mac = ctl.mode === 'mac'
    const kb = rec.count - 1
    let kc: number
    let kcf: number
    const p = { x: 0, y: 0, z: 0 }
    if (c.kind === 'line') {
      if (remote) kc = nearestFrame((k) => (rec.get(k, p), Math.hypot(p.x - c.v.x, p.y - c.v.y, p.z - c.v.z)))
      else kc = c.v.frame
      kcf = remote ? kc : c.v.fr
    } else {
      const a = { x: 0, z: 0 }
      kc = nearestFrame((k) => (rec.actor(k, c.receiver, a), Math.hypot(a.x - c.rx, a.z - c.rz)))
      kcf = kc
    }
    const seg = rec.segStart(kc)
    const ka = Math.max(seg, lineWin ? Math.min(lineWin[0], kc) - REC_HZ : 0)
    const tc = rec.timeAtF(kcf)
    const tA = rec.time(ka)
    const tB = rec.time(kb)
    const cl = (t: number) => Math.max(tA, Math.min(tB, t))
    const view: View = mac ? 'monitor' : 'full'
    let plan: Step[]
    let ofs: Review['ofs']
    if (c.kind === 'line') {
      plan = [
        mac ? { type: 'walk', dur: 14 } : { type: 'intro', dur: 0.8 },
        // sure butcesi (walk haric): monitor ~2 s, tam ekran tekrar 3 s, donmus analiz 3 s (SPEED 0,25)
        { type: 'play', cam: 'yayin', view, ta: cl(tc - 0.45), tb: cl(tc + 0.05) },
        { type: 'play', cam: 'cizgi', view: 'full', ta: cl(tc - 0.7), tb: tc },
        { type: 'freeze', cam: 'analiz', view: 'full', dur: 3 },
      ]
    } else {
      // pas anindaki cizgiler: kayitli gercek vucut noktalarindan (K2'nin bodyExtent formulu, kollar yok)
      const d = c.dir
      const a = { x: 0, z: 0 }
      type Ext = { v: number; name?: string; x: number; y: number; z: number }
      const opp: Ext[] = []
      game.players.forEach((q, i) => {
        if (q.team === c.team || q.sentOff) return
        const bb = rec.bodyBest(kc, i, d)
        if (bb) opp.push(bb)
        else {
          rec.actor(kc, i, a)
          opp.push({ v: d * a.x + OFFSIDE_BODY, x: a.x, y: 0.9, z: a.z })
        }
      })
      opp.sort((u, v) => v.v - u.v)
      rec.get(kc, p)
      const ballV = d * p.x + BALL_R
      const second = opp.length >= 2 ? opp[1] : null
      const line = Math.max(second ? second.v : -1e9, ballV)
      const defPt = second && second.v >= ballV ? second : { v: ballV, name: 'top', x: p.x, y: p.y, z: p.z }
      rec.actor(kc, c.receiver, a)
      const rb = rec.bodyBest(kc, c.receiver, d)
      // cizgiler K2'nin margin'iyle bire bir: hucum cizgisi = savunma cizgisi + margin
      ofs = {
        defX: d * line,
        attX: d * (line + c.margin),
        rz: a.z,
        defPt: { x: defPt.x, y: defPt.y, z: defPt.z, name: defPt.name ?? 'vücut' },
        attPt: rb ? { x: rb.x, y: rb.y, z: rb.z, name: rb.name } : undefined,
      }
      plan = [
        mac ? { type: 'walk', dur: 14 } : { type: 'intro', dur: 0.8 },
        { type: 'play', cam: 'ofs-yayin', view, ta: cl(tc - 0.5), tb: tc },
        { type: 'freeze', cam: 'ofs-kus', view: 'full', dur: 3 },
        { type: 'freeze', cam: 'ofs-yan', view: 'full', dur: 3 },
      ]
    }
    if (mac) plan.push({ type: 'signal', dur: 2.6 })
    else plan.push({ type: 'verdict', dur: 3.4 })
    plan.push({ type: 'outro', dur: 0.45 })

    const plays = plan.filter((s): s is Extract<Step, { type: 'play' }> => s.type === 'play')
    const disp = c.kind === 'line' ? lineDisplay(c.v) : offsideDisplay(c.margin, game.players[c.receiver]?.name ?? 'Hücumcu')
    review.current = {
      c,
      mac,
      remote,
      ka,
      kb,
      kc,
      kcf,
      tc,
      plan,
      i: 0,
      t: 0,
      tp: plays[0]?.ta ?? tc,
      live: null,
      liveRef: null,
      overrode: false,
      fBall: null,
      cam0: {
        pos: camera.position.clone(),
        quat: camera.quaternion.clone(),
        fov: camera.fov,
        target: controls ? controls.target.clone() : new THREE.Vector3(),
        enabled: controls ? controls.enabled : true,
      },
      look: new THREE.Vector3(),
      ofs,
    }
    Object.assign(varState, {
      active: true,
      phase: mac ? 'walk' : 'intro',
      reason:
        c.kind === 'offside'
          ? 'Ofsayt kontrolü'
          : c.reason === 'manual'
            ? 'Manuel inceleme · çizgi'
            : 'Gol çizgisi kontrolü',
      cam: '',
      speed: SPEED,
      verdict: c.kind === 'line' ? c.v : null,
      case: c,
      display: disp,
      t0: Math.min(...plays.map((s) => s.ta), tc),
      t1: Math.max(...plays.map((s) => s.tb), tc),
      tc,
      tNow: plays[0]?.ta ?? tc,
    })
    ex.current.active = false
    ex.current.blocked = true
    setShown({ c, gfx: 0, ofs })
    if (mac && !remote) game.emit({ type: 'var-start', reason: c.reason })
    bumpVar()
  }

  /** tekrar basinda canli durumu sakla; top elde tutulur (fizik adimlamaz, olay uretmez), zaman akar */
  function freezeLive(r: Review) {
    if (r.live) return
    const b = world.ball
    const w = world as unknown as { prev: Float32Array; vel: Float32Array; held: boolean; live: boolean }
    r.live = {
      held: w.held,
      live: w.live,
      ball: { ...b, q: { ...b.q } },
      pos: world.pos.slice(),
      prev: w.prev.slice(),
      vel: w.vel.slice(),
      players: game.players.map(copyActor),
    }
    world.holdBall(true)
  }

  /** canli oyuncu/hakem, top ve agi geri koy (tekrar yazimindan sonra) */
  function restoreLive(r: Review) {
    if (!r.overrode || !r.live) return
    r.live.players.forEach((s, i) => Object.assign(game.players[i], s))
    if (r.liveRef) Object.assign(game.referee, r.liveRef)
    putBall(r.live)
    r.overrode = false
  }

  function putBall(s: Snapshot) {
    const b = world.ball
    const { q, ...rest } = s.ball
    Object.assign(b, rest)
    b.q.x = q.x
    b.q.y = q.y
    b.q.z = q.z
    b.q.w = q.w
    world.pos.set(s.pos)
    const w = world as unknown as { prev: Float32Array; vel: Float32Array }
    w.prev.set(s.prev)
    w.vel.set(s.vel)
  }

  /** canli duruma don (top, ag, oyuncular) */
  function thaw(r: Review) {
    const s = r.live
    if (!s) return
    restoreLive(r)
    putBall(s)
    const w = world as unknown as { held: boolean; live: boolean }
    w.held = s.held
    w.live = s.live
    r.live = null
    if (monitorLink.live) monitorLink.hold = true
    monitorLink.live = false
  }

  function finish() {
    const r = review.current
    if (!r) return
    thaw(r)
    camera.position.copy(r.cam0.pos)
    camera.quaternion.copy(r.cam0.quat)
    camera.fov = r.cam0.fov
    camera.updateProjectionMatrix()
    if (controls) {
      controls.target.copy(r.cam0.target)
      controls.enabled = r.cam0.enabled
      controls.update()
    }
    monitorLink.live = monitorLink.hold = false
    review.current = null
    Object.assign(varState, { active: false, phase: 'off', cam: '' })
    setShown(null)
    bumpVar()
  }

  function decide(r: Review) {
    if (!r.mac || r.remote) return
    const c = r.c
    if (c.kind === 'line') game.emit({ type: 'var-decision', reason: c.reason, verdict: eventVerdict(c.v.kind), marginCm: c.v.cm })
    else game.emit({ type: 'var-decision', reason: c.reason, verdict: c.margin > 0 ? 'ofsayt' : 'gol', marginCm: c.margin * 100 })
  }

  // --- kameralar ---
  const M = VAR_MONITOR
  const mn = new THREE.Vector3(Math.sin(M.facing), 0, Math.cos(M.facing)) // ekran normali
  const ms = new THREE.Vector3(Math.cos(M.facing), 0, -Math.sin(M.facing)) // ekranin sagi

  // analiz kamerasi icin oyuncularin kapatmadigi aci: (yan, aci, yukseklik) adaylari, xz'de bakis dogrusu testi
  function clearAnalysis(v: Verdict) {
    const f = lineFrame(v)
    const sa = Math.sign(f.along) || 1
    const tg = { x: v.x - f.n.x * f.d * 0.5, z: v.z - f.n.z * f.d * 0.5 }
    let best = { side: sa, ang: 0.55, lift: 0, score: -1 }
    for (const side of [sa, -sa])
      for (const ang of [0.55, 0.95, 0.2, 1.3])
        for (const lift of [0, 1.2]) {
          const dist = 2.4 + Math.abs(f.d) * 1.3 + lift * 0.8
          const dx = -f.n.x * Math.cos(ang) - f.u.x * side * Math.sin(ang)
          const dz = -f.n.z * Math.cos(ang) - f.u.z * side * Math.sin(ang)
          const cx = tg.x + dx * dist
          const cz = tg.z + dz * dist
          // en yakin oyuncunun bakis dogrusuna uzakligi (hakem dahil)
          let clear = Infinity
          for (const q of [...game.players, game.referee]) {
            if ((q as Player).sentOff) continue
            const ux = tg.x - cx
            const uz = tg.z - cz
            const L2 = ux * ux + uz * uz || 1
            const t = Math.max(0, Math.min(1, ((q.x - cx) * ux + (q.z - cz) * uz) / L2))
            clear = Math.min(clear, Math.hypot(cx + ux * t - q.x, cz + uz * t - q.z))
          }
          const score = Math.min(clear, 1.2) - lift * 0.15 - Math.abs(ang - 0.55) * 0.1
          if (score > best.score) best = { side, ang, lift, score }
        }
    return best
  }

  function linePose(kind: CamKind, v: Verdict, k: number, pos: THREE.Vector3, tgt: THREE.Vector3, opt?: Review['ana']): number {
    const f = lineFrame(v)
    const b = world.ball
    const sa = Math.sign(f.along) || 1
    switch (kind) {
      case 'yayin':
        pos.copy(f.P).addScaledVector(f.n, -10.5).addScaledVector(f.u, -sa * 6.5)
        pos.y = 6.2
        tgt.set(b.x, b.y, b.z)
        return 34
      case 'kus':
        pos.copy(f.P).addScaledVector(f.n, -0.9)
        pos.y = 9.5
        tgt.copy(f.P).addScaledVector(f.n, 0.05)
        tgt.y = 0
        return 30
      case 'cizgi':
        // cizgi duzleminde; agizdaysa direk/ust direk kapatmasin diye agzin icinden bakar
        pos.copy(f.P)
        if (f.g && inMouth(v.y, v.z)) {
          const a = -sa * (HW - 0.32)
          pos.z = Math.abs(a - v.z) < 1.2 ? sa * (HW - 0.32) : a
          pos.y = Math.min(GOAL_H - 0.35, Math.max(0.35, v.y + 0.45))
        } else {
          const far = f.g ? Math.max(Math.abs(f.along) + 6, HW + 5) : Math.abs(f.along) + 6
          if (f.g) pos.z = sa * far
          else pos.x = f.along + (f.along >= 0 ? 6 : -6)
          pos.y = Math.max(0.9, v.y + 0.55)
        }
        tgt.set(v.x, v.y, v.z).addScaledVector(f.n, -f.d)
        tgt.y = v.y
        return f.g && inMouth(v.y, v.z) ? 48 : 30
      default: {
        // analiz: saha tarafindan capraz, yavas yorunge; bosluk buyudukce geri cekil
        const o = opt ?? { side: sa, ang: 0.55, lift: 0 }
        const ang = o.ang + (0.5 - k) * 0.22 * o.side * sa
        const dir = tmp.d.copy(f.n).multiplyScalar(-Math.cos(ang)).addScaledVector(f.u, -o.side * Math.sin(ang))
        pos.set(v.x, 0, v.z).addScaledVector(f.n, -f.d * 0.5).addScaledVector(dir, 2.4 + Math.abs(f.d) * 1.3 + o.lift * 0.8)
        pos.y = Math.max(0.9, v.y + 0.8 + Math.abs(f.d) * 0.4 + o.lift)
        tgt.set(v.x, v.y, v.z).addScaledVector(f.n, -f.d * 0.5)
        return 40
      }
    }
  }

  function offsidePose(kind: CamKind, r: Review, k: number, pos: THREE.Vector3, tgt: THREE.Vector3): number {
    const o = r.ofs!
    const c = r.c as Extract<VarCase, { kind: 'offside' }>
    const mid = (o.defX + o.attX) / 2
    switch (kind) {
      case 'ofs-yayin': {
        const b = world.ball
        pos.set(b.x - c.dir * 7, 10, Math.min(PITCH_W / 2 + 9, b.z + 17))
        tgt.set(b.x + c.dir * 3, 0.5, b.z * 0.6)
        return 42
      }
      case 'ofs-kus':
        // ustten, cizgilere dik; hafif egik (ust vektor dejenere olmasin)
        pos.set(mid - c.dir * 1.5, 15 - k * 2, o.rz + 0.01)
        tgt.set(mid, 0, o.rz)
        return 34
      default: {
        // yan: taç cizgisinde, ofsayt cizgisi hizasinda; cizgi ekranda dik durur
        const sz = o.rz >= 0 ? 1 : -1
        pos.set(o.attX - c.dir * (0.3 + k * 0.4), 4.2, sz * (PITCH_W / 2 + 5))
        tgt.set(o.attX, 0.7, o.rz)
        return 36
      }
    }
  }

  function replayPose(kind: CamKind, r: Review, k: number, pos: THREE.Vector3, tgt: THREE.Vector3) {
    if (r.c.kind === 'line' && kind === 'analiz' && !r.ana) r.ana = clearAnalysis(r.c.v) // kritik karede oyuncular yazili
    return r.c.kind === 'line' ? linePose(kind, r.c.v, k, pos, tgt, r.ana) : offsidePose(kind, r, k, pos, tgt)
  }

  function applyCam(cam: THREE.PerspectiveCamera, pos: THREE.Vector3, tgt: THREE.Vector3, fov: number, k = 1) {
    if (k >= 1) cam.position.copy(pos)
    else cam.position.lerp(pos, k)
    if (cam.fov !== fov) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }
    cam.lookAt(tgt)
  }

  // erken: tekrar karesi bir onceki karede oyunculara/hakeme yazildiysa canli degerleri geri koy
  // (K ve F canli durum uzerinden calissin)
  useFrame(() => {
    const r = review.current
    if (!r) return
    restoreLive(r)
    // F/K bu arada topa dokunup serbest birakmis olabilir: tekrar suresince top elde
    if (r.live) (world as unknown as { held: boolean }).held = true
  }, -100)

  // top + ag: canli durum -100'de geri konuyor; Ball/Goal 0'da okuduklari icin tekrar karesi 0'dan once yazilir
  useFrame(() => {
    const r = review.current
    if (r && r.live && r.fBall !== null) {
      rec.apply(world, r.fBall)
      r.overrode = true
    }
  }, -0.4)

  useFrame((_, rawDt) => {
    const r = review.current
    if (!r) {
      // --- canli: kayit + otomatik algilama ---
      const t0 = performance.now()
      const took = rec.sample(world)
      if (took) {
        varState.recMs = varState.recMs * 0.95 + (performance.now() - t0) * 0.05
        if (!isGuest()) autoDetect()
      }
      if (varReq.remote) {
        const c = varReq.remote
        varReq.remote = null
        begin(c, true)
      } else if (varReq.manual) {
        varReq.manual = false
        if (!isGuest()) manual()
      }
      varReq.skip = varReq.remoteEnd = false
      return
    }
    const dt = Math.min(rawDt, 0.1) * varState.warp

    if (varReq.remoteEnd) {
      varReq.remoteEnd = false
      finish()
      return
    }
    if (varReq.skip) {
      varReq.skip = false
      if (!r.remote) {
        const vi = r.plan.findIndex((s) => s.type === 'signal' || s.type === 'verdict')
        if (r.i < vi) {
          r.i = vi
          r.t = 0
          const st = r.plan[vi]
          if (st.type === 'verdict') st.dur = 1.6
        } else {
          finish()
          return
        }
      }
    }

    const step = r.plan[r.i]
    r.t += dt
    r.fBall = null
    let done = false
    let phase = varState.phase
    let camName = varState.cam
    let gfx = 0
    const ref = game.referee
    const P = tmp.p
    const T = tmp.t

    if (step.type === 'walk') {
      phase = 'walk'
      camName = 'Yayın · hakem monitöre gidiyor'
      // hakemi izleyen yayin kamerasi (canli)
      const st = { x: M.x + mn.x * 0.9, z: M.z + mn.z * 0.9 }
      P.set(ref.x + 3, 6.5, ref.z + 11.5)
      T.set(ref.x, 1.0, ref.z - 1)
      applyCam(camera, P, T, 38, r.t <= dt ? 0.25 : 1 - Math.exp(-dt * 3))
      const at = Math.hypot(ref.x - st.x, ref.z - st.z) < 1.3
      done = (at && ref.anim === 'var-monitor') || r.t >= step.dur
    } else if (step.type === 'intro' || step.type === 'outro') {
      phase = step.type
      done = r.t >= step.dur
    } else if (step.type === 'play' || step.type === 'freeze') {
      freezeLive(r)
      phase = step.view === 'monitor' ? 'monitor' : step.type
      camName = step.view === 'monitor' ? 'Hakem monitörü' : CAM_NAME[step.cam]
      let f: number
      if (step.type === 'play') {
        if (r.t <= dt) r.tp = step.ta
        r.tp = Math.min(step.tb, r.tp + dt * SPEED)
        f = rec.frameAt(r.tp, r.ka, r.kb)
        varState.tNow = r.tp
        done = r.tp >= step.tb - 1e-6
      } else {
        f = r.kcf
        varState.tNow = r.tc
        done = r.t >= step.dur
      }
      gfx = step.type === 'freeze' && step.view === 'full' ? 2 : r.c.kind === 'line' && step.type === 'play' && step.cam === 'yayin' ? 0 : 1
      // canli hakemi sakla (K bu karede yazdi), tekrar karesini yaz
      r.liveRef = { ...ref }
      rec.apply(world, f)
      r.fBall = f
      // canli hakem ASLA ezilmez: K2 onu monitorun basinda tutar (kayitli hakem konumu gosterilmez)
      rec.applyActors(f, false)
      r.overrode = true
      const k = step.type === 'freeze' ? r.t / step.dur : 0
      const fov = replayPose(step.cam, r, k, P, T)
      if (step.view === 'full') {
        monitorLink.live = false
        applyCam(camera, P, T, fov)
      } else {
        // monitor: tekrar ekrana, kullaniciya hakemin omzu ustunden ekran
        monitorLink.live = true
        applyCam(monitorLink.cam, P, T, fov)
        tmp.q.set(M.x, VAR_SCREEN_Y, M.z).addScaledVector(mn, 2.05).addScaledVector(ms, -0.6)
        tmp.q.y = 1.78
        P.copy(tmp.q)
        T.set(M.x, VAR_SCREEN_Y - 0.03, M.z)
        applyCam(camera, P, T, 36)
      }
    } else if (step.type === 'signal') {
      // karar: canliya don, K hakemi isaret yaptirir ve uygular
      phase = 'signal'
      camName = 'Yayın · hakemin kararı'
      if (r.t <= dt) {
        thaw(r)
        decide(r)
      }
      const st = tmp.d.set(M.x, 0, M.z).addScaledVector(mn, 0.9)
      P.copy(st).addScaledVector(mn, 4.2).addScaledVector(ms, -1.2)
      P.y = 1.6
      T.set(ref.x, 1.35, ref.z)
      applyCam(camera, P, T, 34, r.t <= dt ? 1 : 1 - Math.exp(-dt * 4))
      done = r.t >= step.dur
    } else {
      phase = 'verdict'
      gfx = 1
      rec.apply(world, r.kcf)
      r.fBall = r.kcf
      done = r.t >= step.dur
      const fov = replayPose(r.c.kind === 'line' ? 'analiz' : 'ofs-yan', r, 1 + r.t * 0.08, P, T)
      applyCam(camera, P, T, fov)
    }
    if (controls) {
      controls.enabled = false
      controls.target.copy(T)
    }

    if (shown && shown.gfx !== gfx) setShown({ ...shown, gfx })
    if (phase !== varState.phase || camName !== varState.cam) {
      varState.phase = phase
      varState.cam = camName
      bumpVar()
    }
    if (done) {
      r.i++
      r.t = 0
      if (r.i >= r.plan.length) finish()
    }
  }, 0)

  // --- elle tetikleme ---
  function manual() {
    const mac = ctl.mode === 'mac'
    // macta ofsayt elle yalniz son golden hemen sonra (golu getiren hucum zinciri)
    const gc = goalChain.current
    if (mac && gc && world.time - gc.t < 12) {
      const c = offsideCase(gc.ch, 1e9, 'manual')
      if (c) return begin(c)
    }
    const kb = rec.count - 1
    if (kb < 1) return
    const a = Math.max(rec.segStart(kb), kb - 4 * REC_HZ)
    const v = judgeTrack(rec, a, kb, attackSide())
    if (mac && v.kind === 'oyunda') {
      toast('İncelenecek pozisyon yok')
      return
    }
    begin({ kind: 'line', reason: 'manual', v }, false, [a, kb])
  }

  // --- otomatik cizgi algilama: yalniz kale agzi (direkler arasi, ust diregin alti) ---
  // Bir "yaklasma" boyunca topun tamamen gecme payinin en buyugu m = maxD - R izlenir.
  // |m| <= LINE_TOL ile biten yaklasma incelenir; m > LINE_TOL (rahat gol) hic incelenmez.
  function autoDetect() {
    const e = ex.current
    const last = rec.count - 1
    const cut = rec.cut[rec.idx(last)] === 1
    if (cut) {
      // top yeniden yerlestirildi: acik yaklasmayi isinlanma oncesine kadar degerlendir
      if (e.active) endExcursion(last - 1)
      e.active = e.blocked = false
      return
    }
    const b = world.ball
    const l = b.x >= 0 ? 'kale+' : 'kale-'
    const dS = lineDist(l, b.x)
    // kareler arasi alt-kare cozum: hizli sutta iki ornek arasindaki en buyuk pay
    const dM = last >= 1 && !rec.gap(last - 1) ? Math.max(dS, segMaxD(rec, l, last - 1).d) : dS
    const d = dM
    if (e.blocked) {
      if (d < -BALL_R - 0.6) e.blocked = false
      return
    }
    if (varState.auto === 'kapali') return
    if (ctl.mode !== 'mac' && !ctl.inFlight) return
    const zone = Math.abs(b.z) < HW && b.y < GOAL_H && d > -BALL_R - 0.4
    if (!e.active) {
      if (zone) Object.assign(e, { active: true, maxD: d, startK: last, still: 0 })
      return
    }
    e.maxD = Math.max(e.maxD, d)
    if (e.maxD - BALL_R > LINE_TOL) {
      // rahat gol: inceleme yok
      e.active = false
      e.blocked = true
      return
    }
    const sp = Math.hypot(b.vx, b.vy, b.vz)
    e.still = sp < 0.2 ? e.still + 1 / REC_HZ : 0
    if (dS < e.maxD - 0.3 || !zone || e.still > 0.4) endExcursion(last)
  }

  function endExcursion(end: number) {
    const e = ex.current
    e.active = false
    e.blocked = true
    if (Math.abs(e.maxD - BALL_R) > LINE_TOL || end < 1) return
    const ka = Math.max(rec.segStart(end), e.startK - 10)
    const v = judgeTrack(rec, ka, end, attackSide())
    begin({ kind: 'line', reason: 'line', v }, false, [ka, end])
  }

  return (
    <>
      <VarMonitor />
      {shown && shown.gfx > 0 && shown.c.kind === 'line' && <LineGraphics v={shown.c.v} label={shown.gfx > 1} />}
      {shown && shown.gfx > 0 && shown.c.kind === 'offside' && shown.ofs && (
        <OffsideGraphics
          defX={shown.ofs.defX}
          attX={shown.ofs.attX}
          rz={shown.ofs.rz}
          defPt={shown.ofs.defPt}
          attPt={shown.ofs.attPt}
          off={shown.c.margin > 0}
          cm={shown.c.margin * 100}
          label={shown.gfx > 1}
        />
      )}
    </>
  )
}
