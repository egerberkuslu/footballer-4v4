// YALNIZ bassiz test icin taklit hareket/top aksiyonlari (F'nin control/locomotion'u yerine).
// Gercek oyunda KULLANILMAZ. Ayni PlayerInput'u uygular: hiz, sahiplik, surme, pas/sut/asirtma, mudahale, kaleci.
import { BALL_R, GOAL_W, PITCH_L, PITCH_W } from '../pitch'
import { game } from '../game/store'
import { world } from '../sim'
import type { Player, TeamId } from '../game/types'

const HL = PITCH_L / 2
const HW = PITCH_W / 2
const V_MIN = 8
const V_MAX = 34
const g = 9.81

export const mockStats = { kicks: 0, tackleOk: 0, tackleMiss: 0, fouls: 0, saves: 0, catches: 0 }
export type KickInfo = { by: number; team: TeamId; type: string; t: number }
export let onKick: ((k: KickInfo) => void) | null = null
export const setOnKick = (f: ((k: KickInfo) => void) | null) => (onKick = f)

let t = 0
let noPickup = -1 // bu oyuncu bu zamana kadar topu alamaz
let noPickupT = 0
let diveT = new Map<number, number>()
let rand = Math.random
export const setMockRand = (f: () => number) => (rand = f)

const touch = (p: Player, kind: 'dribble' | 'pass' | 'shoot' | 'lob' | 'tackle' | 'save' | 'trap' = 'trap') => {
  game.emit({ type: 'touch', player: p.id, kind })
}

function kickBall(p: Player, vx: number, vy: number, vz: number, type: string) {
  const b = world.ball
  b.vx = vx
  b.vy = vy
  b.vz = vz
  b.wx = b.wy = b.wz = 0
  b.px = b.x
  b.py = b.y
  b.pz = b.z
  if (b.y < BALL_R) b.y = BALL_R
  p.hasBall = false
  p.actionLock = 0.25
  noPickup = p.id
  noPickupT = t + 0.35
  touch(p, type as 'pass')
  mockStats.kicks++
  onKick?.({ by: p.id, team: p.team, type, t })
}

export function stepMockLocomotion(dt: number) {
  t += dt
  const b = world.ball
  const ps = game.players
  for (const p of ps) {
    if (p.sentOff) continue
    const inp = game.inputs[p.id]
    const locked = p.actionLock > 0
    if (locked) p.actionLock = Math.max(0, p.actionLock - dt)
    const dEnd = diveT.get(p.id) ?? -1
    let tvx = 0
    let tvz = 0
    if (!locked) {
      const top = (inp.sprint ? 7.2 : 5.6) * (0.75 + 0.25 * p.stamina) * (p.hasBall ? 0.85 : 1)
      tvx = inp.move.x * top
      tvz = inp.move.z * top
    }
    if (dEnd > t) {
      // dalis suruyor: hizini korur
    } else {
      const ax = tvx - p.vx
      const az = tvz - p.vz
      const al = Math.hypot(ax, az)
      const amax = 14 * dt
      const k = al > amax ? amax / al : 1
      p.vx += ax * k
      p.vz += az * k
    }
    p.x = Math.max(-HL - 3, Math.min(HL + 3, p.x + p.vx * dt))
    p.z = Math.max(-HW - 3, Math.min(HW + 3, p.z + p.vz * dt))
    const sp = Math.hypot(p.vx, p.vz)
    if (sp > 0.3) p.facing = Math.atan2(p.vx, p.vz)
    p.stamina = Math.max(0, Math.min(1, p.stamina + (inp.sprint && sp > 5 ? -0.06 : 0.04) * dt))

    const a = locked ? null : inp.action
    if (!a) continue
    const dx = a.aim.x - b.x
    const dz = a.aim.z - b.z
    const d = Math.hypot(dx, dz) || 1
    // duran topta taker topa yakinsa durgun topa vurur
    const r = game.match.restart
    const setKick = game.match.phase !== 'play' && r && r.taker === p.id && Math.hypot(b.x - p.x, b.z - p.z) < 1.1
    if ((a.type === 'pass' || a.type === 'shoot' || a.type === 'lob') && (p.hasBall || setKick)) {
      if (a.type === 'pass') {
        const v = V_MIN + (V_MAX - V_MIN) * a.power
        kickBall(p, (dx / d) * v, 0.4, (dz / d) * v, 'pass')
      } else if (a.type === 'shoot') {
        const v = V_MIN + (V_MAX - V_MIN) * a.power
        const T = d / (v * 0.92)
        const vy = (a.aim.y - BALL_R + 0.5 * g * T * T) / T
        const vh = Math.sqrt(Math.max(1, v * v - vy * vy))
        kickBall(p, (dx / d) * vh, vy, (dz / d) * vh, 'shoot')
      } else {
        // 40 derece, suruklemeye pay
        const v = Math.sqrt((d * g) / Math.sin((80 * Math.PI) / 180)) * 1.12
        const c = Math.cos((40 * Math.PI) / 180)
        kickBall(p, (dx / d) * v * c, v * Math.sin((40 * Math.PI) / 180), (dz / d) * v * c, 'lob')
      }
    } else if (a.type === 'tackle' || a.type === 'slide') {
      const reach = a.type === 'tackle' ? 1.6 : 2.9
      p.actionLock = a.type === 'tackle' ? 0.5 : 1.1
      if (a.type === 'slide') {
        const bd = Math.hypot(b.x - p.x, b.z - p.z) || 1
        p.vx = ((b.x - p.x) / bd) * 6
        p.vz = ((b.z - p.z) / bd) * 6
        diveT.set(p.id, t + 0.6)
      }
      const owner = ps.find((o) => o.hasBall)
      const bd = Math.hypot(b.x - p.x, b.z - p.z)
      if (bd < reach && owner && owner.team !== p.team) {
        const fx = Math.sin(owner.facing)
        const fz = Math.cos(owner.facing)
        const behind = (p.x - owner.x) * fx + (p.z - owner.z) * fz < -0.3 * bd
        const ok = rand() < (a.type === 'tackle' ? 0.5 : 0.6)
        if (ok) {
          owner.hasBall = false
          noPickup = owner.id
          noPickupT = t + 0.5
          const ang = rand() * Math.PI * 2
          b.vx = Math.cos(ang) * 3 + (b.x - owner.x) * 2
          b.vz = Math.sin(ang) * 3 + (b.z - owner.z) * 2
          touch(p, 'tackle')
          mockStats.tackleOk++
        } else mockStats.tackleMiss++
        const hit = !ok || behind
        if (hit && rand() < (a.type === 'slide' ? 0.7 : 0.45)) {
          game.emit({
            type: 'contact',
            a: p.id,
            b: owner.id,
            ballFirst: ok && !behind,
            fromBehind: behind,
            intensity: (a.type === 'slide' ? 0.45 : 0.3) + rand() * 0.35,
            kind: a.type,
            x: owner.x,
            z: owner.z,
          })
          mockStats.fouls++
        }
      } else mockStats.tackleMiss++
    } else if (a.type === 'dive' && p.role === 'kaleci') {
      const pd = Math.hypot(a.aim.x - p.x, a.aim.z - p.z) || 1
      const v = Math.min(7, pd / 0.35)
      p.vx = ((a.aim.x - p.x) / pd) * v
      p.vz = ((a.aim.z - p.z) / pd) * v
      p.actionLock = 0.9
      diveT.set(p.id, t + 0.45)
    }
  }

  // duran topta kimse topu tutmaz (kurallar yerlestirir)
  if (game.match.phase !== 'play') {
    for (const p of ps) p.hasBall = false
    return
  }
  // sahiplik
  const owner = ps.find((o) => o.hasBall)
  if (owner) {
    const keeperHold = owner.role === 'kaleci'
    const fx = Math.sin(owner.facing)
    const fz = Math.cos(owner.facing)
    if (keeperHold) {
      b.x = owner.x + fx * 0.3
      b.z = owner.z + fz * 0.3
      b.y = 1.0
      b.vx = owner.vx
      b.vz = owner.vz
      b.vy = 0
    } else {
      const tx = owner.x + fx * 0.55
      const tz = owner.z + fz * 0.55
      b.vx = owner.vx + (tx - b.x) * 9
      b.vz = owner.vz + (tz - b.z) * 9
      if (b.y < 0.3) b.vy = Math.min(b.vy, 0)
    }
    b.wx = b.wy = b.wz = 0
    if (Math.hypot(b.x - owner.x, b.z - owner.z) > 1.6) owner.hasBall = false
    return
  }
  const bs = Math.hypot(b.vx, b.vy, b.vz)
  let best: Player | null = null
  let bd = 1e9
  for (const p of ps) {
    if (p.sentOff || (p.id === noPickup && t < noPickupT)) continue
    // yeni vurulmus top: ilk 0.12 s yalniz cok yakindaki engel alir
    if (t < noPickupT - 0.23 && Math.hypot(b.x - p.x, b.z - p.z) > 0.4) continue
    const keeper = p.role === 'kaleci'
    const gx = -game.match.attackDir[p.team] * HL
    const inBox = keeper && Math.abs(p.x - gx) < 8 && Math.abs(p.z) < 8
    const reach = inBox ? (diveT.get(p.id) ?? -1) > t ? 1.3 : 0.95 : 0.75
    const hmax = inBox ? 2.4 : 0.7
    const d = Math.hypot(b.x - p.x, b.z - p.z)
    if (d > reach || b.y > hmax) continue
    // kaleci: hizli sut kurtarisa (sektirme) doner
    if (inBox && bs > 22 && game.match.lastTouch?.team !== p.team) {
      const n = Math.hypot(b.vx, b.vz) || 1
      b.vx = (-b.vx / n) * 6 + (rand() - 0.5) * 6
      b.vz = (b.vz / n) * 4 + (rand() < 0.5 ? -5 : 5)
      b.vy = 2
      noPickup = p.id
      noPickupT = t + 0.4
      touch(p, 'save')
      mockStats.saves++
      continue
    }
    if (!inBox && bs > 16) continue
    if (d < bd) {
      bd = d
      best = p
    }
  }
  if (best) {
    best.hasBall = true
    if (best.role === 'kaleci' && game.match.lastTouch?.team !== best.team) mockStats.catches++
    touch(best)
  }
}

export const keeperBoxOk = (x: number, z: number, side: number) => Math.abs(x - side * HL) < 8 && Math.abs(z) < GOAL_W
