import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GOAL_H, GOAL_W, NET_D_BOTTOM, NET_D_TOP, POST_R } from '../pitch'
import { goalPoint } from '../sim'
import { noise3, sweepTube } from './sweep'

// Profil: 120x100 mm oval aluminyum (derinlik yonunde uzun); arka cerceve 50 mm celik boru
const POST_RD = 0.06
const POST_RW = POST_R
const BACK_R = 0.024

let texCache: { paint: THREE.CanvasTexture; rough: THREE.CanvasTexture; steel: THREE.CanvasTexture } | null =
  null

// Boya: hafif kirli beyaz, boyuna cizikler; puruzluluk haritasi ayni cizikleri izler
function textures() {
  if (texCache) return texCache
  const S = 512
  const mk = () => {
    const c = document.createElement('canvas')
    c.width = c.height = S
    return [c, c.getContext('2d')!] as const
  }
  const [pc, p] = mk()
  const [rc, r] = mk()
  p.fillStyle = '#ffffff'
  p.fillRect(0, 0, S, S)
  r.fillStyle = 'rgb(92,92,92)'
  r.fillRect(0, 0, S, S)
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const a = Math.random() * 0.14 + 0.01
    p.fillStyle = `rgba(${150 + Math.random() * 40},${150 + Math.random() * 40},${140 + Math.random() * 30},${a})`
    p.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 3)
  }
  for (let i = 0; i < 260; i++) {
    // cizik: v (boy) yonunde ince uzun
    const x = Math.random() * S
    const y = Math.random() * S
    const L = 6 + Math.random() * 60
    const dx = (Math.random() - 0.5) * 6
    p.strokeStyle = `rgba(120,120,115,${0.08 + Math.random() * 0.2})`
    r.strokeStyle = `rgba(200,200,200,${0.4 + Math.random() * 0.4})`
    for (const ctx of [p, r]) {
      ctx.lineWidth = Math.random() < 0.8 ? 0.6 : 1.4
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + dx, y + L)
      ctx.stroke()
    }
  }
  const [sc, s] = mk()
  // galvaniz: gri pullu yuzey
  s.fillStyle = '#9a9ea3'
  s.fillRect(0, 0, S, S)
  for (let i = 0; i < 9000; i++) {
    const v = 120 + Math.random() * 70
    s.fillStyle = `rgba(${v},${v + 3},${v + 6},0.35)`
    const w = 2 + Math.random() * 7
    s.fillRect(Math.random() * S, Math.random() * S, w, w * (0.5 + Math.random()))
  }
  for (let i = 0; i < 300; i++) {
    s.fillStyle = `rgba(90,70,50,${Math.random() * 0.12})`
    s.beginPath()
    s.arc(Math.random() * S, Math.random() * S, 2 + Math.random() * 10, 0, 7)
    s.fill()
  }
  const wrap = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  texCache = { paint: wrap(pc, true), rough: wrap(rc, false), steel: wrap(sc, true) }
  // u: cevre (0..1), v: metre; 1 doku = 0.6 m boy
  texCache.paint.repeat.set(1, 1 / 0.6)
  texCache.rough.repeat.set(1, 1 / 0.6)
  texCache.steel.repeat.set(1, 1 / 0.5)
  return texCache
}

type V3 = [number, number, number]
const v3 = (a: V3) => new THREE.Vector3(...a)

// Zemine yakin cim/toprak lekesi + seyrek lekeler
function grime(p: THREE.Vector3): number {
  const ground = 1 - THREE.MathUtils.smoothstep(p.y, 0.0, 0.45)
  const blot = THREE.MathUtils.smoothstep(noise3(p.x * 3, p.y * 3, p.z * 3), 0.62, 0.9)
  return Math.min(1, ground * 0.9 + blot * 0.35)
}

export function GoalFrame({ side }: { side: 1 | -1 }) {
  const hw = GOAL_W / 2
  const H = GOAL_H
  const Db = NET_D_BOTTOM
  const Dt = NET_D_TOP
  const tex = textures()

  const parts = useMemo(() => {
    const p = (d: number, y: number, w: number) => v3(goalPoint(side, d, y, w))
    // ana cerceve: tek parca, ust koseler gonye kaynakli
    const main = sweepTube({
      pts: [p(0, 0, -hw), p(0, H, -hw), p(0, H, hw), p(0, 0, hw)],
      B: new THREE.Vector3(1, 0, 0),
      rB: POST_RD,
      rN: POST_RW,
      seg: 32,
      grime,
    })
    // direk tepesinde oval kesitin altina gizli kalan uc kapak gerekmez; alt uclar zemine gomulu
    const yb = BACK_R * 0.7 // zemin borusu cimin icinde oturur
    const back: THREE.BufferGeometry[] = []
    for (const w of [-hw, hw]) {
      back.push(
        sweepTube({
          pts: [p(0.03, H - 0.03, w), p(Dt, H - 0.026, w), p(Db, yb, w), p(0.05, yb, w)],
          B: new THREE.Vector3(0, 0, 1),
          rB: BACK_R,
          rN: BACK_R,
          seg: 16,
          step: 0.3,
          grime,
        }),
      )
    }
    back.push(
      sweepTube({ pts: [p(Dt, H - 0.026, -hw), p(Dt, H - 0.026, hw)], B: new THREE.Vector3(0, 1, 0), rB: BACK_R, rN: BACK_R, seg: 16, step: 0.3 }),
      sweepTube({ pts: [p(Db, yb, -hw), p(Db, yb, hw)], B: new THREE.Vector3(0, 1, 0), rB: BACK_R, rN: BACK_R, seg: 16, step: 0.3, grime }),
    )
    // zemin kaziklari celik govdeye katilir (koyu tonu kose rengiyle)
    for (const w of [-hw, hw]) {
      const g = pegGeometry()
      const c = new Float32Array(g.attributes.position.count * 3).fill(0.62)
      g.setAttribute('color', new THREE.BufferAttribute(c, 3))
      g.rotateY(Math.PI / 2)
      const at = goalPoint(side, Db * 0.55, 0, w)
      g.translate(at[0], 0, at[2])
      back.push(g)
    }
    // tek cizim: tum celik parcalar
    const steelGeo = mergeGeometries(back)!
    back.forEach((g) => g.dispose())
    const anchors = mergeGeometries(
      [-hw + 0.3, hw - 0.3].map((w) => {
        const at = goalPoint(side, Db + 0.02, 0, w)
        return anchorGeometry().translate(at[0], BACK_R * 0.7 - 0.004, at[2])
      }),
    )!
    return { main, steelGeo, anchors }
  }, [side, hw, H, Db, Dt])

  useEffect(
    () => () => {
      parts.main.dispose()
      parts.steelGeo.dispose()
      parts.anchors.dispose()
    },
    [parts],
  )

  const paint = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#f4f4ef',
        map: tex.paint,
        roughnessMap: tex.rough,
        roughness: 0.55,
        metalness: 0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.28,
        vertexColors: true,
      }),
    [tex],
  )
  const steel = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#c9ccd0',
        map: tex.steel,
        roughness: 0.48,
        metalness: 0.35,
        vertexColors: true,
      }),
    [tex],
  )

  return (
    <group>
      <mesh geometry={parts.main} material={paint} castShadow receiveShadow />
      <mesh geometry={parts.steelGeo} material={steel} castShadow receiveShadow />
      <mesh geometry={parts.anchors} castShadow receiveShadow>
        <meshStandardMaterial color="#26282a" roughness={0.88} metalness={0} />
      </mesh>
      <Clips side={side} />
    </group>
  )
}

// Ag klipsleri (direk/ust direk/arka cerceve): tek instanced cizim
function Clips({ side }: { side: 1 | -1 }) {
  const hw = GOAL_W / 2
  const H = GOAL_H
  const Db = NET_D_BOTTOM
  const Dt = NET_D_TOP

  const clips = useMemo(() => {
    const mats: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const m = new THREE.Matrix4()
    const add = (pos: V3, axis: THREE.Vector3, face: THREE.Vector3, sx: number, sy: number) => {
      // halka ekseni boru ekseni; yari halka aga (face) bakar
      const z = axis.clone().normalize()
      const x = face.clone().normalize()
      const y = new THREE.Vector3().crossVectors(z, x)
      m.makeBasis(x, y, z)
      q.setFromRotationMatrix(m)
      mats.push(new THREE.Matrix4().compose(v3(pos), q, new THREE.Vector3(sx, sy, 1)))
    }
    const back = new THREE.Vector3(side, 0, 0)
    const STEP = 0.34
    for (const w of [-hw, hw]) {
      for (let y = 0.15; y < H - 0.1; y += STEP) add(goalPoint(side, 0, y, w), new THREE.Vector3(0, 1, 0), back, 1.03, 0.86)
    }
    for (let w = -hw + 0.2; w < hw - 0.1; w += STEP)
      add(goalPoint(side, 0, H, w), new THREE.Vector3(0, 0, 1), back, 1.03, 0.86)
    const ring = BACK_R / POST_RD
    for (let w = -hw + 0.25; w < hw - 0.1; w += STEP * 1.5) {
      add(goalPoint(side, Dt, H - 0.026, w), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-side, -0.3, 0), ring * 1.1, ring * 1.1)
      add(goalPoint(side, Db, BACK_R * 0.7, w), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-side, 0.6, 0), ring * 1.1, ring * 1.1)
    }
    return mats
  }, [side, hw, H, Db, Dt])

  const clipGeo = useMemo(() => new THREE.TorusGeometry(POST_RD + 0.004, 0.0045, 6, 18, Math.PI * 0.9).rotateZ(-Math.PI * 0.45), [])
  const clipMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.55 }), [])

  return (
    <>
      <instancedMesh
        args={[clipGeo, clipMat, clips.length]}
        castShadow
        ref={(im) => {
          if (!im) return
          clips.forEach((mm, i) => im.setMatrixAt(i, mm))
          im.instanceMatrix.needsUpdate = true
        }}
      />
    </>
  )
}

// Kaucuk kaplamali ankraj agirligi: arka zemin borusunun ustune oturan U profil
function anchorGeometry(): THREE.BufferGeometry {
  {
    const shape = new THREE.Shape()
    const w = 0.16
    const h = 0.085
    const r = 0.03
    shape.moveTo(-w / 2, 0)
    shape.lineTo(-w / 2, h - r)
    shape.quadraticCurveTo(-w / 2, h, -w / 2 + r, h)
    shape.lineTo(w / 2 - r, h)
    shape.quadraticCurveTo(w / 2, h, w / 2, h - r)
    shape.lineTo(w / 2, 0)
    shape.lineTo(BACK_R + 0.006, 0)
    shape.absarc(0, 0, BACK_R + 0.006, 0, Math.PI, false)
    shape.lineTo(-w / 2, 0)
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 10 })
    g.translate(0, 0, -0.21)
    return g.index ? g : mergeable(g)
  }
}

// U kazik: yan zemin borusunu sahaya sabitler
function pegGeometry(): THREE.BufferGeometry {
  {
    const path = new THREE.CurvePath<THREE.Vector3>()
    const r = BACK_R + 0.008
    path.add(new THREE.LineCurve3(new THREE.Vector3(-r, -0.05, 0), new THREE.Vector3(-r, 0.02, 0)))
    path.add(
      new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-r, 0.02, 0),
        new THREE.Vector3(0, 0.02 + r * 2.2, 0),
        new THREE.Vector3(r, 0.02, 0),
      ),
    )
    path.add(new THREE.LineCurve3(new THREE.Vector3(r, 0.02, 0), new THREE.Vector3(r, -0.05, 0)))
    return new THREE.TubeGeometry(path, 24, 0.0045, 8, false)
  }
}

// Indekssiz geometriyi birlestirilebilir yap (Extrude indekssiz uretir)
function mergeable(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.attributes.position.count
  g.setIndex(Array.from({ length: n }, (_, i) => i))
  return g
}
