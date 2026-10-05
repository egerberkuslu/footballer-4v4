// O2 (QA): kirmizi kart 30 s ceza: kart, cikis yuruyusu, 4'e 3, donus. Kullanim: run-browser.sh node scripts/qa-red.mjs <klasor>
import fs from 'node:fs'
import { BASE, launch, waitReady, installRecorder, save } from './qa-lib.mjs'
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch({ w: 1280, h: 720 })
await p.goto(BASE + '?mode=mac&half=10&watch=1')
await waitReady(p); await installRecorder(p)
const ph = () => p.evaluate(() => window.__game.match.phase)
for (let i = 0; i < 100 && (await ph()) !== 'play'; i++) await p.waitForTimeout(200)
const n0 = await p.evaluate(() => window.__qa.ev.length)
await p.evaluate(() => { const g = window.__game; const v = g.players[2]; const a = g.players[6]; Object.assign(a, { x: v.x - 0.6, z: v.z }); g.emit({ type: 'contact', a: 6, b: 2, ballFirst: false, fromBehind: true, intensity: 1, kind: 'slide', x: v.x, z: v.z }) })
const t0 = Date.now(); const rows = []; let shots = 0
while (Date.now() - t0 < 50000) {
  const s = await p.evaluate(() => { const g = window.__game; const q = g.players[6]; return { ph: g.match.phase, off: q.sentOff, x: +q.x.toFixed(1), z: +q.z.toFixed(1), anim: q.anim, clock: +g.match.clock.toFixed(1), badge: [...document.querySelectorAll('*')].map((e) => e.children.length === 0 && /🟥/.test(e.textContent) ? e.textContent.trim() : '').filter(Boolean).slice(0, 2) } })
  rows.push({ t: +((Date.now() - t0) / 1000).toFixed(1), ...s })
  const sec = Math.floor((Date.now() - t0) / 1000)
  if ([4, 8, 20, 36, 45].includes(sec) && shots < 5 && !rows.at(-2)?.shot) { await p.screenshot({ path: `${out}/red-${sec}.png` }); rows.at(-1).shot = 1; shots++ }
  await p.waitForTimeout(500)
}
const ev = (await p.evaluate((n0) => window.__qa.ev.slice(n0), n0)).filter((e) => ['card', 'foul', 'player-return', 'whistle'].includes(e.type)).map((e) => `${e.t} ${e.type} ${e.color || e.reason || ''} ${e.player ?? ''}`)
console.log(ev.join('\n'))
console.log(rows.filter((_, i) => i % 6 === 0).map((r) => `${r.t} ${r.ph} off=${r.off} (${r.x},${r.z}) ${r.anim} ${r.badge.join('|')}`).join('\n'))
save(out + '/red.json', { rows, ev, logs })
await b.close()
