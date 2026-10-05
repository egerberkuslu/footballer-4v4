import { Suspense, use, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { PLATE_L, PLATE_W } from '../pitch'
import { asset } from '../assetUrl'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mat, mergeParts, mul, type Part } from './merge'
import { chainLinkAlpha, concreteMap, facadeMap, gravelMap, loadBakedEnvTextures, outerGroundMap } from './textures'

import {
  BENCH,
  BIN,
  CURB,
  DUGOUT,
  FENCE_POSTS,
  FENCE_RAIL_R,
  FENCE_RUNS,
  FENCE_X,
  FENCE_Z,
  FLOOD_H,
  FLOODLIGHTS,
  railHeights,
  TRIBUNE,
  tribuneBack,
} from './colliders'
import { useTimeOfDay } from './Lighting'
import { Spectators } from './Spectators'
import { ModelBoundary } from '../ModelBoundary'

// Yerlesim sabitleri colliders.ts'de: gorsel ve carpisma ayni kaynaktan
export { FENCE_X, FENCE_Z }

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// Ic dikdortgeni bos birakan zemin halkasi (UV = dunya metresi)
function ringGeometry(ix: number, iz: number, ox: number, oz: number) {
  const s = new THREE.Shape()
  s.moveTo(-ox, -oz)
  s.lineTo(ox, -oz)
  s.lineTo(ox, oz)
  s.lineTo(-ox, oz)
  s.closePath()
  const h = new THREE.Path()
  h.moveTo(-ix, -iz)
  h.lineTo(-ix, iz)
  h.lineTo(ix, iz)
  h.lineTo(ix, -iz)
  h.closePath()
  s.holes.push(h)
  return new THREE.ShapeGeometry(s)
}

function tiled(t: THREE.Texture, size: number) {
  const c = t.clone()
  c.repeat.set(1 / size, 1 / size)
  c.needsUpdate = true
  return c
}

function Grounds() {
  const px = PLATE_L / 2
  const pz = PLATE_W / 2
  const geo = useMemo(
    () => ({
      concrete: ringGeometry(px, pz, FENCE_X + 1.5, FENCE_Z + 1.5),
      gravel: ringGeometry(FENCE_X + 1.5, FENCE_Z + 1.5, FENCE_X + 4.5, FENCE_Z + 4.5),
      outer: ringGeometry(FENCE_X + 4.5, FENCE_Z + 4.5, 420, 420),
    }),
    [px, pz],
  )
  const tex = useMemo(
    () => ({ concrete: tiled(concreteMap(), 4), gravel: tiled(gravelMap(), 4), outer: tiled(outerGroundMap(), 16) }),
    [],
  )
  return (
    <group rotation-x={-Math.PI / 2}>
      <mesh geometry={geo.concrete} receiveShadow>
        <meshStandardMaterial map={tex.concrete} roughness={0.92} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <mesh geometry={geo.gravel} receiveShadow>
        <meshStandardMaterial map={tex.gravel} roughness={1} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <mesh geometry={geo.outer} receiveShadow>
        <meshStandardMaterial map={tex.outer} roughness={1} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
    </group>
  )
}

const steel = new THREE.MeshStandardMaterial({ color: '#a9afb3', metalness: 0.75, roughness: 0.38 })

function Fence() {
  const { posts, rails, panels } = useMemo(() => {
    const posts = FENCE_POSTS
    const rails = FENCE_RUNS.flatMap((r) => railHeights(r).map((y) => ({ x: r.c[0], z: r.c[1], y, len: r.len, rotY: r.rotY })))
    const panels = FENCE_RUNS.map((r) => ({ x: r.c[0], z: r.c[1], len: r.len, h: r.h, rotY: r.rotY }))
    return { posts, rails, panels }
  }, [])

  const postMesh = useRef<THREE.InstancedMesh>(null)
  const railMesh = useRef<THREE.InstancedMesh>(null)
  const postGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 12).translate(0, 0.5, 0), [])
  const railGeo = useMemo(() => new THREE.CylinderGeometry(FENCE_RAIL_R, FENCE_RAIL_R, 1, 6, 1, true).rotateZ(Math.PI / 2), [])

  const setup = () => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    if (postMesh.current) {
      posts.forEach((p, i) => {
        m.compose(new THREE.Vector3(p.x, 0, p.z), q.identity(), new THREE.Vector3(p.r, p.h, p.r))
        postMesh.current!.setMatrixAt(i, m)
      })
      postMesh.current.instanceMatrix.needsUpdate = true
    }
    if (railMesh.current) {
      rails.forEach((r, i) => {
        q.setFromEuler(e.set(0, r.rotY, 0))
        m.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.len, 1, 1))
        railMesh.current!.setMatrixAt(i, m)
      })
      railMesh.current.instanceMatrix.needsUpdate = true
    }
  }

  // dort tel paneli tek geometri + tek malzeme; tel olcegi UV'de
  const { meshGeo, meshMat } = useMemo(() => {
    const gs = panels.map((p) => {
      const g = new THREE.PlaneGeometry(p.len, p.h)
      const uv = g.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * p.len) / 0.5, (uv.getY(i) * p.h) / 0.5)
      return g.applyMatrix4(mat([p.x, p.h / 2, p.z], [0, p.rotY, 0]))
    })
    const meshGeo = mergeGeometries(gs)
    gs.forEach((g) => g.dispose())
    const meshMat = new THREE.MeshStandardMaterial({
      color: '#9ea4a8',
      metalness: 0.6,
      roughness: 0.45,
      alphaMap: chainLinkAlpha(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    return { meshGeo, meshMat }
  }, [panels])

  return (
    <group>
      <instancedMesh
        ref={(r) => {
          postMesh.current = r
          setup()
        }}
        args={[postGeo, steel, posts.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={(r) => {
          railMesh.current = r
          setup()
        }}
        args={[railGeo, steel, rails.length]}
      />
      <mesh geometry={meshGeo} material={meshMat} renderOrder={2} />
    </group>
  )
}

// --- Sabit donatilar (bordur, projektorler, bank, kulube, cop kutusu) ---
// Hepsi malzeme basina tek geometride birlesir: ~10 draw call.
const PROP_MATS: Record<string, THREE.Material> = {
  steel,
  concrete: new THREE.MeshStandardMaterial({ color: '#a6a39b', roughness: 0.95 }),
  lampBody: new THREE.MeshStandardMaterial({ color: '#5b6064', metalness: 0.5, roughness: 0.45 }),
  lampGlass: new THREE.MeshStandardMaterial({ color: '#d8dde0', metalness: 0.2, roughness: 0.08, envMapIntensity: 1.4 }),
  wood: new THREE.MeshStandardMaterial({ color: '#8a5a33', roughness: 0.75 }),
  dark: new THREE.MeshStandardMaterial({ color: '#2d3133', metalness: 0.6, roughness: 0.5 }),
  panel: new THREE.MeshStandardMaterial({ color: '#25303a', metalness: 0.3, roughness: 0.6 }),
  poly: new THREE.MeshStandardMaterial({ color: '#c3d0d6', roughness: 0.2, transparent: true, opacity: 0.4, depthWrite: false }),
  bin: new THREE.MeshStandardMaterial({ color: '#2f5a3a', metalness: 0.4, roughness: 0.55, side: THREE.DoubleSide }),
}
const NO_SHADOW = new Set(['poly', 'lampGlass'])

function box(x: number, y: number, z: number) {
  return new THREE.BoxGeometry(x, y, z)
}

// Projektor diregi: konik boru, beton kaide, iki armaturlu baslik (sahaya bakar)
function floodlightParts(x: number, z: number, h = FLOOD_H): Part[] {
  const base = mat([x, 0, z])
  const head = mul(base, mat([0, h, 0], [0, Math.atan2(-x, -z), 0]))
  const parts: Part[] = [
    { m: 'concrete', g: box(0.7, 0.5, 0.7), t: mul(base, mat([0, 0.25, 0])) },
    { m: 'steel', g: new THREE.CylinderGeometry(0.085, 0.15, h, 14), t: mul(base, mat([0, h / 2, 0])) },
    { m: 'steel', g: box(1.9, 0.08, 0.08), t: mul(head, mat([0, 0, 0.12])) },
  ]
  for (const dx of [-0.55, 0.55]) {
    const lamp = mul(head, mat([dx, 0.05, 0.3], [0.75, 0, 0]))
    parts.push({ m: 'lampBody', g: box(0.62, 0.48, 0.16), t: lamp })
    parts.push({ m: 'lampGlass', g: new THREE.PlaneGeometry(0.54, 0.4), t: mul(lamp, mat([0, 0, 0.081])) })
  }
  return parts
}

// Ahsap citali, metal ayakli bank (arkasi +z yonunde)
function benchParts(base: THREE.Matrix4, len = 2.4): Part[] {
  const parts: Part[] = []
  for (const dz of [-0.13, 0, 0.13]) parts.push({ m: 'wood', g: box(len, 0.035, 0.1), t: mul(base, mat([0, 0.45, dz])) })
  for (const y of [0.62, 0.78]) parts.push({ m: 'wood', g: box(len, 0.1, 0.03), t: mul(base, mat([0, y, 0.24], [-0.18, 0, 0])) })
  for (const dx of [-len / 2 + 0.2, len / 2 - 0.2]) {
    parts.push({ m: 'dark', g: box(0.05, 0.44, 0.05), t: mul(base, mat([dx, 0.22, -0.1])) })
    parts.push({ m: 'dark', g: box(0.05, 0.84, 0.05), t: mul(base, mat([dx, 0.42, 0.22])) })
    parts.push({ m: 'dark', g: box(0.05, 0.04, 0.38), t: mul(base, mat([dx, 0.43, 0.06])) })
  }
  return parts
}

// Yedek kulubesi: arka duvar + saydam polikarbonat yanlar/cati + bank
function dugoutParts(x: number, z: number): Part[] {
  const len = DUGOUT.len
  const base = mat([x, 0, z])
  return [
    { m: 'panel', g: box(len, 2.1, 0.06), t: mul(base, mat([0, 1.05, 0.55])) },
    { m: 'poly', g: box(0.05, 2.1, 1.05), t: mul(base, mat([-len / 2, 1.05, 0.05])) },
    { m: 'poly', g: box(0.05, 2.1, 1.05), t: mul(base, mat([len / 2, 1.05, 0.05])) },
    { m: 'poly', g: box(len + 0.1, 0.04, 1.15), t: mul(base, mat([0, 2.12, 0.05], [-0.06, 0, 0])) },
    ...benchParts(mul(base, mat([0, 0, 0.2])), len - 0.4),
  ]
}

function binParts(x: number, z: number): Part[] {
  return [
    { m: 'bin', g: new THREE.CylinderGeometry(0.24, 0.22, 0.84, 18, 1, true), t: mat([x, 0.42, z]) },
    { m: 'bin', g: new THREE.TorusGeometry(0.24, 0.015, 6, 24), t: mat([x, 0.85, z], [Math.PI / 2, 0, 0]) },
  ]
}

// Suni cim plakasini cevreleyen beton bordur
function curbParts(): Part[] {
  const px = PLATE_L / 2
  const pz = PLATE_W / 2
  const { w, h } = CURB
  return [
    { m: 'curb', g: box(PLATE_L + 2 * w, h, w), t: mat([0, h / 2, pz + w / 2]) },
    { m: 'curb', g: box(PLATE_L + 2 * w, h, w), t: mat([0, h / 2, -pz - w / 2]) },
    { m: 'curb', g: box(w, h, PLATE_W), t: mat([px + w / 2, h / 2, 0]) },
    { m: 'curb', g: box(w, h, PLATE_W), t: mat([-px - w / 2, h / 2, 0]) },
  ]
}

// Uzun kenar arkasinda 3 basamakli beton seyirci basamagi + arka korkuluk
function tribuneParts(): Part[] {
  const T = TRIBUNE
  const parts: Part[] = []
  for (let i = 1; i <= T.tiers; i++) {
    const zc = T.z0 - T.depth * (i - 1) - T.depth / 2
    parts.push({ m: 'concrete', g: box(T.halfW * 2, T.rise * i, T.depth), t: mat([0, (T.rise * i) / 2, zc]) })
  }
  const top = T.rise * T.tiers
  const rz = tribuneBack() + 0.05
  for (let x = -T.halfW; x <= T.halfW + 1e-6; x += T.halfW / 6)
    parts.push({ m: 'steel', g: new THREE.CylinderGeometry(0.025, 0.025, T.railH, 8), t: mat([x, top + T.railH / 2, rz]) })
  for (const y of [top + T.railH, top + T.railH * 0.5])
    parts.push({ m: 'steel', g: new THREE.CylinderGeometry(0.025, 0.025, T.halfW * 2, 8), t: mat([0, y, rz], [0, 0, Math.PI / 2]) })
  // celik makasli polikarbonat cati: arkada yuksek, sahaya dogru hafif egimli
  const zb = tribuneBack() - 0.35
  const zf = T.z0 + 0.45
  const yb = 3.5
  const yf = 2.85
  const len = Math.hypot(zf - zb, yb - yf)
  const ang = Math.atan2(yb - yf, zf - zb)
  const zm = (zb + zf) / 2
  const ym = (yb + yf) / 2
  parts.push({ m: 'poly', g: box(T.halfW * 2 + 1, 0.04, len), t: mat([0, ym, zm], [ang, 0, 0]) })
  for (let x = -T.halfW; x <= T.halfW + 1e-6; x += T.halfW / 2) {
    parts.push({ m: 'steel', g: box(0.07, 0.14, len), t: mat([x, ym - 0.1, zm], [ang, 0, 0]) })
    parts.push({ m: 'steel', g: new THREE.CylinderGeometry(0.05, 0.05, yb, 10), t: mat([x, yb / 2, zb + 0.15]) })
  }
  parts.push({ m: 'steel', g: box(T.halfW * 2 + 1, 0.1, 0.1), t: mat([0, yf - 0.05, zf]) })
  parts.push({ m: 'steel', g: box(T.halfW * 2 + 1, 0.1, 0.1), t: mat([0, yb - 0.05, zb]) })
  return parts
}

function Props() {
  const curbMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: tiled(concreteMap(), 2), color: '#c8c6c0', roughness: 0.9 }),
    [],
  )
  // gece projektor camlari yanar (bloom esigini asar)
  const tod = useTimeOfDay()
  useEffect(() => {
    const g = PROP_MATS.lampGlass as THREE.MeshStandardMaterial
    const on = tod === 'gece'
    g.emissive.set(on ? '#fff6e8' : '#000000')
    g.emissiveIntensity = on ? 24 : 0
  }, [tod])
  const geos = useMemo(() => {
    const parts: Part[] = [...curbParts()]
    for (const [x, z] of FLOODLIGHTS) parts.push(...floodlightParts(x, z))
    parts.push(...dugoutParts(DUGOUT.x, DUGOUT.z))
    parts.push(...benchParts(mat([BENCH.x, 0, BENCH.z]), BENCH.len))
    parts.push(...binParts(BIN.x, BIN.z))
    parts.push(...tribuneParts())
    return mergeParts(parts)
  }, [])
  return (
    <group>
      {Object.entries(geos).map(([k, g]) => (
        <mesh
          key={k}
          geometry={g}
          material={k === 'curb' ? curbMat : PROP_MATS[k]}
          castShadow={!NO_SHADOW.has(k)}
          receiveShadow
        />
      ))}
    </group>
  )
}

// --- Agaclar: Flux ile uretilmis kesik fotograflar, silindirik ilan panosu ---
const TREE_KINDS = [
  { url: asset('env/tree_plane.png'), aspect: 529 / 512, h: [10, 14] },
  { url: asset('env/tree_poplar.png'), aspect: 71 / 512, h: [8.5, 12.5] },
  { url: asset('env/tree_linden.png'), aspect: 463 / 512, h: [8, 12] },
] as const

type TreeSpot = { x: number; z: number; kind: number; h: number; tint: number; flip: number; wscale: number }

function treeSpots(): TreeSpot[] {
  const r = rng(91)
  const out: TreeSpot[] = []
  const add = (x: number, z: number, kind: number) => {
    const k = TREE_KINDS[kind]
    out.push({ x, z, kind, h: k.h[0] + r() * (k.h[1] - k.h[0]), tint: 0.72 + r() * 0.3, flip: r() < 0.5 ? -1 : 1, wscale: 0.85 + r() * 0.25 })
  }
  // uzun kenar boyunca servi sirasi
  for (let x = -44; x <= 44; x += 5 + r() * 5) {
    if (r() < 0.18) continue
    add(x + r(), -FENCE_Z - 10 - r() * 3, r() < 0.75 ? 1 : 2)
  }
  // kale arkalarinda genis tepeli agaclar
  for (const s of [1, -1])
    for (let z = -26; z <= 26; z += 6 + r() * 4) add(s * (FENCE_X + 9 + r() * 6), z, r() < 0.5 ? 0 : 2)
  // tribun tarafinda seyrek agaclar (gorusu kapatmasin)
  for (let x = -50; x <= 50; x += 11 + r() * 6) {
    if (Math.abs(x) < 14) continue
    add(x, FENCE_Z + 12 + r() * 8, r() < 0.5 ? 2 : 0)
  }
  // uzak kume
  for (let i = 0; i < 110; i++) {
    const a = r() * Math.PI * 2
    const d = 48 + r() * 80
    add(Math.cos(a) * d, Math.sin(a) * d, Math.floor(r() * 3))
  }
  return out
}

// Tur basina tek InstancedMesh (3 draw call); her ornek her karede kameraya doner
function Trees() {
  const maps = useLoader(
    THREE.TextureLoader,
    TREE_KINDS.map((k) => k.url),
  )
  const spots = useMemo(treeSpots, [])
  const byKind = useMemo(() => TREE_KINDS.map((_, k) => spots.filter((s) => s.kind === k)), [spots])
  const mats = useMemo(
    () =>
      maps.map((m) => {
        m.colorSpace = THREE.SRGBColorSpace
        m.anisotropy = 4
        return new THREE.MeshLambertMaterial({ map: m, alphaTest: 0.45, side: THREE.DoubleSide })
      }),
    [maps],
  )
  const geos = useMemo(
    () => TREE_KINDS.map((k) => new THREE.PlaneGeometry(k.aspect, 1).translate(0, 0.5, 0)),
    [],
  )
  const refs = useRef<(THREE.InstancedMesh | null)[]>([])
  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }),
    [],
  )

  const bind = (k: number) => (r: THREE.InstancedMesh | null) => {
    refs.current[k] = r
    if (!r) return
    const c = new THREE.Color()
    byKind[k].forEach((s, i) => r.setColorAt(i, c.setScalar(s.tint)))
    if (r.instanceColor) r.instanceColor.needsUpdate = true
    r.frustumCulled = false
  }

  useFrame(({ camera }) => {
    const { m, q, p, s, up } = tmp
    byKind.forEach((list, k) => {
      const im = refs.current[k]
      if (!im) return
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, Math.atan2(camera.position.x - t.x, camera.position.z - t.z))
        m.compose(p.set(t.x, -0.1, t.z), q, s.set(t.h * t.flip * t.wscale, t.h, t.h))
        im.setMatrixAt(i, m)
      })
      im.instanceMatrix.needsUpdate = true
    })
  })

  return (
    <group>
      {byKind.map((list, k) => (
        <instancedMesh key={k} ref={bind(k)} args={[geos[k], mats[k], list.length]} />
      ))}
    </group>
  )
}

// --- Binalar: uzak siluet, cephe dokulu kutular; sis ile havaya karisir ---
type Bld = { x: number; z: number; w: number; d: number; floors: number; kind: 'plaster' | 'brick'; color: string }

function buildings(): Bld[] {
  const r = rng(5)
  const out: Bld[] = []
  // okul binasi (uzun kenar arkasi)
  out.push({ x: -10, z: -78, w: 58, d: 14, floors: 3, kind: 'brick', color: '#ffffff' })
  // kulup binasi: basamagin arkasinda tek katli, uzun alcak siluet
  out.push({ x: 2, z: -39, w: 33, d: 8, floors: 1, kind: 'plaster', color: '#e3dccd' })
  out.push({ x: -26, z: -36, w: 12, d: 7, floors: 2, kind: 'brick', color: '#ffffff' })
  const colors = ['#f1e7d4', '#e6d6c2', '#efe9df', '#d9c7ad', '#e9d9cf', '#cfd6d8']
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2
    const d = 85 + r() * 90
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    if (z < -50 && Math.abs(x) < 40) continue
    out.push({ x, z, w: 16 + r() * 14, d: 11 + r() * 4, floors: 4 + Math.floor(r() * 6), kind: 'plaster', color: colors[i % colors.length] })
  }
  return out
}

// Tum binalar uc geometride: siva cephe, tugla cephe, cati (3 draw call).
// Cephe UV'leri aks/kat sayisina gore olceklenir; bina rengi vertex rengi olarak tasinir.
function Buildings() {
  const { geos, mats } = useMemo(() => {
    const parts: Record<'plaster' | 'brick' | 'roof', THREE.BufferGeometry[]> = { plaster: [], brick: [], roof: [] }
    const col = new THREE.Color()
    for (const b of buildings()) {
      const h = b.floors * 3 + 0.6
      const T = mat([b.x, -0.3, b.z], [0, Math.atan2(-b.x, -b.z), 0])
      col.set(b.color)
      const walls: [number, [number, number, number], number][] = [
        [b.w, [0, h / 2, b.d / 2], 0],
        [b.w, [0, h / 2, -b.d / 2], Math.PI],
        [b.d, [b.w / 2, h / 2, 0], Math.PI / 2],
        [b.d, [-b.w / 2, h / 2, 0], -Math.PI / 2],
      ]
      for (const [len, p, ry] of walls) {
        const g = new THREE.PlaneGeometry(len, h)
        const uv = g.attributes.uv as THREE.BufferAttribute
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(len / 3)), uv.getY(i) * b.floors)
        const n = g.attributes.position.count
        const c = new Float32Array(n * 3)
        for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3)
        g.setAttribute('color', new THREE.BufferAttribute(c, 3))
        g.applyMatrix4(mul(T, mat(p, [0, ry, 0])))
        parts[b.kind].push(g)
      }
      const roof = new THREE.PlaneGeometry(b.w, b.d)
      roof.applyMatrix4(mul(T, mat([0, h, 0], [-Math.PI / 2, 0, 0])))
      parts.roof.push(roof)
    }
    const geos = {
      plaster: mergeGeometries(parts.plaster),
      brick: mergeGeometries(parts.brick),
      roof: mergeGeometries(parts.roof),
    }
    const mats = {
      plaster: new THREE.MeshStandardMaterial({ map: facadeMap('plaster'), vertexColors: true, roughness: 0.85 }),
      brick: new THREE.MeshStandardMaterial({ map: facadeMap('brick'), vertexColors: true, roughness: 0.85 }),
      roof: new THREE.MeshStandardMaterial({ color: '#7d7a74', roughness: 0.95 }),
    }
    return { geos, mats }
  }, [])
  // gece cepheler projektor saçilmasindan fazla aydinlik kalmasin
  const tod = useTimeOfDay()
  useEffect(() => {
    const k = tod === 'gece' ? 0.4 : tod === 'aksam' ? 0.9 : 1
    mats.plaster.color.setScalar(k)
    mats.brick.color.setScalar(k)
    mats.roof.color.set(tod === 'gece' ? '#3e3d3a' : '#7d7a74')
  }, [tod, mats])
  return (
    <group>
      {(['plaster', 'brick', 'roof'] as const).map((k) => (
        <mesh key={k} geometry={geos[k]} material={mats[k]} />
      ))}
    </group>
  )
}

// pisirilmis zemin dokulari gelene kadar cevre kurulmaz (kurulumda senkron canvas uretimi olmasin)
function BakedGate({ children }: { children: ReactNode }) {
  use(loadBakedEnvTextures())
  return <>{children}</>
}

export function Surroundings() {
  return (
    <Suspense fallback={null}>
      <BakedGate>
        <SurroundingsInner />
      </BakedGate>
    </Suspense>
  )
}

function SurroundingsInner() {
  return (
    <group>
      <Grounds />
      <Fence />
      <Props />
      {/* yalniz agac dokulari beklenir; zemin ve kafes hemen cizilir */}
      <Suspense fallback={null}>
        <Trees />
      </Suspense>
      <Buildings />
      {/* seyirciler: model yuklenemezse sahne cokmesin */}
      <ModelBoundary>
        <Suspense fallback={null}>
          <Spectators />
        </Suspense>
      </ModelBoundary>
    </group>
  )
}
