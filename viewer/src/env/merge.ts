import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Cok parcali sahne nesnelerini malzeme basina tek geometride birlestirir (draw call azaltma).

export type Part = { m: string; g: THREE.BufferGeometry; t: THREE.Matrix4 }

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()

export function mat(p: [number, number, number] = [0, 0, 0], r: [number, number, number] = [0, 0, 0], s = 1) {
  return new THREE.Matrix4().compose(new THREE.Vector3(...p), _q.setFromEuler(_e.set(...r)), new THREE.Vector3(s, s, s))
}

// a * b (ust donusum once)
export function mul(a: THREE.Matrix4, b: THREE.Matrix4) {
  return a.clone().multiply(b)
}

export function mergeParts(parts: Part[]): Record<string, THREE.BufferGeometry> {
  const by: Record<string, THREE.BufferGeometry[]> = {}
  for (const p of parts) {
    const g = p.g.clone().applyMatrix4(p.t)
    ;(by[p.m] ??= []).push(g)
  }
  const out: Record<string, THREE.BufferGeometry> = {}
  for (const k in by) {
    const merged = mergeGeometries(by[k], false)
    if (merged) out[k] = merged
    by[k].forEach((g) => g.dispose())
  }
  return out
}
