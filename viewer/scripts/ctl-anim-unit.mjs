// F: surme animasyonlari (cut/drag-back/sole-stop) ve kayma getup birim testi. npx -y tsx scripts/ctl-anim-unit.mjs
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { stepLocomotion, setControlled } from '../src/control/locomotion.ts'

const DT = 1 / 60
const P = game.players
game.match.phase = 'play'
const A = P[3]
const D = P[5]
const step = (n, fn) => {
  for (let i = 0; i < n; i++) {
    fn && fn(i)
    stepLocomotion(DT)
    world.step(DT)
  }
}
function reset() {
  for (const q of P) {
    Object.assign(q, { x: -16 - q.id * 1.6, z: 11.5, vx: 0, vz: 0, hasBall: false, actionLock: 0, anim: 'idle', stamina: 1, facing: 0 })
    game.inputs[q.id] = { move: { x: 0, z: 0 }, sprint: false, action: null }
  }
  world.placeBall(0, 0)
  step(40)
}
function give() {
  reset()
  Object.assign(A, { x: 0, z: 0, facing: Math.PI / 2 })
  setControlled(A.id)
  world.placeBall(0.45, 0)
  step(4)
}
const seen = (fn, n) => {
  const s = new Set()
  step(n, (i) => {
    fn(i)
    s.add(A.anim)
  })
  return [...s].join(',')
}
const out = {}
give()
out.run180 = seen((i) => (game.inputs[A.id].move = i < 60 ? { x: 1, z: 0 } : { x: -1, z: 0 }), 120)
give()
out.run90 = seen((i) => (game.inputs[A.id].move = i < 60 ? { x: 1, z: 0 } : { x: 0, z: 1 }), 120)
give()
out.stop = seen((i) => (game.inputs[A.id].move = i < 60 ? { x: 1, z: 0 } : { x: 0, z: 0 }), 90)
// kayma getup
reset()
Object.assign(D, { x: 0, z: 0, facing: Math.PI / 2 })
game.inputs[D.id].action = { type: 'slide', power: 1, aim: { x: 10, y: 0, z: 0 } }
const an = []
step(130, () => {
  if (!an.length || an[an.length - 1] !== D.anim) an.push(D.anim)
})
out.slide = an.join('>')
out.slideLockLeft = D.actionLock
console.log(JSON.stringify(out, null, 1))
