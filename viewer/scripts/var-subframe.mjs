// VAR alt-kare hassasiyet testi (bassiz): npx -y tsx scripts/var-subframe.mjs
// 1) analitik: sabit ivmeli x(t) (tepe iki kare arasinda), 60 fps, tepe payi 1 cm'e kadar dogru mu
// 2) gercek sim: 25-31 m/s sutlarda 60 fps ornekler arasi Hermite konumu, 960 Hz referansla karsilastirilir
import { World } from '../src/sim.ts'
import { BALL_R, PITCH_L } from '../src/pitch.ts'
import { judgeTrack, segMaxD, trackAt } from '../src/var/judge.ts'

const G = PITCH_L / 2
let fail = 0
const check = (name, ok, info) => {
  console.log((ok ? 'GECTI  ' : 'KALDI  ') + name + '  ' + info)
  if (!ok) fail++
}
const mk = (T, X, Y, Z, VX, VY, VZ, gap = () => false) => ({
  get: (k, o) => ((o.x = X[k]), (o.y = Y[k]), (o.z = Z[k])),
  vel: (k, o) => ((o.x = VX[k]), (o.y = VY[k]), (o.z = VZ[k])),
  time: (k) => T[k],
  gap,
})

// 1) analitik: top cizgiye v0 ile gelir, a ile yavaslar (ag/direk), tepe = G + R + delta
{
  let worst = 0
  let n = 0
  for (const v0 of [10, 25, 35]) {
    for (const delta of [-0.05, -0.01, 0.005, 0.03, 0.06]) {
      for (let ph = 0; ph < 20; ph++) {
        // tepe an tp, kare araligi 1/60, faz ph/20 kare
        const a = (v0 * v0) / (2 * 0.8) // tepeye 0.8 m once yavaslamaya baslar
        const tp = v0 / a
        const peak = G + BALL_R + delta
        const x0 = peak - (v0 * tp - 0.5 * a * tp * tp)
        const N = Math.ceil((tp + 0.12 - (tp - 10.5 / 60)) * 60) + 1
        const T = [], X = [], Y = [], Z = [], VX = [], VY = [], VZ = []
        const t0 = tp - 10.5 / 60 - ph / 20 / 60
        for (let k = 0; k < N; k++) {
          const t = t0 + k / 60
          T.push(t)
          X.push(x0 + v0 * t - 0.5 * a * t * t)
          VX.push(v0 - a * t)
          Y.push(0.3)
          Z.push(0)
          VY.push(0)
          VZ.push(0)
        }
        const tr = mk(T, X, Y, Z, VX, VY, VZ)
        const v = judgeTrack(tr, 0, N - 1, 1)
        // gercek tepe payi (cm)
        const err = Math.abs(v.cm - delta * 100)
        worst = Math.max(worst, err)
        n++
        if (v.crossed !== delta >= 0) check(`analitik karar v0=${v0} d=${delta}`, false, `cm=${v.cm}`)
      }
    }
  }
  check('analitik tepe payi hatasi <= 0.1 cm', worst <= 0.1, `en kotu ${worst.toFixed(4)} cm (${n} deneme)`)
}

// 1b) belirgin gol: 35 m/s'de kaleye giren top, kartta makul santim (<= 30) ve GOL
{
  const N = 30
  const T = [], X = [], Y = [], Z = [], VX = [], VY = [], VZ = []
  for (let k = 0; k < N; k++) {
    const t = k / 60
    T.push(t); X.push(G - 4 + 35 * t); Y.push(0.8); Z.push(0.3); VX.push(35); VY.push(0); VZ.push(0)
  }
  const v = judgeTrack(mk(T, X, Y, Z, VX, VY, VZ), 0, N - 1, 1)
  check('hizli acik gol', v.kind === 'gol' && Math.abs(v.cm - 30) < 0.1, `${v.title} ${v.cm.toFixed(2)} cm`)
}

// 2) gercek sim
{
  const FINE = 16
  const hz = 60
  let worst = 0
  let shots = 0
  let worstV = 0
  for (const side of [1, -1]) {
    for (let seed = 1; seed <= 12; seed++) {
      const wc = new World()
      wc.seed(seed)
      wc.side = side
      wc.shoot('yerden')
      const wf = new World()
      wf.seed(seed)
      wf.side = side
      wf.shoot('yerden')
      const sp = Math.hypot(wc.ball.vx, wc.ball.vy, wc.ball.vz)
      if (sp < 22) continue
      worstV = Math.max(worstV, sp)
      const T = [], X = [], Y = [], Z = [], VX = [], VY = [], VZ = []
      const fine = [] // [t,x,y,z]
      const tmax = 1.6
      let tc = 0
      while (wc.time < tmax) {
        wc.step(1 / hz)
        T.push(wc.time)
        X.push(wc.ball.x)
        Y.push(wc.ball.y)
        Z.push(wc.ball.z)
        VX.push(wc.ball.vx)
        VY.push(wc.ball.vy)
        VZ.push(wc.ball.vz)
        for (let i = 0; i < FINE; i++) {
          wf.step(1 / hz / FINE)
          fine.push([wf.time, wf.ball.x, wf.ball.y, wf.ball.z])
        }
      }
      // referans: ince seri; her karenin ortasinda s=0.25/0.5/0.75'te Hermite ile karsilastir
      const tr = mk(T, X, Y, Z, VX, VY, VZ)
      const out = { x: 0, y: 0, z: 0 }
      const at = (t) => {
        let lo = 0
        let hi = fine.length - 1
        while (hi - lo > 1) {
          const m = (lo + hi) >> 1
          if (fine[m][0] <= t) lo = m
          else hi = m
        }
        const f0 = fine[lo]
        const f1 = fine[hi]
        const u = f1[0] > f0[0] ? (t - f0[0]) / (f1[0] - f0[0]) : 0
        return [f0[1] + (f1[1] - f0[1]) * u, f0[2] + (f1[2] - f0[2]) * u, f0[3] + (f1[3] - f0[3]) * u]
      }
      // yalniz kale cizgisine 3 m kala-sonrasi (kritik bolge)
      for (let k = 0; k + 1 < T.length; k++) {
        if (side * X[k] - G > 0.35 || side * X[k] - G < -3) continue // cizgiye 3 m kala .. ag temasindan once
        for (const s of [0.25, 0.5, 0.75]) {
          trackAt(tr, k, s, out)
          const t = T[k] + (T[k + 1] - T[k]) * s
          const r = at(t)
          const e = Math.hypot(out.x - r[0], out.y - r[1], out.z - r[2]) * 100
          if (e > 1 && process.env.DBG && Math.abs(side * X[k] - G) < 1.2) console.log('hata', seed, side, k, s, e.toFixed(2), 'x', X[k].toFixed(2), 'y', Y[k].toFixed(2), 'z', Z[k].toFixed(2), 'v', VX[k].toFixed(1), VX[k + 1].toFixed(1))
          worst = Math.max(worst, e)
        }
      }
      shots++
    }
  }
  check('gercek sim 60 fps Hermite konum hatasi <= 1 cm', worst <= 1, `en kotu ${worst.toFixed(3)} cm, ${shots} sut, en hizli ${worstV.toFixed(1)} m/s`)
}
console.log(fail ? 'BASARISIZ' : 'TUMU GECTI')
process.exit(fail ? 1 : 0)
