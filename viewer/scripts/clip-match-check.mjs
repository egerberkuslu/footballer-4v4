// Ana mac sayfasinda klip katmani gercekten devrede mi? Topsuz bir oyuncuyu kosturur, sayaclari okur.
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 640, height: 400 } })
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/?mode=mac', { timeout: 180000 })
await p.waitForTimeout(8000)
const r = await p.evaluate(async () => {
  const L = window.__loco, S = window.__shot
  if (!L) return { yok: '__loco yok' }
  const { game, setControlled } = L
  const P = game.players[3]
  S.world && (S.world.timeScale = 1)
  setControlled(P.id)
  P.hasBall = false
  const t0 = performance.now()
  const iv = setInterval(() => { game.inputs[P.id].move = { x: 1, z: 0 }; game.inputs[P.id].sprint = true }, 16)
  await new Promise((r) => setTimeout(r, 9000))
  clearInterval(iv)
  return { layers: window.__layers, anim: P.anim, speed: Math.hypot(P.vx ?? 0, P.vz ?? 0) }
})
console.log(JSON.stringify(r)); console.log('hata:', errs.length ? errs.slice(0, 3) : 'yok')
await b.close()
