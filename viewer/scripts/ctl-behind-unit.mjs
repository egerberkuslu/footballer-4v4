// F: contact.fromBehind konum tabanli mi (onden, yandan, arkadan, geri giden jockey, ayni yone kosan). npx -y tsx scripts/ctl-behind-unit.mjs
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { stepLocomotion } from '../src/control/locomotion.ts'

const DT = 1 / 60
const P = game.players
game.match.phase = 'play'
const ev = []
game.on((e) => e.type === 'contact' && ev.push(e))
const step = (n, fn) => {
  for (let i = 0; i < n; i++) {
    fn && fn(i)
    stepLocomotion(DT)
    world.step(DT)
  }
}
const V = P[5] // kurban (takim 1)
const T = P[0] // muhaleci (takim 0)
function run(name, vp, tp, vv, tv, kind, want) {
  for (const q of P) {
    Object.assign(q, { x: -16 - q.id * 1.6, z: 11.5, vx: 0, vz: 0, hasBall: false, actionLock: 0, anim: 'idle', stamina: 1, facing: 0, controlled: false })
    game.inputs[q.id] = { move: { x: 0, z: 0 }, sprint: false, action: null }
  }
  world.placeBall(-10, 8)
  step(40)
  ev.length = 0
  Object.assign(V, { x: vp[0], z: vp[1], facing: vp[2], vx: vv[0], vz: vv[1] })
  Object.assign(T, { x: tp[0], z: tp[1], facing: tp[2], vx: tv[0], vz: tv[1] })
  game.inputs[T.id].action = { type: kind, power: 0, aim: { x: V.x, y: 0, z: V.z } }
  step(40)
  const c = ev.find((e) => e.a === T.id && e.b === V.id)
  const ok = c && c.fromBehind === want
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${kind}: ${c ? 'temas fromBehind=' + c.fromBehind : 'temas yok'} (beklenen ${want})`)
}
const PX = Math.PI / 2 // +x'e bakis
for (const kind of ['tackle', 'slide']) {
  run('onden', [0, 0, PX], [1.0, 0, -PX], [0, 0], [0, 0], kind, false)
  run('yandan', [0, 0, PX], [0, 1.0, Math.PI], [0, 0], [0, 0], kind, false)
  run('arkadan', [0, 0, PX], [-1.0, 0, PX], [0, 0], [0, 0], kind, true)
  run('geri giden jockey (hedef -x gider, tackler onunde)', [0, 0, PX], [1.0, 0, -PX], [-1.5, 0], [-2, 0], kind, false)
  run('ayni yone kosan (arkadan)', [0, 0, PX], [-1.0, 0, PX], [5, 0], [5.5, 0], kind, true)
}
