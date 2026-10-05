// Katman: kaleci (keeper-dive*, keeper-collect / catch / catch-high, dalis sonrasi 'getup'). SAHIBI: kaleci ajani.
// Kaynak: GameplayFootball el-anahtarli kaleci animasyonlari (google-research/football third_party/gfootball_engine,
// Unlicense) -> anim_src/bake_keeper.py -> public/anim_keeper.json. Yuklenmezse ya da ?clips=0 ise parametrik sistem aynen kalir.
// Dalis: fazi Characters.tsx'in diveState eslemesinden gelen ctx.animT (DIVE_KEYS anahtarlari) surer; klip anahtar kareleri
// [0, itis sonu, temas, inis, son] bu anahtarlara oturtulur. Govde/bacak/bas klipten, eller simulasyonun el hedefine (ctx.ball, dive)
// kol IK'si ile; pelvis yuksekligi simulasyonun parabolunden (klibin yatis yuksekliginden asagi inmez).
import * as THREE from 'three'
import { asset } from '../../assetUrl'
import type { RigDriver } from '../rig'
import { diveOf } from '../../sim/keeperDive'
import { layerState, type Layer, type LayerCtx } from './types'
import { layerStatus, loadJson, qa, qb, smooth } from './util'

interface ClipJ {
  fps: number
  n: number
  contact: number
  takeoff: number
  land: number
  q: number[][] // kare -> kemik*4 (x,y,z,w): model uzayinda dinlenmeden sapma
  pel: number[][] // pelvis sapmasi (m, model uzayi)
}
interface BankJ {
  bones: string[]
  clips: Record<string, ClipJ>
}

let bank: BankJ | null = null
const status = layerStatus('keeper')
const off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('clips') === '0'
if (!off) {
  void loadJson<BankJ>(asset('anim_keeper.json')).then((b) => {
    bank = b
    status.loaded = !!b
  })
  // elle atis (Quaternius UAL2 OverhandThrow, CC0): ayni kemik listesiyse kullanilir
  void loadJson<BankJ>(asset('anim_keeper_throw.json')).then((t) => {
    throwBank = t
  })
}
let throwBank: BankJ | null = null
const THROW_CONTACT = 0.35 // locomotionApi KEEPER_THROW_CONTACT

// Characters.tsx DIVE_KEYS ile ayni: [itis sonu, temas, inis, kayma sonu] (klip zamani)
const DK: Record<string, [number, number, number, number]> = {
  '': [0.14, 0.4, 0.75, 1.0],
  '-low': [0.12, 0.4, 0.65, 1.0],
  '-high': [0.15, 0.4, 0.62, 1.2],
}
const DIVE_RE = /^keeper-dive(-low|-high)?-([lr])$/
// tutma klipleri: oyun animasyonu yakalama aninda baslar (top elde) -> klip temasindan biraz once baslatilir
const CATCH_CLIP: Record<string, string> = { 'keeper-collect': 'collect', 'keeper-catch': 'catch', 'keeper-catch-high': 'catch-high' }
const CATCH_LEAD = 0.06 // s: temastan once
const XFADE = 0.18 // klipler arasi gecis (s)
const EXIT = 0.3 // katmandan cikis (parametrik poza donus) suresi

class KState {
  key = '' // su an oynayan klip anahtari (ad + yon)
  t = 0 // bu klipte gecen sure (gdt)
  cur: Float32Array | null = null // son uygulanan kemik deltalari
  from: Float32Array | null = null // gecis baslangici
  pelCur = new THREE.Vector3()
  pelFrom = new THREE.Vector3()
  hasFrom = false
  fadeIn = 1 // parametrikten giriste agirlik rampasi icin (1 = tam)
  exitT = 9 // katmandan cikistan beri
  lastDiveSide: 'l' | 'r' | null = null
  lastDiveT = 99 // son dalistan beri (s)
  diveClip = 'dive-low'
  catchClip = 'collect'
  downT = 0 // dalis klibi sonunda yerde gecen sure
}

const v = new THREE.Vector3()
const v2 = new THREE.Vector3()
const tgt = new THREE.Vector3()
const yawQ = new THREE.Quaternion()
const Y = new THREE.Vector3(0, 1, 0)
const qd = new THREE.Quaternion()

/** klibin f karesini (kesirli) buf'a ornekle */
function sampleInto(c: ClipJ, f: number, buf: Float32Array, pel: THREE.Vector3) {
  const ff = Math.min(c.n - 1, Math.max(0, f))
  const i = Math.min(c.n - 2, Math.floor(ff))
  const a = ff - i
  const q0 = c.q[i]
  const q1 = c.q[i + 1]
  for (let k = 0; k < buf.length; k += 4) {
    qa.set(q0[k], q0[k + 1], q0[k + 2], q0[k + 3])
    qb.set(q1[k], q1[k + 1], q1[k + 2], q1[k + 3])
    qa.slerp(qb, a)
    buf[k] = qa.x
    buf[k + 1] = qa.y
    buf[k + 2] = qa.z
    buf[k + 3] = qa.w
  }
  const p0 = c.pel[i]
  const p1 = c.pel[i + 1]
  pel.set(p0[0] + (p1[0] - p0[0]) * a, p0[1] + (p1[1] - p0[1]) * a, p0[2] + (p1[2] - p0[2]) * a)
}

const tmpBuf = new Map<number, Float32Array>()
function scratch(n: number) {
  let b = tmpBuf.get(n)
  if (!b) tmpBuf.set(n, (b = new Float32Array(n)))
  return b
}

/** buf'taki deltalari (istenirse dikey eksende yaw ile dondurulmus) kemiklere yaz */
const ARM_RE = /^(clavicle|upperarm|lowerarm|hand)_/
/** armW: kol kemikleri icin ayri agirlik carpani (ornegin atista top elde tutulurken kollar parametrik kalir) */
function applyBuf(rig: RigDriver, bones: string[], buf: Float32Array, w: number, yaw: number, armW = 1) {
  if (yaw !== 0) yawQ.setFromAxisAngle(Y, yaw)
  for (let bi = 0; bi < bones.length; bi++) {
    const k = bi * 4
    qd.set(buf[k], buf[k + 1], buf[k + 2], buf[k + 3])
    if (yaw !== 0) qd.premultiply(yawQ)
    rig.blendBone(bones[bi], qd, armW < 1 && ARM_RE.test(bones[bi]) ? w * armW : w)
  }
}

/** yeni klibe geciste onceki uygulanan pozu kaynak olarak sakla */
function enter(st: KState, key: string, nq: number) {
  if (st.key === key) return
  if (st.cur && st.cur.length === nq && (st.key !== '' || st.exitT < EXIT)) {
    st.from = st.from && st.from.length === nq ? st.from : new Float32Array(nq)
    st.from.set(st.cur)
    st.pelFrom.copy(st.pelCur)
    st.hasFrom = true
    st.fadeIn = 1
  } else {
    st.hasFrom = false
    st.fadeIn = 0
  }
  st.key = key
  st.t = 0
}

/** gecis karisimi: from -> buf (st.t ile); sonucu st.cur'a yazar */
function mix(st: KState, buf: Float32Array, pel: THREE.Vector3, len: number) {
  if (!st.cur || st.cur.length !== buf.length) st.cur = new Float32Array(buf.length)
  const k = st.hasFrom ? smooth(st.t / len) : 1
  if (k >= 1 || !st.from) {
    st.cur.set(buf)
    st.pelCur.copy(pel)
    return
  }
  for (let i = 0; i < buf.length; i += 4) {
    qa.set(st.from[i], st.from[i + 1], st.from[i + 2], st.from[i + 3])
    qb.set(buf[i], buf[i + 1], buf[i + 2], buf[i + 3])
    qa.slerp(qb, k)
    st.cur[i] = qa.x
    st.cur[i + 1] = qa.y
    st.cur[i + 2] = qa.z
    st.cur[i + 3] = qa.w
  }
  st.pelCur.copy(st.pelFrom).lerp(pel, k)
}

/** dalis: ctx.animT (DIVE_KEYS zamani) -> klip karesi */
function diveFrame(c: ClipJ, k: [number, number, number, number], t: number) {
  const to = Math.round(c.contact * 0.55)
  const T = [0, k[0], k[1], k[2], k[3]]
  const F = [0, to, c.contact, Math.max(c.contact + 1, c.land), c.n - 1]
  if (t >= T[4]) return F[4]
  let i = 1
  while (i < 4 && t > T[i]) i++
  const a = (t - T[i - 1]) / Math.max(1e-4, T[i] - T[i - 1])
  return F[i - 1] + (F[i] - F[i - 1]) * Math.min(1, Math.max(0, a))
}

/**
 * dalis sonrasi kalkis: yuzustu yatistan (GF lay_front: bas dalis yonunde). Klip ileriye bakar -> 90 derece donuk baslar,
 * dogrulurken govde oyun yonune doner. t: kalkis basindan beri (s); simulasyonun kalkis suresine (GETUP_T) olceklenir.
 */
function doGetup(ctx: LayerCtx, b: BankJ, st: KState, t: number, hold: boolean) {
  const c = b.clips[hold ? 'getup-front-hold' : 'getup-front']
  if (!c || !st.lastDiveSide) return false
  const dur = (c.n - 1) / c.fps
  const tc = Math.min(dur, (t * dur) / GETUP_T)
  const y0 = (st.lastDiveSide === 'l' ? 1 : -1) * Math.PI * 0.5
  const yaw = y0 * (1 - smooth((tc - dur * 0.3) / (dur * 0.6)))
  doClip(ctx, b, st, 'getup-' + st.lastDiveSide, c, tc * c.fps, yaw, 1)
  return true
}
const GETUP_T = 0.8 // sim/keeperDive.ts GETUP_T
const DOWN_T = 0.4 // sim/keeperDive.ts DOWN_T

/** klip secimi: simulasyonun el temas yuksekligine gore (oyun yalniz alcak/yuksek ayirir) */
function diveClipName(ctx: LayerCtx, type: string) {
  const sp = ctx.id >= 0 ? diveOf(ctx.id) : undefined
  const h = sp ? sp.contact.y : type === '-high' ? 2.0 : 0.3
  if (type === '-high') return h > 1.85 ? 'dive-high' : 'dive-trunk'
  if (type === '-low') return h < 0.55 ? 'dive-low' : 'dive-mid'
  return h > 1.3 ? 'dive-trunk' : 'dive-mid'
}

function doDive(ctx: LayerCtx, b: BankJ, st: KState, type: string, side: 'l' | 'r') {
  if (!st.key.startsWith('dive')) st.diveClip = diveClipName(ctx, type)
  const c = b.clips[`${st.diveClip}-${side}`]
  if (!c) return false
  // top elde dalis bittiyse oyun animasyonu dalista kalir, ama simulasyon kalkis fazina gecer (top gogse cikar): kalkis klibi
  if (ctx.animT >= DK[type][3] - 1e-3) st.downT += ctx.gdt
  else st.downT = 0
  if (st.downT > DOWN_T && st.lastDiveSide === side) return doGetup(ctx, b, st, st.downT - DOWN_T, ctx.hasBall)
  const nq = b.bones.length * 4
  enter(st, `dive${type}-${side}`, nq)
  st.lastDiveSide = side
  st.lastDiveT = 0
  const f = diveFrame(c, DK[type], ctx.animT)
  const buf = scratch(nq)
  sampleInto(c, f, buf, v2)
  mix(st, buf, v2, XFADE)
  st.fadeIn = Math.min(1, st.fadeIn + ctx.gdt / 0.08)
  const w = st.hasFrom ? 1 : smooth(st.fadeIn)
  applyBuf(ctx.rig, b.bones, st.cur!, w, 0)
  // pelvis: simulasyon yuksekligi, ama klibin yatis yuksekliginin altina inmez (kalca zemine gomulmesin)
  ctx.rig.pelvisOffset(v)
  if (v.y < st.pelCur.y) ctx.rig.blendPelvis(v.x, st.pelCur.y, v.z, w)
  // eller: simulasyonun el hedefi (eldiven ucu) -> bilek hedefi; itis sonundan temasa rampa, sonra korunur
  const ball = ctx.ball
  if (ball && ball.dive) {
    const to = Math.round(c.contact * 0.55)
    const wh = smooth((f - to) / Math.max(1, c.contact - to)) * w
    if (wh > 0.001) {
      const sh = ctx.rig.bonePos('spine_03', v)
      ctx.rig.localToModel(ball.x, ball.y, ball.z, tgt)
      v2.copy(tgt).sub(sh).normalize()
      // eldiven boyu kadar geride; iki el topun ust/alt yaninda (yanal dalista eller ust uste)
      const up = v.set(0, 1, 0).addScaledVector(v2, -v2.y).normalize()
      const u = UNIT(ctx)
      // erisim: omuz-hedef uzakligi. Hedefe yakin el tam IK; digeri menzil disindaysa (govde klipte uzak) hedefe dogru
      // gerilip havada asili kalmasin diye birakilir. Iki el de uzaksa (top elde havada) ikisi de uzanir.
      let dL = ctx.rig.bonePos('upperarm_l', HS).distanceTo(tgt) / u
      let dR = ctx.rig.bonePos('upperarm_r', HS).distanceTo(tgt) / u
      // iki el de yetismiyorsa (klibin govdesi simulasyonun el noktasindan uzak, ozellikle inis aninda) govde hedefe
      // dogru kaydirilir (en fazla 0.45 m), top elde havada asili kalmasin
      const near0 = Math.min(dL, dR)
      if (near0 > ARM_LEN + 0.02) {
        ctx.rig.bonePos(dL < dR ? 'upperarm_l' : 'upperarm_r', HS)
        const k = Math.min(0.45, near0 - ARM_LEN) * wh
        HS.subVectors(tgt, HS).normalize().multiplyScalar(k)
        ctx.rig.pelvisOffset(v3)
        ctx.rig.blendPelvis(v3.x + HS.x, v3.y + HS.y, v3.z + HS.z, 1)
        dL = ctx.rig.bonePos('upperarm_l', HS).distanceTo(tgt) / u
        dR = ctx.rig.bonePos('upperarm_r', HS).distanceTo(tgt) / u
      }
      const near = Math.min(dL, dR)
      for (const s of SIDES) {
        // dalis yonundeki el ustte
        const sgn = s === side ? 1 : -1
        HT.copy(tgt).addScaledVector(v2, -0.1 * u).addScaledVector(up, sgn * 0.06 * u)
        const d = s === 'l' ? dL : dR
        const kr = d <= near + 1e-6 || near > ARM_LEN + 0.15 ? 1 : 1 - smooth((d - ARM_LEN - 0.1) / 0.25)
        ctx.rig.reachHand(s, HT, wh * kr)
      }
    }
  }
  return true
}
const HT = new THREE.Vector3()
const SIDES = ['l', 'r'] as const
const HS = new THREE.Vector3()
const v3 = new THREE.Vector3()
const DBG_BONES = ['pelvis', 'spine_03', 'head', 'hand_l', 'hand_r', 'lowerarm_l', 'lowerarm_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r']
const ARM_LEN = 0.55 // omuz-bilek (m): upperarm 0.26 + lowerarm 0.27
const unitV = new THREE.Vector3()
/** model birimi / metre (localToModel farkindan) */
function UNIT(ctx: LayerCtx) {
  ctx.rig.localToModel(0, 0, 0, unitV)
  const x0 = unitV.y
  ctx.rig.localToModel(0, 1, 0, unitV)
  return unitV.y - x0
}

function doClip(ctx: LayerCtx, b: BankJ, st: KState, key: string, c: ClipJ, f: number, yaw: number, pelW: number, wMul = 1, armW = 1) {
  const nq = b.bones.length * 4
  enter(st, key, nq)
  const buf = scratch(nq)
  sampleInto(c, f, buf, v2)
  if (yaw !== 0) {
    // donus gecisten ONCE: karisim ve saklanan poz son (donuk) uzayda olsun
    yawQ.setFromAxisAngle(Y, yaw)
    for (let k = 0; k < nq; k += 4) {
      qd.set(buf[k], buf[k + 1], buf[k + 2], buf[k + 3]).premultiply(yawQ)
      buf[k] = qd.x
      buf[k + 1] = qd.y
      buf[k + 2] = qd.z
      buf[k + 3] = qd.w
    }
  }
  mix(st, buf, v2, XFADE)
  st.fadeIn = Math.min(1, st.fadeIn + ctx.gdt / 0.1)
  const w = (st.hasFrom ? 1 : smooth(st.fadeIn)) * wMul
  applyBuf(ctx.rig, b.bones, st.cur!, w, 0, armW)
  if (pelW > 0) {
    ctx.rig.pelvisOffset(v)
    ctx.rig.blendPelvis(v.x, st.pelCur.y, v.z, w * pelW)
  }
}

// zemin: kaynak iskeletin bacaklari hedeften kisa (0.86 / 0.915 m); ayak ucu / bilek / bilek(el) zemine gomulmesin
const CLAMP: [string, number][] = [
  ['ball_l', 0.02],
  ['ball_r', 0.02],
  ['foot_l', 0.05],
  ['foot_r', 0.05],
  ['hand_l', 0.03],
  ['hand_r', 0.03],
  ['calf_l', 0.06],
  ['calf_r', 0.06],
]
function groundClamp(ctx: LayerCtx) {
  const u = UNIT(ctx)
  ctx.rig.localToModel(0, 0, 0, HS)
  let lift = 0
  for (const [bn, m] of CLAMP) {
    const y = (ctx.rig.bonePos(bn, v).y - HS.y) / u
    if (m - y > lift) lift = m - y
  }
  if (lift > 0.001) {
    ctx.rig.pelvisOffset(v)
    ctx.rig.blendPelvis(v.x, v.y + Math.min(lift, 0.2), v.z, 1)
  }
}

export const keeperLayer: Layer = (ctx) => {
  const b = bank
  if (!b) return
  const st = layerState(ctx, 'keeper', () => new KState())
  st.lastDiveT += ctx.gdt
  st.t += ctx.gdt
  const name = ctx.name
  const dm = DIVE_RE.exec(name)
  let did = false
  if (dm) did = doDive(ctx, b, st, dm[1] ?? '', dm[2] as 'l' | 'r')
  else if (name === 'keeper-throw' && throwBank && throwBank.bones.join() === b.bones.join()) {
    const c = throwBank.clips.throw
    // birakma ani oyunun temas anina oturur; oncesi sikistirilir, sonrasi 1.4x
    const t = ctx.animT
    // birakma sonrasi: kaynak klibin derin one egilisi (beyzbol tarzi) kaleci atisi icin asiri -> kisa izleme, sonra parametrige doner
    const rel = c.contact - 2 // en yuksek el hizi karesinden biraz once: el bas ustunde-onde
    const f = t < THROW_CONTACT ? rel - (THROW_CONTACT - t) * c.fps * (rel / (THROW_CONTACT * c.fps)) : Math.min(rel + 7, rel + (t - THROW_CONTACT) * c.fps)
    // izleme yariya inen agirlikla (parametrik dik durusla karisir), sonra tamamen parametrige doner
    const wOut = (1 - 0.45 * smooth((t - THROW_CONTACT) / 0.1)) * (1 - smooth((t - 0.55) / 0.2))
    // top iki elde gogus onunde: kurulus baslayana dek kollar parametrik (HOLD)
    const armW = smooth((t - 0.04) / 0.14)
    doClip(ctx, b, st, name, c, f, 0, 1, wOut, armW)
    did = true
  } else if (name in CATCH_CLIP) {
    // yerden toplama oyunda 1.2 m altindaki her top icin: top gogus hizasindaysa (>0.5 m) gogus tutusu klibi
    if (st.key !== name) st.catchClip = name === 'keeper-collect' && ctx.ball && ctx.ball.y > 0.5 ? 'catch' : CATCH_CLIP[name]
    const c = b.clips[st.catchClip]
    if (c) {
      const f = Math.max(0, c.contact - CATCH_LEAD * c.fps) + ctx.animT * c.fps
      doClip(ctx, b, st, name, c, f, 0, 1)
      did = true
    }
  } else if (name === 'getup' && st.lastDiveSide && (st.key.startsWith('dive') || st.key.startsWith('getup'))) {
    did = doGetup(ctx, b, st, ctx.animT, false)
  }
  if (did) {
    st.exitT = 0
    status.frames++
    groundClamp(ctx)
    // test olcumu (yalniz window.__keeperDbg varsa): kemiklerin zemine gore en alcak noktasi (m) ve el hedef hatasi
    const dbg = (globalThis as { __keeperDbg?: unknown[] }).__keeperDbg
    if (dbg) {
      const u = UNIT(ctx)
      ctx.rig.localToModel(0, 0, 0, HS)
      let lo = 9
      let nm = ''
      for (const bn of DBG_BONES) {
        const y = (ctx.rig.bonePos(bn, v).y - HS.y) / u
        if (y < lo) (lo = y), (nm = bn)
      }
      let he = -1
      if (ctx.ball?.dive) {
        ctx.rig.localToModel(ctx.ball.x, ctx.ball.y, ctx.ball.z, tgt)
        he = Math.min(ctx.rig.bonePos('hand_l', v).distanceTo(tgt), ctx.rig.bonePos('hand_r', v2).distanceTo(tgt)) / u
      }
      dbg.push([name, st.key, +ctx.animT.toFixed(2), +lo.toFixed(3), nm, +he.toFixed(3)])
    }
    return
  }
  // cikis: son pozdan parametrik poza yumusak donus (baska katmanin aksiyonu degilse)
  if (st.key !== '') {
    st.key = ''
    st.exitT = 0
  }
  st.exitT += ctx.gdt
  if (st.cur && st.exitT < EXIT && (name.startsWith('keeper-') || name === 'idle' || name === 'jog' || name === 'walk')) {
    const we = 1 - smooth(st.exitT / EXIT)
    applyBuf(ctx.rig, b.bones, st.cur, we, 0)
    // pelvis: parametrik poz hala yatistan dogruluyor olabilir -> son klip yuksekliginin altina inme
    ctx.rig.pelvisOffset(v)
    if (v.y < st.pelCur.y) ctx.rig.blendPelvis(v.x, st.pelCur.y, v.z, we)
  }
  if (!name.startsWith('keeper-') && name !== 'getup') st.lastDiveSide = null
}
