// Lokomosyon ajani: kosu kare dizisi (test sayfasi, yan kamera, fazi sabitleyerek 8 kare) -> tek serit PNG.
// Kullanim: scripts/run-browser.sh node scripts/loco-shots.mjs <cikti-oneki> <hiz> [klip|auto] [clips=1|0] [kare=8]
// klip: anim_loco_cmu.json anahtari (kendi vref'inde, __locoClip) ya da auto (bant karisimi). clips=0: eski parametrik.
import { execSync } from 'node:child_process'
import { launch } from './qa-lib.mjs'
const pre = process.argv[2] || '/tmp/asci/loco/ls'
const v = process.argv[3] || '3'
const clip = process.argv[4] || 'auto'
const clips = process.argv[5] || '1'
const N = Number(process.argv[6] || 8)
const { b, p, logs } = await launch({ w: 1100, h: 620 })
await p.addInitScript((c) => {
  if (c !== 'auto') window.__locoClip = c
}, clip)
await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=loco&v=${v}&anims=run&dist=3.6&h=0.95&clips=${clips}&loco=${clips}`)
await p.waitForTimeout(6000)
await p.evaluate(() => (window.__locoPhase = 0))
await p.waitForTimeout(800)
const files = []
for (let i = 0; i < N; i++) {
  await p.evaluate((ph) => (window.__locoPhase = ph), i / N)
  await p.waitForTimeout(250)
  const f = `${pre}_${i}.png`
  await p.screenshot({ path: f, clip: { x: 330, y: 40, width: 440, height: 560 } })
  files.push(f)
}
const st = await p.evaluate(() => window.__layers)
execSync(`montage ${files.join(' ')} -tile ${N}x1 -geometry +2+0 ${pre}_strip.png`)
console.log('serit', `${pre}_strip.png`, 'katman', JSON.stringify(st), 'hata', logs.length ? logs.slice(0, 3) : 'yok')
await b.close()
