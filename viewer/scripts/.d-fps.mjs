import { chromium } from 'playwright'
const q = process.argv[2] || ''
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist','--enable-gpu','--disable-frame-rate-limit','--disable-gpu-vsync'] })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://127.0.0.1:5173/?' + q)
await p.waitForTimeout(16000)
for (const cam of ["Tribün", "Şutçu arkası", "Yayın"]) {
  await p.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n)?.click(), cam)
  await p.waitForTimeout(2000)
  const fps = await p.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)) }; requestAnimationFrame(f) }))
  console.log(q || 'default', cam, fps.toFixed(1), 'fps', 'dpr', await p.evaluate(() => devicePixelRatio))
}
await b.close()
