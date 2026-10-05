// Kumas test sahnesi (N): /src/cloth/test/index.html?cloth=1&t=loco&v=5&cam=side
// t=loco: +x kosu (v m/s) | t=stop: ts saniye kos sonra dur | t=pose: anims yerinde canli
// cloth=1: kumas acik (Characters kancasi), yoksa kapali.
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Characters } from '../../characters/Characters'
import { game } from '../../game/store'
import type { AnimState, RefAnim } from '../../game/types'

const q = new URLSearchParams(location.search)
const T = q.get('t') ?? 'loco'
const anims = (q.get('anims') ?? (T === 'pose' ? 'idle' : 'run')).split(',')
const V = Number(q.get('v') ?? 5)
const TS = Number(q.get('ts') ?? 1.6)
const camQ = q.get('cam') ?? 'side'
const SP = 1.7
const N = Number(q.get('n') ?? 9)

let time = 0
// kumas Characters kancasindan gelir (?cloth=1); kapali karsilastirma icin cloth parametresini verme
const w = window as unknown as { __cloth?: { chars: { root: THREE.Object3D }[] }; __time?: number }

function Driver() {
  const cam = useThree((s) => s.camera)
  useFrame((_, dt) => {
    time += Math.min(dt, 0.1)
    w.__time = time
    const all = [...game.players, game.referee]
    let cx = 0
    all.forEach((p, i) => {
      const a = anims[i % anims.length]
      p.facing = Math.PI / 2
      if (T === 'pose') {
        p.anim = a as AnimState & RefAnim
        p.x = (i - 4) * SP
        p.z = 0
        p.animT = 1e-3 + (time % 2.2)
        p.facing = Number(q.get('face') ?? 0)
      } else {
        const runT = T === 'stop' ? Math.min(time, TS) : time
        const moving = T !== 'stop' || time < TS
        p.anim = (moving ? a : 'idle') as AnimState & RefAnim
        p.animT = moving ? 0 : time - TS
        p.x = V * runT + (i - 4) * 0.02
        p.z = (i - 4) * SP
        p.vx = moving ? V : 0
        p.vz = 0
        cx = V * runT
      }
      // n<9: fazlalari uzaga koy
      if (i >= N) p.z = 400
      if ('hasBall' in p) p.hasBall = false
      if ('controlled' in p) p.controlled = false
    })
    const fz = (Number(q.get('fx') ?? 0) - 4) * SP
    const D = Number(q.get('dist') ?? 5)
    const H = Number(q.get('h') ?? 1.3)
    const fx = T === 'pose' ? (Number(q.get('fx') ?? 0) - 4) * SP : cx
    const z0 = T === 'pose' ? 0 : fz
    if (camQ === 'side') cam.position.set(fx, H, z0 - D), cam.lookAt(fx, 1.0, z0)
    else if (camQ === 'side2') cam.position.set(fx, H, z0 + D), cam.lookAt(fx, 1.0, z0)
    else if (camQ === 'back') cam.position.set(fx - D, H, z0), cam.lookAt(fx, 1.0, z0)
    else if (camQ === 'front') cam.position.set(fx + D, H, z0), cam.lookAt(fx, 1.0, z0)
    else if (camQ === 'q') cam.position.set(fx - D * 0.7, H, z0 - D * 0.7), cam.lookAt(fx, 1.0, z0)
    else cam.position.set(fx + D * 0.7, H + 1.5, z0 + D * 0.7), cam.lookAt(fx, 0.8, z0)
  }, -10)
  return null
}

function Ground() {
  const tex = new THREE.CanvasTexture(
    (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 64
      const g = c.getContext('2d')!
      g.fillStyle = '#4f7d3a'
      g.fillRect(0, 0, 64, 64)
      g.fillStyle = '#5d8d45'
      g.fillRect(0, 0, 32, 32)
      g.fillRect(32, 32, 32, 32)
      return c
    })(),
  )
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(100, 100)
  tex.magFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[200, 200]} />
      <meshStandardMaterial map={tex} roughness={0.95} />
    </mesh>
  )
}

function Sun() {
  // gunes karakteri izler (golge kutusu kucuk kalsin)
  const ref = useThree((s) => s.scene)
  useFrame(() => {
    const l = ref.getObjectByName('gunes') as THREE.DirectionalLight | undefined
    const c = w.__cloth?.chars[Number(q.get('fx') ?? 0)]?.root
    if (l && c) {
      l.position.set(c.position.x + 6, 12, c.position.z + 8)
      l.target.position.set(c.position.x, 0, c.position.z)
      l.target.updateMatrixWorld()
    }
  }, -5)
  return null
}

createRoot(document.getElementById('root')!).render(
  <Canvas shadows onCreated={(s) => Object.assign(window, { __r3f: s })} camera={{ fov: 35, position: [14, 1.6, 1] }}>
    <hemisphereLight args={['#dfe9f5', '#4a5a36', 0.9]} />
    <directionalLight name="gunes" position={[6, 12, 8]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <Ground />
    <Characters />
    <Driver />
    <Sun />
  </Canvas>,
)
