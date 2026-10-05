// Gercek mac sayfasinda sut: 'kick' animasyonu tetikleniyor mu, klip uygulaniyor mu?
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 700, height: 420 } })
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/?mode=mac', { timeout: 180000 })
await p.waitForTimeout(8000)
const r = await p.evaluate(async () => {
  const L = window.__loco, S = window.__shot
  const { game, setControlled } = L
  const world = S.world
  const roles = game.players.map((q) => q.id + ':' + q.team + ':' + q.role)
  const P = game.players.find((q) => q.team === 0 && !/^(K|GK|keeper|kaleci)/i.test(String(q.role)) && q.id !== 0) || game.players[3]
  setControlled(P.id); world.timeScale = 1
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const log = []
  for (let n = 0; n < 4; n++) {
    world.placeBall(P.x + Math.sin(P.facing) * 0.45, P.z + Math.cos(P.facing) * 0.45)
    await sleep(900)
    game.inputs[P.id].action = { type: 'shoot', power: 0.8, aim: { x: 0, y: 1, z: 0 } }
    await sleep(120)
    game.inputs[P.id].action = null
    log.push({ anim: P.anim, hasBall: P.hasBall })
    await sleep(1400)
  }
  return { P: P.id, log, layers: window.__layers }
})
console.log(JSON.stringify(r)); console.log('hata:', errs.length ? errs.slice(0, 3) : 'yok')
await b.close()
