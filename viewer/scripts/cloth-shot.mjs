// Kumas (N) bassiz goruntu: scripts/run-browser.sh node scripts/cloth-shot.mjs <cikti.png> [--q "t=loco&v=5"] [--wait ms] [--page /src/cloth/test/index.html] [--shots "t1,t2"]
// --shots: ilk goruntuden sonra ek sureler (ms) -> cikti_1.png, cikti_2.png ...
import { chromium } from 'playwright'
const args = process.argv.slice(2)
const out = args[0]
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const q = opt('--q', '')
const wait = Number(opt('--wait', '8000'))
const page0 = opt('--page', '/src/cloth/test/index.html')
const extra = (opt('--shots', '') || '').split(',').filter(Boolean).map(Number)
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: process.env.GPU ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-webgl-developer-extensions'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: Number(opt('--w', '900')), height: Number(opt('--h', '700')) } })
const logs = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`) })
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await page.goto(`http://127.0.0.1:5173${page0}${q ? '?' + q : ''}`, { timeout: 180000 })
await page.waitForTimeout(wait)
const probe = () => page.evaluate(() => { const c = window.__cloth; const s = window.__r3f; return c ? { probe: c.probe(s.gl), stats: c.stats, t: window.__time } : 'kumas yok' })
const ev = opt('--eval', '')
if (ev) console.log('eval:', JSON.stringify(await page.evaluate(ev)))
console.log(JSON.stringify(await probe()))
await page.screenshot({ path: out, timeout: 180000 })
let k = 1
for (const t of extra) {
  await page.waitForTimeout(t)
  console.log(JSON.stringify(await probe()))
  await page.screenshot({ path: out.replace(/\.png$/, `_${k++}.png`), timeout: 180000 })
}
console.log(logs.slice(0, 20).join('\n') || 'console: temiz')
await browser.close()
