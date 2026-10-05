// Kenardaki VAR monitoru: ayakli ekran, tente, kablo, ekipman kutusu. 5 cizim cagrisi (birlestirilmis geometri).
// Ekran: bosta "VAR" logosu; inceleme sirasinda dusuk cozunurluklu render hedefi (yalniz gerekince guncellenir).
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { VAR_MONITOR, VAR_SCREEN_Y } from './monitor'

const SW = 0.86 // ekran (m)
const SH = 0.49
const TILT = -0.1 // ekran hafif yukari bakar

/** tekrar kamerasi + render hedefi baglantisi (VarScene yazar) */
export const monitorLink = {
  cam: new THREE.PerspectiveCamera(38, SW / SH, 0.1, 400),
  /** true iken ekran her 2 karede bir yeniden cizilir */
  live: false,
  /** true iken son tekrar karesi ekranda kalir (karar isareti sirasinda) */
  hold: false,
}

function idleTexture() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 292
  const x = c.getContext('2d')!
  const g = x.createLinearGradient(0, 0, 512, 292)
  g.addColorStop(0, '#0d1b2e')
  g.addColorStop(1, '#05080f')
  x.fillStyle = g
  x.fillRect(0, 0, 512, 292)
  x.strokeStyle = 'rgba(125,211,252,0.35)'
  x.lineWidth = 3
  x.strokeRect(14, 14, 484, 264)
  x.fillStyle = '#e8f4ff'
  x.font = '800 104px Inter, system-ui, sans-serif'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.fillText('VAR', 256, 130)
  x.font = '600 22px Inter, system-ui, sans-serif'
  x.fillStyle = 'rgba(200,225,245,0.7)'
  x.fillText('VİDEO YARDIMCI HAKEM', 256, 205)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function signTexture() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 64
  const x = c.getContext('2d')!
  x.fillStyle = '#16233b'
  x.fillRect(0, 0, 512, 64)
  x.fillStyle = '#ffffff'
  x.font = '800 40px Inter, system-ui, sans-serif'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.fillText('VAR · VİDEO YARDIMCI HAKEM', 256, 34)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)))
  return g
}

function build() {
  // tente: 2,8 x 2,2 m, ekranin arkasindan hakemin durdugu yere kadar
  const tx0 = -1.4
  const tx1 = 1.4
  const tz0 = -0.75
  const tz1 = 1.45
  const H = 2.15
  const metal: THREE.BufferGeometry[] = []
  for (const x of [tx0, tx1])
    for (const z of [tz0, tz1]) {
      metal.push(at(new THREE.BoxGeometry(0.045, H, 0.045), x, H / 2, z))
      metal.push(at(new THREE.CylinderGeometry(0.11, 0.12, 0.1, 10), x, 0.05, z)) // ayak agirligi
    }
  // ust cerceve
  const midX = (tx0 + tx1) / 2
  const midZ = (tz0 + tz1) / 2
  metal.push(at(new THREE.BoxGeometry(tx1 - tx0, 0.04, 0.04), midX, H, tz0))
  metal.push(at(new THREE.BoxGeometry(tx1 - tx0, 0.04, 0.04), midX, H, tz1))
  metal.push(at(new THREE.BoxGeometry(0.04, 0.04, tz1 - tz0), tx0, H, midZ))
  metal.push(at(new THREE.BoxGeometry(0.04, 0.04, tz1 - tz0), tx1, H, midZ))
  // monitor ayagi: taban + direk + VESA kolu
  metal.push(at(new THREE.BoxGeometry(0.6, 0.03, 0.48), 0, 0.015, -0.12))
  metal.push(at(new THREE.CylinderGeometry(0.032, 0.036, VAR_SCREEN_Y - 0.05, 12), 0, (VAR_SCREEN_Y - 0.05) / 2, -0.12))
  metal.push(at(new THREE.BoxGeometry(0.12, 0.12, 0.1), 0, VAR_SCREEN_Y, -0.08))

  // kumas: dort yuzlu cati + etek
  const fabric: THREE.BufferGeometry[] = []
  const roof = new THREE.ConeGeometry(Math.hypot(tx1 - tx0, tz1 - tz0) / 2, 0.55, 4, 1, true)
  roof.rotateY(Math.PI / 4)
  roof.scale(1, 1, (tz1 - tz0) / (tx1 - tx0))
  fabric.push(at(roof, midX, H + 0.275, midZ))
  // yan ve arka etekler (on etek tabelayla ayri)
  fabric.push(at(new THREE.BoxGeometry(tx1 - tx0, 0.22, 0.01), midX, H - 0.11, tz0))
  fabric.push(at(new THREE.BoxGeometry(0.01, 0.22, tz1 - tz0), tx0, H - 0.11, midZ))
  fabric.push(at(new THREE.BoxGeometry(0.01, 0.22, tz1 - tz0), tx1, H - 0.11, midZ))
  // arka duvar perdesi (ekranin arkasi, golge ve yansima azaltir)
  fabric.push(at(new THREE.BoxGeometry(tx1 - tx0, H - 0.25, 0.01), midX, (H - 0.25) / 2 + 0.02, tz0))

  // siyah plastik: ekran kasasi, ekipman kutusu, kablo
  const black: THREE.BufferGeometry[] = []
  black.push(at(new THREE.BoxGeometry(SW + 0.05, SH + 0.05, 0.06), 0, VAR_SCREEN_Y, -0.02, TILT))
  black.push(at(new THREE.BoxGeometry(0.52, 0.36, 0.3), -0.85, 0.18, -0.45))
  black.push(at(new THREE.BoxGeometry(0.3, 0.05, 0.22), -0.85, 0.385, -0.45)) // kapak tutamagi
  const cable = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.03, -0.3),
    new THREE.Vector3(-0.2, 0.012, -0.5),
    new THREE.Vector3(-0.6, 0.012, -0.45),
    new THREE.Vector3(-0.85, 0.05, -0.32),
    new THREE.Vector3(-0.85, 0.15, -0.29),
  ])
  black.push(new THREE.TubeGeometry(cable, 24, 0.008, 5, false))
  const cable2 = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.05, 0.05, -0.55),
    new THREE.Vector3(-1.3, 0.012, -0.9),
    new THREE.Vector3(-1.6, 0.012, -1.8),
    new THREE.Vector3(-2.4, 0.012, -2.2),
  ])
  black.push(new THREE.TubeGeometry(cable2, 24, 0.01, 5, false))

  const m = (list: THREE.BufferGeometry[]) => {
    const r = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
    list.forEach((g) => g.dispose())
    return r
  }
  return {
    metal: m(metal),
    fabric: m(fabric),
    black: m(black),
    sign: { w: tx1 - tx0, y: H - 0.11, z: tz1 },
  }
}

export function VarMonitor() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const parts = useMemo(build, [])
  const tex = useMemo(() => ({ idle: idleTexture(), sign: signTexture() }), [])
  const rt = useMemo(() => {
    const r = new THREE.WebGLRenderTarget(512, 292, { samples: 0, depthBuffer: true })
    r.texture.colorSpace = THREE.LinearSRGBColorSpace
    return r
  }, [])
  const mats = useMemo(
    () => ({
      metal: new THREE.MeshStandardMaterial({ color: '#8d949c', metalness: 0.75, roughness: 0.38 }),
      fabric: new THREE.MeshStandardMaterial({ color: '#1b2940', roughness: 0.85, side: THREE.DoubleSide }),
      black: new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.5, metalness: 0.2 }),
      screen: new THREE.MeshBasicMaterial({ map: tex.idle, toneMapped: false }),
      sign: new THREE.MeshStandardMaterial({ map: tex.sign, roughness: 0.8 }),
    }),
    [tex],
  )
  const screen = useRef<THREE.Mesh>(null)
  const n = useRef(0)

  useEffect(
    () => () => {
      Object.values(parts).forEach((g) => (g as THREE.BufferGeometry).dispose?.())
      Object.values(mats).forEach((m) => m.dispose())
      tex.idle.dispose()
      tex.sign.dispose()
      rt.dispose()
    },
    [parts, mats, tex, rt],
  )

  useFrame(() => {
    const s = screen.current
    if (!s) return
    const live = monitorLink.live
    const want = live || monitorLink.hold ? rt.texture : tex.idle
    if (mats.screen.map !== want) {
      mats.screen.map = want
      mats.screen.needsUpdate = true
    }
    if (!live || n.current++ % 2) return
    // tekrar kamerasindan ekrana ciz (ekranin kendisi gizli: geri besleme olmasin)
    s.visible = false
    const auto = gl.shadowMap.autoUpdate
    gl.shadowMap.autoUpdate = false
    const prevRT = gl.getRenderTarget()
    gl.setRenderTarget(rt)
    gl.clear()
    gl.render(scene, monitorLink.cam)
    gl.setRenderTarget(prevRT)
    gl.shadowMap.autoUpdate = auto
    s.visible = true
  }, 0)

  const M = VAR_MONITOR
  return (
    <group position={[M.x, 0, M.z]} rotation-y={M.facing}>
      <mesh geometry={parts.metal} material={mats.metal} castShadow receiveShadow />
      <mesh geometry={parts.fabric} material={mats.fabric} castShadow receiveShadow />
      <mesh geometry={parts.black} material={mats.black} castShadow receiveShadow />
      <mesh ref={screen} material={mats.screen} position={[0, VAR_SCREEN_Y, 0.012]} rotation-x={TILT}>
        <planeGeometry args={[SW, SH]} />
      </mesh>
      <mesh material={mats.sign} position={[0, parts.sign.y, parts.sign.z + 0.006]}>
        <planeGeometry args={[parts.sign.w, 0.22]} />
      </mesh>
    </group>
  )
}
