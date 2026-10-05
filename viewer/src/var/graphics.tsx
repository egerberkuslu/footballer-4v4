// VAR 3B grafikleri: cizgi duzlemi + top izdusumu, ofsayt cizgileri.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { BALL_R, GOAL_H, GOAL_W, PITCH_W } from '../pitch'
import { fmtCm, isGoalLine, lineDist, lineSign, type Verdict } from './judge'

const HW = GOAL_W / 2

// cizgi cercevesi: n = saha disina normal, u = cizgi boyunca
export function lineFrame(v: Verdict) {
  const g = isGoalLine(v.line)
  const s = lineSign(v.line)
  const n = g ? new THREE.Vector3(s, 0, 0) : new THREE.Vector3(0, 0, s)
  const u = g ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)
  const d = lineDist(v.line, v.x, v.z)
  const C = new THREE.Vector3(v.x, v.y, v.z)
  const P = C.clone().addScaledVector(n, -d) // cizgi duzlemindeki izdusum
  return { g, n, u, d, C, P, along: g ? v.z : v.x }
}

// cizgi duzlemi paneli, top izdusumu, bosluk olcegi ve cm etiketi
export function LineGraphics({ v, label }: { v: Verdict; label: boolean }) {
  const f = useMemo(() => lineFrame(v), [v])
  const col = v.crossed ? '#22c55e' : '#ef4444'
  const mats = useMemo(
    () => ({
      panel: new THREE.MeshBasicMaterial({ color: '#9ad8ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      edge: new THREE.LineBasicMaterial({ color: '#e0f4ff', transparent: true, opacity: 0 }),
      strip: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false }),
      disc: new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      ring: new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      gap: new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthTest: false, toneMapped: false }),
    }),
    [col],
  )
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])

  // panel boyutu: kale cizgisinde agzi kapsar, tacta topun cevresi
  const mouth = f.g && Math.abs(v.z) < HW + 1.5
  const cAlong = mouth ? 0 : f.along
  const width = mouth ? GOAL_W + 2.4 : 7
  const height = mouth ? GOAL_H + 0.7 : 2.6
  const rotY = (Math.PI / 2) * lineSign(v.line)
  const center = f.g ? new THREE.Vector3(f.P.x, height / 2, cAlong) : new THREE.Vector3(cAlong, height / 2, f.P.z)
  const edgeGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, height)), [width, height])
  useEffect(() => () => edgeGeo.dispose(), [edgeGeo])

  // topun izdusumu (duzlem uzerinde) ve arka kenardan duzleme bosluk
  const proj = new THREE.Vector3(f.P.x, v.y, f.P.z)
  const back = f.C.clone().addScaledVector(f.n, -BALL_R) // topun saha tarafindaki en arka noktasi
  back.y = v.y
  const gapLen = Math.abs(f.d - BALL_R)
  const gapMid = back.clone().lerp(proj, 0.5)

  const t = useRef(0)
  useFrame((_, dt) => {
    t.current = Math.min(1, t.current + dt / 0.5)
    const k = t.current
    mats.panel.opacity = 0.09 * k
    mats.edge.opacity = 0.75 * k
    mats.strip.opacity = 0.95 * k
    const l = label ? 1 : 0
    mats.disc.opacity = 0.22 * k * (0.4 + 0.6 * l)
    mats.ring.opacity = 0.95 * k
    mats.gap.opacity = 0.95 * l
  })

  return (
    <group>
      <group position={center} rotation-y={rotY}>
        <mesh material={mats.panel} renderOrder={20}>
          <planeGeometry args={[width, height]} />
        </mesh>
        <lineSegments geometry={edgeGeo} material={mats.edge} renderOrder={21} />
      </group>
      {/* karar kenari: cizginin dis kenari boyunca parlak serit */}
      <mesh
        position={f.g ? [f.P.x, 0.006, cAlong] : [cAlong, 0.006, f.P.z]}
        rotation-x={-Math.PI / 2}
        rotation-z={f.g ? Math.PI / 2 : 0}
        material={mats.strip}
        renderOrder={22}
      >
        <planeGeometry args={[width + 2, 0.025]} />
      </mesh>
      {/* top izdusumu */}
      <group position={proj} rotation-y={rotY}>
        <mesh material={mats.disc} renderOrder={23}>
          <circleGeometry args={[BALL_R, 40]} />
        </mesh>
        <mesh material={mats.ring} renderOrder={24}>
          <ringGeometry args={[BALL_R - 0.009, BALL_R + 0.004, 48]} />
        </mesh>
      </group>
      {/* bosluk olcegi: arka kenar -> duzlem */}
      {gapLen > 0.002 && (
        <mesh position={gapMid} rotation-y={f.g ? 0 : Math.PI / 2} material={mats.gap} renderOrder={25}>
          <boxGeometry args={[gapLen, 0.012, 0.012]} />
        </mesh>
      )}
      {label && (
        <Html position={[gapMid.x, v.y + 0.3, gapMid.z]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`var-tag3d ${v.crossed ? 'ok' : 'no'}`}>
            <b>{fmtCm(v.cm)}</b>
            <span>{v.crossed ? 'tamamı geçti' : 'tamamı geçmedi'}</span>
          </div>
        </Html>
      )}
    </group>
  )
}

/**
 * Ofsayt cizgileri: savunma (sondan ikinci savunmaci ya da top) ve hucumcunun en ileri vucut noktasi.
 * defX/attX: dunya x; rz: alicinin z'si (etiket yeri).
 */
type BodyPt = { x: number; y: number; z: number; name: string }
const PT_TR: Record<string, string> = {
  'kafa-ust': 'kafa üstü',
  kafa: 'kafa',
  gogus: 'göğüs',
  kalca: 'kalça',
  'diz-l': 'sol diz',
  'diz-r': 'sağ diz',
  'bilek-l': 'sol ayak bileği',
  'bilek-r': 'sağ ayak bileği',
  'ayak-ucu-l': 'sol ayak ucu',
  'ayak-ucu-r': 'sağ ayak ucu',
  top: 'top',
}
const ptName = (n?: string) => (n ? (PT_TR[n] ?? n) : '')

export function OffsideGraphics({
  defX,
  attX,
  rz,
  off,
  cm,
  label,
  defPt,
  attPt,
}: {
  defX: number
  attX: number
  rz: number
  off: boolean
  cm: number
  label: boolean
  defPt?: BodyPt
  attPt?: BodyPt
}) {
  const attCol = off ? '#ef4444' : '#22c55e'
  const mats = useMemo(
    () => ({
      def: new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false }),
      att: new THREE.MeshBasicMaterial({ color: attCol, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false }),
      defW: new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      attW: new THREE.MeshBasicMaterial({ color: attCol, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      gap: new THREE.MeshBasicMaterial({ color: '#facc15', transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false }),
    }),
    [attCol],
  )
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current = Math.min(1, t.current + dt / 0.45)
    const k = t.current
    mats.def.opacity = mats.att.opacity = 0.95 * k
    mats.defW.opacity = mats.attW.opacity = 0.13 * k
    mats.gap.opacity = 0.95 * k
  })
  const L = PITCH_W + 0.6
  const gapLen = Math.abs(attX - defX)
  const strip = (x: number, m: THREE.Material, w: THREE.Material) => (
    <group position={[x, 0, 0]}>
      <mesh material={m} position={[0, 0.012, 0]} rotation-x={-Math.PI / 2} renderOrder={22}>
        <planeGeometry args={[0.05, L]} />
      </mesh>
      {/* dikey perde: oyuncularin hangi yanda kaldigi okunur */}
      <mesh material={w} position={[0, 1.0, 0]} rotation-y={Math.PI / 2} renderOrder={20}>
        <planeGeometry args={[L, 2.0]} />
      </mesh>
    </group>
  )
  return (
    <group>
      {strip(defX, mats.def, mats.defW)}
      {strip(attX, mats.att, mats.attW)}
      {gapLen > 0.005 && (
        <mesh material={mats.gap} position={[(defX + attX) / 2, 0.02, rz]} rotation-x={-Math.PI / 2} renderOrder={23}>
          <planeGeometry args={[gapLen, 0.06]} />
        </mesh>
      )}
      {/* belirleyici vucut noktalari: kuresel isaret */}
      {attPt && (
        <mesh position={[attPt.x, attPt.y, attPt.z]} renderOrder={26}>
          <sphereGeometry args={[0.07, 12, 8]} />
          <meshBasicMaterial color={attCol} depthTest={false} toneMapped={false} />
        </mesh>
      )}
      {defPt && (
        <mesh position={[defPt.x, defPt.y, defPt.z]} renderOrder={26}>
          <sphereGeometry args={[0.07, 12, 8]} />
          <meshBasicMaterial color="#38bdf8" depthTest={false} toneMapped={false} />
        </mesh>
      )}
      {label && (
        <>
          <Html position={[(defX + attX) / 2, 2.3, rz]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
            <div className={`var-tag3d ${off ? 'no' : 'ok'}`}>
              <b>{fmtCm(cm)}</b>
              <span>{off ? 'ofsayt' : 'ofsayt değil'}</span>
            </div>
          </Html>
          <Html position={[defX, 0.05, rz + 2.4]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
            <div className="var-linetag def">SAVUNMA{defPt ? ` · ${ptName(defPt.name)}` : ''}</div>
          </Html>
          <Html position={[attX, 0.05, rz - 2.4]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
            <div className={`var-linetag ${off ? 'off' : 'on'}`}>HÜCUM{attPt ? ` · ${ptName(attPt.name)}` : ''}</div>
          </Html>
        </>
      )}
    </group>
  )
}
