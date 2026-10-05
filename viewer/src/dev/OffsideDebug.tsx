import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BODY_N, BODY_RADII, bodyExtent, bodyPoints } from '../game/bodyPoints'
import { game } from '../game/store'
import type { Player } from '../game/types'
import { BALL_R, PITCH_W } from '../pitch'
import { world } from '../sim'

// Ofsayt hitbox'lari: vucut noktalari (kollar yok) ve iki takimin ofsayt cizgisi.
// Nokta renkleri: ev kirmizi-sari, deplasman mavi; en ileri nokta beyaz halka.
const MAX_P = 12
const HW = PITCH_W / 2

export function OffsideDebug() {
  const pts = useRef<THREE.InstancedMesh>(null)
  const lines = useRef<THREE.LineSegments>(null)
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 2 * 3), 3))
    return g
  }, [])
  const tmp = useMemo(() => new THREE.Object3D(), [])
  const col = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const players = game.players.filter((p) => !p.sentOff)
    const mesh = pts.current
    if (mesh) {
      let k = 0
      for (const p of players) {
        const a = bodyPoints.get(p.id)
        if (!a) continue
        for (let i = 0; i < BODY_N && k < mesh.count; i++, k++) {
          tmp.position.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])
          tmp.scale.setScalar(Math.max(0.03, BODY_RADII[i]))
          tmp.updateMatrix()
          mesh.setMatrixAt(k, tmp.matrix)
          col.set(p.team === 0 ? '#ffb020' : '#4aa3ff')
          mesh.setColorAt(k, col)
        }
      }
      mesh.count = Math.min(MAX_P * BODY_N, k)
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    // ofsayt cizgileri: her takim icin (savunan takimin sondan ikinci oyuncusu ya da top)
    const pos = geom.attributes.position as THREE.BufferAttribute
    let seg = 0
    for (const team of [0, 1] as const) {
      const d = game.match.attackDir[team]
      const opp: Player[] = players.filter((q) => q.team !== team)
      const ext = opp.map((q) => bodyExtent(q, d)).sort((a, b) => b - a)
      const second = ext.length >= 2 ? ext[1] : -1e9
      const ball = d * world.ball.x + BALL_R
      const line = Math.max(second, ball)
      const x = d * line
      pos.setXYZ(seg * 2, x, 0.05, -HW)
      pos.setXYZ(seg * 2 + 1, x, 0.05, HW)
      seg++
      // topun cizgisi (ince)
      const bx = d * ball
      pos.setXYZ(seg * 2, bx, 0.06, -HW)
      pos.setXYZ(seg * 2 + 1, bx, 0.06, HW)
      seg++
    }
    pos.needsUpdate = true
    if (lines.current) lines.current.geometry.setDrawRange(0, seg * 2)
  })

  return (
    <>
      <instancedMesh ref={pts} args={[undefined, undefined, MAX_P * BODY_N]} frustumCulled={false} renderOrder={995}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial transparent opacity={0.8} depthTest={false} toneMapped={false} />
      </instancedMesh>
      <lineSegments ref={lines} geometry={geom} frustumCulled={false} renderOrder={996}>
        <lineBasicMaterial color="#ff2bd6" depthTest={false} transparent opacity={0.9} toneMapped={false} />
      </lineSegments>
    </>
  )
}
