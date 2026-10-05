// Nisan cozucusu: verilen hiz buyuklugu, sut turu ve falsoyla topu kale duzlemindeki hedefe
// gonderen hiz/donme vektorunu bulur. Surukleme + Magnus serbest ucusla benzetilir, nisan noktasi
// hata kadar kaydirilir (birkac yineleme). Falso tam telafi edilir: nisan noktasi topun kivrilarak
// varacagi noktadir, falso cikis acisini disa acar ve yorunge yanal bir yay cizer.
import { BALL_R, PITCH_L, PITCH_W } from '../pitch'
import { G, freeStep, newBall } from '../sim/ball'
import { CURL_STEPS, V_MAX, V_MIN, type ShotType } from './store'

export type V3 = { x: number; y: number; z: number }
export interface Shot {
  v: V3
  w: V3
  reach: boolean // hiz hedefe yetiyor mu (yetmezse 45 derece, kisa duser)
  speed: number // cikis hizi (m/s); asirtmada cozulur
}

export const CURL_W = 48 // tam falsoda dusey donme (rad/s)
const CURL_COMP = 1 // cozucunun telafi ettigi falso payi (1: top nisan noktasina kivrilarak gelir)
const DT = 1 / 240
const ITER = 8

const sim = newBall()

/** Topu duzleme kadar ucurur; kesisim [y,z] ya da null. */
function hitPlane(sx: number, sz: number, v: V3, w: V3, side: number): [number, number] | null {
  Object.assign(sim, { x: sx, y: BALL_R, z: sz, vx: v.x, vy: v.y, vz: v.z, wx: w.x, wy: w.y, wz: w.z })
  const gx = PITCH_L / 2
  let lx = sim.x
  let ly = sim.y
  let lz = sim.z
  for (let t = 0; t < 4; t += DT) {
    freeStep(sim, DT)
    const d0 = side * lx - gx
    const d1 = side * sim.x - gx
    if (d1 >= 0) {
      const f = d0 < d1 ? -d0 / (d1 - d0) : 1
      return [ly + (sim.y - ly) * f, lz + (sim.z - lz) * f]
    }
    if (sim.vx * side <= 0.05) return null // durdu ya da geri dondu
    lx = sim.x
    ly = sim.y
    lz = sim.z
  }
  return null
}

function spinFor(type: ShotType, curl: number, ux: number, uz: number): V3 {
  // ileri donme ekseni (uz,0,-ux): Magnus asagi; ters donme yukari
  const top = type === 'yerden' ? 12 : type === 'asirtma' ? -18 : 4
  return { x: uz * top, y: (-curl / CURL_STEPS) * CURL_W, z: -ux * top }
}

/** sx,sz: top; ty,tz: kale duzleminde hedef; speed: m/s.
 *  Asirtmada guc aciyi belirler (zayif 60 derece, tam 40 derece), hiz hedefe gore cozulur. */
export function solveShot(
  sx: number,
  sz: number,
  side: number,
  ty: number,
  tz: number,
  speed: number,
  type: ShotType,
  curl: number,
): Shot {
  const gx = (side * PITCH_L) / 2
  const dx0 = gx - sx
  const dh0 = Math.hypot(dx0, tz - sz) || 1
  const w = spinFor(type, curl, dx0 / dh0, (tz - sz) / dh0)
  const wSim = { x: w.x, y: w.y * CURL_COMP, z: w.z }
  const lob = type === 'asirtma'
  const lobTh = ((60 - 20 * Math.min(1, Math.max(0, (speed - V_MIN) / (V_MAX - V_MIN)))) * Math.PI) / 180
  const g = -G
  let V = speed
  let ay = ty
  let az = tz
  let v: V3 = { x: 0, y: 0, z: 0 }
  let reach = true
  for (let it = 0; it < ITER; it++) {
    const dx = gx - sx
    const dz = az - sz
    const D = Math.hypot(dx, dz)
    const h = ay - BALL_R
    const disc = V ** 4 - g * (g * D * D + 2 * h * V * V)
    let th: number
    if (lob) {
      // sabit aci: yukseklige ulasan hiz (surtunmesiz), hata dongusu suruklemeyi telafi eder
      th = lobTh
      const c2 = Math.cos(th) ** 2
      V = Math.min(V_MAX, Math.sqrt((g * D * D) / (2 * c2 * Math.max(0.05, D * Math.tan(th) - h))))
    } else if (disc < 0) {
      th = Math.PI / 4
      reach = false
    } else {
      th = Math.atan((V * V - Math.sqrt(disc)) / (g * D))
      reach = true
    }
    const c = Math.cos(th)
    v = { x: (V * c * dx) / D, y: V * Math.sin(th), z: (V * c * dz) / D }
    if (!reach) break
    const hit = hitPlane(sx, sz, v, wSim, side)
    if (!hit) {
      // duzleme ulasamadi (surukleme): nisani yukari al
      ay += 0.5
      continue
    }
    const ey = ty - hit[0]
    const ez = tz - hit[1]
    if (Math.abs(ey) < 0.005 && Math.abs(ez) < 0.005) break
    ay = Math.min(ay + ey, 8)
    az += ez
  }
  return { v, w, reach, speed: V }
}

/** Gercek ucus (falso tam): kale duzlemine kadar yorunge noktalari, xyz duz dizi. */
export function predictPath(sx: number, sz: number, v: V3, w: V3, side: number, out: Float32Array): number {
  Object.assign(sim, { x: sx, y: BALL_R, z: sz, vx: v.x, vy: v.y, vz: v.z, wx: w.x, wy: w.y, wz: w.z })
  const gx = PITCH_L / 2
  const max = out.length / 3
  let n = 0
  const push = () => {
    out[n * 3] = sim.x
    out[n * 3 + 1] = sim.y
    out[n * 3 + 2] = sim.z
    n++
  }
  push()
  const sub = 4 // her noktada 4 adim
  for (let i = 0; n < max && i < 4 / (DT * sub); i++) {
    for (let k = 0; k < sub; k++) freeStep(sim, DT)
    push()
    if (side * sim.x - gx > 0.05) break
    if (Math.abs(sim.z) > PITCH_W / 2 + 2) break
    if (Math.hypot(sim.vx, sim.vz) < 0.3 && sim.y <= BALL_R + 1e-3) break
  }
  return n
}

/** test: gercek (tam falsolu) ucusun duzlem kesisimi */
export const planeHit = (sx: number, sz: number, s: Shot, side: number) => hitPlane(sx, sz, s.v, s.w, side)
