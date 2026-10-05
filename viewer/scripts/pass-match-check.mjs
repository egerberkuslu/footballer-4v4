// Gercek mac sayfasi: pas / kafa / ilk dokunus tetikle, kare kare olc.
// Olcumler (her deneme): katman sayaci, simulasyon temas ani (top hizinin sicradigi kare, animT), o karede
// sag ayak bilegi/parmak (pas) ya da kafa (kafa) ile top merkezi uzakligi, ayak-top en yakin anin temas anina farki (ms),
// destek (sol) ayak yerdeyken yatay kayma (cm), en alcak ayak bilegi yuksekligi (zemin penetrasyonu).
// Kullanim: scripts/run-browser.sh node scripts/pass-match-check.mjs [pass|header|trap] [deneme] [clips=1]
import { chromium } from 'playwright'
const kind = process.argv[2] || 'pass'
const N = Number(process.argv[3] || 4)
const clips = process.argv[4] ?? '1'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 640, height: 400 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://127.0.0.1:5173/?mode=mac&clips=${clips}`, { timeout: 180000 })
await p.waitForTimeout(9000)
const r = await p.evaluate(async ({ kind, N }) => {
  const L = window.__loco, S = window.__shot
  if (!L || !S) return { yok: 'debug globals yok' }
  const { game, setControlled } = L
  const world = S.world
  const TS = Number(window.__ts ?? 1) // kare basina oyun zamani zaten 1/30 s ile sinirli: yavas makinede kare cozunurlugu ~33 ms
  world.timeScale = 1
  const P = game.players.find((q) => q.team === 0 && q.role !== 'kaleci' && q.id !== 0) || game.players[3]
  const mate = game.players.find((q) => q.team === 0 && q.id !== P.id && q.role !== 'kaleci')
  setControlled(P.id)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const raf = () => new Promise((r) => requestAnimationFrame(r))
  const ch = () => window.__chars.chars[game.players.indexOf(P)]
  const V = () => new (ch().root.position.constructor)()
  const wp = (nm) => { const bn = ch().rig.bone(nm); const v = V(); bn.updateWorldMatrix(true, false); return bn.getWorldPosition(v) }
  const trials = []
  for (let n = 0; n < N; n++) {
    const fx = Math.sin(P.facing), fz = Math.cos(P.facing)
    const want = kind === 'trap' ? 'trap' : kind
    if (kind === 'pass') {
      world.placeBall(P.x + fx * 0.45, P.z + fz * 0.45)
      await sleep(700)
      game.inputs[P.id].action = { type: 'pass', power: 0, aim: { x: mate.x, y: 0, z: mate.z } }
    } else if (kind === 'header') {
      P.hasBall = false
      world.placeBall(P.x + fx * 0.45, P.z + fz * 0.45)
      const bb = world.ball
      bb.y = bb.py = 2.5 + (n % 3) * 0.15
      world.kick({ x: 0, y: 0.6, z: 0 }, { x: 0, y: 0, z: 0 })
      await raf()
      game.inputs[P.id].action = { type: 'header', power: 0.6, aim: { x: mate.x, y: 1, z: mate.z } }
    } else {
      P.hasBall = false
      const d = 3.5
      world.placeBall(P.x + fx * d, P.z + fz * d)
      const vy = n % 3 === 0 ? 0 : n % 3 === 1 ? 3.2 : 4.6 // yerden / dizden / gogusten
      world.kick({ x: -fx * 4.5, y: vy * 0.8, z: -fz * 4.5 }, { x: 0, y: 0, z: 0 })
    }
    world.timeScale = TS // agir cekim: kare cozunurlugu (oyun zamani) artsin
    const s = []
    const t0 = performance.now()
    let prevV = Math.hypot(world.ball.vx, world.ball.vz, world.ball.vy)
    for (let fi = 0; fi < 60; fi++) {
      await raf()
      game.inputs[P.id].action = null
      const bb = world.ball
      const v = Math.hypot(bb.vx, bb.vy, bb.vz)
      const fr = wp('foot_r'), tr = wp('ball_r'), fl = wp('foot_l'), hd = wp('head')
      s.push({ anim: P.anim, at: P.animT, bx: bb.x, by: bb.y, bz: bb.z, v, dv: v - prevV, fr: [fr.x, fr.y, fr.z], tr: [tr.x, tr.y, tr.z], fl: [fl.x, fl.y, fl.z], hd: [hd.x, hd.y, hd.z], has: P.hasBall })
      prevV = v
    }
    // olcum
    const act = s.filter((q) => (want === 'trap' ? q.anim.startsWith('trap-') : q.anim === want))
    const out = { n, anims: [...new Set(s.map((q) => q.anim))].join(','), frames: act.length }
    if (act.length) {
      const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
      const ball = (q) => [q.bx, q.by, q.bz]
      // temas: aksiyon icinde topun hiz degisiminin en buyuk oldugu kare
      // ilk dokunus: sim temasi animasyonun basinda (ilk kare)
      const ci = kind === 'trap' ? 0 : act.reduce((bi, q, i) => (Math.abs(q.dv) > Math.abs(act[bi].dv) ? i : bi), 0)
      const c = act[ci]
      out.contactAnimT = +c.at.toFixed(3)
      out.dv = +c.dv.toFixed(2)
      const part = kind === 'header' ? 'hd' : 'tr'
      const ref = kind === 'header' ? 'hd' : 'fr'
      // temas karesinden bir onceki kare (top henuz ayrilmadi)
      const cp = act[Math.max(0, ci - 1)]
      // temas karesindeki uzuv, bir onceki karedeki (vurulmamis) top: sim temasi bu kareler arasinda oldu
      out.distAtContact_cm = Math.round(Math.min(d3(c[part], ball(cp)), d3(c[ref], ball(cp))) * 100)
      if (kind === 'trap') out.trapSeq_cm = act.slice(0, 7).map((q) => `${q.at.toFixed(2)}:${Math.round(Math.min(d3(q.tr, ball(q)), d3(q.fr, ball(q))) * 100)}`).join(' ')
      out.distSeq_cm = act.slice(Math.max(0, ci - 4), ci + 2).map((q) => `${q.at.toFixed(2)}:${Math.round(Math.min(d3(q[part], ball(cp)), d3(q[ref], ball(cp))) * 100)}`).join(' ')
      let best = 0
      for (let i = 0; i < act.length; i++) if (act[i].at <= c.at + 0.001 && Math.min(d3(act[i][part], ball(act[i])), d3(act[i][ref], ball(act[i]))) < Math.min(d3(act[best][part], ball(act[best])), d3(act[best][ref], ball(act[best])))) best = i
      out.closestBeforeContact_ms = Math.round((act[best].at - c.at) * 1000)
      out.closestDist_cm = Math.round(Math.min(d3(act[best][part], ball(act[best])), d3(act[best][ref], ball(act[best]))) * 100)
      out.minAnkleY_cm = Math.round(Math.min(...act.map((q) => Math.min(q.fl[1], q.fr[1]))) * 100)
      out.headAtContactY = +cp.hd[1].toFixed(2)
      out.ballAtContactY = +cp.by.toFixed(2)
      // destek ayagi kaymasi: sol bilek yerde (<0.13 m) iken yatay yol (karakter de hareket ediyorsa oyuncu hizi dahil)
      let slide = 0
      for (let i = 1; i < act.length; i++) if (act[i].fl[1] < 0.13 && act[i - 1].fl[1] < 0.13) slide += Math.hypot(act[i].fl[0] - act[i - 1].fl[0], act[i].fl[2] - act[i - 1].fl[2])
      out.supportSlide_cm = Math.round(slide * 100)
    }
    world.timeScale = 1
    if (n === 0) out.seq = s.filter((_, i) => i % 3 === 0).slice(0, 40).map((q) => `${q.anim}@${q.at.toFixed(2)} v${q.v.toFixed(1)} b${q.bx.toFixed(2)},${q.bz.toFixed(2)} h${q.has ? 1 : 0}`)
    trials.push(out)
    await sleep(600)
  }
  return { P: P.id, trials, layers: window.__layers }
}, { kind, N })
console.log(JSON.stringify(r, null, 0))
console.log('hata:', errs.length ? errs.slice(0, 3) : 'yok')
await b.close()
