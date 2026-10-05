// Koordinator olcumu: top-ag etkilesimi. npx -y tsx scripts/koord-net-probe.mjs
import { World } from '../src/sim.ts'
import { BALL_R, GOAL_H, NET_D_BOTTOM, NET_D_TOP, PITCH_L } from '../src/pitch.ts'

const side = 1
const rows = []
for (const V of [15, 25, 32]) {
  for (const y0 of [0.3, 1.0, 1.7]) {
    const w = new World()
    w.side = side
    // ag dinlensin
    for (let f = 0; f < 120; f++) w.step(1 / 60)
    const x0 = Float32Array.from(w.pos)
    const b = w.ball
    const startX = side * (PITCH_L / 2 - 1.0)
    Object.assign(b, { x: startX, y: y0, z: 0.4, px: startX, py: y0, pz: 0.4, vx: side * V, vy: 0.6, vz: 0, wx: 0, wy: 0, wz: 0 })
    let planePen = -1e9, maxD = -1e9, tMax = 0, maxBulge = 0, reb = 0, vAtMax = 0, exitBack = false, scored = false
    let reachedMax = false, firstContact = -1
    const trace = []
    for (let f = 0; f < 240; f++) {
      const g0 = w.goals
      w.step(1 / 60)
      if (w.goals > g0) scored = true
      const d = side * b.x - PITCH_L / 2
      const va = side * b.vx
      if (firstContact < 0 && w.netContact) firstContact = f
      // arka duzlem egik: d = Db - (Db-Dt)*y/H; asma = (merkez d + R) - duzlem
      const pen = d + BALL_R - (NET_D_BOTTOM - (NET_D_BOTTOM - NET_D_TOP) * b.y / GOAL_H)
      if (pen > planePen) planePen = pen
      if (d > maxD) { maxD = d; tMax = f }
      else if (!reachedMax && f > tMax + 1) reachedMax = true
      if (reachedMax && -va > reb) reb = -va
      if (scored && d < -BALL_R) exitBack = true
      let bulge = 0
      for (let i = 0; i < w.pos.length; i += 3) {
        const dx = side * (w.pos[i] - x0[i])
        if (dx > bulge) bulge = dx
      }
      if (bulge > maxBulge) maxBulge = bulge
      if (f % 3 === 0 && f < 60) trace.push(`${f}:d=${d.toFixed(2)},va=${va.toFixed(1)}`)
    }
    rows.push({ V, y0, scored, firstContact, maxDepth: +maxD.toFixed(2), planePen: +planePen.toFixed(2), tMaxFrame: tMax, maxBulge: +maxBulge.toFixed(2), reboundSpeed: +reb.toFixed(2), endD: +(side * b.x - PITCH_L / 2).toFixed(2), endY: +b.y.toFixed(2), exitBack })
    if (V === 25 && y0 === 1.0) console.log('iz (V=25,y=1.0):', trace.join(' '))
  }
}
console.table(rows)
console.log('referans: ag arka paneli cizgiden 1.5 m (zemin) / 0.8 m (ust) geride; GOAL_H =', GOAL_H)
if (rows.some((r) => r.exitBack)) {
  console.error('BASARISIZ: exitBack true')
  process.exit(1)
}
