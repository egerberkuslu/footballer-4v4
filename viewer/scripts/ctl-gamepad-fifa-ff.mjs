// F: FIFA duzeni oyun ici (sahte DS4, gercek GPU Chrome): kickoff'ta x pas, R1+o falsolu sut (otomatik falso spin), topsuz L2/kare.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const errs = []
async function fresh() {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
  p.on('pageerror', (e) => errs.push(e.message))
  await p.addInitScript(() => {
    window.__pad = { id: '054c-09cc-Sony Interactive Entertainment Wireless Controller', mapping: '', connected: true, axes: [0, 0, -1, 0, 0, -1], buttons: Array.from({ length: 14 }, () => ({ pressed: false, value: 0 })) }
    navigator.getGamepads = () => [window.__pad]
  })
  await p.goto('http://127.0.0.1:5173/?mode=mac&blades=8000', { timeout: 120000 })
  await p.waitForTimeout(8000)
  await p.evaluate(() => { window.__ev = []; window.__game.on((e) => window.__ev.push(e.type + (e.kind ? ':' + e.kind : ''))) })
  return p
}
const press = (p, idx, ms) => p.evaluate(([i, d]) => new Promise((r) => { window.__pad.buttons[i] = { pressed: true, value: 1 }; setTimeout(() => { window.__pad.buttons[i] = { pressed: false, value: 0 }; r() }, d) }), [idx, ms])
const out = {}
let p = await fresh()
await press(p, 0, 120) // x tap
await p.waitForTimeout(1500)
out.xPas = await p.evaluate(() => window.__ev.filter((e) => e === 'touch:pass').length)
await p.close()
p = await fresh()
await p.evaluate(() => { window.__pad.buttons[5] = { pressed: true, value: 1 } }) // R1 basili
await press(p, 1, 600) // o basili 0.6 s
await p.waitForTimeout(150)
await p.evaluate(() => { window.__pad.buttons[5] = { pressed: false, value: 0 } })
const wmax = () => p.evaluate(() => new Promise((r) => { let m = 0; const t0 = performance.now(); const f = () => { const b = window.__world.ball; m = Math.max(m, Math.hypot(b.wx, b.wy, b.wz)); performance.now() - t0 < 900 ? requestAnimationFrame(f) : r(+m.toFixed(1)) }; requestAnimationFrame(f) }))
{ const w = await wmax(); out.finesseSut = { shoot: await p.evaluate(() => window.__ev.filter((e) => e === 'touch:shoot').length), maxWy: w } }
await p.close()
p = await fresh()
await press(p, 1, 600) // R1 yok: normal sut
{ const w = await wmax(); out.normalSut = { shoot: await p.evaluate(() => window.__ev.filter((e) => e === 'touch:shoot').length), maxWy: w } }
await p.close()
console.log(JSON.stringify(out))
console.log(errs.join('\n') || 'pageerror yok')
await b.close()
