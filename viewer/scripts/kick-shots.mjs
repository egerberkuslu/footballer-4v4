// Sut klibi gorsel testi: karakter test sayfasi, profil, farkli animT'lerde sut; clips=1/0
// Kullanim: scripts/run-browser.sh node scripts/kick-shots.mjs <cikti-oneki> [at-listesi]
import { chromium } from 'playwright'
const pre = process.argv[2] || '/tmp/kick'
const at = process.argv[3] || '0.04,0.14,0.22,0.28,0.34,0.45,0.6,0.7'
const kv = process.argv[4] ?? ''
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (const clips of ['1', '0']) {
  const p = await b.newPage({ viewport: { width: 1700, height: 520 }, deviceScaleFactor: 2 })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  if (kv !== '') await p.addInitScript((v) => { window.__kickVar = Number(v) }, kv)
  await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=pose&anims=kick&at=${at}&face=1.5708&cam=front&dist=15&h=1.1&ly=0.9&fx=4&clips=${clips}`, { timeout: 180000 })
  await p.waitForTimeout(9000)
  await p.screenshot({ path: `${pre}_c${clips}.png` })
  console.log('clips=' + clips, 'hata:', errs.length ? errs.slice(0, 3) : 'yok')
  await p.close()
}
await b.close()
