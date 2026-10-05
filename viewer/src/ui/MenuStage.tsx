// Menu sahnesi: sagda aksam ustu cimde top sektiren oyuncu. Bagimsiz kucuk Canvas; ana oyun Canvas'ina dokunmaz.
// Top kinematik (deterministik parabol), ayak/uyluk/kafa IK ile topa hizali. Menu kapaninca bilesen unmount edilir.
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { DPR, QUALITY } from '../env/quality'
import { KitMaterials, type KitId } from '../characters/kit'
import { glbSource, makeChar, mannequinSource, VARIANTS, type Char, type Source } from '../characters/Characters'

export interface MenuStageProps {
  kit?: KitId // varsayilan 'home'
  variant?: number // 0 ana, 1 v2, 2 v3
  paused?: boolean
}

const G = 9.81
const BALL_R = 0.11

// ---------------------------------------------------------------- vurus dizisi
type Kind = 'r' | 'l' | 'tr' | 'tl' | 'head' | 'xr' | 'xl' // x: ayak ustunde durdurma
const POS: Record<Kind, [number, number, number]> = {
  r: [-0.12, 0.3, 0.36],
  l: [0.12, 0.3, 0.36],
  tr: [-0.1, 1.07, 0.24],
  tl: [0.1, 1.07, 0.24],
  head: [0, 1.72, 0.18],
  xr: [-0.12, 0.42, 0.36],
  xl: [0.12, 0.42, 0.36],
}
const SEQ: Kind[] = ['r', 'l', 'r', 'l', 'tr', 'l', 'r', 'head', 'r', 'l', 'tl', 'r', 'l', 'xr', 'l', 'r']
const HOLD = 0.5 // durdurma suresi (s)

interface Ev {
  kind: Kind
  ta: number // topun temasa geldigi an
  td: number // topun ayrildigi an (durdurmada ta + HOLD)
  p: THREE.Vector3
}

const flight = (a: Kind, b: Kind) => (a === 'head' || b === 'head' ? 0.95 : a === 'tr' || a === 'tl' || b === 'tr' || b === 'tl' ? 0.78 : a[0] === 'x' ? 0.85 : 0.8)

function buildEvents() {
  const evs: Ev[] = []
  let t = 0.6
  SEQ.forEach((k, i) => {
    const hold = k[0] === 'x' ? HOLD : 0
    evs.push({ kind: k, ta: t, td: t + hold, p: new THREE.Vector3(...POS[k]) })
    t += hold + flight(k, SEQ[(i + 1) % SEQ.length])
  })
  return { evs, period: t - 0.6 }
}

/** top yerel konumu (karakter uzayi: x sol, y yukari, z ileri) */
function ballAt(evs: Ev[], period: number, time: number, out: THREE.Vector3) {
  const t0 = evs[0].ta
  const t = t0 + ((((time - t0) % period) + period) % period)
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]
    const nx = evs[(i + 1) % evs.length]
    const nta = i + 1 < evs.length ? nx.ta : nx.ta + period
    if (t < e.ta) continue
    if (t < e.td) return out.copy(e.p)
    if (t < nta) {
      const T = nta - e.td
      const s = t - e.td
      const vy = (nx.p.y - e.p.y) / T + (G * T) / 2
      out.x = e.p.x + (nx.p.x - e.p.x) * (s / T)
      out.z = e.p.z + (nx.p.z - e.p.z) * (s / T)
      out.y = e.p.y + vy * s - 0.5 * G * s * s
      return out
    }
  }
  // dizinin basindan once: son vurustan parabol
  const e = evs[evs.length - 1]
  const nx = evs[0]
  const T = nx.ta + period - e.td
  const s = t + period - e.td
  const vy = (nx.p.y - e.p.y) / T + (G * T) / 2
  out.set(e.p.x + (nx.p.x - e.p.x) * (s / T), e.p.y + vy * s - 0.5 * G * s * s, e.p.z + (nx.p.z - e.p.z) * (s / T))
  return out
}

// ---------------------------------------------------------------- bacak yorungeleri
type V = [number, number, number]
const sm = (x: number) => x * x * (3 - 2 * x)

/** anahtar listesi (goreli zaman, konum) uzerinde yumusak ara deger */
function track(keys: [number, V][], rel: number, out: V): boolean {
  if (rel <= keys[0][0] || rel >= keys[keys.length - 1][0]) return false
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i]
    const [t1, b] = keys[i + 1]
    if (rel >= t0 && rel <= t1) {
      const k = sm((rel - t0) / (t1 - t0))
      out[0] = a[0] + (b[0] - a[0]) * k
      out[1] = a[1] + (b[1] - a[1]) * k
      out[2] = a[2] + (b[2] - a[2]) * k
      return true
    }
  }
  return false
}

function legPath(e: Ev, plant: V, ankleH: number, t: number, out: V): boolean {
  const c = e.p
  const kind = e.kind
  const trap = kind[0] === 'x'
  const isThigh = kind === 'tr' || kind === 'tl'
  if (kind === 'head') return false
  let keys: [number, V][]
  let rel: number
  if (isThigh) {
    const x = plant[0]
    keys = [
      [-0.34, plant],
      [-0.12, [x, 0.46, 0.46]],
      [0, [x, 0.43, 0.5]],
      [0.1, [x, 0.5, 0.5]],
      [0.34, plant],
    ]
    rel = t - e.ta
  } else if (trap) {
    const hit: V = [c.x, Math.max(ankleH, c.y - 0.16), c.z - 0.12]
    keys = [
      [-0.38, plant],
      [-0.1, [c.x, hit[1] + 0.12, hit[2] - 0.1]],
      [0, hit],
      [HOLD, hit],
      [HOLD + 0.12, [c.x, hit[1] + 0.14, hit[2] + 0.1]],
      [HOLD + 0.32, plant],
    ]
    rel = t - e.ta
  } else {
    const hit: V = [c.x, Math.max(ankleH, c.y - 0.16), c.z - 0.12]
    keys = [
      [-0.34, plant],
      [-0.15, [plant[0], 0.2, -0.16]],
      [0, hit],
      [0.1, [c.x * 0.7, 0.3, c.z + 0.14]],
      [0.3, plant],
    ]
    rel = t - e.ta
  }
  return track(keys, rel, out)
}

// ---------------------------------------------------------------- bilesenler
function makeBall() {
  const g = new THREE.IcosahedronGeometry(BALL_R, 3)
  const pos = g.getAttribute('position')
  const col = new Float32Array(pos.count * 3)
  // ikosahedron koseleri: 12 koyu pentagon
  const phi = (1 + Math.sqrt(5)) / 2
  const dirs = [] as THREE.Vector3[]
  for (const a of [-1, 1]) for (const b of [-phi, phi]) {
    dirs.push(new THREE.Vector3(0, a, b).normalize(), new THREE.Vector3(a, b, 0).normalize(), new THREE.Vector3(b, 0, a).normalize())
  }
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    let d = 9
    for (const q of dirs) d = Math.min(d, v.angleTo(q))
    const c = d < 0.36 ? 0.06 : 0.96
    col.set([c, c, c], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0 })
  const mesh = new THREE.Mesh(g, m)
  mesh.castShadow = true
  return mesh
}

function Scene({ kit, variant, paused }: Required<MenuStageProps>) {
  const urls = useMemo(() => VARIANTS.map((v) => v.url), [])
  const scenes = useGLTF(urls) as unknown as { scene: THREE.Object3D }[]
  const state = useMemo(() => {
    const kits = new KitMaterials()
    const vi = Math.min(Math.max(variant, 0), VARIANTS.length - 1)
    const src: Source = glbSource(scenes[vi].scene, vi) ?? mannequinSource()
    const c: Char = makeChar(src, kits, kit, 10, 0)
    const holder = new THREE.Group()
    holder.rotation.y = 0.5
    holder.add(c.root)
    const ball = makeBall()
    holder.add(ball)
    const ev = buildEvents()
    return { kits, c, holder, ball, ...ev }
  }, [scenes, kit, variant])

  useEffect(
    () => () => {
      state.kits.dispose()
      state.ball.geometry.dispose()
      ;(state.ball.material as THREE.Material).dispose()
    },
    [state],
  )

  const clock = useRef(0)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const spin = useMemo(() => new THREE.Vector3(0.7, 0.2, 0.5).normalize(), [])
  const out = useMemo<V>(() => [0, 0, 0], [])

  useFrame((s, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    if (!paused) clock.current += dt
    const t = clock.current
    const { c, ball, evs, period } = state
    // animator tabanindan (idle), sonra poz uzerine sektirme
    const pose = c.anim.update('idle', 0, 0, 0, 0, 0, dt, null, false)
    const ah = c.rig.dims.ankleH
    ballAt(evs, period, t, tmp)
    ball.position.copy(tmp)
    ball.rotateOnWorldAxis(spin, dt * 3.2)

    // govde: hafif cokus, topa bakis
    const tt = t - evs[0].ta
    pose.hy = -0.07 + 0.02 * Math.sin((tt / 0.8) * Math.PI * 2)
    pose.hp = 0.1
    pose.sp = 0.06
    pose.np = Math.max(-0.4, Math.min(0.45, (0.95 - tmp.y) * 0.55))
    pose.nyaw = Math.max(-0.4, Math.min(0.4, tmp.x * 1.6))
    let hyaw = 0
    // bacaklar
    for (let li = 0; li < 2; li++) {
      const L = pose.legs[li]
      const sx = li === 0 ? 1 : -1
      const plant: V = [sx * 0.14, ah, 0.02]
      L.ik = 1
      L.x = plant[0]
      L.y = plant[1]
      L.z = plant[2]
      L.pitch = 0
      L.yaw = sx === 1 ? 0.15 : 0.15
      for (const e of evs) {
        if ((e.kind as string) === 'head') continue
        if ((e.kind.endsWith('r') ? 1 : 0) !== li) continue
        // tek periyot kaydirmalari: gecerli, onceki ve sonraki tur
        for (const off of [-period, 0, period]) {
          const e2 = { ...e, ta: e.ta + off, td: e.td + off }
          const tc = evs[0].ta + (((t - evs[0].ta) % period) + period) % period
          const tn = tc
          if (legPath(e2, plant, ah, tn, out)) {
            L.x = out[0]
            L.y = out[1]
            L.z = out[2]
            L.pitch = e.kind === 'r' || e.kind === 'l' ? -0.15 : 0
            hyaw += sx * 0.05
          }
        }
      }
    }
    // kafa vurusu hazirligi: cok, sonra yuksel
    const tc = evs[0].ta + (((t - evs[0].ta) % period) + period) % period
    for (const e of evs) {
      if (e.kind !== 'head') continue
      const rel = tc - e.ta
      if (rel > -0.45 && rel < 0.35) {
        const k = rel < -0.15 ? sm((rel + 0.45) / 0.3) : rel < 0 ? 1 - sm((rel + 0.15) / 0.15) * 1.2 : Math.max(0, -0.2 + sm(Math.min(1, rel / 0.35)) * 0.2)
        pose.hy += -0.1 * k
        pose.sp -= 0.18 * Math.max(0, 1 - Math.abs(rel + 0.02) / 0.16)
        pose.hp += 0.05 * k
      }
    }
    pose.hyaw = hyaw
    // kollar: denge icin acik
    for (let ai = 0; ai < 2; ai++) {
      const A = pose.arms[ai]
      A.ik = 0
      A.abd = 0.75 + 0.1 * Math.sin(t * 3 + ai * 2)
      A.flex = 0.25
      A.elbow = 0.55
    }
    c.rig.apply(pose)

    // kamera: yavas yorunge (+-12 derece) ve nefes
    const a = 0.2 * Math.sin(t * 0.22)
    const r = 4.2 + 0.14 * Math.sin(t * 0.5)
    s.camera.position.set(Math.sin(a) * r, 1.05, Math.cos(a) * r)
    s.camera.lookAt(0, 1.0, 0.1)
  })

  return <primitive object={state.holder} />
}

function Ground() {
  const tex = useMemo(() => {
    // kendi cim dokusu: ince gurultu + bicme seritleri (pitch.png veri dokusudur, renk degil)
    const S = 256
    const cv = document.createElement('canvas')
    cv.width = cv.height = S
    const g = cv.getContext('2d')!
    g.fillStyle = '#3a7a2e'
    g.fillRect(0, 0, S, S)
    const img = g.getImageData(0, 0, S, S)
    let seed = 12345
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 46
      img.data[i] += n * 0.6
      img.data[i + 1] += n
      img.data[i + 2] += n * 0.5
    }
    g.putImageData(img, 0, 0)
    const t = new THREE.CanvasTexture(cv)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(60, 60)
    t.anisotropy = 8
    return t
  }, [])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial map={tex} roughness={1} />
      </mesh>
      {/* merkez dairesi parcasi: karakterin arkasinda */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, -5.5]}>
        <ringGeometry args={[3.95, 4.05, 96]} />
        <meshBasicMaterial color="#d9dfd0" toneMapped={false} fog />
      </mesh>
    </group>
  )
}

export default function MenuStage({ kit = 'home', variant = 0, paused = false }: MenuStageProps) {
  const shadows = QUALITY !== 'low'
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas
        dpr={DPR}
        shadows={shadows}
        frameloop={paused ? 'never' : 'always'}
        camera={{ fov: 32, position: [0, 1.05, 4.2], near: 0.1, far: 120 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ scene }) => {
          scene.background = new THREE.Color('#0b1018')
          scene.fog = new THREE.FogExp2('#0b1018', 0.04)
        }}
      >
        <hemisphereLight args={['#6a7ca8', '#2a3418', 1.0]} />
        <directionalLight
          position={[-4, 3.2, 3]}
          intensity={4.2}
          color="#ffb070"
          castShadow={shadows}
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.03}
          shadow-radius={5}
          shadow-camera-left={-4}
          shadow-camera-right={4}
          shadow-camera-top={4}
          shadow-camera-bottom={-4}
        />
        <directionalLight position={[4, 2, -3]} intensity={0.8} color="#6f8fd8" />
        <Suspense fallback={null}>
          <Scene kit={kit} variant={variant} paused={paused} />
        </Suspense>
        <Ground />
      </Canvas>
    </div>
  )
}
