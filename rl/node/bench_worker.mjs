import { parentPort, workerData } from 'node:worker_threads'
const { tsxDist, cfg, seconds, index } = workerData
const { register } = await import(tsxDist + 'esm/api/index.mjs')
register()
const E = await import('./env.mjs')
const env = new E.FootballEnv(cfg)
env.reset(1000 + index)
let s = 12345 + index
const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
const act = new Float32Array(env.nAg * E.ACT_DIM)
parentPort.postMessage({ ready: true })
await new Promise((r) => parentPort.once('message', r)) // baslat sinyali
let n = 0, eps = 0
const t0 = performance.now()
while ((performance.now() - t0) / 1000 < seconds) {
  for (let i = 0; i < env.nAg; i++) {
    const o = i * E.ACT_DIM
    for (let j = 0; j < 7; j++) act[o + j] = rnd() * 2 - 1
    const ok = []
    for (let d = 0; d < E.N_DISC; d++) if (env.mask[i * E.N_DISC + d]) ok.push(d)
    act[o + 7] = rnd() < 0.4 ? 0 : ok[Math.floor(rnd() * ok.length)]
  }
  env.step(act)
  n++
  if (env.done) { eps++; env.reset(2000 + index * 100 + eps) }
}
const dt = (performance.now() - t0) / 1000
parentPort.postMessage({ done: true, n, dt, eps, rss: process.memoryUsage().rss })
