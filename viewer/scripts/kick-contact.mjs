// Gercek mac sayfasinda sut temas olcumu: simulasyonun topu firlattigi an (touch/shoot olayi) ile vuran ayagin
// konumu arasindaki mesafe ve zaman farki. Her render karesinde kemik dunya konumlari kaydedilir (yavas cekim).
// Kullanim: scripts/run-browser.sh node scripts/kick-contact.mjs [clips=1|0] [json-cikti]
import { chromium } from 'playwright'
import fs from 'node:fs'
const clips = process.argv[2] ?? '1'
const outPath = process.argv[3]
const kv = process.argv[4]
const extra = process.argv[5] || ''
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 480, height: 300 } })
const errs = []
if (kv) await p.addInitScript((v) => { window.__kickVar = isNaN(Number(v)) ? v : Number(v) }, kv)
p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://127.0.0.1:5173/?mode=mac&clips=${clips}&blades=2000&boot=0&fx=0${extra}`, { timeout: 180000 })
await p.waitForTimeout(9000)
const res = await p.evaluate(async () => {
  const { game, setControlled } = window.__loco
  const world = window.__shot.world
  const set = window.__chars
  const P = game.players.find((q) => q.team === 0 && q.role !== 'kaleci' && q.id !== 0) || game.players[3]
  const idx = game.players.indexOf(P)
  const ch = set.chars[idx]
  setControlled(P.id)
  game.match.phase = 'play'
  game.match.restart = null
  if (globalThis.__kRules) globalThis.__kRules.mode = 'play'
  for (const q of game.players) if (q !== P) q.sentOff = true
  // girdi: klavye denetcisi her kare move'u yazar; testte okunan deger __ov'dan gelir (yazma yutulur)
  const OV = (window.__ov = { mx: 0, mz: 0, sp: false })
  const inp0 = game.inputs[P.id]
  inp0.move = { get x() { return OV.mx }, set x(v) {}, get z() { return OV.mz }, set z(v) {} }
  Object.defineProperty(inp0, 'sprint', { get() { return OV.sp }, set(v) {}, configurable: true })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const V = ch.root.position.constructor
  const fr = new V(), fb = new V(), fl = new V(), fbl = new V(), pel = new V()
  const SC = [
    { n: 'duran-orta', fx: 0, fz: 0.45, run: 0 },
    { n: 'duran-sag15', fx: -0.15, fz: 0.45, run: 0 },
    { n: 'duran-sol15', fx: 0.15, fz: 0.45, run: 0 },
    { n: 'duran-sol25', fx: 0.25, fz: 0.45, run: 0 },
    { n: 'duran-uzak70', fx: 0, fz: 0.7, run: 0 },
    { n: 'duran-yakin30', fx: 0, fz: 0.3, run: 0 },
    { n: 'kosu-surerek', fx: 0, fz: 0.45, run: 1 },
    { n: 'kosu-surerek-sprint', fx: 0, fz: 0.45, run: 2 },
  ]
  const out = []
  for (const sc of SC) {
    // diger oyunculari uzaklastir (topa gelmesinler): hepsini kenara koy
    game.match.phase = 'play'
    if (globalThis.__kRules) globalThis.__kRules.mode = 'play'
    P.x = 0; P.z = 0; P.vx = 0; P.vz = 0; P.facing = 0
    world.timeScale = 1
    const inp = game.inputs[P.id]
    inp.action = null; OV.mx = 0; OV.mz = 0; OV.sp = false
    let lx = sc.fx, lz = sc.fz
    if (sc.run) {
      world.placeBall(P.x, P.z + 0.4)
      await sleep(300)
      OV.mz = 1; OV.sp = sc.run === 2
      await sleep(2500)
    } else {
      world.placeBall(10, 10)
      await sleep(1500)
      P.hasBall = false
      world.placeBall(P.x + Math.sin(P.facing) * lz + Math.cos(P.facing) * lx, P.z + Math.cos(P.facing) * lz - Math.sin(P.facing) * lx)
    }
    world.timeScale = 0.35
    const rec = []
    let touch = null
    const off = game.on((e) => {
      if (e.type === 'touch' && e.player === P.id && (e.kind === 'shoot') && !touch) touch = { animT: P.animT, bx: world.ball.x, by: world.ball.y, bz: world.ball.z, px: P.x, pz: P.z, f: P.facing, has: P.hasBall }
    })
    let go = true
    const loop = () => {
      if (!go) return
      // HMR (baska ajanlarin degisiklikleri) karakter kumesini yenileyebilir: her karede guncel nesne
      const ch = window.__chars.chars[game.players.indexOf(P)]
      ch.rig.bone('foot_r').getWorldPosition(fr)
      ch.rig.bone('ball_r').getWorldPosition(fb)
      ch.rig.bone('foot_l').getWorldPosition(fl)
      ch.rig.bone('ball_l').getWorldPosition(fbl)
      ch.rig.bone('pelvis').getWorldPosition(pel)
      rec.push({ anim: P.anim, t: P.animT, fr: [fr.x, fr.y, fr.z], fb: [fb.x, fb.y, fb.z], fl: [fl.x, fl.y, fl.z], fbl: [fbl.x, fbl.y, fbl.z], pel: [pel.x, pel.y, pel.z], ball: [world.ball.x, world.ball.y, world.ball.z], cx: ch.x, cz: ch.z, cf: ch.f, v: Math.hypot(P.vx, P.vz) })
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
    const f = P.facing
    const vBefore = Math.hypot(P.vx, P.vz)
    const phase = game.match.phase
    const hadBall = P.hasBall
    inp.action = { type: 'shoot', power: sc.n.includes('sprint') ? 1 : 0.7, aim: { x: P.x + Math.sin(f) * 25, y: 1, z: P.z + Math.cos(f) * 25 } }
    const lock0 = P.actionLock
    const t1 = performance.now()
    while (performance.now() - t1 < 3000 && P.anim !== 'kick') await sleep(20)
    const started = P.anim === 'kick'
    while (performance.now() - t1 < 40000 && P.anim === 'kick' && P.animT < 0.8 && !(P.anim !== "kick" && P.animT > 0)) await sleep(30)
    go = false
    off && off()
    world.timeScale = 1
    OV.mx = 0; OV.mz = 0; OV.sp = false
    const ks = window.__kickSt?.[-1]
    out.push({ kst: ks ? { pre: ks.pre?.name, post: ks.post?.name, mir: ks.mir, vOut: +ks.vOut.toFixed(1), ocx: +ks.ocx.toFixed(2), ocz: +ks.ocz.toFixed(2), px: +ks.px.toFixed(2), pz: +ks.pz.toFixed(2) } : null, sc: sc.n, phase, lock0, started, endAnim: P.anim, nrec: rec.length, vBefore, hadBall, touch, rec: rec.filter((r) => r.anim === 'kick') })
    await sleep(800)
  }
  return { P: P.id, idx, out, layers: window.__layers }
})
// analiz
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (a) => Math.hypot(a[0], a[1], a[2])
const lerp = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k)
const BALL_R = 0.11
const rows = []
for (const s of res.out) {
  const r = s.rec
  const row = { kst: s.kst, sc: s.sc, phase: s.phase, lock0: s.lock0, started: s.started, endAnim: s.endAnim, nrec: s.nrec, vBefore: +s.vBefore.toFixed(2), hadBall: s.hadBall, frames: r.length, touch: !!s.touch }
  if (s.touch && r.length > 2) {
    const tc = s.touch.animT
    const B = [s.touch.bx, s.touch.by, s.touch.bz]
    // temas anindaki ayak: animT'ye gore iki kare arasi
    let k = r.findIndex((x) => x.t >= tc)
    if (k <= 0) k = 1
    const a = r[k - 1], c = r[k]
    const u = c.t > a.t ? Math.min(1, Math.max(0, (tc - a.t) / (c.t - a.t))) : 0
    const M = s.kst?.mir
    const KF = (x) => (M ? x.fl : x.fr), KB = (x) => (M ? x.fbl : x.fb), SF = (x) => (M ? x.fr : x.fl)
    const instep = (x) => lerp(KF(x), KB(x), 0.5)
    const iC = lerp(instep(a), instep(c), u)
    row.contactInstepToBallSurf_cm = +((len(sub(iC, B)) - BALL_R) * 100).toFixed(1)
    row.contactAnkleToBallCtr_cm = +(len(sub(lerp(KF(a), KF(c), u), B)) * 100).toFixed(1)
    // karakter uzayinda top ve ayak (x sol, z ileri) temas aninda
    const cx = a.cx + (c.cx - a.cx) * u, cz = a.cz + (c.cz - a.cz) * u, cf = a.cf
    const L = (w) => { const dx = w[0] - cx, dz = w[2] - cz; return [+(dx * Math.cos(cf) - dz * Math.sin(cf)).toFixed(3), +w[1].toFixed(3), +(dx * Math.sin(cf) + dz * Math.cos(cf)).toFixed(3)] }
    row.ballLocal = L(B)
    row.instepLocal = L(iC)
    // en yakin an: top temas konumuna instep mesafesi en kucuk kare
    let best = 1e9, bt = 0
    for (const x of r) { const d = len(sub(instep(x), B)); if (d < best) { best = d; bt = x.t } }
    row.minInstepSurf_cm = +((best - BALL_R) * 100).toFixed(1)
    row.minAt_ms_rel_contact = Math.round((bt - tc) * 1000)
    // destek (sol) ayak kaymasi: temas -0.1..+0.15 s arasi, ayak yerdeyken (y < 0.14) yatay yer degisimi
    const sup = r.filter((x) => x.t > tc - 0.12 && x.t < tc + 0.15 && SF(x)[1] < 0.14)
    if (sup.length > 1) row.supportSlide_cm = +(Math.hypot(SF(sup[sup.length - 1])[0] - SF(sup[0])[0], SF(sup[sup.length - 1])[2] - SF(sup[0])[2]) * 100).toFixed(1)
    // destek ayagi: yerdeyken (y<0.14) kare kare yatay yer degisiminin toplami (tum sut)
    let slide = 0
    for (let i = 1; i < r.length; i++) if (SF(r[i])[1] < 0.14 && SF(r[i - 1])[1] < 0.14) slide += Math.hypot(SF(r[i])[0] - SF(r[i - 1])[0], SF(r[i])[2] - SF(r[i - 1])[2])
    row.supportGroundPath_cm = +(slide * 100).toFixed(1)
    // basili destek ayagi kaymasi: bilek yuksekligi en alt degerin 2 cm icindeyken (gercek basma), temas -0.15..+0.2 s
    const ymin = Math.min(...r.map((x) => SF(x)[1]))
    let st = 0, stMax = 0
    for (let i = 1; i < r.length; i++) {
      const a0 = SF(r[i - 1]), a1 = SF(r[i])
      if (r[i].t > tc - 0.15 && r[i].t < tc + 0.2 && a0[1] < ymin + 0.02 && a1[1] < ymin + 0.02) { st += Math.hypot(a1[0] - a0[0], a1[2] - a0[2]); stMax = Math.max(stMax, st) } else st = 0
    }
    row.plantedSlide_cm = +(stMax * 100).toFixed(1)
    row.supportMinY = +Math.min(...r.map((x) => SF(x)[1])).toFixed(3)
    row.pelvisYmin = +Math.min(...r.map((x) => x.pel[1])).toFixed(3)
    row.footMinY = +Math.min(...r.map((x) => Math.min(x.fr[1], x.fl[1]))).toFixed(3)
  }
  rows.push(row)
}
console.log(JSON.stringify(rows, null, 0).replace(/\},\{/g, '},\n{'))
console.log('katman', JSON.stringify(res.layers?.kick), 'hata:', errs.length ? errs.slice(0, 3) : 'yok')
if (outPath) fs.writeFileSync(outPath, JSON.stringify(res))
await b.close()
