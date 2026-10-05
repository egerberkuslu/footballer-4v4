// Kaleci ajani: tek karakter test sahnesi, kaleci aksiyonu kare kare (clips=1 katman, clips=0 parametrik).
// Kullanim: scripts/run-browser.sh node scripts/keeper-seq.mjs <onek> <anim> <at-listesi> [face=1.5708] [cam=front] [clips=1,0]
// Not: test sahnesinde dalis simulasyonu yok (el hedefi IK'si ve pelvis parabolu yok); poz klibin kendisidir.
import { chromium } from 'playwright'
const [pre = '/tmp/kseq', anim = 'keeper-throw', atArg = '0,0.2,0.35,0.5,0.7', face = '1.5708', cam = 'front', clipArg = '1,0'] = process.argv.slice(2)
const ats = atArg.split(',')
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (const clips of clipArg.split(',')) {
  for (let i = 0; i < ats.length; i++) {
    const p = await b.newPage({ viewport: { width: 420, height: 460 } })
    await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=pose&anims=${anim}&at=${ats[i]}&face=${face}&cam=${cam}&dist=3.6&h=0.9&ly=0.7&fx=4&clips=${clips}`, { timeout: 180000 })
    await p.waitForTimeout(4500)
    await p.screenshot({ path: `${pre}_c${clips}_${String(i).padStart(2, '0')}.png` })
    await p.close()
  }
}
console.log('bitti', anim, ats.length)
await b.close()
