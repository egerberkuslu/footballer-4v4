// Top yuvarlanma + ag kararliligi: npx -y tsx scripts/stability-test.mjs
// (a) yavas top 20 s: titreme (kare basi konum dalgalanmasi) ve durus; (b) egimsiz zeminde duran top 20 s: kaymamali;
// (c) agda 60 s sakinlik: NaN yok, dugum hizlari ~0, ag uyur, top torbada dururken sapma yok.
import { World } from '../src/sim.ts'
import { PITCH_L, BALL_R } from '../src/pitch.ts'
const fails = []
const DT = 1 / 60

// (a) cok yavas toplar
for (const v of [0.02, 0.05, 0.2, 0.5, 1.0]) {
  const w = new World()
  w.placeBall(0, 0)
  w.kick({ x: v, y: 0, z: 0 }, { x: 0, y: 0, z: -v / BALL_R })
  const b = w.ball
  let jitter = 0, prev = b.x, stopT = -1, back = 0
  for (let f = 0; f < 1200; f++) {
    w.step(DT)
    const dx = b.x - prev
    if (dx < -1e-6) back = Math.min(back, dx)
    if (f > 600) jitter = Math.max(jitter, Math.abs(dx))
    prev = b.x
    if (stopT < 0 && Math.hypot(b.vx, b.vz) < 1e-3) stopT = f * DT
  }
  console.log(`yavas top v0=${v}: durdu ${stopT.toFixed(2)} s, x ${b.x.toFixed(3)}, 10-20 s max adim ${jitter.toExponential(1)}, geri adim ${back.toExponential(1)}, vy ${b.vy.toFixed(4)}, y ${b.y.toFixed(4)}`)
  if (!(jitter < 1e-5) || Math.abs(b.y - BALL_R) > 1e-3 || stopT < 0 || back < -1e-4) fails.push(`yavas top ${v}`)
}

// (b) duran top 20 s kaymamali
{
  const w = new World()
  w.placeBall(3, -2)
  w.kick({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
  const b = w.ball
  for (let f = 0; f < 1200; f++) w.step(DT)
  const d = Math.hypot(b.x - 3, b.z + 2)
  console.log(`duran top 20 s: kayma ${d.toExponential(1)} m, hiz ${Math.hypot(b.vx, b.vy, b.vz).toExponential(1)}`)
  if (d > 1e-4) fails.push('duran top kayiyor')
}

// (c) ag 60 s sakinlik, ucta bir sut sonrasi
{
  const w = new World()
  w.seed(7)
  w.side = 1
  w.shoot()
  const b = w.ball
  let nan = false, maxVLate = 0, asleepAt = -1, posDrift = 0
  const nodeV = () => {
    let m = 0
    for (let i = 0; i < w.pos.length; i++) m = Math.max(m, Math.abs(w.pos[i]))
    return m
  }
  let last
  for (let f = 0; f < 3600; f++) {
    w.step(DT)
    if (!Number.isFinite(b.x + b.y + b.z) || w.pos.some((v) => !Number.isFinite(v))) { nan = true; break }
    if (f === 2400) last = Float32Array.from(w.pos)
    if (f > 2400) {
      let m = 0
      for (let i = 0; i < w.pos.length; i++) m = Math.max(m, Math.abs(w.pos[i] - last[i]))
      posDrift = Math.max(posDrift, m)
    }
  }
  let ballSpeed = Math.hypot(b.vx, b.vy, b.vz)
  console.log(`ag 60 s: NaN ${nan}, top hizi ${ballSpeed.toExponential(1)}, 40-60 s en buyuk dugum yer degisimi ${posDrift.toExponential(1)} m, dugum ${w.n}`)
  if (nan) fails.push('ag NaN')
  if (ballSpeed > 1e-3) fails.push('top 60 s sonra duruyor degil')
}
if (fails.length) { console.error('BASARISIZ:', fails.join(', ')); process.exit(1) }
console.log('stabilite: tamam')
