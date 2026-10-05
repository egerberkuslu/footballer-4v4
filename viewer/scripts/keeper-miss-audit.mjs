// Gercek AI maclarinda kaleci dalislarini denetle: sut kaleye gidiyor muydu (kale cizgisi kesisimi |z|<2.39, y<GOAL_H-R),
// kaleci neden yetismedi. Kullanim: npx -y tsx scripts/keeper-miss-audit.mjs [devre_sn=120] [tohum=2] [seviye=orta]
import './ai-env.mjs'
import { diveHook } from '../src/sim/keeperDive.ts'
import { freeStep, newBall } from '../src/sim/ball.ts'
import { GOAL_H, GOAL_W, PITCH_L } from '../src/pitch.ts'
const rows = []
const sim = newBall()
diveHook.fn = (sp, inp) => {
  Object.assign(sim, inp.ball)
  const sgn = inp.goalX >= 0 ? 1 : -1
  let cz = null, cy = null, ct = 0
  for (let i = 1; i <= 360; i++) { freeStep(sim, 1 / 120); ct = i / 120; if (sgn * sim.x >= PITCH_L / 2) { cz = sim.z; cy = sim.y; break } }
  const tc = sp.tc - sp.t0
  const onTarget = cz !== null && Math.abs(cz) < GOAL_W / 2 - 0.11 && cy < GOAL_H - 0.11
  rows.push({ onTarget, reach: sp.reach, out: sp.outcome, v: +sp.ballSpeed.toFixed(1), crossT: +ct.toFixed(2), crossZ: cz === null ? null : +cz.toFixed(2), crossY: cy === null ? null : +cy.toFixed(2), kz: +inp.kz.toFixed(2), bx: +Math.abs(inp.goalX - inp.ball.x).toFixed(1), tcMinusT0: +tc.toFixed(2) })
}
process.argv[2] ??= '120'
await import('./ai-match.mjs')
const on = rows.filter((r) => r.onTarget)
console.log('DALIS DENETIMI: toplam', rows.length, '| kaleye giden', on.length, '| kale disina giden', rows.length - on.length)
console.log('kaleye gidenlerde: menzilde', on.filter((r) => r.reach).length, 'tutma/yumruk', on.filter((r) => r.out !== 'miss').length, 'kacirma', on.filter((r) => r.out === 'miss').length)
console.log('kaleye giden ve menzil disi:', JSON.stringify(on.filter((r) => !r.reach)))
console.log('kale disina giden dalislar (ilk 10):', JSON.stringify(rows.filter((r) => !r.onTarget).slice(0, 10)))
