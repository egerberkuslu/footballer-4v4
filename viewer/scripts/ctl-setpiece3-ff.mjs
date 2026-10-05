// F: duran top 3 s sayaci x insan nisan/sarj: serbest vurus, tac, korner (insan takimina). Firefox, run-browser.sh ile.
// Her biri icin: kurulum baslayinca sarj (500 ms) + birak; kullanim suresi ve rakibe gecis (restart.team) olculur.
import { firefox } from 'playwright'
const b = await firefox.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/?blades=8000&mode=mac')
await p.waitForTimeout(9000)
await p.evaluate(() => {
  window.__ev = []
  window.__game.on((e) => window.__ev.push({ t: performance.now(), type: e.type, kind: e.kind, phase: e.phase, team: e.restart?.team }))
})
const snap = () =>
  p.evaluate(() => {
    const g = window.__game
    const c = g.controlledPlayer()
    const r = g.match.restart
    return { phase: g.match.phase, rs: r && { type: r.type, team: r.team, taker: r.taker }, ctrl: c && c.id, setup: window.__shot.ctl.setup }
  })
const until = async (fn, ms) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await fn()
    if (v) return v
    await p.waitForTimeout(80)
  }
  return null
}
const toPlay = () => until(async () => ((await snap()).phase === 'play' ? true : (await p.keyboard.press('k'), false)), 25000)
const setBall = (o) =>
  p.evaluate((o) => {
    const g = window.__game
    for (const q of g.players) q.hasBall = false
    const q = g.players[o.touch]
    g.match.lastTouch = { player: q.id, team: q.team, t: window.__rules.time }
    window.__world.placeBall(o.x, o.z)
    window.__world.kick(o.v, { x: 0, y: 0, z: 0 })
  }, o)
const res = {}
async function scenario(name, trigger, phaseName, lateMs) {
  await toPlay()
  await trigger()
  const s = await until(async () => ((await snap()).phase === phaseName ? await snap() : null), 8000)
  if (!s) return (res[name] = { ok: false, why: 'faz gelmedi' })
  const t0 = await p.evaluate(() => performance.now())
  await p.mouse.move(640, 300)
  await p.waitForTimeout(lateMs) // kullanici gec hazir
  res[name + ' dbg'] = await p.evaluate(() => { const g = window.__game; const c = g.controlledPlayer(); const b = window.__world.ball; return { p: [+c.x.toFixed(1), +c.z.toFixed(1)], ball: [+b.x.toFixed(1), +b.z.toFixed(1)], d: +Math.hypot(b.x - c.x, b.z - c.z).toFixed(2), setupFlag: window.__shot.ctl.setup } })
  await p.keyboard.down(' ')
  await p.waitForTimeout(250)
  res[name + ' c250'] = await p.evaluate(() => window.__shot.ctl.charge)
  await p.waitForTimeout(250)
  res[name + ' c500'] = await p.evaluate(() => window.__shot.ctl.charge)
  await p.keyboard.up(' ')
  await p.waitForTimeout(60)
  res[name + ' c60after'] = await p.evaluate(() => [window.__shot.ctl.charge, window.__game.controlledPlayer().anim])
  const tl = []
  for (let i = 0; i < 9; i++) { await p.waitForTimeout(500); tl.push(await p.evaluate(() => { const g = window.__game; const c = g.controlledPlayer(); const w = window.__world.ball; return [g.match.phase, c.id, g.match.restart && g.match.restart.taker, c.anim, +Math.hypot(w.x - c.x, w.z - c.z).toFixed(2), +window.__shot.ctl.charge.toFixed(2), c.actionLock.toFixed(2)].join(',') })) }
  res[name + ' tl'] = tl
  const after = await snap()
  const e = await p.evaluate((t0) => window.__ev.filter((x) => x.t > t0), t0)
  const shot = e.find((x) => x.type === 'touch' && (x.kind === 'shoot' || x.kind === 'pass' || x.kind === 'lob'))
  const swapped = e.find((x) => x.type === 'restart' && x.team === 1 && (!shot || x.t < shot.t))
  res[name] = { setup: s, taken: shot ? Math.round(shot.t - t0) : null, swappedToOpp: !!swapped, phaseAfter: after.phase, ev: e.filter((x) => x.type !== 'phase').map((x) => Math.round(x.t - t0) + ':' + x.type + (x.kind ? '/' + x.kind : '')).slice(0, 14), ok: !!shot && shot.t - t0 <= 3200 && !swapped }
}
const att = await p.evaluate(() => window.__game.match.attackDir[0])
for (const late of [0, 1500]) {
  await scenario(`serbest-vurus late=${late}`, () => p.evaluate(() => { const g = window.__game; const h = g.controlledPlayer(); const o = g.players.find((q) => q.team === 1 && q.role !== 'kaleci'); g.emit({ type: 'contact', a: o.id, b: h.id, ballFirst: false, fromBehind: true, intensity: 0.8, kind: 'tackle', x: h.x, z: h.z }) }), 'freekick', late)
  await scenario(`tac late=${late}`, () => setBall({ touch: 5, x: 4, z: 11.8, v: { x: 0, y: 0, z: 9 } }), 'kickin', late)
  await scenario(`korner late=${late}`, () => setBall({ touch: 5, x: att * 18.8, z: 7, v: { x: att * 10, y: 0, z: 0 } }), 'corner', late)
}
console.log(JSON.stringify(res, null, 1))
console.log(errs.join('\n') || 'pageerror yok')
await b.close()
