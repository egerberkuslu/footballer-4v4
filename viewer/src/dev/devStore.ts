// Dev modu durumu: Canvas ici (olcum, carpisma kutulari) ile DOM paneli arasinda paylasilir.

export interface DevFlags {
  on: boolean
  hitboxes: boolean
  nodes: boolean
  triggers: boolean
  statics: boolean
  offside: boolean
}

export const devStats = {
  fps: 0,
  frameMs: 0,
  worstMs: 0, // son ~2 sn'deki en kotu %1 kare
  calls: 0,
  tris: 0,
  simMs: 0,
  clothMs: 0, // kumas simulasyonu CPU suresi (N2-kumas yazar)
  clothN: 0, // kumas parcacik sayisi
  logicMs: 0, // karenin basindan render oncesine: girdi + AI + kurallar + hareket + fizik (CPU)
  geoms: 0,
  textures: 0,
}

const params = new URLSearchParams(location.search)

function load(): DevFlags {
  const base: DevFlags = { on: params.get('dev') === '1', hitboxes: true, nodes: true, triggers: true, statics: true, offside: true }
  try {
    const raw = localStorage.getItem('devFlags')
    if (raw) Object.assign(base, JSON.parse(raw), params.has('dev') ? { on: params.get('dev') === '1' } : {})
  } catch {
    // depolama yoksa varsayilanlarla devam
  }
  return base
}

let flags = load()
const listeners = new Set<() => void>()

export function getDev(): DevFlags {
  return flags
}

export function setDev(patch: Partial<DevFlags>) {
  flags = { ...flags, ...patch }
  try {
    localStorage.setItem('devFlags', JSON.stringify(flags))
  } catch {
    // yok say
  }
  listeners.forEach((f) => f())
}

export function subscribeDev(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
