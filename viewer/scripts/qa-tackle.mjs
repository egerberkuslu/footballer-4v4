// O2 (QA): kontrollu ayakta/kayarak mudahale. Rakip AI topu surer, insan oyuncu onden yaklasir, mesafe <1.2 m iken E (ya da E E). Kullanim: run-browser.sh node scripts/qa-tackle.mjs <klasor> [--slide]
import fs from 'node:fs'
import { BASE, launch, waitReady, installRecorder, save } from './qa-lib.mjs'
const out = process.argv[2]
const SLIDE = process.argv.includes('--slide')
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch({ w: 1280, h: 720 })
await p.goto(BASE + '?mode=mac&half=10')
await waitReady(p)
await installRecorder(p)
const ph = () => p.evaluate(() => window.__game.match.phase)
for (let i = 0; i < 300 && (await ph()) !== 'play'; i++) { await p.keyboard.press('k'); await p.waitForTimeout(150) }
const pos = () => p.evaluate(() => { const c = window.__game.controlledPlayer(); return c.x })
const x0 = await pos(); await p.keyboard.down('d'); await p.waitForTimeout(400); await p.keyboard.up('d')
const dSign = Math.sign((await pos()) - x0) || 1
console.log('d tusu x yonu', dSign)
const res = []
for (let trial = 0; trial < 10; trial++) {
  const n0 = await p.evaluate(() => window.__qa.ev.length)
  await p.evaluate((trial) => {
    const g = window.__game
    const c = g.controlledPlayer()
    const d = g.match.attackDir[0]
    const opp = g.players.find((q) => q.team !== c.team && q.role !== 'kaleci')
    for (const q of g.players) { q.hasBall = false; if (q !== c && q !== opp) Object.assign(q, { x: (q.team ? 1 : -1) * 17, z: 10 - (q.id % 4) * 5, vx: 0, vz: 0 }) }
    const z = (trial % 5 - 2) * 2
    Object.assign(c, { x: 0, z, vx: 0, vz: 0, actionLock: 0 })
    Object.assign(opp, { x: -d * 7, z, vx: 0, vz: 0, actionLock: 0 })
    window.__world.placeBall(opp.x + d * 0.5 * -1, z)
    window.__qa.opp = opp.id
  }, trial)
  await p.waitForTimeout(500)
  await p.evaluate(() => { const g = window.__game; const c = g.controlledPlayer(); const o = g.players[window.__qa.opp]; const sg = Math.sign(o.vx) || 1; Object.assign(c, { x: o.x + sg * 5, z: o.z, vx: 0, vz: 0 }) })
  let done = false
  const t0 = Date.now()
  while (Date.now() - t0 < 6000 && !done) {
    const s = await p.evaluate(() => { const g = window.__game; const c = g.controlledPlayer(); const o = g.players[window.__qa.opp]; const b = window.__world.ball; return { dp: Math.hypot(o.x - c.x, o.z - c.z), db: Math.hypot(b.x - c.x, b.z - c.z), ox: o.x - c.x, oz: o.z - c.z } })
    if (s.dp > 1.2) { const k = (s.ox > 0) === (dSign > 0) ? 'd' : 'a'; await p.keyboard.down(k); await p.waitForTimeout(60); await p.keyboard.up(k) } else {
      if (SLIDE) { await p.keyboard.press('e'); await p.waitForTimeout(100); await p.keyboard.press('e') } else await p.keyboard.press('e')
      done = true
    }
    await p.waitForTimeout(30)
  }
  await p.waitForTimeout(1500)
  const ev = await p.evaluate((n0) => window.__qa.ev.slice(n0), n0)
  const ct = ev.filter((e) => e.type === 'contact')
  res.push({ trial, pressed: done, contacts: ct.map((e) => `${e.kind}${e.ballFirst ? '+ball' : ''}${e.fromBehind ? '+behind' : ''}`), foul: ev.some((e) => e.type === 'foul'), gotBall: ev.some((e) => e.type === 'touch' && (e.kind === 'tackle')) })
  if (await p.evaluate(() => window.__game.match.phase) !== 'play') for (let i = 0; i < 100 && (await ph()) !== 'play'; i++) { await p.keyboard.press('k'); await p.waitForTimeout(150) }
}
console.log(res.map((r) => JSON.stringify(r)).join('\n'))
console.log('ozet', { pressed: res.filter((r) => r.pressed).length, foul: res.filter((r) => r.foul).length, gotBall: res.filter((r) => r.gotBall).length, ballFirst: res.filter((r) => r.contacts.some((c) => c.includes('+ball'))).length })
save(out + '/tackle.json', { res, logs })
await b.close()
