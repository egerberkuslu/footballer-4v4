// Serbest antrenman teshis: (a) yuruyus/kosu/sprint hiz ve anim adlari, (b) sutta kaleci tepkisi
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 900, height: 560 } })
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/?dbg=1&practice=1', { timeout: 180000 })
await p.waitForTimeout(11000)
const probe = (ms) => p.evaluate(async (ms) => {
  const L = window.__loco, S = window.__shot; const { game } = L; const P = game.players.find((q) => q.team === 0 && q.role === 'forvet'); const K = game.players.find((q) => q.team === 1 && q.role === 'kaleci')
  const rows = []; const t0 = performance.now()
  while (performance.now() - t0 < ms) { rows.push({ t: Math.round(performance.now() - t0), v: +Math.hypot(P.vx, P.vz).toFixed(1), a: P.anim, kx: +K.x.toFixed(1), kz: +K.z.toFixed(1), ka: K.anim, ball: [+S.world.ball.x.toFixed(1), +S.world.ball.y.toFixed(1), +S.world.ball.z.toFixed(1)], bv: +Math.hypot(S.world.ball.vx, S.world.ball.vz).toFixed(1) }); await new Promise((r) => setTimeout(r, 200)) }
  return rows
}, ms)
const sum = (rows) => { const u = (k) => [...new Set(rows.map((r) => r[k]))]; return { vmax: Math.max(...rows.map((r) => r.v)), anims: u('a'), keeperAnims: u('ka'), keeperZ: [Math.min(...rows.map((r) => r.kz)), Math.max(...rows.map((r) => r.kz))] } }
// (a) yurume: D tek basina; kosu: D+Shift
await p.keyboard.down('d'); let r = await probe(2500); console.log('D (yuruyus/jog):', JSON.stringify(sum(r))); 
await p.keyboard.down('Shift'); r = await probe(2500); console.log('D+Shift (sprint):', JSON.stringify(sum(r)))
await p.keyboard.up('Shift'); await p.keyboard.up('d')
await p.keyboard.press('t'); await p.waitForTimeout(2500)
// (b) sut: Space basili tut 700ms, birak
await p.keyboard.down('Space'); await p.waitForTimeout(700); await p.keyboard.up('Space')
r = await probe(3500); console.log('SUT sonrasi:', JSON.stringify(sum(r)))
console.log('top izi (her 3. kayit):', JSON.stringify(r.filter((_, i) => i % 3 === 0).map((x) => [x.t, x.ball.join('/'), x.bv, x.ka])))
console.log('katmanlar:', JSON.stringify(await p.evaluate(() => window.__layers)))
console.log('hata:', errs.length ? errs.slice(0, 3) : 'yok')
await b.close()
