import { BALL_R, GOAL_H, GOAL_W, NET_D_BOTTOM, NET_D_TOP, PITCH_L, PITCH_W, PLATE_L, PLATE_W, POST_R, SPOT_DIST } from './pitch'
import {
  BALL_MASS,
  type BallState,
  G,
  airStep,
  contactImpulse,
  freeStep,
  groundContact,
  integrateSpin,
  newBall,
} from './sim/ball'
import { type GoalRange, type NetBuild, ROPE_R, buildGoalNet } from './sim/net'
import { type Collider, STATIC_COLLIDERS } from './env/colliders'

type V3 = [number, number, number]
type Vec = { x: number; y: number; z: number } | V3

export interface Capsule {
  a: V3
  b: V3
  r: number
  e: number // sekme katsayisi (direk sert, aga sarili celik iskelet yumusak)
}

/** hareketli kapsul (oyuncu/hakem): a-b eksen, r yaricap, v kapsulun hizi */
export interface DynCollider {
  a: V3
  b: V3
  r: number
  vx: number
  vy: number
  vz: number
  e: number
  mu: number
  tag: string
  id?: number | string
}

export type ShotKind = 'yerden' | 'vole' | 'falso' | 'asirtma' | 'direk'
export type SimEventType = 'gol' | 'direk' | 'ust-direk' | 'ag' | 'aut' | 'durdu' | 'kafes' | 'nesne' | 'oyuncu'
/** sim olayi. 'oyuncu' her temas basinda; digerleri vurus basina en fazla bir kez. */
export interface SimEvent {
  type: SimEventType
  speed?: number // temas/gecis anindaki hiz (m/s; temasta normal yonde goreli hiz)
  side?: 1 | -1 // ilgili kale/cizgi tarafi (x isareti)
  line?: 'yan' | 'kale' // aut: cikilan cizgi
  x?: number // olay konumu
  z?: number
  id?: number | string // 'oyuncu': kapsul kimligi
  tag?: string // carpilan nesnenin etiketi
}

// --- top adimi
const H_BALL = 1 / 600 // topun en buyuk alt adimi
const BALL_CLEAR = 0.03 // top bir alt adimda en fazla bu kadar yol alir
// --- ag adimi (gorsel kumas)
const H_NET = 1 / 240 // top kale yakinindayken agin alt adimi
const NET_CLEAR = 0.07 // ag adimi basina top yolu (RC'den kucuk: dugum topun arkasina dusmez)
const MAX_SUB = 48
const HOT_TIME = 3 // top kaleden ayrildiktan sonra agin ince adimla salinma suresi (s)
const SLEEP_V = 0.3 // bu hizin altinda ve top uzaktaysa ag uyur (m/s)
const SLEEP_T = 1.5
const NODE_MASS = 0.0015 // ~2.3 kg ag / ~1550 dugum
const SOFT_FRAC = 0.25 // kivrim/kesme baglarinin zayifligi
const NET_DRAG = 1.6 // agin hava sonumu (1/s)
const NODE_GROUND_KEEP = 0.35 // zemindeki dugumun teğetsel hareketinden kalan pay (surtunme)
const RETURN_SPEED = 3 // asiri gerilmis agin geri toplanma hizi (m/s)
// --- topun gordugu ag: cozumsel torba. Bol ag topu viskoz yavaslatir (agin kutlesi + ilmek
// surtunmesi), zayif yay geri toplar, geri tepme guclu sonumlu. Kenarlara dogru sertlesir.
const NET_C_IN = 10 // aga dogru hareketteki sonum (N s/m): derinlik ~ m v / c
const NET_K0 = 90 // geri toplayan zayif yay (N/m)
const NET_C_OUT = 220 // geri tepmede sonum (N s/m)
const NET_K_HARD = 1500 // torba bitince (agin tam gerildigi yer) sertlesen yay
const DYN_MU_MAX = 0.18 // oyuncu kapsulu temasinda surtunme ustu
const DYN_SIDE_VY = 2 // yerdeki topun govde yan yuzunden en fazla yukselme hizi (m/s)
const DEPTH_BACK = 1.05 // panel ortasinda en fazla torba (m)
const DEPTH_TOP = 0.45
const DEPTH_SIDE = 0.6
const NET_TAN = 3 // ag uzerinde kayma surtunmesi (1/s)
const NET_SPIN = 6
const POST_E = 0.62
const POST_MU = 0.3
const BAR_E = 0.15
const RC = BALL_R + ROPE_R

export function goalPoint(side: number, d: number, y: number, w: number): V3 {
  return [side * (PITCH_L / 2 + d), y, w]
}

const vx3 = (v: Vec): V3 => (Array.isArray(v) ? (v as V3) : [(v as { x: number }).x, (v as { y: number }).y, (v as { z: number }).z])

/**
 * Yorunge onizlemesi (saf; dunyaya dokunmaz): yalniz hava direnci + Magnus (+ istege bagli zemin).
 * Donus: steps*3 uzunlugunda Float32Array, her adimdan SONRAKI konum (x,y,z).
 */
export function predictTrajectory(start: Vec, v: Vec, w: Vec, steps: number, dt: number, ground = false): Float32Array {
  const s = vx3(start)
  const vv = vx3(v)
  const ww = vx3(w)
  const b = newBall()
  Object.assign(b, { x: s[0], y: s[1], z: s[2], vx: vv[0], vy: vv[1], vz: vv[2], wx: ww[0], wy: ww[1], wz: ww[2] })
  const out = new Float32Array(Math.max(0, steps) * 3)
  const n = Math.max(1, Math.ceil(dt / H_BALL - 1e-6))
  const h = dt / n
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < n; k++) {
      if (ground) freeStep(b, h)
      else {
        airStep(b, h)
        b.x += b.vx * h
        b.y += b.vy * h
        b.z += b.vz * h
      }
    }
    out[i * 3] = b.x
    out[i * 3 + 1] = b.y
    out[i * 3 + 2] = b.z
  }
  return out
}

// tekrar uretilebilir rastgelelik (test icin tohumlanabilir)
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ag kenar etkeni: cercevede 0, panel ortasinda 1
const bagShape = (u: number) => (u <= 0 || u >= 1 ? 0 : Math.pow(Math.sin(Math.PI * u), 0.6))

// statik carpisma icin on hesap (kaba kutu)
type StaticC = Collider & { lo: V3; hi: V3 }

export class World {
  side: 1 | -1 = 1
  timeScale = 1
  time = 0
  goals = 0
  shots = 0
  lastShot: ShotKind = 'yerden'
  private scored = false
  private listeners = new Set<() => void>()
  private evListeners = new Set<(e: SimEvent) => void>()
  private fired = new Set<SimEventType>()
  private live = false // top vurusla hareket ediyor
  private held = false // kalecinin elinde (fizik disi)
  private still = 0
  private rand = mulberry32((Math.random() * 2 ** 32) >>> 0)

  // ag parcaciklari (iki kale birlikte)
  n: number
  pos: Float32Array
  prev: Float32Array
  vel: Float32Array
  invMass: Float32Array
  private rest: Float32Array
  private ropeA: Uint32Array
  private ropeB: Uint32Array
  private ropeR: Float32Array
  private softA: Uint32Array
  private softB: Uint32Array
  private softR: Float32Array
  private tethN: Uint32Array
  private tethA: Uint32Array
  private tethL: Float32Array
  private nrm: Float32Array // dinlenme dis normalleri
  // ruzgar: sin(a+b) = sin a cos b + cos a sin b; uzamsal kisim sabit
  private wSx: Float32Array
  private wCx: Float32Array
  private wSz: Float32Array
  private wCz: Float32Array
  // dugum -> komsu kenarlar (renderEdges indeksleri), temas adaylari icin
  private adjStart: Uint32Array
  private adjEdge: Uint32Array
  private touch: Int32Array // dugumun topa son degdigi ag adimi
  private candMark: Int32Array
  private cand: Uint32Array
  private nCand = 0
  private netId = 1
  private hot = [0, 0] // kale agi ince adimla cozulecek kalan sure
  private calm = [0, 0] // agin dingin gecen suresi (uyku)
  private maxV = 0
  // top - ag yuzu tarafi (her kale icin 4 yuz): +1 kale icinde, -1 disinda
  private faceSide = [new Int8Array(4).fill(-1), new Int8Array(4).fill(-1)]
  goalRanges: GoalRange[] = []
  // cizim icin tum ip parcalari (pos indeks ciftleri)
  renderEdges: Uint32Array
  capsules: Capsule[] = []
  /** cevre carpisma geometrisi (D: env/colliders.ts) */
  staticColliders: StaticC[]
  /** oyuncu/hakem kapsulleri; her kare setDynamicColliders ile guncellenir */
  dynamicColliders: DynCollider[] = []
  private dynT = 0 // kare icinde gecen sure (kapsul konumu = a + v*dynT)
  private dynTouch = new Set<number | string>()
  private dynTouchNow = new Set<number | string>()

  ball: BallState = newBall()
  /** son alt adimda top aga yaslaniyor mu (gorsel/ses icin) */
  netContact = false
  // carpisma kayitlari (alt adim icinde)
  private hitN = new Float32Array(3 * 16)
  private hitV = new Float32Array(3 * 16)
  private hitE = new Float32Array(16)
  private hitMu = new Float32Array(16)
  private hitDyn = new Uint8Array(16)
  private nHits = 0

  constructor() {
    const B: NetBuild = {
      pos: [], inv: [], ropeA: [], ropeB: [], ropeR: [], softA: [], softB: [], softR: [],
      render: [], tethA: [], tethN: [], tethL: [], nrm: [],
    }
    const hw = GOAL_W / 2
    const H = GOAL_H
    const Db = NET_D_BOTTOM
    const Dt = NET_D_TOP
    for (const s of [1, -1] as const) {
      this.goalRanges.push(buildGoalNet(B, s, NODE_MASS))
      const p = (d: number, y: number, w: number) => goalPoint(s, d, y, w)
      const bar = 0.025
      const E = POST_E
      const e = BAR_E
      this.capsules.push(
        { a: p(0, 0, -hw), b: p(0, H, -hw), r: POST_R, e: E },
        { a: p(0, 0, hw), b: p(0, H, hw), r: POST_R, e: E },
        { a: p(0, H, -hw), b: p(0, H, hw), r: POST_R, e: E },
        // celik arka iskelet (ag ustunden sarili: sonumlu)
        { a: p(0, H, -hw), b: p(Dt, H, -hw), r: bar, e },
        { a: p(0, H, hw), b: p(Dt, H, hw), r: bar, e },
        { a: p(Dt, H, -hw), b: p(Db, 0, -hw), r: bar, e },
        { a: p(Dt, H, hw), b: p(Db, 0, hw), r: bar, e },
        { a: p(0, 0, -hw), b: p(Db, 0, -hw), r: bar, e },
        { a: p(0, 0, hw), b: p(Db, 0, hw), r: bar, e },
        { a: p(Dt, H, -hw), b: p(Dt, H, hw), r: bar, e },
        { a: p(Db, 0, -hw), b: p(Db, 0, hw), r: bar, e },
      )
    }
    this.staticColliders = STATIC_COLLIDERS.map((c) => {
      const lo: V3 = [0, 0, 0]
      const hi: V3 = [0, 0, 0]
      if (c.kind === 'capsule') {
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(c.a[k], c.b[k]) - c.r
          hi[k] = Math.max(c.a[k], c.b[k]) + c.r
        }
      } else if (c.kind === 'box') {
        const ex = Math.abs(Math.cos(c.yaw)) * c.h[0] + Math.abs(Math.sin(c.yaw)) * c.h[2]
        const ez = Math.abs(Math.sin(c.yaw)) * c.h[0] + Math.abs(Math.cos(c.yaw)) * c.h[2]
        const ext: V3 = [ex, c.h[1], ez]
        for (let k = 0; k < 3; k++) {
          lo[k] = c.c[k] - ext[k]
          hi[k] = c.c[k] + ext[k]
        }
      } else {
        const v: V3 = [
          c.n[1] * c.u[2] - c.n[2] * c.u[1],
          c.n[2] * c.u[0] - c.n[0] * c.u[2],
          c.n[0] * c.u[1] - c.n[1] * c.u[0],
        ]
        for (let k = 0; k < 3; k++) {
          const ext = Math.abs(c.u[k]) * c.hu + Math.abs(v[k]) * c.hv
          lo[k] = c.c[k] - ext
          hi[k] = c.c[k] + ext
        }
      }
      for (let k = 0; k < 3; k++) {
        lo[k] -= BALL_R + 0.05
        hi[k] += BALL_R + 0.05
      }
      return { ...c, lo, hi }
    })

    this.n = B.pos.length / 3
    this.pos = new Float32Array(B.pos)
    this.rest = this.pos.slice()
    this.prev = this.pos.slice()
    this.vel = new Float32Array(B.pos.length)
    this.invMass = Float32Array.from(B.inv)
    this.ropeA = Uint32Array.from(B.ropeA)
    this.ropeB = Uint32Array.from(B.ropeB)
    this.ropeR = Float32Array.from(B.ropeR)
    this.softA = Uint32Array.from(B.softA)
    this.softB = Uint32Array.from(B.softB)
    this.softR = Float32Array.from(B.softR)
    this.tethN = Uint32Array.from(B.tethN)
    this.tethA = Uint32Array.from(B.tethA)
    this.tethL = Float32Array.from(B.tethL)
    this.nrm = Float32Array.from(B.nrm)
    this.renderEdges = Uint32Array.from(B.render)

    this.wSx = new Float32Array(this.n)
    this.wCx = new Float32Array(this.n)
    this.wSz = new Float32Array(this.n)
    this.wCz = new Float32Array(this.n)
    for (let i = 0; i < this.n; i++) {
      const k = i * 3
      const ax = this.pos[k + 2] * 0.6 + this.pos[k + 1] * 0.4
      const az = this.pos[k] * 0.5
      this.wSx[i] = Math.sin(ax)
      this.wCx[i] = Math.cos(ax)
      this.wSz[i] = Math.sin(az)
      this.wCz[i] = Math.cos(az)
    }

    const ne = this.renderEdges.length / 2
    const deg = new Uint32Array(this.n + 1)
    for (let e = 0; e < ne; e++) {
      deg[this.renderEdges[2 * e]]++
      deg[this.renderEdges[2 * e + 1]]++
    }
    this.adjStart = new Uint32Array(this.n + 1)
    for (let i = 0; i < this.n; i++) this.adjStart[i + 1] = this.adjStart[i] + deg[i]
    this.adjEdge = new Uint32Array(this.adjStart[this.n])
    const fill = this.adjStart.slice(0, this.n)
    for (let e = 0; e < ne; e++) {
      this.adjEdge[fill[this.renderEdges[2 * e]]++] = e
      this.adjEdge[fill[this.renderEdges[2 * e + 1]]++] = e
    }
    this.touch = new Int32Array(this.n).fill(-10)
    this.candMark = new Int32Array(ne).fill(-1)
    this.cand = new Uint32Array(ne)

    // agi kendi agirligiyla oturt
    for (let i = 0; i < 240; i++) {
      for (const g of this.goalRanges) this.netSubstep(g, 1 / 120, false)
    }
    this.resetBall()
  }

  /** test icin: rastgeleligi tohumla */
  seed(s: number) {
    this.rand = mulberry32(s)
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.listeners.forEach((f) => f())
  }

  /** olay akisi: {type, speed?, side?, line?, x?, z?, id?, tag?} */
  onEvent(fn: (e: SimEvent) => void): () => void {
    this.evListeners.add(fn)
    return () => this.evListeners.delete(fn)
  }

  private fire(e: SimEvent) {
    if (e.type !== 'oyuncu') {
      if (this.fired.has(e.type)) return
      this.fired.add(e.type)
    }
    this.evListeners.forEach((f) => f(e))
  }

  /** topu zemine koy: hiz/spin sifir, saha plakasina kisitli; gol/olay bayraklari sifirlanir */
  placeBall(x: number, z: number) {
    const b = this.ball
    const lx = PLATE_L / 2 - BALL_R
    const lz = PLATE_W / 2 - BALL_R
    b.x = b.px = Math.min(lx, Math.max(-lx, x))
    b.y = b.py = BALL_R
    b.z = b.pz = Math.min(lz, Math.max(-lz, z))
    b.vx = b.vy = b.vz = 0
    b.wx = b.wy = b.wz = 0
    this.scored = false
    this.live = false
    this.held = false
    this.fired.clear()
    this.syncFaces()
  }

  /** vurus: konum degismez; dogrusal hiz v (m/s) ve acisal hiz w (rad/s), dunya ekseninde */
  kick(v: Vec, w: Vec) {
    const b = this.ball
    const vv = vx3(v)
    const ww = vx3(w)
    b.px = b.x
    b.py = b.y
    b.pz = b.z
    b.vx = vv[0]
    b.vy = vv[1]
    b.vz = vv[2]
    b.wx = ww[0]
    b.wy = ww[1]
    b.wz = ww[2]
    if (b.y < BALL_R) b.y = b.py = BALL_R
    this.held = false
    this.scored = false
    this.fired.clear()
    this.live = true
    this.syncFaces()
    this.shots++
    this.emit()
  }

  /** kaleci tutusu: on=true top elde (fizik disi), verilen konuma tasinir; birakinca kick() */
  holdBall(on: boolean, x?: number, y?: number, z?: number) {
    const b = this.ball
    this.held = on
    if (!on) return
    if (x !== undefined) b.x = b.px = x
    if (y !== undefined) b.y = b.py = Math.max(BALL_R, y)
    if (z !== undefined) b.z = b.pz = z
    b.vx = b.vy = b.vz = 0
    b.wx = b.wy = b.wz = 0
    this.live = false
    this.syncFaces()
  }

  /** oyuncu/hakem kapsulleri (her kare). Kapsul alt adimlarda kendi hiziyla ilerletilir. */
  setDynamicColliders(list: DynCollider[]) {
    this.dynamicColliders = list
    this.dynT = 0
  }

  /** yorunge onizlemesi (bkz. predictTrajectory) */
  predictTrajectory(start: Vec, v: Vec, w: Vec, steps: number, dt: number, ground = false) {
    return predictTrajectory(start, v, w, steps, dt, ground)
  }

  resetBall() {
    const b = this.ball
    b.x = b.px = this.side * (PITCH_L / 2 - SPOT_DIST)
    b.y = b.py = BALL_R
    b.z = b.pz = 0
    b.vx = b.vy = b.vz = 0
    b.wx = b.wy = b.wz = 0
    this.scored = false
    this.live = false
    this.held = false
    this.syncFaces()
  }

  /** Cesitli sut: yerden sert, yarim vole, falsolu kose, asirtma; bazen direge. */
  shoot(kind?: ShotKind) {
    this.resetBall()
    const r = this.rand
    const U = (a: number, c: number) => a + (c - a) * r()
    const kinds: ShotKind[] = ['yerden', 'vole', 'falso', 'falso', 'asirtma']
    let k: ShotKind = kind ?? kinds[Math.floor(r() * kinds.length)]
    const post = kind === 'direk' || (kind === undefined && r() < 0.1)
    if (k === 'direk') k = (['yerden', 'vole', 'falso'] as const)[Math.floor(r() * 3)]
    this.lastShot = post ? 'direk' : k

    const s = this.side
    const hw = GOAL_W / 2
    const dist = k === 'falso' ? U(10, 17) : k === 'asirtma' ? U(10, 16) : U(7, 14)
    const lat = k === 'falso' ? (r() < 0.5 ? -1 : 1) * U(1.5, 7) : U(-4, 4)
    const b = this.ball
    b.x = b.px = s * (PITCH_L / 2 - dist)
    b.z = b.pz = lat

    // hedef (kale cizgisi duzleminde top merkezi)
    let tz: number
    let ty: number
    if (k === 'yerden') ty = U(0.13, 0.4)
    else if (k === 'vole') ty = U(0.35, 1.75)
    else if (k === 'falso') ty = U(0.5, 1.75)
    else ty = U(1.15, 1.8)
    if (k === 'falso') tz = (lat > 0 ? -1 : 1) * U(hw - 0.75, hw - 0.3)
    else tz = U(-(hw - 0.3), hw - 0.3)
    if (post) {
      if (r() < 0.7) tz = (r() < 0.5 ? -1 : 1) * (hw + U(-0.17, 0.07))
      else ty = GOAL_H + U(-0.16, 0.05)
    }

    const dx = (s * PITCH_L) / 2 - b.x
    const dh = Math.hypot(dx, tz - b.z)
    const speed = k === 'yerden' ? U(23, 31) : k === 'vole' ? U(24, 32) : k === 'falso' ? U(20, 26) : 0
    const T = k === 'asirtma' ? U(1.15, 1.5) : dh / speed
    // donme
    const ux = dx / dh
    const uz = (tz - b.z) / dh
    let wx = 0
    let wy = 0
    let wz = 0
    if (k === 'yerden') {
      const top = U(6, 14) // ileri donme
      wx = uz * top
      wz = -ux * top
    } else if (k === 'vole') {
      wx = U(-4, 4)
      wy = U(-4, 4)
      wz = U(-4, 4)
    } else if (k === 'falso') {
      // kaleye dogru kivrilsin: yanal ivme isareti -sign(tz)
      wy = Math.sign(tz) * s * U(32, 52)
      const top = U(4, 10)
      wx = uz * top
      wz = -ux * top
    } else {
      const backs = U(14, 26) // asirtmada geri donme
      wx = -uz * backs
      wz = ux * backs
    }

    // nisan: surukleme + Magnus ile ucusu benzetip hedefe oturana dek nisan noktasini kaydir
    let ay = ty
    let az = tz
    const sim = newBall()
    for (let it = 0; it < 10; it++) {
      const vx = dx / T
      const vz = (az - b.z) / T
      const vy = (ay - BALL_R - 0.5 * G * T * T) / T
      Object.assign(sim, { x: b.x, y: BALL_R, z: b.z, vx, vy, vz, wx, wy, wz })
      let hit: [number, number] | null = null
      let lx = sim.x
      let ly = sim.y
      let lz = sim.z
      for (let t = 0; t < 4; t += 1 / 240) {
        freeStep(sim, 1 / 240)
        const d0 = s * lx - PITCH_L / 2
        const d1 = s * sim.x - PITCH_L / 2
        if (d1 >= 0) {
          const f = d0 < d1 ? -d0 / (d1 - d0) : 1
          hit = [ly + (sim.y - ly) * f, lz + (sim.z - lz) * f]
          break
        }
        lx = sim.x
        ly = sim.y
        lz = sim.z
      }
      if (!hit) break
      const ey = ty - hit[0]
      const ez = tz - hit[1]
      if (k !== 'yerden') ay += ey
      az += ez
      if (Math.abs(ey) < 0.01 && Math.abs(ez) < 0.01) break
    }
    this.kick({ x: dx / T, y: (ay - BALL_R - 0.5 * G * T * T) / T, z: (az - b.z) / T }, { x: wx, y: wy, z: wz })
  }

  step(frameDt: number) {
    const dt = Math.min(frameDt, 1 / 30) * this.timeScale
    if (dt <= 0) return
    const b = this.ball
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz)
    let anyHot = false
    for (let gi = 0; gi < 2; gi++) {
      if (this.nearGoal(this.goalRanges[gi], 3)) {
        this.hot[gi] = HOT_TIME
        this.calm[gi] = 0
      }
      if (this.hot[gi] > 0) anyHot = true
    }
    // ag adimlari; her ag adiminda k top adimi
    const nNet = anyHot ? Math.min(MAX_SUB, Math.max(Math.ceil(dt / H_NET - 1e-6), Math.ceil((sp * dt) / NET_CLEAR))) : 1
    const nBall = this.held ? 0 : Math.min(MAX_SUB * 2, Math.max(Math.ceil(dt / H_BALL - 1e-6), Math.ceil((sp * dt) / BALL_CLEAR)))
    const k = Math.ceil(nBall / nNet)
    const hb = k > 0 ? dt / (nNet * k) : 0
    this.dynT = 0
    for (let j = 0; j < nNet; j++) {
      for (let i = 0; i < k; i++) this.ballSubstep(hb)
      if (this.held) this.time += dt / nNet
      for (let gi = 0; gi < 2; gi++) if (this.hot[gi] > 0) this.netSubstep(this.goalRanges[gi], dt / nNet, true)
    }
    for (let gi = 0; gi < 2; gi++) {
      if (this.hot[gi] > 0) {
        this.hot[gi] = Math.max(0, this.hot[gi] - dt)
        continue
      }
      // top uzakta: ag kare basina tek kaba adimla salinir; dinginlesince uyur
      if (this.calm[gi] > SLEEP_T) continue
      this.netSubstep(this.goalRanges[gi], dt, false)
      this.calm[gi] = this.maxV < SLEEP_V ? this.calm[gi] + dt : 0
    }
  }

  private nearGoal(g: GoalRange, m: number) {
    const b = this.ball
    const d = g.side * b.x - PITCH_L / 2
    return d > -m && d < NET_D_BOTTOM + m && Math.abs(b.z) < GOAL_W / 2 + m && b.y < GOAL_H + m
  }

  // ---------------------------------------------------------------- top
  private addHit(nx: number, ny: number, nz: number, e: number, mu: number, sx = 0, sy = 0, sz = 0, dyn = false) {
    if (this.nHits >= 16) return
    const k = this.nHits * 3
    this.hitN[k] = nx
    this.hitN[k + 1] = ny
    this.hitN[k + 2] = nz
    this.hitV[k] = sx
    this.hitV[k + 1] = sy
    this.hitV[k + 2] = sz
    this.hitE[this.nHits] = e
    this.hitMu[this.nHits] = mu
    this.hitDyn[this.nHits] = dyn ? 1 : 0
    this.nHits++
  }

  private ballSubstep(h: number) {
    this.time += h
    this.dynT += h
    const b = this.ball
    airStep(b, h)
    const s = b.x >= 0 ? 1 : -1 // topa yakin kale
    this.netContact = this.bagForce(s, h)
    if (this.netContact && this.live) this.fire({ type: 'ag', speed: Math.hypot(b.vx, b.vy, b.vz), side: s })
    const v0x = b.vx
    const v0y = b.vy
    const v0z = b.vz
    b.px = b.x
    b.py = b.y
    b.pz = b.z
    b.x += b.vx * h
    b.y += b.vy * h
    b.z += b.vz * h

    // direk/iskelet, cevre, oyuncular: konumdan cikar, hizdan durtuyle sek (spin dahil)
    this.nHits = 0
    this.solveCapsules()
    if (Math.abs(b.x) > PLATE_L / 2 - 0.5 || Math.abs(b.z) > PLATE_W / 2 - 0.5) this.solveStatic()
    if (this.dynamicColliders.length) this.solveDynamic()
    if (this.nHits > 0) {
      b.vx = v0x
      b.vy = v0y
      b.vz = v0z
      for (let q = 0; q < this.nHits; q++) {
        const k = q * 3
        const sx = this.hitV[k]
        const sy = this.hitV[k + 1]
        const sz = this.hitV[k + 2]
        // hareketli yuzey: goreli hizda coz
        b.vx -= sx
        b.vy -= sy
        b.vz -= sz
        contactImpulse(b, this.hitN[k], this.hitN[k + 1], this.hitN[k + 2], this.hitE[q], this.hitMu[q])
        // yerdeki top oyuncu govdesinin yan yuzune carpinca cok sicramaz (spin+surtunme firlatmasin)
        if (this.hitDyn[q] && Math.abs(this.hitN[k + 1]) < 0.7 && b.y < 0.6 && b.vy > DYN_SIDE_VY) b.vy = Math.max(DYN_SIDE_VY, v0y - sy)
        b.vx += sx
        b.vy += sy
        b.vz += sz
      }
    }
    if (b.y <= BALL_R) {
      b.y = BALL_R
      // torbadaki top yere carpinca ag onu tutar: sekmez
      groundContact(b, b.vy, h, this.netContact ? 0.1 : undefined)
    }
    integrateSpin(b, h)

    if (!Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz + b.wx + b.wy + b.wz)) {
      this.resetBall()
      return
    }

    // gol: top tamamen cizgiyi direkler arasindan ve ust direk altindan gecti
    const d0 = s * b.px - PITCH_L / 2
    const d1 = s * b.x - PITCH_L / 2
    if (!this.scored && d0 < BALL_R && d1 >= BALL_R) {
      const f = (BALL_R - d0) / (d1 - d0)
      const z = b.pz + (b.z - b.pz) * f
      const y = b.py + (b.y - b.py) * f
      if (Math.abs(z) < GOAL_W / 2 && y < GOAL_H) {
        this.scored = true
        this.goals++
        if (this.live) this.fire({ type: 'gol', side: s, speed: Math.hypot(b.vx, b.vy, b.vz), x: b.x, z })
        this.emit()
      } else if (this.live) this.fire({ type: 'aut', line: 'kale', side: s, x: b.x, z })
    }
    // aut: yan cizgi
    const lz = PITCH_W / 2 + BALL_R
    if (this.live && Math.abs(b.pz) <= lz && Math.abs(b.z) > lz) {
      this.fire({ type: 'aut', line: 'yan', side: b.z > 0 ? 1 : -1, x: b.x, z: b.z })
    }
    // durdu: 0.4 s boyunca neredeyse hareketsiz (yerde ya da agda yaslanmis)
    this.still = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz < 0.01 ? this.still + h : 0
    if (this.live && this.still > 0.4) {
      this.live = false
      this.fire({ type: 'durdu', x: b.x, z: b.z, speed: 0 })
    }
  }

  // Top hangi yuzun hangi yaninda: uzaktayken guncellenir, temas bandinda kilitli kalir.
  private syncFaces() {
    for (let gi = 0; gi < 2; gi++) {
      const s = gi === 0 ? 1 : -1
      for (let f = 0; f < 4; f++) {
        const q = this.faceQuery(s, f)
        this.faceSide[gi][f] = q.sd < 0 ? 1 : -1
      }
    }
  }

  // yuz sorgusu (kale yerel: d derinlik, y, w=z). sd: dis normal yonunde isaretli uzaklik.
  // g: kenar etkeni (cercevede 0, ortada 1), max: o noktada agin verebilecegi en fazla torba
  private fq = { sd: 0, nd: 0, ny: 0, nw: 0, inside: false, g: 0, gd: 0, max: 0 }
  private faceQuery(s: number, f: number) {
    const b = this.ball
    const d = s * b.x - PITCH_L / 2
    const y = b.y
    const w = b.z
    const hw = GOAL_W / 2
    const H = GOAL_H
    const Db = NET_D_BOTTOM
    const Dt = NET_D_TOP
    const q = this.fq
    const m = BALL_R * 0.5 // bolge payi
    // kose kapatma: top kalenin icindeyse komsu yuzun torbasi kadar bolge genisler (orada ag
    // gergin, g=0); disaridaysa dar kalir ki kalenin yanindan gecen top hayali duvara takilmasin
    const fs = this.faceSide[s === 1 ? 0 : 1]
    const X = 0.6
    const eL = fs[2] === 1 ? X : m
    const eR = fs[3] === 1 ? X : m
    if (f === 0) {
      // arka: (Db,0) -> (Dt,H) egik duzlem
      const l = Math.hypot(H, Db - Dt)
      q.nd = H / l
      q.ny = (Db - Dt) / l
      q.nw = 0
      q.sd = (d - Db) * q.nd + y * q.ny
      const v = ((d - Db) * (Dt - Db) + y * H) / (l * l) // egim boyunca 0..1
      const u = (w + hw) / GOAL_W
      q.inside = v > -0.05 && v < 1 + (fs[1] === 1 ? X : m) / H && u > -eL / GOAL_W && u < 1 + eR / GOAL_W
      // alt kenar zemin borusuna kelepceli: yerdeki top borunun gerisine gecemez
      const gv = bagShape(v)
      q.g = bagShape(u) * Math.sqrt(gv)
      q.gd = bagShape(u) // sonum: alt kenara yakin da torba derinlesebilir
      q.max = DEPTH_BACK
    } else if (f === 1) {
      // ust: y = H, 0 <= d <= Dt
      q.nd = 0
      q.ny = 1
      q.nw = 0
      q.sd = y - H
      const u = (w + hw) / GOAL_W
      const v = d / Dt
      q.inside = v > -0.02 && v < 1 + (fs[0] === 1 ? X : m) / Dt && u > -eL / GOAL_W && u < 1 + eR / GOAL_W
      q.g = bagShape(u) * bagShape(v)
      q.gd = q.g
      q.max = DEPTH_TOP
    } else {
      // yanlar: w = -+hw, 0 <= d <= egik kenar
      const sg = f === 2 ? -1 : 1
      q.nd = 0
      q.ny = 0
      q.nw = sg
      q.sd = sg * w - hw
      const ds = Db - ((Db - Dt) * Math.min(Math.max(y, 0), H)) / H
      const u = d / ds
      const v = y / H
      q.inside = u > -0.02 && u < 1 + (fs[0] === 1 ? X : m) / ds && v > -0.1 && v < 1 + (fs[1] === 1 ? X : m) / H
      const gv = bagShape(v)
      q.g = bagShape(u) * Math.sqrt(gv)
      q.gd = bagShape(u) // sonum: alt kenara yakin da torba derinlesebilir
      q.max = DEPTH_SIDE
    }
    return q
  }

  // Cozumsel torba: aga giren top viskoz yavaslar (derinlik ~ m v / c, yani hizla orantili),
  // zayif yay topu geri toplar, geri tepme guclu sonumlu (etkin sekme ~0.1). Torba sinirinda sert yay.
  // Kenara yakin yerde ag gergindir: sonum ve yay sertlesir, en fazla torba kuculur.
  // Top agdan asla gecemez. Yuz tarafi uzaktayken guncellenir, temas bandinda kilitlidir.
  private bagForce(s: number, h: number): boolean {
    const b = this.ball
    const gi = s === 1 ? 0 : 1
    const sides = this.faceSide[gi]
    let touching = false
    for (let f = 0; f < 4; f++) {
      const q = this.faceQuery(s, f)
      if (!q.inside || Math.abs(q.sd) > BALL_R + q.max + 0.25) {
        sides[f] = q.sd < 0 ? 1 : -1
        continue
      }
      const sg = sides[f] // +1: top kale icinde, ag disari torbalanir
      const depth = sg * q.sd + BALL_R // top yuzeyinin dinlenme duzlemini astigi miktar
      if (depth <= 0) continue
      touching = true
      // itme yonu (topu geri iten) yerel -> dunya
      // arka ag ust borudan asili: geri itme yatay (topu asagi bastirmaz, yukari firlatmaz)
      const px = -sg * (f === 0 ? 1 : q.nd) * s
      const py = f === 0 ? 0 : -sg * q.ny
      const pz = -sg * q.nw
      const vn = -(b.vx * px + b.vy * py + b.vz * pz) // aga dogru hiz
      const gE = 0.12 + 0.88 * q.gd // kenarda gergin
      const lim = q.max * q.g + 0.04
      let F = NET_K0 * depth
      if (depth > lim) F += NET_K_HARD * (depth - lim)
      const c = vn > 0 ? NET_C_IN / gE : NET_C_OUT / Math.sqrt(0.12 + 0.88 * q.g)
      const a = (F / BALL_MASS) * h
      b.vx += a * px
      b.vy += a * py
      b.vz += a * pz
      // normal sonum (ustel: kararli)
      const vn1 = -(b.vx * px + b.vy * py + b.vz * pz)
      const dv = vn1 * (1 - Math.exp((-c / BALL_MASS) * h))
      b.vx += dv * px
      b.vy += dv * py
      b.vz += dv * pz
      // ag uzerinde kayma ve donme surtunmesi
      const vn2 = b.vx * px + b.vy * py + b.vz * pz
      const ft = Math.exp(-NET_TAN * h)
      b.vx = vn2 * px + (b.vx - vn2 * px) * ft
      b.vy = vn2 * py + (b.vy - vn2 * py) * ft
      b.vz = vn2 * pz + (b.vz - vn2 * pz) * ft
      const fw = Math.exp(-NET_SPIN * h)
      b.wx *= fw
      b.wy *= fw
      b.wz *= fw
    }
    return touching
  }

  // kure - kapsul (konum duzeltmesi); donus: normal ve derinlik this.cq'da
  private cq = { nx: 0, ny: 0, nz: 0, pen: 0 }
  private sphereCapsule(a: V3, bb: V3, r: number): boolean {
    const b = this.ball
    const abx = bb[0] - a[0]
    const aby = bb[1] - a[1]
    const abz = bb[2] - a[2]
    const l2 = abx * abx + aby * aby + abz * abz
    let u = l2 > 1e-12 ? ((b.x - a[0]) * abx + (b.y - a[1]) * aby + (b.z - a[2]) * abz) / l2 : 0
    u = u < 0 ? 0 : u > 1 ? 1 : u
    const dx = b.x - (a[0] + abx * u)
    const dy = b.y - (a[1] + aby * u)
    const dz = b.z - (a[2] + abz * u)
    const d2 = dx * dx + dy * dy + dz * dz
    const lim = BALL_R + r
    if (d2 >= lim * lim || d2 < 1e-14) return false
    const d = Math.sqrt(d2)
    this.cq.nx = dx / d
    this.cq.ny = dy / d
    this.cq.nz = dz / d
    this.cq.pen = lim - d
    return true
  }

  private solveCapsules() {
    const b = this.ball
    const caps = this.capsules
    for (let ci = 0; ci < caps.length; ci++) {
      const c = caps[ci]
      if (!this.sphereCapsule(c.a, c.b, c.r)) continue
      const { nx, ny, nz, pen } = this.cq
      const vn = -(b.vx * nx + b.vy * ny + b.vz * nz)
      b.x += nx * pen
      b.y += ny * pen
      b.z += nz * pen
      this.addHit(nx, ny, nz, c.e, c.e < 0.3 ? 0.6 : POST_MU)
      if (this.live && vn > 0.5) {
        const k = ci % 11
        const side = c.a[0] > 0 ? 1 : -1
        if (k < 2) this.fire({ type: 'direk', speed: vn, side, x: b.x, z: b.z })
        else if (k === 2) this.fire({ type: 'ust-direk', speed: vn, side, x: b.x, z: b.z })
      }
    }
  }

  // cevre: ince tel panel (surekli carpisma: adim basindaki yan korunur), kutu, kapsul
  private solveStatic() {
    const b = this.ball
    for (const c of this.staticColliders) {
      if (b.x < c.lo[0] || b.x > c.hi[0] || b.y < c.lo[1] || b.y > c.hi[1] || b.z < c.lo[2] || b.z > c.hi[2]) {
        // hizli top kutuyu adim icinde atlamis olabilir: yalniz ince panelde onemli, panel kutusu
        // top yolu (<=3 cm) kadar genisletilmis durumda
        continue
      }
      let nx = 0
      let ny = 0
      let nz = 0
      let pen = 0
      if (c.kind === 'capsule') {
        if (!this.sphereCapsule(c.a, c.b, c.r)) continue
        nx = this.cq.nx
        ny = this.cq.ny
        nz = this.cq.nz
        pen = this.cq.pen
      } else if (c.kind === 'rect') {
        const n = c.n
        const s1 = (b.x - c.c[0]) * n[0] + (b.y - c.c[1]) * n[1] + (b.z - c.c[2]) * n[2]
        const s0 = (b.px - c.c[0]) * n[0] + (b.py - c.c[1]) * n[1] + (b.pz - c.c[2]) * n[2]
        const crossed = s0 * s1 < 0
        if (!crossed && Math.abs(s1) >= BALL_R) continue
        const rx = b.x - c.c[0]
        const ry = b.y - c.c[1]
        const rz = b.z - c.c[2]
        const pu = rx * c.u[0] + ry * c.u[1] + rz * c.u[2]
        const vX = n[1] * c.u[2] - n[2] * c.u[1]
        const vY = n[2] * c.u[0] - n[0] * c.u[2]
        const vZ = n[0] * c.u[1] - n[1] * c.u[0]
        const pv = rx * vX + ry * vY + rz * vZ
        if (Math.abs(pu) > c.hu || Math.abs(pv) > c.hv) continue // kenar: direk/boru kapsulleri tutar
        const sg = s0 !== 0 ? Math.sign(s0) : Math.sign(s1) || 1
        nx = n[0] * sg
        ny = n[1] * sg
        nz = n[2] * sg
        pen = BALL_R - sg * s1
      } else {
        const cy = Math.cos(c.yaw)
        const sy = Math.sin(c.yaw)
        const wx = b.x - c.c[0]
        const wy = b.y - c.c[1]
        const wz = b.z - c.c[2]
        const lx = cy * wx - sy * wz
        const lz = sy * wx + cy * wz
        const qx = Math.max(-c.h[0], Math.min(c.h[0], lx))
        const qy = Math.max(-c.h[1], Math.min(c.h[1], wy))
        const qz = Math.max(-c.h[2], Math.min(c.h[2], lz))
        let lnx = lx - qx
        let lny = wy - qy
        let lnz = lz - qz
        const d2 = lnx * lnx + lny * lny + lnz * lnz
        if (d2 > 1e-12) {
          if (d2 >= BALL_R * BALL_R) continue
          const d = Math.sqrt(d2)
          lnx /= d
          lny /= d
          lnz /= d
          pen = BALL_R - d
        } else {
          // merkez kutunun icinde: en kisa eksenden cik
          const ex = c.h[0] - Math.abs(lx)
          const ey = c.h[1] - Math.abs(wy)
          const ez = c.h[2] - Math.abs(lz)
          lnx = lny = lnz = 0
          if (ex <= ey && ex <= ez) (lnx = Math.sign(lx) || 1), (pen = ex + BALL_R)
          else if (ey <= ez) (lny = Math.sign(wy) || 1), (pen = ey + BALL_R)
          else (lnz = Math.sign(lz) || 1), (pen = ez + BALL_R)
        }
        nx = cy * lnx + sy * lnz
        ny = lny
        nz = -sy * lnx + cy * lnz
      }
      const vn = -(b.vx * nx + b.vy * ny + b.vz * nz)
      b.x += nx * pen
      b.y += ny * pen
      b.z += nz * pen
      this.addHit(nx, ny, nz, c.e, c.mu)
      if (this.live && vn > 0.5) {
        this.fire({ type: c.tag === 'kafes' ? 'kafes' : 'nesne', tag: c.tag, speed: vn, x: b.x, z: b.z })
      }
    }
  }

  // oyuncu/hakem kapsulleri: kapsul hizi topa aktarilir (kosan oyuncu topu iter)
  private dynA: V3 = [0, 0, 0]
  private dynB: V3 = [0, 0, 0]
  private solveDynamic() {
    const b = this.ball
    const t = this.dynT
    const list = this.dynamicColliders
    const now = this.dynTouchNow
    now.clear()
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      const A = this.dynA
      const Bv = this.dynB
      A[0] = c.a[0] + c.vx * t
      A[1] = c.a[1] + c.vy * t
      A[2] = c.a[2] + c.vz * t
      Bv[0] = c.b[0] + c.vx * t
      Bv[1] = c.b[1] + c.vy * t
      Bv[2] = c.b[2] + c.vz * t
      // kaba eleme
      const mx = Math.max(A[0], Bv[0]) + c.r + BALL_R
      const nx0 = Math.min(A[0], Bv[0]) - c.r - BALL_R
      if (b.x > mx || b.x < nx0) continue
      const mz = Math.max(A[2], Bv[2]) + c.r + BALL_R
      const nz0 = Math.min(A[2], Bv[2]) - c.r - BALL_R
      if (b.z > mz || b.z < nz0) continue
      if (!this.sphereCapsule(A, Bv, c.r)) continue
      const { nx, ny, nz, pen } = this.cq
      const vn = -((b.vx - c.vx) * nx + (b.vy - c.vy) * ny + (b.vz - c.vz) * nz)
      b.x += nx * pen
      b.y += ny * pen
      b.z += nz * pen
      this.addHit(nx, ny, nz, c.e, Math.min(c.mu, DYN_MU_MAX), c.vx, c.vy, c.vz, true)
      const id = c.id ?? i
      now.add(id)
      if (!this.dynTouch.has(id)) this.fire({ type: 'oyuncu', id, tag: c.tag, speed: Math.max(0, vn), x: b.x, z: b.z })
    }
    const tmp = this.dynTouch
    this.dynTouch = now
    this.dynTouchNow = tmp
  }

  // ---------------------------------------------------------------- ag
  // Dugumleri tasi + ip/bag cozumu. ball=true ise top agi iter (tek yonlu: ag hafif).
  private netSubstep(g: GoalRange, h: number, ball: boolean) {
    const { pos, prev, vel, invMass, wSx, wCx, wSz, wCz } = this
    this.netId++
    const t = this.time
    const sx = Math.sin(t * 0.9)
    const cx = Math.cos(t * 0.9)
    const sz = Math.sin(t * 0.7)
    const cz = Math.cos(t * 0.7)
    for (let i = g.n0; i < g.n1; i++) {
      if (invMass[i] === 0) continue
      const k = i * 3
      if (pos[k + 1] > 0.02) {
        // hafif ruzgar
        vel[k] += 0.3 * (sx * wCx[i] + cx * wSx[i]) * h
        vel[k + 2] += 0.18 * (sz * wCz[i] + cz * wSz[i]) * h
      }
      vel[k + 1] += G * h
      prev[k] = pos[k]
      prev[k + 1] = pos[k + 1]
      prev[k + 2] = pos[k + 2]
      pos[k] += vel[k] * h
      pos[k + 1] += vel[k + 1] * h
      pos[k + 2] += vel[k + 2] * h
    }
    if (ball) this.gatherCandidates(g, h)
    this.solveSoft(g)
    this.solveRopes(g)
    this.solveTethers(g, h)
    if (ball) this.pushNet()
    // zemin + hiz
    const damp = Math.exp(-NET_DRAG * h)
    const ih = 1 / h
    let bad = false
    let mv = 0
    for (let i = g.n0; i < g.n1; i++) {
      const k = i * 3
      if (pos[k + 1] < ROPE_R) {
        // zemin: dugum ip yaricapinda durur, surtunmeyle tutunur
        pos[k + 1] = ROPE_R
        pos[k] = prev[k] + (pos[k] - prev[k]) * NODE_GROUND_KEEP
        pos[k + 2] = prev[k + 2] + (pos[k + 2] - prev[k + 2]) * NODE_GROUND_KEEP
      }
      for (let c = k; c < k + 3; c++) {
        const v = (pos[c] - prev[c]) * ih * damp
        const vc = v > 40 ? 40 : v < -40 ? -40 : v
        vel[c] = vc
        if (v !== v) bad = true
        const av = vc < 0 ? -vc : vc
        if (av > mv) mv = av
      }
    }
    this.maxV = mv
    if (bad) {
      // sayisal ariza: agi dinlenme konumuna dondur
      for (let i = g.n0 * 3; i < g.n1 * 3; i++) {
        pos[i] = prev[i] = this.rest[i]
        vel[i] = 0
      }
    }
  }

  // Topun ittigi dugum ipte agir sayilir: duzeltme komsulara gider, top cevresinde koni olusur
  // (ipler topu geri cekip dugumu topun icinden gecirmez).
  private solveRopes(g: GoalRange) {
    const { pos, invMass, ropeA, ropeB, ropeR, touch } = this
    const recent = this.netId - 3
    for (let e = g.r0; e < g.r1; e++) {
      const ia = ropeA[e]
      const ib = ropeB[e]
      const a3 = ia * 3
      const b3 = ib * 3
      const dx = pos[a3] - pos[b3]
      const dy = pos[a3 + 1] - pos[b3 + 1]
      const dz = pos[a3 + 2] - pos[b3 + 2]
      const d2 = dx * dx + dy * dy + dz * dz
      const r = ropeR[e]
      if (d2 <= r * r) continue // ip sikismaz, yalniz gerilir
      const d = Math.sqrt(d2)
      const wa = touch[ia] >= recent ? invMass[ia] * 0.02 : invMass[ia]
      const wb = touch[ib] >= recent ? invMass[ib] * 0.02 : invMass[ib]
      if (wa + wb <= 0) continue
      const k = -(d - r) / ((wa + wb) * d)
      pos[a3] += wa * k * dx
      pos[a3 + 1] += wa * k * dy
      pos[a3 + 2] += wa * k * dz
      pos[b3] -= wb * k * dx
      pos[b3 + 1] -= wb * k * dy
      pos[b3 + 2] -= wb * k * dz
    }
  }

  // atlamali ve kosegen baglar: yalniz asiri katlanmaya/cokmeye karsi, zayif
  private solveSoft(g: GoalRange) {
    const { pos, invMass, softA, softB, softR } = this
    for (let e = g.s0; e < g.s1; e++) {
      const ia = softA[e]
      const ib = softB[e]
      const a3 = ia * 3
      const b3 = ib * 3
      const dx = pos[a3] - pos[b3]
      const dy = pos[a3 + 1] - pos[b3 + 1]
      const dz = pos[a3 + 2] - pos[b3 + 2]
      const d2 = dx * dx + dy * dy + dz * dz
      const r = softR[e]
      if (d2 >= r * r || d2 < 1e-12) continue
      const d = Math.sqrt(d2)
      const wa = invMass[ia]
      const wb = invMass[ib]
      const k = (SOFT_FRAC * (r - d)) / ((wa + wb) * d)
      pos[a3] += wa * k * dx
      pos[a3 + 1] += wa * k * dy
      pos[a3 + 2] += wa * k * dz
      pos[b3] -= wb * k * dx
      pos[b3 + 1] -= wb * k * dy
      pos[b3 + 2] -= wb * k * dz
    }
  }

  // Uzun menzilli baglar: dugum, kelepcesine ag uzerinden olan yoldan daha uzaga gidemez
  // (az yinelemeyle ag lastik gibi uzamaz). Top iterken bag gevser; sonra hiz sinirli toplanir.
  private solveTethers(g: GoalRange, h: number) {
    const { pos, tethN, tethA, tethL, touch } = this
    const maxRet = RETURN_SPEED * h
    const recent = this.netId - 3
    for (let e = g.t0; e < g.t1; e++) {
      const i = tethN[e]
      if (touch[i] >= recent) continue
      const i3 = i * 3
      const a3 = tethA[e] * 3
      const dx = pos[i3] - pos[a3]
      const dy = pos[i3 + 1] - pos[a3 + 1]
      const dz = pos[i3 + 2] - pos[a3 + 2]
      const d2 = dx * dx + dy * dy + dz * dz
      const L = tethL[e]
      if (d2 <= L * L) continue
      const d = Math.sqrt(d2)
      const C = d - L
      const k = (C < maxRet ? C : maxRet) / d
      pos[i3] -= k * dx
      pos[i3 + 1] -= k * dy
      pos[i3 + 2] -= k * dz
    }
  }

  private gatherCandidates(g: GoalRange, h: number) {
    const b = this.ball
    this.nCand = 0
    if (!this.nearGoal(g, 0.6)) return
    const { pos, adjStart, adjEdge, candMark, cand, invMass, renderEdges } = this
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz)
    const reach = RC + 0.2 + sp * h
    const r2 = reach * reach
    const id = this.netId
    for (let i = g.n0; i < g.n1; i++) {
      const k = i * 3
      const dx = pos[k] - b.x
      if (dx > reach || dx < -reach) continue
      const dy = pos[k + 1] - b.y
      if (dy > reach || dy < -reach) continue
      const dz = pos[k + 2] - b.z
      if (dx * dx + dy * dy + dz * dz > r2) continue
      for (let a = adjStart[i]; a < adjStart[i + 1]; a++) {
        const e = adjEdge[a]
        if (candMark[e] === id) continue
        candMark[e] = id
        if (invMass[renderEdges[2 * e]] === 0 && invMass[renderEdges[2 * e + 1]] === 0) continue
        cand[this.nCand++] = e
      }
    }
  }

  // Top ipleri kendi kuresinin disina iter (kure - kapsul). Ip duzlemine yatan itme, topun
  // geldigi yana gore dis normale bukulur: goz acilip top gorsel olarak agin icinden gecmez.
  private pushNet() {
    const { pos, prev, invMass, renderEdges, cand, touch, nrm } = this
    const b = this.ball
    const id = this.netId
    for (let c = 0; c < this.nCand; c++) {
      const e = cand[c]
      const ia = renderEdges[2 * e]
      const ib = renderEdges[2 * e + 1]
      const a3 = ia * 3
      const b3 = ib * 3
      const ax = pos[a3]
      const ay = pos[a3 + 1]
      const az = pos[a3 + 2]
      const ex = pos[b3] - ax
      const ey = pos[b3 + 1] - ay
      const ez = pos[b3 + 2] - az
      const l2 = ex * ex + ey * ey + ez * ez
      let t = l2 > 1e-12 ? ((b.x - ax) * ex + (b.y - ay) * ey + (b.z - az) * ez) / l2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const t1 = 1 - t
      let nx = b.x - (ax + ex * t)
      let ny = b.y - (ay + ey * t)
      let nz = b.z - (az + ez * t)
      const d2 = nx * nx + ny * ny + nz * nz
      if (d2 >= RC * RC) continue
      const d = Math.sqrt(d2)
      // ipin dinlenme normali ve topun adim basindaki goreli tarafi
      const sx = nrm[a3] * t1 + nrm[b3] * t
      const sy = nrm[a3 + 1] * t1 + nrm[b3 + 1] * t
      const sz = nrm[a3 + 2] * t1 + nrm[b3 + 2] * t
      const s0 =
        (b.px - prev[a3] * t1 - prev[b3] * t) * sx +
        (b.py - prev[a3 + 1] * t1 - prev[b3 + 1] * t) * sy +
        (b.pz - prev[a3 + 2] * t1 - prev[b3 + 2] * t) * sz
      const sn = nx * sx + ny * sy + nz * sz
      let pen: number
      if (s0 * sn < 0 && Math.abs(s0) > 0.4 * RC) {
        // top ipi adim icinde gecti: ipi topun obur yanina tasi
        const sg = s0 > 0 ? 1 : -1
        nx = sx * sg
        ny = sy * sg
        nz = sz * sg
        pen = RC + Math.abs(sn)
      } else {
        if (d < 1e-7) continue
        nx /= d
        ny /= d
        nz /= d
        if (Math.abs(s0) > 0.4 * RC && Math.abs(sn) < 0.5 * d) {
          const sg = s0 > 0 ? 1 : -1
          nx += sx * sg
          ny += sy * sg
          nz += sz * sg
          const l = Math.sqrt(nx * nx + ny * ny + nz * nz)
          nx /= l
          ny /= l
          nz /= l
        }
        pen = RC - d
      }
      // tek yonlu: yalniz ip hareket eder
      const wa = invMass[ia] * t1
      const wb = invMass[ib] * t
      const wq = wa * t1 + wb * t
      if (wq <= 0) continue
      const lam = pen / wq
      pos[a3] -= nx * lam * wa
      pos[a3 + 1] -= ny * lam * wa
      pos[a3 + 2] -= nz * lam * wa
      pos[b3] -= nx * lam * wb
      pos[b3 + 1] -= ny * lam * wb
      pos[b3 + 2] -= nz * lam * wb
      touch[ia] = id
      touch[ib] = id
    }
  }
}

export const world = new World()
