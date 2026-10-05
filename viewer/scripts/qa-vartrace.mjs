// O2 (QA): gol sonrasi elle VAR, hakemin monitore uzakligi 100 ms arayla. Kullanim: run-browser.sh node scripts/qa-vartrace.mjs <klasor>
import fs from 'node:fs'
import { BASE, launch, waitReady, installRecorder, save } from './qa-lib.mjs'
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch()
await p.goto(BASE + '?mode=mac&dev=1&half=10')
await waitReady(p)
await installRecorder(p)
const ph = () => p.evaluate(() => window.__game.match.phase)
for (let i = 0; i < 300 && (await ph()) !== 'play'; i++) { await p.keyboard.press('k'); await p.waitForTimeout(150) }
const s = await p.evaluate(() => window.__game.match.attackDir[0])
await p.evaluate((s) => {
  const g = window.__game
  for (const q of g.players) q.hasBall = false
  g.match.lastTouch = { player: 3, team: 0, t: window.__rules.time }
  window.__world.placeBall(s * 19.2, 1.2)
  window.__world.kick({ x: s * 7, y: 0.3, z: 0 }, { x: 0, y: 0, z: 0 })
}, s)
for (let i = 0; i < 100 && (await ph()) === 'play'; i++) await p.waitForTimeout(100)
await p.waitForTimeout(1200)
await p.keyboard.press('x')
const rows = []
const t0 = Date.now()
let started = false
while (Date.now() - t0 < 40000) {
  const r = await p.evaluate(() => { const g = window.__game; const m = { x: 0, z: -14.1 }; return { ph: g.match.phase, anim: g.referee.anim, x: g.referee.x, z: g.referee.z, d: Math.hypot(g.referee.x - m.x, g.referee.z - m.z), clock: g.match.clock } })
  rows.push({ t: (Date.now() - t0) / 1000, ...r })
  if (r.ph === 'var') started = true
  if (started && r.ph !== 'var') break
  if (!started && Date.now() - t0 > 6000) break
  await p.waitForTimeout(100)
}
const v0 = rows.find((r) => r.ph === 'var')
let maxUp = 0, prev = null
for (const r of rows) { if (r.ph === 'var' && prev) maxUp = Math.max(maxUp, r.d - prev.d); prev = r.ph === 'var' ? r : null }
const arrive = rows.find((r) => r.ph === 'var' && r.d < 1.5)
const dmin = rows.filter((r) => r.ph === 'var').reduce((m, r) => Math.min(m, r.d), 99)
const sum = { started, varStart: v0?.t, d0: v0?.d, arriveT: arrive && +(arrive.t - v0.t).toFixed(2), dmin, maxStepAway: +maxUp.toFixed(2), n: rows.length, clockRewind: rows.some((r, i) => i && r.clock < rows[i - 1].clock - 1) }
console.log(JSON.stringify(sum))
console.log(rows.filter((_, i) => i % 5 === 0).map((r) => `${r.t.toFixed(1)} ${r.ph} ${r.anim} d=${r.d.toFixed(1)}`).join('\n'))
save(out + '/vartrace.json', { sum, rows, logs })
await b.close()
