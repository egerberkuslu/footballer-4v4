// Hakem hareketi (saf mantik, React/three yok): oyunu ~8-12 m geriden, capraz izler,
// kalabaliga girmez, topun yolundan cekilir. Yalniz game.referee alanlarini yazar.
import { PITCH_L, PITCH_W } from '../pitch'
import type { Player, RefAnim, Referee } from '../game/types'

const HL = PITCH_L / 2
const HW = PITCH_W / 2
const R_FOLLOW = 10 // tercih edilen top uzakligi
const V_JOG = 3.2
const V_RUN = 7.2
const V_GOTO = 9 // VAR monitorune kosu hizi (m/s)
const ACC = 7 // m/s^2
const ACC_GOTO = 12 // VAR monitoru: hedefe yonelirken daha atik ivme
const TURN = 6 // rad/s
const PERSONAL = 2.6 // oyunculara asgari mesafe
const BALL_LANE = 2.2 // top yolundan cekilme mesafesi
const RETARGET = 0.45 // aday noktalar bu aralikla yeniden puanlanir (s)

export interface RefCtx {
  ball: { x: number; z: number; vx: number; vz: number }
  players: Player[]
  attackDir: 1 | -1 // topa sahip takimin hucum yonu
  focus: { x: number; z: number } | null // duran topta gidilecek nokta (faul yeri vb.)
  goto?: { x: number; z: number; facing: number } | null // tam hedef (VAR monitoru); varinca bu yone bakar
}

export class RefereeBrain {
  tx = 0
  tz = -9
  private retarget = 0
  gesture: RefAnim | null = null
  gestureT = 0

  /** jest: whistle, point, card-*, advantage; sure bitince kosuya doner */
  gestureFor(a: RefAnim, t: number) {
    this.gesture = a
    this.gestureT = t
  }

  clearGesture() {
    this.gesture = null
    this.gestureT = 0
  }

  /** hedefe vardi mi (VAR monitoru) */
  at(ref: Referee, x: number, z: number, r = 0.6) {
    return Math.hypot(x - ref.x, z - ref.z) < r
  }

  update(ref: Referee, c: RefCtx, dt: number) {
    if (dt <= 0) return
    const b = c.ball
    this.retarget -= dt
    if (c.goto) {
      this.tx = c.goto.x
      this.tz = c.goto.z
    } else if (c.focus) {
      // duran top: noktaya 2.5 m mesafede, saha ortasina dogru dur
      const cx = -c.focus.x
      const cz = -c.focus.z
      const l = Math.hypot(cx, cz) || 1
      this.tx = c.focus.x + (cx / l) * 2.5
      this.tz = c.focus.z + (cz / l) * 2.5
    } else if (this.retarget <= 0) {
      this.retarget = RETARGET
      this.pickTarget(ref, c)
    }

    // istenen hiz: hedefe yaklas, varinca yavasla
    let dx = this.tx - ref.x
    let dz = this.tz - ref.z
    const dist = Math.hypot(dx, dz)
    const vrun = c.goto ? V_GOTO : V_RUN
    const vmax = dist > 6 ? vrun : dist > 1.5 ? V_JOG + (vrun - V_JOG) * ((dist - 1.5) / 4.5) : V_JOG * (dist / 1.5)
    let wx = dist > 1e-3 ? (dx / dist) * vmax : 0
    let wz = dist > 1e-3 ? (dz / dist) * vmax : 0

    // oyunculardan uzak dur (yumusak itme)
    for (const p of c.players) {
      if (p.sentOff) continue
      dx = ref.x - p.x
      dz = ref.z - p.z
      const d = Math.hypot(dx, dz)
      if (d < PERSONAL && d > 1e-4) {
        const k = ((PERSONAL - d) / PERSONAL) * 6
        wx += (dx / d) * k
        wz += (dz / d) * k
      }
    }
    // topun onumuzdeki 1.2 s'lik yolundan cekil
    const sp = Math.hypot(b.vx, b.vz)
    if (sp > 2) {
      const T = 1.2
      const ex = b.vx * T
      const ez = b.vz * T
      const l2 = ex * ex + ez * ez
      let u = ((ref.x - b.x) * ex + (ref.z - b.z) * ez) / l2
      u = u < 0 ? 0 : u > 1 ? 1 : u
      const qx = ref.x - (b.x + ex * u)
      const qz = ref.z - (b.z + ez * u)
      const d = Math.hypot(qx, qz)
      if (d < BALL_LANE) {
        // dik yonde, bulundugu yana kac
        let nx = -b.vz / sp
        let nz = b.vx / sp
        if (nx * qx + nz * qz < 0) {
          nx = -nx
          nz = -nz
        }
        const k = ((BALL_LANE - d) / BALL_LANE) * 9
        wx += nx * k
        wz += nz * k
      }
    }
    const wl = Math.hypot(wx, wz)
    if (wl > vrun) {
      wx = (wx / wl) * vrun
      wz = (wz / wl) * vrun
    }
    // ivme siniri
    let ax = (wx - ref.vx) / dt
    let az = (wz - ref.vz) / dt
    const al = Math.hypot(ax, az)
    const amax = c.goto ? ACC_GOTO : ACC
    if (al > amax) {
      ax = (ax / al) * amax
      az = (az / al) * amax
    }
    ref.vx += ax * dt
    ref.vz += az * dt
    ref.x += ref.vx * dt
    ref.z += ref.vz * dt
    // saha icinde (kenarda yarim metre pay); monitore giderken plaka icinde
    const mx = c.goto ? HL + 3.5 : HL - 0.5
    const mz = c.goto ? HW + 4 : HW - 0.5
    ref.x = Math.max(-mx, Math.min(mx, ref.x))
    ref.z = Math.max(-HW - (c.goto ? 4 : 0.5), Math.min(mz, ref.z))

    // bakis: topa dogru (monitordeyken monitore), sinirli donus hiziyla
    const arrived = !!c.goto && Math.hypot(c.goto.x - ref.x, c.goto.z - ref.z) < 0.6
    const want = arrived ? c.goto!.facing : c.goto ? Math.atan2(c.goto.x - ref.x, c.goto.z - ref.z) : Math.atan2(b.x - ref.x, b.z - ref.z)
    let da = want - ref.facing
    da = Math.atan2(Math.sin(da), Math.cos(da))
    const mt = TURN * dt
    ref.facing += da > mt ? mt : da < -mt ? -mt : da

    // animasyon durumu
    let anim: RefAnim
    if (this.gesture && this.gestureT > 0) {
      this.gestureT -= dt
      anim = this.gesture
      if (this.gestureT <= 0) this.gesture = null
    } else {
      const v = Math.hypot(ref.vx, ref.vz)
      anim = v < 0.35 ? 'idle' : v < 3.6 ? 'jog' : 'run'
    }
    if (anim !== ref.anim) {
      ref.anim = anim
      ref.animT = 0
    } else ref.animT += dt
  }

  // Top cevresinde 12 aday noktayi puanla: hucumun gerisi + karsi kanat (capraz sistem),
  // oyunculardan uzak, sut/pas koridorunun disinda, mevcut konuma yakin.
  private pickTarget(ref: Referee, c: RefCtx) {
    const b = c.ball
    const d = c.attackDir
    const side = b.z >= 0 ? -1 : 1
    let px = -d
    let pz = side * 0.85
    const pl = Math.hypot(px, pz)
    px /= pl
    pz /= pl
    const gx = d * HL // hucum edilen kale
    let best = -1e9
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      for (const R of [R_FOLLOW - 2, R_FOLLOW + 1]) {
        const cx = Math.cos(a)
        const cz = Math.sin(a)
        const x = Math.max(-HL + 1, Math.min(HL - 1, b.x + cx * R))
        const z = Math.max(-HW + 0.5, Math.min(HW - 0.8, b.z + cz * R))
        let s = 3 * (cx * px + cz * pz)
        let near = 5
        for (const p of c.players) {
          if (p.sentOff) continue
          near = Math.min(near, Math.hypot(p.x - x, p.z - z))
        }
        s += near * 0.8
        // top -> kale koridoru
        const ex = gx - b.x
        const ez = -b.z
        const l2 = ex * ex + ez * ez || 1
        let u = ((x - b.x) * ex + (z - b.z) * ez) / l2
        u = u < 0 ? 0 : u > 1 ? 1 : u
        const lane = Math.hypot(x - (b.x + ex * u), z - (b.z + ez * u))
        if (lane < 3) s -= (3 - lane) * 1.5
        // gerceklesen uzaklik (kenara kirpma) tercih edilenden sapmasin
        const real = Math.hypot(x - b.x, z - b.z)
        s -= Math.abs(real - R_FOLLOW) * 0.35
        s -= Math.hypot(x - ref.x, z - ref.z) * 0.12
        if (s > best) {
          best = s
          this.tx = x
          this.tz = z
        }
      }
    }
  }
}
