// Ofsayt icin gercek vucut noktalari (kemiklerden). Kollar ve eller SAYILMAZ (kural).
// Dolduran: I2-anim (her kare, dunya koordinati). Okuyanlar: K2-hakem (ofsayt), G2-var (cizgi gorseli), dev paneli.
// Noktalar kemik MERKEZIDIR; kalinlik BODY_RADII ile eklenir.
import type { Player } from './types'

export const BODY_POINT_NAMES = [
  'kafa-ust', // 0
  'kafa', // 1
  'gogus', // 2
  'kalca', // 3
  'diz-l', // 4
  'diz-r', // 5
  'bilek-l', // 6
  'bilek-r', // 7
  'ayak-ucu-l', // 8
  'ayak-ucu-r', // 9
] as const
export const BODY_N = BODY_POINT_NAMES.length

// her noktanin vucut kalinligi (m): kemik merkezinden yuzeye
export const BODY_RADII = [0.0, 0.1, 0.16, 0.15, 0.08, 0.08, 0.06, 0.06, 0.03, 0.03]

// id -> Float32Array(BODY_N * 3): x, y, z dunya konumlari
export const bodyPoints = new Map<number, Float32Array>()

export function setBodyPoints(id: number, pts: Float32Array) {
  bodyPoints.set(id, pts)
}

/** Oyuncunun verilen yonde (d = +1 ya da -1 x yonu) en ileri vucut noktasi: d*x cinsinden. */
export function bodyExtent(p: Player, d: 1 | -1): number {
  const pts = bodyPoints.get(p.id)
  if (pts && pts.length >= BODY_N * 3) {
    let best = -1e9
    for (let i = 0; i < BODY_N; i++) {
      const v = d * pts[i * 3] + BODY_RADII[i]
      if (v > best) best = v
    }
    return best
  }
  // yedek: kapsul. facing 0 = +z, ileri = (sin f, cos f)
  const fwd = d * Math.sin(p.facing)
  const lying = p.anim === 'fall' || p.anim === 'slide'
  return d * p.x + (lying ? 0.5 : 0.2 + 0.15 * Math.max(0, fwd))
}

/** Topun verilen yonde kale cizgisine en yakin yuzeyi (d*x). */
export function ballExtent(ballX: number, d: 1 | -1, ballR: number): number {
  return d * ballX + ballR
}
