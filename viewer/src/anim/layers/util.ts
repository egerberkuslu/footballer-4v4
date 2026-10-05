import * as THREE from 'three'

export const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
export const qa = new THREE.Quaternion()
export const qb = new THREE.Quaternion()
export const qc = new THREE.Quaternion()
export const qd = new THREE.Quaternion()

interface Status {
  loaded: boolean
  frames: number
}
type W = { __layers?: Record<string, Status> }

/** gelistirme rozeti ve testler icin katman durumu: window.__layers[ad] = { loaded, frames } */
export function layerStatus(name: string): Status {
  const w = globalThis as unknown as W
  const all = (w.__layers ??= {})
  return (all[name] ??= { loaded: false, frames: 0 })
}

/** JSON yukle (yoksa null; katman o zaman sessizce kapali kalir) */
export async function loadJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url)
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    return null
  }
}
