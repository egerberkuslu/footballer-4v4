// Bassiz kural testleri: npx -y tsx scripts/rules-test.mjs
// Her senaryo taze oyun durumu + sahte topla Rules motorunu kare kare surer.
import { Rules, HL, HW, judgeContact } from '../src/rules/engine.ts'
import { game as proto } from '../src/game/store.ts'
import { SPOT_DIST, BALL_R } from '../src/pitch.ts'
import { setBodyPoints, bodyPoints, BODY_N } from '../src/game/bodyPoints.ts'

const DT = 1 / 60
let pass = 0
let fail = 0
const ok = (c, msg) => {
  if (c) pass++
  else {
    fail++
    console.log('  BASARISIZ:', msg)
  }
}

function fresh(half = 180) {
  const listeners = new Set()
  const events = []
  const g = {
    players: structuredClone(proto.players),
    inputs: proto.players.map(() => ({ move: { x: 0, z: 0 }, sprint: false, action: null })),
    referee: { x: 0, z: -9, vx: 0, vz: 0, facing: 0, anim: 'idle', animT: 0 },
    match: structuredClone(proto.match),
    humanTeam: 0,
    emit(e) {
      events.push(e)
      listeners.forEach((f) => f(e))
    },
    on(f) {
      listeners.add(f)
      return () => listeners.delete(f)
    },
  }
  const ball = { x: 0, y: 0.11, z: 0, vx: 0, vy: 0, vz: 0 }
  const kicks = []
  const releases = []
  const r = new Rules({
    game: g,
    ball: () => ball,
    placeBall: (x, z) => Object.assign(ball, { x, y: 0.11, z, vx: 0, vy: 0, vz: 0 }),
    kick: (v) => {
      kicks.push(v)
      Object.assign(ball, { vx: v.x, vy: 0, vz: v.z })
    },
    halfLength: half,
    varMonitor: () => ({ x: 0, z: -14.1, facing: 0 }),
    releaseHold: () => releases.push(1),
  })
  r.start()
  // ts: timeScale (VAR'da 0 olabilir; hakem gercek zamanla yurur)
  const step = (sec, ts = 1) => {
    for (let t = 0; t < sec; t += DT) {
      r.pre(DT * ts)
      ball.x += ball.vx * DT * ts
      ball.z += ball.vz * DT * ts
      r.post(DT * ts, DT)
    }
  }
  // baslama vurusunu yap: oyun 'play'
  const startPlay = () => {
    step(2)
    if (r.mode !== 'ready') return false
    ball.vx = 3
    step(0.3)
    ball.vx = 0
    return r.mode === 'play'
  }
  const touch = (player) => g.emit({ type: 'touch', player, kind: 'dribble' })
  return { g, r, ball, step, startPlay, touch, events, kicks, releases }
}
for (const [rx, rz, bx, bz, bvx] of [[0, 9, 19, 0, 0], [-15, 5, 19, 0, 0], [15, -8, -19, 3, 0], [10, 12, 18, 0, 15]]) {
  const f = fresh()
  const { g, r, ball, step, startPlay } = f
  startPlay()
  Object.assign(ball, { x: bx, z: bz, vx: bvx, vz: 0 })
  Object.assign(g.referee, { x: rx, z: rz, vx: 0, vz: 0 })
  g.emit({ type: 'var-start', reason: 'line' })
  const st = r.varStand()
  const d = () => Math.hypot(g.referee.x - st.x, g.referee.z - st.z)
  const d0 = d()
  const tr = []
  let t = 0
  while (r.varS?.stage !== 'monitor' && t < 15) {
    step(0.25, 0)
    t += 0.25
    tr.push(`${t.toFixed(2)}:${g.referee.x.toFixed(1)},${g.referee.z.toFixed(1)}(${d().toFixed(1)})`)
  }
  console.log(`start d=${d0.toFixed(1)} stand=${st.x.toFixed(1)},${st.z.toFixed(1)} arrive t=${t}`)
  console.log(tr.join(' '))
}
