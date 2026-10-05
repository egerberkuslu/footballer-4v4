// Gercek GPU (--use-angle=gl): acilis suresi, uzun gorevler, kare bosluklari, mod gecisi.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', (e) => errs.push('pageerror ' + e.message))
await p.addInitScript(() => {
  window.__t0 = performance.now()
  window.__long = []
  window.__gaps = []
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]) }).observe({ entryTypes: ['longtask'] }) } catch {}
  let last = performance.now()
  const tick = () => { const n = performance.now(); if (n - last > 100) window.__gaps.push([Math.round(last), Math.round(n - last)]); last = n; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})
const t0 = Date.now()
await p.goto('http://127.0.0.1:5173/?boot=1&dev=1', { timeout: 120000 })
let playAt = null
for (let i = 0; i < 240; i++) {
  const has = await p.evaluate(() => [...document.querySelectorAll('button')].some((x) => /oyna/i.test(x.textContent || '')))
  if (has) { playAt = Date.now() - t0; break }
  await p.waitForTimeout(250)
}
const afterBoot = await p.evaluate(() => ({ long: window.__long.filter((x) => x[1] >= 50), gaps: window.__gaps }))
console.log('Oyna hazir (ms):', playAt)
console.log('acilis uzun gorev >=50ms:', JSON.stringify(afterBoot.long.slice(0, 15)), '| kare boslugu >100ms:', JSON.stringify(afterBoot.gaps.slice(0, 15)))
await p.evaluate(() => { window.__long.length = 0; window.__gaps.length = 0 })
await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /oyna/i.test(x.textContent || ''))?.click())
await p.waitForTimeout(4000)
await p.keyboard.press('KeyM') // maca gec
await p.waitForTimeout(8000)
const m = await p.evaluate(() => ({ long: window.__long.filter((x) => x[1] >= 50), gaps: window.__gaps, phase: window.__game?.match?.phase }))
console.log('maca gecis: faz', m.phase, '| uzun gorev:', JSON.stringify(m.long.slice(0, 12)), '| kare boslugu:', JSON.stringify(m.gaps.slice(0, 12)))
console.log(errs.join('\n') || 'pageerror yok')
await b.close()
