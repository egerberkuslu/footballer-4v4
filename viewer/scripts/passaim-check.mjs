// Pas hedefi mantigi: yon yokken en uygun acik takim arkadasi; yon verilince o yone yakin acik takim arkadasi
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 600, height: 400 } })
await p.goto('http://127.0.0.1:5173/?dbg=1&practice=1', { timeout: 180000 })
await p.waitForTimeout(11000)
console.log(JSON.stringify(await p.evaluate(() => {
  const L = window.__loco; const { game, passTarget } = L
  const P = game.players.find((q) => q.team === 0 && q.role === 'forvet')
  const mates = game.players.filter((q) => q.team === 0 && q.id !== P.id)
  const opp = game.players.filter((q) => q.team === 1)
  const set = (q, x, z) => { q.x = x; q.z = z; q.vx = q.vz = 0 }
  const dir = game.match.attackDir[0]
  set(P, 0, 0); P.facing = Math.PI / 2
  mates.forEach((q, i) => set(q, -30 - i, 20)); opp.forEach((q, i) => set(q, 30 + i, 20))
  const [A, B, C] = mates
  const out = {}
  // 1) bakis yonunde (+x) kimse yok; A onde-yanda 71 derece, B arkada
  set(A, 3, 9); set(B, -6, 0)
  const r1 = passTarget(P, 1, 0, false); out.yonYok_AonuYanda = { dir, hedef: [+r1.x.toFixed(1), +r1.z.toFixed(1)], beklenen: 'A(3,9) civari' }
  const r1b = passTarget(P, 1, 0, true); out.yonVar_ayniDurum = { hedef: [+r1b.x.toFixed(1), +r1b.z.toFixed(1)], beklenen: 'koni disi A ceza ama arkaya verme yok; A ya da bos 12 m' }
  // 2) iki aday: A onde ama rakip yolda, B yanda acik
  set(A, 12, 0); set(opp[1], 6, 0.2); set(B, 8, 9)
  const r2 = passTarget(P, 1, 0, false); out.rakipYolda = { hedef: [+r2.x.toFixed(1), +r2.z.toFixed(1)], beklenen: 'B(8,9) acik olan' }
  const r2b = passTarget(P, 1, 0, true); out.rakipYolda_yonVar = { hedef: [+r2b.x.toFixed(1), +r2b.z.toFixed(1)] }
  // 3) yon +z (cubuk yukari): B(8,9) 48 derece, C (0,15) tam yonde
  set(C, 0, 15); set(opp[1], 30, 20)
  const r3 = passTarget(P, 0, 1, true); out.yonZ = { hedef: [+r3.x.toFixed(1), +r3.z.toFixed(1)], beklenen: 'C(0,15)' }
  return out
}), null, 1))
await b.close()
