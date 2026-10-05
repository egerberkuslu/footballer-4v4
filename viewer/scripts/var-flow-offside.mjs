// G: mac modunda sahada VAR akisi; asamalarda ekran goruntusu. Kullanim: scripts/run-browser.sh node scripts/var-flow.mjs "mode=mac&blades=12000&fx=0" line|offside <onek>
import { chromium } from 'playwright'
const q = process.argv[2] || 'mode=mac&blades=12000&fx=0'
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)) })
p.on('pageerror', (e) => logs.push('pageerror ' + e.message))
await p.goto('http://127.0.0.1:5173/?' + q, { timeout: 180000 })
for (let i = 0; i < 60; i++) { if (await p.evaluate(() => !!window.__var).catch(() => false)) break; await p.waitForTimeout(2000) }
await p.waitForTimeout(4000)
const MODE = process.argv[3] || 'line'
const info = await p.evaluate(async (MODE) => {
  const V = window.__var, S = window.__shot, sl = (ms) => new Promise((r) => setTimeout(r, ms))
  const R = 0.11, g = 20
  const smp = async (n = 2) => { for (let i = 0; i < n; i++) { const t = V.rec.lastT, t0 = performance.now(); while (V.rec.lastT === t && performance.now() - t0 < 8000) await sl(20) } }
  const at = async (x, z, n = 2) => { V.place(x, R, z); await smp(n) }
  V.state.warp = 1.5
  V.setAuto('acik')
  if (MODE === 'line') {
    for (const x of [5, g - 0.6, g - 0.2, g + R + 0.03, g + R - 0.1, g - 0.5, g - 1.2]) await at(x, 0.5)
  } else {
    const { game } = await import('/src/game/store.ts')
    await smp(4)
    window.__refLog = []
    setInterval(() => { if (V.state.active) window.__refLog.push([V.state.phase, game.referee.x, game.referee.z, game.referee.anim]) }, 100)
    const d = game.match.attackDir[0]
    const t0p = game.players.filter((q) => q.team === 0)
    const t1p = game.players.filter((q) => q.team === 1)
    const att = t0p.find((q) => q.role !== 'kaleci') , pas = t0p.filter((q) => q.role !== 'kaleci')[1]
    const spots = () => {
      // hucum takimi: alici son savunmaci cizgisinin 12 cm onunde (ofsayt), rakip: kaleci d*17, ikinci d*8
      att.x = d * 8.12; att.z = 3; att.vx = att.vz = 0
      pas.x = d * 2; pas.z = -4; pas.vx = pas.vz = 0
      t1p.forEach((q, i) => { q.x = d * (i === 0 ? 17 : i === 1 ? 8 : 5); q.z = i === 0 ? 0 : i === 1 ? -2 : 5; q.vx = q.vz = 0 })
    }
    for (let i = 0; i < 4; i++) { spots(); await smp(1) }
    game.emit({ type: 'offside-check', passer: pas.id, receiver: att.id, margin: 0.12, t: 0 })
    for (let i = 0; i < 3; i++) { spots(); await smp(1) }
    game.emit({ type: 'touch', player: att.id, kind: 'trap' })
    for (let i = 0; i < 2; i++) { spots(); await smp(1) }
    window.__dbg1 = JSON.stringify(V.debug(), (k, v) => (v instanceof Map ? [...v] : v))
    game.emit({ type: 'goal', team: 0, scorer: att.id })
    await smp(2)
  }
  return { active: V.state.active, phase: V.state.phase, mode: S.ctl.mode, c: V.state.case && V.state.case.kind, dbg: window.__dbg1, after: JSON.stringify(V.debug(), (k, v) => (v instanceof Map ? [...v] : v)) }
}, MODE)
console.log(JSON.stringify(info))
const pre = process.argv[4] || 'G'
const shots = { walk: `shots/${pre}-walk.png`, monitor: `shots/${pre}-monitor.png`, freeze: `shots/${pre}-freeze.png`, signal: `shots/${pre}-signal.png` }
const t0 = Date.now()
const seen = new Set()
while (Date.now() - t0 < 420000 && seen.size < 4) {
  const st = await p.evaluate(() => ({ ph: window.__var.state.phase, ref: window.__shot && [window.__r3f && 0], anim: undefined }))
  const ph = st.ph
  if (shots[ph] && !seen.has(ph)) {
    seen.add(ph)
    if (ph === 'walk') await p.waitForTimeout(2500)
    await p.evaluate(() => { window.__var.state.warp = 0.05 })
    await p.waitForTimeout(ph === 'signal' ? 2500 : 1500)
    await p.screenshot({ path: shots[ph], timeout: 180000 })
    console.log('shot', ph, ((Date.now() - t0) / 1000).toFixed(0) + 's')
    await p.evaluate(() => { window.__var.state.warp = 1.5 })
  }
  if (ph === 'off' && seen.size) break
  await p.waitForTimeout(300)
}
const rl = await p.evaluate(() => window.__refLog)
const MON = { x: 0, z: -(25 / 2 + 1.6) }
const byPh = {}
for (const [ph, x, z] of rl) { const dd = Math.hypot(x - MON.x, z - MON.z); const o = (byPh[ph] ??= { n: 0, min: 9e9, max: 0 }); o.n++; o.min = Math.min(o.min, dd); o.max = Math.max(o.max, dd) }
console.log('hakem-monitor mesafesi (faz): ' + JSON.stringify(byPh))
console.log(logs.slice(0, 10).join('\n') || 'console: temiz')
await b.close()
