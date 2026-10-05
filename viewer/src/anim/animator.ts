// Karakter basina animasyon durumu: lokomosyon + aksiyon klibi + gecis karisimi + top dokunusu ve el IK.
import { clipInfo, sampleClip } from './actions'
import { gait, GaitState } from './gait'
import { copyPose, lerpBody, lerpPose, lerpUpper, Pose } from './pose'
import type { Dims } from './rig'

const LOCO = new Set(['idle', 'jog', 'run', 'sprint', 'dribble', 'walk'])
const FADE = 0.16

export interface BallLocal {
  x: number // karakter uzayi: sol +
  y: number // zeminden
  z: number // ileri +
  dive?: boolean // kaleci dalisi: el hedefi (eldiven ucu), bilek hedefi eldiven boyu kadar geride
}

export class Animator {
  readonly pose = new Pose()
  private gaitSt = new GaitState()
  private loco = new Pose()
  private clip = new Pose()
  private from = new Pose()
  private mix = new Pose()
  private fadeT = 1
  private fadeLen = FADE
  private anim = 'idle'
  private clipName = 'idle'
  private lastAction = ''
  private ownT = 0
  private prevAnimT = 0
  private dribble = 0
  // top dokunusu (yerel ayak hedefi)
  private touchT = 9
  private touchX = 0
  private touchZ = 0
  private touchLeg = 1
  private handW = 0

  private d: Dims
  constructor(d: Dims) {
    this.d = d
  }

  /** her ayagin salinim sonuna kalan sure (s): 0 sol, 1 sag */
  contactIn(leg: 0 | 1): number {
    return (1 - this.gaitSt.u[leg]) / Math.max(0.1, this.gaitSt.f)
  }

  /** test: adim fazini sabitle */
  setPhase(p: number) {
    this.gaitSt.phase = p
  }

  /** dokunus olayi: top karakter uzayinda (x sol, z ileri) */
  touch(bx: number, bz: number) {
    this.touchT = 0
    this.touchX = bx
    this.touchZ = bz
    // salinim sonuna en yakin (ya da yeni basmis) ayak
    const r = (i: number) => {
      const u = this.gaitSt.u[i]
      return u >= this.gaitSt.beta ? 1 - u : u + 0.3
    }
    this.touchLeg = Math.abs(bx) > 0.25 ? (bx > 0 ? 0 : 1) : r(0) < r(1) ? 0 : 1
  }

  /** oyun anim adi -> klip adi (kalkis, onceki aksiyona gore) */
  private resolve(anim: string) {
    if (anim === 'getup' && this.lastAction.startsWith('keeper-dive')) {
      return this.lastAction.endsWith('-r') ? 'getup-side-r' : 'getup-side-l'
    }
    // kayarak mudahaleden sonra oturur durustan kalkis
    if (anim === 'getup' && this.lastAction === 'slide') return 'getup-sit'
    return anim
  }

  /**
   * anim: oyun durumundaki animasyon adi; animT: oyunun sayaci (yoksa kendi sayacimiz)
   * vx,vz / ax,az: yerel hiz ve ivme; ball: yerel top konumu ya da null
   */
  update(anim: string, animT: number, vx: number, vz: number, ax: number, az: number, dt: number, ball: BallLocal | null, hasBall: boolean, diveHy: number | null = null) {
    // ayni klip yeniden baslatildiysa (sayac geri sardi) de gecis yap
    const restarted = anim === this.anim && animT + 0.05 < this.prevAnimT
    this.prevAnimT = animT
    if (anim !== this.anim || restarted) {
      if (!LOCO.has(this.anim) && this.anim !== 'getup') this.lastAction = this.anim
      copyPose(this.pose, this.from)
      this.fadeT = 0
      this.anim = anim
      this.clipName = this.resolve(anim)
      this.fadeLen = clipInfo(this.d, this.clipName)?.fadeIn ?? FADE
      this.ownT = 0
    }
    this.ownT += dt
    const t = animT > 0 ? animT : this.ownT

    const wantDr = anim === 'dribble' ? 1 : 0
    this.gaitSt.shuffle += ((anim === 'jockey' ? 1 : 0) - this.gaitSt.shuffle) * Math.min(1, dt * 8)
    this.dribble += (wantDr - this.dribble) * Math.min(1, dt * 6)
    const k = Math.min(1, dt * 5)
    this.gaitSt.ax += (ax - this.gaitSt.ax) * k
    this.gaitSt.az += (az - this.gaitSt.az) * k
    gait(this.loco, this.gaitSt, vx, vz, dt, this.d, this.dribble)
    this.footToBall(ball, hasBall, dt)

    let out = this.loco
    let handMax = 0
    if (!LOCO.has(anim)) {
      const w = sampleClip(this.d, this.clipName, t, this.clip)
      const info = clipInfo(this.d, this.clipName)
      if (info?.mode === 'upper') out = lerpUpper(this.loco, this.clip, w, this.mix)
      else if (info?.mode === 'body') out = lerpBody(this.loco, this.clip, w, this.d.hipW * 1.08, this.mix)
      else out = lerpPose(this.loco, this.clip, w, this.mix)
      handMax = (info?.hands ?? 0) * w
    }
    // kaleci dalisi: pelvis yuksekligi B2'nin parabolunden (klibin kendi hy'si yerine)
    if (diveHy !== null && !LOCO.has(anim)) out.hy = diveHy
    this.ballHands(out, ball, handMax, dt)
    if (this.fadeT < 1) {
      this.fadeT = Math.min(1, this.fadeT + dt / this.fadeLen)
      const s = this.fadeT * this.fadeT * (3 - 2 * this.fadeT)
      lerpPose(this.from, out, s, this.pose)
    } else copyPose(out, this.pose)
    return this.pose
  }

  /** kaleci: top uzanma menzilindeyse eller topa kilitlenir */
  private ballHands(p: Pose, ball: BallLocal | null, max: number, dt: number) {
    let want = 0
    if (ball && max > 0) {
      // gogus-top uzakligi (govde yana yatmissa da kaba olcu yeter)
      const r = Math.hypot(ball.x - p.hx, ball.y - 1.25 - p.hy, ball.z - p.hz)
      want = max * Math.min(1, Math.max(0, (2.2 - r) / 0.6))
    }
    this.handW += (want - this.handW) * Math.min(1, dt * 14)
    if (this.handW < 0.01 || !ball) return
    for (let i = 0; i < 2; i++) {
      const A = p.arms[i]
      const sg = i === 0 ? 1 : -1
      A.ik = this.handW
      if (ball.dive) {
        // dalis: eldiven ucu hedefe varsin; bilek, gogusten hedefe dogrultuda eldiven boyu (0,1 m) geride, eller bitisik
        let dx = ball.x - p.hx
        let dy = ball.y - 1.25 - p.hy
        let dz = ball.z - p.hz
        const dl = Math.hypot(dx, dy, dz) || 1
        dx /= dl
        dy /= dl
        dz /= dl
        A.tx = ball.x - dx * 0.1 + sg * 0.05
        A.ty = ball.y - dy * 0.1
        A.tz = ball.z - dz * 0.1
        continue
      }
      // bilekler topun iki yaninda, hafif arkasinda (avuc topu sarar)
      A.tx = ball.x + sg * 0.15
      A.ty = ball.y + 0.02
      A.tz = ball.z - 0.07
    }
  }

  /**
   * surme: topa sahipken salinimdaki ayak, one inis anina yaklastikca topun arkasina yonelir (dokunus F'nin
   * footTiming'e gore zamanladigi ana denk gelir); dokunus olayindan sonra kisa bir izleme.
   */
  private footToBall(ball: BallLocal | null, hasBall: boolean, dt: number) {
    this.touchT += dt
    const st = this.gaitSt
    const ah = this.d.ankleH
    if (ball && hasBall && this.dribble > 0.05 && ball.z > 0.05 && ball.z < 1.0 && Math.abs(ball.x) < 0.5) {
      for (let i = 0; i < 2; i++) {
        const L = this.loco.legs[i]
        const u = st.u[i]
        // salinimin son %35'i ve basmanin ilk %15'i
        const r = u >= st.beta ? (1 - u) / (1 - st.beta) : -u / st.beta
        if (r > 0.35 || r < -0.15) continue
        const w = (r >= 0 ? 1 - r / 0.35 : 1 + r / 0.15) * this.dribble
        const sx = i === 0 ? 1 : -1
        // ayak ici/ustu: bilek topun arkasinda ve hafif yaninda
        const tx = ball.x + sx * 0.05
        const tz = ball.z - 0.14
        const k = w * w * (3 - 2 * w) * 0.85
        L.x += (tx - L.x) * k
        L.z += (tz - L.z) * k
        L.y += (ah + 0.025 - L.y) * k
        L.pitch += (-0.3 - L.pitch) * k
      }
    }
    // dokunus olayi: kisa izleme (topu iten ayak bir an onde kalir)
    if (this.touchT < 0.14) {
      const k = 1 - this.touchT / 0.14
      const L = this.loco.legs[this.touchLeg]
      const sx = this.touchLeg === 0 ? 1 : -1
      L.x += (this.touchX + sx * 0.05 - L.x) * k * 0.5
      L.z += (this.touchZ - 0.1 - L.z) * k * 0.5
    }
  }
}
