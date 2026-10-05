// Insan-benzeri sut dagilimi vs AI kaleci: dalis orani, menzilde orani, kurtarma. npx -y tsx scripts/human-shot-dive.mjs [N=300] [seviye=orta]
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { updateAI, resetAI } from '../src/ai/brain.ts'
import { seedAI, setAiLevel } from '../src/ai/config.ts'
import { stepLocomotion } from '../src/control/locomotion.ts'
import { CURL_W } from '../src/control/aim.ts'
import { V_MIN, V_MAX } from '../src/control/store.ts'
import { diveStats } from '../src/sim/keeperDive.ts'
import { PITCH_L } from '../src/pitch.ts'

const N = Number(process.argv[2] ?? 300)
const LEVEL = process.argv[3] ?? 'orta'
let s = 7
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
Math.random = rnd
seedAI(1); setAiLevel(LEVEL); world.seed(1); resetAI()
game.humanTeam = null
for (const p of game.players) p.controlled = false
game.match.phase = 'play'
const DT = 1 / 60
const K = game.players.find((q) => q.role === 'kaleci' && -game.match.attackDir[q.team] * PITCH_L / 2 > 0)
const S = game.players.find((q) => q.team !== K.team && q.role !== 'kaleci')
const HL = PITCH_L / 2
let goals = 0, saves = 0, other = 0, dives = 0, reach = 0, diveSaves = 0, diveGoals = 0, curled = 0
let shotAct = null
const step = (n) => {
  for (let i = 0; i < n; i++) {
    updateAI(DT)
    // kaleci disindaki herkes pasif; yalniz sutcu verilen aksiyonu uygular
    for (const q of game.players) if (q.role !== 'kaleci') game.inputs[q.id] = { move: { x: 0, z: 0 }, sprint: false, action: q.id === S.id ? shotAct : null }
    shotAct = null
    stepLocomotion(DT)
    world.side = 1
    world.step(DT)
    game.match.phase = 'play'
  }
}
let ev = []
game.on((e) => ev.push(e))
for (let i = 0; i < N; i++) {
  // sifirla: oyuncular uzakta, kaleci evde, top sutcuda
  for (const q of game.players) { Object.assign(q, { x: -12 - q.id * 0.7, z: 11, vx: 0, vz: 0, hasBall: false, actionLock: 0, anim: 'idle', stamina: 1 }); game.inputs[q.id] = { move: { x: 0, z: 0 }, sprint: false, action: null } }
  world.holdBall(false)
  const d = 14 + rnd() * 11
  const V = 15 + rnd() * 13
  const tz = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 1.8)
  const ty = 0.3 + rnd() * 1.6
  const curl = rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 3)) : 0
  const oz = (rnd() * 2 - 1) * 4
  Object.assign(K, { x: HL - 0.6, z: 0, vx: 0, vz: 0, facing: -Math.PI / 2, hasBall: false })
  world.placeBall(HL - d, oz)
  Object.assign(S, { x: HL - d - 0.5, z: oz, facing: Math.PI / 2, controlled: true }) // insan sutu
  step(20) // kaleci yerine otursun, kural durumu otursun
  ev = []
  const d0 = diveStats.n, r0 = diveStats.reach
  const g0 = world.goals
  shotAct = { type: 'shoot', power: Math.min(1, Math.max(0, (V - V_MIN) / (V_MAX - V_MIN))), aim: { x: HL, y: ty, z: tz }, spin: { x: 0, y: (-curl / 3) * CURL_W, z: 0 } }
  step(150)
  const goal = world.goals > g0
  const save = ev.some((e) => e.type === 'touch' && e.kind === 'save')
  const dived = diveStats.n > d0
  if (curl) curled++
  if (dived) { dives++; if (diveStats.reach > r0) reach++ }
  if (goal) { goals++; if (dived) diveGoals++ } else if (save) { saves++; if (dived) diveSaves++ } else other++
  if (process.env.DBG && i < 14) console.log(i, 'd', d.toFixed(1), 'V', V.toFixed(1), 'tz', tz.toFixed(1), 'ty', ty.toFixed(1), 'curl', curl, '->', goal ? 'GOL' : save ? 'KURT' : 'diger', 'top', world.ball.x.toFixed(1), world.ball.y.toFixed(2), world.ball.z.toFixed(1), 'ev', [...new Set(ev.map((e) => e.type + (e.kind ? ':' + e.kind : '')))].join(','), 'phase', game.match.phase)
  step(150) // kalkis/durulma
}
const on = N
console.log(`insan-benzeri ${N} sut (seviye ${LEVEL}, %${Math.round((100 * curled) / N)} falsolu): gol ${goals}, kurtaris ${saves}, diger ${other}`)
console.log(`kurtarma gol/sut %${(100 * (1 - goals / on)).toFixed(1)} | kurtaris/(gol+kurtaris) %${(100 * saves / Math.max(1, goals + saves)).toFixed(1)}`)
console.log(`dalis ${dives} (%${(100 * dives / on).toFixed(1)} ), menzilde ${reach}/${dives}, dalisli kurtaris ${diveSaves}, dalisli gol ${diveGoals}`)
