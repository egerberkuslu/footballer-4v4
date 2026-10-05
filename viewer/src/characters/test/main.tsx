// Ayri test sahnesi (I): /src/characters/test/index.html?t=pose&anims=kick,pass&at=0.28
// t=loco&v=5 : hepsi +z'ye kosar, kamera izler. Ana uygulamaya dokunmaz.
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Characters } from '../Characters'
import { game } from '../../game/store'
import type { AnimState, RefAnim } from '../../game/types'

const q = new URLSearchParams(location.search)
const T = q.get('t') ?? 'pose'
const anims = (q.get('anims') ?? 'idle').split(',')
const ats = (q.get('at') ?? '0').split(',').map(Number)
const speeds = (q.get('v') ?? '0').split(',').map(Number)
const camQ = (q.get('cam') ?? 'side').toString()
const SP = 1.7

let time = 0
function Driver() {
  const cam = useThree((s) => s.camera)
  useFrame((_, dt) => {
    time += Math.min(dt, 0.1)
    const all = [...game.players, game.referee]
    let cz = 0
    all.forEach((p, i) => {
      const x = (i - 4) * SP
      const a = anims[i % anims.length]
      const v = speeds[i % speeds.length]
      p.anim = (a as AnimState & RefAnim)
      if (T === 'loco') {
        // +x yonunde kosu; dizi z boyunca (yandan gorunum: cam=front)
        const xx = v * time
        p.x = xx + (i - 4) * SP
        p.z = 0
        p.vx = v
        p.vz = 0
        p.facing = Math.PI / 2
        p.animT = 0
        cz += xx
      } else {
        p.x = x
        p.z = 0
        p.facing = q.get('face') ? Number(q.get('face')) : 0
        const at = ats[i % ats.length]
        // at<0: canli oynat (dongu)
        p.animT = at >= 0 ? Math.max(1e-3, at) : 1e-3 + (time % 2.2)
      }
      if ('hasBall' in p) p.hasBall = q.get('ball') === '1'
      if ('controlled' in p) p.controlled = i === 0
    })
    cz /= all.length
    // fx: odak karakter indeksi (yoksa orta), dist: uzaklik
    const fi = q.get('fx')
    const fx = fi !== null ? (Number(fi) - 4) * SP : 0
    const D = Number(q.get('dist') ?? 13)
    const H = Number(q.get('h') ?? 1.2)
    if (T === 'loco') cam.position.set(cz, H, D), cam.lookAt(cz, 0.85, 0)
    else if (camQ === 'side') cam.position.set(fx + D, H, cz), cam.lookAt(fx, Number(q.get('ly') ?? 0.85), cz)
    else if (camQ === 'front') cam.position.set(fx, H, cz + D), cam.lookAt(fx, Number(q.get('ly') ?? 0.85), cz)
    else if (camQ === 'back') cam.position.set(fx, H, cz - D), cam.lookAt(fx, Number(q.get('ly') ?? 0.85), cz)
    else cam.position.set(fx + D * 0.7, H + 2, cz + D * 0.7), cam.lookAt(fx, 0.8, cz)
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
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial map={tex} roughness={0.95} />
    </mesh>
  )
}

createRoot(document.getElementById('root')!).render(
  <Canvas shadows onCreated={(s) => Object.assign(window, { __r3f: s })} camera={{ fov: 35, position: [14, 1.6, 1] }}>
    <hemisphereLight args={['#dfe9f5', '#4a5a36', 0.9]} />
    <directionalLight position={[6, 12, 8]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={Number(q.get('bias') ?? -0.0004)} shadow-normalBias={Number(q.get('nbias') ?? 0.03)}
      shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
    <Ground />
    <Characters />
    <Driver />
  </Canvas>,
)
