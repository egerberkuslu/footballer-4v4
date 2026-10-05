// O (QA): gercek GPU performansi; mac (AI-AI, bot yuku yok) ve antrenman, 3 kamera.
// Kullanim: scripts/run-browser.sh node scripts/qa-perf.mjs <cikti-klasoru> [--sec 15]
import fs from 'node:fs'
import os from 'node:os'
import { BASE, devPanel, frameStats, installRecorder, launch, save, waitReady } from './qa-lib.mjs'

const args = process.argv.slice(2)
const out = args[0]
const SEC = Number(args[args.indexOf('--sec') + 1] || 15) || 15
fs.mkdirSync(out, { recursive: true })
const res = { load0: os.loadavg(), runs: [] }

for (const [name, q, cams] of [
  ['mac', 'mode=mac&watch=1&dev=1', ['(takip-yayin)', 'Tribün', 'Kale arkası']],
  ['antrenman', 'dev=1', ['Şutçu arkası', 'Tribün', 'Kale arkası']],
]) {
  const { b, p, logs } = await launch()
  // olcumde carpisma kutulari kapali (gercek oyuncu gorunumu)
  await p.addInitScript(() => localStorage.setItem('devFlags', JSON.stringify({ on: true, hitboxes: false, nodes: false, triggers: false, statics: false })))
  const t0 = Date.now()
  await p.goto(BASE + '?' + q)
  const ready = await waitReady(p)
  await installRecorder(p)
  // ilk 10 s: acilis takilmalari
  await p.waitForTimeout(10000)
  const boot = await frameStats(p, 100000)
  const bootLong = await p.evaluate(() => window.__qa?.long.slice() ?? [{ reload: true }])
  const run = { name, ready, boot, bootLong, cams: [], logs }
  for (const cam of cams) {
    if (!cam.startsWith('(')) await p.evaluate((n) => [...document.querySelectorAll('.hud button')].find((x) => x.textContent.trim() === n)?.click(), cam)
    await p.waitForTimeout(2000)
    await installRecorder(p)
    const n0 = await p.evaluate(() => window.__qa.frames.length)
    const l0 = await p.evaluate(() => window.__qa.long.length)
    await p.waitForTimeout(SEC * 1000)
    const st = await frameStats(p, 100000)
    await installRecorder(p)
    const fr = await p.evaluate(([n0, l0]) => {
      if (window.__qa.frames.length < n0) return { reload: true }
      const a = window.__qa.frames.slice(n0)
      const avg = a.reduce((s, v) => s + v, 0) / a.length
      const s = a.slice().sort((x, y) => y - x)
      return { n: a.length, fps: +(1000 / avg).toFixed(1), avgMs: +avg.toFixed(2), p1Ms: +s[Math.floor(a.length / 100)].toFixed(1), maxMs: +s[0].toFixed(1), over33: a.filter((v) => v > 33).length, over50: a.filter((v) => v > 50).length, long: window.__qa.long.slice(l0) }
    }, [n0, l0])
    const dev = await devPanel(p)
    run.cams.push({ cam, ...fr, calls: st?.calls, tris: st?.tris, dev, load: os.loadavg()[0] })
    console.log(name, cam, JSON.stringify({ fps: fr.fps, p1: fr.p1Ms, max: fr.maxMs, o50: fr.over50, reload: fr.reload, calls: st?.calls, tris: st?.tris, load: os.loadavg()[0].toFixed(1) }))
    await p.screenshot({ path: `${out}/${name}-${cam.replace(/[\s()]/g, '_')}.png` })
  }
  res.runs.push(run)
  await b.close()
}
res.load1 = os.loadavg()
save(`${out}/perf.json`, res)
