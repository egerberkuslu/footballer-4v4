// Top yolu tahmini ve pas hizi tablosu: sim/ball'un serbest ucus adimiyla (ag/direk yok).
import { type BallState, freeStep, newBall } from '../sim/ball'

export const PRED_H = 1 / 30
export const PRED_N = 90 // 3 s
// tahmin ornekleri: x,y,z (t_i = i * PRED_H)
export const pred = new Float32Array(PRED_N * 3)
const tmp: BallState = newBall()

export function predictBall(b: { x: number; y: number; z: number; vx: number; vy: number; vz: number; wx: number; wy: number; wz: number }) {
  tmp.x = b.x
  tmp.y = b.y
  tmp.z = b.z
  tmp.vx = b.vx
  tmp.vy = b.vy
  tmp.vz = b.vz
  tmp.wx = b.wx
  tmp.wy = b.wy
  tmp.wz = b.wz
  for (let i = 0; i < PRED_N; i++) {
    pred[i * 3] = tmp.x
    pred[i * 3 + 1] = tmp.y
    pred[i * 3 + 2] = tmp.z
    // her ornek arasi 2 alt adim
    freeStep(tmp, PRED_H / 2)
    freeStep(tmp, PRED_H / 2)
  }
}

// yerden pas (locomotion: yuvarlanan top, varis ~4.5 m/s; surtunme a = C0 + C1 v, sim/ball ile ayni)
const C0 = 0.9
const C1 = 0.09
const V_ARR = 4.5
const rollDist = (v0: number, v1: number) =>
  v0 <= v1 ? 0 : (v0 - v1 - (C0 / C1) * Math.log((C0 + C1 * v0) / (C0 + C1 * v1))) / C1
const rollTime = (v0: number, v1: number) => (v0 <= v1 ? 0 : Math.log((C0 + C1 * v0) / (C0 + C1 * v1)) / C1)

/** hedefe topun ~4.5 m/s ile varacagi yerden pas hizi (m/s) */
export function passSpeed(dist: number): number {
  let lo = V_ARR
  let hi = 40
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2
    if (rollDist(m, V_ARR) < dist) lo = m
    else hi = m
  }
  return lo
}

export const PASS_CONTACT = 0.22 // aksiyondan topa temasa (locomotionApi passContact)

/** ortalama top hizi (pas yolu risk hesabi icin): yol / sure */
export const avgPassSpeed = (dist: number) => {
  const v0 = passSpeed(dist)
  const T = rollTime(v0, V_ARR)
  return T > 0 ? dist / T : v0
}
