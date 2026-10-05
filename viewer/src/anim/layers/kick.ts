// Katman: sut ('kick': sut ve asirtma). SAHIBI: sut ajani.
// CMU futbol vurusu klipleri (anim_src/bake_kick.py -> public/anim_kick3.json, 10_01 10_03 10_05 10_06 11_01; 10_02 elendi:
// temastan sonra cokuk kaliyor). Klipte topun yeri (ball, temas aninda pelvise gore) bilinir; oyunda topun GERCEK yeri
// (ctx.ball, temasa kadar hizla ongorulur) ile karsilastirilip:
//  1) govde (pelvis yatay) temasa dogru topa gore konumlanir (yanal kismi, ileri tam; sinirli),
//  2) kalan fark vuran ayak bilegine temas civarinda IK ile eklenir (klibin salinimi korunur, yalniz kaydirilir),
//  3) destek ayagi klipteki gibi topun yanina basar ve basma suresince dunyaya kilitlenir (kayma yok),
//  4) pelvis cokmesi kismen geri alinir (ALPHA), yere basan ayaklar IK ile yerde tutulur.
// Zaman: temas klipte de oyunda da CLIP_LEN.kickContact; temasa kadar ikinci dereceden zaman egriltme (basta hizli,
// temasta gercek hiz), temastan sonra gercek hiz. Temastan hemen sonra topun olculen hizina gore takip klibi secilir
// (plase / orta / sert / asirtma) ve 0.1 s'de ona gecilir. Top soldaysa klip aynalanir (sol ayak).
// Klip yok / yuklenmedi / ?clips=0: hicbir sey yapmaz (parametrik sut aynen).
import * as THREE from 'three'
import { asset } from '../../assetUrl'
import type { RigDriver } from '../rig'
import { layerState, type Layer, type LayerCtx } from './types'
import { layerStatus, loadJson, qa, qb, qc, qd, smooth } from './util'

interface KClipJ {
  fps: number
  n: number
  contact: number
  q: number[][]
  py: number[]
  h: number[][]
  fr: number[][]
  fl: number[][]
  ball: number[]
  peakV: number
}
interface KBankJ {
  bones: string[]
  restPelvisH: number
  clips: Record<string, KClipJ>
}
interface KClip {
  name: string
  fps: number
  n: number
  c: number
  q: Float32Array // n * nb * 4
  py: Float32Array
  hx: Float32Array
  hz: Float32Array
  fr: Float32Array // n*3 (x sol, y yukseklik, z ileri), yerinde pelvise gore
  fl: Float32Array
  ball: [number, number, number]
}

// CLIP_LEN.kickContact = 0.28; simulasyon topu act.t >= 0.28 olan ADIMDA firlatir, o adimda animT bir adim geridedir
// (60 Hz: 0.263..0.28). Olculen: temas animT 0.267 (30 Hz adim). Gorsel temas bu araligin ortasina konur.
const KICK_CONTACT = 0.27
const KICK_LEN = 0.75
const PRE_N = 10 // temastan once oynatilan klip karesi (0.33 s, 0.28 s'ye egrilir)
const ALPHA = 0.4 // pelvis cokmesinin geri alinan payi
const LAT = 0.6 // yanal farkin govdeye verilen payi (kalan IK)
const POST_TRAVEL = 0.6 // takipte klibin ileri govde yolunun kullanilan payi
const TAIL = 0.3 // sut animasyonu bittikten sonra klibin solma suresi (s)
const TAIL_OK = new Set(['idle', 'jog', 'run', 'sprint', 'dribble', 'walk'])
const MIRROR_X = 0.08 // top bu kadar soldaysa (m) sol ayakla vur
// takip klibi secimi: topun cikis hizi (m/s)
const PICK_PRE = ['10_01', '10_03', '10_05', '10_06', '11_01']

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
const OFF = Q.get('clips') === '0' || Q.get('kickclip') === '0'
const NO_MIRROR = Q.get('kickmirror') === '0'
// varsayilan secim (durum): duran top -> CMU gercek sutlar + GRF duran vurus; kosarken -> GRF kosu vuruslari + CMU sert
// (kare dizileri: /tmp/asci/kick/*_side.png). URL ile degistirilebilir: ?kickstand=a,b&kickrun=c,d
const PICK_STAND: string[] = (Q.get('kickstand') ?? '10_01,10_03,10_06,11_01,g_idle020').split(',').filter(Boolean)
const PICK_RUN: string[] = (Q.get('kickrun') ?? 'g_sprint010,g_sprint030,g_walk010,10_06').split(',').filter(Boolean)

let bank: { bones: string[]; clips: Record<string, KClip>; mir: Int16Array; legSide: Int8Array } | null = null
const status = layerStatus('kick')
if (!OFF)
  void Promise.all([loadJson<KBankJ>(asset('anim_kick3.json')), loadJson<KBankJ>(asset('anim_kick_grf.json'))]).then(([j, jg]) => {
    if (!j) return
    const nb = j.bones.length
    const clips: Record<string, KClip> = {}
    // Gameplay Football klipleri (ayni kemik listesi) eklenir
    if (jg && jg.bones.join() === j.bones.join()) Object.assign(j.clips, jg.clips)
    for (const k in j.clips) {
      const c = j.clips[k]
      const q = new Float32Array(c.n * nb * 4)
      for (let i = 0; i < c.n; i++) q.set(c.q[i], i * nb * 4)
      clips[k] = {
        name: k,
        fps: c.fps,
        n: c.n,
        c: c.contact,
        q,
        py: Float32Array.from(c.py),
        hx: Float32Array.from(c.h.map((v) => v[0])),
        hz: Float32Array.from(c.h.map((v) => v[1])),
        fr: Float32Array.from(c.fr.flat()),
        fl: Float32Array.from(c.fl.flat()),
        ball: [c.ball[0], c.ball[1], c.ball[2]],
      }
    }
    const mir = new Int16Array(nb)
    const legSide = new Int8Array(nb)
    for (let i = 0; i < nb; i++) {
      const n = j.bones[i]
      const o = n.endsWith('_l') ? n.slice(0, -2) + '_r' : n.endsWith('_r') ? n.slice(0, -2) + '_l' : n
      mir[i] = j.bones.indexOf(o)
      legSide[i] = /^(thigh|calf|foot)_l$/.test(n) ? 1 : /^(thigh|calf|foot)_r$/.test(n) ? -1 : 0
    }
    bank = { bones: j.bones, clips, mir, legSide }
    status.loaded = PICK_PRE.every((k) => clips[k])
  })

/** rig basina sabitler: metre->model birimi, zemin, aynalama duzeltmeleri, dinlenme yonelimleri */
interface RigK {
  u: number
  ox: number
  oy: number
  oz: number
  pel: THREE.Vector3
  restQ: THREE.Quaternion[]
  corr: THREE.Quaternion[] // aynali bacak kemigi: dinlenme yonu farki (asimetrik dinlenme pozu)
}
const rigK = new WeakMap<RigDriver, RigK>()
function getK(rig: RigDriver, bones: string[], mir: Int16Array): RigK | null {
  let k = rigK.get(rig)
  if (k) return k
  const th = rig.restModel('thigh_l')
  const ca = rig.restModel('calf_l')
  const pe = rig.restModel('pelvis')
  if (!th || !ca || !pe) return null
  const mpu = rig.dims.thigh / ca.p.distanceTo(th.p) // metre / model birimi
  const u = 1 / mpu
  const child: Record<string, string> = { thigh: 'calf', calf: 'foot', foot: 'ball' }
  const dir = (n: string) => {
    const [b, s] = n.split('_')
    const a = rig.restModel(n)
    const c = rig.restModel(`${child[b]}_${s}`)
    return a && c ? c.p.clone().sub(a.p).normalize() : null
  }
  const corr = bones.map((n, i) => {
    const q = new THREE.Quaternion()
    if (!/^(thigh|calf|foot)_[lr]$/.test(n)) return q
    const dl = dir(n)
    const dr = dir(bones[mir[i]])
    if (!dl || !dr) return q
    dr.x = -dr.x // aynanin dinlenme yonu
    return q.setFromUnitVectors(dl, dr)
  })
  k = {
    u,
    ox: pe.p.x,
    oy: pe.p.y - rig.dims.hipH * u,
    oz: pe.p.z,
    pel: pe.p.clone(),
    restQ: bones.map((n) => rig.restModel(n)?.q.clone() ?? new THREE.Quaternion()),
    corr,
  }
  rigK.set(rig, k)
  return k
}

class KickState {
  preSpeed = 0 // sut oncesi son karedeki hiz (m/s)
  active = false
  tail0 = -1
  lastT = 9
  count = 0
  pre: KClip | null = null
  post: KClip | null = null
  mir = false
  // zaman egriltme: f = c - N + a t + b t^2 (t < temas)
  n = PRE_N
  a = 0
  b = 0
  // top izleme (karakter uzayi, yerel)
  bx = 0
  by = 0
  bz = 0
  rvx = 0
  rvz = 0
  hasB = false
  px = 0 // temasta ongorulen top
  py = 0
  pz = 0
  frozen = false
  // govde ofseti (m, karakter uzayi)
  ocx = 0
  ocz = 0
  rtx = 0 // temastan beri kok yolu
  rtz = 0
  speedN = 0
  vOut = 0
  vyOut = 0
  // destek ayagi kilidi
  lock = 0 // agirlik
  locked = false
  lx = 0
  ly = 0
  lz = 0
  lockDone = false
  // giris: onceki karenin son pozu (lokomosyon klibi dahil)
  snap: Float32Array | null = null
  snapPel = new THREE.Vector3()
  snapOk = false
  useSnap = false
}

const S1 = new Float32Array(64 * 4)
const S2 = new Float32Array(64 * 4)
const out1 = { py: 0, hx: 0, hz: 0, fry: 0, fly: 0 }
const out2 = { py: 0, hx: 0, hz: 0, fry: 0, fly: 0 }
const vA = new THREE.Vector3()
const vB = new THREE.Vector3()
const tq = new THREE.Quaternion()

/** klibi f karesinde orneklendir (aynali ise sag<->sol ve x yansimasi). out: pelvis/yol/ayak yukseklikleri */
function sample(c: KClip, f: number, mir: boolean, nb: number, mirI: Int16Array, legSide: Int8Array, K: RigK, dst: Float32Array, o: typeof out1) {
  const ff = Math.min(c.n - 1.001, Math.max(0, f))
  const i = Math.floor(ff)
  const a = ff - i
  const b0 = i * nb * 4
  const b1 = b0 + nb * 4
  for (let bi = 0; bi < nb; bi++) {
    const s = (mir ? mirI[bi] : bi) * 4
    qa.set(c.q[b0 + s], c.q[b0 + s + 1], c.q[b0 + s + 2], c.q[b0 + s + 3])
    qb.set(c.q[b1 + s], c.q[b1 + s + 1], c.q[b1 + s + 2], c.q[b1 + s + 3])
    qa.slerp(qb, a)
    if (mir) {
      qa.set(qa.x, -qa.y, -qa.z, qa.w)
      if (legSide[bi]) qa.multiply(K.corr[bi])
    }
    dst[bi * 4] = qa.x
    dst[bi * 4 + 1] = qa.y
    dst[bi * 4 + 2] = qa.z
    dst[bi * 4 + 3] = qa.w
  }
  const L = (arr: Float32Array) => arr[i] + (arr[i + 1] - arr[i]) * a
  o.py = L(c.py)
  o.hx = (mir ? -1 : 1) * L(c.hx)
  o.hz = L(c.hz)
  const ky = (arr: Float32Array) => arr[i * 3 + 1] + (arr[i * 3 + 4] - arr[i * 3 + 1]) * a
  // vuran ayak = sag (aynali: sol); destek = diger
  o.fry = ky(mir ? c.fl : c.fr)
  o.fly = ky(mir ? c.fr : c.fl)
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))

function pickPost(pre: KClip, v: number, vy: number): KClip {
  const b = bank!.clips
  if (pre.name.startsWith('g_')) return pre // Gameplay Football: kendi takibi
  if (vy > 4.5) return b['11_01'] // asirtma: bacak yukari
  if (v >= 26) return b['11_01']
  if (v >= 19) return b['10_06']
  if (v >= 13) return pre.name === '10_03' ? pre : b['10_01']
  return b['10_05'] // plase
}

/** her karede (kick disinda): son pozun anlik goruntusu, sut basinda bu pozdan gecis yapilir */
function snapshot(rig: RigDriver, st: KickState, bones: string[], K: RigK) {
  const nb = bones.length
  if (!st.snap) st.snap = new Float32Array(nb * 4)
  for (let i = 0; i < nb; i++) {
    const rb = rig.restModel(bones[i])
    if (!rb) continue
    tq.copy(rb.cur).multiply(qd.copy(K.restQ[i]).invert())
    st.snap[i * 4] = tq.x
    st.snap[i * 4 + 1] = tq.y
    st.snap[i * 4 + 2] = tq.z
    st.snap[i * 4 + 3] = tq.w
  }
  rig.bonePos('pelvis', vA)
  st.snapPel.copy(vA).sub(K.pel).multiplyScalar(1 / K.u)
  st.snapOk = true
}

/** model uzayi nokta <- karakter uzayi metre */
const toModel = (K: RigK, x: number, y: number, z: number, out: THREE.Vector3) => out.set(K.ox + x * K.u, K.oy + y * K.u, K.oz + z * K.u)

function begin(st: KickState, ctx: LayerCtx) {
  const b = bank!
  st.active = true
  st.count++
  st.frozen = false
  st.speedN = 0
  st.post = null
  st.lock = 0
  st.locked = false
  st.lockDone = false
  st.rtx = st.rtz = 0
  st.hasB = false
  st.useSnap = st.snapOk
  const fv = (globalThis as { __kickVar?: number | string }).__kickVar
  const running = Math.max(st.preSpeed, Math.hypot(ctx.lvx, ctx.lvz)) > 2.2
  const list = (running ? PICK_RUN : PICK_STAND).filter((k) => b.clips[k])
  const L = list.length ? list : PICK_PRE
  const idx = typeof fv === 'number' ? fv : ctx.id * 7 + st.count * 3
  st.pre = typeof fv === 'string' && b.clips[fv] ? b.clips[fv] : b.clips[L[((idx % L.length) + L.length) % L.length]]
  st.n = Math.min(PRE_N, st.pre.c)
  const fm = (globalThis as { __kickMirror?: number }).__kickMirror
  st.mir = !NO_MIRROR && (fm !== undefined ? fm === 1 : ctx.ball.x > MIRROR_X && ctx.ball.z > -0.2 && ctx.ball.z < 1.6)
  // f(t) = c - N + a t + b t^2 ; f(Tc) = c, f'(Tc) = fps (temasta gercek hiz)
  const fps = st.pre.fps
  const T = KICK_CONTACT
  st.b = (fps * T - st.n) / (T * T)
  st.a = fps - 2 * st.b * T
  ;(globalThis as { __kickSt?: Record<number, KickState> }).__kickSt ??= {}
  ;(globalThis as { __kickSt?: Record<number, KickState> }).__kickSt![ctx.id] = st
}

function frameAt(st: KickState, c: KClip, t: number) {
  if (t < KICK_CONTACT) return c.c - st.n + st.a * t + st.b * t * t
  return c.c + (t - KICK_CONTACT) * c.fps
}

function applyKick(ctx: LayerCtx, st: KickState, tIn: number, wMul: number): boolean {
  const b = bank!
  const rig = ctx.rig
  const K = getK(rig, b.bones, b.mir)
  if (!K) return false
  const t = tIn
  const fresh = !st.active || t < st.lastT - 0.05
  if (fresh) begin(st, ctx)
  // oyun zamani adimi (animT farki): top ve kok hizlari bununla (gorsel kare dt'si yavas makinede farkli olabilir)
  const dT = fresh ? 0 : t - st.lastT
  st.lastT = t
  // kok hizi (karakter uzayi, oyun zamani): gorsel yer degisimi / dT
  const rvRx = dT > 1e-4 ? (ctx.lvx * ctx.gdt) / dT : ctx.lvx
  const rvRz = dT > 1e-4 ? (ctx.lvz * ctx.gdt) / dT : ctx.lvz
  if (t > KICK_LEN) return false
  const pre = st.pre!
  const nb = b.bones.length
  const T = KICK_CONTACT
  const mx = st.mir ? -1 : 1

  // --- top izleme ve temas ongorusu (karakter uzayi) ---
  const bl = ctx.ball
  if (!st.frozen) {
    let kicked = false
    if (st.hasB && dT > 1e-4) {
      const ix = (bl.x - st.bx) / dT
      const iz = (bl.z - st.bz) / dT
      const iy = (bl.y - st.by) / dT
      // simulasyon topu firlatti (ani hiz sicramasi): ongoru donar
      kicked = t > T - 0.1 && Math.hypot(ix - st.rvx, iz - st.rvz, iy) > 4
      if (!kicked) {
        const k = Math.min(1, dT * 12)
        st.rvx += (ix - st.rvx) * k
        st.rvz += (iz - st.rvz) * k
      }
    } else {
      st.rvx = st.rvz = 0
    }
    if (t < T && !kicked) {
      const r = T - t
      st.px = bl.x + st.rvx * r
      st.py = bl.y
      st.pz = bl.z + st.rvz * r
    } else st.frozen = true
  }
  if (st.frozen && !st.post && dT > 1e-4) {
    // temastan sonra: topun cikis hizi (kok hizi eklenir) -> takip klibi
    const vx = (bl.x - st.bx) / dT + rvRx
    const vz = (bl.z - st.bz) / dT + rvRz
    const vy = (bl.y - st.by) / dT
    const v = Math.hypot(vx, vy, vz)
    if (v > st.vOut || st.speedN === 0) {
      st.vOut = v
      st.vyOut = vy
    }
    st.speedN++
    if (st.speedN === 2 && !st.post) st.post = pickPost(pre, st.vOut, st.vyOut)
  }
  st.bx = bl.x
  st.by = bl.y
  st.bz = bl.z
  st.hasB = true

  // --- klip ornekleri ---
  const f = frameAt(st, pre, t)
  sample(pre, f, st.mir, nb, b.mir, b.legSide, K, S1, out1)
  let kx = 0
  const post = st.post
  if (post && post !== pre && t > T) {
    kx = smooth((t - T - 0.02) / 0.1)
    if (kx > 0) {
      sample(post, frameAt(st, post, t), st.mir, nb, b.mir, b.legSide, K, S2, out2)
      for (let i = 0; i < nb * 4; i += 4) {
        qa.set(S1[i], S1[i + 1], S1[i + 2], S1[i + 3])
        qb.set(S2[i], S2[i + 1], S2[i + 2], S2[i + 3])
        qa.slerp(qb, kx)
        S1[i] = qa.x
        S1[i + 1] = qa.y
        S1[i + 2] = qa.z
        S1[i + 3] = qa.w
      }
      out1.py += (out2.py - out1.py) * kx
      out1.hx += (out2.hx - out1.hx) * kx
      out1.hz += (out2.hz - out1.hz) * kx
      out1.fry += (out2.fry - out1.fry) * kx
      out1.fly += (out2.fly - out1.fly) * kx
    }
  }

  // --- agirliklar ---
  const wIn = smooth(t / 0.1)
  const wOut = (1 - smooth((t - 0.58) / 0.15)) * wMul
  const w = Math.min(wIn, wOut)
  if (wOut < 0.01) return false
  const useSnap = st.useSnap && st.snap && wIn < 1

  // --- kemikler ---
  for (let bi = 0; bi < nb; bi++) {
    const name = b.bones[bi]
    if (useSnap) rig.blendBone(name, qc.set(st.snap![bi * 4], st.snap![bi * 4 + 1], st.snap![bi * 4 + 2], st.snap![bi * 4 + 3]), wOut)
    rig.blendBone(name, qc.set(S1[bi * 4], S1[bi * 4 + 1], S1[bi * 4 + 2], S1[bi * 4 + 3]), useSnap ? wIn : w > 0.99 ? 1 : w)
  }

  // --- govde ofseti (topa gore) ---
  const cb = pre.ball // klip topu (temasta yerinde pelvise gore)
  const cbx = cb[0] * mx
  const tgx = clamp(LAT * (st.px - cbx), -0.35, 0.35)
  const tgz = clamp(st.pz - cb[2], -0.3, 0.45)
  let ox: number
  let oz: number
  if (t < T) {
    const s = smooth(t / (T - 0.03))
    ox = tgx * s
    oz = tgz * s
    st.ocx = tgx
    st.ocz = tgz
  } else {
    st.rtx += ctx.lvx * ctx.gdt
    st.rtz += ctx.lvz * ctx.gdt
    const d = 1 - smooth((t - T - 0.12) / (KICK_LEN - 0.05 - T - 0.12))
    ox = (st.ocx + POST_TRAVEL * out1.hx - st.rtx) * d
    oz = (st.ocz + POST_TRAVEL * out1.hz - st.rtz) * d
  }
  const lift = -ALPHA * out1.py // >0: cokme geri alinir
  const pdy = out1.py + lift
  if (useSnap) rig.blendPelvis(st.snapPel.x, st.snapPel.y, st.snapPel.z, wOut)
  rig.blendPelvis(ox, pdy, oz, useSnap ? wIn : w > 0.99 ? 1 : w)

  // --- vuran ayak: temas civarinda kalan fark (topun gercek yeri - klipteki yeri) bilege eklenir ---
  const kSide = st.mir ? 'l' : 'r'
  const sSide = st.mir ? 'r' : 'l'
  const rx = clamp(st.px - (st.ocx + cbx), -0.4, 0.4)
  const rz = clamp(st.pz - (st.ocz + cb[2]), -0.45, 0.45)
  const ry = clamp(st.py - cb[1] - lift, -0.2, 0.5)
  const wk = smooth((t - (T - 0.15)) / 0.11) * (1 - smooth((t - (T + 0.03)) / 0.1))
  const kf = rig.bonePos(`foot_${kSide}`, vA)
  if (wk > 0.001) {
    vB.set(rx * K.u, ry * K.u, rz * K.u).multiplyScalar(wk).add(kf)
    rig.reachFoot(kSide, vB, w)
  } else if (out1.fry < 0.17 && lift > 0.005) {
    // yere inen vuran ayak: kaldirilan pelvis kadar asagi
    vB.copy(kf)
    vB.y -= lift * K.u * smooth((0.19 - out1.fry) / 0.04)
    rig.reachFoot(kSide, vB, w)
  }

  // --- destek ayagi: topun yanina basar, basili kaldikca dunyada sabit ---
  const sf = rig.bonePos(`foot_${sSide}`, vA)
  const ground = out1.fly < 0.155
  if (!st.locked && !st.lockDone && ground && t > 0.04 && t < T + 0.05) {
    st.locked = true
    const fl = st.mir ? pre.fr : pre.fl
    st.ly = fl[pre.c * 3 + 1]
  }
  if (st.locked) {
    if (t >= T) {
      st.lx -= ctx.lvx * ctx.gdt
      st.lz -= ctx.lvz * ctx.gdt
    } else {
      // temasa kadar: hedef = temasta topun DUNYADAKI yeri (simdiki kok cercevesinde: kok yolu eklenir) + klipteki fark
      const fl = st.mir ? pre.fr : pre.fl
      const ci = pre.c * 3
      const r = T - t
      st.lx = st.px + rvRx * r + (fl[ci] * mx - cbx)
      st.lz = st.pz + rvRz * r + (fl[ci + 2] - cb[2])
    }
    const want = ground && t < KICK_LEN - 0.08 ? 1 : 0
    if (!ground && t > T) {
      st.locked = false
      st.lockDone = true
    }
    st.lock += (want - st.lock) * Math.min(1, dT * 25)
  } else st.lock += (0 - st.lock) * Math.min(1, dT * 25)
  if (st.lock > 0.01) {
    // gercek destek bilegi yuksekligi: klip yuksekligi (kaldirilan pelvis disarida)
    toModel(K, st.lx, st.ly, st.lz, vB)
    rig.reachFoot(sSide, vB, st.lock * w)
  } else if (out1.fly < 0.17 && lift > 0.005) {
    vB.copy(sf)
    vB.y -= lift * K.u * smooth((0.19 - out1.fly) / 0.04)
    rig.reachFoot(sSide, vB, w)
  }
  return true
}

export const kickLayer: Layer = (ctx) => {
  if (!bank || !status.loaded) return
  const st = layerState(ctx, 'kick', () => new KickState())
  if (ctx.name !== 'kick') {
    // simulasyon sut animasyonunu kilit bitince (KICK_LOCK ~0.38 s) birakir: takip hareketi kesilmesin diye
    // lokomosyona geciste klip 0.3 s daha surer ve sonuna dogru solar
    if (st.active && st.lastT > KICK_CONTACT && st.lastT < KICK_LEN && TAIL_OK.has(ctx.name)) {
      if (st.tail0 < 0) st.tail0 = st.lastT
      const tt = st.lastT + ctx.gdt
      const fade = 1 - smooth((tt - st.tail0) / TAIL)
      if (fade > 0.01 && applyKick(ctx, st, tt, fade)) {
        status.frames++
        return
      }
    }
    st.active = false
    st.tail0 = -1
    st.preSpeed = Math.hypot(ctx.lvx, ctx.lvz)
    st.lastT = 9
    const K = getK(ctx.rig, bank.bones, bank.mir)
    if (K) snapshot(ctx.rig, st, bank.bones, K)
    return
  }
  st.tail0 = -1
  if (applyKick(ctx, st, ctx.animT, 1)) status.frames++
}

