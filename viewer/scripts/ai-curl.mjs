// AI sutlari (falsolu/duz) sonuc olcumu: kurtarma orani = kurtaris / (gol + kurtaris).
// npx -y tsx scripts/ai-curl.mjs [mac_sayisi=8] [seviye=orta] [devre_sn=150]; CURL=0 falsoyu kapatir
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { Rules } from '../src/rules/engine.ts'
import { updateAI, resetAI, aiStats, aiFlags } from '../src/ai/brain.ts'
import { seedAI, setAiLevel } from '../src/ai/config.ts'
import { stepLocomotion } from '../src/control/locomotion.ts'

const N = Number(process.argv[2] ?? 8)
const LEVEL = process.argv[3] ?? 'orta'
const HALF = Number(process.argv[4] ?? 150)
aiFlags.curl = process.env.CURL !== '0'
const DT = 1 / 60
const res = { duz: { n: 0, gol: 0, kurt: 0, diger: 0 }, falso: { n: 0, gol: 0, kurt: 0, diger: 0 } }
for (let seed = 1; seed <= N; seed++) {
  let s = seed
  Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  seedAI(seed); setAiLevel(LEVEL); world.seed(seed); resetAI()
  aiStats.shotLog.length = 0
  game.humanTeam = null
  for (const p of game.players) p.controlled = false
  const rules = new Rules({ game, ball: () => world.ball, placeBall: (x, z) => world.placeBall(x, z), kick: (v, w) => world.kick(v, w), halfLength: HALF })
  rules.start?.()
  let t = 0
  let pend = null
  const fin = (k) => {
    if (!pend) return
    const r = res[pend.curl ? 'falso' : 'duz']
    r.n++
    r[k]++
    pend = null
  }
  const un = game.on((e) => {
    if (e.type === 'touch' && e.kind === 'shoot' && game.players[e.player].role !== 'kaleci') {
      fin('diger')
      let best = null
      for (const l of aiStats.shotLog) if (t - l.t < 1.2 && t >= l.t) best = l
      pend = { curl: best ? best.curl : 0 }
    } else if (e.type === 'touch' && e.kind === 'save' && pend) fin('kurt')
    else if (e.type === 'goal' && pend) fin('gol')
    else if ((e.type === 'out' || e.type === 'restart') && pend) fin('diger')
  })
  for (let f = 0; f < 60 * (HALF * 2 * 2.5 + 60) && game.match.phase !== 'fulltime'; f++) {
    t += DT
    updateAI(DT); rules.pre(DT); stepLocomotion(DT)
    world.side = world.ball.x >= 0 ? 1 : -1
    world.step(DT); rules.post(DT)
  }
  un()
}
const f = (r) => `${r.n} sut: gol ${r.gol}, kurtaris ${r.kurt}, diger ${r.diger}; kurtarma orani ${r.gol + r.kurt ? ((100 * r.kurt) / (r.gol + r.kurt)).toFixed(0) + '%' : '-'}`
console.log(`seviye ${LEVEL} (${N} mac, falso ${aiFlags.curl ? 'acik' : 'kapali'})`)
console.log('  duz   ', f(res.duz))
console.log('  falso ', f(res.falso))
