// Katman: pas (pass), ilk dokunus (trap-*), kafa (header). SAHIBI: pas/kafa ajani.
// Kaynak: Gameplay Football / Google Research Football animasyonlari (Unlicense) -> anim_src/bake_pass.py -> public/anim_pass.json.
// Her klibin kaynak temas karesi oyunun temas anina (CLIP_LEN) oturtulur: temastan once en fazla PRE_MAX hizlandirma,
// gerisi klibin basinda beklenir; temastan sonra kalan kisim oyunun kalan suresine (sinirli olcekle) yayilir.
// Pas: vuran (sag) bilek temas civarinda gercek topa cekilir (rig.reachFoot). Kafa: topun temas anindaki tahmini yuksekligine
// gore pelvis dikey kaydirilir (ziplama yuksekligi), govde topa doner. Ilk dokunus: oyunda animasyon TEMAS ANINDA baslar,
// bu yuzden klip temas karesinden az once baslatilir (yaklasma kismi oynatilamaz).
// Klip yoksa / yuklenmezse / ?clips=0 ise hicbir sey yapmaz: parametrik klipler (actions.ts) aynen kalir.
import * as THREE from 'three'
import { asset } from '../../assetUrl'
import type { RigDriver } from '../rig'
import { actionStyle } from '../actionStyle'
import { layerState, type Layer, type LayerCtx } from './types'
import { layerStatus, loadJson, qa, qb, qc, smooth } from './util'

interface ClipJ {
  n: number
  contact: number | null // kare (FPS)
  q: number[][]
  pel: number[][]
  root: number[][]
  ball?: number[] // temas aninda top (karakter uzayi, m)
}
interface BankJ {
  bones: string[]
  fps: number
  clips: Record<string, ClipJ>
}

const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('clips') === '0'

let bank: BankJ | null = null
const status = layerStatus('pass')
if (!OFF)
  // rabona ajani: anim_rabona.json (highpass = havadan/sert pas, kisa ara pas klipleri; ayni kemik listesi) ayni banka eklenir
  void Promise.all([loadJson<BankJ>(asset('anim_pass.json')), loadJson<BankJ>(asset('anim_rabona.json'))]).then(([j, jr]) => {
    if (j && jr && jr.fps === j.fps && jr.bones.join() === j.bones.join()) Object.assign(j.clips, jr.clips)
    bank = j
    status.loaded = !!j
  })

// oyun suresi / temas (CLIP_LEN ve TRAP_ANIM_T ile ayni)
const PASS_LEN = 0.55
const PASS_CONTACT = 0.22
const LOB_CONTACT = 0.27 // havadan pas: simulasyon temasi CLIP_LEN.kickContact (kick.ts gibi adim ortasi)
const HDR_LEN = 0.6
const HDR_CONTACT = 0.38
const TRAP_LEN: Record<string, number> = { 'trap-foot': 0.3, 'trap-thigh': 0.45, 'trap-chest': 0.55 }
const UPPER = /^(spine_|neck|head|clavicle|upperarm|lowerarm|hand)/

class St {
  clip = ''
  gc = 0.22 // oyun temas ani (havadan pas: sutla ayni 0.27)
  lastT = 9
  name = ''
  near = false
  bx = 0
  by = 0
  bz = 0
  pbx = 0 // onceki kare top (hiz tahmini)
  pby = 0
  pbz = 0
  vx = 0
  vy = 0
  vz = 0
  upper = false // yalniz ust govde (kosarken gogus)
  dy = 0 // kafa: pelvis dikey ek (m)
  yaw = 0 // kafa: govde donusu (rad)
  tail = 0 // bitis kuyrugu (s)
  // ayak sabitleme (0 sol, 1 sag): klip yerinde oynadigi ve govde donusu duzeltildigi icin basan ayak kayardi
  pin = [false, false]
  pw = [0, 0]
  px = [0, 0]
  pz = [0, 0]
  decided = false // kafa: klip secildi mi (hiz tahmini birkac kare isindiktan sonra)
}

const tgt = new THREE.Vector3()
const fp = new THREE.Vector3()
const o0 = new THREE.Vector3()
const o1 = new THREE.Vector3()
const SIDE = ['l', 'r'] as const

/**
 * basan ayagi yerde sabitler: klip bilegi yere yakinsa (ankleH + 4 cm) ilk temas yerini karakter uzayinda tutar
 * (oyuncu kayarsa hizla geri kaydirir), reachFoot ile oraya ceker; kalkinca 0.08 s'de birakir.
 */
function pinFeet(ctx: LayerCtx, rig: RigDriver, st: St, w: number, which: number) {
  rig.localToModel(0, 0, 0, o0)
  const u = rig.localToModel(1, 0, 0, o1).x - o0.x
  const ank = rig.dims.ankleH
  const dt = ctx.gdt
  for (let i = 0; i < 2; i++) {
    if (!(which & (1 << i))) continue
    rig.bonePos(i === 0 ? 'foot_l' : 'foot_r', fp)
    const ly = (fp.y - o0.y) / u
    if (ly < ank + 0.04) {
      if (!st.pin[i]) {
        st.pin[i] = true
        st.px[i] = (fp.x - o0.x) / u
        st.pz[i] = (fp.z - o0.z) / u
      } else {
        st.px[i] -= ctx.lvx * dt
        st.pz[i] -= ctx.lvz * dt
      }
      st.pw[i] = Math.min(1, st.pw[i] + dt / 0.05)
    } else {
      st.pin[i] = false
      st.pw[i] = Math.max(0, st.pw[i] - dt / 0.08)
    }
    if (st.pw[i] > 0.001) {
      rig.localToModel(st.px[i], Math.max(ank, ly), st.pz[i], tgt)
      rig.reachFoot(SIDE[i], tgt, st.pw[i] * w * wMul)
    }
  }
}
const qy = new THREE.Quaternion()
const Y = new THREE.Vector3(0, 1, 0)
const X = new THREE.Vector3(1, 0, 0)

/** klip kare indeksi (kesirli) -> kemikler + pelvis; upper: yalniz ust govde */
// aksiyon bittikten sonra (oyun animi lokomosyona dondu) kisa kuyruk: klip agirligi bu carpanla soner (pop olmasin)
let wMul = 1

function pose(rig: RigDriver, b: BankJ, c: ClipJ, f: number, w: number, upper: boolean, dy: number) {
  w *= wMul
  if (w < 0.01) return
  f = Math.min(c.n - 1.001, Math.max(0, f))
  const i = Math.floor(f)
  const a = f - i
  const q0 = c.q[i]
  const q1 = c.q[i + 1]
  const names = b.bones
  for (let bi = 0; bi < names.length; bi++) {
    if (upper && !UPPER.test(names[bi])) continue
    qa.set(q0[bi * 4], q0[bi * 4 + 1], q0[bi * 4 + 2], q0[bi * 4 + 3])
    qb.set(q1[bi * 4], q1[bi * 4 + 1], q1[bi * 4 + 2], q1[bi * 4 + 3])
    rig.blendBone(names[bi], qc.copy(qa).slerp(qb, a), w)
  }
  if (!upper) {
    const p0 = c.pel[i]
    const p1 = c.pel[i + 1]
    rig.blendPelvis(0, p0[1] + (p1[1] - p0[1]) * a + dy, 0, w)
  }
}

/**
 * oyun zamani t -> klip karesi. Temastan once klip en fazla preMax kat hizlanir (gerisinde ilk karede beklenir),
 * temastan sonra kalan klip oyunun kalanina [0.8, postMax] olcekle yayilir.
 */
function warp(c: ClipJ, fps: number, t: number, gC: number, gLen: number, preMax: number, postMax: number) {
  const cc = (c.contact ?? 0) / fps
  const cEnd = (c.n - 1) / fps
  let s: number
  if (t <= gC) {
    const k = Math.min(preMax, Math.max(1, cc / Math.max(1e-3, gC)))
    s = Math.max(0, cc - (gC - t) * k)
  } else {
    const k = Math.min(postMax, Math.max(0.8, (cEnd - cc) / Math.max(1e-3, gLen - gC)))
    s = cc + (t - gC) * k
  }
  return s * fps
}

function newAction(ctx: LayerCtx, st: St, b: BankJ) {
  const sp = Math.hypot(ctx.lvx, ctx.lvz)
  const g = globalThis as { __passClip?: string }
  st.upper = false
  st.dy = 0
  st.yaw = 0
  // pas cesidi (anim/actionStyle.ts; locomotion.ts yazar): yerden / sert / ara / havadan. Klip yoksa hiz secimi kalir.
  const sty = (g as { __passStyle?: string }).__passStyle ?? (ctx.id >= 0 ? actionStyle[ctx.id] : undefined) ?? 'ground'
  st.gc = sty === 'lob' ? LOB_CONTACT : PASS_CONTACT
  if (ctx.name === 'pass') {
    st.clip = sp < 1.2 ? 'pass_idle' : sp < 4.6 ? 'pass_walk' : 'pass_sprint'
    const pick = sty === 'lob' ? (sp < 1.2 ? 'hpass_walk_long' : 'hpass_walk') : sty === 'driven' ? 'hpass_walk' : sty === 'through' && sp < 4.6 ? 'pass_walk_short' : ''
    if (pick && b.clips[pick]) st.clip = pick
  }
  else if (ctx.name === 'header') st.clip = 'header'
  else if (ctx.name === 'trap-foot') st.clip = sp < 1.5 ? 'trap_foot' : 'trap_foot_walk'
  else if (ctx.name === 'trap-thigh') st.clip = 'trap_thigh'
  else {
    st.clip = 'trap_chest'
    st.upper = sp > 1.5 // kosarken bacaklar lokomosyondan (kayma olmasin)
  }
  if (g.__passClip && b.clips[g.__passClip]) st.clip = g.__passClip
  st.pbx = ctx.ball.x
  st.pby = ctx.ball.y
  st.pbz = ctx.ball.z
  st.vx = st.vy = st.vz = 0
  st.near = false
  st.decided = false
  st.pin[0] = st.pin[1] = false
  st.pw[0] = st.pw[1] = 0
}

function trackBall(ctx: LayerCtx, st: St) {
  const bl = ctx.ball
  const dt = Math.max(1e-3, ctx.gdt)
  const vx = (bl.x - st.pbx) / dt
  const vy = (bl.y - st.pby) / dt
  const vz = (bl.z - st.pbz) / dt
  // kaba suzgec (kare zamanindaki titreme); isinma: ilk karede hiz 0
  st.vx += (vx - st.vx) * 0.5
  st.vy += (vy - st.vy) * 0.5
  st.vz += (vz - st.vz) * 0.5
  st.pbx = bl.x
  st.pby = bl.y
  st.pbz = bl.z
}

function runPass(ctx: LayerCtx, rig: RigDriver, b: BankJ, st: St, t: number): boolean {
  const c = b.clips[st.clip]
  if (!c || t > PASS_LEN) return false
  const w = Math.min(smooth(t / 0.06), 1 - smooth((t - 0.43) / 0.12))
  if (w < 0.01) return false
  const ww = w > 0.99 ? 1 : w
  pose(rig, b, c, warp(c, b.fps, t, st.gc, PASS_LEN, st.clip.startsWith('hpass') ? 1.6 : 1.35, 1.4), ww, false, 0)
  pinFeet(ctx, rig, st, ww, 1)
  // vuran ayak: top yakindaysa bilek topun saginda/arkasinda (ayak ici); temas sonrasi hedef donar
  const bl = ctx.ball
  if (t < st.gc) {
    st.near = bl.y < 0.5 && bl.z > -0.1 && bl.z < 1.1 && Math.abs(bl.x) < 0.7
    if (st.near) {
      st.bx = bl.x
      st.bz = bl.z
    }
  }
  const wk = smooth((t - (st.gc - 0.12)) / 0.09) * (1 - smooth((t - (st.gc + 0.03)) / 0.12))
  if (st.near && wk > 0.001) {
    rig.localToModel(st.bx - 0.12, 0.09, st.bz - 0.03, tgt)
    rig.reachFoot('r', tgt, wk * ww * wMul)
  }
  return true
}

function runHeader(ctx: LayerCtx, rig: RigDriver, b: BankJ, st: St, t: number): boolean {
  if (t > HDR_LEN) return false
  // temas anindaki top: hizdan tahmin (yercekimi dahil); temasa kadar guncellenir
  if (t < HDR_CONTACT - 0.02 || !st.decided) {
    trackBall(ctx, st)
    const dt = HDR_CONTACT - t
    const bl = ctx.ball
    st.bx = bl.x + st.vx * dt
    st.by = bl.y + st.vy * dt - 4.9 * dt * dt
    st.bz = bl.z + st.vz * dt
    const hy = (globalThis as { __hdrBallY?: number }).__hdrBallY
    if (hy !== undefined) {
      st.bx = 0
      st.by = hy
      st.bz = 0.45
    }
    const valid = st.by > 0.9 && st.by < 2.8 && Math.hypot(st.bx, st.bz) < 1.6
    // yuksek top: ziplamali klip; degilse ayakta kafa + dikey kaydirma
    if (!st.decided && t >= 0.05) {
      st.clip = valid && st.by > 1.8 ? 'header_jump' : 'header'
      st.decided = true
    }
    // bizim iskelette (test sayfasinda olculdu) temas aninda alin yuksekligi: ayakta ~1.63 m, ziplamali ~1.82 m (dy=0).
    // Ziplamali klibin kendi ayak acikligi ~0.3 m; ek en fazla +0.25 (toplam ayak acikligi ~0.55 m ile sinirli).
    const jump = st.clip === 'header_jump'
    const ref = jump ? 1.82 : 1.63
    st.dy = valid ? Math.max(jump ? -0.15 : -0.4, Math.min(jump ? 0.2 : 0.15, st.by - ref)) : 0
    st.yaw = valid ? Math.max(-0.6, Math.min(0.6, Math.atan2(st.bx, Math.max(0.2, st.bz)))) : 0
  }
  const c = b.clips[st.clip]
  if (!c) return false
  const w = Math.min(smooth(t / 0.06), 1 - smooth((t - 0.5) / 0.1))
  if (w < 0.01) return false
  const ww = w > 0.99 ? 1 : w
  // dikey ek ve donus temas cevresinde (yukari cikis/inis klibin kendi ziplamasina eklenir)
  const env = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.12) / (HDR_LEN - 0.12 - 0.04))))
  // alcak top: pelvis inmez (ayak yere girmesin); govde one egilir
  const dy = st.dy > 0 ? st.dy * env : 0
  pose(rig, b, c, warp(c, b.fps, t, HDR_CONTACT, HDR_LEN, 1.15, 1.6), ww, false, dy)
  pinFeet(ctx, rig, st, ww, 3) // ziplamada ayak havadayken devre disi (yalniz yere yakin bilek)
  if (st.dy < 0) {
    // ust sinir ~34 derece (daha fazlasi gorselde katlanma oldu); kafa gogusle ayni aci (klipteki bas hareketi korunur)
    const bend = Math.min(0.6, -st.dy * 1.8) * Math.min(1, env * 1.6) * ww * wMul
    rig.preRotate('spine_01', qy.setFromAxisAngle(X, bend * 0.5))
    rig.preRotate('spine_03', qy.setFromAxisAngle(X, bend))
    rig.preRotate('head', qy.setFromAxisAngle(X, bend))
  }
  if (Math.abs(st.yaw) > 0.01) {
    // govde topa: pelvis/omurga paylastirilmis donus (bacaklar yerde kalir)
    const k = st.yaw * smooth((t - 0.1) / 0.18) * (1 - smooth((t - 0.45) / 0.12)) * ww * wMul
    rig.preRotate('spine_01', qy.setFromAxisAngle(Y, k * 0.4))
    rig.preRotate('spine_03', qy.setFromAxisAngle(Y, k * 0.8))
    rig.preRotate('head', qy.setFromAxisAngle(Y, k))
  }
  return true
}

function runTrap(_ctx: LayerCtx, rig: RigDriver, b: BankJ, st: St, t: number): boolean {
  const len = TRAP_LEN[st.name] ?? 0.4
  const c = b.clips[st.clip]
  if (!c || t > len) return false
  // oyunda temas animasyonun basinda: klip temas karesinden 0.05 s once baslar, gercek hizla oynar, sonunda kalir
  const s0 = Math.max(0, (c.contact ?? 0) / b.fps - 0.05)
  const cEnd = (c.n - 1) / b.fps
  const rem = cEnd - s0
  const k = Math.min(1.25, Math.max(0.9, rem / len))
  const f = (s0 + t * k) * b.fps
  const w = Math.min(smooth(t / 0.05), 1 - smooth((t - (len - 0.12)) / 0.12))
  if (w < 0.01) return false
  pose(rig, b, c, f, w > 0.99 ? 1 : w, st.upper, 0)
  if (!st.upper) pinFeet(_ctx, rig, st, w > 0.99 ? 1 : w, st.name === 'trap-foot' ? 1 : 3)
  if (st.name === 'trap-foot') {
    // oyunda top yakalandiginda (temas = animasyon basi) top ayaktan 0.6-0.8 m uzakta olabilir; sim onu ayagin onune ceker.
    // Sag ayak ici ilk 0.15 s topu izler (karsilar ve geri cekilerek yumusatir), sonra klibe birakir.
    const bl = _ctx.ball
    if (!st.decided) {
      st.near = bl.y < 0.45 && bl.z > -0.2 && Math.hypot(bl.x, bl.z) < 1.1
      st.decided = true
    }
    const wf = st.near ? smooth(t / 0.04) * (1 - smooth((t - 0.1) / 0.1)) : 0
    if (wf > 0.001) {
      rig.localToModel(bl.x - 0.11, Math.max(0.09, bl.y - 0.02), bl.z - 0.04, tgt)
      rig.reachFoot('r', tgt, wf * wMul)
    }
  }
  return true
}

const TAIL = 0.16 // s

function run(ctx: LayerCtx, b: BankJ, st: St, t: number): boolean {
  if (st.name === 'pass') return runPass(ctx, ctx.rig, b, st, t)
  if (st.name === 'header') return runHeader(ctx, ctx.rig, b, st, t)
  return runTrap(ctx, ctx.rig, b, st, t)
}

export const passLayer: Layer = (ctx) => {
  if (!bank) return
  const n = ctx.name
  const mine = n === 'pass' || n === 'header' || n.startsWith('trap-')
  if (!mine) {
    // oyun aksiyonu klip bitmeden lokomosyona dondurdu: klip TAIL s icinde soner (animator'un parametrik gecisi klibi bilmez)
    const st0 = ctx.st.pass as St | undefined
    if (!st0 || st0.tail <= 0) return
    st0.tail -= ctx.gdt
    st0.lastT += ctx.gdt
    wMul = smooth(st0.tail / TAIL)
    run(ctx, bank, st0, st0.lastT)
    wMul = 1
    return
  }
  const st = layerState(ctx, 'pass', () => new St())
  const t = ctx.animT
  if (t < st.lastT - 0.05 || st.name !== n) newAction(ctx, st, bank)
  st.lastT = t
  st.name = n
  st.tail = TAIL
  wMul = 1
  if (run(ctx, bank, st, t)) status.frames++
}
