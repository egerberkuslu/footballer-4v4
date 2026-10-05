// Katman: kayarak mudahale (slide) + yerden kalkis (slide sonrasi 'getup'), ayakta mudahale (tackle). SAHIBI: mudahale ajani.
// Kaynak: Gameplay Football / Google Research Football animasyonlari (Unlicense, kamu mali), bake_tackle.py ->
// public/anim_tackle.json. Klip temas karesi oyunun temas anina (CLIP_LEN.slideContact / tackleContact) zaman egriltmeyle
// oturur; vuran ayak temas civarinda topa cekilir. Omuz ('shoulder-l/r') icin kaynak yok: parametrik klip aynen kalir.
// Klip yuklenmezse ya da ?clips=0 ise katman hic calismaz (parametrik davranis aynen).
import * as THREE from 'three'
import { asset } from '../../assetUrl'
import type { RigDriver } from '../rig'
import { CLIP_LEN } from '../timing'
import { layerState, type Layer, type LayerCtx } from './types'
import { layerStatus, loadJson, qa, qb, qc, smooth } from './util'

interface ClipJ {
  n: number
  contact: number | null // kare (fps biriminde, kesirli)
  q: number[][]
  pel: number[][]
  ball?: number[] // temas aninda kaynaktaki top (karakter uzayi, m)
  start?: number // kalkis: kaymanin son karesine en yakin baslangic karesi
}
interface BankJ {
  bones: string[]
  fps: number
  clips: Record<string, ClipJ>
}

let bank: BankJ | null = null
const status = layerStatus('tackle')
const off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('clips') === '0'
if (!off) {
  void loadJson<BankJ>(asset('anim_tackle.json')).then((j) => {
    bank = j && j.clips.slide && j.clips.tackle_front ? j : null
    status.loaded = !!bank
  })
}

const SLIDE_C = CLIP_LEN.slideContact // 0.25
const SLIDE_END = 0.65 // simulasyon: 0.15 hazirlik + 0.5 kayma (locomotion.ts)
const TACKLE_C = CLIP_LEN.tackleContact // 0.22
const GETUP_BLEND = 0.22 // kayma sonu -> kalkis klibi gecisi (s)
const TAIL = 0.16 // aksiyon bitince (oyun anim adi degisince) son kareden parametrik/kosuya donus suresi
const LOCO = new Set(['idle', 'walk', 'jog', 'run', 'sprint', 'dribble', 'jockey', 'shield'])

class TState {
  last = '' // onceki kare oyun anim adi
  lastT = 9
  clip = '' // calan klip
  kind: '' | 'slide' | 'getup' | 'tackle' = ''
  slideT = 0 // son kayma animT'si (getup suresi tahmini)
  slideClip = 'slide' // son kayma klibi (kalkis gecisi bundan baslar)
  prevAction = ''
  getupDur = 1
  // cikis kuyrugu: oyun anim adi loco'ya dondugunde son klip karesi azalan agirlikla
  tailT = 9
  tailF = 0
  tailW = 0
  f = 0 // son orneklenen kare
  w = 0
}

const tgt = new THREE.Vector3()
const fp = new THREE.Vector3()

/** karakter uzayi (m; x sol, y zemin, z ileri) -> rig model uzayi */
function toModel(rig: RigDriver, x: number, y: number, z: number, out: THREE.Vector3) {
  const pel = rig.restModel('pelvis')
  const th = rig.restModel('thigh_l')
  const ca = rig.restModel('calf_l')
  if (!pel || !th || !ca) return out.set(x, y, z)
  const u = th.p.distanceTo(ca.p) / rig.dims.thigh // model birimi / metre
  return out.set(pel.p.x + x * u, pel.p.y - rig.dims.hipH * u + y * u, pel.p.z + z * u)
}

function applyFrame(rig: RigDriver, b: BankJ, c: ClipJ, f: number, w: number) {
  const ff = Math.min(c.n - 1.0001, Math.max(0, f))
  const i = Math.floor(ff)
  const a = ff - i
  const q0 = c.q[i]
  const q1 = c.q[Math.min(c.n - 1, i + 1)]
  const names = b.bones
  const ww = w > 0.99 ? 1 : w
  for (let bi = 0; bi < names.length; bi++) {
    const o = bi * 4
    qa.set(q0[o], q0[o + 1], q0[o + 2], q0[o + 3])
    qb.set(q1[o], q1[o + 1], q1[o + 2], q1[o + 3])
    rig.blendBone(names[bi], qc.copy(qa).slerp(qb, a), ww)
  }
  const p0 = c.pel[i]
  const p1 = c.pel[Math.min(c.n - 1, i + 1)]
  rig.blendPelvis(p0[0] + (p1[0] - p0[0]) * a, p0[1] + (p1[1] - p0[1]) * a, p0[2] + (p1[2] - p0[2]) * a, ww)
}

/** vuran ayagi (top tarafi) topa cek: top bacak menzilindeyse, zaman penceresi ve uzaklikla agirlikli */
function reachBall(ctx: LayerCtx, side: 'l' | 'r', wt: number) {
  const bl = ctx.ball
  if (wt <= 0.01 || bl.y > 0.6) return
  const rig = ctx.rig
  rig.bonePos(`foot_${side}`, fp)
  // bilek hedefi: topun 0.16 m gerisi (ayak tabani/ici topa degsin), yerden en az bilek yuksekligi
  toModel(rig, bl.x, Math.max(rig.dims.ankleH + 0.02, bl.y), bl.z - 0.16, tgt)
  const pel = rig.restModel('pelvis')
  const th = rig.restModel('thigh_l')
  const ca = rig.restModel('calf_l')
  const um = pel && th && ca ? th.p.distanceTo(ca.p) / rig.dims.thigh : 1 // model birimi / metre
  const dm = fp.distanceTo(tgt) / um
  const wd = 1 - smooth((dm - 0.25) / 0.35) // 0.25 m icinde tam, 0.6 m otesinde yok
  rig.reachFoot(side, tgt, Math.min(0.85, wt * wd))
}

function begin(st: TState, ctx: LayerCtx, b: BankJ) {
  const fv = (globalThis as { __tackleVar?: string }).__tackleVar // test: klibi sabitle
  st.tailW = 0
  if (ctx.name === 'slide') {
    st.kind = 'slide'
    st.clip = ctx.ball.x > 0.04 ? 'slide_m' : 'slide' // top solda: sol bacakla kay
    st.slideClip = st.clip
  } else if (ctx.name === 'tackle') {
    st.kind = 'tackle'
    const sp = Math.hypot(ctx.lvx, ctx.lvz)
    const base = sp > 4.5 ? 'tackle_reach' : sp > 1.8 ? 'tackle_stretch' : 'tackle_front'
    st.clip = base + (ctx.ball.x > 0.04 ? '_m' : '')
  } else if (ctx.name === 'getup' && (st.prevAction === 'slide' || (globalThis as { __tackleGetup?: boolean }).__tackleGetup)) {
    st.kind = 'getup'
    st.clip = 'standup_back'
    // simulasyon: iskada getup 0.8'de baslar, kilit 1.8'de biter (1.0 s); temasta kilit = 1.15 s (locomotion.ts)
    st.getupDur = st.slideT < 0.78 ? Math.max(0.45, 1.15 - st.slideT) : 1.0
  } else {
    st.kind = ''
    st.clip = ''
  }
  if (fv && st.kind && b.clips[fv]) st.clip = fv
}

export const tackleLayer: Layer = (ctx) => {
  const b = bank
  if (!b) return
  const st = layerState(ctx, 'tackle', () => new TState())
  const name = ctx.name
  const t = ctx.animT
  const restarted = name === st.last && t < st.lastT - 0.05
  if (name !== st.last || restarted) {
    const wasMine = st.kind !== '' && st.w > 0.01
    if (st.last === 'slide') st.prevAction = 'slide'
    else if (st.last && !LOCO.has(st.last) && st.last !== 'getup') st.prevAction = st.last
    if (wasMine && LOCO.has(name)) {
      // pop'suz donus: son kare kisa sure azalan agirlikla devam eder
      st.tailT = 0
      st.tailF = st.f
      st.tailW = st.w
    }
    begin(st, ctx, b)
  }
  st.last = name
  st.lastT = t

  if (!st.kind) {
    // cikis kuyrugu
    if (st.tailW > 0.01 && st.tailT < TAIL && LOCO.has(name) && st.clip) {
      st.tailT += ctx.gdt
      const c = b.clips[st.clip]
      if (c) applyFrame(ctx.rig, b, c, st.tailF, st.tailW * (1 - smooth(st.tailT / TAIL)))
      status.frames++
    } else st.tailW = 0
    return
  }
  const c = b.clips[st.clip]
  if (!c) return
  const fps = b.fps
  const last = c.n - 1
  let f = 0
  let w = 1
  if (st.kind === 'slide') {
    st.slideT = t
    const cf = c.contact ?? last * 0.5
    // temas oncesi: kaynak 0.32 s -> oyun 0.25 s; temas sonrasi kayma bitisine (0.65 s) kadar; sonra son kare (yerde)
    f = t <= SLIDE_C ? (t / SLIDE_C) * cf : cf + Math.min(1, (t - SLIDE_C) / (SLIDE_END - SLIDE_C)) * (last - cf)
    w = smooth(t / 0.07)
  } else if (st.kind === 'getup') {
    const s0 = c.start ?? 0
    f = s0 + Math.min(1, t / st.getupDur) * (last - s0)
    w = 1
    // gecis: kaymanin son karesinden (dirsege yaslanmis) kalkis klibine GETUP_BLEND s icinde
    const sc = b.clips[st.slideClip]
    if (sc && t < GETUP_BLEND) {
      applyFrame(ctx.rig, b, sc, sc.n - 1, 1)
      w = smooth(t / GETUP_BLEND)
    }
  } else {
    const cf = c.contact ?? 0
    // temasa kadar sikistir/genislet; temas sonrasi gercek zaman; klip bitince parametrik toparlanmaya karis
    f = t <= TACKLE_C ? (t / TACKLE_C) * cf : cf + (t - TACKLE_C) * fps
    const tEnd = TACKLE_C + (last - cf) / fps
    w = Math.min(smooth(t / 0.06), 1 - smooth((t - tEnd + 0.04) / 0.16))
  }
  st.f = f
  st.w = w
  if (w < 0.01) return
  applyFrame(ctx.rig, b, c, f, w)
  // temas penceresinde vuran ayak topa
  const side: 'l' | 'r' = st.clip.endsWith('_m') ? 'l' : 'r'
  if (st.kind === 'slide') reachBall(ctx, side, w * smooth((t - 0.12) / 0.08) * (1 - smooth((t - SLIDE_END) / 0.1)))
  else if (st.kind === 'tackle') reachBall(ctx, side, w * smooth((t - (TACKLE_C - 0.12)) / 0.1) * (1 - smooth((t - (TACKLE_C + 0.06)) / 0.12)))
  status.frames++
}
