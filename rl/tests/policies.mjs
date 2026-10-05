// Test yardimcilari: tohumlu rastgele politika (maskeye uyumlu)
import { ACT_DIM, N_DISC } from '../node/env.mjs'
export function makeRandomPolicy(seed) {
  let s = seed >>> 0 || 1
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
  return (env, act) => {
    for (let i = 0; i < env.nAg; i++) {
      const o = i * ACT_DIM
      for (let j = 0; j < 7; j++) act[o + j] = rnd() * 2 - 1
      const ok = []
      for (let d = 0; d < N_DISC; d++) if (env.mask[i * N_DISC + d]) ok.push(d)
      act[o + 7] = rnd() < 0.4 ? 0 : ok[Math.floor(rnd() * ok.length)]
    }
  }
}
