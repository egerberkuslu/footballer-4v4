// Lokomosyon ajani: GERCEK mac (AI-AI izleme, gercek zaman) saha oyuncularinin hiz + anim adi dagilimi.
// Yalniz match.phase === 'play' iken ornekler (baslama vurusu beklemesi sayilmaz).
// Kullanim: scripts/run-browser.sh node scripts/loco-speeds.mjs <cikti.json> [saniye=90]
import fs from 'node:fs'
import { BASE, launch, waitReady } from './qa-lib.mjs'
const out = process.argv[2] || '/tmp/asci/loco/speeds.json'
const SEC = Number(process.argv[3] || 90)
const { b, p, logs } = await launch({ w: 960, h: 540 })
await p.goto(`${BASE}?mode=mac&dev=1&watch=1&half=3`)
console.log('hazir ms', await waitReady(p))
await p.evaluate(() => {
  const g = window.__game
  const S = (window.__ls = { n: 0, skip: 0, rows: [] })
  setInterval(() => {
    if (g.match.phase !== 'play') {
      S.skip++
      return
    }
    for (const q of g.players) {
      if (q.role === 'kaleci' || q.sentOff) continue
      S.rows.push([+Math.hypot(q.vx, q.vz).toFixed(2), q.anim, q.hasBall ? 1 : 0])
    }
    S.n++
  }, 100)
})
await p.waitForTimeout(SEC * 1000)
const r = await p.evaluate(() => window.__ls)
const bins = [0, 0.35, 1, 2, 3, 4, 5, 6, 7, 8.5, 99]
const H = {}
for (const [s, a, hb] of r.rows) {
  const k = (hb ? 'TOP:' : '') + a
  H[k] ??= new Array(bins.length - 1).fill(0)
  H[k][bins.findIndex((v, j) => s >= v && s < bins[j + 1])]++
}
const tot = r.rows.length
const res = { sec: SEC, samples: r.n, skipped: r.skip, rows: tot, bins: bins.slice(0, -1), H, logs: logs.slice(0, 5) }
fs.writeFileSync(out, JSON.stringify(res))
console.log('ornek', r.n, 'atlanan(play degil)', r.skip, 'satir', tot)
for (const [k, v] of Object.entries(H).sort((a, b) => b[1].reduce((s, x) => s + x) - a[1].reduce((s, x) => s + x)))
  console.log(k.padEnd(18), v.map((x) => String(x).padStart(5)).join(' '), ' toplam %', ((100 * v.reduce((s, x) => s + x)) / tot).toFixed(1))
console.log('bantlar', bins.slice(0, -1).join(' '))
await b.close()
