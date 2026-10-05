// Ana menude (3B sahne acik) gercek GPU fps ve kare suresi.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const srv = spawn('npx', ['vite', 'preview', '--port', '5189', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 4000))
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5189/?boot=1&menu=1', { waitUntil: 'load' })
for (let i = 0; i < 300; i++) {
  if (await p.evaluate(() => [...document.querySelectorAll('button')].some((x) => /^\s*oyna/i.test(x.textContent || '')))) break
  await p.waitForTimeout(250)
}
await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^\s*oyna/i.test(x.textContent || ''))?.click())
await p.waitForTimeout(4000)
const m = await p.evaluate(() => new Promise((res) => {
  const t = []; let last = performance.now(); const end = last + 6000
  const f = (n) => { t.push(n - last); last = n; n < end ? requestAnimationFrame(f) : res(t) }
  requestAnimationFrame(f)
}))
m.sort((a, b) => a - b)
const avg = m.reduce((a, b) => a + b, 0) / m.length
console.log('menu: fps', (1000 / avg).toFixed(1), '| p99 ms', m[Math.floor(m.length * 0.99)].toFixed(1), '| max ms', m[m.length - 1].toFixed(1), '| canvas:', await p.evaluate(() => document.querySelectorAll('canvas').length))
console.log('hata:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'yok')
await b.close(); srv.kill('SIGTERM')
