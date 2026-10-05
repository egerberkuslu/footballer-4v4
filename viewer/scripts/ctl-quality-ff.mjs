// F: QualityPrompt: kisitli CPU'da cikiyor mu, 'Kalsin' kaydediliyor mu, normalde cikmiyor mu. Chromium + CDP CPU kisitlama.
import { chromium } from 'playwright'
const exe = '/opt/google/chrome/chrome' // gercek GPU (SwiftShader fps'i anlamsiz)
async function run(throttle) {
  const b = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
  const c = await p.context().newCDPSession(p)
  if (throttle) await c.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  await p.goto('http://127.0.0.1:5173/?mode=mac&blades=8000', { timeout: 120000 })
  await p.waitForTimeout(throttle ? 40000 : 16000)
  const shown = await p.evaluate(() => /Akıcılık düşük/i.test(document.body.textContent))
  let stored = null
  if (shown) {
    await p.getByText('Kalsın').click()
    stored = await p.evaluate(() => sessionStorage.getItem('kalite-oneri-red'))
  }
  const hidden = await p.evaluate(() => !/Akıcılık düşük/i.test(document.body.textContent))
  const fps = await p.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(+(n / 2).toFixed(1)) }; requestAnimationFrame(f) }))
  await b.close()
  return { throttle, fps, shown, stored, hiddenAfterKalsin: hidden }
}
console.log(JSON.stringify(await run(0)))
console.log(JSON.stringify(await run(8)))
