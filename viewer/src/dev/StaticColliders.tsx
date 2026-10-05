import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { STATIC_COLLIDERS, type Collider } from '../env/colliders'
import { world } from '../sim'

// Statik carpisma sekilleri: hepsi tek LineSegments (tek draw call), renk etikete gore.
const TAG_COLOR: Record<string, [number, number, number]> = {
  kafes: [1, 0.85, 0.1],
  direk: [1, 0.55, 0.1],
  projektor: [0.9, 0.3, 1],
  kulube: [0.3, 0.7, 1],
  bank: [0.3, 1, 0.8],
  bordur: [1, 1, 1],
  cop: [0.7, 1, 0.3],
}
const SEG = 14

type V3 = [number, number, number]
const v = (a: V3) => new THREE.Vector3(...a)

function pushSeg(out: number[], col: number[], a: THREE.Vector3, b: THREE.Vector3, c: [number, number, number]) {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z)
  col.push(...c, ...c)
}

function circle(out: number[], col: number[], center: THREE.Vector3, axis: THREE.Vector3, r: number, c: [number, number, number]) {
  const t1 = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize()
  const t2 = new THREE.Vector3().crossVectors(axis, t1)
  let prev = center.clone().addScaledVector(t1, r)
  for (let i = 1; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2
    const p = center.clone().addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r)
    pushSeg(out, col, prev, p, c)
    prev = p
  }
}

function addCollider(out: number[], col: number[], k: Collider) {
  const c = TAG_COLOR[k.tag] ?? [1, 1, 1]
  if (k.kind === 'rect') {
    const ctr = v(k.c)
    const n = v(k.n).normalize()
    const u = v(k.u).normalize()
    const w = new THREE.Vector3().crossVectors(n, u)
    const corner = (su: number, sv: number) => ctr.clone().addScaledVector(u, su * k.hu).addScaledVector(w, sv * k.hv)
    const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
    for (let i = 0; i < 4; i++) pushSeg(out, col, q[i], q[(i + 1) % 4], c)
    // seyrek ic izgara
    for (let i = 1; i < 4; i++) {
      const f = -1 + (2 * i) / 4
      pushSeg(out, col, corner(f, -1), corner(f, 1), c)
      pushSeg(out, col, corner(-1, f), corner(1, f), c)
    }
    // normal oku (sahaya bakis)
    pushSeg(out, col, ctr, ctr.clone().addScaledVector(n, 0.6), [1, 0.2, 0.2])
  } else if (k.kind === 'box') {
    const ctr = v(k.c)
    const cy = Math.cos(k.yaw)
    const sy = Math.sin(k.yaw)
    const p = (sx: number, syy: number, sz: number) => {
      const lx = sx * k.h[0]
      const lz = sz * k.h[2]
      return new THREE.Vector3(ctr.x + cy * lx + sy * lz, ctr.y + syy * k.h[1], ctr.z - sy * lx + cy * lz)
    }
    const s = [-1, 1]
    for (const a of s) for (const b of s) {
      pushSeg(out, col, p(-1, a, b), p(1, a, b), c)
      pushSeg(out, col, p(a, -1, b), p(a, 1, b), c)
      pushSeg(out, col, p(a, b, -1), p(a, b, 1), c)
    }
  } else {
    const a = v(k.a)
    const b = v(k.b)
    const axis = b.clone().sub(a).normalize()
    circle(out, col, a, axis, k.r, c)
    circle(out, col, b, axis, k.r, c)
    const t1 = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize()
    for (const sgn of [1, -1]) pushSeg(out, col, a.clone().addScaledVector(t1, sgn * k.r), b.clone().addScaledVector(t1, sgn * k.r), c)
  }
}

export function StaticColliders() {
  const geometry = useMemo(() => {
    const pos: number[] = []
    const col: number[] = []
    for (const k of STATIC_COLLIDERS) addCollider(pos, col, k)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    return g
  }, [])
  return (
    <lineSegments geometry={geometry} renderOrder={996} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent depthTest={false} toneMapped={false} opacity={0.85} />
    </lineSegments>
  )
}

// Oyuncu/hakem kapsulleri (B: world.dynamicColliders). Alan yoksa hicbir sey cizmez.
type Dyn = { a: V3 | THREE.Vector3Like; b: V3 | THREE.Vector3Like; r: number }
const MAX_DYN = 12
const toV = (p: V3 | THREE.Vector3Like) => (Array.isArray(p) ? new THREE.Vector3(...p) : new THREE.Vector3(p.x, p.y, p.z))

export function DynamicColliders() {
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  useFrame(() => {
    const list = ((world as unknown as { dynamicColliders?: Dyn[] }).dynamicColliders ?? []) as Dyn[]
    for (let i = 0; i < MAX_DYN; i++) {
      const m = refs.current[i]
      if (!m) continue
      const d = list[i]
      m.visible = !!d
      if (!d) continue
      const a = toV(d.a)
      const b = toV(d.b)
      const len = Math.max(1e-3, a.distanceTo(b))
      m.position.copy(a).add(b).multiplyScalar(0.5)
      m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize())
      // birim kapsul olceklenir: yaricap xz, govde y
      m.scale.set(d.r, (len + 2 * d.r) / 3, d.r)
    }
  })
  return (
    <>
      {Array.from({ length: MAX_DYN }, (_, i) => (
        <mesh key={i} ref={(m) => (refs.current[i] = m)} visible={false} renderOrder={999}>
          <capsuleGeometry args={[1, 1, 3, 8]} />
          <meshBasicMaterial color="#00ff9c" wireframe transparent depthTest={false} toneMapped={false} />
        </mesh>
      ))}
    </>
  )
}
