// Oyuncu kapsulu - top temas testi: npx -y tsx scripts/player-contact-test.mjs
// Kapsul sekilleri ve e/mu locomotion.ts writeColliders ile ayni: surme r 0.13, govde r 0.22, kayma r 0.18 (e 0.3, mu 0.4).
// Oyuncu +x yonunde kosar. Kayma: v0'dan SLIDE_A m/s^2 ile yavaslar (varsayim, F2 gercek egrisini bilir).
// Olcut temastan sonra: tepe hiz (6 kare), +0.25 s ve +1 s'de top hizi, top-oyuncu x farki (>0: top onde).
import { World } from '../src/sim.ts'

const DT = 1 / 60
const SLIDE_A = 8
const shapeOf = {
  surme: (x) => ({ a: [x, 0.1, 0], b: [x, 1.75, 0], r: 0.13 }),
  govde: (x) => ({ a: [x, 0.1, 0], b: [x, 1.75, 0], r: 0.22 }),
  kayma: (x) => ({ a: [x + 0.8, 0.15, 0], b: [x - 0.6, 0.3, 0], r: 0.18 }),
}

function run(shape, v0, ballVx, z) {
  const w = new World()
  w.placeBall(0, z)
  w.kick({ x: ballVx, y: 0, z: 0 }, { x: 0, y: 0, z: ballVx !== 0 ? -ballVx / 0.11 : 0 })
  const b = w.ball
  let hit = false
  w.onEvent((e) => { if (e.type === 'oyuncu') hit = true })
  // kayma topa ~0.3 m kala baslar (yavaslayan kapsul 3 m/s'de 0.56 m gider); digerleri 2.5 m geriden
  let px = shape === 'kayma' ? -1.4 : -2.5
  let sp = v0
  let touch = -1, peak = 0, maxY = 0, tunnel = false, peakZ = 0
  const at = {}
  for (let f = 0; f < 420; f++) {
    const s = shapeOf[shape](px)
    w.setDynamicColliders([{ ...s, e: 0.3, mu: 0.4, vx: sp, vy: 0, vz: 0, tag: 'oyuncu', id: 1 }])
    w.step(DT)
    px += sp * DT
    if (shape === 'kayma') sp = Math.max(0, sp - SLIDE_A * DT)
    if (touch < 0 && hit) touch = f
    if (touch >= 0) {
      const k = f - touch
      const sv = Math.hypot(b.vx, b.vz)
      if (k <= 6 && sv > peak) peak = sv
      if (Math.abs(b.vz) > Math.abs(peakZ)) peakZ = b.vz
      if (b.y > maxY) maxY = b.y
      if (k === 15) at.t25 = { v: sv, vx: b.vx, vz: b.vz }
      if (k === 60) at.t1 = { v: sv, vx: b.vx, gap: b.x - px }
      if (z === 0 && b.x < px - 0.3 && k < 30) tunnel = true
    }
  }
  return {
    shape, v0, ballVx, z, touch,
    peak: +peak.toFixed(2),
    'v+.25': at.t25 ? +at.t25.vx.toFixed(2) : null,
    'vz+.25': at.t25 ? +at.t25.vz.toFixed(2) : null,
    'v+1': at.t1 ? +at.t1.vx.toFixed(2) : null,
    'gap+1': at.t1 ? +at.t1.gap.toFixed(2) : null,
    maxY: +maxY.toFixed(2),
    tunnel,
  }
}

const rows = []
for (const shape of ['surme', 'govde', 'kayma'])
  for (const v0 of [3, 5, 7]) {
    rows.push(run(shape, v0, 0, 0)) // duran topa kosu
    rows.push(run(shape, v0, 0, 0.2)) // yandan sıyırma
    rows.push(run(shape, v0, -6, 0)) // gelen top (pas kesme / blok)
    rows.push(run(shape, v0, -20, 0)) // sert sut blogu
  }
console.table(rows)
// 20 m/s yerden top ayakta kapsule carparsa dikey yukselme <= 1 m
const lift = rows.filter((r) => r.ballVx === -20 && r.shape !== 'kayma' && r.maxY > 1)
if (lift.length) { console.error('BASARISIZ: yerden top firliyor (maxY > 1 m)', lift); process.exit(1) }
const bad = rows.filter((r) => r.tunnel || (r.touch < 0 && r.z === 0))
if (bad.length) { console.error('BASARISIZ: tunelleme ya da temas yok', bad); process.exit(1) }
