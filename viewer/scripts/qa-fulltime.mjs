// O2 (QA): maç sonu ekrani: fulltime'dan 12 s sonra ne gorunuyor? Kullanim: run-browser.sh node scripts/qa-fulltime.mjs <klasor>
import fs from 'node:fs'
import { BASE, launch, waitReady, save } from './qa-lib.mjs'
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch({ w: 1280, h: 720 })
await p.goto(BASE + '?mode=mac&half=0.2&watch=1')
await waitReady(p)
const ph = () => p.evaluate(() => window.__game.match.phase)
const t0 = Date.now()
while ((await ph()) !== 'fulltime' && Date.now() - t0 < 200000) await p.waitForTimeout(500)
console.log('fulltime', (Date.now() - t0) / 1000)
for (const s of [1, 6, 14]) {
  await p.waitForTimeout(s === 1 ? 1000 : s === 6 ? 5000 : 8000)
  await p.screenshot({ path: out + `/ft-${s}.png` })
}
const info = await p.evaluate(() => ({ ph: window.__game.match.phase, btns: [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).filter(Boolean), txt: document.body.innerText.slice(0, 400) }))
console.log(JSON.stringify(info))
save(out + '/ft.json', { info, logs })
await b.close()
