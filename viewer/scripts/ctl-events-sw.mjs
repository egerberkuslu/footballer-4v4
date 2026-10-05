// F: antrenman olay yazilari (SwiftShader, elle adim): gol/direk/ust direk/aut -> ctl.msg
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 480, height: 300 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/?blades=1000', { timeout: 180000 })
await p.waitForTimeout(5000)
const r = await p.evaluate(() => {
  const S = window.__shot, { world, ctl } = S
  const out = []
  for (const [ty, tz, name] of [[1.0, 2.5, 'direk'], [2.0, 0.5, 'ust-direk'], [1.0, -3.6, 'aut'], [0.8, -1.2, 'gol']]) {
    world.timeScale = 0
    ctl.msg = ''
    S.testKick(ty, tz, 26)
    const msgs = new Set()
    for (let i = 0; i < 120; i++) { world.timeScale = 1; world.step(1 / 60); world.timeScale = 0; if (ctl.msg) msgs.add(ctl.msg) }
    out.push(name + ' -> ' + [...msgs].join(','))
  }
  world.timeScale = 1
  return out
})
console.log(r.join('\n'))
console.log(errs.join('\n') || 'pageerror yok')
await b.close()
