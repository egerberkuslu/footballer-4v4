// (a) Determinizm: ayni tohum + ayni eylem dizisi => ayni yorunge ozeti (hash).
// Kullanim: npx -y tsx rl/tests/determinism.mjs [opponent=heuristic:orta] [episodeSec=60]
// Ayni surecte reset sonrasi tekrar + ayri surecte (cocuk) tekrar karsilastirilir.
import { spawnSync } from 'node:child_process'
import { FootballEnv, ACT_DIM } from '../node/env.mjs'
import { makeRandomPolicy } from './policies.mjs'

const opp = process.argv[2] ?? 'heuristic:orta'
const sec = Number(process.argv[3] ?? 60)
if (process.argv[4] === 'child') {
  const env = new FootballEnv({ episodeSec: sec, opponent: opp })
  const pol = makeRandomPolicy(99)
  const act = new Float32Array(env.nAg * ACT_DIM)
  env.reset(7)
  while (!env.done) { pol(env, act); env.step(act) }
  console.log('HASH', env.hashHex(), env.info[0], env.info[1])
  process.exit(0)
}
const env = new FootballEnv({ episodeSec: sec, opponent: opp })
const act = new Float32Array(env.nAg * ACT_DIM)
const run = (seed) => {
  const pol = makeRandomPolicy(99)
  env.reset(seed)
  while (!env.done) { pol(env, act); env.step(act) }
  return `${env.hashHex()} skor ${env.info[0]}-${env.info[1]}`
}
const a = run(7), b = run(7), c = run(8), d = run(7)
console.log('ayni surec: ilk', a, '| tekrar', b, '| ucuncu(tohum 8)', c, '| tekrar tohum7', d)
const ok1 = a === b && a === d && a !== c
const r = spawnSync(process.execPath, [...process.execArgv, new URL(import.meta.url).pathname, opp, String(sec), 'child'], { encoding: 'utf8' })
const line = (r.stdout.match(/HASH (\S+) (\S+) (\S+)/) || [])
const childStr = `${line[1]} skor ${line[2]}-${line[3]}`
console.log('ayri surec:', childStr)
const ok2 = childStr === a
console.log(ok1 ? 'GECTI' : 'BASARISIZ', 'reset sonrasi ayni surecte determinizm;', ok2 ? 'GECTI' : 'BASARISIZ', 'ayri surec determinizmi')
process.exit(ok1 && ok2 ? 0 : 1)
