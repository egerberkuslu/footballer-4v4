// Saha cevresi yerlesim sabitleri + statik carpisma geometrisi (saf veri; three/React yok).
// Surroundings.tsx gorseli bu sabitlerden kurar: gorsel ve carpisma ayni kaynaktan gelir.
// Eksenler: x = boy, z = en, y = yukari, zemin y=0. Saha plakasinin icinde collider yoktur.
import { PLATE_L, PLATE_W } from '../pitch'

type V3 = [number, number, number]

export type Collider =
  // ince panel: merkez, normal (sahaya bakar), u ekseni, yari genislik/yukseklik (v = n x u)
  | { kind: 'rect'; c: V3; n: V3; u: V3; hu: number; hv: number; e: number; mu: number; tag: string }
  | { kind: 'box'; c: V3; h: V3; yaw: number; e: number; mu: number; tag: string }
  | { kind: 'capsule'; a: V3; b: V3; r: number; e: number; mu: number; tag: string }

// --- Kafes (tel orgu) ---
export const FENCE_X = PLATE_L / 2 + 2 // plakanin 2 m disi
export const FENCE_Z = PLATE_W / 2 + 2
export const FENCE_H_END = 5 // kale arkasi
export const FENCE_H_SIDE = 4
export const FENCE_POST_SPACING = 2.5
export const FENCE_POST_R = 0.036
export const FENCE_CORNER_POST_R = 0.05
export const FENCE_RAIL_R = 0.021
export const FENCE_MID_RAIL_Y = 2.0
export const FENCE_BOTTOM_RAIL_Y = 0.06

export type FenceRun = {
  a: [number, number]
  b: [number, number]
  h: number
  c: [number, number] // orta nokta (xz)
  len: number
  rotY: number // u ekseni = (cos rotY, 0, -sin rotY)
  n: V3 // sahaya bakan normal
}

function run(a: [number, number], b: [number, number], h: number): FenceRun {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const c: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const len = Math.hypot(dx, dz)
  const nx = -Math.sign(c[0]) * (Math.abs(c[0]) > 1e-6 ? 1 : 0)
  const nz = -Math.sign(c[1]) * (Math.abs(c[1]) > 1e-6 ? 1 : 0)
  return { a, b, h, c, len, rotY: -Math.atan2(dz, dx), n: [nx, 0, nz] }
}

export const FENCE_RUNS: FenceRun[] = [
  run([-FENCE_X, FENCE_Z], [FENCE_X, FENCE_Z], FENCE_H_SIDE),
  run([-FENCE_X, -FENCE_Z], [FENCE_X, -FENCE_Z], FENCE_H_SIDE),
  run([FENCE_X, -FENCE_Z], [FENCE_X, FENCE_Z], FENCE_H_END),
  run([-FENCE_X, -FENCE_Z], [-FENCE_X, FENCE_Z], FENCE_H_END),
]

export type FencePost = { x: number; z: number; h: number; r: number }

// Kose direkleri iki kenarda ortak: bir kez, en yuksek boyla
export const FENCE_POSTS: FencePost[] = (() => {
  const map = new Map<string, FencePost>()
  for (const r of FENCE_RUNS) {
    const n = Math.ceil(r.len / FENCE_POST_SPACING)
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const corner = i === 0 || i === n
      const p = {
        x: r.a[0] + (r.b[0] - r.a[0]) * t,
        z: r.a[1] + (r.b[1] - r.a[1]) * t,
        h: r.h + 0.05,
        r: corner ? FENCE_CORNER_POST_R : FENCE_POST_R,
      }
      const k = `${p.x.toFixed(3)},${p.z.toFixed(3)}`
      const old = map.get(k)
      if (!old || old.h < p.h) map.set(k, p)
    }
  }
  return [...map.values()]
})()

export const railHeights = (r: FenceRun) => [r.h, FENCE_MID_RAIL_Y, FENCE_BOTTOM_RAIL_Y]

// --- Donatilar ---
export const FLOOD_H = 11
export const FLOODLIGHTS: [number, number][] = [1, -1].flatMap((sx) =>
  [1, -1].map((sz) => [sx * (FENCE_X + 1.1), sz * (FENCE_Z + 1.1)] as [number, number]),
)
export const DUGOUT = { x: -4, z: FENCE_Z - 1.05, len: 4.2, h: 2.1, depth: 1.05 }
export const BENCH = { x: 6, z: FENCE_Z - 0.7, len: 2.4 }
export const BIN = { x: 9, z: FENCE_Z - 0.5, r: 0.24, h: 0.84 }
export const CURB = { w: 0.12, h: 0.08 }
// Uzun kenar (-z) arkasinda 3 basamakli beton seyirci basamagi; basamak i: on kenar z0 - depth*(i-1), ust y = rise*i
export const TRIBUNE = { z0: -(FENCE_Z + 1.6), depth: 0.8, rise: 0.44, tiers: 3, halfW: 11.5, railH: 1.0 }
export const tribuneBack = () => TRIBUNE.z0 - TRIBUNE.depth * TRIBUNE.tiers

// --- Carpisma listesi ---
const KAFES = { e: 0.25, mu: 0.6 } // tel orgu enerjiyi emer
const DIREK = { e: 0.5, mu: 0.3 }
const BETON = { e: 0.55, mu: 0.6 }
const AHSAP = { e: 0.45, mu: 0.5 }
const PANEL = { e: 0.35, mu: 0.5 }

function benchColliders(x: number, z: number, len: number, tag: string): Collider[] {
  // oturak ve sirtlik (arka +z)
  return [
    { kind: 'box', c: [x, 0.45, z], h: [len / 2, 0.02, 0.18], yaw: 0, ...AHSAP, tag },
    { kind: 'box', c: [x, 0.7, z + 0.24], h: [len / 2, 0.13, 0.02], yaw: 0, ...AHSAP, tag },
  ]
}

export const STATIC_COLLIDERS: Collider[] = (() => {
  const out: Collider[] = []
  for (const r of FENCE_RUNS) {
    const u: V3 = [Math.cos(r.rotY), 0, -Math.sin(r.rotY)]
    out.push({ kind: 'rect', c: [r.c[0], r.h / 2, r.c[1]], n: r.n, u, hu: r.len / 2, hv: r.h / 2, ...KAFES, tag: 'kafes' })
    for (const y of railHeights(r))
      out.push({ kind: 'capsule', a: [r.a[0], y, r.a[1]], b: [r.b[0], y, r.b[1]], r: FENCE_RAIL_R, ...DIREK, tag: 'direk' })
  }
  for (const p of FENCE_POSTS) out.push({ kind: 'capsule', a: [p.x, 0, p.z], b: [p.x, p.h, p.z], r: p.r, ...DIREK, tag: 'direk' })

  for (const [x, z] of FLOODLIGHTS) {
    out.push({ kind: 'box', c: [x, 0.25, z], h: [0.35, 0.25, 0.35], yaw: 0, ...BETON, tag: 'projektor' })
    out.push({ kind: 'capsule', a: [x, 0.5, z], b: [x, FLOOD_H, z], r: 0.12, ...DIREK, tag: 'projektor' })
  }

  const d = DUGOUT
  out.push({ kind: 'box', c: [d.x, d.h / 2, d.z + 0.55], h: [d.len / 2, d.h / 2, 0.03], yaw: 0, ...PANEL, tag: 'kulube' })
  for (const s of [-1, 1])
    out.push({ kind: 'box', c: [d.x + (s * d.len) / 2, d.h / 2, d.z + 0.05], h: [0.025, d.h / 2, d.depth / 2], yaw: 0, ...PANEL, tag: 'kulube' })
  out.push({ kind: 'box', c: [d.x, d.h + 0.02, d.z + 0.05], h: [d.len / 2 + 0.05, 0.02, 0.575], yaw: 0, ...PANEL, tag: 'kulube' })
  out.push(...benchColliders(d.x, d.z + 0.2, d.len - 0.4, 'bank'))
  out.push(...benchColliders(BENCH.x, BENCH.z, BENCH.len, 'bank'))
  out.push({ kind: 'capsule', a: [BIN.x, BIN.r, BIN.z], b: [BIN.x, BIN.h - BIN.r, BIN.z], r: BIN.r, ...PANEL, tag: 'cop' })

  // seyirci basamaklari + arka korkuluk
  const T = TRIBUNE
  for (let i = 1; i <= T.tiers; i++) {
    const zc = T.z0 - T.depth * (i - 1) - T.depth / 2
    out.push({ kind: 'box', c: [0, (T.rise * i) / 2, zc], h: [T.halfW, (T.rise * i) / 2, T.depth / 2], yaw: 0, ...BETON, tag: 'tribun' })
  }
  const ry = T.rise * T.tiers + T.railH
  const rz = tribuneBack() + 0.05
  out.push({ kind: 'capsule', a: [-T.halfW, ry, rz], b: [T.halfW, ry, rz], r: 0.025, ...DIREK, tag: 'tribun' })

  // beton bordur: plakanin hemen disinda, alcak (top ustunden sekebilir)
  const px = PLATE_L / 2
  const pz = PLATE_W / 2
  const { w, h } = CURB
  out.push({ kind: 'box', c: [0, h / 2, pz + w / 2], h: [px + w, h / 2, w / 2], yaw: 0, ...BETON, tag: 'bordur' })
  out.push({ kind: 'box', c: [0, h / 2, -pz - w / 2], h: [px + w, h / 2, w / 2], yaw: 0, ...BETON, tag: 'bordur' })
  out.push({ kind: 'box', c: [px + w / 2, h / 2, 0], h: [w / 2, h / 2, pz], yaw: 0, ...BETON, tag: 'bordur' })
  out.push({ kind: 'box', c: [-px - w / 2, h / 2, 0], h: [w / 2, h / 2, pz], yaw: 0, ...BETON, tag: 'bordur' })
  return out
})()
