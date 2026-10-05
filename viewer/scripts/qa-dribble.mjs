// O2 (QA): sprintle surme, 90/180 derece donus, durma. Rakipler her turda uzak kosede tutulur (temassiz olcum).
// Kullanim: run-browser.sh node scripts/qa-dribble.mjs <klasor>
import fs from 'node:fs'
import { BASE, launch, waitReady, installRecorder, save } from './qa-lib.mjs'
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch({ w: 1280, h: 720 })
await p.goto(BASE + '?mode=mac&half=10')
await waitReady(p)
await installRecorder(p)
const ph = () => p.evaluate(() => window.__game.match.phase)
for (let i = 0; i < 300 && (await ph()) !== 'play'; i++) { await p.keyboard.press('k'); await p.waitForTimeout(150) }
const setup = () => p.evaluate(() => {
  const g = window.__game
  const c = g.controlledPlayer()
  const d = g.match.attackDir[0]
  for (const q of g.players) { q.hasBall = false }
  Object.assign(c, { x: -d * 8, z: 0, vx: 0, vz: 0, hasBall: false, actionLock: 0 })
  window.__world.placeBall(c.x + d * 0.5, 0)
  return c.id
})
const far = () => p.evaluate(() => { const g = window.__game; const c = g.controlledPlayer(); g.players.forEach((q, i) => { if (q.id !== c.id) Object.assign(q, { x: (i < 4 ? -1 : 1) * 17.5, z: ((i % 4) - 1.5) * 4, vx: 0, vz: 0 }) }) })
const sample = () => p.evaluate(() => { const g = window.__game; const c = g.controlledPlayer(); const w = window.__world.ball; return { x: c.x, z: c.z, vx: c.vx, vz: c.vz, f: c.facing, anim: c.anim, hb: c.hasBall, bd: Math.hypot(w.x - c.x, w.z - c.z), st: c.stamina } })
const rows = []
const seq = [['', 600], ['d', 400], ['d+shift', 1800], ['a+shift', 1800], ['w+shift', 1200], ['', 1200], ['s', 1000], ['', 800]]
await setup(); await p.waitForTimeout(300)
const t0 = Date.now()
let held = new Set()
for (const [keys, ms] of seq) {
  const want = new Set(keys ? keys.split('+').map((k) => (k === 'shift' ? 'Shift' : k)) : [])
  for (const k of [...held]) if (!want.has(k)) { await p.keyboard.up(k); held.delete(k) }
  for (const k of want) if (!held.has(k)) { await p.keyboard.down(k); held.add(k) }
  const tEnd = Date.now() + ms
  while (Date.now() < tEnd) { await far(); rows.push({ t: (Date.now() - t0) / 1000, keys, ...(await sample()) }); await p.waitForTimeout(60) }
}
for (const k of held) await p.keyboard.up(k)
const sp = (r) => Math.hypot(r.vx, r.vz)
const sum = {
  maxSpeed: +Math.max(...rows.map(sp)).toFixed(2),
  maxBallDist: +Math.max(...rows.filter((r) => r.keys.includes('shift')).map((r) => r.bd)).toFixed(2),
  ballLost: rows.filter((r) => r.bd > 2.5).length,
  noBallFrac: +(rows.filter((r) => !r.hb).length / rows.length).toFixed(2),
}
// 180: a+shift basladiktan sonra hiz vektorunun yonu tersine donene dek gecen sure
const i0 = rows.findIndex((r) => r.keys === 'a+shift')
const v0 = rows[i0 - 1] || rows[i0]
const rev = rows.slice(i0).find((r) => r.vx * v0.vx + r.vz * v0.vz < 0 && sp(r) > 2)
sum.turn180 = rev ? +(rev.t - rows[i0].t).toFixed(2) : null
const j0 = rows.findIndex((r) => r.keys === '' && r.t > rows[i0].t + 4)
const stopRow = rows.slice(j0).find((r) => sp(r) < 0.3)
sum.stopTime = stopRow ? +(stopRow.t - rows[j0].t).toFixed(2) : null
sum.stopDist = stopRow ? +Math.hypot(stopRow.x - rows[j0].x, stopRow.z - rows[j0].z).toFixed(2) : null
console.log(JSON.stringify(sum))
console.log(rows.filter((_, i) => i % 6 === 0).map((r) => `${r.t.toFixed(1)} ${r.keys.padEnd(8)} v=${sp(r).toFixed(1)} ${r.anim} ball=${r.hb ? 'ayakta' : 'serbest'} bd=${r.bd.toFixed(1)}`).join('\n'))
save(out + '/dribble.json', { sum, rows, logs })
await b.close()
