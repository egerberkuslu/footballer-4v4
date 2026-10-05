// O2 (QA): Menu dugmesi -> ana menu -> tek oyunculu mac. Kullanim: run-browser.sh node scripts/qa-menu.mjs <klasor>
import fs from 'node:fs'
import { BASE, launch, waitReady, save } from './qa-lib.mjs'
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch({ w: 1280, h: 720 })
await p.goto(BASE)
await waitReady(p)
p.setDefaultTimeout(8000)
await p.waitForTimeout(1500)
await p.screenshot({ path: out + '/menu-pre.png' })
await p.waitForTimeout(1200)
await p.screenshot({ path: out + '/menu-0.png' })
const btns = await p.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).filter(Boolean))
console.log(btns.join(' | '))
save(out + '/menu.json', { btns, logs })
await p.getByText('Tek oyunculu maç').first().click()
const t1 = Date.now()
const seen = []
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(250)
  const st = await p.evaluate(() => ({ ph: window.__game?.match?.phase, curtain: window.__boot?.curtain, mode: document.querySelector('.hud button.on, .hud .active')?.textContent }))
  seen.push({ ms: Date.now() - t1, ...st })
  if (i % 8 === 0) await p.screenshot({ path: out + `/mac-${String(i).padStart(2, '0')}.png` })
}
console.log(seen.filter((_, i) => i % 4 === 0).map((r) => `${r.ms} ${r.ph} curtain=${r.curtain}`).join('\n'))
await b.close()
