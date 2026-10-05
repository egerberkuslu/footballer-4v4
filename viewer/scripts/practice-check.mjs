// Serbest antrenman: menuden gir, yerlesim + topla kosu + sut + top sifirlama
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1000, height: 600 } })
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/?dbg=1&practice=1', { timeout: 180000 })
await p.waitForTimeout(9000)
await p.waitForTimeout(8000)
await p.keyboard.down('d'); await p.keyboard.down('Shift'); await p.waitForTimeout(2500); await p.keyboard.up('Shift'); await p.keyboard.up('d')
await p.screenshot({ path: '/tmp/asci/practice_run.png' })
const r = await p.evaluate(async () => {
  const L = window.__loco, S = window.__shot
  if (!L) return { yok: '__loco yok (mac kontrolu yuklenmemis)' }
  const { game } = L; const world = S.world
  const snap = () => game.players.map((q) => `${q.id}:t${q.team}:${q.role[0]}:(${q.x.toFixed(1)},${q.z.toFixed(1)})`).join(' ')
  const out = { practice: !!window.__practiceOn, side: world.side, ilk: snap(), ball0: [world.ball.x.toFixed(1), world.ball.z.toFixed(1)] }
  const P = game.players.find((q) => q.team === 0 && q.role === 'forvet')
  world.timeScale = 1
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const iv = setInterval(() => { game.inputs[P.id].move = { x: world.side, z: 0 }; game.inputs[P.id].sprint = true }, 16)
  await sleep(2500); clearInterval(iv)
  out.kosuSonra = { x: +P.x.toFixed(1), hasBall: P.hasBall, anim: P.anim }
  game.inputs[P.id].move = { x: 0, z: 0 }
  game.inputs[P.id].action = { type: 'shoot', power: 0.9, aim: { x: world.side * 20, y: 1, z: 1.2 } }
  await sleep(150); game.inputs[P.id].action = null
  await sleep(4000)
  out.sutSonra = { ball: [world.ball.x.toFixed(1), world.ball.z.toFixed(1)], hint: document.body.innerText.match(/SERBEST ANTRENMAN[^\n]*/)?.[0] }
  await sleep(3500)
  out.sifirlandi = { ball: [world.ball.x.toFixed(1), world.ball.z.toFixed(1)], P: [P.x.toFixed(1), P.z.toFixed(1)] }
  out.sonra = snap(); out.layers = window.__layers
  return out
})
console.log(JSON.stringify(r, null, 1)); console.log('hata:', errs.length ? errs.slice(0, 3) : 'yok')
await p.screenshot({ path: '/tmp/asci/practice.png' })
await b.close()
