// F: duran top kurulumunda insan nisan+guc hazirligi: faul ile serbest vurus kur, kurulum sirasinda sarj et,
// birak; 3 s icinde sut atiliyor mu (touch:shoot) ve top rakibe gecmiyor mu. Firefox, scripts/run-browser.sh ile.
import { firefox } from 'playwright'
const b = await firefox.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/?blades=8000&mode=mac')
await p.waitForTimeout(9000)
await p.evaluate(() => {
  window.__ev = []
  const g = window.__game
  g.on((e) => window.__ev.push({ t: performance.now(), type: e.type, kind: e.kind, phase: e.phase, player: e.player }))
})
const snap = () =>
  p.evaluate(() => {
    const g = window.__game
    const c = g.controlledPlayer()
    return { phase: g.match.phase, rs: g.match.restart && { type: g.match.restart.type, team: g.match.restart.team, taker: g.match.restart.taker }, ctrl: c && c.id, setup: window.__shot.ctl.setup, charge: window.__shot.ctl.charge }
  })
const out = { before: await snap() }
// rakip (takim 1) insana faul yapar
await p.evaluate(() => {
  const g = window.__game
  const h = g.controlledPlayer()
  const o = g.players.find((q) => q.team === 1 && q.role !== 'kaleci')
  g.emit({ type: 'contact', a: o.id, b: h.id, ballFirst: false, fromBehind: true, intensity: 0.8, kind: 'tackle', x: h.x, z: h.z })
})
let t0 = 0
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(100)
  const s = await snap()
  if (s.phase === 'freekick') {
    t0 = await p.evaluate(() => performance.now())
    out.setupStart = s
    break
  }
}
out.reachedFreekick = t0 > 0
await p.mouse.move(640, 300)
await p.keyboard.down(' ')
await p.waitForTimeout(500)
out.charging = await snap()
await p.keyboard.up(' ')
await p.waitForTimeout(4000)
out.after = await snap()
out.shot = await p.evaluate((t0) => {
  const e = window.__ev.find((x) => x.type === 'touch' && x.kind === 'shoot' && x.t > t0)
  return e ? { afterMs: Math.round(e.t - t0) } : null
}, t0)
out.within3s = !!out.shot && out.shot.afterMs <= 3200
console.log(JSON.stringify(out, null, 1))
console.log(errs.join('\n') || 'pageerror yok')
await b.close()
