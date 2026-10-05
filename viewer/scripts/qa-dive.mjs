// O2 (QA): 6 kaleci dalisi (sol/sag x alcak/orta/yuksek) testKick ile, kare dizisi + kaleci durumu. Kullanim: run-browser.sh node scripts/qa-dive.mjs <klasor> [--speed 22]
import fs from 'node:fs'
import { BASE, launch, waitReady, save } from './qa-lib.mjs'
const out = process.argv[2]
const si = process.argv.indexOf('--speed')
const speed = si >= 0 ? Number(process.argv[si + 1]) : 22
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch({ w: 1280, h: 720 })
await p.goto(BASE + '?mode=mac&half=10')
await waitReady(p)
await p.waitForTimeout(2000)
const cam = async (name) => { await p.getByText(name, { exact: true }).first().click().catch(() => {}) }
await cam('Yan ağ')
await p.waitForTimeout(800)
const cases = [['sol-alcak', 0.3, -1.5], ['sol-orta', 1.0, -1.5], ['sol-yuksek', 1.9, -1.5], ['sag-alcak', 0.3, 1.5], ['sag-orta', 1.0, 1.5], ['sag-yuksek', 1.9, 1.5]]
const summary = []
const REP = 4
for (const [name, ty, tz] of cases.flatMap((c) => Array.from({ length: REP }, (_, r) => [c[0] + '#' + r, c[1], c[2]]))) {
  for (let i = 0; i < 100 && (await p.evaluate(() => window.__game.match.phase)) !== 'play'; i++) { await p.keyboard.press('k'); await p.waitForTimeout(150) }
  await p.evaluate(() => { const g = window.__game; for (const q of g.players) { q.hasBall = false; if (q.role !== 'kaleci') Object.assign(q, { x: -Math.sign(g.players[4].x) * 12, z: ((q.id % 4) - 1.5) * 4, vx: 0, vz: 0 }) } const k = g.players[4]; Object.assign(k, { z: 0 }) })
  await p.waitForTimeout(1200)
  await p.evaluate(([ty, tz, V]) => {
    const g = window.__game; const k = g.players.find((q) => q.id === 4); const sd = Math.sign(k.x)
    const sx = sd * 6
    g.match.lastTouch = { player: 3, team: 0, t: window.__rules.time }
    window.__world.placeBall(sx, 0)
    const sh = window.__shot.solveShot(sx, 0, sd, ty, tz, V, 'normal', 0)
    window.__world.kick({ x: sh.v.x, y: sh.v.y, z: sh.v.z }, { x: sh.w.x, y: sh.w.y, z: sh.w.z })
  }, [ty, tz, speed])
  void ('v sonrasi', JSON.stringify(await p.evaluate(() => { const b = window.__world.ball; return [b.x, b.vx, b.vy, window.__game.match.phase] })))
  const rows = []
  for (let i = 0; i < 16; i++) {
    rows.push(await p.evaluate(() => { const g = window.__game; const k = g.players.find((q) => q.id === 4); const b = window.__world.ball; return k ? { anim: k.anim, kx: +k.x.toFixed(2), kz: +k.z.toFixed(2), bx: +b.x.toFixed(2), by: +b.y.toFixed(2), bz: +b.z.toFixed(2) } : { none: 1, bx: +b.x.toFixed(2), by: +b.y.toFixed(2), bz: +b.z.toFixed(2) } }))
    if (i % 2 === 0 && name.endsWith('#0')) await p.screenshot({ path: `${out}/${name}-${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 70 })
    await p.waitForTimeout(100)
  }
  const anims = [...new Set(rows.map((r) => r.anim))]
  summary.push({ name, anims, kz0: rows[0].kz, kzEnd: rows.at(-1).kz, ballEnd: [rows.at(-1).bx, rows.at(-1).by, rows.at(-1).bz] })
  console.log(JSON.stringify(summary.at(-1)))
}
save(out + '/dive.json', { summary, logs })
await b.close()
