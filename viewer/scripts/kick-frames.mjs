// Gercek mac sayfasinda sut kare dizisi: zaman durdurulup (timeScale 0) belirli animT anlarinda profil + onden goruntu.
// Kullanim: scripts/run-browser.sh node scripts/kick-frames.mjs <cikti-onek> <senaryo: duran|sol25|kosu> [url-ekleri] [at-listesi] [kickVar]
// Cikti: <onek>_side.png ve <onek>_front.png (montaj) + tek kareler.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
const pre = process.argv[2] || '/tmp/asci/kick/kf'
const scen = process.argv[3] || 'duran'
const extra = process.argv[4] || ''
const ats = (process.argv[5] || '0.05,0.12,0.18,0.23,0.27,0.30,0.36,0.45,0.58,0.70').split(',').map(Number)
const kv = process.argv[6]
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 420, height: 420 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
if (kv !== undefined) await p.addInitScript((v) => { window.__kickVar = isNaN(Number(v)) ? v : Number(v) }, kv)
await p.goto(`http://127.0.0.1:5173/?mode=mac&blades=2000&boot=0&fx=0${extra}`, { timeout: 180000 })
await p.waitForTimeout(9000)
// arayuz katmanlarini gizle (yalniz tuval kalsin)
await p.addStyleTag({ content: 'body *:not(canvas){visibility:hidden !important} canvas{visibility:visible !important}' })
await p.evaluate(async (scen) => {
  const { game, setControlled } = window.__loco
  const S = window.__shot
  const world = S.world
  S.ctl.cam = 'serbest'
  const P = game.players.find((q) => q.team === 0 && q.role !== 'kaleci' && q.id !== 0) || game.players[3]
  window.__P = P
  setControlled(P.id)
  game.match.phase = 'play'
  game.match.restart = null
  if (globalThis.__kRules) globalThis.__kRules.mode = 'play'
  for (const q of game.players) if (q !== P) q.sentOff = true
  const OV = (window.__ov = { mx: 0, mz: 0, sp: false })
  const inp = game.inputs[P.id]
  inp.move = { get x() { return OV.mx }, set x(v) {}, get z() { return OV.mz }, set z(v) {} }
  Object.defineProperty(inp, 'sprint', { get() { return OV.sp }, set(v) {}, configurable: true })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  P.x = 0; P.z = -6; P.vx = 0; P.vz = 0; P.facing = 0
  if (scen === 'kosu') {
    world.placeBall(0, -5.6)
    await sleep(300)
    OV.mz = 1
    await sleep(2200)
  } else {
    world.placeBall(10, 10)
    await sleep(1500)
    P.hasBall = false
    const lx = scen === 'sol25' ? 0.25 : 0
    world.placeBall(P.x + lx, P.z + 0.45)
  }
  world.timeScale = 0.25
  inp.action = { type: 'shoot', power: 0.75, aim: { x: P.x, y: 1, z: P.z + 25 } }
}, scen)
const cam = async (view) => p.evaluate((view) => {
  const s = window.__r3f.get()
  const P = window.__P
  const c = window.__chars.chars[window.__loco.game.players.indexOf(P)]
  const x = c.x, z = c.z
  if (view === 'side') s.camera.position.set(x + 3.6, 1.0, z + 0.3)
  else s.camera.position.set(x - 0.6, 1.0, z + 4.0)
  if (s.controls) s.controls.target.set(x, 0.6, z + 0.3)
  s.camera.lookAt(x, 0.6, z + 0.3)
  s.camera.updateMatrixWorld()
}, view)
const files = { side: [], front: [] }
const info = []
for (let i = 0; i < ats.length; i++) {
  const at = ats[i]
  // sut zamani: katmanin kendi saati (kick animasyonu bittikten sonraki solma kuyrugu dahil)
  const ok = await p.waitForFunction((at) => { const k = window.__kickSt?.[-1]; return k && k.active && k.lastT >= at && k.lastT < 5 }, at, { timeout: 60000, polling: 20 }).then(() => true, () => false)
  if (!ok) break
  const st = await p.evaluate(() => {
    window.__shot.world.timeScale = 0
    return { t: window.__kickSt[-1].lastT, anim: window.__P.anim, ball: [window.__shot.world.ball.x, window.__shot.world.ball.z] }
  })
  info.push(st.t.toFixed(3) + (st.anim === 'kick' ? '' : ' ' + st.anim))
  for (const v of ['side', 'front']) {
    await cam(v)
    await p.waitForTimeout(700)
    await cam(v)
    await p.waitForTimeout(400)
    const f = `${pre}_${v}_${i}.png`
    await p.screenshot({ path: f })
    files[v].push(f)
  }
  await p.evaluate(() => { window.__shot.world.timeScale = 0.25 })
}
const kst = await p.evaluate(() => { const k = window.__kickSt?.[-1]; return k ? { pre: k.pre?.name, post: k.post?.name, mir: k.mir, vOut: k.vOut, px: k.px, pz: k.pz, ocx: k.ocx, ocz: k.ocz } : null })
for (const v of ['side', 'front']) {
  execFileSync('montage', [...files[v].map((f, i) => ['-label', `t=${info[i]}`, f]).flat(), '-tile', `${files[v].length}x`, '-geometry', '240x240+1+1', `${pre}_${v}.png`])
}
console.log('bitti', info.join(' '), JSON.stringify(kst), 'hata:', errs.length ? errs.slice(0, 3) : 'yok')
await b.close()
