import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BALL_R, GOAL_H, GOAL_W, NET_D_BOTTOM, PITCH_L, PITCH_W } from '../pitch'
import { world } from '../sim'
import { devStats, getDev, subscribeDev } from './devStore'
import { OffsideDebug } from './OffsideDebug'
import { DynamicColliders, StaticColliders } from './StaticColliders'

let frameStart = 0

// Mantik bitis olcumu: tum negatif oncelikli isler bittikten sonra, render'dan once
function LogicEnd() {
  useFrame(() => {
    if (frameStart) devStats.logicMs = devStats.logicMs * 0.9 + (performance.now() - frameStart) * 0.1
  }, -0.01)
  return null
}

// world.step'i bir kez sararak fizik suresini olcer (imza degismez)
let wrapped = false
function wrapStep() {
  if (wrapped) return
  wrapped = true
  const orig = world.step.bind(world)
  world.step = (dt: number) => {
    const t = performance.now()
    orig(dt)
    devStats.simMs = devStats.simMs * 0.9 + (performance.now() - t) * 0.1
  }
}

// Kare olcumu: oncelik cok dusuk -> karenin en basinda calisir, bir onceki karenin
// render istatistigini okur. Pozitif oncelik KULLANILMAZ (otomatik render'i kapatir).
function Meter() {
  const gl = useThree((s) => s.gl)
  const times = useRef<number[]>([])
  const last = useRef(0)

  useEffect(() => {
    wrapStep()
    gl.info.autoReset = false
    return () => {
      gl.info.autoReset = true
    }
  }, [gl])

  useFrame(() => {
    const now = performance.now()
    frameStart = now
    if (last.current) {
      const dt = now - last.current
      const arr = times.current
      arr.push(dt)
      if (arr.length > 240) arr.shift()
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length
      const sorted = [...arr].sort((a, b) => b - a)
      devStats.frameMs = avg
      devStats.fps = 1000 / avg
      devStats.worstMs = sorted[Math.max(0, Math.floor(arr.length / 100))]
    }
    last.current = now
    devStats.calls = gl.info.render.calls
    devStats.tris = gl.info.render.triangles
    devStats.geoms = gl.info.memory.geometries
    devStats.textures = gl.info.memory.textures
    gl.info.reset()
  }, -1000)

  return null
}

const WIRE = { wireframe: true, transparent: true, depthTest: false, toneMapped: false } as const

function BallHitbox() {
  const mesh = useRef<THREE.Mesh>(null)
  const arrow = useMemo(() => {
    const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xffd400, 0.12, 0.07)
    a.renderOrder = 999
    ;(a.line.material as THREE.LineBasicMaterial).depthTest = false
    ;(a.cone.material as THREE.MeshBasicMaterial).depthTest = false
    return a
  }, [])
  const v = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const b = world.ball
    mesh.current?.position.set(b.x, b.y, b.z)
    arrow.position.set(b.x, b.y, b.z)
    v.set(b.vx, b.vy, b.vz)
    const s = v.length()
    arrow.visible = s > 0.05
    if (arrow.visible) {
      arrow.setDirection(v.normalize())
      arrow.setLength(Math.min(6, 0.25 + s * 0.12), 0.12, 0.07)
    }
  })

  return (
    <>
      <mesh ref={mesh} renderOrder={999}>
        <sphereGeometry args={[BALL_R, 16, 10]} />
        <meshBasicMaterial color="#ff3df5" {...WIRE} />
      </mesh>
      <primitive object={arrow} />
    </>
  )
}

function Capsules() {
  const items = useMemo(
    () =>
      world.capsules.map((c) => {
        const a = new THREE.Vector3(...c.a)
        const b = new THREE.Vector3(...c.b)
        const dir = b.clone().sub(a)
        const len = dir.length()
        return {
          pos: a.clone().add(b).multiplyScalar(0.5),
          quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
          len,
          r: c.r,
        }
      }),
    [],
  )
  return (
    <>
      {items.map((c, i) => (
        <mesh key={i} position={c.pos} quaternion={c.quat} renderOrder={999}>
          <capsuleGeometry args={[c.r, c.len, 4, 10]} />
          <meshBasicMaterial color="#ff8a00" {...WIRE} />
        </mesh>
      ))}
    </>
  )
}

// Ag dugumleri: serbest = camgobegi, sabit (cerceveye bagli) = kirmizi
function NetNodes() {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const attr = new THREE.BufferAttribute(world.pos, 3)
    attr.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('position', attr)
    const n = world.pos.length / 3
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const pinned = world.invMass ? world.invMass[i] === 0 : false
      col.set(pinned ? [1, 0.15, 0.15] : [0.1, 0.9, 1], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }, [])

  useFrame(() => {
    geometry.attributes.position.needsUpdate = true
  })

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={998}>
      <pointsMaterial size={4} sizeAttenuation={false} vertexColors depthTest={false} transparent toneMapped={false} />
    </points>
  )
}

// Gol algilama hacmi ve saha siniri
function Triggers() {
  return (
    <>
      {[1, -1].map((s) => (
        <mesh
          key={s}
          position={[s * (PITCH_L / 2 + NET_D_BOTTOM / 2), GOAL_H / 2, 0]}
          renderOrder={997}
        >
          <boxGeometry args={[NET_D_BOTTOM, GOAL_H, GOAL_W]} />
          <meshBasicMaterial color="#39ff6a" {...WIRE} />
        </mesh>
      ))}
      <lineSegments position-y={0.03} renderOrder={997}>
        <edgesGeometry args={[new THREE.BoxGeometry(PITCH_L, 0.001, PITCH_W)]} />
        <lineBasicMaterial color="#ffffff" depthTest={false} transparent toneMapped={false} />
      </lineSegments>
      <axesHelper args={[2]} />
    </>
  )
}

export function DevProbe() {
  const flags = useSyncExternalStore(subscribeDev, getDev)
  return (
    <>
      <Meter />
      <LogicEnd />
      {flags.on && flags.hitboxes && (
        <>
          <BallHitbox />
          <Capsules />
        </>
      )}
      {flags.on && flags.nodes && <NetNodes />}
      {flags.on && flags.triggers && <Triggers />}
      {flags.on && flags.statics && <StaticColliders />}
      {flags.on && flags.offside && <OffsideDebug />}
      {flags.on && flags.hitboxes && <DynamicColliders />}
    </>
  )
}
