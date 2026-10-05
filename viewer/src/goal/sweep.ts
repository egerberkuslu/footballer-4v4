import * as THREE from 'three'

// Duzlemsel bir cokgen cizgi boyunca eliptik profilli boru; koseler gonye (miter) kesimli.
// B: cizginin duzlemine dik sabit eksen. rB profilin B yonundeki, rN duzlem icindeki yari ekseni.
export interface SweepOpts {
  pts: THREE.Vector3[]
  B: THREE.Vector3
  rB: number
  rN: number
  seg?: number
  step?: number // boy boyunca alt bolme (kir/doku icin)
  grime?: (p: THREE.Vector3) => number // 0 temiz, 1 kirli
}

export function sweepTube(o: SweepOpts): THREE.BufferGeometry {
  const seg = o.seg ?? 24
  const step = o.step ?? 0.12
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const B = o.B.clone().normalize()
  let vAcc = 0

  for (let s = 0; s < o.pts.length - 1; s++) {
    const p0 = o.pts[s]
    const p1 = o.pts[s + 1]
    const T = p1.clone().sub(p0)
    const len = T.length()
    T.divideScalar(len)
    const N = new THREE.Vector3().crossVectors(B, T).normalize()
    // uc duzlemleri: kosede iki parcanin acıortayi, uclarda dik kesit
    const endPlane = (k: number) => {
      const prev = k === 0 ? (s > 0 ? o.pts[s - 1] : null) : null
      const next = k === 1 ? (s + 2 < o.pts.length ? o.pts[s + 2] : null) : null
      if (prev) {
        const Tp = p0.clone().sub(prev).normalize()
        return Tp.add(T).normalize()
      }
      if (next) {
        const Tn = next.clone().sub(p1).normalize()
        return Tn.add(T).normalize()
      }
      return null
    }
    const n0 = endPlane(0)
    const n1 = endPlane(1)
    const rings = Math.max(1, Math.ceil(len / step))
    const base = pos.length / 3
    for (let r = 0; r <= rings; r++) {
      const t = r / rings
      const c = p0.clone().lerp(p1, t)
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        const off = N.clone().multiplyScalar(o.rN * ca).addScaledVector(B, o.rB * sa)
        let along = 0
        // uclarda gonye duzlemine kaydir
        if (r === 0 && n0) along = -off.dot(n0) / T.dot(n0)
        if (r === rings && n1) along = -off.dot(n1) / T.dot(n1)
        const p = c.clone().add(off).addScaledVector(T, along)
        const nn = N.clone().multiplyScalar(ca / o.rN).addScaledVector(B, sa / o.rB).normalize()
        pos.push(p.x, p.y, p.z)
        nor.push(nn.x, nn.y, nn.z)
        uv.push(i / seg, vAcc + t * len + along)
        const g = o.grime ? o.grime(p) : 0
        col.push(1 - 0.32 * g, 1 - 0.3 * g, 1 - 0.38 * g)
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let i = 0; i < seg; i++) {
        const a = base + r * (seg + 1) + i
        const b = a + seg + 1
        idx.push(a, a + 1, b, b, a + 1, b + 1)
      }
    }
    vAcc += len
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  return g
}

// Basit deger gurultusu (kir lekeleri icin)
export function noise3(x: number, y: number, z: number): number {
  const h = (a: number, b: number, c: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
    return s - Math.floor(s)
  }
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const w = zf * zf * (3 - 2 * zf)
  const L = THREE.MathUtils.lerp
  const c = (dx: number, dy: number, dz: number) => h(xi + dx, yi + dy, zi + dz)
  return L(
    L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  )
}
