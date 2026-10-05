// Top dinamigi: hava direnci, Magnus, donme, zemin/direk temasi (durtu tabanli).
import { BALL_R } from '../pitch'

export const G = -9.81
export const BALL_MASS = 0.43
const INV_M = 1 / BALL_MASS
// ince kabuklu kure: I = 2/3 m R^2
const INERTIA = (2 / 3) * BALL_MASS * BALL_R * BALL_R
const INV_I = 1 / INERTIA
const AIR_K = (0.5 * 1.2 * Math.PI * BALL_R * BALL_R) / BALL_MASS // 0.5 rho A / m

export const GROUND_E = 0.58 // zemin sekme katsayisi
const GROUND_MU = 0.5 // sekmede teğetsel surtunme
const ROLL_MU = 0.4 // kayarken Coulomb surtunmesi (cim)
const ROLL_C0 = 0.9 // yuvarlanma direnci: a = C0 + C1*v (m/s^2)
const ROLL_C1 = 0.09
const SPIN_TAU_AIR = 4 // havada donme sonumu (s)

export interface BallState {
  x: number
  y: number
  z: number
  px: number
  py: number
  pz: number
  vx: number
  vy: number
  vz: number
  wx: number
  wy: number
  wz: number
  q: { x: number; y: number; z: number; w: number }
}

export function newBall(): BallState {
  return {
    x: 0, y: BALL_R, z: 0, px: 0, py: BALL_R, pz: 0,
    vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    q: { x: 0, y: 0, z: 0, w: 1 },
  }
}

// Havadaki kuvvetler: karesel surukleme (Cd hiza bagli, kritik alti/ustu) + Magnus.
export function airStep(b: BallState, h: number) {
  const v2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz
  const v = Math.sqrt(v2)
  if (v > 1e-4) {
    const cd = 0.24 + 0.2 / (1 + Math.exp((v - 11) / 1.5))
    const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz
    const w = Math.sqrt(w2)
    const kd = AIR_K * cd * v
    let ax = -kd * b.vx
    let ay = -kd * b.vy
    let az = -kd * b.vz
    if (w > 1e-3) {
      // C_L ~ spin orani S = Rw/v ile doyan dogrusal
      const S = (BALL_R * w) / v
      const cl = Math.min(0.32, 1.1 * S)
      // yon: w^ x v^, buyukluk 0.5 rho A CL v^2 / m
      const cx = b.wy * b.vz - b.wz * b.vy
      const cy = b.wz * b.vx - b.wx * b.vz
      const cz = b.wx * b.vy - b.wy * b.vx
      const cn = Math.sqrt(cx * cx + cy * cy + cz * cz)
      if (cn > 1e-9) {
        const km = (AIR_K * cl * v2) / cn
        ax += km * cx
        ay += km * cy
        az += km * cz
      }
    }
    b.vx += ax * h
    b.vy += ay * h
    b.vz += az * h
  }
  b.vy += G * h
  const dw = Math.exp(-h / SPIN_TAU_AIR)
  b.wx *= dw
  b.wy *= dw
  b.wz *= dw
}

// Temas durtusu: n top merkezine dogru birim normal, e sekme, mu teğetsel surtunme.
// Teğetsel durtu kaymayi en fazla sifirlar; kalan kisim spine donusur.
export function contactImpulse(b: BallState, nx: number, ny: number, nz: number, e: number, mu: number) {
  const vn = b.vx * nx + b.vy * ny + b.vz * nz
  if (vn >= 0) return
  const rx = -BALL_R * nx
  const ry = -BALL_R * ny
  const rz = -BALL_R * nz
  // temas noktasi hizi v + w x r
  const cvx = b.vx + (b.wy * rz - b.wz * ry)
  const cvy = b.vy + (b.wz * rx - b.wx * rz)
  const cvz = b.vz + (b.wx * ry - b.wy * rx)
  const cn = cvx * nx + cvy * ny + cvz * nz
  const tx = cvx - cn * nx
  const ty = cvy - cn * ny
  const tz = cvz - cn * nz
  const slip = Math.sqrt(tx * tx + ty * ty + tz * tz)
  const jn = -(1 + e) * BALL_MASS * vn
  let jx = jn * nx
  let jy = jn * ny
  let jz = jn * nz
  if (slip > 1e-6) {
    const jt = Math.min(mu * jn, (2 * BALL_MASS * slip) / 5) / slip
    jx -= jt * tx
    jy -= jt * ty
    jz -= jt * tz
  }
  applyImpulse(b, rx, ry, rz, jx, jy, jz)
}

function applyImpulse(b: BallState, rx: number, ry: number, rz: number, jx: number, jy: number, jz: number) {
  b.vx += jx * INV_M
  b.vy += jy * INV_M
  b.vz += jz * INV_M
  b.wx += (ry * jz - rz * jy) * INV_I
  b.wy += (rz * jx - rx * jz) * INV_I
  b.wz += (rx * jy - ry * jx) * INV_I
}

// Zemin temasi (hiz duzeyi). v0y: carpismadan onceki dusey hiz.
export function groundContact(b: BallState, v0y: number, h: number, e = GROUND_E) {
  if (v0y < -0.8) {
    b.vy = v0y
    contactImpulse(b, 0, 1, 0, e, GROUND_MU)
    return
  }
  if (b.vy < 0) b.vy = 0
  // kayma hizi: v + w x (0,-R,0)
  const sx = b.vx + BALL_R * b.wz
  const sz = b.vz - BALL_R * b.wx
  const slip = Math.hypot(sx, sz)
  if (slip > 0.04) {
    // kayma -> yuvarlanma gecisi: Coulomb surtunmesi
    const j = Math.min(ROLL_MU * BALL_MASS * -G * h, (2 * BALL_MASS * slip) / 5) / slip
    applyImpulse(b, 0, -BALL_R, 0, -j * sx, 0, -j * sz)
  } else {
    // saf yuvarlanma: yuvarlanma direnci, donme hizla uyumlu
    const sp = Math.hypot(b.vx, b.vz)
    if (sp < 0.03) {
      b.vx = b.vz = 0
    } else {
      const f = Math.max(0, 1 - ((ROLL_C0 + ROLL_C1 * sp) * h) / sp)
      b.vx *= f
      b.vz *= f
    }
    b.wx = b.vz / BALL_R
    b.wz = -b.vx / BALL_R
  }
  b.wy *= Math.exp(-4 * h)
}

// Yonelim: dq/dt = 0.5 (w,0) * q (dunya cercevesi)
export function integrateSpin(b: BallState, h: number) {
  const q = b.q
  const ax = b.wx * 0.5 * h
  const ay = b.wy * 0.5 * h
  const az = b.wz * 0.5 * h
  const x = q.x + ax * q.w + ay * q.z - az * q.y
  const y = q.y + ay * q.w + az * q.x - ax * q.z
  const z = q.z + az * q.w + ax * q.y - ay * q.x
  const w = q.w - (ax * q.x + ay * q.y + az * q.z)
  const l = 1 / Math.sqrt(x * x + y * y + z * z + w * w)
  q.x = x * l
  q.y = y * l
  q.z = z * l
  q.w = w * l
}

// Yalniz hava + zemin ile serbest ucus adimi (nisan cozucusu icin).
export function freeStep(b: BallState, h: number) {
  airStep(b, h)
  const v0y = b.vy
  b.x += b.vx * h
  b.y += b.vy * h
  b.z += b.vz * h
  if (b.y <= BALL_R) {
    b.y = BALL_R
    groundContact(b, v0y, h)
  }
}
