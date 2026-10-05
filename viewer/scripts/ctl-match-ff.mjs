// F: mac modu uctan uca (Firefox, tek kisa oturum): baslama vurusu pasi, surme, sut; olay kaydi
import { firefox } from 'playwright'
const b = await firefox.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/?blades=8000&mode=mac')
await p.waitForTimeout(9000)
await p.evaluate(() => {
  window.__ev = []
  window.__game.on((e) => window.__ev.push(e.type + (e.kind ? ':' + e.kind : '') + (e.phase ? ':' + e.phase : '') + (e.player != null ? '#' + e.player : '')))
})
const st = () => p.evaluate(() => { const g = window.__game; const c = g.controlledPlayer(); return { phase: g.match.phase, score: g.match.score.join('-'), ctrl: c && c.id, has: c && c.hasBall, x: c && +c.x.toFixed(1), ball: [+window.__shot.world.ball.x.toFixed(1), +window.__shot.world.ball.z.toFixed(1)] } })
const out = {}
out.start = await st()
await p.mouse.move(640, 300)
// baslama vurusu: pas (K)
await p.keyboard.press('k')
await p.waitForTimeout(2500)
out.afterKick = await st()
// topa kos/sur: D (sag = +x) 3 s
await p.keyboard.down('d')
await p.waitForTimeout(3000)
out.afterRun = await st()
await p.keyboard.up('d')
// sut: fareyle kale ortasina, Bosluk 0.7 s
await p.keyboard.down(' ')
await p.waitForTimeout(700)
await p.keyboard.up(' ')
await p.waitForTimeout(3000)
out.afterShot = await st()
out.events = await p.evaluate(() => { const c = {}; for (const e of window.__ev) c[e] = (c[e] || 0) + 1; return c })
await p.screenshot({ path: 'shots/F-9.png' })
console.log(JSON.stringify(out, null, 1))
console.log(errs.join('\n') || 'pageerror yok')
await b.close()
