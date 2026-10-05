// Parametrik pozu iskelete uygular. Rig'den bagimsiz: dinlenme durusunu yukleme aninda olcer,
// her kemigi "birincil yon (cocuga dogru) + ikincil eksen (bukum duzlemi normali)" ile hedefe cevirir.
// Kemik adlari MPFB game_engine / UE tarzi: pelvis, spine_01..03, neck_01, head, clavicle_l,
// upperarm_l, lowerarm_l, hand_l, thigh_l, calf_l, foot_l, ball_l (sag: _r).
import * as THREE from 'three'
import type { Pose } from './pose'

const SFX = ['l', 'r'] as const
const SGN = [1, -1] // sol +x

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpQ2 = new THREE.Quaternion()
const tmpE = new THREE.Euler()
const X = new THREE.Vector3(1, 0, 0)
const Y = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)

interface RestBone {
  bone: THREE.Bone
  q: THREE.Quaternion // dinlenme model-uzayi yonelimi
  p: THREE.Vector3 // dinlenme model-uzayi konumu
  parentQ: THREE.Quaternion // ebeveynin dinlenme model yonelimi (surulmeyen ebeveyn icin)
  // birincil/ikincil eksenle hizalama: hedef = basis(p,n) * C
  C: THREE.Quaternion
  cur: THREE.Quaternion // bu karedeki model yonelimi
}

/** karakter boyutlari (metre) */
export interface Dims {
  hipH: number // pelvis yuksekligi
  ankleH: number // ayak bilegi yuksekligi
  hipW: number // kalca eklemi yari genisligi
  thigh: number
  calf: number
}

function basisQ(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Quaternion) {
  // p birincil, n ikincil (p'ye dik yapilir)
  const nn = n.clone().addScaledVector(p, -p.dot(n)).normalize()
  const t = new THREE.Vector3().crossVectors(p, nn)
  tmpM.makeBasis(p, nn, t)
  return out.setFromRotationMatrix(tmpM)
}

// sicak dongude tahsis olmasin diye tek tampon
const v1 = new THREE.Vector3()
const v2 = new THREE.Vector3()
const v3 = new THREE.Vector3()
const v4 = new THREE.Vector3()
const v5 = new THREE.Vector3()
const qb = new THREE.Quaternion()
const qA = new THREE.Quaternion()
const qF = new THREE.Quaternion()

function basisFast(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Quaternion) {
  v5.copy(n).addScaledVector(p, -p.dot(n))
  if (v5.lengthSq() < 1e-8) v5.set(1, 0, 0).addScaledVector(p, -p.x)
  v5.normalize()
  v4.crossVectors(p, v5)
  tmpM.makeBasis(p, v5, v4)
  return out.setFromRotationMatrix(tmpM)
}

export class RigDriver {
  readonly ok: boolean
  readonly dims: Dims
  private b: Record<string, RestBone> = {}
  private u: number // model birimi / metre
  private origin = new THREE.Vector3() // karakter orijini (pelvis altinda zemin) model uzayinda
  private pelvisParentInv = new THREE.Matrix4()
  private pelvisPos = new THREE.Vector3()
  // dinlenme yonleri (model)
  private restDir: Record<string, THREE.Vector3> = {}

  /**
   * root: modelin kok nesnesi (model uzayi = root'un yerel uzayi). Dinlenme pozunda olmali.
   * metersPerUnit: model biriminin metre karsiligi; groundY: zemin (model uzayi).
   */
  constructor(root: THREE.Object3D, metersPerUnit: number, groundY: number) {
    this.u = 1 / metersPerUnit
    root.updateMatrixWorld(true)
    const inv = root.matrixWorld.clone().invert()
    const bones: Record<string, THREE.Bone> = {}
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone
    })
    const need = ['pelvis', 'spine_01', 'spine_03', 'neck_01', 'head']
    for (const s of SFX) need.push(`thigh_${s}`, `calf_${s}`, `foot_${s}`, `upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`)
    this.ok = need.every((n) => bones[n])
    const model = (o: THREE.Object3D) => tmpM.multiplyMatrices(inv, o.matrixWorld)
    const pos = new THREE.Vector3()
    const sc = new THREE.Vector3()
    for (const name in bones) {
      const bone = bones[name]
      const q = new THREE.Quaternion()
      model(bone).decompose(pos, q, sc)
      const parentQ = new THREE.Quaternion()
      if (bone.parent) model(bone.parent).decompose(new THREE.Vector3(), parentQ, sc)
      this.b[name] = { bone, q, p: pos.clone(), parentQ, C: new THREE.Quaternion(), cur: q.clone() }
    }
    if (!this.ok) {
      this.dims = { hipH: 0.99, ankleH: 0.08, hipW: 0.1, thigh: 0.46, calf: 0.45 }
      return
    }
    const P = (n: string) => this.b[n].p
    const pel = this.b.pelvis
    this.origin.set(pel.p.x, groundY, pel.p.z)
    if (pel.bone.parent) {
      this.pelvisParentInv.multiplyMatrices(inv, pel.bone.parent.matrixWorld).invert()
    }
    // birincil yon: cocuk eklemine dogru; ikincil: p x ileri (bukum duzlemi normali)
    const link: [string, string][] = []
    for (const s of SFX) {
      link.push([`thigh_${s}`, `calf_${s}`], [`calf_${s}`, `foot_${s}`], [`upperarm_${s}`, `lowerarm_${s}`], [`lowerarm_${s}`, `hand_${s}`])
    }
    for (const [a, c] of link) {
      const d = P(c).clone().sub(P(a)).normalize()
      this.restDir[a] = d
      const n = new THREE.Vector3().crossVectors(d, Z)
      if (n.lengthSq() < 1e-6) n.set(-1, 0, 0)
      const bq = basisQ(d, n.normalize(), new THREE.Quaternion())
      this.b[a].C.copy(bq).invert().multiply(this.b[a].q)
    }
    this.curlFingers()
    const k = metersPerUnit
    const thigh = P('calf_l').distanceTo(P('thigh_l'))
    const calf = P('foot_l').distanceTo(P('calf_l'))
    this.dims = {
      hipH: (pel.p.y - groundY) * k,
      ankleH: ((P('foot_l').y + P('foot_r').y) / 2 - groundY) * k,
      hipW: ((P('thigh_l').x - P('thigh_r').x) / 2) * k,
      thigh: thigh * k,
      calf: calf * k,
    }
  }

  /** gevsek yumruk: parmaklar avuca dogru bukulur (bir kez; kare basina dokunulmaz) */
  private curlFingers() {
    const CURL: Record<string, number[]> = {
      index: [0.35, 0.65, 0.4],
      middle: [0.45, 0.75, 0.45],
      ring: [0.55, 0.8, 0.45],
      pinky: [0.6, 0.8, 0.45],
      thumb: [0.05, 0.25, 0.2],
    }
    for (let i = 0; i < 2; i++) {
      const s = SFX[i]
      // avuc normali: dinlenme A-durusunda avuc uyluga (iceri) ve hafif geriye bakar
      const palm = new THREE.Vector3(-SGN[i], 0, -0.25).normalize()
      for (const f in CURL) {
        for (let j = 0; j < 3; j++) {
          const rb = this.b[`${f}_0${j + 1}_${s}`]
          if (!rb) continue
          const nx = this.b[`${f}_0${j + 2}_${s}`] ?? this.b[`${f}_0${j}_${s}`]
          if (!nx) continue
          const d = j < 2 ? nx.p.clone().sub(rb.p) : rb.p.clone().sub(nx.p)
          if (d.lengthSq() < 1e-10) continue
          d.normalize()
          const ax = new THREE.Vector3().crossVectors(d, palm)
          if (ax.lengthSq() < 1e-6) continue
          ax.normalize().applyQuaternion(rb.q.clone().invert()) // kemik yerel ekseni
          rb.bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, CURL[f][j]))
        }
      }
    }
  }

  bone(name: string): THREE.Bone | undefined {
    return this.b[name]?.bone
  }

  restModel(name: string) {
    return this.b[name]
  }

  /** kemigin bu karedeki model yonelimini ayarla, yerel donusu ebeveynden turet */
  private set(name: string, q: THREE.Quaternion) {
    const rb = this.b[name]
    if (!rb) return
    rb.cur.copy(q)
    const par = rb.bone.parent && this.b[rb.bone.parent.name]
    const pq = par ? par.cur : rb.parentQ
    rb.bone.quaternion.copy(pq).invert().multiply(q)
  }

  /** delta * dinlenme */
  private setDelta(name: string, delta: THREE.Quaternion) {
    const rb = this.b[name]
    if (!rb) return
    this.set(name, tmpQ2.multiplyQuaternions(delta, rb.q))
  }

  private aim(name: string, p: THREE.Vector3, n: THREE.Vector3) {
    const rb = this.b[name]
    basisFast(p, n, qb)
    this.set(name, qb.multiply(rb.C))
  }

  // kare basi tahsis olmasin diye on-ayrilmis tamponlar
  private T = {
    qHip: new THREE.Quaternion(),
    qS: new THREE.Quaternion(),
    qF1: new THREE.Quaternion(),
    qF2: new THREE.Quaternion(),
    qC: new THREE.Quaternion(),
    qN: new THREE.Quaternion(),
    qH: new THREE.Quaternion(),
    yawQ: new THREE.Quaternion(),
    qFK: new THREE.Quaternion(),
    pitchQ: new THREE.Quaternion(),
    dF: new THREE.Vector3(),
    fwF: new THREE.Vector3(),
    nF: new THREE.Vector3(),
    cF: new THREE.Vector3(),
    K: new THREE.Vector3(),
    dI: new THREE.Vector3(),
    cI: new THREE.Vector3(),
    nI: new THREE.Vector3(),
    low: new THREE.Vector3(),
    ad: new THREE.Vector3(),
    an: new THREE.Vector3(),
    qCl: new THREE.Quaternion(),
    p1: new THREE.Vector3(),
  }

  /** gogus (spine_03) model konumu, omurga deltalarindan */
  private chainChest(qHip: THREE.Quaternion, q1: THREE.Quaternion, q2: THREE.Quaternion, _qC: THREE.Quaternion) {
    const b = this.b
    const p = this.T.p1.copy(b.spine_01.p).sub(b.pelvis.p).applyQuaternion(qHip).add(this.pelvisPos)
    p.add(v5.copy(b.spine_02.p).sub(b.spine_01.p).applyQuaternion(q1))
    p.add(v5.copy(b.spine_03.p).sub(b.spine_02.p).applyQuaternion(q2))
    return p
  }
  private static N = SFX.map((s) => ({
    clav: `clavicle_${s}`,
    ua: `upperarm_${s}`,
    la: `lowerarm_${s}`,
    hand: `hand_${s}`,
    thigh: `thigh_${s}`,
    calf: `calf_${s}`,
    foot: `foot_${s}`,
    ball: `ball_${s}`,
  }))

  apply(pose: Pose) {
    if (!this.ok) return
    const u = this.u
    const T = this.T
    const pel = this.b.pelvis
    // --- pelvis ---
    const qHip = T.qHip.setFromEuler(tmpE.set(pose.hp, pose.hyaw, pose.hr, 'YXZ'))
    this.pelvisPos.set(pel.p.x + pose.hx * u, pel.p.y + pose.hy * u, pel.p.z + pose.hz * u)
    this.setDelta('pelvis', qHip)
    pel.bone.position.copy(this.pelvisPos).applyMatrix4(this.pelvisParentInv)

    // --- omurga ---
    const qS = T.qS.setFromEuler(tmpE.set(pose.sp / 3, pose.syaw / 3, pose.sr / 3, 'YXZ'))
    this.setDelta('spine_01', T.qF1.copy(qHip).multiply(qS))
    this.setDelta('spine_02', T.qF2.copy(T.qF1).multiply(qS))
    const qC = T.qC.copy(T.qF2).multiply(qS) // gogus cercevesi
    this.setDelta('spine_03', qC)
    const qN = T.qN.copy(qC).multiply(tmpQ.setFromEuler(tmpE.set(pose.np * 0.4, pose.nyaw * 0.4, 0, 'YXZ')))
    this.setDelta('neck_01', qN)
    this.setDelta('head', T.qH.copy(qN).multiply(tmpQ.setFromEuler(tmpE.set(pose.np * 0.6, pose.nyaw * 0.6, 0, 'YXZ'))))

    // --- kollar (gogus cercevesinde FK; istenirse el bilegi IK) ---
    let chestPos: THREE.Vector3 | null = null
    for (let i = 0; i < 2; i++) {
      const nm = RigDriver.N[i]
      const sg = SGN[i]
      const a = pose.arms[i]
      const qCl = T.qCl.multiplyQuaternions(qC, qA.setFromAxisAngle(Z, sg * a.shrug))
      this.setDelta(nm.clav, qCl)
      // A = gogus * Rx(-flex) * Rz(sg*abd) * Ry(sg*twist)
      qA.copy(qC)
        .multiply(tmpQ.setFromAxisAngle(X, -a.flex))
        .multiply(tmpQ.setFromAxisAngle(Z, sg * a.abd))
        .multiply(tmpQ.setFromAxisAngle(Y, sg * a.twist))
      const d = T.ad.set(0, -1, 0).applyQuaternion(qA)
      const fw = v2.set(0, 0, 1).applyQuaternion(qA)
      const n = T.an.set(-1, 0, 0).applyQuaternion(qA)
      const c = Math.cos(a.elbow)
      const sn = Math.sin(a.elbow)
      const low = T.low.set(d.x * c + fw.x * sn, d.y * c + fw.y * sn, d.z * c + fw.z * sn)
      if (a.ik > 0.001) {
        // omuz konumu: omurga zinciri boyunca
        if (!chestPos) chestPos = this.chainChest(qHip, T.qF1, T.qF2, qC)
        const cl = this.b[nm.clav]
        const ua = this.b[nm.ua]
        const la = this.b[nm.la]
        const hd = this.b[nm.hand]
        const S = v1.copy(cl.p).sub(this.b.spine_03.p).applyQuaternion(qC).add(chestPos)
        S.add(v3.copy(ua.p).sub(cl.p).applyQuaternion(qCl))
        const l1 = la.p.distanceTo(ua.p)
        const l2 = hd.p.distanceTo(la.p)
        const Tg = v3.set(this.origin.x + a.tx * u, this.origin.y + a.ty * u, this.origin.z + a.tz * u)
        const dir = Tg.sub(S)
        let dist = dir.length()
        dir.divideScalar(dist || 1)
        dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999)
        const aa = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
        const h = Math.sqrt(Math.max(0, l1 * l1 - aa * aa))
        // dirsek asagi, geri ve disa
        const pole = v4.set(sg * 0.5, -0.6, -0.6).applyQuaternion(qC)
        pole.addScaledVector(dir, -pole.dot(dir)).normalize()
        const E = T.K.copy(dir).multiplyScalar(aa).addScaledVector(pole, h)
        const dI = T.dI.copy(E).normalize()
        const cI = T.cI.copy(dir).multiplyScalar(dist).sub(E).normalize()
        const nI = T.nI.crossVectors(dI, cI)
        if (nI.lengthSq() < 1e-6) nI.copy(n)
        nI.normalize()
        if (nI.dot(n) < -0.5 && a.ik < 0.999) nI.negate()
        d.lerp(dI, a.ik).normalize()
        low.lerp(cI, a.ik).normalize()
        n.lerp(nI, a.ik).normalize()
      }
      this.aim(nm.ua, d, n)
      this.aim(nm.la, low, n)
      // el onkolu izler
      const la = this.b[nm.la]
      this.setDelta(nm.hand, qF.copy(la.cur).multiply(tmpQ.copy(la.q).invert()))
    }

    // --- bacaklar ---
    const yawQ = T.yawQ.setFromAxisAngle(Y, pose.hyaw * 0.5)
    for (let i = 0; i < 2; i++) {
      const nm = RigDriver.N[i]
      const sg = SGN[i]
      const L = pose.legs[i]
      const th = this.b[nm.thigh]
      const ca = this.b[nm.calf]
      const fo = this.b[nm.foot]
      const l1 = ca.p.distanceTo(th.p)
      const l2 = fo.p.distanceTo(ca.p)
      // FK yonleri (pelvis cercevesinde)
      qA.copy(qHip)
        .multiply(tmpQ.setFromAxisAngle(X, -L.flex))
        .multiply(tmpQ.setFromAxisAngle(Z, sg * L.abd))
        .multiply(tmpQ.setFromAxisAngle(Y, sg * L.twist))
      const dF = T.dF.set(0, -1, 0).applyQuaternion(qA)
      const fwF = T.fwF.set(0, 0, 1).applyQuaternion(qA)
      const nF = T.nF.set(-1, 0, 0).applyQuaternion(qA)
      const cF = T.cF.copy(dF).multiplyScalar(Math.cos(L.knee)).addScaledVector(fwF, -Math.sin(L.knee))
      if (L.ik > 0.001) {
        // IK: kalca eklemi -> ayak bilegi hedefi
        const H = v1.copy(th.p).sub(pel.p).applyQuaternion(qHip).add(this.pelvisPos)
        const Tg = v2.set(this.origin.x + L.x * u, this.origin.y + L.y * u, this.origin.z + L.z * u)
        const dir = v3.subVectors(Tg, H)
        let dist = dir.length()
        dir.divideScalar(dist || 1)
        dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.9995)
        const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
        const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
        // diz ileri ve hafif disa bakar; ayak yonuyle doner
        const pole = v4.set(sg * 0.12, 0, 1).applyAxisAngle(Y, sg * L.yaw * 0.5).applyQuaternion(yawQ)
        pole.addScaledVector(dir, -pole.dot(dir)).normalize()
        const K = T.K.copy(dir).multiplyScalar(a).addScaledVector(pole, h)
        const dI = T.dI.copy(K).normalize()
        const cI = T.cI.copy(dir).multiplyScalar(dist).sub(K).normalize()
        const nI = T.nI.crossVectors(dI, pole).normalize()
        dF.lerp(dI, L.ik).normalize()
        cF.lerp(cI, L.ik).normalize()
        nF.lerp(nI, L.ik).normalize()
      }
      this.aim(nm.thigh, dF, nF)
      this.aim(nm.calf, cF, nF)
      // ayak: FK'da baldiri izler, IK'da zemine gore (yalniz yaw)
      const pitchQ = T.pitchQ.setFromAxisAngle(X, -L.pitch)
      const qFK = T.qFK.copy(ca.cur).multiply(tmpQ.copy(ca.q).invert()).multiply(pitchQ)
      if (L.ik > 0.001) {
        const qIK = qF.setFromAxisAngle(Y, sg * L.yaw).premultiply(yawQ).multiply(pitchQ)
        qFK.slerp(qIK, L.ik)
      }
      this.setDelta(nm.foot, qFK)
      if (this.b[nm.ball]) this.setDelta(nm.ball, qFK.multiply(tmpQ.setFromAxisAngle(X, -L.toe)))
    }
  }
}
