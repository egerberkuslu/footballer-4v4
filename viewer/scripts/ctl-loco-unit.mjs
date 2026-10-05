// F: locomotion birim senaryolari (Node, render yok): ilk dokunus, omuz omuza, koruma, kaleci tutma/yumruk/atis, duran top surme
// Kullanim: npx -y tsx scripts/ctl-loco-unit.mjs
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { stepLocomotion, setControlled } from '../src/control/locomotion.ts'

const DT = 1 / 60
const ev = []
game.on((e) => ev.push(e))
const step = (n, fn) => { for (let i = 0; i < n; i++) { fn && fn(i); stepLocomotion(DT); world.step(DT) } }
const P = game.players
const reset = () => {
  for (const q of P) { Object.assign(q, { x: -15 - q.id * 1.5, z: 11, vx: 0, vz: 0, hasBall: false, actionLock: 0, anim: 'idle', stamina: 1 }); game.inputs[q.id] = { move: { x: 0, z: 0 }, sprint: false, action: null } }
  world.placeBall(0, 0)
  ev.length = 0
}
game.match.phase = 'play'
setControlled(-1)
const out = {}

// 1) ilk dokunus: 10 m'den 9 m/s pas gelen oyuncu
reset()
const R = P[2]; Object.assign(R, { x: 5, z: 0, facing: -Math.PI / 2 })
world.placeBall(-5, 0); world.kick({ x: 9, y: 0, z: 0 }, { x: 0, y: 0, z: -9 / 0.11 })
const anims = new Set(); let got = -1
step(120, (i) => { anims.add(R.anim); if (got < 0 && R.hasBall) got = i })
out.trapGround = { gotFrame: got, anims: [...anims].filter((a) => a.startsWith('trap')), ballDist: +Math.hypot(world.ball.x - R.x, world.ball.z - R.z).toFixed(2) }
// gogus: havadan gelen top
reset(); Object.assign(R, { x: 5, z: 0, facing: -Math.PI / 2 })
world.placeBall(2, 0); world.ball.y = 1.3; world.kick({ x: 6, y: 2.4, z: 0 }, { x: 0, y: 0, z: 0 })
anims.clear(); got = -1
step(120, (i) => { anims.add(R.anim); if (got < 0 && R.hasBall) got = i })
out.trapHigh = { gotFrame: got, anims: [...anims].filter((a) => a.startsWith('trap')) }
// kotu dokunus orani: hizli (12 m/s) arkadan gelen top, 30 deneme
let bad = 0
for (let k = 0; k < 30; k++) {
  reset(); Object.assign(R, { x: 5, z: 0, facing: Math.PI / 2, stamina: 0.4 })
  world.placeBall(-3, 0); world.kick({ x: 12, y: 0, z: 0 }, { x: 0, y: 0, z: -12 / 0.11 })
  step(60)
  if (!R.hasBall) bad++
}
out.badTouchHardBall = `${bad}/30`

// 2) omuz omuza: iki rakip paralel kosar, top onlerinde
reset()
const A = P[3], B = P[5]
Object.assign(A, { x: 0, z: 0, facing: Math.PI / 2, vx: 6, vz: 0 }); Object.assign(B, { x: 0, z: 0.7, facing: Math.PI / 2, vx: 5.5, vz: 0, stamina: 0.5 })
world.placeBall(6, 0.3)
step(50, () => { game.inputs[A.id].move = { x: 1, z: 0.1 }; game.inputs[B.id].move = { x: 1, z: -0.15 } })
out.shoulder = { contacts: ev.filter((e) => e.type === 'contact').map((e) => e.kind + ' i=' + e.intensity.toFixed(2)), anims: [A.anim, B.anim] }
// omuz senaryolari: [ad, A konum/hiz, B konum/hiz, A girdisi, B girdisi, sprint]
const sh = []
for (const [name, a, c, ma, mc, spr] of [
  ['paralel-normal', [0, 0, 5.5, 0.4], [0, 0.72, 5.5, 0], { x: 1, z: 0.08 }, { x: 1, z: 0 }, false],
  ['sprint-sert', [0, 0, 7.8, 2.6], [0, 0.75, 7.6, 0], { x: 1, z: 0.45 }, { x: 1, z: 0 }, true],
  ['arkadan', [-0.55, 0.3, 7.5, 1.5], [0, 0.62, 6, 0], { x: 1, z: 0.25 }, { x: 1, z: 0 }, true],
]) {
  reset()
  step(60) // omuz temasi yayma araligi (0.8 s) dolsun
  ev.length = 0
  Object.assign(A, { x: a[0], z: a[1], vx: a[2], vz: a[3], facing: Math.atan2(a[2], a[3]) })
  Object.assign(B, { x: c[0], z: c[1], vx: c[2], vz: c[3], facing: Math.atan2(c[2], c[3]) })
  world.placeBall(2.5, 0.4)
  step(20, () => { game.inputs[A.id].move = ma; game.inputs[A.id].sprint = spr; game.inputs[B.id].move = mc; game.inputs[B.id].sprint = spr })
  const c0 = ev.find((e) => e.type === 'contact')
  sh.push(c0 ? `${name}: ${c0.kind} a=${c0.a} i=${c0.intensity.toFixed(2)} arkadan=${c0.fromBehind}` : `${name}: temas yok`)
}
out.shoulderCases = sh

// 3) koruma: topa sahip yavas oyuncu, arkasinda rakip
reset()
Object.assign(A, { x: 0, z: 0, facing: Math.PI / 2 }); world.placeBall(0.45, 0); step(3)
Object.assign(B, { x: 1.4, z: 0.2 })
step(40, () => { game.inputs[B.id].move = { x: -1, z: 0 } })
out.shield = { anim: A.anim, hasBall: A.hasBall, facingDeg: Math.round((A.facing * 180) / Math.PI) }

// 4) kaleci: deplasman kalecisi +x kalesinde (attackDir[1] = -1 -> kendi kalesi +x)
const K = P.find((q) => q.team === 1 && q.role === 'kaleci')
const kres = []
for (const [sp, y, z, name] of [[14, 1.0, 0.3, 'yavas-orta'], [24, 1.6, 0.5, 'sert-yuksek'], [12, 0.15, -0.4, 'yerden']]) {
  reset(); Object.assign(K, { x: 19, z: 0, facing: -Math.PI / 2 })
  world.placeBall(11, z); world.ball.y = y
  world.kick({ x: sp, y: 0.6, z: 0 }, { x: 0, y: 0, z: 0 })
  const ka = new Set()
  step(60, () => ka.add(K.anim))
  kres.push(`${name}: elde=${K.hasBall} anim=${[...ka].filter((a) => a.startsWith('keeper')).join('/')}`)
}
out.keeper = kres
// kaleci atisi
reset(); Object.assign(K, { x: 19, z: 0, facing: -Math.PI / 2 }); world.placeBall(17, 0); world.ball.y = 1; world.kick({ x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
step(30)
const held = K.hasBall
game.inputs[K.id].action = { type: 'pass', power: 0, aim: { x: 8, y: 0, z: 5 } }
const ta = new Set(); step(60, () => ta.add(K.anim))
out.keeperThrow = { heldBefore: held, anims: [...ta].filter((a) => a.startsWith('keeper')), ballSpeed: +Math.hypot(world.ball.vx, world.ball.vz).toFixed(1) }
// dalis animasyonu
reset(); Object.assign(K, { x: 19.5, z: 0, facing: -Math.PI / 2 })
game.inputs[K.id].action = { type: 'dive', power: 0, aim: { x: 19.5, y: 1.7, z: 2 } }
step(2)
out.diveAnim = K.anim
const z0 = 0, prof = []
for (let i = 0; i < 8; i++) { step(6); prof.push(+K.z.toFixed(2)) }
out.diveZ_every0_1s = prof

// 5) duran top: yalniz kullanan topu surebilir
reset(); game.match.phase = 'kickoff'; game.match.restart = { type: 'kickoff', team: 0, x: 0, z: 0, taker: A.id }
Object.assign(A, { x: -0.8, z: 0, facing: Math.PI / 2 }); Object.assign(B, { x: 0.8, z: 0.3 })
step(60, () => { game.inputs[A.id].move = { x: 1, z: 0 }; game.inputs[B.id].move = { x: -1, z: 0 } })
out.restartDribble = { takerTouches: ev.filter((e) => e.type === 'touch' && e.player === A.id).map((e) => e.kind), otherHas: B.hasBall }
console.log(JSON.stringify(out, null, 1))
