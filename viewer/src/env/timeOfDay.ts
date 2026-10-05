// Gunun saati: ?time=gunduz|aksam|gece (varsayilan gunduz). Calisirken setTimeOfDay ile degisir.
// Saf durum modulu (three/React yok); Lighting, Spectators ve HUD secicisi abone olur.

export type TimeOfDay = 'gunduz' | 'aksam' | 'gece'
export const TIMES: { id: TimeOfDay; label: string }[] = [
  { id: 'gunduz', label: 'Gündüz' },
  { id: 'aksam', label: 'Akşam' },
  { id: 'gece', label: 'Gece' },
]

const raw = new URLSearchParams(location.search).get('time')
let current: TimeOfDay = raw === 'aksam' || raw === 'gece' ? raw : 'gunduz'
const subs = new Set<() => void>()

export const getTimeOfDay = () => current
export function setTimeOfDay(t: TimeOfDay) {
  if (t === current) return
  current = t
  subs.forEach((f) => f())
}
export function subscribeTimeOfDay(f: () => void) {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

type V3 = [number, number, number]
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
}

// Saat basina isik ayarlari (yon: gunese dogru birim vektor)
export const TOD = {
  gunduz: {
    sunDir: norm([-0.52, 0.59, 0.62]),
    sunColor: '#ffeedb',
    sunI: 4.3,
    sky: { turbidity: 4.2, rayleigh: 1.25, mie: 0.0045, g: 0.86 },
    fog: '#c9d3dc',
    fogNear: 70,
    fogFar: 420,
    env: 0.55,
    hemi: ['#cfe0ff', '#4a5530', 0.12] as const,
    floods: false,
  },
  aksam: {
    // alcak (~8 derece) turuncu gunes, uzun golgeler
    sunDir: norm([-0.72, 0.13, 0.68]),
    sunColor: '#ff9447',
    sunI: 3.4,
    sky: { turbidity: 9, rayleigh: 3, mie: 0.007, g: 0.92 },
    fog: '#d3a27c',
    fogNear: 45,
    fogFar: 340,
    env: 0.38,
    hemi: ['#ffcaa0', '#3a3528', 0.12] as const,
    floods: false,
  },
  gece: {
    // ay isigi (golgesiz), sahayi projektorler aydinlatir
    sunDir: norm([0.35, 0.8, -0.45]),
    sunColor: '#9fb4ff',
    sunI: 0.12,
    sky: { turbidity: 1, rayleigh: 0.2, mie: 0.002, g: 0.8 },
    fog: '#0d121b',
    fogNear: 40,
    fogFar: 260,
    env: 0.2,
    hemi: ['#1c2638', '#06080a', 0.06] as const,
    floods: true,
  },
} as const
