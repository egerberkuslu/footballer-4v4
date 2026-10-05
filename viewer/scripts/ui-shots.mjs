// M2: yukleme ekrani + ana menu karelerini alir (gercek GPU ya da --ff). Yuklemeyi uzatmak icin model istegi geciktirilir (yalniz test).
// Kullanim: scripts/run-browser.sh node scripts/ui-shots.mjs <onek> [--gpu|--ff] [--base URL] [--delay 6000]
import { chromium, firefox } from 'playwright'
const args = process.argv.slice(2)
const pre = args[0]
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const b = args.includes('--ff') ? await firefox.launch() : await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message))
p.on('response', (r) => r.status() >= 400 && logs.push('[HTTP ' + r.status() + '] ' + r.url()))
const delay = Number(opt('--delay', '6000'))
if (delay) await p.route('**/futbolcu.glb', async (r) => { await new Promise((x) => setTimeout(x, delay)); r.continue() })
await p.goto(`${opt('--base', 'http://127.0.0.1:5173/')}?boot=1&menu=1`, { timeout: 120000 })
const shot = (n) => p.screenshot({ path: `${pre}-${n}.png`, timeout: 120000 })
const pct = () => p.evaluate(() => document.querySelector('.bl-play')?.textContent ?? document.querySelector('.kl-pct b')?.textContent ?? '?')
await p.waitForTimeout(600); console.log('t0', await pct()); await shot('y0')
await p.waitForTimeout(delay / 2 + 800); console.log('orta', await pct()); await shot('y1')
await p.waitForFunction(() => window.__boot?.phase === 'ready', null, { timeout: 180000 })
await p.waitForTimeout(1500); console.log('hazir', await pct()); await shot('y2')
await p.click('.bl-play'); await p.waitForSelector('.mm-root', { timeout: 60000 }); await p.waitForTimeout(1200)
await shot('m0')
for (const [n, downs] of [['m1-sol', 3], ['m2-kontrol', 1], ['m3-ayar', 1], ['m4-hakkinda', 1]]) {
  for (let i = 0; i < downs; i++) await p.keyboard.press('ArrowDown')
  await p.waitForTimeout(500); await shot(n)
  if (n === 'm1-sol') { await p.keyboard.press('Enter'); await p.waitForSelector('.gps-card', { state: 'attached', timeout: 60000 }); await p.waitForTimeout(700); await shot('kol'); await p.keyboard.press('Escape'); await p.waitForTimeout(500); console.log('kol paneli kapandi:', await p.locator('.gps-card').count() === 0) }
}
console.log('sec:', await p.textContent('.mm-item.sel b'))
await p.keyboard.press('ArrowDown') // basa
await p.keyboard.press('ArrowDown') // 2. (Cok oyunculu)
await p.waitForTimeout(300)
await p.keyboard.press('Enter'); await p.waitForTimeout(800); await shot('mp')
console.log('mp sayfasi:', await p.locator('.mm-code').count())
await p.keyboard.press('Escape'); await p.waitForTimeout(600)
console.log('geri:', await p.locator('.mm-main .mm-item b').first().textContent())
console.log(logs.join('\n') || 'console/ag: temiz')
await b.close()
