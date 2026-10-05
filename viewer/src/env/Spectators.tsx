import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { applySpec, Pose, type PoseSpec } from '../anim/pose'
import { RigDriver, type Dims } from '../anim/rig'
import { asset } from '../assetUrl'
import { game } from '../game/store'
import { world } from '../sim'
import { BENCH, DUGOUT, FENCE_Z, TRIBUNE } from './colliders'
import { QUALITY } from './quality'

// Seyirciler: E'nin LOD1 modeli (8,7 k ucgen) birkac poza CPU'da bir kez "pisirilir";
// her poz tek InstancedMesh. Kiyafet duz renk varyantlari ornek basina (instanced attribute),
// tek ortak malzeme. Canlilik: poz degisimi, el sallama, hafif salinim, golde ayaga kalkip sevinc.

const URL = asset('futbolcu_lod1.glb')
const HEIGHT = 1.78

// --- pozlar ---
const POSES = ['stand', 'cross', 'hips', 'waveA', 'waveB', 'cheer', 'sit', 'sitWave'] as const
type PoseId = (typeof POSES)[number]
const SEAT = 0.44 // oturak yuksekligi (ayak tabanina gore)
// ?seyirci=sevinc: test icin surekli gol sevinci
const FORCE_CHEER = new URLSearchParams(location.search).get('seyirci') === 'sevinc'

function poseSpecs(d: Dims): Record<PoseId, PoseSpec> {
  const feet: PoseSpec = { 'B.ik': 1, 'B.x': d.hipW + 0.03, 'B.y': d.ankleH, 'B.z': 0, 'B.yaw': 0.18 }
  const relaxed: PoseSpec = { 'BA.abd': 0.13, 'BA.elbow': 0.2, 'BA.flex': 0.05 }
  const sit: PoseSpec = {
    hy: SEAT + 0.1 - d.hipH,
    hz: -0.02,
    sp: 0.14,
    np: 0.12,
    'B.ik': 1,
    'B.x': d.hipW + 0.05,
    'B.y': d.ankleH,
    'B.z': 0.44,
    'B.yaw': 0.12,
  }
  return {
    stand: { ...feet, ...relaxed },
    cross: {
      ...feet,
      'BA.ik': 1,
      'LA.tx': -0.1,
      'LA.ty': 1.2,
      'LA.tz': 0.2,
      'RA.tx': 0.11,
      'RA.ty': 1.24,
      'RA.tz': 0.19,
    },
    hips: { ...feet, hr: 0.04, 'BA.ik': 1, 'LA.tx': 0.21, 'LA.ty': 1.0, 'LA.tz': 0.02, 'RA.tx': -0.21, 'RA.ty': 1.0, 'RA.tz': 0.02 },
    waveA: { ...feet, ...relaxed, 'RA.flex': 2.65, 'RA.abd': 0.55, 'RA.elbow': 0.45, nyaw: -0.1 },
    waveB: { ...feet, ...relaxed, 'RA.flex': 2.55, 'RA.abd': 0.12, 'RA.elbow': 1.0, nyaw: -0.1 },
    cheer: { ...feet, sp: -0.12, np: -0.3, 'BA.flex': 2.85, 'BA.abd': 0.5, 'BA.elbow': 0.3, 'LA.flex': 2.6 },
    sit: { ...sit, 'BA.ik': 1, 'LA.tx': 0.16, 'LA.ty': SEAT + 0.2, 'LA.tz': 0.3, 'RA.tx': -0.16, 'RA.ty': SEAT + 0.2, 'RA.tz': 0.3 },
    sitWave: { ...sit, 'LA.ik': 1, 'LA.tx': 0.16, 'LA.ty': SEAT + 0.2, 'LA.tz': 0.3, 'RA.flex': 2.6, 'RA.abd': 0.4, 'RA.elbow': 0.6 },
  }
}

// --- kiyafet bolgeleri: 0 ten, 1 ust, 2 alt, 3 corap, 4 ayakkabi, 5 sac ---
// Kiyafet atlasi (human/kit_layout.json, Blender UV): Forma v>=0.4; Sort u<0.45; Tozluk u<0.67; Krampon u>=0.67 v<0.2
function kitPart(u: number, vGltf: number) {
  const v = 1 - vGltf
  if (v >= 0.4) return 1
  if (u < 0.45) return 2
  if (u < 0.67) return 3
  if (v < 0.2) return 4
  return 1
}

type Baked = { geos: Record<PoseId, THREE.BufferGeometry>; skinMap: THREE.Texture | null; hairMap: THREE.Texture | null }

function bake(scene: THREE.Object3D): Baked | null {
  const model = skeletonClone(scene)
  model.updateMatrixWorld(true)
  const meshes: THREE.SkinnedMesh[] = []
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh)
  })
  if (!meshes.length) return null
  const inv = model.matrixWorld.clone().invert()
  const box = new THREE.Box3()
  for (const m of meshes) {
    m.geometry.computeBoundingBox()
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld).applyMatrix4(inv))
  }
  const k = HEIGHT / (box.max.y - box.min.y)
  const rig = new RigDriver(model, k, box.min.y)
  if (!rig.ok) return null
  const pel = rig.restModel('pelvis')!
  const origin = new THREE.Vector3(pel.p.x, box.min.y, pel.p.z)
  const specs = poseSpecs(rig.dims)

  let skinMap: THREE.Texture | null = null
  let hairMap: THREE.Texture | null = null
  const partOf = (m: THREE.SkinnedMesh) => {
    const name = (m.material as THREE.Material).name
    if (/govde/i.test(name)) {
      skinMap = (m.material as THREE.MeshStandardMaterial).map
      return 'skin'
    }
    if (/sac|hair/i.test(name)) {
      hairMap = (m.material as THREE.MeshStandardMaterial).map
      return 'hair'
    }
    return 'kit'
  }
  const kinds = meshes.map(partOf)

  const geos = {} as Record<PoseId, THREE.BufferGeometry>
  // bacak maskesi: ayakta pozda kalca altindaki ten vertex'leri pantolon rengini alir (poz pisirmesi degismez)
  const legs: boolean[] = []
  const v = new THREE.Vector3()
  const vn = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (const id of POSES) {
    rig.apply(applySpec(new Pose(), specs[id]))
    model.updateMatrixWorld(true)
    const pos: number[] = []
    const nor: number[] = []
    const uv: number[] = []
    const part: number[] = []
    const idx: number[] = []
    let vi = 0
    meshes.forEach((m, mi) => {
      const g = m.geometry
      const P = g.attributes.position
      const N = g.attributes.normal
      const U = g.attributes.uv
      const toModel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)
      const base = pos.length / 3
      for (let i = 0; i < P.count; i++) {
        m.getVertexPosition(i, v)
        // normal: kucuk ofsetli noktanin deri donusumu ile
        n.fromBufferAttribute(N, i)
        vn.fromBufferAttribute(P, i).addScaledVector(n, 0.01 / k)
        m.applyBoneTransform(i, vn)
        vn.sub(v).normalize().transformDirection(toModel)
        v.applyMatrix4(toModel).sub(origin).multiplyScalar(k)
        pos.push(v.x, v.y, v.z)
        nor.push(vn.x, vn.y, vn.z)
        const u = U ? U.getX(i) : 0
        const w = U ? U.getY(i) : 0
        uv.push(u, w)
        if (id === POSES[0]) legs[vi] = kinds[mi] === 'skin' && v.y < HEIGHT * 0.47 && Math.abs(v.x) < 0.17
        part.push(kinds[mi] === 'skin' ? (legs[vi] ? 2 : 0) : kinds[mi] === 'hair' ? 5 : kitPart(u, w))
        vi++
      }
      const I = g.index
      if (I) for (let i = 0; i < I.count; i++) idx.push(base + I.getX(i))
      else for (let i = 0; i < P.count; i++) idx.push(base + i)
    })
    const bg = new THREE.BufferGeometry()
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    bg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    bg.setAttribute('part', new THREE.Float32BufferAttribute(part, 1))
    bg.setIndex(idx)
    bg.computeBoundingSphere()
    geos[id] = bg
  }
  return { geos, skinMap, hairMap }
}

// Tek ortak malzeme: ten bolgesi govde dokusu x ten tonu, digerleri ornek rengi
function spectatorMaterial(skinMap: THREE.Texture | null, hairMap: THREE.Texture | null) {
  const m = new THREE.MeshStandardMaterial({ map: skinMap, roughness: 0.78, metalness: 0 })
  m.onBeforeCompile = (s) => {
    // sac seritleri: alfa maskesi (alphaMode MASK, kesim 0.3) hair dokusundan
    s.uniforms.hairMap = { value: hairMap }
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float part;
attribute vec3 iSkin; attribute vec3 iTop; attribute vec3 iBottom; attribute vec3 iSocks; attribute vec3 iHair;
varying vec3 vTint; varying float vPart;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vPart = part;
vTint = part < 0.5 ? iSkin : part < 1.5 ? iTop : part < 2.5 ? iBottom : part < 3.5 ? iSocks : part < 4.5 ? vec3(0.03) : iHair;`,
      )
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint; varying float vPart;\nuniform sampler2D hairMap;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
#else
  vec4 sampledDiffuseColor = vec4( 1.0 );
#endif
  vec3 tintCol = vTint;
  if (vPart > 4.5) {
    vec4 hs = texture2D( hairMap, vMapUv );
    if (hs.a < 0.3) discard;
    tintCol = vTint * clamp(dot(hs.rgb, vec3(0.333)) * 2.4 + 0.35, 0.4, 1.6);
  }
  diffuseColor.rgb *= vPart < 0.5 ? sampledDiffuseColor.rgb * vTint : tintCol;`,
      )
  }
  m.customProgramCacheKey = () => 'seyirci-v2'
  return m
}

// --- yerlesim ---
type Spot = {
  x: number
  y: number
  z: number
  rot: number
  seated: boolean
  base: PoseId
  // ayaga kalkinca durulacak nokta (oturanlar icin)
  up: [number, number, number]
}

function spots(): Spot[] {
  const out: Spot[] = []
  const T = TRIBUNE
  const front = (i: number) => T.z0 - T.depth * (i - 1) // basamak i on kenari (z)
  // oturan: pelvis basamak i ustunde, ayaklar basamak i-1 ustunde (ileride)
  const seat = (x: number, i: number, base: PoseId = 'sit') => {
    const z = front(i) - 0.36
    out.push({ x, y: T.rise * (i - 1) + (T.rise - SEAT), z, rot: 0, seated: true, base, up: [x, T.rise * i, z] })
  }
  const stand = (x: number, y: number, z: number, rot: number, base: PoseId) =>
    out.push({ x, y, z, rot, seated: false, base, up: [x, y, z] })
  seat(-8.2, 1)
  seat(-3.6, 1)
  seat(2.2, 1, 'sitWave')
  seat(7.3, 1)
  seat(-6.1, 2)
  seat(0.4, 2)
  seat(4.7, 2)
  seat(9.1, 2)
  stand(-9.6, T.rise * 3, front(3) - 0.4, 0.15, 'cross')
  stand(-1.7, T.rise * 3, front(3) - 0.45, -0.1, 'hips')
  stand(13.6, 0, -(FENCE_Z + 0.75), -0.25, 'cross')
  stand(-13.9, 0, -(FENCE_Z + 0.75), 0.3, 'stand')
  // yedekler bankta ve kulubede (sahaya, -z yonune bakar)
  const bench = (x: number, z: number) =>
    out.push({ x, y: 0.45 - SEAT, z, rot: Math.PI, seated: true, base: 'sit', up: [x, 0, z - 0.4] })
  bench(BENCH.x - 0.6, BENCH.z)
  bench(BENCH.x + 0.55, BENCH.z)
  bench(DUGOUT.x - 1.1, DUGOUT.z + 0.2)
  bench(DUGOUT.x + 0.9, DUGOUT.z + 0.2)
  return out
}

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const TOPS = ['#1d2a44', '#5d6066', '#e9e7e1', '#17181a', '#8a2433', '#2e6a3f', '#d6a21e', '#7fa6c9', '#d01428', '#3b4fc0', '#c4c0b6', '#7a4a2c', '#e8742a', '#2aa6a0', '#8a4fb0']
const BOTTOMS = ['#2a2c30', '#1c2233', '#3c4f6e', '#8a7a5c', '#121212', '#4a4d52', '#6a8fb8']
const SOCKS = ['#e8e6e0', '#151515', '#7a7a7a']
const HAIR = ['#120d0a', '#2a1a10', '#5a3a20', '#7a5230', '#a8793f', '#d2ad6a', '#9a4a24', '#6c6a66']
const SKIN = [
  [1, 1, 1],
  [0.92, 0.86, 0.8],
  [0.78, 0.68, 0.6],
  [1.04, 0.98, 0.94],
  [0.62, 0.52, 0.46],
]

type Live = Spot & {
  pose: PoseId
  cols: number[] // 15 sayi: ten, ust, alt, corap, sac (dogrusal)
  scale: number
  phase: number
  next: number // sonraki durus degisimi (s)
  waveUntil: number
}

export function Spectators() {
  const { scene } = useGLTF(URL)
  const baked = useMemo(() => bake(scene), [scene])
  const material = useMemo(() => spectatorMaterial(baked?.skinMap ?? null, baked?.hairMap ?? null), [baked])

  const people = useMemo<Live[]>(() => {
    const r = rng(17)
    const c = new THREE.Color()
    const lin = (hex: string) => c.set(hex).toArray()
    // dusuk kalitede seyirci sayisi yariya iner
    return spots().filter((_, i) => QUALITY !== 'low' || i % 2 === 0).map((s) => {
      const sk = SKIN[Math.floor(r() * SKIN.length)]
      const bottom = lin(BOTTOMS[Math.floor(r() * BOTTOMS.length)])
      const cols = [
        ...sk,
        ...lin(TOPS[Math.floor(r() * TOPS.length)]),
        ...bottom,
        ...lin(SOCKS[Math.floor(r() * SOCKS.length)]),
        ...lin(HAIR[Math.floor(r() * HAIR.length)]),
      ]
      return { ...s, pose: s.base, cols, scale: 0.94 + r() * 0.1, phase: r() * 6.28, next: 4 + r() * 10, waveUntil: 0 }
    })
  }, [])

  // her poz icin InstancedMesh + ornek renk ozellikleri
  const meshes = useMemo(() => {
    if (!baked) return null
    const N = people.length
    return POSES.map((id) => {
      // kopya: StrictMode memo'yu iki kez cagirir, ornek ozellikleri bu kopyaya baglanir
      const g = baked.geos[id].clone()
      const attrs = ['iSkin', 'iTop', 'iBottom', 'iSocks', 'iHair'].map((name) => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3)
        a.setUsage(THREE.DynamicDrawUsage)
        g.setAttribute(name, a)
        return a
      })
      const im = new THREE.InstancedMesh(g, material, N)
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      im.castShadow = true
      im.receiveShadow = true
      im.frustumCulled = false
      im.count = 0
      im.visible = false
      im.name = 'seyirci-' + id
      return { id, im, attrs }
    })
  }, [baked, material, people.length])

  // gol: herkes ayaga kalkip sevinir
  const goalAt = useRef(-100)
  const clock = useRef(0)
  useEffect(() => {
    const hit = () => {
      if (clock.current - goalAt.current > 2) goalAt.current = clock.current
    }
    const a = world.onEvent((e) => {
      if (e.type === 'gol') hit()
    })
    const b = game.on((e) => {
      if (e.type === 'goal') hit()
    })
    return () => {
      a()
      b()
    }
  }, [])

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), [])
  const rand = useMemo(() => rng(99), [])

  useFrame((_, dtRaw) => {
    if (!meshes) return
    const dt = Math.min(dtRaw, 0.1)
    const t = (clock.current += dt)
    const cheering = FORCE_CHEER || t - goalAt.current < 4.5
    const counts = new Array(POSES.length).fill(0)
    const { m, q, p, s, up } = tmp

    for (const h of people) {
      // durus degisimi ve ara sira el sallama
      if (!cheering && t > h.next) {
        h.next = t + 6 + rand() * 12
        if (rand() < 0.3) h.waveUntil = t + 1.8 + rand() * 1.5
        else if (!h.seated) h.base = (['stand', 'cross', 'hips'] as const)[Math.floor(rand() * 3)]
      }
      let pose: PoseId = h.base
      let x = h.x
      let y = h.y
      let z = h.z
      let jump = 0
      if (cheering) {
        pose = 'cheer'
        ;[x, y, z] = h.up
        jump = 0.11 * Math.max(0, Math.sin((t - goalAt.current) * 7.5 + h.phase))
      } else if (t < h.waveUntil) {
        const f = Math.floor((t * 3.2 + h.phase) % 2)
        pose = h.seated ? 'sitWave' : f ? 'waveA' : 'waveB'
      }
      h.pose = pose
      const k = POSES.indexOf(pose)
      const slot = meshes[k]
      const i = counts[k]++
      // hafif salinim: govde yonu ve nefes
      q.setFromAxisAngle(up, h.rot + 0.05 * Math.sin(t * 0.37 + h.phase))
      const breath = 1 + 0.006 * Math.sin(t * 1.6 + h.phase)
      m.compose(p.set(x, y + jump, z), q, s.set(h.scale, h.scale * breath, h.scale))
      slot.im.setMatrixAt(i, m)
      for (let a = 0; a < 5; a++) slot.attrs[a].setXYZ(i, h.cols[a * 3], h.cols[a * 3 + 1], h.cols[a * 3 + 2])
    }
    meshes.forEach((slot, k) => {
      slot.im.count = counts[k]
      slot.im.visible = counts[k] > 0
      if (counts[k]) {
        slot.im.instanceMatrix.needsUpdate = true
        for (const a of slot.attrs) a.needsUpdate = true
      }
    })
  })

  if (!meshes) return null
  return (
    <group name="seyirciler">
      {meshes.map((s) => (
        <primitive key={s.id} object={s.im} />
      ))}
    </group>
  )
}
