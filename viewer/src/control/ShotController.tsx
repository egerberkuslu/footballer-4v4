// Sahne ici sut denetleyicisi: fare/klavye girisi, nisan imleci, yorunge onizlemesi,
// B'nin olaylarindan sut yazilari. Antrenman girdisi burada; mac girdisi HumanInput'ta.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GOAL_W, PITCH_L } from '../pitch'
import { isVarActive } from '../var/store'
import { gamepadSettingsOpen } from '../ui/gamepadUi'
import { world } from '../sim'
import { planeHit, predictPath, solveShot } from './aim'
import { trainingPose } from './training'
import {
  aimInside,
  autoShot,
  cancelCharge,
  placeSpot,
  previewSpeed,
  release,
  resetSpot,
  returnBall,
  running,
  switchMode,
  shotEvent,
  startCharge,
  testKick,
  tickShot,
} from './actions'
import { aimYRange, bumpCtl, ctl, flash, setCurl, shotType } from './store'
import { kick, onWorldEvent, placeBall } from './worldApi'

const MAX_PTS = 400

export function toggleCam() {
  const main = ctl.mode === 'mac' ? 'yayin' : 'sutcu'
  ctl.cam = ctl.cam === main ? 'serbest' : main
  bumpCtl()
}

// sag tik / surukleme: fare isininin zeminle kesisimi
const groundHit = (ray: THREE.Raycaster, p: THREE.Vector3) =>
  ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) !== null

function useInput() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    const el = gl.domElement
    const ray = new THREE.Raycaster()
    const hit = new THREE.Vector3()
    const ndc = (e: PointerEvent | MouseEvent) => {
      const r = el.getBoundingClientRect()
      return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1] as [number, number]
    }
    const ground = (e: PointerEvent) => {
      ray.setFromCamera(new THREE.Vector2(...ndc(e)), camera)
      return groundHit(ray, hit)
    }
    // antrenmanda, VAR disinda, durgun top
    const training = () => ctl.mode === 'antrenman' && !isVarActive()
    const overBall = (e: PointerEvent) =>
      !ctl.inFlight && !running() && ground(e) && Math.hypot(hit.x - world.ball.x, hit.z - world.ball.z) < 0.45

    const move = (e: PointerEvent) => {
      ctl.aimNdc = ndc(e)
      if (!training()) return
      if (ctl.dragging) {
        if (ground(e)) placeSpot(hit.x, hit.z)
        return
      }
      // topun ustunde el imleci
      if (ctl.cam === 'sutcu' && ctl.charge < 0) el.style.cursor = overBall(e) ? 'grab' : ''
    }
    const down = (e: PointerEvent) => {
      ctl.aimNdc = ndc(e)
      if (!training()) return
      if (e.button === 0 && ctl.cam === 'sutcu') {
        if (overBall(e)) {
          ctl.dragging = true
          el.style.cursor = 'grabbing'
        } else startCharge()
      } else if (e.button === 2) {
        // sag tik: topu zemine tiklanan yere koy
        if (ground(e)) placeSpot(hit.x, hit.z)
      }
    }
    const up = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (ctl.dragging) {
        ctl.dragging = false
        el.style.cursor = ''
        return
      }
      if (ctl.mode === 'antrenman') release()
    }
    const ctx = (e: Event) => e.preventDefault()

    // Z basiliyken yerden sert (Ctrl kullanilmaz: Firefox'ta Ctrl+W sekmeyi kapatir)
    let zHeld = false
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'F3' || e.key === '`' || isVarActive() || gamepadSettingsOpen()) return // dev paneli / VAR / kol ayari
      const k = e.key.toLowerCase()
      // her modda
      if (k === 'v') return toggleCam()
      if (k === 'h') {
        if (ctl.mode === 'mac') ctl.passHints = !ctl.passHints
        else ctl.preview = !ctl.preview
        return bumpCtl()
      }
      if (e.key === '?' || k === 'escape') {
        ctl.help = k === 'escape' ? false : !ctl.help
        return bumpCtl()
      }
      if (k === 'm' && !e.repeat) return switchMode(ctl.mode === 'mac' ? 'antrenman' : 'mac')
      if (ctl.mode !== 'antrenman') return // mac tuslari HumanInput'ta
      if (k === 'z') zHeld = true
      ctl.shift = e.shiftKey
      ctl.ctrl = zHeld
      const s = world.side
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) startCharge()
      } else if (k === 'q' || k === 'e') {
        e.preventDefault()
        setCurl(ctl.curl + (k === 'q' ? -1 : 1))
      } else if (e.key === ',' || e.key === '.') {
        e.preventDefault()
        setCurl(ctl.curl + (e.key === ',' ? -1 : 1))
      } else if (k === 'r') resetSpot()
      else if (k === 'f') ctl.follow = !ctl.follow
      else if (k === 'o') autoShot()
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        // sutcu bakisina gore: yukari = kaleye dogru, sag = sutcunun sagi
        const f = e.key === 'ArrowUp' ? 0.5 : e.key === 'ArrowDown' ? -0.5 : 0
        const r = e.key === 'ArrowRight' ? 0.5 : e.key === 'ArrowLeft' ? -0.5 : 0
        placeSpot(ctl.spotX + s * f, ctl.spotZ + s * r, true)
        return
      } else if (e.key === 'Shift' || k === 'z') {
        e.preventDefault()
      } else return
      bumpCtl()
    }
    const keyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'z') zHeld = false
      const was = ctl.shift !== e.shiftKey || ctl.ctrl !== zHeld
      ctl.shift = e.shiftKey
      ctl.ctrl = zHeld
      if (e.code === 'Space' && ctl.mode === 'antrenman') release()
      if (was) bumpCtl()
    }
    const blur = () => {
      cancelCharge()
      ctl.dragging = false
      ctl.shift = ctl.ctrl = zHeld = false
      bumpCtl()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    el.addEventListener('contextmenu', ctx)
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      el.removeEventListener('contextmenu', ctx)
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
    }
  }, [gl, camera])
}

// B'nin olaylari -> sut yazilari (antrenman); VAR tekrarinda yok sayilir
function useShotEvents() {
  useEffect(
    () =>
      onWorldEvent((e) => {
        if (isVarActive() || ctl.mode !== 'antrenman') return
        shotEvent(e.type)
      }),
    [],
  )
}

export function ShotController() {
  const camera = useThree((s) => s.camera)
  useInput()
  useShotEvents()

  // ilk yukleme: top penalti noktasinda. Test/ayiklama icin uygulamanin modul ornekleri disari acilir
  // (Vite HMR sonrasi dinamik import farkli ornek dondurebilir).
  useEffect(() => {
    if (ctl.mode === 'antrenman') returnBall() // macta topu kurallar dizer
    Object.assign(window, { __shot: { world, ctl, solveShot, planeHit, kick, placeBall, flash, testKick, placeSpot } })
  }, [])

  const ray = useMemo(() => new THREE.Raycaster(), [])
  const ndc = useMemo(() => new THREE.Vector2(), [])
  const ring = useRef<THREE.Group>(null)
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }),
    [],
  )
  const line = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PTS * 3), 3))
    const mat = new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.32, gapSize: 0.2, transparent: true, opacity: 0.75, depthWrite: false })
    const l = new THREE.Line(geo, mat)
    l.frustumCulled = false
    l.renderOrder = 5
    return l
  }, [])
  const prevKey = useRef('')

  useEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
      ringMat.dispose()
    },
    [line, ringMat],
  )

  useFrame((_, dt) => {
    const varOn = isVarActive()
    if (ctl.mode === 'antrenman' && !varOn) {
      tickShot(Math.min(dt, 1 / 30)) // world.step ile ayni sinir
      trainingPose(Math.min(dt, 1 / 30))
    }
    const s = world.side
    const gx = (s * PITCH_L) / 2

    // nisan: fare isinini kale duzlemiyle kes (kamera hareket ettikce de)
    ndc.set(ctl.aimNdc[0], ctl.aimNdc[1])
    ray.setFromCamera(ndc, camera)
    const o = ray.ray.origin
    const dir = ray.ray.direction
    if (dir.x * s > 1e-3 && !ctl.inFlight) {
      const t = (gx - o.x) / dir.x
      const [y0, y1] = aimYRange()
      ctl.aimY = Math.max(y0, Math.min(y1, o.y + dir.y * t))
      ctl.aimZ = Math.max(-(GOAL_W / 2 + 1.5), Math.min(GOAL_W / 2 + 1.5, o.z + dir.z * t))
      ctl.aimValid = true
    }

    const r = ring.current
    if (r) {
      // macta yalniz sarj sirasinda
      r.visible = !varOn && (ctl.mode === 'antrenman' ? !ctl.inFlight : ctl.charge >= 0 || ctl.setup)
      r.position.set(gx - s * 0.03, ctl.aimY, ctl.aimZ)
      ringMat.color.set(aimInside() ? '#ffffff' : '#ff9a3c')
      ringMat.opacity = ctl.inFlight ? 0.35 : 0.9
      const k = ctl.charge >= 0 ? 1 - 0.35 * Math.min(1, ctl.charge) : 1 // sarjda daralir
      r.scale.setScalar(k)
    }

    // yorunge onizlemesi: girdiler degisince yeniden coz
    // macta yalniz sut sarji sirasinda (insan sutu: top konumundan, 'normal' sut)
    const mac = ctl.mode === 'mac'
    line.visible = !varOn && (mac ? ctl.charge >= 0 : ctl.preview && !ctl.inFlight)
    if (line.visible) {
      const sp = previewSpeed()
      const sx = mac ? world.ball.x : ctl.spotX
      const sz = mac ? world.ball.z : ctl.spotZ
      const typ = mac ? 'normal' : shotType()
      const key = [sx.toFixed(2), sz.toFixed(2), ctl.aimY.toFixed(3), ctl.aimZ.toFixed(3), sp.toFixed(2), typ, ctl.curl, s].join('|')
      if (key !== prevKey.current) {
        prevKey.current = key
        const shot = solveShot(sx, sz, s, ctl.aimY, ctl.aimZ, sp, typ, ctl.curl)
        const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute
        const n = predictPath(sx, sz, shot.v, shot.w, s, pos.array as Float32Array)
        pos.needsUpdate = true
        line.geometry.setDrawRange(0, n)
        line.computeLineDistances()
        ;(line.material as THREE.LineDashedMaterial).color.set(shot.reach ? '#ffffff' : '#ff9a3c')
      }
    }
  })

  return (
    <>
      <primitive object={line} />
      <group ref={ring} rotation-y={Math.PI / 2} renderOrder={6}>
        <mesh material={ringMat} renderOrder={6}>
          <ringGeometry args={[0.15, 0.19, 40]} />
        </mesh>
        <mesh material={ringMat} renderOrder={6}>
          <circleGeometry args={[0.03, 16]} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <group key={i} rotation-z={(i * Math.PI) / 2}>
            <mesh material={ringMat} renderOrder={6} position={[0, 0.25, 0]}>
              <planeGeometry args={[0.025, 0.1]} />
            </mesh>
          </group>
        ))}
      </group>
    </>
  )
}
