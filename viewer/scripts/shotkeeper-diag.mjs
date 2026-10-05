// shotkeeper: pratik modunda sut -> top + kaleci tepkisi, kare kare
import { chromium } from 'playwright'
const url = process.argv[2] || 'http://127.0.0.1:5173/?dbg=1&practice=1'
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 900, height: 560 } })
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto(url, { timeout: 180000 })
await p.waitForTimeout(11000)
await p.keyboard.press('y'); await p.waitForTimeout(1500)
const rec = p.evaluate(async () => {
  const L = window.__loco, S = window.__shot; const { game } = L
  const P = game.players.find((q) => q.team === 0 && q.role === 'forvet'); const K = game.players.find((q) => q.team === 1 && q.role === 'kaleci')
  const rows = []; const t0 = performance.now()
  while (performance.now() - t0 < 9000) { const B = S.world.ball; rows.push([Math.round(performance.now() - t0), P.anim, P.hasBall ? 1 : 0, +P.x.toFixed(2), +P.facing.toFixed(2), +B.x.toFixed(2), +B.y.toFixed(2), +B.z.toFixed(2), +Math.hypot(B.vx, B.vy, B.vz).toFixed(1), K.anim, +K.x.toFixed(2), +K.z.toFixed(2), game.match.phase, JSON.stringify(game.inputs[P.id]?.action?.type ?? null), S.ctl.charge, game.match.attackDir?.[0]]); await new Promise((r) => requestAnimationFrame(r)) }
  return { rows, kl: window.__layers?.keeper, side: S.world.side, n: rows.length, ts: S.world.timeScale, mode: S.ctl.mode, prac: S.ctl.practice, scr: S.ctl.screen }
})
await p.waitForTimeout(300)
await p.keyboard.down('Space'); await p.waitForTimeout(700); await p.keyboard.up('Space')
const r = await rec
console.log(JSON.stringify({n:r.n,ts:r.ts,mode:r.mode,prac:r.prac,scr:r.scr}), r.side, 'keeper layer', JSON.stringify(r.kl))
let last = ''
for (const x of r.rows) { const s = JSON.stringify(x.slice(1)); if (s !== last) console.log(x[0], s); last = s }
console.log('err', errs.slice(0, 3))
await b.close()
