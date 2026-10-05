// Mac kontrolu: insan girdisi (oncelik -30) ve hareket/aksiyon adimi (oncelik -15).
// Klavye: WASD/oklar hareket (kameraya gore), Shift sprint, sol tik/Bosluk basili tut + birak sut,
// sag tik / K pas, Z + pas asirtma pas, Z + sut asirtma sut (Ctrl hic kullanilmaz: Ctrl+W sekmeyi kapatir), E mudahale (sprintte de), E E (0,25 s icinde cift dokunus) kayarak, Q oyuncu degistir,
// fare tekerlegi (sut sarji sirasinda) ya da , / . tuslari falso. Gamepad destekli.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { game } from '../game/store'
import type { Player, PlayerInput } from '../game/types'
import { GOAL_H, GOAL_W, PITCH_L } from '../pitch'
import { world } from '../sim'
import { isGuest, lockedPlayer } from '../mp/role'
import { isVarActive } from '../var/store'
import { currentRules } from '../rules/instance'
import { gaussNoise, overchargeSigma, startCharge, cancelCharge, takeCharge, tickCharge } from './actions'
import { setControlled, stepLocomotion } from './locomotion'
import { CURL_W } from './aim'
import { CURL_STEPS, bumpCtl, ctl, setCurl, setCurlAnalog } from './store'
import { pollPad, installRumble } from './gamepad'
import { gamepadSettingsOpen } from '../ui/gamepadUi'
import { toggleCam } from './ShotController'
import { setScreen } from '../mp/session'

const HL = PITCH_L / 2

const keys = new Set<string>()
let lobMod = false
const JOCKEY_HOLD_MS = 180 // E bu sureden uzun basiliysa jockey, kisa dokunus mudahale
let eDown = 0
/** sag cubuk (gamepad) son degeri: kamera ve nisan icin */
export const padLook = { x: 0, y: 0 }
let padCam = 4
let lastEDown = 0
let padE = 0

const SET_PHASES = new Set(['freekick', 'corner', 'kickin', 'goalkick', 'penalty', 'kickoff'])
/** duran top kuruluyor ve sira insan takiminda: nisan ve guc hazirligina izin (vurus kullanan topa varinca) */
function setupEligible() {
  const ph = game.match.phase
  if (!SET_PHASES.has(ph) || game.humanTeam === null) return false
  const rs = game.match.restart
  return !rs || rs.team === game.humanTeam
}
// kurulum sirasinda birakilan sarj: kullanan hazir olunca vurulur
let queuedShot = -1
let queuedKind: 'shoot' | 'pass' | 'lob' = 'shoot'
let queuedAt = 0
const SET_REACH = 1.2 // duran topu vurmak icin taker topa bu kadar yakin olmali

function nearestToBall(team: number, exclude = -1): Player | undefined {
  const b = world.ball
  let best: Player | undefined
  let bd = Infinity
  for (const p of game.players) {
    if (p.team !== team || p.sentOff || p.id === exclude) continue
    const d = Math.hypot(p.x - b.x, p.z - b.z)
    if (d < bd) {
      bd = d
      best = p
    }
  }
  return best
}

/** pas hedefi: dir yonunde en uygun takim arkadasi (onunu karsilar), yoksa 12 m ileri nokta */
function passTarget(p: Player, dx: number, dz: number) {
  let best: Player | null = null
  let bs = -Infinity
  for (const q of game.players) {
    if (q.team !== p.team || q.id === p.id || q.sentOff) continue
    const rx = q.x - p.x
    const rz = q.z - p.z
    const d = Math.hypot(rx, rz)
    if (d < 1.5 || d > 32) continue
    const c = (rx * dx + rz * dz) / d
    if (c < 0.35) continue
    const s = c * 2 - d * 0.03
    if (s > bs) {
      bs = s
      best = q
    }
  }
  if (!best) return { x: p.x + dx * 12, y: 0, z: p.z + dz * 12 }
  const t = Math.hypot(best.x - p.x, best.z - p.z) / 13
  return { x: best.x + best.vx * t, y: 0, z: best.z + best.vz * t }
}

export function MatchControl() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const mouse = useRef({ x: 0, z: 0, valid: false })
  const pending = useRef<null | 'pass' | 'lob' | 'tackle' | 'slide' | 'shoot'>(null)

  useEffect(() => {
    // test/ayiklama
    installRumble()
    Object.assign(window, { __loco: { game, stepLocomotion, setControlled, ctl } })
  }, [])

  useEffect(() => {
    const el = gl.domElement
    const ray = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hit = new THREE.Vector3()
    const active = () => ctl.mode === 'mac' && !isVarActive() && !gamepadSettingsOpen()
    // duran topta yalniz kullanan (kontrol ediliyorsa) oynar
    const canAct = () => {
      if (game.match.phase === 'play') return true
      const p = game.controlledPlayer()
      return (!!p && game.match.restart?.taker === p.id) || setupEligible()
    }
    const onMove = (e: PointerEvent) => {
      if (!active()) return
      const r = el.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
      if (ray.ray.intersectPlane(plane, hit)) mouse.current = { x: hit.x, z: hit.z, valid: true }
    }
    const onDown = (e: PointerEvent) => {
      if (!active()) return
      if (!canAct()) return
      if (e.button === 0) startCharge()
      else if (e.button === 2) pending.current = lobMod ? 'lob' : 'pass'
    }
    const onUp = (e: PointerEvent) => {
      if (active() && e.button === 0 && ctl.charge >= 0) pending.current = 'shoot'
    }
    const onKey = (e: KeyboardEvent) => {
      if (!active() || e.key === 'F3' || e.key === '`') return
      const k = e.key.toLowerCase()
      if (k === 'z') lobMod = true
      if (e.key === ',' || e.key === '.') {
        e.preventDefault()
        setCurl(ctl.curl + (e.key === ',' ? -1 : 1))
        return
      }
      // oyun tuslari tarayiciya gitmesin
      if (['w', 'a', 's', 'd', 'q', 'e', 'k', 'z', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
      keys.add(k)
      if (e.repeat) return
      if (k === 'q' && lockedPlayer() < 0) {
        const cur = game.controlledPlayer()
        const n = nearestToBall(game.humanTeam ?? 0, cur?.id)
        if (n) setControlled(n.id)
        return
      }
      if (!canAct()) return
      if (e.code === 'Space') startCharge()
      else if (k === 'k') pending.current = lobMod ? 'lob' : 'pass'
      else if (k === 'e') {
        // E dokunus: ayakta mudahale (Shift basili de), E E cift dokunus: kayarak, E basili: jockey
        const t = performance.now()
        if (t - lastEDown < 250) {
          pending.current = 'slide'
          eDown = 0
          lastEDown = 0
        } else {
          eDown = t
          lastEDown = t
        }
      }
    }
    // tekerlek: sut sarji sirasinda falso (-3 sola .. +3 saga); sarj disinda dokunulmaz
    const onWheel = (e: WheelEvent) => {
      if (!active() || ctl.charge < 0) return
      e.preventDefault()
      setCurl(ctl.curl + (e.deltaY > 0 ? 1 : -1))
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      keys.delete(k)
      if (k === 'z') lobMod = false
      if (k === 'e' && eDown > 0) {
        if (performance.now() - eDown < JOCKEY_HOLD_MS && active()) pending.current = 'tackle'
        eDown = 0
      }
      if (e.code === 'Space' && active() && ctl.charge >= 0) pending.current = 'shoot'
    }
    const blur = () => {
      eDown = 0
      keys.clear()
      lobMod = false
      cancelCharge()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', blur)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', blur)
    }
  }, [gl, camera])

  // insan girdisi -> game.inputs[kontrol edilen]
  const fwd = useRef(new THREE.Vector3())
  useFrame(() => {
    if (ctl.mode !== 'mac' || isVarActive()) return
    // cok oyunculu: insan sabit oyuncuya kilitli (otomatik devir / Q yok)
    const lk = lockedPlayer()
    const team = lk >= 0 ? game.players[lk]?.team ?? null : game.humanTeam
    if (team === null) return
    world.side = game.match.attackDir[team] // nisan halkasi rakip kaleye
    tickCharge()
    ctl.setup = setupEligible()

    let p = game.controlledPlayer()
    if (lk >= 0) {
      p = game.players[lk]
      if (!p || p.sentOff) return
    } else {
      // top takim arkadasina gecince kontrol ona
      const owner = game.players.find((q) => q.hasBall)
      if (owner && owner.team === team && !owner.controlled && game.match.phase === 'play') {
        setControlled(owner.id)
        p = owner
      }
      if (!p || p.team !== team || p.sentOff) {
        const n = nearestToBall(team)
        if (n) setControlled(n.id)
        p = n
      }
    }
    if (!p) return
    const inp: PlayerInput = game.inputs[p.id]
    // kol ayar ekrani acik: klavye ve kol oyunu etkilemesin
    if (gamepadSettingsOpen()) {
      inp.move.x = inp.move.z = 0
      inp.sprint = false
      inp.action = null
      inp.jockey = false
      pending.current = null
      eDown = 0
      padE = 0
      if (ctl.charge >= 0) cancelCharge()
      return
    }

    // kameraya gore yon
    camera.getWorldDirection(fwd.current)
    let fx = fwd.current.x
    let fz = fwd.current.z
    const fl = Math.hypot(fx, fz) || 1
    fx /= fl
    fz /= fl
    const rx = -fz
    const rz = fx
    let ix = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0)
    let iy = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0)
    let sprint = keys.has('shift')

    // gamepad: profil/atama/olu bolge gamepad.ts + gamepadConfig.ts'te
    const gp = gamepadSettingsOpen() ? null : pollPad() // ayar ekrani acikken oyun girdisi yok
    if (gp) {
      if (Math.hypot(gp.move.x, gp.move.y) > 0) {
        const k = gp.held.precise ? 0.5 : 1 // hassas yurume
        ix = gp.move.x * k
        iy = gp.move.y * k
      }
      sprint = sprint || gp.held.sprint
      if (gp.down.pass) pending.current = 'pass'
      if (gp.down.lob) pending.current = 'lob'
      if (gp.down.shoot) startCharge()
      if (gp.up.shoot && ctl.charge >= 0) pending.current = 'shoot'
      // sut sarjinda sol cubuk X = falso (-1..+1), sag cubuk nisan
      if (gp.held.shoot) setCurlAnalog(gp.move.x)
      else if (ctl.curlAnalog !== 0) setCurlAnalog(0)
      // tackle dugmesi dokunus: mudahale, basili: jockey; L1 basili iken: kayarak
      if (gp.down.tackle) {
        if (gp.l1) pending.current = 'slide'
        else padE = performance.now()
      }
      if (gp.up.tackle && padE > 0) {
        if (performance.now() - padE < JOCKEY_HOLD_MS) pending.current = 'tackle'
        padE = 0
      }
      if (gp.down.switch && lk < 0) {
        const n = nearestToBall(team, p.id)
        if (n) setControlled(n.id)
      }
      if (gp.down.camera) toggleCam()
      if (gp.down.hints) {
        ctl.passHints = !ctl.passHints
        bumpCtl()
      }
      if (gp.down.pause) setScreen('menu')
      // D-pad sol/sag: kamera onayarlari (CameraRig 'rig' olayi, maçta 4 = yayin)
      if (gp.down.camPrev || gp.down.camNext) {
        padCam = (padCam + (gp.down.camNext ? 1 : 4)) % 5
        window.dispatchEvent(new CustomEvent('rig', { detail: padCam }))
      }
      padLook.x = gp.look.x
      padLook.y = gp.look.y
    }

    let mx = rx * ix + fx * iy
    let mz = rz * ix + fz * iy
    const ml = Math.hypot(mx, mz)
    if (ml > 1) {
      mx /= ml
      mz /= ml
    }

    // duran top: yalniz kullanan kontrol ediliyorsa aksiyon, hareket kilitli
    const ph = game.match.phase
    const rs = game.match.restart
    let allowMove = true
    let allowAct = true
    if (ph !== 'play') {
      // kurulumda kullanan serbest, digerleri bos
      allowMove = allowAct = !!rs && rs.taker === p.id
    }
    // HUD ipucu: neden hareket edilemiyor / sira kimde
    const hint =
      ph === 'play' || ph === 'var' || ph === 'stopped' || isVarActive()
        ? ''
        : ph === 'halftime' || ph === 'fulltime'
          ? ''
          : allowAct
            ? 'Sıra sende: K pas · Boşluk şut'
            : rs
              ? 'Duran top: rakip kullanıyor…'
              : 'Duran top kuruluyor…'
    if (hint !== ctl.hint) {
      ctl.hint = hint
      bumpCtl()
    }
    inp.move.x = allowMove ? mx : 0
    inp.move.z = allowMove ? mz : 0
    inp.sprint = allowMove && sprint
    // jockey: E (ya da RB) basili tutuluyor
    const held = (t0: number) => t0 > 0 && performance.now() - t0 >= JOCKEY_HOLD_MS
    ;inp.jockey = allowMove && !p.hasBall && (held(eDown) || held(padE))

    if (queuedShot >= 0 && (performance.now() - queuedAt > 5000 || (ph === 'play' && !allowAct))) queuedShot = -1
    // duran top: taker topa varmadan verilen vurus/pas hemen bosa gitmesin, varinca uygulansin
    const atBall = Math.hypot(world.ball.x - p.x, world.ball.z - p.z) < SET_REACH
    // K 'ready' olmadan (kurulum/yuruyus) vurus girdisi silinir: o ana dek beklet
    const waitBall = ph !== 'play' && allowAct && (!atBall || currentRules().mode !== 'ready')
    const fromQueue = pending.current === null && queuedShot >= 0 && allowAct && !waitBall
    const want = pending.current ?? (fromQueue ? queuedKind : null)
    pending.current = null
    if (fromQueue && queuedKind !== 'shoot') queuedShot = -1
    if (!want || !allowAct || (waitBall && want !== 'tackle' && want !== 'slide')) {
      if (want === 'shoot') {
        if ((setupEligible() || (allowAct && waitBall)) && ctl.charge >= 0) {
          // kurulum: sarji dondur, kullanan hazir olunca vur
          queuedShot = takeCharge()
          queuedKind = 'shoot'
          queuedAt = performance.now()
        } else cancelCharge()
        bumpCtl()
      } else if ((want === 'pass' || want === 'lob') && (setupEligible() || waitBall)) {
        queuedShot = 0
        queuedKind = want
        queuedAt = performance.now()
      }
      return
    }
    // aksiyon yonu: fare zemini > hareket > bakis
    let dx = Math.sin(p.facing)
    let dz = Math.cos(p.facing)
    const m = mouse.current
    if (m.valid && Math.hypot(m.x - p.x, m.z - p.z) > 1) {
      const d = Math.hypot(m.x - p.x, m.z - p.z)
      dx = (m.x - p.x) / d
      dz = (m.z - p.z) / d
    } else if (ml > 0.2) {
      dx = mx / ml
      dz = mz / ml
    }
    const b = world.ball
    if (want === 'shoot') {
      const c = queuedShot >= 0 ? queuedShot : takeCharge()
      queuedShot = -1
      if (c < 0) return
      const sg = overchargeSigma(c)
      const gx = game.match.attackDir[team] * HL
      // gamepad: kale ortasina, cubukla kaydirilmis; fare: nisan halkasi
      const ay = gp ? Math.max(0.3, Math.min(GOAL_H, 1.0 + padLook.y * 0.9)) : ctl.aimY
      const az = gp ? Math.max(-GOAL_W / 2, Math.min(GOAL_W / 2, padLook.x * 2.2)) : ctl.aimZ
      const aim = { x: gx, y: Math.max(0.11, Math.min(GOAL_H + 1, ay + gaussNoise() * sg * 0.6)), z: az + gaussNoise() * sg }
      // havadaki top: kafa vurusu
      if (b.y > 1.1 && Math.hypot(b.x - p.x, b.z - p.z) < 1.2) inp.action = { type: 'header', power: Math.min(1, c), aim }
      // Z + sut: asirtma (top kale cizgisinde, nisan noktasinin altina iner)
      else if (lobMod) inp.action = { type: 'lob', power: 0, aim: { x: gx, y: 0, z: aim.z }, spin: { x: 0, y: (-ctl.curl / CURL_STEPS) * CURL_W, z: 0 } }
      else inp.action = { type: 'shoot', power: Math.min(1, c), aim, spin: { x: 0, y: (-ctl.curl / CURL_STEPS) * CURL_W, z: 0 } }
      ctl.lastKmh = Math.round((8 + 26 * Math.min(1, c)) * 3.6)
      bumpCtl()
    } else if (want === 'pass' || want === 'lob') {
      inp.action = { type: want, power: 0, aim: passTarget(p, dx, dz), spin: { x: 0, y: (-ctl.curl / CURL_STEPS) * CURL_W, z: 0 } }
    } else {
      // mudahale: top yakinsa topa dogru
      const db = Math.hypot(b.x - p.x, b.z - p.z)
      const aim = db < 4 ? { x: b.x, y: 0, z: b.z } : { x: p.x + dx * 3, y: 0, z: p.z + dz * 3 }
      inp.action = { type: want, power: 0, aim }
    }
  }, -30)

  // hareket + top aksiyonlari (insan ve AI)
  useFrame((_, dt) => {
    // misafirde durum host'tan gelir
    if (ctl.mode !== 'mac' || isGuest()) return
    stepLocomotion(Math.min(dt, 1 / 30) * world.timeScale)
  }, -15)

  return null
}
