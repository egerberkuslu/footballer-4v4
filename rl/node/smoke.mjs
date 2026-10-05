// Hizli duman testi: npx -y tsx rl/node/smoke.mjs [episodeSec=30] [opponent]
import { FootballEnv, ACT_DIM, N_DISC } from './env.mjs'
const sec = Number(process.argv[2] ?? 30)
const env = new FootballEnv({ episodeSec: sec, opponent: process.argv[3] ?? 'heuristic:orta', seed: 3 })
let t0 = performance.now()
env.reset(3)
console.log('reset ms', (performance.now() - t0).toFixed(0), 'agents', env.nAg, 'obs', env.obs.length)
let s = 1
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
const act = new Float32Array(env.nAg * ACT_DIM)
let n = 0, nan = 0
t0 = performance.now()
while (!env.done) {
  for (let i = 0; i < env.nAg; i++) {
    const o = i * ACT_DIM
    for (let j = 0; j < 7; j++) act[o + j] = rnd() * 2 - 1
    // maske icinden rastgele ayrik eylem
    const ok = []
    for (let d = 0; d < N_DISC; d++) if (env.mask[i * N_DISC + d]) ok.push(d)
    act[o + 7] = rnd() < 0.5 ? 0 : ok[Math.floor(rnd() * ok.length)]
  }
  env.step(act)
  n++
  for (const a of [env.obs, env.reward, env.state]) for (let k = 0; k < a.length; k++) if (!Number.isFinite(a[k])) nan++
}
const dt = performance.now() - t0
console.log('adim', n, 'ms', dt.toFixed(0), 'karar/s', (n / (dt / 1000)).toFixed(0), 'skor', env.info[0], env.info[1], 'nan', nan, 'hash', env.hashHex(), 'truncated', env.truncated)
