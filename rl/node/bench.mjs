// (c) HIZ olcumu: W is parcacigi x 1 ortam, ana surecte; Python/soket yok.
// Kullanim: npx -y tsx rl/node/bench.mjs [saniye=15] [W listesi=1,4,8,14] [opponent=heuristic:orta] [team0=external]
import { Worker } from 'node:worker_threads'
const seconds = Number(process.argv[2] ?? 15)
const Ws = (process.argv[3] ?? '1,4,8,14').split(',').map(Number)
const opponent = process.argv[4] ?? 'heuristic:orta'
const team0 = process.argv[5] ?? 'external'
const ld = process.execArgv.find((a) => a.endsWith('loader.mjs'))
const tsxDist = new URL('.', ld).href
const rss0 = process.memoryUsage().rss
for (const W of Ws) {
  const cfg = { episodeSec: 120, opponent, team0, seed: 1 }
  const ws = Array.from({ length: W }, (_, i) => new Worker(new URL('./bench_worker.mjs', import.meta.url), { workerData: { tsxDist, cfg, seconds, index: i } }))
  await Promise.all(ws.map((w) => new Promise((r) => w.once('message', r)))) // hazir
  const results = []
  const done = Promise.all(ws.map((w) => new Promise((r) => w.on('message', (m) => { if (m.done) r(m) }))))
  for (const w of ws) w.postMessage('go')
  const res = await done
  const tot = res.reduce((a, r) => a + r.n, 0)
  const wall = Math.max(...res.map((r) => r.dt))
  const rss = res.reduce((a, r) => Math.max(a, r.rss), 0)
  console.log(JSON.stringify({ W, opponent, team0, toplam_karar_s: Math.round(tot / wall), cekirdek_basina_karar_s: Math.round(tot / wall / W), bolum: res.reduce((a, r) => a + r.eps, 0), proc_rss_MB: Math.round(process.memoryUsage().rss / 1e6) }))
  await Promise.all(ws.map((w) => w.terminate()))
}
