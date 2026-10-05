// M2: gecikmeli yuklemede ekran kendiliginden kayboluyor mu? Kullanim: ui-vanish.mjs <gecikme_ms> [--ff] [--base URL]
import { chromium, firefox } from 'playwright'
const args = process.argv.slice(2)
const delay = Number(args[0] ?? 8000)
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const b = args.includes('--ff') ? await firefox.launch() : await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const nav = []
p.on('framenavigated', (f) => f === p.mainFrame() && nav.push(Date.now()))
p.on('console', (m) => /vite|reload|HMR/i.test(m.text()) && console.log('  [c]', m.text().slice(0, 120)))
if (delay) await p.route('**/futbolcu.glb', async (r) => { await new Promise((x) => setTimeout(x, delay)); r.continue() })
const T = Date.now()
await p.goto(`${opt('--base', 'http://127.0.0.1:5173/')}?boot=1&menu=1`, { timeout: 120000 })
let lastPct = -1, mono = true, readyAt = -1, goneAt = -1, anywayAt = -1
for (let i = 0; i < 160; i++) {
  await p.waitForTimeout(500)
  const s = await p.evaluate(() => ({ ph: window.__boot?.phase, ov: !!document.querySelector('.boot:not(.leaving)'), play: !!document.querySelector('.kl-play'), anyway: !!document.querySelector('.boot-anyway'), pct: Number(document.querySelector('.kl-pct b')?.textContent ?? -1), t: performance.now() })).catch(() => null)
  if (!s) continue
  if (s.pct >= 0) { if (s.pct < lastPct) mono = false; lastPct = Math.max(lastPct, s.pct) }
  if (s.anyway && anywayAt < 0) anywayAt = (Date.now() - T) / 1000
  if (s.play && readyAt < 0) { readyAt = (Date.now() - T) / 1000; if (readyAt > 0) break }
  if (!s.ov && s.ph !== 'load' && s.ph !== 'warm' && readyAt < 0) { goneAt = (Date.now() - T) / 1000; console.log('EKRAN KAYBOLDU', JSON.stringify(s)); break }
}
console.log(JSON.stringify({ delay, ready_s: readyAt, gone_s: goneAt, anyway_s: anywayAt, monoton: mono, maxPct: lastPct, sayfaYenilenme: nav.length - 1 }))
await b.close()
