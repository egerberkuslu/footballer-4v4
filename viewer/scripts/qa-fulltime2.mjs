// O2 (QA): maç sonu Enter (yeniden oyna) ve Esc (ana menu). Kullanim: run-browser.sh node scripts/qa-fulltime2.mjs <klasor>
import fs from 'node:fs'
import { BASE, launch, waitReady } from './qa-lib.mjs'
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
for (const key of ['Enter', 'Escape']) {
  const { b, p } = await launch({ w: 1280, h: 720 })
  await p.goto(BASE + '?mode=mac&half=0.2&watch=1')
  await waitReady(p)
  const t0 = Date.now()
  while ((await p.evaluate(() => window.__game.match.phase)) !== 'fulltime' && Date.now() - t0 < 120000) await p.waitForTimeout(500)
  await p.waitForTimeout(4000)
  await p.screenshot({ path: `${out}/ft-${key}-once.png` })
  const txt = await p.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.textContent.trim()).filter(Boolean).slice(-6))
  await p.keyboard.press(key)
  await p.waitForTimeout(3500)
  const st = await p.evaluate(() => ({ ph: window.__game.match.phase, score: window.__game.match.score, clock: Math.round(window.__game.match.clock), half: window.__game.match.half, menu: !!document.querySelector('.mp-overlay') }))
  await p.screenshot({ path: `${out}/ft-${key}-sonra.png` })
  console.log(key, JSON.stringify({ btns: txt, ...st }))
  await b.close()
}
