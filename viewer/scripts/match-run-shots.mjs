// Gercek mac sayfasinda, oyun kamerasiyla, kontrol edilen oyuncu +x'e kosarken kare kare goruntu (topsuz / topla)
import { chromium } from 'playwright'
const withBall = process.argv[3] === '1'
const pre = process.argv[2] || '/tmp/mr'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
await p.goto('http://127.0.0.1:5173/?mode=mac&dbg=1', { timeout: 180000 })
await p.waitForTimeout(7000)
await p.evaluate((wb) => {
  const L = window.__loco, S = window.__shot; const { game, setControlled } = L; const world = S.world
  const P = game.players[1]; setControlled(P.id); world.timeScale = 1
  P.x = -8; P.z = 0; P.facing = Math.PI / 2
  if (wb) world.placeBall(-7.5, 0)
  window.__iv = setInterval(() => { game.inputs[P.id].move = { x: 1, z: 0 }; game.inputs[P.id].sprint = false }, 16)
}, withBall)
await p.waitForTimeout(3500)
for (let i = 0; i < 6; i++) { await p.screenshot({ path: `${pre}_${i}.png` }); await p.waitForTimeout(250) }
console.log(JSON.stringify(await p.evaluate(() => { const P = window.__loco.game.players[1]; return { anim: P.anim, v: Math.hypot(P.vx, P.vz).toFixed(2), hasBall: P.hasBall, clip: window.__clip } })))
await b.close()
