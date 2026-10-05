// Yavas ag: futbolcu.glb gecikmeli; yukleme ekrani kaybolmamali, OYNA yalniz hazir olunca.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const delay = Number(process.argv[2] || 20000)
const srv = spawn('npx', ['vite', 'preview', '--port', '5188', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 4000))
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.route('**/futbolcu.glb', async (route) => { await new Promise((r) => setTimeout(r, delay)); await route.continue() })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5188/?boot=1&menu=1', { waitUntil: 'domcontentloaded' })
const rows = []
for (let t = 0; t <= delay / 1000 + 14; t += 2) {
  const s = await p.evaluate(() => {
    const boot = document.querySelector('.boot, .boot-root, [class*="boot"]')
    const txt = (boot?.innerText || '').replace(/\s+/g, ' ').slice(0, 80)
    const pct = (txt.match(/(\d+)\s*%/) || [])[1]
    const play = [...document.querySelectorAll('button')].some((x) => /oyna/i.test(x.textContent || ''))
    const menu = !!document.querySelector('.mm-root')
    return { boot: !!boot, pct, play, menu, vis: boot ? getComputedStyle(boot).display + '/' + getComputedStyle(boot).opacity : '-' }
  })
  rows.push(`t=${t}s ${JSON.stringify(s)}`)
  await p.waitForTimeout(2000)
}
console.log(rows.join('\n'))
console.log('hata:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'yok')
await b.close(); srv.kill('SIGTERM')
