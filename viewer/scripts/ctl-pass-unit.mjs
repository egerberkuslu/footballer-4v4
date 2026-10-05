// F: pas isabeti (rakipsiz): 40 pas, 6-22 m, alici duran/kosan; alici topu aliyor mu, kotu ilk dokunus orani
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { stepLocomotion, setControlled } from '../src/control/locomotion.ts'
const DT = 1 / 60
const P = game.players
let s = 7
Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
game.match.phase = 'play'
setControlled(-1)
let ok = 0, n = 0, badTouch = 0
const traps = []
game.on((e) => { if (e.type === 'touch' && e.kind === 'trap') traps.push(e.player) })
for (let k = 0; k < 40; k++) {
  for (const q of P) { Object.assign(q, { x: -18, z: -12 + q.id, vx: 0, vz: 0, hasBall: false, actionLock: 0, stamina: 1 }); game.inputs[q.id] = { move: { x: 0, z: 0 }, sprint: false, action: null } }
  const A = P[1], R = P[2]
  const d = 6 + (k % 9) * 2
  const ang = (k * 0.7) % (2 * Math.PI)
  Object.assign(A, { x: -5, z: 0, facing: Math.PI / 2 })
  world.placeBall(-5 + 0.45, 0)
  for (let i = 0; i < 3; i++) { stepLocomotion(DT); world.step(DT) }
  const run = k % 2 === 1
  Object.assign(R, { x: -5 + Math.cos(ang) * d, z: Math.sin(ang) * d * 0.5, facing: 0 })
  const mv = run ? { x: -Math.sin(ang), z: Math.cos(ang) } : { x: 0, z: 0 }
  if (run) { R.vx = mv.x * 5; R.vz = mv.z * 5 }
  // insan gibi: alicinin onunu karsila
  const t = d / 9
  const aim = { x: R.x + R.vx * t, y: 0, z: R.z + R.vz * t }
  game.inputs[A.id].action = { type: 'pass', power: 0, aim }
  traps.length = 0
  let got = false
  for (let i = 0; i < 300; i++) {
    // alici (AI benzeri): kosuyorsa hedef noktaya, oraya varinca ya da top yaklasinca topa
    const toAim = Math.hypot(aim.x - R.x, aim.z - R.z)
    const bx = world.ball.x - R.x, bz = world.ball.z - R.z, bl = Math.hypot(bx, bz)
    if (run && toAim > 0.8 && bl > 3) game.inputs[R.id].move = { x: (aim.x - R.x) / toAim, z: (aim.z - R.z) / toAim }
    else if (bl > 0.5 && i > 15) game.inputs[R.id].move = { x: bx / bl, z: bz / bl }
    else game.inputs[R.id].move = { x: 0, z: 0 }
    stepLocomotion(DT); world.step(DT)
    if (R.hasBall) { got = true; break }
  }
  n++
  if (got) ok++
  else console.log("kacti", { d, run, ang: +ang.toFixed(2), ball: [+world.ball.x.toFixed(1), +world.ball.z.toFixed(1)], R: [+R.x.toFixed(1), +R.z.toFixed(1)], aim: [+aim.x.toFixed(1), +aim.z.toFixed(1)] })
  if (traps.includes(R.id) && !got) badTouch++
}
console.log(`pas: ${ok}/${n} alindi, kotu ilk dokunus sonrasi kayip ${badTouch}`)
