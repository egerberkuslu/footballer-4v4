// Yon simetri testi: ayni goreli konumdan ayni sut, iki kaleye. Gol/kurtaris oranlari karsilastirilir.
// npx -y tsx scripts/ai-symm.mjs [deneme=40]
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { PITCH_L } from '../src/pitch.ts'
import { Rules } from '../src/rules/engine.ts'
import { updateAI, resetAI } from '../src/ai/brain.ts'
import { seedAI, setAiLevel } from '../src/ai/config.ts'
import { stepLocomotion } from '../src/control/locomotion.ts'

const N = Number(process.argv[2] ?? 40)
const HL = PITCH_L / 2
const DT = 1 / 60
const res = { '+': { gol: 0, kurt: 0, diger: 0 }, '-': { gol: 0, kurt: 0, diger: 0 } }
for (const sgn of [1, -1]) {
  for (let i = 0; i < N; i++) {
    const seed = 100 + i
    let s = seed
    Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    seedAI(seed); setAiLevel('orta'); world.seed(seed); resetAI()
    game.humanTeam = null
    for (const p of game.players) p.controlled = false
    const rules = new Rules({ game, ball: () => world.ball, placeBall: (x, z) => world.placeBall(x, z), kick: (v, w) => world.kick(v, w), halfLength: 150 })
    rules.start?.()
    const step = () => { updateAI(DT); rules.pre(DT); stepLocomotion(DT); world.side = world.ball.x >= 0 ? 1 : -1; world.step(DT); rules.post(DT) }
    for (let f = 0; f < 60 * 6; f++) step()
    // atan takim: sgn kalesine saldiran
    const dirA = sgn
    const team = game.match.attackDir[0] === dirA ? 0 : 1
    const sh = game.players.find((p) => p.team === team && p.role === 'forvet')
    const rz = (((i * 37) % 11) - 5) * 0.7 // simetrik z
    const dist = 11 + (i % 4)
    sh.controlled = true
    for (const p of game.players) { p.vx = 0; p.vz = 0; if (p !== sh && p.role !== 'kaleci') { p.x = -dirA * 10; p.z = (p.id % 2 ? 8 : -8) } }
    sh.x = dirA * (HL - dist); sh.z = rz; sh.facing = dirA > 0 ? Math.PI / 2 : -Math.PI / 2
    world.placeBall(sh.x + dirA * 0.4, sh.z)
    world.ball.vx = world.ball.vy = world.ball.vz = 0
    const tz = (i % 2 ? 1 : -1) * 1.7
    let out = 'diger'
    const un = game.on((e) => {
      if (e.type === 'goal') out = 'gol'
      if (e.type === 'touch' && e.kind === 'save') out = out === 'gol' ? out : 'kurt'
    })
    for (let f = 0; f < 60 * 4; f++) {
      const inp = game.inputs[sh.id]
      inp.move.x = inp.move.z = 0
      inp.action = f === 20 ? { type: 'shoot', power: 0.7, aim: { x: dirA * HL, y: 0.6, z: tz } } : null
      step()
    }
    un()
    res[sgn > 0 ? '+' : '-'][out]++
  }
}
for (const k of ['+', '-']) { const r = res[k]; console.log(`kale ${k}x: gol ${r.gol}, kurtaris ${r.kurt}, diger ${r.diger} / ${N}`) }
