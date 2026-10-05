// M2: acilistan "Oyna"ya, menuye ve mod gecislerine kadar OLCULMUS sureler (gercek GPU ya da --ff).
// Kullanim: scripts/run-browser.sh node scripts/ui-flow.mjs <onek> [--gpu|--ff] [--q "..."] [--warm 0]
import { chromium, firefox } from 'playwright'

const args = process.argv.slice(2)
const pre = args[0]
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const q = opt('--q', '')
const warm = opt('--warm', '1')
const b = args.includes('--ff')
  ? await firefox.launch()
  : args.includes('--gpu')
    ? await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
    : await chromium.launch({
        executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
      })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/Clock|vite/.test(m.text()) && logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`))
p.on('response', (r) => r.status() >= 400 && logs.push('[HTTP ' + r.status() + '] ' + r.url()))
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message))
await p.addInitScript(() => {
  window.__gaps = []
  let last = 0
  const f = (t) => {
    if (last && t - last > 80) window.__gaps.push([Math.round(last), Math.round(t - last)])
    last = t
    requestAnimationFrame(f)
  }
  requestAnimationFrame(f)
})
const url = `${opt('--base', 'http://127.0.0.1:5173/')}?boot=1&warm=${warm}${q ? '&' + q : ''}`
const T0 = Date.now()
await p.goto(url, { timeout: 180000 })
const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's'
while (!(await p.evaluate(() => window.__boot?.phase === 'ready').catch(() => false)) && Date.now() - T0 < 200000) await p.waitForTimeout(250)
console.log('hazir', t(), 'loadMs', await p.evaluate(() => window.__boot.stats.loadMs))
await p.screenshot({ path: `${pre}-hazir.png` })
const gapsOf = (since) => p.evaluate((s) => window.__gaps.filter((g) => g[0] >= s).sort((a, b) => b[1] - a[1]).slice(0, 4), since)
console.log('acilis kareleri (>80ms)', JSON.stringify(await gapsOf(0)))
const tPlay = await p.evaluate(() => performance.now())
await p.click('.boot-play')
await p.waitForTimeout(1500)
await p.screenshot({ path: `${pre}-menu.png` })
console.log('Oyna sonrasi', JSON.stringify(await gapsOf(tPlay)), 'stats', JSON.stringify(await p.evaluate(() => window.__boot.stats)))
// Kol Ayarlari (menuden)
await p.click('text=Kol Ayarları', { timeout: 30000 }).catch((e) => console.log('kol ayarlari dugmesi yok', e.message.split('\n')[0]))
await p.waitForSelector('.gps-card', { state: 'attached', timeout: 60000 }).catch(() => console.log('kol ayarlari acilmadi'))
await p.waitForTimeout(800)
await p.screenshot({ path: `${pre}-kol.png` })
console.log('kol ayarlari acik:', await p.locator('.gps-card').count())
await p.keyboard.press('Escape')
await p.waitForTimeout(500)
console.log('Esc sonrasi:', await p.locator('.gps-card').count())
// tek oyunculu mac
async function curtainRun(label, action) {
  await p.evaluate(() => {
    window.__ct = { on: 0, off: 0 }
    const poll = () => {
      if (window.__boot.curtain && !window.__ct.on) window.__ct.on = performance.now()
      if (window.__ct.on && !window.__boot.curtain && !window.__ct.off) { window.__ct.off = performance.now(); return }
      requestAnimationFrame(poll)
    }
    poll()
  })
  const t1 = await p.evaluate(() => performance.now())
  await action()
  await p.waitForTimeout(600)
  await p.screenshot({ path: `${pre}-${label}-perde.png` })
  await p.waitForFunction(() => window.__ct.off, null, { timeout: 30000 }).catch(() => console.log(label, 'perde kalkmadi'))
  const ct = await p.evaluate(() => window.__ct)
  await p.waitForTimeout(2500)
  await p.screenshot({ path: `${pre}-${label}-sonra.png` })
  console.log(label, 'perde ms', Math.round(ct.off - ct.on), 'kareler', JSON.stringify(await gapsOf(t1)))
}
await curtainRun('mac', () => p.click('text=Tek oyunculu maç'))
await curtainRun('antr', () => p.keyboard.press('m'))
await curtainRun('mac2', () => p.keyboard.press('m'))
console.log(logs.slice(0, 15).join('\n') || 'console: temiz')
await b.close()
