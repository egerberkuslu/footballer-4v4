// O2 (QA): yukleme ekrani -> Oyna -> ana menu -> mac akisi. Kullanim: run-browser.sh node scripts/qa-boot.mjs <klasor>
import fs from 'node:fs'
import { BASE, launch, save } from './qa-lib.mjs'
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch({ w: 1280, h: 720 })
const t0 = Date.now()
const q = process.argv[3] || 'boot=1'
await p.goto(BASE + '?' + q)
const rows = []
let played = null
for (let i = 0; i < 24; i++) {
  await p.waitForTimeout(i < 6 ? 500 : 2500)
  const oy = p.getByRole('button', { name: /^Oyna/ })
  if (!played && (await oy.count())) { played = (Date.now() - t0) / 1000; await oy.first().click() }
  const txt = await p.evaluate(() => ({ btns: [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).filter(Boolean).slice(0, 12), h: document.body.innerText.slice(0, 160).replace(/\n+/g, ' | '), frame: window.__r3f?.gl.info.render.frame }))
  rows.push({ t: (Date.now() - t0) / 1000, ...txt })
  await p.screenshot({ path: `${out}/boot-${String(i).padStart(2, '0')}.png` })
}
save(out + '/boot.json', { rows, logs, played })
console.log('Oyna tiklandi', played)
console.log(rows.map((r) => `${r.t.toFixed(1)}s f=${r.frame} btns=${r.btns.join(',')} | ${r.h}`).join('\n'))
console.log(JSON.stringify(logs))
await b.close()
