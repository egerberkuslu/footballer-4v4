// Gercek GPU, insan kontrolu: tus dizisiyle surme/donus/jokey/mudahale kare dizisi.
// kullanim: node .i-drive.mjs <onek> '<adim json>' ; adim: [ms, "down|up|press", tus] ya da [ms,"eval",js]
import { chromium } from '/home/ege/Blender-MCP/footballer/viewer/node_modules/playwright/index.mjs'
import { readFileSync } from 'fs'
const pre = process.argv[2]
const steps = JSON.parse(process.argv[3])
const q = process.argv[4] || 'mode=mac'
const gap = Number(process.argv[5] || 100)
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
p.on('pageerror', (e) => logs.push('pageerror ' + e.message))
await p.goto(`http://127.0.0.1:5173/?${q}`)
await p.waitForTimeout(9000)
await p.evaluate(readFileSync('/tmp/claude-1000/-home-ege-Blender-MCP/d4aa7604-52b1-4a9f-9df8-92a5ec2eed15/scratchpad/follow.js', 'utf8'))
await p.evaluate(`window.__followMode=window.__game.controlledPlayer().id; window.__followDist=(window.__wide||4.5)`)
const probe = `(()=>{const g=window.__game;const c=g.controlledPlayer();return [c.id,c.anim,c.hasBall?1:0,g.match.phase,JSON.stringify(window.__hd)+(window.__ph?window.__ph.length:-1)]})()`
let n = 0, t0 = Date.now(), si = 0
const end = steps[steps.length - 1][0] + 600
while (Date.now() - t0 < end) {
  const el = Date.now() - t0
  while (si < steps.length && steps[si][0] <= el) {
    const [, k, a] = steps[si++]
    if (k === 'down') await p.keyboard.down(a); else if (k === 'up') await p.keyboard.up(a); else if (k === 'press') await p.keyboard.press(a); else if (k === 'eval') console.log('eval', JSON.stringify(await p.evaluate(a)))
  }
  const t = Date.now()
  await p.screenshot({ path: `${pre}-${String(n).padStart(2, '0')}.png`, clip: { x: 200, y: 100, width: 880, height: 600 } })
  console.log(n, el, JSON.stringify(await p.evaluate(probe)))
  n++
  const w = gap - (Date.now() - t)
  if (w > 0) await p.waitForTimeout(w)
}
console.log(logs.join('\n') || 'hata yok')
await b.close()
