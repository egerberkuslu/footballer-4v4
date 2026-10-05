// Katman: faul dusmesi ('fall') ve ardindan yerden kalkis ('getup'). SAHIBI: dusme ajani.
// CMU klipleri (anim_src/bake_fall.py -> public/anim_fall.json): dusme (sirt ustu 90_18, yuz ustu 139_16 tersten) + kalkis
// (yuz ustu 139_16/139_17, sirt ustu 140_08/140_09), her biri aynali. Pelvis yuksekligi bake'te derili mesh'in en alt noktasi
// zemine degecek sekilde, yatay pelvis yere degen vertexler kaymayacak sekilde cozulmustur (kok simulasyonda kalir).
// Dusme basinda yon/varyant secilir (ileri hiz -> cogunlukla yuz ustu; geri -> sirt ustu); kalkis, dusmenin yatis pozuna
// en yakin (yaw + pelvis ofseti) varyanttir. Kalan fark: yaw kalkis boyunca sifira cozulur, pelvis farki dusme ve kalkis
// arasinda paylastirilir. Kalkis basinda dusmenin son pozundan karisarak gecer, sonunda parametrik (ayakta) poza soner.
// Klip yuklenmezse, ?clips=0 ise ya da getup dusmeden sonra degilse (kayma/dalis) katman hic is yapmaz.
import * as THREE from 'three'
import { asset } from '../../assetUrl'
import { CLIP_LEN } from '../timing'
import type { RigDriver } from '../rig'
import { layerState, type Layer } from './types'
import { layerStatus, loadJson, qa, qb, qc, qd, smooth } from './util'

interface ClipJ {
  kind: 'fall' | 'getup'
  lie: 'face' | 'back'
  spd?: string // dusme: kaynak hiz sinifi (sprint | walk | idle | '' = her hiz)
  dur: number // dogal sure (s)
  n: number
  lieYaw: number
  q: number[][]
  pel: number[][]
}
interface BankJ {
  bones: string[]
  hipH?: number // bake iskeletinin dinlenme kalca yuksekligi (m); pelvis ofsetleri rig.dims.hipH / hipH ile olceklenir
  clips: Record<string, ClipJ>
}

let bank: (BankJ & { falls: string[]; getups: string[] }) | null = null
const status = layerStatus('fall')
const off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('clips') === '0'
if (!off) {
  void loadJson<BankJ>(asset('anim_fall.json')).then((j) => {
    if (!j) return
    const names = Object.keys(j.clips)
    bank = { ...j, falls: names.filter((n) => j.clips[n].kind === 'fall'), getups: names.filter((n) => j.clips[n].kind === 'getup') }
    status.loaded = true
  })
}

class FallState {
  prev = ''
  lastT = 99
  fall = '' // secili dusme klibi ('' = katman pasif)
  getup = ''
  psi = 0 // kalkis baslangic yaw farki (rad)
  cx = 0 // pelvis ofset farki (oyun x,z; m): yarisi dusmeye, yarisi kalkisa
  cz = 0
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const Y = new THREE.Vector3(0, 1, 0)
const qy = new THREE.Quaternion()
const tmpP = new THREE.Vector3()
const tmpP2 = new THREE.Vector3()

/** test/inceleme: globalThis.__fallSel = { fall: 'fall_back', getup: 'getup_back_m' } secimi sabitler */
type Sel = { fall?: string; getup?: string }
const sel = () => (globalThis as { __fallSel?: Sel }).__fallSel

/** kalkis varyanti: yatis yaw'i ve pelvis ofseti dusmeninkine en yakin olan (ayni yatis turunden) */
function pickGetup(b: NonNullable<typeof bank>, st: FallState) {
  const F = b.clips[st.fall]
  const fo = F.pel[F.n - 1]
  let best = ''
  let bc = 1e9
  for (const g of b.getups) {
    const G = b.clips[g]
    if (G.lie !== F.lie) continue
    const psi = wrap(F.lieYaw - G.lieYaw)
    const go = G.pel[0]
    const c = Math.cos(psi)
    const s = Math.sin(psi)
    const dx = go[0] * c + go[2] * s - fo[0]
    const dz = -go[0] * s + go[2] * c - fo[2]
    const cost = Math.hypot(dx, dz) + 0.6 * Math.abs(psi) + Math.random() * 0.15
    if (cost < bc) {
      bc = cost
      best = g
    }
  }
  st.getup = best
  const fs = sel()?.getup
  if (fs && b.clips[fs]) st.getup = fs
  const G = b.clips[st.getup]
  st.psi = wrap(F.lieYaw - G.lieYaw)
  const go = G.pel[0]
  const c = Math.cos(st.psi)
  const s = Math.sin(st.psi)
  st.cx = go[0] * c + go[2] * s - fo[0]
  st.cz = -go[0] * s + go[2] * c - fo[2]
}

function startFall(b: NonNullable<typeof bank>, st: FallState, lvx: number, lvz: number) {
  // hiz sinifina uygun dusmeler (GRF trip klipleri kosu/yuruyus/durus icin ayri); geri giderken sirt ustu,
  // yana hizla o yana dusen varyant (lieYaw isareti = basin dustugu yan, +x sol)
  const sp = Math.hypot(lvx, lvz)
  const cls = sp > 4.5 ? 'sprint' : sp > 1.2 ? 'walk' : 'idle'
  let cand = b.falls.filter((n) => b.clips[n].spd === cls || !b.clips[n].spd)
  if (lvz < -0.3) {
    const back = cand.filter((n) => b.clips[n].lie === 'back')
    if (back.length) cand = back
  } else if (sp > 1.2 && Math.random() < 0.8) {
    const face = cand.filter((n) => b.clips[n].lie === 'face')
    if (face.length) cand = face
  }
  if (Math.abs(lvx) > 1) {
    const sideC = cand.filter((n) => Math.sign(b.clips[n].lieYaw) === Math.sign(lvx) && Math.abs(b.clips[n].lieYaw) > 0.3)
    if (sideC.length && Math.random() < 0.7) cand = sideC
  }
  if (!cand.length) cand = b.falls
  st.fall = cand[Math.floor(Math.random() * cand.length)]
  const fs = sel()?.fall
  if (fs && b.clips[fs]) st.fall = fs
  pickGetup(b, st)
}

/** klip ornegi: u (0..1) -> kemik deltalari (ya * delta) ve pelvis (R(ya)*pel + (ox,oz)); w ile rig'e karisir.
 *  blendFrom: (0..1) > 0 ise once 'from' klibinin son karesiyle karistirilir. */
function apply(rig: RigDriver, b: NonNullable<typeof bank>, c: ClipJ, u: number, ya: number, ox: number, oz: number, w: number,
  from: ClipJ | null, fw: number, fox: number, foz: number) {
  const f = Math.min(c.n - 1.001, Math.max(0, u * (c.n - 1)))
  const i = Math.floor(f)
  const a = f - i
  const q0 = c.q[i]
  const q1 = c.q[i + 1]
  const qe = from ? from.q[from.n - 1] : null
  qy.setFromAxisAngle(Y, ya)
  const names = b.bones
  const ww = w > 0.99 ? 1 : w
  for (let bi = 0; bi < names.length; bi++) {
    const k = bi * 4
    qa.set(q0[k], q0[k + 1], q0[k + 2], q0[k + 3])
    qb.set(q1[k], q1[k + 1], q1[k + 2], q1[k + 3])
    qc.copy(qa).slerp(qb, a).premultiply(qy)
    if (qe && fw > 0.001) {
      qd.set(qe[k], qe[k + 1], qe[k + 2], qe[k + 3])
      qc.slerp(qd, fw)
    }
    rig.blendBone(names[bi], qc, ww)
  }
  const p0 = c.pel[i]
  const p1 = c.pel[i + 1]
  tmpP.set(p0[0] + (p1[0] - p0[0]) * a, p0[1] + (p1[1] - p0[1]) * a, p0[2] + (p1[2] - p0[2]) * a).applyAxisAngle(Y, ya)
  tmpP.x += ox
  tmpP.z += oz
  if (from && fw > 0.001) {
    const pe = from.pel[from.n - 1]
    tmpP.lerp(tmpP2.set(pe[0] + fox, pe[1], pe[2] + foz), fw)
  }
  // model olcegi (varyant boyu): ofsetler bake iskeletinin biriminde, oyundaki boya olcekle (yoksa yatan govde yere gomulur)
  const k = rig.dims.hipH / (b.hipH ?? 1.0158)
  rig.blendPelvis(tmpP.x * k, tmpP.y * k, tmpP.z * k, ww)
}

const FALL_MOVE = 0.95 // dusme hareketi en gec CLIP_LEN.fall'un bu kesrinde biter (dogal sure kisaysa dogal hizda), kalan yerde yatis

export const fallLayer: Layer = (ctx) => {
  const b = bank
  const st = layerState(ctx, 'fall', () => new FallState())
  const name = ctx.name
  const t = ctx.animT
  if (!b) {
    st.prev = name
    return
  }
  if (name === 'fall') {
    if (st.prev !== 'fall' || t < st.lastT - 0.05) startFall(b, st, ctx.lvx, ctx.lvz)
    st.lastT = t
    st.prev = name
    const F = b.clips[st.fall]
    if (!F) return
    const TF = CLIP_LEN.fall
    const u = Math.min(1, t / Math.min(F.dur, TF * FALL_MOVE))
    const su = smooth(u)
    const w = smooth(t / 0.1)
    apply(ctx.rig, b, F, u, 0, st.cx * 0.5 * su, st.cz * 0.5 * su, w, null, 0, 0, 0)
    status.frames++
    return
  }
  if (name === 'getup') {
    // dusmeden sonra degilse (kayma: getup-sit, kaleci: getup-side-*) dokunma; test secimi varsa dusme varsay
    if (st.prev !== 'getup') {
      const s = sel()
      if (st.prev !== 'fall' && s?.fall && b.clips[s.fall]) {
        st.fall = s.fall
        pickGetup(b, st)
      } else if (st.prev !== 'fall') st.fall = ''
    }
    st.prev = name
    if (!st.fall) return
    const F = b.clips[st.fall]
    const G = b.clips[st.getup]
    if (!F || !G) return
    const TG = CLIP_LEN.getup
    const OUT = Math.min(0.25, TG * 0.2) // sonda parametrik (ayakta) poza donus
    const BL = Math.min(0.25, TG * 0.22) // basta dusme son pozundan gecis
    // kalkis dogal hizinda; zaman artarsa basta yerde biraz daha kalir, yetmezse sikisir
    const avail = Math.max(0.1, TG - 0.03 - OUT * 0.6)
    const dur = Math.min(G.dur, avail)
    const u = Math.min(1, Math.max(0, (t - 0.03 - (avail - dur)) / dur))
    // yaw ve pelvis farki kalkis hareketi boyunca (u 0.15..0.85) cozulur
    const r = 1 - smooth((u - 0.15) / 0.7)
    const ya = st.psi * r
    const w = 1 - smooth((t - (TG - OUT - 0.04)) / OUT) // sim getup bitmeden sifirlanir (sonraki anim parametrik devralir)
    if (w < 0.01) return
    const fw = 1 - smooth(t / BL)
    apply(ctx.rig, b, G, u, ya, -st.cx * 0.5 * r, -st.cz * 0.5 * r, w, F, fw, st.cx * 0.5, st.cz * 0.5)
    status.frames++
    return
  }
  st.prev = name
}
