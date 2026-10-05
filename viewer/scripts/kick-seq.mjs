// Tek karakter, buyuk profil, sut karelerini sirayla (her kare icin yeni sayfa). clips=1 ve 0.
// Kullanim: scripts/run-browser.sh node scripts/kick-seq.mjs <onek> <varyant> [at-listesi]
import { chromium } from 'playwright'
const pre = process.argv[2] || '/tmp/ks'
const kv = process.argv[3] ?? '1'
const ats = (process.argv[4] || '0.06,0.14,0.20,0.25,0.28,0.31,0.36,0.44,0.56').split(',')
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (const clips of ['1', '0']) {
  for (let i = 0; i < ats.length; i++) {
    const p = await b.newPage({ viewport: { width: 560, height: 560 } })
    await p.addInitScript((v) => { window.__kickVar = Number(v) }, kv)
    await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=pose&anims=kick&at=${ats[i]}&face=1.5708&cam=front&dist=3.4&h=1.0&ly=0.85&fx=4&clips=${clips}`, { timeout: 180000 })
    await p.waitForTimeout(4500)
    await p.screenshot({ path: `${pre}_c${clips}_${i}.png` })
    await p.close()
  }
}
console.log('bitti', ats.length)
await b.close()
