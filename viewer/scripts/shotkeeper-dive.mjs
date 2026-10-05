// shotkeeper: pratik modunda koseye sutlar -> YZ kaleci dalis sayaci, anim adlari, katman sayaci, kareler
// kullanim: node scripts/shotkeeper-dive.mjs <outdir> [url]
import { chromium } from 'playwright'
const out = process.argv[2] || '/tmp/asci/shotkeeper'
const url = process.argv[3] || 'http://127.0.0.1:5173/?dbg=1&practice=1'
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 640, height: 400 } })
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto(url, { timeout: 180000 })
await p.waitForTimeout(11000)
const aims = [[2.6, 0.4], [-2.6, 1.8], [1.6, 2.1], [0, 1.0]]
for (const [az, ay] of aims) {
  await p.keyboard.press('y'); await p.waitForTimeout(1200)
  const d0 = await p.evaluate(() => [window.__ai?.dives ?? -1, window.__layers?.keeper?.frames ?? -1])
  const rec = p.evaluate(async ([az, ay]) => {
    const { game } = window.__loco; const S = window.__shot
    const P = game.players.find((q) => q.team === 0 && q.role === 'forvet'); const K = game.players.find((q) => q.team === 1 && q.role === 'kaleci')
    const gx = game.match.attackDir[0] * 20
    game.inputs[P.id].action = { type: 'shoot', power: 0.85, aim: { x: gx, y: ay, z: az }, spin: { x: 0, y: 0, z: 0 } }
    const rows = []; const t0 = performance.now(); let kicked = false
    while (performance.now() - t0 < 14000) {
      const B = S.world.ball; rows.push([Math.round(performance.now() - t0), K.anim + (K.actionLock > 0 ? '*' : ''), +K.x.toFixed(2), +K.z.toFixed(2), +B.x.toFixed(2), +B.y.toFixed(2), +B.z.toFixed(2), +Math.hypot(B.vx, B.vz).toFixed(1)])
      if (Math.hypot(B.vx, B.vz) > 5) kicked = true
      if (kicked && (Math.abs(B.x) > 20.5 || Math.hypot(B.vx, B.vz) < 0.5)) break
      await new Promise((r) => requestAnimationFrame(r))
    }
    return { rows, gx }
  }, [az, ay])
  // dalis sirasinda kareler
  const shots = []
  for (let i = 0; i < 6; i++) { await p.waitForTimeout(700); const ka = await p.evaluate(() => window.__game.players.find((q) => q.team === 1 && q.role === 'kaleci').anim); const f = `${out}/dive_z${az}_y${ay}_${i}.png`; await p.screenshot({ path: f }); shots.push(ka) }
  const r = await rec
  const d1 = await p.evaluate(() => [window.__ai?.dives ?? -1, window.__layers?.keeper?.frames ?? -1])
  const kAnims = [...new Set(r.rows.map((x) => x[1]))]
  console.log(`aim z=${az} y=${ay}: gx=${r.gx} dives ${d0[0]}->${d1[0]} keeperLayerFrames ${d0[1]}->${d1[1]} keeperAnims ${JSON.stringify(kAnims)} shotAnims ${JSON.stringify(shots)}`)
  console.log('  n', r.rows.length); let ls=''; for (const x of r.rows) { const s2 = x[1]; if (s2 !== ls) console.log('   ', JSON.stringify(x)); ls = s2 }; console.log('    end', JSON.stringify(r.rows.at(-1)))
}
console.log('err', errs.slice(0, 3))
await b.close()
