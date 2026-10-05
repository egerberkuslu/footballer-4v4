// Pas/ilk dokunus/kafa kare dizisi: TEK sayfa, 8 oyuncu ayni animin farkli anlarinda; kamera her kareye kaydirilir.
// Kullanim: scripts/run-browser.sh node scripts/pass-seq.mjs <onek> <anim> <at-listesi(<=8)> [clips=1] [cam=front] [face=1.5708]
// cikti: <onek>_<i>.png ve <onek>_strip.png (yan yana; python/PIL ile birlestirilir)
import { chromium } from 'playwright'
const pre = process.argv[2] || '/tmp/asci/pass/x'
const anim = process.argv[3] || 'pass'
const ats = (process.argv[4] || '0.05,0.12,0.18,0.22,0.27,0.34,0.42,0.52').split(',')
const clips = process.argv[5] ?? '1'
const cam = process.argv[6] ?? 'front'
const face = process.argv[7] ?? '1.5708'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 420, height: 520 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.addInitScript((c) => { if (c) window.__passClip = c }, process.env.PASSCLIP || '')
await p.addInitScript((e) => { for (const k of ['__passVar', '__passS', '__hdrVar', '__hdrBallY', '__trapVar', '__passTurn']) if (e[k] !== undefined) window[k] = Number(e[k]) }, { __passVar: process.env.PASSVAR, __passS: process.env.PASSS, __hdrVar: process.env.HDRVAR, __hdrBallY: process.env.HDRBALLY, __trapVar: process.env.TRAPVAR, __passTurn: process.env.PASSTURN })
await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=pose&anims=${anim}&at=${ats.join(',')}&face=${face}&cam=${cam}&dist=3.6&h=1.05&ly=0.85&fx=4&clips=${clips}`, { timeout: 180000 })
await p.waitForTimeout(6000)
await p.evaluate(() => {
  const c = window.__r3f.camera
  window.__ox = 0
  const ps = c.position.set.bind(c.position)
  c.position.set = (x, y, z) => ps(x + window.__ox, y, z)
  const la = c.lookAt.bind(c)
  c.lookAt = (x, y, z) => la(x + window.__ox, y, z)
})
for (let i = 0; i < ats.length; i++) {
  await p.evaluate((o) => { window.__ox = o }, (i - 4) * 1.7)
  await p.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 4 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) }))
  await p.waitForTimeout(300)
  await p.screenshot({ path: `${pre}_${i}.png`, timeout: 120000 })
}
const lay = await p.evaluate(() => window.__layers)
console.log('bitti', ats.length, JSON.stringify(lay), errs.length ? errs.slice(0, 3) : 'hata yok')
await b.close()
