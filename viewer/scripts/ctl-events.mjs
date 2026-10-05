// F: olay testi (gercek GPU): direk, ust direk, aut, gol; her biri icin gosterilen yazi
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist','--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/')
await p.waitForTimeout(6000)
const cases = [[1.0, 2.5, 26, 'direk'], [2.0, 0.5, 26, 'ust-direk'], [1.0, -3.6, 26, 'aut'], [2.6, 0, 26, 'aut (ust)'], [0.8, -1.2, 28, 'gol'], [1.0, -2.5, 24, 'direk sol']]
for (const [ty, tz, V, name] of cases) {
  const r = await p.evaluate(async ([ty, tz, V]) => {
    const s = window.__shot
    s.ctl.msg = ''
    s.testKick(ty, tz, V)
    const t0 = performance.now()
    const msgs = new Set()
    while (performance.now() - t0 < 2500) { if (s.ctl.msg) msgs.add(s.ctl.msg); await new Promise(r => setTimeout(r, 16)) }
    return [...msgs]
  }, [ty, tz, V])
  console.log(name.padEnd(10), JSON.stringify(r))
}
console.log(errs.join('\n') || 'pageerror yok')
await b.close()
