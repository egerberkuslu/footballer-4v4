// Klip katmani gorsel testi: karakter test sayfasi, +x'e kosu, yan kamera; clips=1 ve clips=0 karsilastirma kareleri.
// Kullanim: scripts/run-browser.sh node scripts/clip-run-shots.mjs <cikti-oneki> [hiz] [anim]
import { chromium } from 'playwright'
const pre = process.argv[2] || '/tmp/clip'
const v = process.argv[3] || '6'
const anim = process.argv[4] || 'sprint'
const ball = process.argv[5] || '0'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (const clips of ['1', '0']) {
  const p = await b.newPage({ viewport: { width: 900, height: 520 } })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=loco&v=${v}&anims=${anim}&dist=5&h=1.0&fx=4&clips=${clips}&ball=${ball}`, { timeout: 180000 })
  await p.waitForTimeout(7000)
  for (let i = 0; i < 4; i++) {
    await p.screenshot({ path: `${pre}_c${clips}_${i}.png` })
    await p.waitForTimeout(90)
  }
  console.log('clips=' + clips, 'hata:', errs.length ? errs.slice(0, 3) : 'yok')
  await p.close()
}
await b.close()
