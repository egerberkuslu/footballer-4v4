// Katman: arapas (rabona). SAHIBI: rabona ajani.
// Hazir mocap kaynagi yok (Google Football / CMU / Quaternius'ta rabona klibi bulunmadi); hareket PROSEDUREL:
// govde/kollar/bacak yolu anim/actions.ts 'rabona' anahtar karelerinden (varsayilan top (0.02, 0.11, 0.38)), bu katman
//  1) temas anindaki topu (karakter uzayi) hizla ongorur, temastan az once dondurur,
//  2) iki ayagin klip yolunu bu topa gore kaydirir (rig.reachFoot): sol destek ayagi topun SAGINA basar, sag ayak destek
//     bacaginin ARKASINDAN dolanip topa soldan-arkadan gelir,
//  3) destek ayagini basma suresince dunyaya sabitler (oyuncu kayarken ayak kaymasin).
// Temas CLIP_LEN.rabonaContact (0.28) = simulasyonun topu firlattigi an. Ayri JSON gerekmez; ?clips=0 ise yalniz parametrik klip.
import * as THREE from 'three'
import { layerState, type Layer } from './types'
import { layerStatus, smooth } from './util'

const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('clips') === '0'
const CONTACT = 0.27 // simulasyon adimi: temas animT ~0.263..0.28 (kick.ts ile ayni gerekce)
const DEF_X = 0.02 // actions.ts 'rabona' varsayilan top
const DEF_Z = 0.38
const PLANT_T0 = 0.12 // destek ayagi basar
const PLANT_T1 = 0.5 // kalkar

class St {
  lastT = 9
  cx = DEF_X
  cz = DEF_Z
  ox = 0 // kaydirma (m, karakter uzayi)
  oz = 0
  valid = false
  pbx = 0
  pbz = 0
  vx = 0
  vz = 0
  pin = false
  px = 0
  pz = 0
}

const status = layerStatus('rabona')
status.loaded = !OFF
const fp = new THREE.Vector3()
const o0 = new THREE.Vector3()
const o1 = new THREE.Vector3()
const tgt = new THREE.Vector3()
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export const rabonaLayer: Layer = (ctx) => {
  if (OFF || ctx.name !== 'rabona') return
  const st = layerState(ctx, 'rabona', () => new St())
  const t = ctx.animT
  const bl = ctx.ball
  const dt = Math.max(1e-3, ctx.gdt)
  if (t < st.lastT - 0.05) {
    // yeni aksiyon
    st.pbx = bl.x
    st.pbz = bl.z
    st.vx = st.vz = 0
    st.pin = false
    st.valid = false
    st.ox = st.oz = 0
  }
  st.lastT = t
  // 1) temas aninda top: temasa kadar hizla ongor, sonra dondur
  if (t < CONTACT - 0.02) {
    const vx = (bl.x - st.pbx) / dt
    const vz = (bl.z - st.pbz) / dt
    st.vx += (vx - st.vx) * 0.5
    st.vz += (vz - st.vz) * 0.5
    st.pbx = bl.x
    st.pbz = bl.z
    const k = CONTACT - t
    st.cx = bl.x + st.vx * k
    st.cz = bl.z + st.vz * k
    st.valid = bl.y < 0.5 && st.cz > -0.05 && st.cz < 1.0 && Math.abs(st.cx) < 0.7
    const tox = st.valid ? clamp(st.cx - DEF_X, -0.35, 0.35) : 0
    const toz = st.valid ? clamp(st.cz - DEF_Z, -0.25, 0.4) : 0
    // ilk karelerde ani sicrama olmasin: hedef kaydirmaya yumusak yaklas
    const a = t < 0.03 ? 1 : 0.35
    st.ox += (tox - st.ox) * a
    st.oz += (toz - st.oz) * a
  }
  const w = smooth(t / 0.08) * (1 - smooth((t - 0.5) / 0.18))
  if (w < 0.001) return
  const rig = ctx.rig
  rig.localToModel(0, 0, 0, o0)
  const u = rig.localToModel(1, 0, 0, o1).x - o0.x
  // 2) sag (vuran) ayak: klip yolu + kaydirma
  rig.bonePos('foot_r', fp)
  rig.localToModel((fp.x - o0.x) / u + st.ox, (fp.y - o0.y) / u, (fp.z - o0.z) / u + st.oz, tgt)
  rig.reachFoot('r', tgt, w)
  // 3) sol (destek) ayak: kaydirilmis klip yeri; basinca dunyaya sabit
  rig.bonePos('foot_l', fp)
  let lx = (fp.x - o0.x) / u + st.ox
  let lz = (fp.z - o0.z) / u + st.oz
  const ly = (fp.y - o0.y) / u
  if (t >= PLANT_T0 && t < PLANT_T1) {
    if (!st.pin) {
      st.pin = true
      st.px = lx
      st.pz = lz
    } else {
      st.px -= ctx.lvx * dt
      st.pz -= ctx.lvz * dt
    }
    const pw = smooth((t - PLANT_T0) / 0.04) * (1 - smooth((t - (PLANT_T1 - 0.06)) / 0.06))
    lx += (st.px - lx) * pw
    lz += (st.pz - lz) * pw
  }
  rig.localToModel(lx, ly, lz, tgt)
  rig.reachFoot('l', tgt, w)
  status.frames++
}
