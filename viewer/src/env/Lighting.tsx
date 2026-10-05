import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Sky, Stars } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { FLOOD_H, FLOODLIGHTS } from './colliders'
import { SHADOW_SIZE } from './quality'
import { getTimeOfDay, subscribeTimeOfDay, TOD, type TimeOfDay } from './timeOfDay'

// Gok, ortam haritasi ve dogrusal isik saate gore AYNI gunes yonunu kullanir.
// Geriye uyum: gunduz gunes yonu
export const SUN_DIR = new THREE.Vector3(...TOD.gunduz.sunDir)

export function useTimeOfDay(): TimeOfDay {
  return useSyncExternalStore(subscribeTimeOfDay, getTimeOfDay)
}

function SkyDome({ t, distance }: { t: TimeOfDay; distance?: number }) {
  const c = TOD[t]
  const pos = useMemo(() => new THREE.Vector3(...c.sunDir).multiplyScalar(400).toArray(), [c])
  return (
    <Sky
      distance={distance}
      sunPosition={pos}
      turbidity={c.sky.turbidity}
      rayleigh={c.sky.rayleigh}
      mieCoefficient={c.sky.mie}
      mieDirectionalG={c.sky.g}
    />
  )
}

// Gece gogu: ufukta lacivert, tepede siyaha yakin (fog'dan bagimsiz)
function NightDome({ radius = 600 }: { radius?: number }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {},
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `varying vec3 vP; void main(){
          float h = clamp(vP.y, -0.2, 1.0);
          vec3 hor = vec3(0.045, 0.065, 0.11);   // sehir isigiyla hafif aydinlik ufuk
          vec3 top = vec3(0.004, 0.006, 0.014);
          vec3 c = mix(hor, top, smoothstep(0.0, 0.55, h));
          if (h < 0.0) c = hor * 0.6;
          gl_FragColor = vec4(c, 1.);
          #include <colorspace_fragment>
        }`,
      }),
    [],
  )
  return (
    <mesh material={mat} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[radius, 32, 16]} />
    </mesh>
  )
}

// Sabit golge kutusu tum kafesi kapsar (kamera hedefini izlemez, kaymaz); 4096 haritada ~1.7 cm/teksel
function Sun({ t }: { t: TimeOfDay }) {
  const light = useRef<THREE.DirectionalLight>(null)
  const scene = useThree((s) => s.scene)
  const c = TOD[t]
  useEffect(() => {
    const l = light.current
    if (!l) return
    l.position.set(...c.sunDir).multiplyScalar(90)
    l.target.position.set(0, 0, 0)
    scene.add(l.target)
    l.target.updateMatrixWorld()
    return () => {
      scene.remove(l.target)
    }
  }, [scene, c])
  const shadows = !c.floods
  return (
    <directionalLight
      ref={light}
      intensity={c.sunI}
      color={c.sunColor}
      castShadow={shadows}
      shadow-mapSize={[SHADOW_SIZE, SHADOW_SIZE]}
      shadow-camera-left={-34}
      shadow-camera-right={34}
      shadow-camera-top={30}
      shadow-camera-bottom={-30}
      shadow-camera-near={30}
      shadow-camera-far={170}
      shadow-bias={-0.00025}
      shadow-normalBias={0.025}
      shadow-radius={3}
    />
  )
}

// Her projektor diregi kendi kosesinden sahanin karsi yarisina bakar (capraz ortu).
const MASTS = FLOODLIGHTS.map(([x, z]) => ({
  p: new THREE.Vector3(x * 0.985, FLOOD_H + 0.1, z * 0.985),
  aim: new THREE.Vector3(-Math.sign(x) * 4, 0, -Math.sign(z) * 3),
}))

// Gece: 4 spot. Yalniz 2 tanesi golgeli; golgeli isiklar kameranin baktigi noktaya en yakin
// iki direge tasinir (isik sayisi sabit kalir, golgelendirici yeniden derlenmez).
function Floodlights() {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const scene = useThree((s) => s.scene)
  const refs = useRef<(THREE.SpotLight | null)[]>([])
  const order = useRef<number[]>([0, 1, 2, 3])

  useEffect(() => {
    const ls = refs.current
    for (const l of ls) if (l) scene.add(l.target)
    return () => {
      for (const l of ls) if (l) scene.remove(l.target)
    }
  }, [scene])

  useFrame(() => {
    const t = controls?.target
    if (t) {
      const d = MASTS.map((m, i) => [Math.hypot(m.p.x - t.x, m.p.z - t.z), i] as const).sort((a, b) => a[0] - b[0])
      const near = [d[0][1], d[1][1]]
      const cur = order.current
      // yalniz golgeli cift degistiyse yeniden dagit (titresmesin diye 3 m pay)
      const curD = (i: number) => Math.hypot(MASTS[i].p.x - t.x, MASTS[i].p.z - t.z)
      const changed = !(near.includes(cur[0]) && near.includes(cur[1])) && curD(cur[0]) + curD(cur[1]) > d[0][0] + d[1][0] + 3
      if (changed) order.current = [...near, ...[0, 1, 2, 3].filter((i) => !near.includes(i))]
    }
    order.current.forEach((mi, li) => {
      const l = refs.current[li]
      if (!l) return
      const m = MASTS[mi]
      if (l.position.distanceToSquared(m.p) > 1e-6) {
        l.position.copy(m.p)
        l.target.position.copy(m.aim)
        l.target.updateMatrixWorld()
      }
    })
  })

  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <spotLight
          key={i}
          ref={(r) => {
            refs.current[i] = r
          }}
          position={MASTS[i].p}
          color="#f3f6ff"
          intensity={1500}
          distance={0}
          decay={2}
          angle={0.56}
          penumbra={0.45}
          castShadow={i < 2}
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.04}
          shadow-camera-near={4}
          shadow-camera-far={70}
        />
      ))}
    </>
  )
}

export function Lighting() {
  const t = useTimeOfDay()
  const c = TOD[t]
  const night = c.floods
  return (
    <>
      <fog attach="fog" args={[c.fog, c.fogNear, c.fogFar]} key={'fog-' + t} />
      {night ? (
        <>
          <NightDome />
          <Stars radius={420} depth={60} count={2500} factor={5} saturation={0} fade speed={0} />
        </>
      ) : (
        <SkyDome t={t} />
      )}
      {/* Gokten turetilmis ortam haritasi (HDRI yerine; ag gerektirmez). Saat degisince bir kez yeniden uretilir. */}
      <Environment key={'env-' + t} resolution={256} frames={1} environmentIntensity={c.env}>
        {night ? (
          <>
            <NightDome radius={400} />
            {MASTS.map((m, i) => (
              <mesh key={i} position={m.p}>
                <sphereGeometry args={[1.2, 12, 8]} />
                <meshBasicMaterial color={[7, 7, 6.5]} toneMapped={false} />
              </mesh>
            ))}
          </>
        ) : (
          <SkyDome t={t} distance={400} />
        )}
        <mesh rotation-x={-Math.PI / 2} position-y={-2}>
          <circleGeometry args={[300, 32]} />
          <meshBasicMaterial color={night ? '#0c1209' : t === 'aksam' ? '#4a3f2a' : '#4c5631'} />
        </mesh>
      </Environment>
      <hemisphereLight key={'hemi-' + t} args={[c.hemi[0], c.hemi[1], c.hemi[2]]} />
      <Sun t={t} />
      {night && <Floodlights />}
    </>
  )
}
