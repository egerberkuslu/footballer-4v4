// Bassiz ekran goruntusu: her ajan kendi tarayicisini acar, paylasilan sekme yok.
// Kullanim: node scripts/shot.mjs <cikti.png> [--q "blades=30000&cam=2"] [--wait 3000] [--eval "js kodu"] [--after 2000]
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const out = args[0]
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const q = opt('--q', '')
const wait = Number(opt('--wait', '3000'))
const code = opt('--eval', '')
const after = Number(opt('--after', '1500'))
const port = opt('--port', '5173')

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await page.goto(`http://127.0.0.1:${port}/${q ? '?' + q : ''}`, { timeout: 180000 })
await page.waitForTimeout(wait)
if (code) {
  const r = await page.evaluate(code)
  if (r !== undefined) console.log('eval:', JSON.stringify(r))
  await page.waitForTimeout(after)
}
await page.screenshot({ path: out, timeout: 180000 })
console.log(logs.join('\n') || 'console: temiz')
await browser.close()
