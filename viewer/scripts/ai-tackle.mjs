// AI ayakta/kayarak mudahale olcumu (AI-AI): deneme, topu alma, faul. npx -y tsx scripts/ai-tackle.mjs [mac=4] [seviye=orta] [devre_sn=60]
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { Rules } from '../src/rules/engine.ts'
import { updateAI, resetAI, aiStats } from '../src/ai/brain.ts'
import { seedAI, setAiLevel } from '../src/ai/config.ts'
import { stepLocomotion } from '../src/control/locomotion.ts'

const N = Number(process.argv[2] ?? 4)
const LEVEL = process.argv[3] ?? 'orta'
const HALF = Number(process.argv[4] ?? 60)
const DT = 1 / 60
const B = [[0, 0], [0, 0], [0, 0]]
const S = [[0, 0], [0, 0], [0, 0]]
const R = { touch: 0, att: 0, win: 0, foulT: 0, slide: 0, foul: 0, yellow: 0, red: 0, sec: 0, goals: 0 }
for (let seed = 1; seed <= N; seed++) {
  let s = seed
  Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  seedAI(seed); setAiLevel(LEVEL); world.seed(seed); resetAI()
  game.humanTeam = null
  for (const p of game.players) p.controlled = false
  const rules = new Rules({ game, ball: () => world.ball, placeBall: (x, z) => world.placeBall(x, z), kick: (v, w) => world.kick(v, w), halfLength: HALF })
  rules.start?.()
  let t = 0
  const a0 = aiStats.tackles
  const s0 = aiStats.slides
  const pend = []
  const touches = []
  const un = game.on((e) => {
    if (e.type === 'touch' && e.kind === 'tackle') (R.touch++, touches.push({ p: e.player, t }), pend.push({ p: e.player, t }))
    if (e.type === 'foul') { R.foul++; if (pend.some((q) => q.p === e.by && t - q.t < 1.2)) R.foulT++ }
    if (e.type === 'card') e.color === 'yellow' ? R.yellow++ : R.red++
    if (e.type === 'goal') R.goals++
  })
  for (let f = 0; f < 60 * (HALF * 2 * 2.5 + 60) && game.match.phase !== 'fulltime'; f++) {
    t += DT
    updateAI(DT); rules.pre(DT); stepLocomotion(DT)
    world.side = world.ball.x >= 0 ? 1 : -1
    world.step(DT); rules.post(DT)
    while (pend.length && t - pend[0].t > 0.7) {
      const q = pend.shift()
      if (game.players[q.p].hasBall) R.win++
    }
  }
  un()
  for (const a of aiStats.tkLog) {
    const b = a.bd < 0.6 ? 0 : a.bd < 0.9 ? 1 : 2
    const hit = touches.some((q) => q.p === a.id && q.t >= a.t && q.t - a.t < 0.8)
    B[b][0]++
    if (hit) B[b][1]++
    const sp = a.sp < 2 ? 0 : a.sp < 4 ? 1 : 2
    S[sp][0]++
    if (hit) S[sp][1]++
  }
  aiStats.tkLog.length = 0
  R.att += aiStats.tackles - a0
  R.slide += aiStats.slides - s0
  R.sec += HALF * 2
}
const per = (x) => ((x * 240) / R.sec / 2).toFixed(1) // takim basina / 120 s
console.log(`seviye ${LEVEL}: ${N} mac x 2x${HALF}s; ayakta deneme/takim/120s ${per(R.att)}, kayma/mac ${(R.slide / N).toFixed(1)}, topa dokunus ${R.touch}, topu alan ${R.win} (deneme ${R.att}), faul/mac ${(R.foul / N).toFixed(1)} (mudahale faulu ${R.foulT}), sari/mac ${(R.yellow / N).toFixed(1)}, kirmizi/mac ${(R.red / N).toFixed(2)}, gol/mac ${(R.goals / N).toFixed(1)}`)
console.log('  tahmini top mesafesi <0.6/0.6-0.9/>0.9: temas', B.map((x) => x[1] + '/' + x[0]).join('  '), '| tasiyici hizi <2/2-4/>4:', S.map((x) => x[1] + '/' + x[0]).join('  '))
