// Gercek mac sayfasinda mudahale katmani: kontrol edilen topsuz oyuncu topa kayar, sonra ayakta mudahale yapar.
// Anim gecmisi ve katman sayaci okunur, kayma sirasinda ekran goruntusu alinir.
// Kullanim: scripts/run-browser.sh node scripts/tackle-match.mjs /tmp/asci/tackle/mac
import { chromium } from 'playwright'
const pre = process.argv[2] || '/tmp/asci/tackle/mac'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 960, height: 540 } })
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/?mode=mac', { timeout: 180000 })
await p.waitForTimeout(9000)
const res = {}
for (const kind of ['slide', 'tackle']) {
  const f0 = await p.evaluate(() => window.__layers?.tackle?.frames ?? -1)
  await p.evaluate(async (kind) => {
    const { game, setControlled } = window.__loco
    const W = window.__shot.world
    W.timeScale = 1
    const ball = W.ball
    // topa en yakin topsuz oyuncu (top sahibi degil)
    let best = null, bd = 1e9
    for (const q of game.players) {
      if (q.hasBall || q.role === 'kaleci' || !ball) continue
      const d = Math.hypot(q.x - ball.x, q.z - ball.z)
      if (d < bd) (bd = d), (best = q)
    }
    const P = best ?? game.players[3]
    setControlled(P.id)
    window.__tk = { id: P.id, hist: [], d0: bd }
    const iv = setInterval(() => {
      const h = window.__tk.hist
      const last = h[h.length - 1]
      if (!last || last[0] !== P.anim) h.push([P.anim, Math.round(performance.now())])
    }, 10)
    window.__tk.iv = iv
    await new Promise((r) => setTimeout(r, 300))
    // top oyuncunun onune (kayma 1.8 m, mudahale 0.7 m)
    const dd = kind === 'slide' ? 1.8 : 0.7
    W.placeBall(P.x + Math.sin(P.facing) * dd, P.z + Math.cos(P.facing) * dd)
    const aim = { x: W.ball.x, y: 0, z: W.ball.z }
    void aim
  }, kind)
  // klavye: E E cift dokunus = kayarak, E kisa dokunus = ayakta
  if (kind === 'slide') { await p.keyboard.press('e'); await p.waitForTimeout(60); await p.keyboard.press('e') }
  else await p.keyboard.press('e')
  await p.waitForTimeout(kind === 'slide' ? 380 : 220)
  await p.screenshot({ path: `${pre}_${kind}.png` })
  await p.waitForTimeout(2600)
  res[kind] = await p.evaluate((f0) => { clearInterval(window.__tk.iv); const h = window.__tk.hist; return { id: window.__tk.id, topaUzaklik: Math.round(window.__tk.d0 * 100) / 100, animGecmisi: h.map((x, i) => `${x[0]}@${i ? x[1] - h[0][1] : 0}ms`), katmanKareleri: (window.__layers?.tackle?.frames ?? -1) - f0 } }, f0)
}
console.log(JSON.stringify({ res, layers: await p.evaluate(() => window.__layers) }, null, 1)); console.log('hata:', errs.length ? errs.slice(0, 3) : 'yok')
await b.close()
