// Gercek GPU ile kare dizisi: node gseq.mjs <onek> --path P --q Q --wait ms --eval js --frames n --gap ms --probe js --clip x,y,w,h
import { chromium } from '/home/ege/Blender-MCP/footballer/viewer/node_modules/playwright/index.mjs'
const a = process.argv.slice(2)
const pre = a[0]
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d }
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
p.on('pageerror', (e) => logs.push('pageerror ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)) })
await p.goto(`http://127.0.0.1:5173/${opt('--path', '')}${opt('--q', '') ? '?' + opt('--q', '') : ''}`)
await p.waitForTimeout(Number(opt('--wait', '10000')))
import { readFileSync } from 'fs'
const ef = opt('--evalfile', '')
const ev = ef ? readFileSync(ef, 'utf8') : opt('--eval', '')
if (ev) console.log('eval', JSON.stringify(await p.evaluate(ev)))
const N = Number(opt('--frames', '1')), gap = Number(opt('--gap', '100')), probe = opt('--probe', '')
const cl = opt('--clip', '')
const clip = cl ? (([x, y, width, height]) => ({ x, y, width, height }))(cl.split(',').map(Number)) : undefined
for (let i = 0; i < N; i++) {
  const t = Date.now()
  await p.screenshot({ path: `${pre}-${i}.png`, clip })
  if (probe) console.log(i, JSON.stringify(await p.evaluate(probe)))
  const w = gap - (Date.now() - t)
  if (w > 0) await p.waitForTimeout(w)
}
const fps = await p.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { if (++n < 120) requestAnimationFrame(f); else r(120000 / (performance.now() - t0)) }; requestAnimationFrame(f) }))
console.log('fps', fps.toFixed(1))
console.log(logs.join('\n') || 'hata yok')
await b.close()
