import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { bumpCtl, ctl } from './control/store'
import { padLook } from './control/MatchControl'
import { getSettings } from './control/gamepadConfig'
import { game } from './game/store'
import { cameraLock } from './var/store'
import { PITCH_L, SPOT_DIST } from './pitch'
import type { World } from './sim'

export const CAMERA_NAMES = ['Tribün', 'Kale arkası', 'Yan ağ', 'Şutçu arkası', 'Yayın']
export const SHOOTER_CAM = 3 // bu preset sut kamerasina gecer

type Preset = { pos: [number, number, number]; target: [number, number, number] }

// Konumlar hucum edilen kaleye (s = world.side) gore aynalanir
function preset(i: number, s: number): Preset {
  const g = PITCH_L / 2
  const spot = g - SPOT_DIST
  switch (i) {
    case 1: // kale arkasi, capraz: agin torbasi ve topu yakaladigi an gorunur
      return { pos: [s * (g + 3.1), 1.35, 3.4], target: [s * (g + 0.2), 0.75, -0.8] }
    case 2: // yan ag, direk hizasinda yandan
      return { pos: [s * (g + 0.7), 1.25, 6.2], target: [s * (g + 0.55), 1.0, 0] }
    case 3: // sutcunun omzu ustunden
      return { pos: [s * (spot - 5.2), 1.95, s * 1.0], target: [s * g, 1.0, 0] }
    case 4: // yayin: yuksek, kose capraz genis aci
      return { pos: [s * -12, 13.5, 27], target: [s * 4, 0, 0] }
    default: // tribun: kafesin disinda, tel ustunden bakan seyirci yuksekligi
      return { pos: [s * 1, 7.6, 22.8], target: [s * 6.5, 0, -0.5] }
  }
}

const DUR = 1.1 // gecis suresi (s)
const BACK = 5.0 // sut kamerasi: topun arkasina mesafe
const SIDE = 1.5 // sutcunun sagina kayma (oyuncu solda kalir)
const HIGH = 2.05

// sut kamerasinin istenen konumu/hedefi (topun yerlestirildigi noktaya ya da ucan topa gore)
function shooterPose(s: number, ballP: THREE.Vector3, pos: THREE.Vector3, tgt: THREE.Vector3) {
  const g = PITCH_L / 2
  let dx = s * g - ctl.spotX
  let dz = -ctl.spotZ
  const d = Math.hypot(dx, dz) || 1
  dx /= d
  dz /= d
  if (ctl.inFlight && ctl.follow) {
    // topu izle: arkasinda ve biraz yukarida, kaleye girmeden
    pos.set(ballP.x - dx * 4.2 - dz * 0.6, Math.max(1.4, ballP.y + 1.2), ballP.z - dz * 4.2 + dx * 0.6)
    if (s * pos.x > g - 3) pos.x = s * (g - 3)
    tgt.set(ballP.x + dx * 2, Math.max(0.6, ballP.y), ballP.z + dz * 2)
  } else {
    pos.set(ctl.spotX - dx * BACK - dz * SIDE, HIGH, ctl.spotZ - dz * BACK + dx * SIDE)
    // hedef kaleden biraz asagida: top ekranin alt kenarindan yukari cikar
    tgt.set(s * g, 0.35, ctl.spotZ * 0.3)
  }
}

export function CameraRig({ world }: { world: World }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const anim = useRef<{
    t: number
    p0: THREE.Vector3
    t0: THREE.Vector3
    p1: THREE.Vector3
    t1: THREE.Vector3
  } | null>(null)
  const tmp = useRef({ p: new THREE.Vector3(), t: new THREE.Vector3(), b: new THREE.Vector3(), snap: true })

  useEffect(() => {
    if (!controls) return
    const apply = (e: Event) => {
      const i = (e as CustomEvent<number>).detail
      if (i === SHOOTER_CAM) {
        anim.current = null
        ctl.cam = 'sutcu'
        bumpCtl()
        return
      }
      if (i === 4 && ctl.mode === 'mac') {
        // maçta "Yayın" düğmesi sabit preset değil, takip eden yayın kamerası
        anim.current = null
        tmp.current.snap = true
        ctl.cam = 'yayin'
        bumpCtl()
        return
      }
      ctl.cam = 'serbest'
      bumpCtl()
      const p = preset(i, world.side)
      const p1 = new THREE.Vector3(...p.pos)
      const t1 = new THREE.Vector3(...p.target)
      if (!anim.current && camera.position.distanceTo(p1) < 1e-3) return
      anim.current = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1, t1 }
    }
    window.addEventListener('rig', apply)
    tmp.current.snap = true
    return () => window.removeEventListener('rig', apply)
  }, [controls, camera, world])

  useFrame((_, dt) => {
    if (!controls || cameraLock()) return // VAR kamerayi devraldi
    if (ctl.cam === 'yayin') {
      // mac yayini: kenar cizgisinden, kontrol edilen oyuncu ile top arasini izler
      controls.enabled = false
      const m = tmp.current
      const b = world.ball
      const p = game.controlledPlayer()
      const fx = p ? b.x * 0.65 + p.x * 0.35 : b.x
      const fz = p ? b.z * 0.65 + p.z * 0.35 : b.z
      m.t.set(fx, 0.6, fz * 0.8)
      m.p.set(fx * 0.85, 11.5, 21 + fz * 0.25)
      // gamepad sag cubuk: kamerayi kaydir / yakinlastir (sutta cubuk nisan icin kullanilir)
      if (ctl.charge < 0) {
        const k = getSettings().camSpeed
        m.p.x += padLook.x * 8 * k
        m.p.z -= padLook.y * 6 * k
        m.p.y -= padLook.y * 3 * k
      }
      const h = Math.min(dt, 0.1)
      const kp = m.snap ? 1 : 1 - Math.exp(-h * 2.2)
      const kt = m.snap ? 1 : 1 - Math.exp(-h * 3.5)
      m.snap = false
      camera.position.lerp(m.p, kp)
      controls.target.lerp(m.t, kt)
      camera.lookAt(controls.target)
      return
    }
    const shooter = ctl.cam === 'sutcu'
    // sut modunda OrbitControls sol tikla donmesin (sol tik sarj eder)
    controls.enabled = !shooter
    if (shooter) {
      const m = tmp.current
      const b = world.ball
      m.b.set(b.x, b.y, b.z)
      shooterPose(world.side, m.b, m.p, m.t)
      // ustel yumusatma; ilk karede dogrudan yerlestir
      const h = Math.min(dt, 0.1)
      const kp = m.snap ? 1 : 1 - Math.exp(-h * (ctl.inFlight ? 3.2 : 4))
      const kt = m.snap ? 1 : 1 - Math.exp(-h * (ctl.inFlight ? 7 : 5))
      m.snap = false
      camera.position.lerp(m.p, kp)
      controls.target.lerp(m.t, kt)
      camera.lookAt(controls.target)
      return
    }
    const a = anim.current
    if (!a) return
    a.t = Math.min(1, a.t + Math.min(dt, 0.25) / DUR)
    const k = a.t * a.t * (3 - 2 * a.t) // yumusak baslangic/bitis
    // hedef duz, konum hafif yukari kavisli (sahne icinden gecmesin)
    camera.position.lerpVectors(a.p0, a.p1, k)
    camera.position.y += Math.sin(Math.PI * k) * Math.min(6, a.p0.distanceTo(a.p1) * 0.15)
    controls.target.lerpVectors(a.t0, a.t1, k)
    controls.update()
    if (a.t >= 1) anim.current = null
  })

  return null
}
