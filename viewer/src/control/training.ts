// Antrenman modunda oyuncu durumu: sutcu topun arkasinda (vurusta kisa kosu + 'kick' animasyonu),
// diger oyuncular ve hakem kenar cizgisinin disinda bekler. Karakterleri I'nin <Characters /> cizer.
import { game } from '../game/store'
import type { AnimState, Player } from '../game/types'
import { PITCH_L, PITCH_W } from '../pitch'
import { world, type DynCollider } from '../sim'
import { RUN_D, RUN_T } from './actions'
import { ctl } from './store'
import { setColliders } from './worldApi'

const BEHIND = 1.15 // topun arkasina mesafe
const OFFSET = 0.42 // sag ayakli: topun sol yanina hafif kayik
const BENCH_Z = -(PITCH_W / 2 + 1.8)

const col: DynCollider = { a: [0, 0.1, 0], b: [0, 1.75, 0], r: 0.22, vx: 0, vy: 0, vz: 0, e: 0.35, mu: 0.4, tag: 'oyuncu', id: 'antrenman' }
let lastX = 0
let lastZ = 0
let init = false

function setAnim(p: Player, a: AnimState, dt: number) {
  if (p.anim !== a) {
    p.anim = a
    p.animT = 0
  } else p.animT += dt
}

export const trainingShooter = () => game.controlledPlayer() ?? game.players[3]

export function trainingPose(dt: number) {
  const shooter = trainingShooter()
  const gdt = dt * world.timeScale
  // yedekler: kenar cizgisi disinda sirali, sahaya bakar
  let i = 0
  for (const p of game.players) {
    if (p === shooter) continue
    p.x = -9 + i * 2.6
    p.z = BENCH_Z
    p.vx = p.vz = 0
    p.facing = 0
    p.hasBall = false
    setAnim(p, 'idle', gdt)
    i++
  }
  const r = game.referee
  r.x = 12
  r.z = BENCH_Z
  r.vx = r.vz = 0
  r.facing = 0

  // sutcu: yerlestirilen noktanin arkasinda, kaleye bakar; vurusta kosu
  let dx = world.side * (PITCH_L / 2) - ctl.spotX
  let dz = -ctl.spotZ
  const d = Math.hypot(dx, dz) || 1
  dx /= d
  dz /= d
  let run = 0
  const kicking = ctl.runT >= 0
  if (kicking) {
    const k = Math.min(1, (performance.now() / 1000 - ctl.runT) / RUN_T)
    run = RUN_D * k * k * (3 - 2 * k)
  }
  const back = BEHIND - run
  const p = shooter
  p.x = ctl.spotX - dx * back + dz * OFFSET
  p.z = ctl.spotZ - dz * back - dx * OFFSET
  p.facing = Math.atan2(dx, dz)
  p.hasBall = false
  const h = Math.max(1e-3, gdt)
  p.vx = init && gdt > 0 ? (p.x - lastX) / h : 0
  p.vz = init && gdt > 0 ? (p.z - lastZ) / h : 0
  if (Math.hypot(p.vx, p.vz) > 12) p.vx = p.vz = 0 // isinlanma (top yerlestirme)
  // vurus klibi: kosu basinda baslar, topa temas RUN_T'de (= kickContact)
  setAnim(p, kicking ? 'kick' : 'idle', gdt)

  // govde kapsulu: top oyuncuya carpinca seker
  col.vx = p.vx
  col.vz = p.vz
  col.a = [p.x, 0.1, p.z]
  col.b = [p.x, 1.75, p.z]
  setColliders([col])
  lastX = p.x
  lastZ = p.z
  init = true
}
