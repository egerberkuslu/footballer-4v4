// O2 (QA): kale vuruşu + insan kaleci elde tutuş. Kullanım: scripts/run-browser.sh node scripts/qa-keeper.mjs <klasör> [--delay 1000]
import fs from 'node:fs'
import { BASE, launch, waitReady, installRecorder, save } from './qa-lib.mjs'
const out = process.argv[2]
const delay = Number(process.argv[process.argv.indexOf('--delay') + 1] || 1000)
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch({ w: 1280, h: 720 })
await p.goto(BASE + '?mode=mac&dev=1')
await waitReady(p)
await installRecorder(p)
const ph = () => p.evaluate(() => window.__game.match.phase)
for (let i = 0; i < 400 && (await ph()) !== 'play'; i++) { await p.keyboard.press('k'); await p.waitForTimeout(100) }
await p.evaluate(() => {
  const g = window.__game
  for (const q of g.players) q.hasBall = false
  const q = g.players[5]
  g.match.lastTouch = { player: q.id, team: q.team, t: window.__rules.time }
  window.__world.placeBall(-19, 7)
  window.__world.kick({ x: -9, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
})
let t0 = Date.now()
while ((await ph()) !== 'goalkick' && Date.now() - t0 < 8000) await p.waitForTimeout(50)
const tg = Date.now()
console.log('faz', await ph())
const snap = () => p.evaluate(() => { const g = window.__game; const c = g.controlledPlayer?.(); return { phase: g.match.phase, ctrl: c && { id: c.id, role: c.role, hasBall: c.hasBall, anim: c.anim }, hint: document.querySelector('.hint,.ctl-hint')?.textContent } })
const rows = []
for (let i = 0; i < 40; i++) { rows.push({ ms: Date.now() - tg, ...(await snap()) }); if (Date.now() - tg > delay && !rows.pressed) { rows.pressed = 1; await p.mouse.move(900, 300); await p.keyboard.down('k'); await p.waitForTimeout(250); await p.keyboard.up('k') } await p.waitForTimeout(150) }
const ev = await p.evaluate(() => window.__qa.ev.slice(-25))
save(out + '/keeper.json', { delay, rows, ev, logs })
await p.screenshot({ path: out + '/keeper.png' })
console.log(rows.map((r) => `${r.ms} ${r.phase} ctrl=${r.ctrl?.id}${r.ctrl?.role?.[0]} ball=${r.ctrl?.hasBall} ${r.ctrl?.anim} | ${r.hint || ''}`).join('\n'))
console.log(ev.map((e) => `${e.t} ${e.type} ${e.kind || e.reason || ''} ${e.phase}`).join('\n'))
await b.close()
