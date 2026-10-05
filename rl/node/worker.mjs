// RL isci is parcacigi: TEK FootballEnv (modul tekilleri). Ana is parcacigi ile SharedArrayBuffer + Atomics.
// Komutlar ctrl[0]: 1=reset, 2=step, 3=kapat. Tamamlaninca ctrl[1]=1 + notify.
import { parentPort, workerData } from 'node:worker_threads'

const { tsxDist, cfg, index, sab } = workerData
const { register } = await import(tsxDist + 'esm/api/index.mjs')
register()
const E = await import('./env.mjs')
const env = new E.FootballEnv(cfg)
const N = env.nAg
const ctrl = new Int32Array(sab.ctrl)
const f32 = (key) => new Float32Array(sab[key])
const act = f32('act')
const obs = f32('obs'), state = f32('state'), reward = f32('reward'), terms = f32('terms'), info = f32('info')
const mask = new Uint8Array(sab.mask)
const flags = new Uint8Array(sab.flags) // [done, truncated]
let episode = 0
const baseSeed = (cfg.seed ?? 1) + index * 100003
const nextSeed = () => (baseSeed + 7919 * episode++) >>> 0

function publish() {
  obs.set(env.obs)
  state.set(env.state)
  mask.set(env.mask)
  reward.set(env.reward)
  terms.set(env.terms)
  info.set(env.info)
}
parentPort.postMessage({ ready: true, nAg: N })
for (;;) {
  Atomics.wait(ctrl, 0, 0)
  const cmd = Atomics.load(ctrl, 0)
  try {
    if (cmd === 1) {
      const s = Atomics.load(ctrl, 2)
      env.reset(s >= 0 ? s : nextSeed())
      flags[0] = 0
      flags[1] = 0
      publish()
    } else if (cmd === 2) {
      env.step(act)
      flags[0] = env.done ? 1 : 0
      flags[1] = env.truncated ? 1 : 0
      if (env.done) {
        // terminal odul/bilgi korunur; gozlem/maske/durum yeni bolumun ilk gozlemidir (otomatik reset)
        const r = Float32Array.from(env.reward)
        const t = Float32Array.from(env.terms)
        const inf = Float32Array.from(env.info)
        env.reset(nextSeed())
        publish()
        reward.set(r)
        terms.set(t)
        info.set(inf)
      } else publish()
    } else if (cmd === 3) {
      Atomics.store(ctrl, 0, 0)
      Atomics.store(ctrl, 1, 1)
      Atomics.notify(ctrl, 1)
      break
    }
    Atomics.store(ctrl, 3, 0)
  } catch (e) {
    parentPort.postMessage({ error: String(e && e.stack ? e.stack : e) })
    Atomics.store(ctrl, 3, 1)
  }
  Atomics.store(ctrl, 0, 0)
  Atomics.store(ctrl, 1, 1)
  Atomics.notify(ctrl, 1)
}
