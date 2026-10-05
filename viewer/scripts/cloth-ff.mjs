// Kumas (N) Firefox olcumu: scripts/run-browser.sh node scripts/cloth-ff.mjs ["q1" "q2" ...]
// her sorgu icin ana sayfayi acar, 12 sn isinir, 6 sn rAF kare suresi + kumas istatistigi olcer.
import { firefox } from 'playwright'
const qs = process.argv.slice(2)
if (!qs.length) qs.push('cloth=1', 'cloth=0')
const b = await firefox.launch()
for (const q of qs) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  await p.goto(`http://127.0.0.1:5173/?${q}`)
  await p.waitForTimeout(12000)
  const r = await p.evaluate(() => new Promise((res) => {
    const ts = []
    const t0 = performance.now()
    const f = (t) => { ts.push(t); if (t - t0 < 6000) requestAnimationFrame(f); else {
      const d = ts.slice(1).map((x, i) => x - ts[i]).sort((a, b) => a - b)
      const c = window.__cloth
      const gl = window.__r3f?.gl
      const dbg = gl?.getContext().getExtension('WEBGL_debug_renderer_info')
      res({ frames: d.length, medMs: d[d.length >> 1]?.toFixed(2), p95: d[Math.floor(d.length * 0.95)]?.toFixed(2), cloth: c ? { ...c.stats, probe: c.probe(gl) } : null, gpu: dbg ? gl.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?' })
    } }
    requestAnimationFrame(f)
  }))
  console.log(q, JSON.stringify(r), errs.slice(0, 5).join(' | '))
  await p.close()
}
await b.close()
