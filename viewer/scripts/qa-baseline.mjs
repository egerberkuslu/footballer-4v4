// O (QA): kontrol olcumu. Bos sayfada rAF kare suresi: makine yukunun (diger ajanlar) payini ayirmak icin.
import os from 'node:os'
import { launch } from './qa-lib.mjs'
const { b, p } = await launch()
await p.setContent('<canvas id=c width=1920 height=1080></canvas><script>const g=document.getElementById("c").getContext("webgl2");function f(){g.clearColor(Math.random(),0,0,1);g.clear(g.COLOR_BUFFER_BIT);requestAnimationFrame(f)}f()</script>')
const r = await p.evaluate(() => new Promise((res) => { const a = []; let prev = performance.now(); const t0 = prev; const f = () => { const t = performance.now(); a.push(t - prev); prev = t; if (t - t0 < 15000) requestAnimationFrame(f); else { const s = a.slice().sort((x, y) => y - x); res({ n: a.length, fps: +(1000 * a.length / (t - t0)).toFixed(1), p1: +s[Math.floor(a.length / 100)].toFixed(1), max: +s[0].toFixed(1), o50: a.filter((v) => v > 50).length }) } }; requestAnimationFrame(f) }))
console.log('bos sayfa', JSON.stringify(r), 'load', os.loadavg()[0].toFixed(1))
await b.close()
