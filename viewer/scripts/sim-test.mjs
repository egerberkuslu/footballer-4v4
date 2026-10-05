// Bassiz fizik testi: npx -y tsx scripts/sim-test.mjs [sut_sayisi] [tohum]
import { World } from '../src/sim.ts'
import { BALL_R, GOAL_H, GOAL_W, NET_D_BOTTOM, PITCH_L } from '../src/pitch.ts'

const N = Number(process.argv[2] ?? 200)
const SEED = Number(process.argv[3] ?? 1)
const FRAMES = 300 // sut basina 5 s
const hw = GOAL_W / 2
const w = new World()
w.seed(SEED)

const stats = { nan: 0, goals: 0, expGoals: 0, mismatch: [], escape: [], leak: [], inBag: 0, rebOut: 0, bag: [], kinds: {} }
const times = []
const outSpeed = []
const nearTimes = []
for (let s = 0; s < N; s++) {
  w.side = s % 2 ? -1 : 1
  const g0 = w.goals
  w.shoot()
  const kind = w.lastShot
  stats.kinds[kind] ??= { n: 0, goal: 0 }
  stats.kinds[kind].n++
  const b = w.ball
  let inside = false
  let escaped = false
  let leaked = false
  let maxD = 0
  let prevD = -10
  for (let f = 0; f < FRAMES; f++) {
    const t0 = performance.now()
    w.step(1 / 60)
    const dt = performance.now() - t0
    times.push(dt)
    const d = w.side * b.x - PITCH_L / 2
    if (d > -1.5 && d < 3) nearTimes.push(dt)
    if (!Number.isFinite(b.x + b.y + b.z) || w.pos.some((v) => !Number.isFinite(v))) {
      stats.nan++
      break
    }
    const scored = w.goals > g0
    // bagimsiz gol olcutu: top tamamen cizgiyi gecip kale icinde
    if (d > BALL_R + 0.02 && d < NET_D_BOTTOM + 0.5 && Math.abs(b.z) < hw + 0.3 && b.y < GOAL_H - BALL_R) inside = true
    if (scored) {
      if (d > -0.5) maxD = Math.max(maxD, d)
      // ag zarfinin disinda ama kale cizgisinin gerisinde: agi delip cikti
      if (d > NET_D_BOTTOM + 0.9 || (d > 0.3 && (Math.abs(b.z) > hw + 0.8 || b.y > GOAL_H + 0.7))) escaped = true
      if (d < 0 && prevD >= 0) { outSpeed.push(Math.hypot(b.vx, b.vy, b.vz)); if (process.env.V) console.log("cikis", s, kind, f, Math.hypot(b.vx, b.vy, b.vz).toFixed(2), "y", b.y.toFixed(2)) }
      prevD = d
    } else if (d > 0.35 && d < NET_D_BOTTOM - 0.3 && Math.abs(b.z) < hw - 0.3 && b.y < GOAL_H - 0.35) leaked = true
  }
  const scored = w.goals > g0
  if (scored) {
    stats.goals++
    stats.kinds[kind].goal++
    stats.bag.push(maxD)
    const d = w.side * b.x - PITCH_L / 2
    if (d > 0) stats.inBag++
    else stats.rebOut++
  }
  if (inside) stats.expGoals++
  if (inside !== scored) stats.mismatch.push({ s, kind, inside, scored })
  if (escaped) stats.escape.push({ s, kind })
  if (leaked && !scored) stats.leak.push({ s, kind })
}
const q = (a, p) => {
  const c = [...a].sort((x, y) => x - y)
  return c[Math.min(c.length - 1, Math.floor(p * c.length))]
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
console.log(`sut ${N}, gol ${stats.goals} (bagimsiz olcut ${stats.expGoals}), NaN ${stats.nan}`)
console.log(`gol tespiti uyumsuz: ${stats.mismatch.length}`, stats.mismatch.slice(0, 5))
console.log(`agdan kacma: ${stats.escape.length}`, stats.escape.slice(0, 5), ` disaridan sizma: ${stats.leak.length}`, stats.leak.slice(0, 5))
console.log(`gol sonrasi top torbada kaldi ${stats.inBag}, sahaya geri dondu ${stats.rebOut}; torba derinligi (top merkezi, kale cizgisinden) ort ${mean(stats.bag).toFixed(2)} m, max ${Math.max(...stats.bag).toFixed(2)} m`)
console.log(`goldan sonra sahaya geri cikis hizi (m/s): n ${outSpeed.length}, ort ${outSpeed.length ? mean(outSpeed).toFixed(2) : '-'}, max ${outSpeed.length ? Math.max(...outSpeed).toFixed(2) : '-'}`)
console.log('tur:', JSON.stringify(stats.kinds))
console.log(`kare suresi (ms): ort ${mean(times).toFixed(3)}, p95 ${q(times, 0.95).toFixed(3)}, max ${Math.max(...times).toFixed(3)}; kale yakininda ort ${mean(nearTimes).toFixed(3)}, p95 ${q(nearTimes, 0.95).toFixed(3)}`)
console.log(`dugum ${w.n}, ip ${w.renderEdges.length / 2}`)

// olay API'si: kick + onEvent
{
  const w2 = new World()
  const ev = []
  w2.onEvent((e) => ev.push(e.type))
  w2.side = 1
  w2.placeBall(PITCH_L / 2 - 9, 0)
  w2.kick({ x: 25, y: 3, z: 0 }, { x: 0, y: 0, z: 0 })
  for (let f = 0; f < 600; f++) w2.step(1 / 60)
  const ev2 = []
  w2.onEvent((e) => ev2.push(e.type))
  w2.placeBall(PITCH_L / 2 - 9, 0)
  w2.kick({ x: 25, y: 2.5, z: 9 }, { x: 0, y: 0, z: 0 })
  for (let f = 0; f < 600; f++) w2.step(1 / 60)
  console.log('olaylar (orta sut):', ev.join(','), '| (aut):', ev2.join(','))
}

// esik ihlali: otomasyon icin cikis kodu 1
{
  const bad = []
  if (stats.nan > 0) bad.push(`NaN ${stats.nan}`)
  if (stats.escape.length > 0) bad.push(`agdan kacma ${stats.escape.length}`)
  if (stats.leak.length > 0) bad.push(`sizma ${stats.leak.length}`)
  if (stats.mismatch.length > 0) bad.push(`gol uyumsuzlugu ${stats.mismatch.length}`)
  if (bad.length) {
    console.error('BASARISIZ:', bad.join(', '))
    process.exit(1)
  }
}
