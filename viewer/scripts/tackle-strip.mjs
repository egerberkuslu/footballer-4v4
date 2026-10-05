// Mudahale katmani: tek sayfada 9 oyuncu, her biri farkli animT (soldan saga zaman) - profil serit goruntusu.
// Kullanim: scripts/run-browser.sh node scripts/tackle-strip.mjs <png> <anim> <at-listesi> [klip|-] [clips=1|0] [cam=front] [getup=0|1]
import { chromium } from 'playwright'
const [out, anim, ats, v = '-', clips = '1', cam = 'front', gu = '0', dist = '15', h = '1.0'] = process.argv.slice(2)
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: Number(process.env.W || 1800), height: Number(process.env.H || 520) } })
await p.addInitScript(([v, gu]) => { if (v !== '-') window.__tackleVar = v; if (gu === '1') window.__tackleGetup = true }, [v, gu])
await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=pose&anims=${anim}&at=${ats}&face=1.5708&cam=${cam}&dist=${dist}&h=${h}&ly=0.6&fx=4&clips=${clips}`, { timeout: 180000 })
await p.waitForTimeout(6000)
const st = await p.evaluate(() => window.__layers?.tackle)
await p.screenshot({ path: out, timeout: 90000 })
console.log('durum', JSON.stringify(st))
await b.close()
