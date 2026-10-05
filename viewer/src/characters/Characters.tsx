// 8 oyuncu + 1 hakem: karakter render ve animasyon. Oyun durumunu yalniz OKUR (useFrame oncelik 0).
import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Animator, type BallLocal } from '../anim/animator'
import { ClothSystem, clothOn } from '../cloth'
import { diveOf, diveState, diveClock } from '../sim/keeperDive'
import { footTiming } from '../anim/events'
import { RigDriver } from '../anim/rig'
import { game } from '../game/store'
import { world } from '../sim'
import { isKitAtlas, KitMaterials, numberGeometry, numberMaterial, slotOf, type KitId } from './kit'
import { asset } from '../assetUrl'
import { trackStep } from '../ui/loadTracker'
import { setBodyPoints, BODY_N } from '../game/bodyPoints'
import { ctl } from '../control/store'
import { passHints } from '../ai/brain'
import { buildMannequin, MANNEQUIN_BACK } from './mannequin'

// uc gorunum: ana model, koyu tenli iri (v2), acik tenli ince (v3); ayni iskelet ve UV
export const VARIANTS = [
  { url: asset('futbolcu.glb'), lod: asset('futbolcu_lod1.glb'), scale: 1 },
  { url: asset('futbolcu_v2.glb'), lod: asset('futbolcu_v2_lod1.glb'), scale: 1.03 },
  { url: asset('futbolcu_v3.glb'), lod: asset('futbolcu_v3_lod1.glb'), scale: 0.98 },
  { url: asset('futbolcu_v4.glb'), lod: asset('futbolcu_v4_lod1.glb'), scale: 1 }, // kivircik kaleci
]
// oyuncu sirasina gore gorunum (takimlarda ve kalecilerde cesitlilik); hakem 1
const VARIANT_OF = [0, 1, 2, 1, 2, 0, 2, 1]
const REF_VARIANT = 1
const LOD_FAR = 21
const LOD_NEAR = 19
const HAND_RE = /^(hand|thumb|index|middle|ring|pinky)_/

/** govde geometrisine eldiven niteligi: el/parmak kemiklerinin toplam agirligi */
function addGloveAttr(mesh: THREE.SkinnedMesh) {
  const g = mesh.geometry
  if (g.getAttribute('aGlove')) return
  const si = g.getAttribute('skinIndex')
  const sw = g.getAttribute('skinWeight')
  if (!si || !sw) return
  const hand = mesh.skeleton.bones.map((b) => HAND_RE.test(b.name))
  const a = new Float32Array(si.count)
  for (let i = 0; i < si.count; i++) {
    let w = 0
    for (let k = 0; k < 4; k++) if (hand[si.getComponent(i, k)]) w += sw.getComponent(i, k)
    a[i] = w
  }
  g.setAttribute('aGlove', new THREE.BufferAttribute(a, 1))
}
const HEIGHT = 1.8

/** kaynak model: sahne + olcek + zemin; numara yeri */
export interface Source {
  scene: THREE.Object3D
  k: number // metre / model birimi
  groundY: number
  back: { y: number; z: number } // sirt numarasi (model uzayi)
  kind: 'glb' | 'manken'
  variant: number
  lod: string | null
}

export function mannequinSource(): Source {
  return { scene: buildMannequin(), k: 1, groundY: 0, back: MANNEQUIN_BACK, kind: 'manken', variant: 0, lod: null }
}

/** GLB rigli mi (MPFB/UE kemik adlari)? Degilse null -> manken */
export function glbSource(scene: THREE.Object3D, variant: number): Source | null {
  let skinned = false
  const bones = new Set<string>()
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true
    if ((o as THREE.Bone).isBone) bones.add(o.name)
  })
  if (!skinned || !bones.has('pelvis') || !bones.has('thigh_l') || !bones.has('upperarm_l')) return null
  scene.updateMatrixWorld(true)
  const inv = scene.matrixWorld.clone().invert()
  const box = new THREE.Box3()
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry.computeBoundingBox()
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld).applyMatrix4(inv))
  })
  const h = box.max.y - box.min.y
  const k = (h > 0 ? HEIGHT / h : 1) * VARIANTS[variant].scale
  // sirt: forma koseleri arasinda gogus yuksekliginde en arka nokta
  let backZ = Infinity
  const yMid = box.min.y + h * 0.72
  const v = new THREE.Vector3()
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    if (!mats.some((x) => slotOf(x.name) === 'jersey')) return
    const pos = m.geometry.attributes.position
    const mw = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mw)
      if (Math.abs(v.y - yMid) < h * 0.03 && Math.abs(v.x) < h * 0.04) backZ = Math.min(backZ, v.z)
    }
  })
  if (!isFinite(backZ)) backZ = -0.14 / k
  return { scene, k, groundY: box.min.y, back: { y: yMid, z: backZ - 0.004 / k }, kind: 'glb', variant, lod: VARIANTS[variant].lod }
}

export interface Char {
  root: THREE.Group
  kit: KitId
  lod0: THREE.Object3D[]
  lod1: THREE.Object3D[]
  lod: 0 | 1
  ax: number
  az: number
  ball: BallLocal
  shoulder: string
  variant: number
  rig: RigDriver
  anim: Animator
  x: number
  z: number
  f: number
  vx: number
  vz: number
  init: boolean
  card?: THREE.Mesh
}


// dalis klibi anahtar zamanlari: [itis sonu, temas, inis, kayma sonu] (actions.ts anahtarlariyla ayni)
const DIVE_KEYS: Record<string, [number, number, number, number]> = {
  '': [0.14, 0.4, 0.75, 1.0],
  '-low': [0.12, 0.4, 0.65, 1.0],
  '-high': [0.15, 0.4, 0.62, 1.2],
}
const DIVE_HAND: BallLocal = { x: 0, y: 1, z: 0, dive: true }

export const kitOf = (team: number, role: string): KitId =>
  team === 0 ? (role === 'kaleci' ? 'homeGK' : 'home') : role === 'kaleci' ? 'awayGK' : 'away'

// klonlar ayni yuzlu; ten ve sac tonu ile cesitlilik (carpan)
const SKIN_TONES = ['#ffffff', '#f0dccb', '#d9b49a', '#b98b6c']
const HAIR_TONES = ['#ffffff', '#7a5a40', '#4a3a30', '#2a2420']

export function makeChar(src: Source, kits: KitMaterials, kit: KitId, number: number | null, variant = 0): Char {
  // v2/v3 kendi ten ve sac tonunu tasir; yalniz ana modele ton carpani uygulanir
  const base = src.variant === 0
  const skin = base ? SKIN_TONES[variant % SKIN_TONES.length] : '#ffffff'
  const hair = base ? HAIR_TONES[(variant * 3 + 1) % HAIR_TONES.length] : '#ffffff'
  const model = skeletonClone(src.scene)
  let atlasNumber = false
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    m.receiveShadow = true
    m.frustumCulled = false // yatan/ucan pozlarda bind kutusu yetmez
    const keeper = kit === 'homeGK' || kit === 'awayGK'
    if (keeper && /govde/i.test((m.material as THREE.Material).name ?? '') && (m as THREE.SkinnedMesh).isSkinnedMesh) {
      addGloveAttr(m as THREE.SkinnedMesh)
    }
    const swap = (mat: THREE.Material) => {
      if (keeper && /govde/i.test(mat.name)) return kits.glove(mat, kit, skin)
      if (/govde/i.test(mat.name)) return kits.tint(mat, skin)
      if (/^sac/i.test(mat.name)) {
        let h = kits.tint(mat, hair) as THREE.MeshStandardMaterial
        // yakin plan karakterleri (hakem, kaleci) kendi kopyasini alir: esik yalniz onlarda 0,3
        if (kit === 'ref' || keeper) h = h.clone()
        // sac kartlari: on yuz. alphaToCoverage MSAA'siz zincirde benekli dither verir; alphaTest + SMAA yeter
        h.alphaToCoverage = false
        h.depthWrite = true
        h.side = THREE.FrontSide
        // alfa kesimi: dusuk esik + mip; seffaf pikseldeki beyaz sizinti kenarda benek yapmasin
        // gunes altinda kart yuzeyleri gri parlamasin
        h.roughness = 1
        h.metalness = 0
        h.envMapIntensity = 0.25
        h.alphaTest = kit === 'ref' || keeper ? 0.3 : 0.22
        h.transparent = false
        h.premultipliedAlpha = false
        if (h.map) {
          h.map.colorSpace = THREE.SRGBColorSpace
          h.map.generateMipmaps = true
          h.map.minFilter = THREE.LinearMipmapLinearFilter
          h.map.magFilter = THREE.LinearFilter
          h.map.anisotropy = Math.max(h.map.anisotropy, 8)
          h.map.needsUpdate = true
        }
        h.needsUpdate = true
        return h
      }
      if (isKitAtlas(mat.name)) {
        atlasNumber = true
        return kits.atlas(mat, kit, number, src.variant)
      }
      const s = slotOf(mat.name)
      return s ? kits.get(mat, kit, s) : mat
    }
    const tag = (mat: THREE.Material) => {
      const r = swap(mat)
      r.userData.srcName = mat.name
      return r
    }
    m.material = Array.isArray(m.material) ? m.material.map(tag) : tag(m.material)
  })
  const inner = new THREE.Group()
  inner.scale.setScalar(src.k)
  inner.add(model)
  const root = new THREE.Group()
  root.add(inner)
  const rig = new RigDriver(model, src.k, src.groundY)
  // karakter orijini pelvisin altindaki zemin noktasi
  const pel = rig.restModel('pelvis')
  if (pel) inner.position.set(-pel.p.x * src.k, -src.groundY * src.k, -pel.p.z * src.k)

  const chest = rig.bone('spine_03')
  const cr = rig.restModel('spine_03')
  if (number !== null && !atlasNumber && chest && cr) {
    // numara: model uzayindaki sirt noktasini gogus kemigi yerel uzayina tasi
    const s = 0.2 / src.k
    const plate = new THREE.Mesh(numberGeometry(number, s * 0.9, s), numberMaterial())
    const mm = new THREE.Matrix4().compose(cr.p, cr.q, new THREE.Vector3(1, 1, 1)).invert()
    plate.position.set(0, src.back.y, src.back.z).applyMatrix4(mm)
    // duzlem normali -z (arkaya) baksin
    plate.quaternion.copy(cr.q).invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI))
    plate.frustumCulled = false
    chest.add(plate)
  }
  const lod0: THREE.Object3D[] = []
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) lod0.push(o)
  })
  const ch: Char = {
    root, rig, kit, lod0, lod1: [], lod: 0, ax: 0, az: 0, ball: { x: 0, y: 0, z: 0 }, shoulder: 'shoulder-l', variant: src.variant,
    anim: new Animator(rig.dims), x: 0, z: 0, f: 0, vx: 0, vz: 0, init: false,
  }
  const hand = rig.bone('hand_r')
  const hr = rig.restModel('hand_r')
  if (kit === 'ref' && hand && hr) {
    // hakem karti: sag elde, kart animasyonunda gorunur
    const card = new THREE.Mesh(
      new THREE.BoxGeometry(0.068 / src.k, 0.095 / src.k, 0.003 / src.k),
      new THREE.MeshStandardMaterial({ color: '#f4d000', roughness: 0.5 }),
    )
    const mm = new THREE.Matrix4().compose(hr.p, hr.q, new THREE.Vector3(1, 1, 1)).invert()
    card.position.set(hr.p.x, hr.p.y - 0.12 / src.k, hr.p.z + 0.02 / src.k).applyMatrix4(mm)
    card.quaternion.copy(hr.q).invert()
    card.visible = false
    card.castShadow = true
    hand.add(card)
    ch.card = card
  }
  return ch
}

/** LOD1 meshlerini karakterin LOD0 iskeletine bagla (ayni kemik adlari, ayni malzemeler) */
function attachLod(c: Char, lodScene: THREE.Object3D) {
  if (!c.lod0.length || c.lod1.length) return
  const parent = c.lod0[0].parent!
  const mats = new Map<string, THREE.Material>()
  for (const o of c.lod0) {
    const m = (o as THREE.Mesh).material as THREE.Material
    mats.set(m.userData.srcName ?? m.name, m)
  }
  lodScene.traverse((o) => {
    const sm = o as THREE.SkinnedMesh
    if (!sm.isSkinnedMesh) return
    const bones = sm.skeleton.bones.map((b) => c.rig.bone(b.name))
    if (bones.some((b) => !b)) return
    const src = sm.material as THREE.Material
    const keeper = c.kit === 'homeGK' || c.kit === 'awayGK'
    if (keeper && /govde/i.test(src.name)) addGloveAttr(sm)
    const m = new THREE.SkinnedMesh(sm.geometry, mats.get(src.name) ?? src)
    m.name = sm.name + '_lod1'
    m.position.copy(sm.position)
    m.quaternion.copy(sm.quaternion)
    m.scale.copy(sm.scale)
    m.castShadow = true
    m.receiveShadow = true
    m.frustumCulled = false
    m.visible = c.lod === 1
    parent.add(m)
    m.bind(new THREE.Skeleton(bones as THREE.Bone[], sm.skeleton.boneInverses), sm.bindMatrix)
    c.lod1.push(m)
  })
}

function ctrlPlayer(ps: typeof game.players) {
  for (const p of ps) if (p.controlled) return p
  return null
}

// ofsayt vucut noktalari (kollar yok): kafa-ust, kafa, gogus, kalca, diz-l/r, bilek-l/r, ayak-ucu-l/r
const _pts = new Map<number, Float32Array>()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _d = new THREE.Vector3()
function writeBodyPoints(c: Char, id: number) {
  let pts = _pts.get(id)
  if (!pts) {
    pts = new Float32Array(BODY_N * 3)
    _pts.set(id, pts)
  }
  c.root.updateMatrixWorld(true)
  const put = (i: number, v: THREE.Vector3) => {
    pts![i * 3] = v.x
    pts![i * 3 + 1] = v.y
    pts![i * 3 + 2] = v.z
  }
  const W = (name: string, out: THREE.Vector3) => c.rig.bone(name)?.getWorldPosition(out)
  W('head', _a)
  W('neck_01', _b)
  _d.copy(_a).sub(_b)
  if (_d.lengthSq() < 1e-6) _d.set(0, 1, 0)
  _d.normalize()
  put(1, _a.clone().addScaledVector(_d, 0.07))
  put(0, _a.clone().addScaledVector(_d, 0.2))
  W('spine_03', _a)
  put(2, _a)
  W('pelvis', _a)
  put(3, _a)
  const sides = ['l', 'r']
  for (let s = 0; s < 2; s++) {
    const sd = sides[s]
    W(`calf_${sd}`, _a)
    put(4 + s, _a)
    W(`foot_${sd}`, _a)
    put(6 + s, _a)
    const ball = c.rig.bone(`ball_${sd}`)
    if (ball) {
      ball.getWorldPosition(_b)
      _d.copy(_b).sub(_a)
      if (_d.lengthSq() > 1e-6) _d.normalize()
      _b.addScaledVector(_d, 0.08)
      put(8 + s, _b)
    } else put(8 + s, _a)
  }
  setBodyPoints(id, pts)
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

function CharacterSet({ srcs }: { srcs: Source[] }) {
  const set = useMemo(() => {
    const kits = new KitMaterials()
    const pick = (v: number) => srcs[v] ?? srcs[0]
    const { chars, ref } = trackStep('karakter-kurulum', 'Karakterler', () => ({
      chars: game.players.map((p, i) => makeChar(pick(p.role === 'kaleci' ? (p.team === 0 ? 3 : 2) : VARIANT_OF[i % VARIANT_OF.length]), kits, kitOf(p.team, p.role), p.number, (i * 5 + 2) % 7)),
      ref: makeChar(pick(REF_VARIANT), kits, 'ref', null, 3),
    }), 1)
    const group = new THREE.Group()
    group.name = 'karakterler'
    for (const c of chars) group.add(c.root)
    group.add(ref.root)
    // kontrol halkasi ve top sahibi gostergesi
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.53, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
    )
    ring.position.y = 0.025
    ring.renderOrder = 2
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.15, 3).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    )
    group.add(ring, marker)
    // kumas (N): ?cloth=1 kapaliyken null
    const cloth = clothOn() ? new ClothSystem() : null
    for (const c of [...chars, ref]) cloth?.add(c.root)
    // pas halkalari: takim arkadasinin ayagi altinda ince halka (en cok 3)
    const hints = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.36, 0.4, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#46e07a', transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }),
      )
      m.position.y = 0.022
      m.renderOrder = 2
      m.visible = false
      group.add(m)
      return m
    })
    return { kits, chars, ref, group, ring, marker, cloth, hints }
  }, [srcs])

  useEffect(() => {
    Object.assign(window, { __chars: set })
    return () => {
      set.kits.dispose()
      set.cloth?.dispose()
    }
  }, [set])

  // LOD1: her gorunum icin arka planda yukle; yoksa ya da hata verirse yalniz LOD0
  useEffect(() => {
    let alive = true
    srcs.forEach((src, vi) => {
      if (src.kind !== 'glb' || !src.lod) return
      new GLTFLoader().load(
        src.lod,
        (g) => {
          if (!alive) return
          for (const c of [...set.chars, set.ref]) if (c.variant === vi) attachLod(c, g.scene)
        },
        undefined,
        () => {},
      )
    })
    return () => {
      alive = false
    }
  }, [set, srcs])

  // surme dokunusu: ayagi topa hizala
  useEffect(
    () =>
      game.on((e) => {
        if (e.type !== 'touch' || e.kind !== 'dribble') return
        const c = set.chars[e.player]
        if (!c) return
        const dx = world.ball.x - c.x
        const dz = world.ball.z - c.z
        const cf = Math.cos(c.f)
        const sf = Math.sin(c.f)
        c.anim.touch(dx * cf - dz * sf, dx * sf + dz * cf)
      }),
    [set],
  )

  useFrame((state, dt) => {
    const gdt = Math.min(dt, 0.1) * world.timeScale
    const cam = state.camera.position
    const step = (c: Char, s: { x: number; z: number; facing: number; anim: string; animT: number }, hasBall: boolean, id = -1) => {
      if (!c.init) {
        c.x = s.x
        c.z = s.z
        c.f = s.facing
        c.init = true
      }
      const px = c.x
      const pz = c.z
      const dx = s.x - c.x
      const dz = s.z - c.z
      if (dx * dx + dz * dz > 9) {
        c.x = s.x
        c.z = s.z
      } else {
        const a = Math.min(1, gdt * 30)
        c.x += dx * a
        c.z += dz * a
      }
      c.f += angDiff(c.f, s.facing) * Math.min(1, gdt * 14)
      if (gdt > 0) {
        const a = Math.min(1, gdt * 12)
        const ovx = c.vx
        const ovz = c.vz
        c.vx += ((c.x - px) / gdt - c.vx) * a
        c.vz += ((c.z - pz) / gdt - c.vz) * a
        // dunya ivmesi (donuste merkezcil bilesen dahil)
        const b = Math.min(1, gdt * 8)
        c.ax += ((c.vx - ovx) / gdt - c.ax) * b
        c.az += ((c.vz - ovz) / gdt - c.az) * b
      }
      const cf = Math.cos(c.f)
      const sf = Math.sin(c.f)
      const lvx = c.vx * cf - c.vz * sf
      const lvz = c.vx * sf + c.vz * cf
      const lax = c.ax * cf - c.az * sf
      const laz = c.ax * sf + c.az * cf
      const bx = world.ball.x - c.x
      const bz = world.ball.z - c.z
      c.ball.x = bx * cf - bz * sf
      c.ball.z = bx * sf + bz * cf
      c.ball.y = world.ball.y
      let anim = s.anim
      if (anim === 'shoulder') anim = c.shoulder
      // kaleci dalisi: klip fazi ve el hedefi B2'nin kinematiginden (animT yerine faz)
      let animT = s.animT
      let ballT: BallLocal = c.ball
      let diveHy: number | null = null
      const dm = id >= 0 ? /^keeper-dive(-low|-high)?-[lr]$/.exec(anim) : null
      const sp = dm ? diveOf(id) : undefined
      if (dm && sp && diveClock.t >= sp.t0 - 0.02) {
        const st = diveState(sp, diveClock.t)
        const k = DIVE_KEYS[dm[1] ?? '']
        const uc = Math.min(1, Math.max(0.05, (sp.tc - sp.tl) / Math.max(0.05, sp.tLand - sp.tl)))
        if (st.phase === 'push' || st.phase === 'ready') animT = Math.max(1e-3, st.u * k[0])
        else if (st.phase === 'flight') animT = st.u < uc ? k[0] + (k[1] - k[0]) * (st.u / uc) : k[1] + (k[2] - k[1]) * ((st.u - uc) / (1 - uc))
        else if (st.phase === 'slide') animT = k[2] + (k[3] - k[2]) * st.u
        else animT = k[3]
        if (st.phase === 'flight' || st.phase === 'slide') diveHy = -0.86 + ((st.y - 0.28) / (0.95 - 0.28)) * 0.86
        // el hedefi: dunya -> karakter uzayi (x sol, z ileri)
        const hx = st.hand.x - c.x
        const hz = st.hand.z - c.z
        const dcf = Math.cos(c.f)
        const dsf = Math.sin(c.f)
        DIVE_HAND.x = hx * dcf - hz * dsf
        DIVE_HAND.z = hx * dsf + hz * dcf
        DIVE_HAND.y = st.hand.y
        ballT = DIVE_HAND
      }
      const pose = c.anim.update(anim, animT, lvx, lvz, lax, laz, gdt, ballT, hasBall, diveHy)
      c.rig.apply(pose)
      c.root.position.set(c.x, 0, c.z)
      c.root.rotation.y = c.f
      // LOD: kameraya uzaklik (histerezisli)
      if (c.lod1.length) {
        const d = Math.hypot(cam.x - c.x, cam.y - 1, cam.z - c.z)
        const want = d > LOD_FAR ? 1 : d < LOD_NEAR ? 0 : c.lod
        if (want !== c.lod) {
          c.lod = want
          for (const o of c.lod0) o.visible = want === 0
          for (const o of c.lod1) o.visible = want === 1
        }
      }
    }
    const ps = game.players
    let owner: Char | null = null
    let ctrl: Char | null = null
    for (let i = 0; i < set.chars.length && i < ps.length; i++) {
      const c = set.chars[i]
      const p = ps[i]

      // omuz itisi: rakip hangi yanda (klip basinda bir kez)
      if (p.anim === 'shoulder' && p.animT < 0.05) {
        let best = 1e9
        for (const q of ps) {
          if (q.team === p.team || q.sentOff) continue
          const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2
          if (d < best) {
            best = d
            // sol (+x yerel) = dunyada (cos f, -sin f)
            const side = (q.x - p.x) * Math.cos(p.facing) - (q.z - p.z) * Math.sin(p.facing)
            c.shoulder = side >= 0 ? 'shoulder-l' : 'shoulder-r'
          }
        }
      }
      // atilan oyuncu gizlenmez: bas one egik yuruyerek cikar (konumu K yazar)
      // cezali oyuncu gorunur kalir: cikarken basi one egik yuruyus, kenarda beklerken idle (donuste F'nin jog'u)
      if (p.sentOff) step(c, { x: p.x, z: p.z, facing: p.facing, anim: Math.hypot(c.vx, c.vz) > 0.6 ? 'sent-off' : 'idle', animT: 0 }, false)
      else step(c, p, p.hasBall, p.role === 'kaleci' ? p.id : -1)
      // dokunus zamanlamasi (F okur)
      const ft = footTiming[p.id]
      if (ft) {
        ft.l = c.anim.contactIn(0)
        ft.r = c.anim.contactIn(1)
      }
      if (p.hasBall) owner = c
      if (p.controlled) ctrl = c
    }
    const r = game.referee
    step(set.ref, r, false)
    for (let i = 0; i < set.chars.length && i < ps.length; i++) writeBodyPoints(set.chars[i], ps[i].id)
    if (set.ref.card) {
      set.ref.card.visible = r.anim === 'card-yellow' || r.anim === 'card-red'
      ;(set.ref.card.material as THREE.MeshStandardMaterial).color.set(r.anim === 'card-red' ? '#d0161b' : '#f4d000')
    }
    // pas halkalari: insan topu surerken en iyi arkadaslar
    const ctp = ctrlPlayer(ps)
    const showHints = ctl.mode === 'mac' && ctl.passHints && game.match.phase === 'play' && !!ctp && ctp.hasBall
    for (let i = 0; i < set.hints.length; i++) {
      const m = set.hints[i]
      const h = showHints ? passHints[i] : undefined
      const q = h ? ps[h.id] : undefined
      m.visible = !!q
      if (!q || !h) continue
      m.position.set(q.x, 0.022, q.z)
      const mat = m.material as THREE.MeshBasicMaterial
      mat.color.set(h.q > 0.5 ? '#46e07a' : '#ffd23f')
      mat.opacity = 0.25 + 0.6 * h.q
    }
    set.ring.visible = !!ctrl
    if (ctrl) set.ring.position.set(ctrl.x, 0.025, ctrl.z)
    set.marker.visible = !!owner
    if (owner) {
      const t = performance.now() / 1000
      set.marker.position.set(owner.x, 2.12 + Math.sin(t * 4) * 0.03, owner.z)
      set.marker.rotation.y = t * 1.5
    }
    // kumas o karenin kemik pozunu okur: tum step'lerden sonra
    set.cloth?.update(state.gl, state.camera, dt, gdt)
  }, 0)

  return <primitive object={set.group} />
}

function GlbCharacters() {
  const scenes = useGLTF(VARIANTS.map((v) => v.url)) as unknown as { scene: THREE.Object3D }[]
  const srcs = useMemo(() => {
    const main = glbSource(scenes[0].scene, 0) ?? mannequinSource()
    return scenes.map((g, i) => (i === 0 ? main : (main.kind === 'glb' && glbSource(g.scene, i)) || main))
  }, [scenes])
  return <CharacterSet srcs={srcs} />
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { err: boolean }> {
  state = { err: false }
  static getDerivedStateFromError() {
    return { err: true }
  }
  componentDidCatch(e: unknown) {
    console.warn('karakter modeli yuklenemedi, manken kullaniliyor', e)
  }
  render() {
    return this.state.err ? this.props.fallback : this.props.children
  }
}

let mannequin: Source | null = null
function Mannequins() {
  const src = useMemo(() => (mannequin ??= mannequinSource()), [])
  return <CharacterSet srcs={[src]} />
}

/** tum karakterler; ?char=manken ile rigli GLB atlanir */
export function Characters() {
  const forceMannequin = new URLSearchParams(location.search).get('char') === 'manken'
  if (forceMannequin) return <Mannequins />
  return (
    <Boundary fallback={<Mannequins />}>
      <Suspense fallback={<Mannequins />}>
        <GlbCharacters />
      </Suspense>
    </Boundary>
  )
}

// test/ayiklama icin oyun durumuna erisim
Object.assign(window, { __game: game })
