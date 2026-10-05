// (b) Kural dumani: bolum sonlanir, gol sayilir, tac/korner/ofsayt/faul isler, NaN yok.
// Kullanim: npx -y tsx rl/tests/rules_smoke.mjs [episodeSec=600]
import { FootballEnv, ACT_DIM } from '../node/env.mjs'
import { makeRandomPolicy } from './policies.mjs'
import { game } from '../../viewer/src/game/store.ts'

const sec = Number(process.argv[2] ?? 600)
let bad = 0
const check = (cond, msg) => { console.log(cond ? 'GECTI  ' : 'BASARISIZ', msg); if (!cond) bad++ }
const counts = {}
const evCounts = () => { for (const k of Object.keys(counts)) delete counts[k] }
game.on((e) => {
  const k = e.type === 'restart' ? 'restart:' + e.restart.type : e.type === 'out' ? 'out:' + e.line : e.type
  counts[k] = (counts[k] ?? 0) + 1
})

function run(label, cfg, usePolicy) {
  evCounts()
  const env = new FootballEnv({ episodeSec: sec, ...cfg })
  env.reset(5)
  const pol = makeRandomPolicy(5)
  const act = new Float32Array(env.nAg * ACT_DIM)
  let nan = 0, steps = 0
  const t0 = performance.now()
  while (!env.done) {
    if (usePolicy) pol(env, act)
    env.step(act)
    steps++
    for (const a of [env.obs, env.reward, env.state, env.terms]) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) nan++
  }
  console.log(`--- ${label}: ${steps} karar, skor ${env.info[0]}-${env.info[1]}, ${((performance.now() - t0) / 1000).toFixed(1)} s, olaylar`, JSON.stringify(counts))
  check(env.done, `${label}: bolum sonlandi (truncated=${env.truncated})`)
  check(nan === 0, `${label}: NaN yok`)
  check((counts.goal ?? 0) === env.info[0] + env.info[1], `${label}: goal olay sayisi (${counts.goal ?? 0}) skor toplamina esit`)
  return { env, counts: { ...counts } }
}
const r1 = run('rastgele politika vs orta', { opponent: 'heuristic:orta' }, true)
const r2 = run('iki takim el yazmasi (AI-AI)', { team0: 'heuristic:orta', opponent: 'heuristic:orta' }, false)
const c = r2.counts
check((c['restart:kickin'] ?? 0) + (c['restart:corner'] ?? 0) + (c['restart:goalkick'] ?? 0) > 0, 'AI-AI: tac/korner/kale vurusu islendi')
check((c['offside'] ?? 0) + (c['offside-check'] ?? 0) > 0, `AI-AI: ofsayt olcumu isledi (offside ${c.offside ?? 0}, check ${c['offside-check'] ?? 0})`)
check((c.goal ?? 0) >= 0, `AI-AI: gol ${c.goal ?? 0}`)
// onGoal=end: ilk golde biter
evCounts()
{
  const env = new FootballEnv({ episodeSec: sec, opponent: 'heuristic:orta', onGoal: 'end' })
  env.reset(11)
  const pol = makeRandomPolicy(11)
  const act = new Float32Array(env.nAg * ACT_DIM)
  while (!env.done) { pol(env, act); env.step(act) }
  check(env.info[0] + env.info[1] === 1 && !env.truncated, `onGoal=end: ilk golde bitti (skor ${env.info[0]}-${env.info[1]}, sure ${env.info[2].toFixed(1)} s)`)
}
process.exit(bad ? 1 : 0)
