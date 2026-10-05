// Canli site: gercek GPU, 404 sayisi, Oyna, maca gecis, hata taramasi.
import { chromium } from 'playwright'
const URL = process.argv[2] || 'https://egerberkuslu.github.io/footballer-4v4-play/?boot=1&menu=1'
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
const bad = [], errs = []
p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().replace(/^https:\/\/[^/]+\/footballer-4v4-play\//, '/')) })
p.on('pageerror', (e) => errs.push(e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)) })
const t0 = Date.now()
await p.goto(URL, { waitUntil: 'load', timeout: 120000 })
let ready = null
for (let i = 0; i < 400; i++) {
  if (await p.evaluate(() => [...document.querySelectorAll('button')].some((x) => /oyna/i.test(x.textContent || '')))) { ready = Date.now() - t0; break }
  await p.waitForTimeout(250)
}
console.log('Oyna hazir (ms):', ready)
await p.screenshot({ path: 'shots/live-1-menu.png' })
await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /oyna/i.test(x.textContent || ''))?.click())
await p.waitForTimeout(3000)
await p.screenshot({ path: 'shots/live-2-after-play.png' })
const btn = await p.evaluate(() => [...document.querySelectorAll('button')].map((x) => (x.textContent || '').trim()).filter(Boolean).slice(0, 12))
console.log('butonlar:', JSON.stringify(btn))
await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /tek oyunculu/i.test(x.textContent || ''))?.click())
await p.waitForTimeout(9000)
await p.screenshot({ path: 'shots/live-3-match.png' })
const st = await p.evaluate(() => ({ phase: window.__game?.match?.phase, clock: window.__game?.match?.clock, fps: document.body.innerText.match(/(\d+)\s*fps/)?.[1] }))
console.log('durum:', JSON.stringify(st))
console.log('4xx/5xx:', bad.length ? JSON.stringify(bad.slice(0, 10)) : 'yok')
console.log('hatalar:', errs.length ? JSON.stringify(errs.slice(0, 6)) : 'yok')
await b.close()
