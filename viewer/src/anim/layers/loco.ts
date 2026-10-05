// Katman: lokomosyon (yurume / jog / kosu / sprint, topla surme). SAHIBI: lokomosyon ajani.
// CMU dongu klipleri (anim_src/bake_loco_cmu.py -> public/anim_loco_cmu.json), hiz bantlari: hiza gore komsu iki klip,
// faz hizali karisim (faz 0 = sol ayak basar), bant icinde oynatma hizi = 1 (vref dogrusal karisir; yavas cekim yok).
// En alt bandin altinda yavaslatma + parametrige karisma, en ust bandin ustunde sinirli hizlandirma + adim boyu (stride) germe.
// Topla kosu ('dribble'): tum vucut klipten; sag ayak klibin inis anina yakin topa cekilir (rig.reachFoot), dokunus zamani
// Animator.setExternalContact ile simulasyona (footTiming) klibin ayak inisinden verilir.
// Klip yok / yuklenmedi / ?clips=0 / ?loco=0: hicbir sey yapmaz (parametrik gait aynen).
import * as THREE from 'three'
import { asset } from '../../assetUrl'
import { layerState, type Layer, type LayerCtx } from './types'
import { layerStatus, loadJson, smooth } from './util'

interface CClip {
  src: string
  dur: number
  vref: number
  cl: number[]
  cr: number[]
  stL: number[]
  stR: number[]
  q: number[][] // ornek -> kemik*4 (x,y,z,w), model uzayi dinlenmeden sapma
  pel: number[][] // ornek -> pelvis sapmasi (m, model uzayi)
}
interface CBank {
  bones: string[]
  m: number
  clips: Record<string, CClip>
}

// hiz bantlari (vref sirasi): yurume 1.29, hizli yurume 1.84, jog 2.97, kosu 3.53, 4.24, GF sprint 7.2 m/s
const BAND_KEYS = ['walk', 'walkf', 'jog30', 'run38', 'run44', 'gf_sprint']
// locofeel: oyun hizi -> klip stili hizi. Oyunda kosu 6.2, sprint 8.0 m/s; eskiden ikisi de en ust (gf_sprint 7.2) bandina
// dusuyordu (6.2 = %70 sprint klibi) ve gozle ayni gorunuyordu. Simdi: <=3.6 ayni; 3.6..6.6 -> CMU kosu (4.2-4.8);
// 6.2..8 -> CMU kosu -> GF sprint (7.2). Stil hizi gercek hizdan dusukse fark kadans (sqrt) + adim boyu ile kapanir.
// (104_37/104_48/102_05 kosulari denendi: govde yonu/kol aktarimi bozuk, banda alinmadi.)
function styleV(v: number) {
  if (!FEEL || v <= 3.6) return v
  if (v <= 4.4) return 3.6 + ((v - 3.6) * 0.64) / 0.8
  if (v <= 6.2) return 4.24
  return Math.min(7.2, 4.24 + ((v - 6.2) * 2.96) / 1.8)
}
// hiz kademeli ust govde: one egim (rad), kol salinim genligi carpani, yurumede dirsek gevsetme
// tablolar olculen klip tabanina gore ayarlandi (scripts/locofeel-measure.mjs): CMU jog/kosu klipleri zaten ~13-16 derece egik,
// GF sprint klibi ~4 derece dik -> sprintte ust govdeye en buyuk ek egim; kol genligi carpani ortalama kol etrafinda.
function lut(xs: number[], ys: number[], v: number) {
  if (v <= xs[0]) return ys[0]
  for (let i = 1; i < xs.length; i++) if (v <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (v - xs[i - 1])) / (xs[i] - xs[i - 1])
  return ys[ys.length - 1]
}
const pitchOf = (v: number) => (!FEEL ? 0.12 * smooth((v - 4.5) / 3) : (lut([3.2, 5, 6.2, 7, 8], [0, 2.5, 5, 9, 16], v) * Math.PI) / 180)
const armOf = (v: number) => (!FEEL ? 1 : lut([1.8, 3, 4.4, 6.2, 7, 8], [0.8, 1.5, 0.95, 1.2, 1.35, 1.6], v))
const relaxOf = (v: number) => (!FEEL ? 0 : 0.45 * (1 - smooth((v - 1.8) / 1.2)))
// topla (surme): yavasta yurume, 3.5-7 m/s arasi Gameplay Football surme dongusu -> sprint
const BALL_KEYS = ['walk', 'walkf', 'gf_dribble', 'gf_sprint']
const RATE_MIN = 0.55 // en yavas bant altinda oynatma hizi alt siniri (altinda parametrige karisir)
const RATE_MAX = 1.3 // en ust bandin ustunde oynatma hizi ust siniri (gerisi adim boyu germe)

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
const OFF = Q.get('clips') === '0' || Q.get('loco') === '0'
// topla kosu (surme) klipten: varsayilan ACIK (dogrulandi: dokunus oncesi ayak-top 1-5 cm, basan ayak kaymasi medyan ~1 cm); ?locoball=0 kapatir
const BALL_ON = Q.get('locoball') !== '0'
// locofeel: hiz kademeli stil (kosu/sprint ayrimi, egim, kol genligi); ?locofeel=0 eski davranis (karsilastirma)
const FEEL = Q.get('locofeel') !== '0'

let bank: CBank | null = null
let bandsFree: CClip[] = []
let bandsBall: CClip[] = []
const status = layerStatus('loco')
if (!OFF)
  void Promise.all([loadJson<CBank>(asset('anim_loco_cmu.json')), loadJson<CBank>(asset('anim_loco_gf.json'))]).then(([b, gf]) => {
    if (!b) return
    // iki bankanin kemik listesi ayni (bake betikleri ayni dnames siralamasi)
    if (gf && gf.m === b.m && gf.bones.join() === b.bones.join()) Object.assign(b.clips, gf.clips)
    bank = b
    const pick = (ks: string[]) => ks.filter((k) => b.clips[k]).map((k) => b.clips[k]).sort((x, y) => x.vref - y.vref)
    bandsFree = pick(BAND_KEYS)
    bandsBall = pick(BALL_KEYS)
    status.loaded = bandsFree.length > 0
  })

class FootLock {
  lock = false
  free = 9
  lx = 0
  lz = 0
  w = 0
  reachW = 0
  bx = 0
  bz = 0
}

class LocoState {
  phase = 0
  w = 0 // klip agirligi (0..1)
  v = 0 // yumusatilmis hiz
  yaw = NaN
  omega = 0 // donus hizi (rad/s)
  lean = 0
  feet = [new FootLock(), new FootLock()]
  bm = 0 // topla set karisimi
  // olcum (test): son dokunus anindaki ayak-top mesafesi
  dbg: Record<string, number> = {}
}

const qA = new THREE.Quaternion()
const qB = new THREE.Quaternion()
const qC = new THREE.Quaternion()
const qD = new THREE.Quaternion()
const qLean = new THREE.Quaternion()
const vA = new THREE.Vector3()
const vP = new THREE.Vector3()
const vO = new THREE.Vector3()
const vU = new THREE.Vector3()
const vT = new THREE.Vector3()
const Zax = new THREE.Vector3(0, 0, 1)
const Xax = new THREE.Vector3(1, 0, 0)
const qPitch = new THREE.Quaternion()
const UPPER: boolean[] = []
const ARM: number[] = []
const qE = new THREE.Quaternion()
const qI = new THREE.Quaternion()
const pel = [0, 0, 0]

function sampleQ(c: CClip, ph: number, bi: number, out: THREE.Quaternion, m: number) {
  const f = ph * m
  const i = Math.floor(f) % m
  const a = f - Math.floor(f)
  const f0 = c.q[i]
  const f1 = c.q[(i + 1) % m]
  const o = bi * 4
  qA.set(f0[o], f0[o + 1], f0[o + 2], f0[o + 3])
  qB.set(f1[o], f1[o + 1], f1[o + 2], f1[o + 3])
  return out.copy(qA).slerp(qB, a)
}
function samplePel(c: CClip, ph: number, m: number, k: number) {
  const f = ph * m
  const i = Math.floor(f) % m
  const a = f - Math.floor(f)
  const p0 = c.pel[i]
  const p1 = c.pel[(i + 1) % m]
  return p0[k] + (p1[k] - p0[k]) * a
}
/** devir icinde bir sonraki temas fazina kalan faz (0..1) */
// karisim listesi (kare basina, tahsissiz): klip ve agirlik (toplam 1)
const mixC: CClip[] = []
const mixW: number[] = []
let nMix = 0
function addMix(c: CClip, w: number) {
  if (w <= 1e-4) return
  for (let k = 0; k < nMix; k++)
    if (mixC[k] === c) {
      mixW[k] += w
      return
    }
  mixC[nMix] = c
  mixW[nMix++] = w
}
const toPhase = (from: number, at: number) => (((at - from) % 1) + 1) % 1

const LOCO_NAMES = new Set(['walk', 'jog', 'run', 'sprint'])

function applyLoco(ctx: LayerCtx, b: CBank, st: LocoState): boolean {
  const { rig, gdt } = ctx
  const m = b.m
  const s = Math.hypot(ctx.lvx, ctx.lvz)
  const dribble = BALL_ON && ctx.name === 'dribble' && ctx.hasBall
  const active = LOCO_NAMES.has(ctx.name) || dribble
  // yalniz ileri dogru kosu: yana / geri hareket parametrikte kalir (jokey, geri kosu)
  const cosF = s > 1e-3 ? ctx.lvz / s : 0
  const want = active ? smooth((cosF - 0.6) / 0.25) * smooth((s - 0.3) / 0.5) : 0
  const tau = want > st.w ? 0.2 : 0.16
  st.w += (want - st.w) * Math.min(1, gdt / tau)
  if (st.w < 0.01) {
    st.w = 0
    st.yaw = NaN
    st.v = s
    st.phase = ctx.anim.gaitPhase
    const T0 = globalThis as unknown as { __locoDbg?: Record<string, unknown> }
    if (T0.__locoDbg) T0.__locoDbg[rig.bone('pelvis')?.uuid ?? ''] = { w: 0 }
    return false
  }
  st.v += (s - st.v) * Math.min(1, gdt * 10)
  const v = Math.max(0.05, st.v)

  // bant secimi (her bant seti icin): komsu iki klip, vref'e gore dogrusal agirlik (oynatma hizi 1).
  // Topsuz ve topla setler st.bm (0..1) ile karisir: top alinip verilince klip degisimi pop yapmaz.
  st.bm += ((dribble ? 1 : 0) - st.bm) * Math.min(1, gdt / 0.25)
  if (st.bm < 0.005) st.bm = 0
  if (st.bm > 0.995) st.bm = 1
  if (!bandsBall.length) st.bm = 0
  nMix = 0
  let rate = 0
  let stride = 0
  let amp = 0
  let dur = 0
  const T = globalThis as unknown as { __locoClip?: string; __locoPhase?: number; __locoDbg?: Record<string, unknown> }
  for (let set = 0; set < 2; set++) {
    const ws = set === 0 ? 1 - st.bm : st.bm
    if (ws <= 0) continue
    const bands = set === 0 ? bandsFree : bandsBall
    const n = bands.length
    let c0 = bands[0]
    let c1 = bands[0]
    let a = 0
    let r = 1
    let sd = 1
    let am = 1
    const vs = set === 0 && !T.__locoClip ? styleV(v) : v
    if (T.__locoClip && b.clips[T.__locoClip]) {
      // test kancasi: tek klip, kendi vref'inde
      c0 = c1 = b.clips[T.__locoClip]
      r = v / c0.vref
    } else if (vs <= bands[0].vref) {
      r = Math.max(RATE_MIN, vs / bands[0].vref)
      am = Math.min(1, vs / (bands[0].vref * r))
    } else if (vs >= bands[n - 1].vref) {
      c0 = c1 = bands[n - 1]
      const k = vs / c0.vref
      r = Math.min(RATE_MAX, Math.sqrt(k))
      sd = k / r
    } else {
      let i = 0
      while (i < n - 2 && vs > bands[i + 1].vref) i++
      c0 = bands[i]
      c1 = bands[i + 1]
      a = (vs - c0.vref) / (c1.vref - c0.vref)
    }
    // stil hizi < gercek hiz: kalan oran kadans (sqrt) ve adim boyu arasinda bolunur (ayak kilidi kaymayi tutar)
    const e = v / vs
    if (e > 1.001) {
      const re = Math.sqrt(e)
      r *= re
      sd *= e / re
    }
    addMix(c0, ws * (1 - a))
    if (c1 !== c0) addMix(c1, ws * a)
    rate += r * ws
    stride += sd * ws
    amp += am * ws
    dur += (c0.dur + (c1.dur - c0.dur) * a) * ws
  }
  st.phase = (st.phase + (rate * gdt) / dur) % 1
  if (T.__locoPhase !== undefined) st.phase = T.__locoPhase
  // parametrik gait de ayni fazda kalsin (karisim ve geciste bacaklar ayni adimda)
  ctx.anim.setPhase(st.phase)

  // donus egimi: dunya sapma hizindan (bir kare gecikmeli), merkezcil ivmeye dogru
  const yaw = rig.worldYaw()
  if (!Number.isNaN(st.yaw) && gdt > 1e-4) {
    let dy = yaw - st.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    st.omega += (dy / gdt - st.omega) * Math.min(1, gdt * 8)
  }
  st.yaw = yaw
  const leanT = Math.max(-0.3, Math.min(0.3, Math.atan((v * st.omega) / 9.81) * 0.7))
  st.lean += (leanT - st.lean) * Math.min(1, gdt * 6)
  // sola donus (omega > 0) -> govde sola (+x) yatar: Z ekseni etrafinda negatif aci
  qLean.setFromAxisAngle(Zax, -st.lean)

  // hizli kosuda (klip hizinin ustu) govde biraz daha one (sprint durusu); yalniz omurga ve ustu
  const pitch = pitchOf(v)
  qPitch.setFromAxisAngle(Xax, pitch)
  const armK = armOf(v)
  const relax = relaxOf(v)
  if (!UPPER.length)
    for (const nm of b.bones) {
      UPPER.push(/^(spine_|neck|head|clavicle|upperarm|lowerarm|hand)/.test(nm))
      ARM.push(/^upperarm/.test(nm) ? 1 : /^(lowerarm|hand)/.test(nm) ? 2 : 0)
    }
  const ph2 = (st.phase + 0.5) % 1
  const W = st.w * amp
  const w = W > 0.99 ? 1 : W
  const names = b.bones
  for (let bi = 0; bi < names.length; bi++) {
    let acc = 0
    for (let k = 0; k < nMix; k++) {
      const wk = mixW[k]
      if (k === 0) sampleQ(mixC[0], st.phase, bi, qC, m)
      else qC.slerp(sampleQ(mixC[k], st.phase, bi, qD, m), wk / (acc + wk))
      acc += wk
    }
    if (ARM[bi] === 1 && Math.abs(armK - 1) > 0.01) {
      // kol salinim genligi: devrin iki karsit ucunun ortasi (ortalama kol) etrafinda olcekle
      let acc2 = 0
      for (let k = 0; k < nMix; k++) {
        const wk = mixW[k]
        if (k === 0) sampleQ(mixC[0], ph2, bi, qE, m)
        else qE.slerp(sampleQ(mixC[k], ph2, bi, qD, m), wk / (acc2 + wk))
        acc2 += wk
      }
      qE.slerp(qC, 0.5)
      qC.copy(qE.slerp(qC, armK))
    } else if (ARM[bi] === 2 && relax > 0.01) qC.slerp(qI, relax)
    if (UPPER[bi]) qC.premultiply(qPitch)
    qC.premultiply(qLean)
    rig.blendBone(names[bi], qC, w)
  }
  pel[0] = pel[1] = pel[2] = 0
  let crPh = 0
  for (let k = 0; k < nMix; k++) {
    for (let d = 0; d < 3; d++) pel[d] += samplePel(mixC[k], st.phase, m, d) * mixW[k]
    crPh += mixC[k].cr[0] * mixW[k]
  }
  // egim: pelvis zemindeki orijin etrafinda doner (yana kayma)
  const hipH = 0.95 + pel[1]
  pel[0] += Math.sin(st.lean) * hipH
  pel[1] -= (1 - Math.cos(st.lean)) * hipH
  // adim germe: hizlandirma siniri asildiysa bacaklar daha genis acilir; ayaklara erisim icin pelvis hafif alcalir
  if (stride > 1.001) pel[1] -= 0.06 * (stride - 1)
  rig.blendPelvis(pel[0], pel[1], pel[2], w)
  if (stride > 1.001) {
    rig.bonePos('pelvis', vP)
    for (const side of ['l', 'r'] as const) {
      rig.bonePos(`foot_${side}`, vA)
      vT.set(vA.x, vA.y, vP.z + (vA.z - vP.z) * stride)
      rig.reachFoot(side, vT, w)
    }
  }

  // ayak inis zamanlari (s): faz 0 sol, cr sag; simulasyonun surme dokunusu (footTiming.r) buna senkron
  const per = dur / rate
  const tL = toPhase(st.phase, 0) * per
  const tR = toPhase(st.phase, crPh) * per
  if (W > 0.5) ctx.anim.setExternalContact(tL, tR)

  // surme: sag ayak inise yaklasirken topa (dokunus ani = inis ani). Inis sonrasi hedef kilitli (ayak kayip topu izlemez).
  // --- ayak kilidi (basan ayak kaymaz) + surme dokunusu ---
  // Klibin basma bayragi (stL/stR, karisim agirlikli) acilinca ayagin o anki yeri dunyada sabitlenir: karakter ilerledikce /
  // dondukce yerel hedef geri / ters yone gider, IK ile ayak orada tutulur. Basma bitince (parmak kalkisi) hedef birakilir,
  // salinimda 0.1 s'de klibe doner (havada; kayma sayilmaz). Yukseklik her zaman klipten (yalniz x,z kilitli).
  // Surmede sag ayagin basma yeri topun arkasi: inisten 0.16 s once ayak topa uzanir, inis = simulasyonun dokunus ani.
  const dyaw = st.omega * gdt
  const cy = Math.cos(dyaw)
  const sy = Math.sin(dyaw)
  rig.localToModel(0, 0, 0, vO)
  rig.localToModel(1, 0, 0, vU)
  const u = vU.x - vO.x
  const touchOK = dribble && ctx.ball.z > 0.05 && ctx.ball.z < 0.85 && Math.abs(ctx.ball.x) < 0.6 && ctx.ball.y < 0.4
  for (let f = 0; f < 2; f++) {
    const F = st.feet[f]
    const side = f === 0 ? 'l' : 'r'
    rig.bonePos(`foot_${side}`, vA)
    // basma: klibin bilegi yere yakin (dinlenme bilegi + ~4 cm) -> kilit; 13 cm'den yukari kalkinca ya da klip ayagi
    // kilit noktasindan 50 cm uzaklasinca (bacak gerilmesin) birakilir. Histerezisli, en az 0.08 s serbest kalir.
    const cyL = (vA.y - vO.y) / u
    const cxL = (vA.x - vO.x) / u
    const czL = (vA.z - vO.z) / u
    F.free += gdt
    let inSt = F.lock
    if (!F.lock && W > 0.5 && cyL < 0.115 && F.free > 0.08) inSt = true
    if (F.lock && (cyL > 0.13 || Math.hypot(cxL - F.lx, czL - F.lz) > 0.5 || W <= 0.5)) inSt = false
    // surme: sag ayak inise yaklasirken topa uzanir
    let reach = 0
    if (f === 1 && touchOK && !F.lock && tR < 0.16) {
      reach = smooth(1 - (tR - 0.02) / 0.14)
      F.bx = ctx.ball.x - 0.04
      F.bz = ctx.ball.z - 0.15
    }
    if (inSt && !F.lock) {
      F.lock = true
      if (f === 1 && touchOK && F.reachW > 0.3) {
        F.lx = F.bx
        F.lz = F.bz
      } else {
        F.lx = cxL
        F.lz = czL
      }
    } else if (!inSt && F.lock) {
      F.lock = false
      F.free = 0
    }
    if (F.lock) {
      const x = F.lx - ctx.lvx * gdt
      const z = F.lz - ctx.lvz * gdt
      F.lx = x * cy - z * sy
      F.lz = x * sy + z * cy
      F.w = 1
    } else F.w = Math.max(0, F.w - gdt / 0.1)
    F.reachW += (reach - F.reachW) * Math.min(1, gdt * 30)
    if (F.reachW > 0.01 && !F.lock) {
      rig.localToModel(F.bx, (vA.y - vO.y) / u, F.bz, vT)
      rig.reachFoot(side, vT, F.reachW * w)
    } else if (F.w > 0.01) {
      rig.localToModel(F.lx, (vA.y - vO.y) / u, F.lz, vT)
      rig.reachFoot(side, vT, smooth(F.w) * w)
    }
    if (!F.lock && F.w <= 0) {
      F.lx = (vA.x - vO.x) / u
      F.lz = (vA.z - vO.z) / u
    }
  }
  const touchW = st.feet[1].reachW
  if (T.__locoDbg) T.__locoDbg[rig.bone('pelvis')?.uuid ?? ''] = { ph: st.phase, w: st.w, v, rate, stride, bm: st.bm, pitch, armK, cad: (2 * rate) / dur, mix: mixC.slice(0, nMix).map((c, k) => c.src + ':' + mixW[k].toFixed(2)), tR, tL, lean: st.lean, touchW, lockL: st.feet[0].lock, lockR: st.feet[1].lock }
  return true
}

export const locoLayer: Layer = (ctx) => {
  if (!bank || !bandsFree.length) return
  const st = layerState(ctx, 'loco', () => new LocoState())
  if (applyLoco(ctx, bank, st)) status.frames++
}
