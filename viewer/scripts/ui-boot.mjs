// M: yukleme ekrani asamalarinin goruntuleri + "Oyna"dan sonraki 20 s kare olcumu.
// Kullanim: scripts/run-browser.sh node scripts/ui-boot.mjs <onek> [--ff] [--page boot-test.html] [--q "mode=mac"] [--warm 0] [--measure 20000] [--var]
import { chromium, firefox } from 'playwright'

const args = process.argv.slice(2)
const pre = args[0]
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const FF = args.includes('--ff')
const page0 = opt('--page', '')
const q = opt('--q', 'mode=mac')
const warm = opt('--warm', '1')
const measure = Number(opt('--measure', '20000'))
const shotsEvery = Number(opt('--every', '2500'))

const b = FF
  ? await firefox.launch()
  : args.includes('--gpu')
    ? await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
    : await chromium.launch({
        executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
      })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`))
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message))
const url = `http://127.0.0.1:5173/${page0}?boot=1&warm=${warm}${q ? '&' + q : ''}`
console.log(url)
const T0 = Date.now()
await p.goto(url, { timeout: 180000 })
let n = 0
for (;;) {
  const st = await p.evaluate(() => ({ phase: window.__boot?.phase, pct: document.querySelector('.boot-now b')?.textContent, now: document.querySelector('.boot-now span')?.textContent })).catch(() => ({}))
  console.log(((Date.now() - T0) / 1000).toFixed(1) + 's', JSON.stringify(st))
  if (n < 6 && st.phase !== 'ready') await p.screenshot({ path: `${pre}-${n++}.png`, timeout: 120000 }).catch((e) => console.log('shot', e.message))
  if (args.includes('--first')) { await b.close(); process.exit(0) }
  if (st.phase === 'ready' || Date.now() - T0 > 240000) break
  await p.waitForTimeout(shotsEvery)
}
await p.screenshot({ path: `${pre}-hazir.png`, timeout: 120000 })
await p.click('.boot-play').catch((e) => console.log('click', e.message))
await p.waitForTimeout(1500)
await p.screenshot({ path: `${pre}-oyun.png`, timeout: 120000 })
if (args.includes('--var')) {
  await p.waitForTimeout(4000)
  await p.keyboard.press('x')
  await p.waitForTimeout(7000)
  await p.keyboard.press('Escape')
}
await p.waitForTimeout(Math.max(0, measure - 1500 - (args.includes('--var') ? 11000 : 0)))
const stats = await p.evaluate(() => window.__boot?.stats)
console.log('OLCUM', JSON.stringify(stats))
if (args.includes('--curtain')) {
  // gecis perdesi: modu perdeyle degistir, ortasinda goruntu al
  await p.evaluate(() => import('/src/ui/curtain.ts').then((m) => { window.__c = m.withCurtain(() => import('/src/control/actions.ts').then((a) => a.setMode('antrenman')), 'Antrenman hazırlanıyor') }))
  await p.waitForTimeout(400)
  await p.screenshot({ path: `${pre}-perde.png`, timeout: 120000 })
  await p.evaluate(() => window.__c)
  await p.waitForTimeout(800)
  await p.screenshot({ path: `${pre}-perde-sonra.png`, timeout: 120000 })
}
console.log(logs.slice(0, 20).join('\n') || 'console: temiz')
await b.close()
