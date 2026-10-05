// Prosedurel lokomosyon: hiza gore adim frekansi; basma fazinda ayak, govde hizinin tam tersi
// hizla geri kayar -> zeminde kayma yok. Yerel hiz: x = sol, z = ileri (m/s).
import { Pose } from './pose'
import type { Dims } from './rig'

type Tab = [number, number][]
function lut(t: Tab, x: number) {
  if (x <= t[0][0]) return t[0][1]
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, y0] = t[i - 1]
      const [x1, y1] = t[i]
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return t[t.length - 1][1]
}

// dongu/s (iki adim). Kosu 5 m/s ~ 170 adim/dk
const CADENCE: Tab = [[0, 0.8], [1.4, 0.92], [3, 1.3], [5, 1.45], [8, 1.9], [10, 2.1]]
const STANCE: Tab = [[0, 0.64], [1.5, 0.6], [2.6, 0.44], [5, 0.37], [8, 0.3]]
const LIFT: Tab = [[0, 0], [0.4, 0.05], [1.5, 0.09], [3, 0.16], [5, 0.24], [8, 0.3]]
const DROP: Tab = [[0, 0.015], [1.5, 0.02], [3, 0.03], [6, 0.042], [9, 0.055]]
const BOUNCE: Tab = [[0, 0], [1.4, -0.015], [2.3, 0], [3, 0.02], [8, 0.028]]
const LEAN: Tab = [[0, 0.02], [1.5, 0.05], [3, 0.13], [5, 0.21], [8, 0.3]]
const ARMSWING: Tab = [[0, 0], [1.4, 0.32], [3, 0.55], [5, 0.75], [8, 1.0]]
const ELBOW: Tab = [[0, 0.22], [1.4, 0.35], [2.6, 1.15], [8, 1.35]]
const RUNNESS: Tab = [[0, 0], [2, 0], [3.2, 1]]

// Salinim fazi (w: 0 = parmak kalkisi, 1 = topuk temasi) referans eklem acilari (rad).
// Yurume: Winter (2009) sagittal ortalamalar; kosu ~4.5 m/s ve sprint ~8 m/s: Novacheck (1998).
type Curve = [number, number][]
const HIP_W: Curve = [[0, -0.17], [0.35, 0.18], [0.7, 0.36], [1, 0.3]]
const KNEE_W: Curve = [[0, 0.62], [0.25, 1.05], [0.6, 0.45], [0.85, 0.12], [1, 0.06]]
const HIP_R: Curve = [[0, -0.3], [0.35, 0.3], [0.75, 0.8], [1, 0.65]]
const KNEE_R: Curve = [[0, 0.4], [0.35, 1.75], [0.65, 1.1], [0.85, 0.55], [1, 0.38]]
const HIP_S: Curve = [[0, -0.35], [0.3, 0.45], [0.7, 1.15], [1, 0.9]]
const KNEE_S: Curve = [[0, 0.45], [0.33, 2.2], [0.6, 1.4], [0.85, 0.7], [1, 0.42]]
// hiz -> egri karisimi (yurume / kosu / sprint)
function curveAt(w: number, s: number, a: Curve, b: Curve, c: Curve) {
  const k1 = Math.min(1, Math.max(0, (s - 1.6) / 2.4))
  const k2 = Math.min(1, Math.max(0, (s - 5) / 3))
  const ya = lut(a, w)
  const yb = lut(b, w)
  const yc = lut(c, w)
  return ya + (yb - ya) * k1 + (yc - yb) * k2
}

export class GaitState {
  phase = Math.random()
  t = Math.random() * 10 // nefes icin
  // yumusatilmis ivme (yerel)
  ax = 0
  az = 0
  // son karenin bacak fazlari (dokunus zamanlamasi icin)
  u = [0, 0.5]
  beta = 0.6
  f = 1
  shuffle = 0 // 0..1 jokey: yan adimda bacaklar caprazlanmaz
}

const smooth = (w: number) => w * w * (3 - 2 * w)

/**
 * vx, vz: yerel hiz (m/s); dribble: 0..1 (top surme durusu)
 * out'a tam govde pozu yazar.
 */
export function gait(out: Pose, st: GaitState, vx: number, vz: number, dt: number, d: Dims, dribble = 0): Pose {
  const s = Math.hypot(vx, vz)
  const run = lut(RUNNESS, s)
  const f = lut(CADENCE, s) * (1 + 0.15 * dribble)
  st.phase = (st.phase + f * dt) % 1
  st.t += dt
  const beta = lut(STANCE, s)
  const Ts = beta / f // basma suresi
  const lift = lut(LIFT, s) * (1 - 0.35 * dribble)
  const amp = Math.min(1, s / 0.8) // durgunken salinimlar sonuk
  const fwd = s > 1e-3 ? vz / s : 1
  const lat = s > 1e-3 ? vx / s : 0
  const backward = Math.max(0, -fwd) // geri geri yururken kollar/egim azalir

  // pelvis yuksekligi (salinim ayaginin FK konumu icin once)
  const midSt = 4 * Math.PI * (st.phase - beta / 2)
  const crouch = lut(DROP, s) + 0.06 * dribble
  const hy = -crouch - lut(BOUNCE, s) * Math.cos(midSt)
  const hipY = d.hipH + hy
  const footW = d.hipW * (1.08 - 0.45 * run)
  const legPh = [st.phase, (st.phase + 0.5) % 1]
  st.u[0] = legPh[0]
  st.u[1] = legPh[1]
  st.beta = beta
  st.f = f
  for (let i = 0; i < 2; i++) {
    const L = out.legs[i]
    const u = legPh[i]
    const sg = i === 0 ? 1 : -1
    L.ik = 1
    L.flex = L.abd = L.knee = L.twist = 0
    L.yaw = 0.12 * (1 - run) // durusta burun hafif disa
    let off: number
    let y = 0
    let pitch: number
    let toe = 0
    if (u < beta) {
      const k = u / beta
      // kosuda ayak govdenin hemen onune basar, arkada birakir
      off = 0.5 - k - 0.12 * run
      // topuk basar -> duz -> parmak ucundan itis
      pitch = k < 0.25 ? 0.25 * (1 - k / 0.25) * (1 - run * 0.6) : -(((k - 0.25) / 0.75) ** 2) * (0.55 + 0.35 * run)
      toe = k > 0.6 ? (k - 0.6) * 1.6 * (0.6 + 0.4 * run) : 0
      // parmak ucunda kalkis: bilek yukselir
      y = k > 0.55 ? ((k - 0.55) / 0.45) ** 2 * 0.09 * (0.6 + run) : 0
    } else {
      const w = (u - beta) / (1 - beta)
      off = -0.5 - 0.12 * run + smooth(w)
      // hiz eslesmeli uc noktalar arasi yol
      let along = s * Ts * off
      y = lift * Math.sin(Math.PI * Math.pow(w, 0.75))
      // referans kalca/diz acilarindan FK bilek konumu (kalcaya gore, hareket yonunde)
      const hf = curveAt(w, s, HIP_W, HIP_R, HIP_S)
      const kf = curveAt(w, s, KNEE_W, KNEE_R, KNEE_S)
      const fa = d.thigh * Math.sin(hf) + d.calf * Math.sin(hf - kf)
      const fy = hipY - (d.thigh * Math.cos(hf) + d.calf * Math.cos(hf - kf))
      // ortada egri, uclarda yol (temas ve kalkista sureklilik)
      const bw = Math.pow(Math.sin(Math.PI * w), 0.6) * Math.min(1, s / 1.2)
      along += (fa - along) * bw
      y += (Math.max(0, fy - d.ankleH) - y) * bw
      off = s > 1e-3 ? along / (s * Ts) : off
      pitch = w < 0.5 ? -0.6 * (1 - w / 0.5) * (0.5 + run) : 0.18 * ((w - 0.5) / 0.5)
    }
    L.x = sg * footW + vx * Ts * off
    L.z = vz * Ts * off
    L.y = d.ankleH + y * amp
    L.pitch = pitch * amp
    L.toe = toe * amp
  }

  // jokey: yan adimda salinan ayak duran ayagin otesine gecmez (kayma adimi)
  if (st.shuffle > 0.01) {
    const gap = d.hipW * 1.1
    const [Lf, Rf] = out.legs
    const swingL = legPh[0] >= beta
    const swingR = legPh[1] >= beta
    if (swingL && !swingR && Lf.x < Rf.x + gap) Lf.x += (Rf.x + gap - Lf.x) * st.shuffle
    if (swingR && !swingL && Rf.x > Lf.x - gap) Rf.x += (Lf.x - gap - Rf.x) * st.shuffle
  }

  // pelvis: yukseklik, sekme, yaw
  const th0 = 2 * Math.PI * legPh[0]
  out.hx = 0.012 * Math.sin(th0) * (1 - run) * amp
  out.hy = hy
  out.hz = 0
  const lean = lut(LEAN, s) * (1 - backward) + 0.1 * dribble
  // ivme egimi: hizlanirken one, frenlerken geriye
  const accLean = Math.max(-0.2, Math.min(0.25, st.az * 0.035))
  out.hp = lean * 0.5 + accLean * 0.5
  out.hyaw = -0.13 * Math.cos(th0) * amp * (0.5 + 0.5 * run)
  // donuste merkezcil ivmeye dogru yatma (yerel ax: + sola)
  const turnLean = Math.max(-0.35, Math.min(0.35, -st.ax * 0.045))
  out.hr = -0.04 * Math.sin(th0) * amp + turnLean * 0.6 + lat * 0.05 * run
  out.sp = lean * 0.5 + accLean * 0.5 + 0.12 * dribble
  out.syaw = -out.hyaw * 1.5
  out.sr = turnLean * 0.4 - (out.hr - turnLean * 0.6) * 0.6
  // bas: one egimi telafi et, surmede topa bak
  out.np = -(out.hp + out.sp) * 0.7 + 0.35 * dribble + 0.04
  out.nyaw = -out.syaw * 0.5 - out.hyaw * 0.5

  // kollar: bacaklarin tersine salinir
  const as = lut(ARMSWING, s) * (1 - 0.5 * backward)
  const el = lut(ELBOW, s)
  const breath = Math.sin(st.t * 1.6) * 0.015
  for (let i = 0; i < 2; i++) {
    const A = out.arms[i]
    const ph = 2 * Math.PI * legPh[i]
    const c = Math.cos(ph)
    // kosuda kol geriye daha cok gider; geride dirsek acilir, onde kapanir
    A.flex = -as * c - 0.18 * run
    // geride kol hafif disa acilir, onde govde ortasina dogru gelir
    A.abd = 0.15 + 0.1 * run * Math.max(0, c) + 0.15 * dribble + breath * (1 - run)
    A.elbow = el - 0.5 * run * Math.max(0, c) + 0.2 * run * Math.max(0, -c)
    A.twist = 0.25 * run
    A.ik = 0
    A.shrug = 0
  }
  // durgun: hafif nefes
  out.sp += breath * (1 - amp)
  return out
}

export const newPose = () => new Pose()
