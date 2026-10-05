// F: locomotion testi (tek kisa SwiftShader oturumu; adimlar elle, gercek world.step)
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 480, height: 300 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/?blades=1000', { timeout: 180000 })
await p.waitForTimeout(5000)
const r = await p.evaluate(() => {
  const S = window.__shot, L = window.__loco
  const { world } = S
  const { game, stepLocomotion, setControlled, ctl } = L
  const out = {}
  const step = (n, fn) => { for (let i = 0; i < n; i++) { fn && fn(i); stepLocomotion(1/60); world.timeScale = 1; world.step(1/60); world.timeScale = 0 } }
  world.timeScale = 0
  // 1) antrenman: uzak noktadan sut
  S.placeSpot(6, 5)
  out.side = world.side
  const g0 = world.goals
  S.testKick(1.0, -1.2, 28)
  step(120)
  out.farGoal = world.goals - g0
  S.placeSpot(-4, -3)
  out.sideNeg = world.side
  // 2) mac
  window.__shot.ctl.mode = 'mac'
  for (const q of game.players) { q.x = -30 - q.id; q.z = 10; q.vx = q.vz = 0; q.hasBall = false; q.actionLock = 0 }
  const P = game.players[3], M = game.players[2], K1 = game.players[4], D1 = game.players[5]
  P.x = 0; P.z = 0; P.facing = Math.PI / 2
  world.placeBall(1.5, 0)
  setControlled(P.id)
  const inp = game.inputs
  // topa kos + sur (+x yonunde 3 s)
  let lead = [], owned = 0
  step(180, (i) => { inp[P.id].move = { x: 1, z: 0 }; inp[P.id].sprint = i > 90; if (P.hasBall) { owned++; lead.push(Math.hypot(world.ball.x - P.x, world.ball.z - P.z)) } })
  out.dribble = { ownedFrac: +(owned/180).toFixed(2), leadMin: +Math.min(...lead).toFixed(2), leadMax: +Math.max(...lead).toFixed(2), px: +P.x.toFixed(1), speed: +Math.hypot(P.vx,P.vz).toFixed(2), stamina: +P.stamina.toFixed(2) }
  // sert donus: geri
  step(40, () => { inp[P.id].move = { x: -1, z: 0.2 }; inp[P.id].sprint = false })
  out.afterTurnHasBall = P.hasBall
  // pas: arkadas 10 m yanda
  step(60, () => { inp[P.id].move = { x: 0, z: 0 } })
  if (!P.hasBall) { world.placeBall(P.x + Math.sin(P.facing)*0.45, P.z + Math.cos(P.facing)*0.45); step(5) }
  M.x = P.x + 2; M.z = P.z + 10; M.vx = M.vz = 0
  inp[P.id].action = { type: 'pass', power: 0, aim: { x: M.x, y: 0, z: M.z } }
  let recv = -1
  step(150, (i) => { inp[P.id].move = { x: 0, z: 0 }; if (recv < 0 && M.hasBall) recv = i })
  out.pass = { receivedAtFrame: recv, dist: +Math.hypot(world.ball.x - M.x, world.ball.z - M.z).toFixed(2) }
  // mudahale: rakip D1 M'nin onunden topa
  D1.x = M.x + 1.0; D1.z = M.z + 0.3; D1.facing = Math.atan2(world.ball.x - D1.x, world.ball.z - D1.z)
  const evs = []
  const un = game.on((e) => { if (e.type === 'contact' || e.type === 'touch') evs.push(e.type + ':' + (e.kind ?? '') + ':' + (e.player ?? e.a)) })
  inp[D1.id].action = { type: 'tackle', power: 0, aim: { x: world.ball.x, y: 0, z: world.ball.z } }
  step(60)
  out.tackle = { evs: evs.slice(0, 6), owner: game.players.find(q => q.hasBall)?.id ?? null }
  // sut: 12 m'den
  for (const q of game.players) q.hasBall = false
  P.x = 8; P.z = 1; P.facing = Math.PI/2; P.vx = P.vz = 0; P.actionLock = 0
  world.placeBall(8.45, 1); step(3)
  out.shooterHas = P.hasBall
  const g1 = world.goals
  inp[P.id].action = { type: 'shoot', power: 0.75, aim: { x: 20, y: 1.2, z: -1.5 } }
  step(150, () => { inp[P.id].move = { x: 0, z: 0 } })
  out.shotGoal = world.goals - g1
  // kaleci tutar: K1 (deplasman kalecisi) +x kalesinde mi?
  const keeper = game.players.find(q => q.team === 1 && q.role === 'kaleci')
  keeper.x = 19.2; keeper.z = 0; keeper.facing = -Math.PI/2; keeper.actionLock = 0
  for (const q of game.players) q.hasBall = false
  world.placeBall(12, 0); step(2)
  world.kick({ x: 12, y: 2.5, z: 0 }, { x: 0, y: 0, z: 0 })
  step(90)
  out.keeperHas = keeper.hasBall
  // kaleci firlatir (pas)
  inp[keeper.id].action = { type: 'pass', power: 0, aim: { x: 5, y: 0, z: 4 } }
  step(60)
  out.keeperReleased = !keeper.hasBall && Math.hypot(world.ball.vx, world.ball.vz) > 0.5
  un()
  // kayarak mudahale + temas
  for (const q of game.players) { q.hasBall = false; q.actionLock = 0 }
  P.x = 0; P.z = -5; P.vx = P.vz = 0; P.facing = Math.PI/2
  world.placeBall(0.45, -5); step(3)
  D1.x = 3.5; D1.z = -5; D1.actionLock = 0; D1.facing = -Math.PI/2
  evs.length = 0
  const un2 = game.on((e) => { if (e.type === 'contact') evs.push(e.kind + ' bf=' + e.ballFirst + ' i=' + e.intensity.toFixed(2)) })
  inp[D1.id].action = { type: 'slide', power: 0, aim: { x: 0, y: 0, z: -5 } }
  step(80)
  un2()
  out.slide = { evs, pFell: P.anim }
  world.timeScale = 1
  ctl.mode = 'antrenman'
  return out
})
console.log(JSON.stringify(r, null, 1))
console.log(errs.join('\n') || 'pageerror yok')
await b.close()
