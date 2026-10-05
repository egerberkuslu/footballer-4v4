// Sut eylemleri: sarj, birakma, kosu sonrasi vurus, top yerlestirme, ucus izleme.
import { CLIP_LEN } from '../anim/timing'
import { withCurtain } from '../ui/curtain'
import { GOAL_H, GOAL_W, PITCH_L, PITCH_W, SPOT_DIST } from '../pitch'
import { world } from '../sim'
import { solveShot, type Shot } from './aim'
import { CHARGE_MAX, CHARGE_T, V_MAX, V_MIN, bumpCtl, ctl, flash, shotType, type PlayMode, type ShotEvent, type ShotType } from './store'
import { kick, placeBall } from './worldApi'

export const RUN_T = CLIP_LEN.kickContact // kosu = vurus klibinin temas anina kadar (s)
export const RUN_D = 1.0 // kosu mesafesi (m)
const FLIGHT_MAX = 3 // sut sonrasi en uzun izleme (s)

const now = () => performance.now() / 1000
let chargeStart = 0
let pending: Shot | null = null
let pendingKmh = 0
// bu sutta gosterilen olaylar (ayni olay iki kez yazilmaz)
let seen = new Set<string>()
let scoredThis = false
let lastSpeed = 24 // onizleme hizi (son sut)

export const previewSpeed = () => (ctl.charge >= 0 ? chargeSpeed(ctl.charge) : lastSpeed)
export const chargeSpeed = (c: number) => V_MIN + (V_MAX - V_MIN) * Math.min(1, Math.max(0, c))
export const running = () => ctl.runT >= 0 && now() - ctl.runT < RUN_T + 0.05

/** topu koy; hedef kale topa en yakin kale olur */
export function placeSpot(x: number, z: number, keepSide = false) {
  const g = PITCH_L / 2
  if (!keepSide) world.side = x >= 0 ? 1 : -1
  const s = world.side
  // sahanin icinde, kale cizgisine en az 1 m
  let sx = Math.max(-g + 0.5, Math.min(g - 0.5, x))
  if (s * sx > g - 1) sx = s * (g - 1)
  ctl.spotX = sx
  ctl.spotZ = Math.max(-(PITCH_W / 2 - 0.3), Math.min(PITCH_W / 2 - 0.3, z))
  returnBall()
}

export const resetSpot = () => placeSpot(world.side * (PITCH_L / 2 - SPOT_DIST), 0, true)

/** sut biter: top yerine, oyuncu topun arkasina, kamera sutcuye */
export function returnBall() {
  ctl.inFlight = false
  ctl.runT = -1
  ctl.charge = -1
  pending = null
  placeBall(ctl.spotX, ctl.spotZ)
  bumpCtl()
}

export function startCharge() {
  if (running() || ctl.charge >= 0) return
  if (ctl.inFlight) returnBall()
  chargeStart = now()
  ctl.charge = 0
}

export function cancelCharge() {
  ctl.charge = -1
}

/** her kare: sarj, kosu sonu vurus */
export function tickShot(dt: number) {
  if (ctl.charge >= 0) ctl.charge = Math.min(CHARGE_MAX, (now() - chargeStart) / CHARGE_T)
  if (pending && now() - ctl.runT >= RUN_T) {
    kick(pending.v, pending.w)
    pending = null
    beginFlight(pendingKmh)
  }
  if (ctl.inFlight) {
    ctl.flightT += dt * world.timeScale
    if (ctl.flightT > FLIGHT_MAX) returnBall()
  }
}

function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())
}

/** fazla sarjda hedef sapmasi (m, standart sapma) */
export const overchargeSigma = (c: number) => (c <= 0.88 ? 0 : Math.min(2, 0.45 * Math.pow((c - 0.88) / 0.12, 1.5)))

export function release() {
  if (ctl.charge < 0) return
  // bekleyen kareyi beklemeden gercek sureden
  const c = Math.min(CHARGE_MAX, (now() - chargeStart) / CHARGE_T)
  ctl.charge = -1
  const speed = chargeSpeed(c)
  lastSpeed = speed
  const sg = overchargeSigma(c)
  const ty = Math.max(0.11, ctl.aimY + gauss() * sg * 0.6)
  const tz = ctl.aimZ + gauss() * sg
  pending = solveShot(ctl.spotX, ctl.spotZ, world.side, ty, tz, speed, shotType(), ctl.curl)
  pendingKmh = pending.speed * 3.6
  ctl.runT = now()
  bumpCtl()
}

function beginFlight(kmh: number) {
  ctl.lastKmh = Math.round(kmh)
  ctl.inFlight = true
  ctl.flightT = 0
  seen = new Set()
  scoredThis = false
  bumpCtl()
}

/** test: nisansiz dogrudan sut (fare olmadan, olay/HUD akisi dahil) */
export function testKick(ty: number, tz: number, speed: number, type: ShotType = 'normal', curl = 0) {
  returnBall()
  const sh = solveShot(ctl.spotX, ctl.spotZ, world.side, ty, tz, speed, type, curl)
  kick(sh.v, sh.w)
  beginFlight(sh.speed * 3.6)
  return sh
}

/** eski rastgele sut */
export function autoShot() {
  if (ctl.charge >= 0 || running()) return
  world.shoot()
  const b = world.ball
  beginFlight(Math.hypot(b.vx, b.vy, b.vz) * 3.6)
}

const LABEL: Partial<Record<ShotEvent, string>> = { gol: 'GOL!', direk: 'DİREK!', 'ust-direk': 'ÜST DİREK!', aut: 'AUT' }

export function shotEvent(e: ShotEvent | string) {
  if (!ctl.inFlight || seen.has(e)) return
  seen.add(e)
  if (e === 'gol') {
    scoredThis = true
  }
  // golden sonra aga/auta dusmek yazilmaz
  if (e === 'aut' && (scoredThis || seen.has('direk') || seen.has('ust-direk'))) return
  if (e === 'durdu') {
    // yarim saniye sonra donus (izleme suresi sonuna cekilir)
    if (ctl.flightT > 0.5) ctl.flightT = Math.max(ctl.flightT, FLIGHT_MAX - 0.5)
    return
  }
  const l = LABEL[e as ShotEvent]
  if (l) flash(l)
  else bumpCtl()
}

// kale agzi icinde mi (nisan rengi)
export const aimInside = () => Math.abs(ctl.aimZ) < GOAL_W / 2 - 0.11 && ctl.aimY < GOAL_H - 0.11

/** antrenman <-> mac. Macta kamera yayina gecer; antrenmanda top sutcunun noktasina doner. */
export function setMode(m: PlayMode) {
  if (ctl.mode === m) return
  cancelCharge()
  if (m !== 'mac') ctl.practice = false
  ctl.mode = m
  ctl.inFlight = false
  ctl.runT = -1
  pending = null
  if (m === 'mac') {
    ctl.cam = 'yayin'
    world.timeScale = 1
    placeBall(0, 0) // baslama vurusu (kurallar dizer)
  } else {
    ctl.cam = 'sutcu'
    returnBall()
  }
  bumpCtl()
}

/** mac: sarji bitir, seviyeyi dondur (-1: sarj yoktu) */
export function takeCharge(): number {
  if (ctl.charge < 0) return -1
  const c = Math.min(CHARGE_MAX, (now() - chargeStart) / CHARGE_T)
  ctl.charge = -1
  return c
}

/** mac: sarj gostergesini guncelle (tickShot antrenmanda calisir) */
export function tickCharge() {
  if (ctl.charge >= 0) ctl.charge = Math.min(CHARGE_MAX, (now() - chargeStart) / CHARGE_T)
}

export const gaussNoise = gauss

/** mod gecisi perde ile (M'nin yukleme perdesi: indir, degistir, malzemeler derlenince kaldir) */
export function switchMode(m: PlayMode) {
  if (ctl.mode === m) return
  withCurtain(() => setMode(m), m === 'mac' ? 'Maç hazırlanıyor' : 'Antrenman hazırlanıyor')
}
