// Halka tampon: son ~6 s, 60 Hz (simulasyon zamaniyla ornekleme).
// Top: konum + kuaterniyon + hiz (Float32); hiz kareler arasi balistik cozum icin. Ag: yalniz top bir kaleye yakinken o kalenin dugumleri,
// dinlenme konumuna gore mm cinsinden Int16 fark (~4 MB). Diger karelerde ag dinlenme seklinde oynatilir.
import { BALL_R, GOAL_W, PITCH_L } from '../pitch'
import { BODY_N, BODY_POINT_NAMES, BODY_RADII, bodyPoints } from '../game/bodyPoints'
import { game } from '../game/store'
import type { AnimState, RefAnim } from '../game/types'
import type { World } from '../sim'
import type { Track } from './judge'

export const REC_HZ = 60
export const REC_CAP = 600 // 10 s
const NET_NEAR = 4.5 // kale cizgisine bu kadar yakinken ag kaydedilir (m)
const Q = 1000 // mm
// oyuncu/hakem: x, z, vx, vz, facing, anim (indeks), animT, hasBall
const A = 8
// top: x y z qx qy qz qw vx vy vz
const S = 10

// anim adlari <-> indeks (kayit Float32 tutar)
const animIds = new Map<string, number>()
const animNames: string[] = []
const animId = (s: string) => {
  let i = animIds.get(s)
  if (i === undefined) {
    i = animNames.length
    animNames.push(s)
    animIds.set(s, i)
  }
  return i
}

type Actor = { x: number; z: number; vx: number; vz: number; facing: number; anim: string; animT: number; hasBall?: boolean }
const writeActor = (o: Float32Array, k: number, p: Actor) => {
  o[k] = p.x
  o[k + 1] = p.z
  o[k + 2] = p.vx
  o[k + 3] = p.vz
  o[k + 4] = p.facing
  o[k + 5] = animId(p.anim)
  o[k + 6] = p.animT
  o[k + 7] = p.hasBall ? 1 : 0
}
// aci farki [-pi, pi]
const dAng = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export class Recorder implements Track {
  readonly cap = REC_CAP
  head = 0 // siradaki yazma yeri
  count = 0
  t = new Float64Array(REC_CAP)
  ball = new Float32Array(REC_CAP * S)
  /** bu karede top isinlandi mi (sut sonu geri koyma): oncesiyle surekli degil */
  cut = new Uint8Array(REC_CAP)
  /** kaydedilen ag: 0/1 = goalRanges indeksi, -1 yok */
  netG = new Int8Array(REC_CAP)
  net: Int16Array
  base: Float32Array // dinlenme konumlari (kayit basinda)
  ranges: { n0: number; n1: number }[]
  stride: number
  /** oyuncular + hakem (son aktor) */
  actors: Float32Array
  nAct: number
  /** oyuncu vucut noktalari (ofsayt): kare x oyuncu x BODY_N*3; yoksa tum sifir */
  body: Float32Array
  bodyOk: Uint8Array
  nPl: number
  lastT = -1

  constructor(world: World) {
    this.base = world.pos.slice()
    this.ranges = world.goalRanges.map((g) => ({ n0: g.n0, n1: Math.min(g.n1, world.n) }))
    this.stride = Math.max(...this.ranges.map((r) => (r.n1 - r.n0) * 3))
    this.net = new Int16Array(REC_CAP * this.stride)
    this.nAct = game.players.length + 1
    this.actors = new Float32Array(REC_CAP * this.nAct * A)
    this.nPl = game.players.length
    this.body = new Float32Array(REC_CAP * this.nPl * BODY_N * 3)
    this.bodyOk = new Uint8Array(REC_CAP * this.nPl)
  }

  bytes() {
    return this.t.byteLength + this.ball.byteLength + this.net.byteLength + this.cut.byteLength + this.netG.byteLength + this.actors.byteLength + this.body.byteLength + this.bodyOk.byteLength
  }

  clear() {
    this.head = this.count = 0
    this.lastT = -1
  }

  /** kronolojik k (0 = en eski) -> halka indeksi */
  idx(k: number) {
    return (this.head - this.count + k + this.cap * 2) % this.cap
  }

  /** her kare cagrilir; ornek alindiysa true */
  sample(world: World): boolean {
    const now = world.time
    if (this.lastT >= 0 && now - this.lastT < 1 / REC_HZ - 1e-6) return false
    const b = world.ball
    const i = this.head
    const o = i * S
    let cut = 0
    if (this.count > 0) {
      const j = (i - 1 + this.cap) % this.cap
      const p = j * S
      const jump = Math.hypot(b.x - this.ball[p], b.y - this.ball[p + 1], b.z - this.ball[p + 2])
      const v = Math.hypot(b.vx, b.vy, b.vz)
      if (jump > 1.0 + v * Math.max(now - this.lastT, 1 / REC_HZ) * 2) cut = 1
    }
    this.t[i] = now
    this.cut[i] = cut
    this.ball[o] = b.x
    this.ball[o + 1] = b.y
    this.ball[o + 2] = b.z
    this.ball[o + 3] = b.q.x
    this.ball[o + 4] = b.q.y
    this.ball[o + 5] = b.q.z
    this.ball[o + 6] = b.q.w
    this.ball[o + 7] = b.vx
    this.ball[o + 8] = b.vy
    this.ball[o + 9] = b.vz
    // ag: topa yakin kale
    let g = -1
    for (let r = 0; r < world.goalRanges.length; r++) {
      const gs = world.goalRanges[r].side
      if (Math.abs(gs * b.x - PITCH_L / 2) < NET_NEAR && Math.abs(b.z) < GOAL_W / 2 + 3) g = r
    }
    this.netG[i] = g
    if (g >= 0) {
      const { n0, n1 } = this.ranges[g]
      const P = world.pos
      const B = this.base
      const out = this.net
      let w = i * this.stride
      for (let c = n0 * 3, e = n1 * 3; c < e; c++) {
        const q = Math.round((P[c] - B[c]) * Q)
        out[w++] = q > 32767 ? 32767 : q < -32767 ? -32767 : q
      }
    }
    // oyuncular + hakem
    const ps = game.players
    const ao = i * this.nAct * A
    for (let p = 0; p < this.nAct - 1; p++) if (ps[p]) writeActor(this.actors, ao + p * A, ps[p])
    writeActor(this.actors, ao + (this.nAct - 1) * A, game.referee)
    for (let p = 0; p < this.nPl; p++) {
      const pts = ps[p] ? bodyPoints.get(ps[p].id) : undefined
      const bi = i * this.nPl + p
      if (pts && pts.length >= BODY_N * 3) {
        this.body.set(pts.subarray(0, BODY_N * 3), bi * BODY_N * 3)
        this.bodyOk[bi] = 1
      } else this.bodyOk[bi] = 0
    }
    this.head = (i + 1) % this.cap
    if (this.count < this.cap) this.count++
    this.lastT = now
    return true
  }

  get(k: number, out: { x: number; y: number; z: number }) {
    const o = this.idx(k) * S
    out.x = this.ball[o]
    out.y = this.ball[o + 1]
    out.z = this.ball[o + 2]
  }

  /** k. ornekteki top hizi */
  vel(k: number, out: { x: number; y: number; z: number }) {
    const o = this.idx(k) * S
    out.x = this.ball[o + 7]
    out.y = this.ball[o + 8]
    out.z = this.ball[o + 9]
  }

  /** k ile k+1 arasi sureksiz mi (k+1. karede top isinlandi) */
  gap(k: number) {
    return this.cut[this.idx(k + 1)] === 1
  }

  time(k: number) {
    return this.t[this.idx(k)]
  }

  /** kesirli kareye karsilik gelen sim zamani */
  timeAtF(f: number) {
    const k0 = Math.max(0, Math.min(this.count - 1, Math.floor(f)))
    const k1 = Math.min(this.count - 1, k0 + 1)
    return this.time(k0) + (this.time(k1) - this.time(k0)) * (f - k0)
  }

  /** k karesinden geriye ilk surekli aralik baslangici */
  segStart(k: number) {
    while (k > 0 && !this.cut[this.idx(k)]) k--
    return k
  }

  /** sim zamaninda t'ye karsilik gelen kesirli kronolojik indeks ([a,b] icinde) */
  frameAt(t: number, a: number, b: number) {
    if (t <= this.time(a)) return a
    if (t >= this.time(b)) return b
    let lo = a
    let hi = b
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (this.time(m) <= t) lo = m
      else hi = m
    }
    const t0 = this.time(lo)
    const t1 = this.time(hi)
    return lo + (t1 > t0 ? (t - t0) / (t1 - t0) : 0)
  }

  /** kesirli kareyi dunyaya yaz (top + iki kalenin agi) */
  apply(world: World, f: number) {
    const k0 = Math.floor(f)
    const k1 = Math.min(this.count - 1, k0 + 1)
    const a = f - k0
    const i0 = this.idx(k0)
    const i1 = this.idx(k1)
    const A = this.ball
    const o0 = i0 * S
    const o1 = i1 * S
    const b = world.ball
    // konum: kareler arasi Hermite (konum + hiz); sureksiz aralikta onceki kare
    const sm = this.cut[i1] === 1 ? 0 : a
    const h = this.t[i1] - this.t[i0]
    const hz = (c: number) => {
      if (sm <= 0) return A[o0 + c]
      const s2 = sm * sm
      const s3 = s2 * sm
      return (
        (2 * s3 - 3 * s2 + 1) * A[o0 + c] +
        (s3 - 2 * s2 + sm) * A[o0 + 7 + c] * h +
        (-2 * s3 + 3 * s2) * A[o1 + c] +
        (s3 - s2) * A[o1 + 7 + c] * h
      )
    }
    b.x = b.px = hz(0)
    b.y = b.py = Math.max(BALL_R * 0.5, hz(1))
    b.z = b.pz = hz(2)
    // kuaterniyon: en kisa yol nlerp
    const dot = A[o0 + 3] * A[o1 + 3] + A[o0 + 4] * A[o1 + 4] + A[o0 + 5] * A[o1 + 5] + A[o0 + 6] * A[o1 + 6]
    const s = dot < 0 ? -1 : 1
    let qx = A[o0 + 3] + (s * A[o1 + 3] - A[o0 + 3]) * a
    let qy = A[o0 + 4] + (s * A[o1 + 4] - A[o0 + 4]) * a
    let qz = A[o0 + 5] + (s * A[o1 + 5] - A[o0 + 5]) * a
    let qw = A[o0 + 6] + (s * A[o1 + 6] - A[o0 + 6]) * a
    const n = Math.hypot(qx, qy, qz, qw) || 1
    qx /= n
    qy /= n
    qz /= n
    qw /= n
    b.q.x = qx
    b.q.y = qy
    b.q.z = qz
    b.q.w = qw

    const P = world.pos
    const B = this.base
    const N = this.net
    for (let g = 0; g < this.ranges.length; g++) {
      const { n0, n1 } = this.ranges[g]
      const h0 = this.netG[i0] === g
      const h1 = this.netG[i1] === g
      const r0 = i0 * this.stride
      const r1 = i1 * this.stride
      for (let c = n0 * 3, e = n1 * 3, w = 0; c < e; c++, w++) {
        const d0 = h0 ? N[r0 + w] : h1 ? N[r1 + w] : 0
        const d1 = h1 ? N[r1 + w] : d0
        P[c] = B[c] + (d0 + (d1 - d0) * a) / Q
      }
    }
  }

  /**
   * k karesinde oyuncu p'nin d yonunde (d*x) en ileri vucut noktasi (K2'nin bodyExtent'iyle ayni formul).
   * Kayit yoksa null.
   */
  bodyBest(k: number, p: number, d: 1 | -1) {
    const bi = this.idx(k) * this.nPl + p
    if (!this.bodyOk[bi]) return null
    const o = bi * BODY_N * 3
    let best = -1e9
    let bn = 0
    for (let n = 0; n < BODY_N; n++) {
      const v = d * this.body[o + n * 3] + BODY_RADII[n]
      if (v > best) {
        best = v
        bn = n
      }
    }
    return { v: best, name: BODY_POINT_NAMES[bn], x: this.body[o + bn * 3], y: this.body[o + bn * 3 + 1], z: this.body[o + bn * 3 + 2] }
  }

  /** k karesinde aktor alani (0..nAct-1, son = hakem) */
  actor(k: number, a: number, out: { x: number; z: number }) {
    const o = (this.idx(k) * this.nAct + a) * A
    out.x = this.actors[o]
    out.z = this.actors[o + 1]
  }

  /** kesirli kareyi oyunculara (ve istenirse hakeme) yaz */
  applyActors(f: number, withRef: boolean) {
    const k0 = Math.floor(f)
    const k1 = Math.min(this.count - 1, k0 + 1)
    const a = f - k0
    const B0 = this.idx(k0) * this.nAct * A
    const B1 = this.idx(k1) * this.nAct * A
    const S = this.actors
    const n = withRef ? this.nAct : this.nAct - 1
    for (let p = 0; p < n; p++) {
      const t: Actor = p < this.nAct - 1 ? game.players[p] : game.referee
      if (!t) continue
      const o0 = B0 + p * A
      const o1 = B1 + p * A
      t.x = S[o0] + (S[o1] - S[o0]) * a
      t.z = S[o0 + 1] + (S[o1 + 1] - S[o0 + 1]) * a
      t.vx = S[o0 + 2] + (S[o1 + 2] - S[o0 + 2]) * a
      t.vz = S[o0 + 3] + (S[o1 + 3] - S[o0 + 3]) * a
      t.facing = S[o0 + 4] + dAng(S[o1 + 4] - S[o0 + 4]) * a
      // anim ayriktir: yakin kareninki; animT ayni klipteyse enterpole
      const near = a < 0.5 ? o0 : o1
      t.anim = animNames[S[near + 5]] as AnimState & RefAnim
      t.animT = S[o0 + 5] === S[o1 + 5] ? S[o0 + 6] + (S[o1 + 6] - S[o0 + 6]) * a : S[near + 6]
      if (p < this.nAct - 1) (t as { hasBall: boolean }).hasBall = S[near + 7] > 0.5
    }
  }
}
