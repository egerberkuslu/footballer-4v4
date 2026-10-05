// Zorlanmis endirekt serbest vurus testi: rakip ceza sahasi kenarinda (kale cizgisine 8-18 m), AI kullanir.
// Her tohumda ilk dokunusun pas/asirtma oldugunu ve baska oyuncu degmeden gol sayilmadigini dogrular.
// npx -y tsx scripts/ai-indirect.mjs [n=20]
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { PITCH_L } from '../src/pitch.ts'
import { Rules } from '../src/rules/engine.ts'
import { updateAI, resetAI, aiStats, aiDebug } from '../src/ai/brain.ts'
import { seedAI, setAiLevel } from '../src/ai/config.ts'
import { stepLocomotion } from '../src/control/locomotion.ts'

const N = Number(process.argv[2] ?? 20)
const HL = PITCH_L / 2
const DT = 1 / 60
let pass = 0
let direct = 0
let golYok = 0
let goal = 0
let none = 0
for (let seed = 1; seed <= N; seed++) {
  let s = seed
  Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  seedAI(seed)
  setAiLevel('orta')
  world.seed(seed)
  resetAI()
  game.humanTeam = null
  for (const p of game.players) p.controlled = false
  const rules = new Rules({ game, ball: () => world.ball, placeBall: (x, z) => world.placeBall(x, z), kick: (v, w) => world.kick(v, w), halfLength: 150 })
  const sy = rules.say.bind(rules)
  let yok = false
  rules.say = (k, ti, ...a) => {
    if (ti === 'GOL YOK') yok = true
    return sy(k, ti, ...a)
  }
  rules.start?.()
  let first = null
  let scored = false
  const un = game.on((e) => {
    if (process.env.V && armed && e.type === 'touch') console.log(seed, e.kind, e.player, game.match.phase, JSON.stringify(game.match.restart ?? null))
    if (e.type === 'touch' && !first && ['pass', 'lob', 'shoot'].includes(e.kind) && armed && e.player === takerId) first = { kind: e.kind, p: e.player }
    if (e.type === 'goal' && armed) scored = true
  })
  let armed = false
  let takerId = -1
  const step = () => {
    updateAI(DT)
    rules.pre(DT)
    stepLocomotion(DT)
    world.side = world.ball.x >= 0 ? 1 : -1
    world.step(DT)
    rules.post(DT)
  }
  for (let f = 0; f < 60 * 8; f++) step()
  const dirA = game.match.attackDir[0]
  const x = dirA * (HL - (8 + ((seed * 7) % 11)))
  const z = ((seed % 5) - 2) * 3
  rules.stop('test', { type: 'freekick', team: 0, x, z, indirect: true }, 2.0, { x, z })
  takerId = rules.pending.taker
  armed = true
  for (let f = 0; f < 60 * 20 && !first; f++) {
    step()
    if (process.env.V2 && f % 15 === 0 && f < 1300 && f % 60 === 0) { const tk = game.players[3]; console.log(seed, (f / 60).toFixed(2), game.match.phase, 'ball', world.ball.x.toFixed(1), world.ball.z.toFixed(1), world.ball.y.toFixed(2), 'p3', tk.x.toFixed(1), tk.z.toFixed(1), tk.hasBall ? 'HAS' : '', tk.anim, JSON.stringify(game.match.restart ?? null)) }
  }
  for (let f = 0; f < 60 * 4; f++) step()
  un()
  if (process.env.V3 && !first) console.log(seed, 'cs', JSON.stringify(aiStats.carrier), JSON.stringify(aiDebug()[3]), game.match.phase, game.players.find((q) => q.hasBall)?.id)
  if (!first) none++
  else if (first.kind === 'shoot') { direct++; if (process.env.V4) console.log('SUT', seed, first) }
  else pass++
  if (yok) golYok++
  if (scored) goal++
}
console.log(`endirekt zorlama: ${pass}/${N} pas, ${direct} dogrudan sut, ${none} vurus yok; GOL YOK ${golYok}, gol ${goal}`)
