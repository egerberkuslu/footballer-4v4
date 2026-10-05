// rabona ajani: tek karakter kare dizisi. Kullanim: scripts/run-browser.sh node scripts/rabona-seq.mjs <onek> <anim> <face> <cam> [at-listesi]
import { chromium } from 'playwright'
const pre = process.argv[2] || '/tmp/asci/rabona/r'
const anim = process.argv[3] || 'rabona'
const face = process.argv[4] || '0'
const cam = process.argv[5] || 'back'
const ats = (process.argv[6] || '0.06,0.12,0.18,0.22,0.27,0.33,0.42,0.55').split(',')
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (let i = 0; i < ats.length; i++) {
  const p = await b.newPage({ viewport: { width: 420, height: 520 } })
  await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=pose&anims=${anim}&at=${ats[i]}&face=${face}&cam=${cam}&dist=3.6&h=1.1&ly=0.7&fx=4`, { timeout: 180000 })
  await p.waitForTimeout(4000)
  await p.screenshot({ path: `${pre}_${i}.png` })
  await p.close()
}
console.log('bitti', ats.length)
await b.close()
