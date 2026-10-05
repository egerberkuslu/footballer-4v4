// M2: takilan / hatali yukleme: "Yine de oyna" ve hata satiri testi.
// Kullanim: scripts/run-browser.sh node scripts/ui-stall.mjs <onek> [--gpu] [--delay 14000] [--abort kits]
import { chromium } from 'playwright'
import fs from 'node:fs'
const args = process.argv.slice(2)
const pre = args[0]
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const delay = Number(opt('--delay', '0'))
const abort = opt('--abort', '')
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
if (delay) await p.route('**/futbolcu.glb', async (r) => { await new Promise((x) => setTimeout(x, delay)); r.continue() })
if (abort) await p.route(`**/${abort}/**`, (r) => r.abort())
const T0 = Date.now()
await p.goto('http://127.0.0.1:5173/?boot=1&menu=1', { timeout: 120000 })
const t = () => ((Date.now() - T0) / 1000).toFixed(1)
let shot = 0
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(1000)
  const st = await p.evaluate(() => ({ phase: window.__boot.phase, anyway: !!document.querySelector('.boot-anyway'), err: [...document.querySelectorAll('.boot-err')].map((e) => e.textContent), pct: document.querySelector('.boot-now b')?.textContent })).catch(() => ({}))
  console.log(t() + 's', JSON.stringify(st))
  if (st.anyway && shot === 0) { shot = 1; await p.screenshot({ path: `${pre}-anyway.png` }); await p.click('.boot-anyway'); await p.waitForTimeout(1500); await p.screenshot({ path: `${pre}-sonra.png` }); console.log('yine de oyna ->', await p.evaluate(() => window.__boot.phase)); break }
  if (st.phase === 'ready') { await p.screenshot({ path: `${pre}-hazir.png` }); break }
}
await b.close()
