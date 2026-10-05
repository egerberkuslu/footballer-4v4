// Kaleci dalis kinematigi ve kurtaris sonucu (saf TS, React/three yok).
// Karar aninda planDive() bir DiveSpec uretir; animasyon diveState(spec, t) ile kok hareketini ve el hedefini
// okur, fizik tc'de sonucu (tutma/yumruk/kacirma) uygular. Spec'ler diveOf(id) ile okunur (types.ts'e dokunmaz).
//
// Zamanlama: brain.ts kalecinin tepki suresini (T.react 0.13-0.34 s) dalis kararindan ONCE zaten bekler.
// Burada tl = t0 + PUSH_LEAD (carpma/ilk adim) kalkis anidir; ek tepki eklenmez.
// Gercekci sinirlar: yan menzil 2.3 m, yuksek 2.6 m, kok yatay hizi <= 4.5 m/s, eller kokten ~0.95 m onde.
import { type BallState, freeStep, newBall } from './ball'

export const MAX_SIDE = 2.3 // el temas noktasinin kaleciden yatay en uzagi (m)
export const MAX_HIGH = 2.6 // el temas yuksekligi siniri (m)
export const ARM = 0.95 // kok (pelvis) - eldiven yatay uzakligi (govde yatay)
export const ROOT_MAX = MAX_SIDE - ARM // kokun gidebilecegi yatay mesafe
export const V_ROOT_MAX = 4.5 // kok yatay hizi siniri (m/s)
export const PUSH_LEAD = 0.06 // karar - kalkis (s)
export const PUSH_T = 0.08 // yatay hizlanma suresi
export const MIN_FLIGHT = 0.16 // kalkistan temasa en az sure
export const SLIDE_T = 0.35 // inisten sonra kayma ve durma
export const DOWN_T = 0.4 // yerde kalma, sonra kalkis
export const GETUP_T = 0.8 // CLIP_LEN.getup ile ayni
export const PELVIS_STAND = 0.95
export const PELVIS_LIE = 0.28
const G = 9.81

export type DiveOutcome = 'catch' | 'parry' | 'miss'
export type DivePhase = 'ready' | 'push' | 'flight' | 'slide' | 'down' | 'getup'

export interface V3 {
  x: number
  y: number
  z: number
}

export interface DiveSpec {
  id: number
  t0: number // karar (dunya zamani, s)
  tl: number // kalkis
  tc: number // eller topa temas
  tLand: number // yere inis
  tStop: number // kayma biter, yerde kalma baslar
  tUp: number // ayakta (kalkis tamam)
  dir: { x: number; z: number } // birim yatay dalis yonu
  start: { x: number; z: number } // kalkis kok konumu
  contact: V3 // el temas noktasi (top yolu uzerinde, dunya)
  miss: V3 // elin gercek varacagi nokta (kacirmada contact'tan uzak)
  dist: number // tc'ye dek kokun yatay gittigi mesafe
  vh: number // yatay sabit hiz (ucus boyunca)
  peak: number // kok (pelvis) tepe yuksekligi
  yc: number // temasta pelvis yuksekligi
  v0y: number // pelvis dikey kalkis hizi
  side: 'l' | 'r' // karakterin soluna mi sagina mi
  high: boolean // temas > 1.0 m
  reach: boolean // temas noktasi menzilde mi
  outcome: DiveOutcome
  parry: V3 // yumrukta/ele carpmada topun yeni hizi
  ballSpeed: number // temasta top hizi
  p: number // kurtarma olasiligi (hesaplanan)
}

export interface DiveState {
  x: number
  y: number // pelvis yuksekligi (m)
  z: number
  hand: V3 // on el hedefi (dunya)
  phase: DivePhase
  u: number // faz ici ilerleme 0..1 (ucus: tl..tLand)
  v: number // yatay hiz (m/s, dir yonunde)
}

/** dalis sayaclari (test/olcum): n toplam, reach menzilde, catch/parry/miss sonuc */
export const diveStats = { n: 0, reach: 0, catch: 0, parry: 0, miss: 0 }
/** olcum kancasi: her planDive sonunda cagrilir (test/denetim) */
export const diveHook: { fn?: (spec: DiveSpec, inp: DiveIn) => void } = {}
const specs = new Map<number, DiveSpec>()
export const diveOf = (id: number) => specs.get(id)
export const clearDive = (id: number) => specs.delete(id)

export interface DiveIn {
  id: number
  t0: number
  kx: number
  kz: number
  facing: number
  goalX: number // kalecinin kale cizgisi x (isaretli)
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number; wx: number; wy: number; wz: number }
  skill?: number // 0..1, kurtarma olasiligi carpani (zor: yuksek)
  rnd?: () => number
  aim?: V3 // komut hedefi: gelen top yoksa (top yavas/uzaklasiyor) temas noktasi bu olur
  shotDist?: number // sutun atildigi yerden kale cizgisine mesafe (yakin sutta olasilik duser)
}

const sim: BallState = newBall()
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u))

/** kurtarma olasiligi: hiz, menzil payi, yukseklik ve yakin sut */
/** kurtarma olasiligi genel carpani (oyun ici orani ayarlamak icin tek dugme) */
export const keeperTune = { gain: 1.2, skill: 0.5, stand: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.KSTAND ?? 1) }
/** locomotion'un saati (s): DiveSpec zamanlari bu saatte; animasyon diveState(spec, diveClock.t) okur */
export const diveClock = { t: 0 }
export function saveProb(speed: number, margin: number, yc: number, shotDist: number, skill: number): number {
  const sp = Math.max(0.35, Math.min(1, 1.25 - (speed - 14) / 24)) // <=14 m/s kolay, 32+ m/s zor
  const mg = 0.45 + 0.55 * Math.sqrt(Math.max(0, Math.min(1, margin))) // menzil sinirina yakin: zor
  const hi = yc > 1.9 ? 1 - Math.min(0.5, yc - 1.9) : 1
  const near = shotDist < 6 ? 0.35 + (0.65 * Math.max(0, shotDist - 2)) / 4 : 1 // <=6 m: dusuk
  return Math.max(0, Math.min(0.97, keeperTune.gain * (0.62 + 0.38 * skill) * sp * mg * hi * near))
}

/** dalis fiziksel olarak mumkun mu: kaleciye yatay mesafe, temas yuksekligi, kalan sure (kararin kendisinden sonra) */
export function diveReachable(off: number, cy: number, tLeft: number): boolean {
  const need = Math.max(0, off - ARM)
  const tf = tLeft - PUSH_LEAD
  return need <= ROOT_MAX && cy <= MAX_HIGH && tf >= MIN_FLIGHT && need / Math.max(0.05, tf - 0.04) <= V_ROOT_MAX
}

/** dalis planla: top yolunu tahmin eder, ulasilabilir ilk noktayi temas secer, kinematik ve sonuc uretir */
export function planDive(inp: DiveIn): DiveSpec {
  const rnd = inp.rnd ?? Math.random
  const skill = inp.skill ?? 0.5
  const sgn = inp.goalX >= 0 ? 1 : -1
  const b = inp.ball
  Object.assign(sim, { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, wx: b.wx, wy: b.wy, wz: b.wz })
  const tl = inp.t0 + PUSH_LEAD
  const H = 1 / 120
  // aday: ilk ulasilabilir nokta; yoksa kale cizgisi kesisimi (kacirma)
  let hit: { t: number; p: V3; sp: number; need: number } | null = null
  let last: { t: number; p: V3; sp: number } | null = null
  let crossed: { t: number; p: V3; sp: number } | null = null
  for (let i = 1; i <= 240; i++) {
    freeStep(sim, H)
    const t = inp.t0 + i * H
    const sp = Math.hypot(sim.vx, sim.vy, sim.vz)
    last = { t, p: { x: sim.x, y: sim.y, z: sim.z }, sp }
    const dx = sim.x - inp.kx
    const dz = sim.z - inp.kz
    const d = Math.hypot(dx, dz)
    const tf = t - tl
    if (tf >= MIN_FLIGHT && sim.y <= MAX_HIGH && sim.y >= 0.08) {
      const need = Math.max(0, d - ARM) // kokun gitmesi gereken yatay mesafe
      const vmax = Math.min(V_ROOT_MAX, ROOT_MAX / Math.max(0.1, tf - 0.04))
      if (need <= ROOT_MAX && need / Math.max(0.05, tf - 0.04) <= V_ROOT_MAX + 1e-6 && need <= vmax * (tf - 0.04) + 1e-6) {
        hit = { t, p: { x: sim.x, y: sim.y, z: sim.z }, sp, need }
        break
      }
    }
    if (!crossed && sgn * sim.x >= Math.abs(inp.goalX)) crossed = { t, p: { x: sim.x, y: sim.y, z: sim.z }, sp }
    if (crossed && i > 0 && sgn * sim.x > Math.abs(inp.goalX) + 1.2) break
    if (sim.vx * sgn < 0.2 && sim.y <= 0.15 && Math.hypot(sim.vx, sim.vz) < 0.5) break // top durdu
  }
  // gelen top yoksa: komut hedefine uzanis (ayaklara atilma, serbest dalis)
  const bsp = Math.hypot(b.vx, b.vy, b.vz)
  const approaching = sgn * b.vx > 3 // top kaleye dogru geliyor
  if (inp.aim && !approaching) {
    const dxa = inp.aim.x - inp.kx
    const dza = inp.aim.z - inp.kz
    const da = Math.hypot(dxa, dza)
    const ta = 0.4
    const needA = Math.max(0, da - ARM)
    if (needA <= ROOT_MAX && inp.aim.y <= MAX_HIGH) hit = { t: tl + ta, p: { ...inp.aim }, sp: bsp, need: needA }
    else crossed = { t: tl + ta, p: { ...inp.aim }, sp: bsp }
  }
  const reach = !!hit
  const tgt = hit ?? crossed ?? last!
  const contactP = tgt.p
  const tc = tgt.t
  // yatay yon: temas noktasina
  let dx = contactP.x - inp.kx
  let dz = contactP.z - inp.kz
  let d = Math.hypot(dx, dz)
  if (d < 0.25) {
    // tam uzerinde: bakisa dik (kale cizgisi boyunca) en yakin yan
    const lx = Math.cos(inp.facing)
    const lz = -Math.sin(inp.facing)
    const s = dx * lx + dz * lz >= 0 ? 1 : -1
    dx = lx * s
    dz = lz * s
    d = 1
  }
  const dir = { x: dx / d, z: dz / d }
  const tau = Math.max(MIN_FLIGHT, tc - tl)
  // kokun yapacagi yatay yol: eller temas noktasinda olsun; menzil disinda yetebildigi kadar
  const need = Math.max(0, d - ARM)
  const dist = reach ? need : Math.min(ROOT_MAX, need, V_ROOT_MAX * Math.max(0.05, tau - 0.04))
  const vh = dist / Math.max(0.05, tau - 0.04)
  // elin gercek varacagi nokta
  const hand0: V3 = reach ? { ...contactP } : { x: inp.kx + dir.x * (dist + ARM), y: contactP.y, z: inp.kz + dir.z * (dist + ARM) }
  // dikey: temasta pelvis yuksekligi (eller pelvisten ~0.45 m yukarida, yatik govde)
  const yc = Math.max(PELVIS_LIE, Math.min(1.6, contactP.y - 0.45))
  const v0y = (yc - PELVIS_STAND + 0.5 * G * tau * tau) / tau
  // pelvis yer seviyesine inerse (PELVIS_LIE) inis zamani: y(t)=PELVIS_STAND+v0y*s-0.5*G*s^2 = PELVIS_LIE
  const disc = v0y * v0y + 2 * G * (PELVIS_STAND - PELVIS_LIE)
  const sLand = (v0y + Math.sqrt(disc)) / G
  const tLand = Math.max(tl + sLand, tl + MIN_FLIGHT + 0.05)
  const peak = PELVIS_STAND + (v0y > 0 ? (v0y * v0y) / (2 * G) : 0)
  const tStop = tLand + SLIDE_T
  const tUp = tStop + DOWN_T + GETUP_T
  // olasilik ve sonuc
  const margin = reach ? 1 - need / ROOT_MAX : 0
  const shotDist = inp.shotDist ?? Math.abs(inp.goalX - b.x)
  const p = reach ? saveProb(tgt.sp, margin, contactP.y, shotDist, skill) : 0
  let outcome: DiveOutcome = 'miss'
  if (reach && rnd() < p) outcome = tgt.sp <= 19 ? 'catch' : 'parry'
  // yumruk/carpma sonrasi top: sahaya ve yana, hizi korunur ~%35-45
  const field = -sgn
  const lat = dir.z !== 0 ? Math.sign(dir.z) : contactP.z >= inp.kz ? 1 : -1
  const spd = Math.max(4.5, Math.min(11, tgt.sp * (0.33 + 0.12 * rnd())))
  const parry: V3 = {
    x: field * spd * (0.45 + 0.2 * rnd()),
    y: contactP.y < 1.2 ? 1.5 + 2 * rnd() : 2.5 + 2 * rnd(),
    z: lat * spd * (0.55 + 0.25 * rnd()),
  }
  // kacirmada el nasil ve nerede kaciriyor: menzil disinda varis noktasi, menzil icinde 0.35-0.7 m geride/ustte
  let missP: V3 = hand0
  if (outcome === 'miss' && reach) {
    const g = 0.2 + 0.15 * rnd() // el topun yanindan gecer (parmak ucu kadar)
    const side = rnd() < 0.5 ? 1 : -1
    missP = { x: hand0.x, y: Math.max(0.12, hand0.y + side * g), z: hand0.z - dir.z * g * 0.6 }
  }
  const spec: DiveSpec = {
    id: inp.id,
    t0: inp.t0,
    tl,
    tc,
    tLand,
    tStop,
    tUp,
    dir,
    start: { x: inp.kx, z: inp.kz },
    contact: contactP,
    miss: outcome === 'miss' ? missP : { ...hand0 },
    dist,
    vh,
    peak,
    yc,
    v0y,
    side: dir.x * Math.cos(inp.facing) - dir.z * Math.sin(inp.facing) > 0 ? 'l' : 'r',
    high: contactP.y > 1.0,
    reach,
    outcome,
    parry,
    ballSpeed: tgt.sp,
    p,
  }
  specs.set(inp.id, spec)
  diveHook.fn?.(spec, inp)
  diveStats.n++
  if (reach) diveStats.reach++
  diveStats[outcome]++
  return spec
}

/** yatay yol (kok, dir yonunde) s(t) ve hiz: itis -> sabit hiz -> inisten sonra yavaslama */
function horiz(sp: DiveSpec, t: number): { s: number; v: number } {
  const ts = sp.tl
  if (t <= ts) return { s: 0, v: 0 }
  const tp = ts + PUSH_T
  const V = sp.vh
  if (t < tp) {
    const k = (t - ts) / PUSH_T
    return { s: 0.5 * V * PUSH_T * k * k, v: V * k }
  }
  const sPush = 0.5 * V * PUSH_T
  if (t < sp.tLand) return { s: sPush + V * (t - tp), v: V }
  const sLand = sPush + V * (sp.tLand - tp)
  const dt = Math.min(SLIDE_T, t - sp.tLand)
  // dogrusal yavaslama: V -> 0 SLIDE_T'de (yerde kayma)
  const s = sLand + V * dt - (0.5 * V * dt * dt) / SLIDE_T
  const v = t < sp.tStop ? V * (1 - dt / SLIDE_T) : 0
  return { s, v }
}

/** t aninda kok konumu/yuksekligi, el hedefi, faz */
export function diveState(sp: DiveSpec, t: number): DiveState {
  const h = horiz(sp, t)
  const x = sp.start.x + sp.dir.x * h.s
  const z = sp.start.z + sp.dir.z * h.s
  let y: number
  if (t <= sp.tl) y = PELVIS_STAND
  else if (t < sp.tLand) {
    const s = t - sp.tl
    y = Math.max(PELVIS_LIE, PELVIS_STAND + sp.v0y * s - 0.5 * G * s * s)
  } else y = PELVIS_LIE
  // el: kokten (on, 1.2 m yuksek) temas noktasina smoothstep, temastan sonra govdeye sabit
  const rest: V3 = { x: sp.start.x + sp.dir.x * 0.3, y: 1.25, z: sp.start.z + sp.dir.z * 0.3 }
  const tgt = sp.miss
  let hand: V3
  if (t <= sp.tl) hand = rest
  else if (t < sp.tc) {
    const k = smooth((t - sp.tl) / Math.max(0.05, sp.tc - sp.tl))
    hand = { x: rest.x + (tgt.x - rest.x) * k, y: rest.y + (tgt.y - rest.y) * k, z: rest.z + (tgt.z - rest.z) * k }
  } else {
    // temastan sonra el govdeyle birlikte kayar, yere dogru iner
    const hc = horiz(sp, sp.tc)
    const dx = h.s - hc.s
    const fall = smooth((t - sp.tLand) / 0.3)
    hand = {
      x: tgt.x + sp.dir.x * dx,
      y: Math.max(0.1, t > sp.tLand ? tgt.y + (0.12 - tgt.y) * fall : tgt.y),
      z: tgt.z + sp.dir.z * dx,
    }
  }
  let phase: DivePhase
  let u: number
  if (t < sp.t0) (phase = 'ready'), (u = 0)
  else if (t < sp.tl) (phase = 'push'), (u = (t - sp.t0) / (sp.tl - sp.t0))
  else if (t < sp.tLand) (phase = 'flight'), (u = (t - sp.tl) / (sp.tLand - sp.tl))
  else if (t < sp.tStop) (phase = 'slide'), (u = (t - sp.tLand) / SLIDE_T)
  else if (t < sp.tStop + DOWN_T) (phase = 'down'), (u = (t - sp.tStop) / DOWN_T)
  else (phase = 'getup'), (u = Math.min(1, (t - sp.tStop - DOWN_T) / GETUP_T))
  return { x, y, z, hand, phase, u, v: h.v }
}
