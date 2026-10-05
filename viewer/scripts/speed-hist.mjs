// Gercek simulasyonda (AI-AI, mac modu) saha oyuncularinin hiz dagilimi + topla/topsuz ayrimi
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 400, height: 300 } })
await p.goto('http://127.0.0.1:5173/?mode=mac', { timeout: 180000 })
await p.waitForTimeout(7000)
const r = await p.evaluate(() => {
  const L = window.__loco, S = window.__shot
  const { game, stepLocomotion } = L; const world = S.world
  world.timeScale = 0
  const bins = [0, 0.5, 1.5, 2.5, 3.4, 4.5, 6, 7.5, 99]
  const H = { ball: new Array(bins.length - 1).fill(0), free: new Array(bins.length - 1).fill(0) }
  let n = 0
  for (let i = 0; i < 60 * 90; i++) {
    stepLocomotion(1 / 60); world.timeScale = 1; world.step(1 / 60); world.timeScale = 0
    if (i % 6 === 0) for (const q of game.players) {
      if (/kaleci/.test(q.role)) continue
      const s = Math.hypot(q.vx, q.vz); const k = bins.findIndex((v, j) => s >= v && s < bins[j + 1])
      H[q.hasBall ? 'ball' : 'free'][k]++; n++
    }
  }
  return { bins: bins.slice(0, -1), H, n }
})
console.log(JSON.stringify(r)); await b.close()
