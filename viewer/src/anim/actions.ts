// Aksiyon klipleri: anahtar kareli parametrik pozlar (yerinde; konum degisimi oyun durumundan gelir).
// Her anahtar = notr durus + ozellestirme. Kareler arasi smoothstep.
import type { AnimState, RefAnim } from '../game/types'
import { applySpec, copyPose, lerpPose, mirrorPose, Pose, type PoseSpec } from './pose'
import type { Dims } from './rig'
import { CLIP_LEN } from './timing'

export interface Clip {
  keys: [number, PoseSpec][]
  loop?: boolean // dongu (kutlama)
  // 'upper': yalniz omurga/bas/kollar; 'body': bacak IK hedefleri lokomosyondan (yururken oynar), pelvis dahil gerisi klipten
  mode?: 'upper' | 'body'
  hands?: number // kaleci: top menzildeyse eller topa kilitlenir (agirlik)
  hold?: boolean // son karede kal (dusme, kaleci uclusu)
  mirror?: boolean
  fadeIn?: number
}

// IK bacak icin hazir parcalar
const PLANT = (d: number, x = 0.16, z = 0): PoseSpec => ({ 'L.ik': 1, 'L.x': x, 'L.z': z, 'L.y': d, 'L.yaw': 0.2 })
const FK_R: PoseSpec = { 'R.ik': 0 }
const FK_B: PoseSpec = { 'B.ik': 0 }

// ankleH degeri yer tutucu: 'Y' anahtari karede ayak yuksekligine eklenir
const A = 0.08

function clips(): Record<string, Clip> {
  return { ...clips2(),
    // --- sag ayak sut: temas CLIP_LEN.kickContact ---
    kick: {
      keys: [
        [0, { hy: -0.03 }],
        [0.17, { ...PLANT(A, 0.2, 0.12), ...FK_R, hy: -0.08, hp: -0.04, hr: -0.14, hyaw: -0.25, syaw: -0.3, sp: 0.05, np: 0.25,
          'R.flex': -0.65, 'R.knee': 1.75, 'R.pitch': -0.7, 'R.abd': 0.05,
          'LA.abd': 1.15, 'LA.flex': 0.35, 'LA.elbow': 0.4, 'RA.flex': 0.3, 'RA.abd': 0.45, 'RA.elbow': 0.6 }],
        [0.28, { ...PLANT(A, 0.2, 0.12), ...FK_R, hy: -0.07, hp: 0.05, hr: -0.1, hyaw: 0.12, syaw: 0.12, sp: 0.12, np: 0.35,
          'R.flex': 0.45, 'R.knee': 0.3, 'R.pitch': -0.95,
          'LA.abd': 1.0, 'LA.flex': 0.1, 'RA.flex': -0.35, 'RA.abd': 0.5, 'RA.elbow': 0.5 }],
        [0.45, { ...PLANT(A + 0.03, 0.18, 0.12), ...FK_R, hy: -0.04, hp: -0.02, hr: -0.06, hyaw: 0.25, syaw: 0.2, sp: 0.04, np: 0.15,
          'R.flex': 1.25, 'R.knee': 0.35, 'R.pitch': -0.5,
          'LA.abd': 0.7, 'LA.flex': -0.35, 'RA.flex': -0.5, 'RA.abd': 0.45 }],
        [0.75, { 'R.ik': 1, 'R.z': 0.32, 'R.x': -0.1, hy: -0.03 }],
      ],
    },
    // --- arapas (rabona; rabona ajani): sol destek ayagi topun SAGINA basar, sag bacak destek bacaginin ARKASINDAN dolanip
    // topa soldan-arkadan vurur. Temas CLIP_LEN.rabonaContact (0.28). Varsayilan top (0.02, 0.11, 0.38); layers/rabona.ts
    // yolu gercek topa kaydirir. Govde destek ayagi uzerine saga kayar/yatar, kollar denge icin acik.
    rabona: {
      fadeIn: 0.06,
      keys: [
        [0, { hy: -0.03 }],
        [0.12, { 'L.ik': 1, 'L.x': -0.2, 'L.z': 0.3, 'L.y': A, 'L.yaw': -0.15, 'R.ik': 1, 'R.x': -0.24, 'R.y': 0.3, 'R.z': -0.22, 'R.pitch': -0.5,
          hx: -0.07, hz: 0.08, hy: -0.07, hyaw: -0.35, syaw: -0.15, hr: 0.08, sp: 0.1, np: 0.3, nyaw: 0.1,
          'LA.abd': 1.1, 'LA.flex': 0.2, 'LA.elbow': 0.5, 'RA.abd': 0.95, 'RA.flex': -0.35, 'RA.elbow': 0.5 }],
        [0.21, { 'L.ik': 1, 'L.x': -0.2, 'L.z': 0.3, 'L.y': A, 'L.yaw': -0.15, 'R.ik': 1, 'R.x': 0.07, 'R.y': 0.27, 'R.z': -0.02, 'R.pitch': -0.75, 'R.yaw': -0.5,
          hx: -0.09, hz: 0.1, hy: -0.09, hyaw: -0.12, syaw: 0.05, hr: 0.16, sp: 0.16, np: 0.4, nyaw: 0.18,
          'LA.abd': 1.25, 'LA.flex': 0.3, 'LA.elbow': 0.45, 'RA.abd': 1.05, 'RA.flex': -0.45, 'RA.elbow': 0.45 }],
        [0.28, { 'L.ik': 1, 'L.x': -0.2, 'L.z': 0.3, 'L.y': A, 'L.yaw': -0.15, 'R.ik': 1, 'R.x': 0.03, 'R.y': 0.11, 'R.z': 0.27, 'R.pitch': -0.8, 'R.yaw': -0.45,
          hx: -0.09, hz: 0.12, hy: -0.09, hyaw: 0.12, syaw: 0.12, hr: 0.18, sp: 0.18, np: 0.45, nyaw: 0.2,
          'LA.abd': 1.2, 'LA.flex': 0.15, 'LA.elbow': 0.4, 'RA.abd': 1.0, 'RA.flex': -0.2, 'RA.elbow': 0.45 }],
        [0.4, { 'L.ik': 1, 'L.x': -0.2, 'L.z': 0.3, 'L.y': A + 0.02, 'L.yaw': -0.15, 'R.ik': 1, 'R.x': -0.05, 'R.y': 0.33, 'R.z': 0.62, 'R.pitch': -0.4,
          hx: -0.07, hz: 0.12, hy: -0.06, hyaw: 0.22, syaw: 0.15, hr: 0.1, sp: 0.08, np: 0.25, nyaw: 0.05,
          'LA.abd': 0.9, 'LA.flex': -0.2, 'RA.abd': 0.7, 'RA.flex': 0.1 }],
        [0.56, { 'L.ik': 1, 'L.x': -0.16, 'L.z': 0.22, 'L.y': A, 'R.ik': 1, 'R.x': -0.14, 'R.y': A + 0.04, 'R.z': 0.4,
          hx: -0.03, hz: 0.08, hy: -0.04, hyaw: 0.08, hr: 0.03, sp: 0.04, np: 0.15, 'LA.abd': 0.45, 'RA.abd': 0.4 }],
        [0.75, { 'R.ik': 1, 'R.z': 0.2, hy: -0.03 }],
      ],
    },
    // --- ayak ici pas: temas CLIP_LEN.passContact ---
    pass: {
      keys: [
        [0, { hy: -0.03 }],
        [0.13, { ...PLANT(A, 0.17, 0.05), ...FK_R, hy: -0.08, hr: -0.08, hyaw: -0.12, sp: 0.1, np: 0.3,
          'R.flex': -0.35, 'R.knee': 0.7, 'R.twist': 0.95, 'R.abd': 0.1, 'R.pitch': 0.15,
          'LA.abd': 0.7, 'RA.abd': 0.4, 'RA.flex': 0.2 }],
        [0.22, { ...PLANT(A, 0.17, 0.05), ...FK_R, hy: -0.08, hr: -0.06, hyaw: 0.05, sp: 0.12, np: 0.35,
          'R.flex': 0.3, 'R.knee': 0.2, 'R.twist': 1.05, 'R.abd': 0.05, 'R.pitch': 0.2,
          'LA.abd': 0.6, 'RA.abd': 0.35, 'RA.flex': -0.2 }],
        [0.34, { ...PLANT(A, 0.17, 0.05), ...FK_R, hy: -0.06, hyaw: 0.12, sp: 0.06, np: 0.2,
          'R.flex': 0.6, 'R.knee': 0.25, 'R.twist': 0.8, 'R.pitch': 0.1, 'LA.abd': 0.45 }],
        [0.55, { 'R.ik': 1, 'R.z': 0.2, hy: -0.03 }],
      ],
    },
    // --- ayakta mudahale: destek ayagi basar, sag bacak topa uzanir (temas CLIP_LEN.tackleContact) ---
    tackle: {
      fadeIn: 0.08,
      keys: [
        [0, { hy: -0.05, hp: 0.1 }],
        [0.1, { ...PLANT(A, 0.16, -0.2), ...FK_R, hy: -0.18, hp: 0.25, sp: 0.1, np: 0.3,
          'R.flex': 0.6, 'R.knee': 0.65, 'R.twist': 0.5, 'R.pitch': 0.1, 'BA.abd': 0.55, 'BA.elbow': 0.6 }],
        [0.22, { ...PLANT(A, 0.17, -0.45), ...FK_R, hy: -0.38, hp: 0.35, sp: 0.2, np: 0.3, hr: -0.08, hyaw: 0.12,
          'R.flex': 1.3, 'R.knee': 0.1, 'R.twist': 0.7, 'R.abd': 0.15, 'R.pitch': 0.3,
          'BA.abd': 0.75, 'BA.elbow': 0.55, 'LA.flex': 0.6, 'RA.flex': -0.4 }],
        [0.45, { ...PLANT(A, 0.17, -0.45), ...FK_R, hy: -0.36, hp: 0.32, sp: 0.18, np: 0.25, hr: -0.06, hyaw: 0.1,
          'R.flex': 1.2, 'R.knee': 0.2, 'R.twist': 0.65, 'R.abd': 0.12, 'R.pitch': 0.2,
          'BA.abd': 0.7, 'BA.elbow': 0.55, 'LA.flex': 0.5, 'RA.flex': -0.3 }],
        [0.75, { hy: -0.05, hp: 0.08 }],
      ],
    },
    // --- kayarak mudahale: kosudan dusus, sol bacak bukulu altta, sag bacak uzanmis, sol el yerde; yerde kalir ---
    slide: {
      hold: true,
      fadeIn: 0.1,
      keys: [
        [0, { hy: -0.08, hp: 0.12 }],
        [0.09, { hy: -0.4, hp: -0.2, sp: 0.0, np: 0.2, 'L.ik': 0.5, 'L.knee': 1.0, 'R.ik': 0, 'R.flex': 0.6, 'R.knee': 0.4,
          'LA.abd': 0.6, 'LA.flex': -0.5, 'RA.abd': 0.8 }],
        [0.15, { ...FK_B, hy: -0.7, hz: 0.03, hp: -0.45, sp: -0.15, np: 0.5, hr: 0.14,
          'L.flex': 0.5, 'L.knee': 1.55, 'L.abd': 0.35, 'L.twist': 0.4,
          'R.flex': 0.85, 'R.knee': 0.2, 'R.pitch': 0.2,
          'LA.flex': -0.9, 'LA.abd': 0.7, 'LA.elbow': 0.15, 'RA.abd': 1.1, 'RA.flex': 0.1, 'RA.elbow': 0.2 }],
        [0.22, { ...FK_B, hy: -0.86, hz: 0.05, hp: -0.7, sp: -0.35, np: 0.75, hr: 0.2,
          'L.flex': 0.55, 'L.knee': 1.7, 'L.abd': 0.35, 'L.twist': 0.4,
          'R.flex': 0.98, 'R.knee': 0.06, 'R.pitch': 0.25,
          'LA.flex': -1.15, 'LA.abd': 0.6, 'LA.elbow': 0.1, 'RA.abd': 1.2, 'RA.flex': 0.1, 'RA.elbow': 0.25 }],
        [0.8, { ...FK_B, hy: -0.86, hz: 0.05, hp: -0.65, sp: -0.3, np: 0.7, hr: 0.18,
          'L.flex': 0.55, 'L.knee': 1.7, 'L.abd': 0.35, 'L.twist': 0.4,
          'R.flex': 0.95, 'R.knee': 0.15, 'R.pitch': 0.15,
          'LA.flex': -1.1, 'LA.abd': 0.6, 'LA.elbow': 0.15, 'RA.abd': 1.0, 'RA.flex': 0.15, 'RA.elbow': 0.4 }],
      ],
    },
    // --- one dusme, yuzustu kalir (getup gelene kadar) ---
    fall: {
      hold: true,
      fadeIn: 0.08,
      keys: [
        [0, { hp: 0.15 }],
        [0.25, { ...FK_B, hp: 0.6, hy: -0.22, hz: 0.18, sp: 0.15, np: -0.2,
          'L.flex': -0.35, 'L.knee': 0.9, 'R.flex': 0.2, 'R.knee': 0.4,
          'BA.flex': 1.3, 'BA.abd': 0.55, 'BA.elbow': 0.5 }],
        [0.6, { ...FK_B, hp: 1.42, hy: -0.8, hz: 0.55, sp: 0.1, np: -0.6,
          'L.flex': 0.05, 'L.knee': 0.35, 'R.flex': 0.0, 'R.knee': 0.2, 'B.pitch': -0.6,
          'BA.flex': 2.1, 'BA.abd': 0.6, 'BA.elbow': 1.3 }],
        [1.0, { ...FK_B, hp: 1.53, hy: -0.86, hz: 0.6, sp: 0.0, np: -0.7, nyaw: 0.6,
          'L.flex': 0.0, 'L.knee': 0.25, 'L.abd': 0.12, 'R.flex': 0.0, 'R.knee': 0.15, 'R.abd': 0.1, 'B.pitch': -0.8,
          'BA.flex': 2.45, 'BA.abd': 0.75, 'BA.elbow': 1.5, 'RA.flex': 2.2 }],
      ],
    },
    // --- yuzustu -> ayaga kalkma ---
    getup: {
      fadeIn: 0.05,
      keys: [
        [0, { ...FK_B, hp: 1.53, hy: -0.86, hz: 0.6, np: -0.7, nyaw: 0.6,
          'L.knee': 0.25, 'L.abd': 0.12, 'R.knee': 0.15, 'R.abd': 0.1, 'B.pitch': -0.8,
          'BA.flex': 2.45, 'BA.abd': 0.75, 'BA.elbow': 1.5, 'RA.flex': 2.2 }],
        [0.35, { ...FK_B, hp: 1.15, hy: -0.62, hz: 0.48, np: -0.6, sp: 0.15,
          'B.flex': 0.95, 'B.knee': 1.75, 'B.abd': 0.12, 'B.pitch': -0.6,
          'BA.flex': 1.3, 'BA.abd': 0.25, 'BA.elbow': 0.15 }],
        [0.7, { hp: 0.55, hy: -0.4, hz: 0.18, sp: 0.25, np: -0.3,
          'L.z': 0.3, 'R.z': -0.2, 'R.y': A + 0.04, 'R.pitch': -0.5,
          'BA.flex': 0.5, 'BA.abd': 0.3, 'BA.elbow': 0.3 }],
        [1.1, { hy: -0.02 }],
      ],
    },
    // --- gol sevinci: kollar havada, yerinde ziplama ---
    celebrate: {
      loop: true,
      keys: [
        [0, { hy: -0.06, hp: -0.12, sp: -0.15, np: -0.35, 'BA.flex': 2.7, 'BA.abd': 0.55, 'BA.elbow': 0.35, 'LA.flex': 2.4, 'B.y': A }],
        [0.2, { hy: 0.14, hp: -0.15, sp: -0.2, np: -0.45, 'BA.flex': 2.9, 'BA.abd': 0.45, 'BA.elbow': 0.15, 'RA.flex': 2.5, 'B.y': A + 0.18, 'B.pitch': -0.6 }],
        [0.4, { hy: -0.06, hp: -0.12, sp: -0.15, np: -0.35, 'BA.flex': 2.7, 'BA.abd': 0.55, 'BA.elbow': 0.35, 'LA.flex': 2.4, 'B.y': A }],
      ],
    },
    throwin: {
      mode: 'upper',
      keys: [
        [0, {}],
        [0.35, { sp: -0.35, np: -0.3, 'BA.flex': 2.9, 'BA.abd': 0.15, 'BA.elbow': 1.7 }],
        [0.6, { sp: 0.3, np: 0.1, 'BA.flex': 2.0, 'BA.abd': 0.2, 'BA.elbow': 0.15 }],
        [1.0, {}],
      ],
    },
    // --- kaleci: sola (karakterin solu, +x) uclus; yan yatar kalir ---
    'keeper-dive-l': {
      hold: true,
      hands: 1,
      fadeIn: 0.06,
      keys: [
        [0, { hy: -0.16, hp: 0.15, 'BA.flex': 0.7, 'BA.abd': 0.4, 'BA.elbow': 0.7, 'B.x': 0.2 }],
        [0.06, LOAD],
        [0.14, { hx: 0.12, hy: -0.12, hr: -0.45, sr: -0.2, hp: 0.05,
          ...PLANT(A, 0.32, 0), 'R.ik': 0, 'R.abd': 0.25, 'R.knee': 0.1, 'R.pitch': -0.5,
          'L.ik': 0.6, 'L.knee': 0.8, 'LA.abd': 1.9, 'LA.elbow': 0.15, 'RA.abd': 2.3, 'RA.elbow': 0.3, 'RA.flex': 0.3 }],
        [0.4, { ...FK_B, hx: 0.25, hy: -0.15, hr: -1.4, sr: -0.15, hp: 0.05, nyaw: 0.2,
          'L.flex': 0.35, 'L.knee': 0.9, 'L.abd': 0.2, 'R.abd': 0.15, 'R.knee': 0.55, 'R.pitch': -0.4,
          'LA.abd': 2.9, 'LA.elbow': 0.05, 'LA.flex': 0.15, 'RA.abd': 3.3, 'RA.elbow': 0.15, 'RA.flex': 0.25 }],
        [0.75, { ...FK_B, hx: 0.25, hy: -0.84, hr: -1.5, sr: -0.1, hp: 0.05, nyaw: 0.2,
          'L.flex': 0.4, 'L.knee': 1.0, 'L.abd': 0.15, 'R.abd': 0.1, 'R.knee': 0.3, 'R.pitch': -0.3,
          'LA.abd': 2.85, 'LA.elbow': 0.15, 'LA.flex': 0.2, 'RA.abd': 3.25, 'RA.elbow': 0.4, 'RA.flex': 0.35 }],
        [1.2, { ...FK_B, hx: 0.25, hy: -0.86, hr: -1.52, hp: 0.1, nyaw: 0.1, np: 0.1,
          'L.flex': 0.5, 'L.knee': 1.2, 'L.abd': 0.1, 'R.flex': 0.2, 'R.knee': 0.5, 'R.pitch': -0.3,
          'LA.abd': 3.1, 'LA.elbow': 0.3, 'LA.flex': 0.0, 'RA.abd': 0.0, 'RA.elbow': 0.9, 'RA.flex': 1.3 }],
      ],
    },
    'keeper-catch': {
      hands: 1,
      keys: [
        [0, { hy: -0.12, hp: 0.15, 'B.x': 0.2, 'BA.flex': 0.8, 'BA.abd': 0.35, 'BA.elbow': 0.6 }],
        [0.15, { hy: -0.14, hp: 0.2, sp: 0.1, 'B.x': 0.2, 'BA.flex': 1.35, 'BA.abd': 0.12, 'BA.elbow': 0.7, 'BA.twist': 0.3 }],
        [0.35, { hy: -0.12, hp: 0.25, sp: 0.25, np: 0.3, 'B.x': 0.2, 'BA.flex': 0.9, 'BA.abd': 0.2, 'BA.elbow': 1.9, 'BA.twist': 0.4 }],
        [0.6, { hy: -0.05, sp: 0.1, 'BA.flex': 0.7, 'BA.abd': 0.25, 'BA.elbow': 1.8, 'BA.twist': 0.4 }],
      ],
    },
    // --- kafa vurusu: ziplama + bas one ---
    header: {
      keys: [
        [0, { hy: -0.03 }],
        [0.14, { hy: -0.16, hp: 0.2, sp: 0.1, 'BA.flex': -0.5, 'BA.abd': 0.3 }],
        [0.3, { hy: 0.32, hp: -0.15, sp: -0.3, np: -0.35, 'B.y': A + 0.3, 'B.pitch': -0.7, 'L.z': -0.1, 'R.z': 0.05,
          'BA.flex': 0.6, 'BA.abd': 0.85, 'BA.elbow': 0.9 }],
        [0.4, { hy: 0.3, hp: 0.15, sp: 0.35, np: 0.4, 'B.y': A + 0.28, 'B.pitch': -0.6, 'L.z': -0.1,
          'BA.flex': 0.2, 'BA.abd': 0.7, 'BA.elbow': 0.9 }],
        [0.6, { hy: -0.08, hp: 0.05 }],
      ],
    },
    // --- hakem ---
    whistle: {
      mode: 'upper',
      keys: [
        [0, {}],
        [0.25, { np: -0.05, 'RA.flex': 0.95, 'RA.abd': 0.1, 'RA.elbow': 2.45, 'RA.twist': -0.75 }],
        [0.8, { np: -0.05, 'RA.flex': 0.95, 'RA.abd': 0.1, 'RA.elbow': 2.45, 'RA.twist': -0.75 }],
        [1.1, {}],
      ],
    },
    point: {
      mode: 'upper',
      keys: [
        [0, {}],
        [0.3, { syaw: 0.2, 'RA.flex': 1.15, 'RA.abd': 0.85, 'RA.elbow': 0.05 }],
        [1.2, { syaw: 0.2, 'RA.flex': 1.15, 'RA.abd': 0.85, 'RA.elbow': 0.05 }],
        [1.5, {}],
      ],
    },
    card: {
      mode: 'upper',
      keys: [
        [0, {}],
        [0.35, { sp: -0.05, np: -0.15, 'RA.flex': 2.7, 'RA.abd': 0.3, 'RA.elbow': 0.08, 'LA.abd': 0.25 }],
        [1.4, { sp: -0.05, np: -0.15, 'RA.flex': 2.7, 'RA.abd': 0.3, 'RA.elbow': 0.08, 'LA.abd': 0.25 }],
        [1.8, {}],
      ],
    },
    advantage: {
      mode: 'upper',
      keys: [
        [0, {}],
        [0.3, { 'BA.flex': 1.2, 'BA.abd': 0.55, 'BA.elbow': 0.1 }],
        [1.0, { 'BA.flex': 1.15, 'BA.abd': 0.6, 'BA.elbow': 0.1 }],
        [1.4, {}],
      ],
    },
  }
}


// kaleci yan yatis (sol ucus sonu) ve hazir durus
const LIE_L: PoseSpec = { ...FK_B, hx: 0.25, hy: -0.86, hr: -1.52, hp: 0.1, nyaw: 0.1, np: 0.1,
  'L.flex': 0.5, 'L.knee': 1.2, 'L.abd': 0.1, 'R.flex': 0.2, 'R.knee': 0.5, 'R.pitch': -0.3,
  // alttaki kol basin onunde yerde, ustteki kol govdede dinlenir (havada kalmaz)
  'LA.abd': 3.1, 'LA.elbow': 0.3, 'LA.flex': 0.0, 'RA.abd': 0.0, 'RA.elbow': 0.9, 'RA.flex': 1.3 }
const READY: PoseSpec = { hy: -0.17, hp: 0.25, sp: 0.08, np: -0.12, 'B.x': 0.21,
  'BA.flex': 0.55, 'BA.abd': 0.42, 'BA.elbow': 0.85, 'BA.twist': 0.3 }
// dalis oncesi yuklenme: cokus, agirlik yone, kollar onde-asagida (uclusa hazirlik, kollar hemen havaya acilmaz)
const LOAD: PoseSpec = { hy: -0.34, hp: 0.32, sp: 0.1, np: -0.1, hr: -0.14, hx: 0.04, 'B.x': 0.3,
  'BA.flex': 0.95, 'BA.abd': 0.55, 'BA.elbow': 0.5 }
const HOLD: PoseSpec = { sp: 0.05, 'BA.flex': 0.75, 'BA.abd': 0.12, 'BA.elbow': 2.1, 'BA.twist': 0.35 }

function clips2(): Record<string, Clip> {
  return {
    // --- kaleci: kalkis (yan yatistan) ---
    'getup-side-l': {
      fadeIn: 0.12,
      keys: [
        [0, LIE_L],
        [0.35, { ...FK_B, hx: 0.15, hy: -0.55, hr: -0.6, hp: 0.9, np: -0.4, sp: 0.1,
          'B.flex': 1.0, 'B.knee': 1.7, 'B.abd': 0.1, 'B.pitch': -0.6,
          'LA.flex': 1.2, 'LA.abd': 0.4, 'LA.elbow': 0.2, 'RA.flex': 0.9, 'RA.abd': 0.3, 'RA.elbow': 0.4 }],
        [0.75, { hx: 0.05, hy: -0.3, hr: -0.15, hp: 0.4, sp: 0.15, np: -0.2, 'L.z': 0.2, 'R.z': -0.15, 'R.y': A + 0.03,
          'BA.flex': 0.5, 'BA.abd': 0.35, 'BA.elbow': 0.4 }],
        [1.1, { hy: -0.05 }],
      ],
    },
    // --- kaleci: yerden uzanma (alcak kose) ---
    'keeper-dive-low-l': {
      hold: true,
      hands: 1,
      fadeIn: 0.06,
      keys: [
        [0, READY],
        [0.05, LOAD],
        [0.12, { ...PLANT(A, 0.38, 0), 'R.ik': 0, 'R.abd': 0.2, 'R.knee': 0.3, 'R.pitch': -0.4,
          hx: 0.15, hy: -0.35, hr: -0.6, hp: 0.15,
          'LA.abd': 1.7, 'LA.elbow': 0.1, 'LA.flex': 0.3, 'RA.abd': 2.0, 'RA.flex': 0.6, 'RA.elbow': 0.3 }],
        [0.4, { ...FK_B, hx: 0.3, hy: -0.55, hr: -1.45, hp: 0.15, nyaw: 0.15,
          'L.flex': 0.4, 'L.knee': 0.7, 'L.abd': 0.15, 'R.abd': 0.1, 'R.knee': 0.2, 'R.pitch': -0.4,
          'LA.abd': 2.75, 'LA.flex': 0.35, 'LA.elbow': 0.05, 'RA.abd': 3.2, 'RA.flex': 0.5, 'RA.elbow': 0.15 }],
        [0.65, { ...FK_B, hx: 0.3, hy: -0.86, hr: -1.52, hp: 0.12, nyaw: 0.1,
          'L.flex': 0.45, 'L.knee': 0.9, 'L.abd': 0.12, 'R.abd': 0.1, 'R.knee': 0.3, 'R.pitch': -0.3,
          'LA.abd': 2.6, 'LA.flex': 0.5, 'LA.elbow': 0.4, 'RA.abd': 2.9, 'RA.flex': 0.7, 'RA.elbow': 0.6 }],
        [1.0, LIE_L],
      ],
    },
    // --- kaleci: ust koseye ucus ---
    'keeper-dive-high-l': {
      hold: true,
      hands: 1,
      fadeIn: 0.06,
      keys: [
        [0, READY],
        [0.06, LOAD],
        [0.15, { ...PLANT(A, 0.32, 0), 'R.ik': 0, 'R.abd': 0.15, 'R.knee': 0.15, 'R.pitch': -0.6,
          hx: 0.1, hy: -0.05, hr: -0.35, hp: 0.0, sp: -0.1,
          'LA.abd': 2.1, 'LA.elbow': 0.1, 'RA.abd': 2.4, 'RA.flex': 0.3, 'RA.elbow': 0.2 }],
        [0.4, { ...FK_B, hx: 0.3, hy: 0.25, hr: -1.15, sr: -0.15, hp: 0.0, nyaw: 0.25, np: -0.2,
          'L.flex': 0.3, 'L.knee': 0.9, 'L.abd': 0.1, 'R.abd': 0.2, 'R.knee': 0.2, 'R.pitch': -0.6,
          'LA.abd': 2.95, 'LA.flex': 0.1, 'LA.elbow': 0.05, 'RA.abd': 3.35, 'RA.flex': 0.15, 'RA.elbow': 0.1 }],
        [0.62, { ...FK_B, hx: 0.3, hy: -0.2, hr: -1.4, hp: 0.05, nyaw: 0.2,
          'L.flex': 0.35, 'L.knee': 0.9, 'R.abd': 0.15, 'R.knee': 0.3, 'R.pitch': -0.4,
          'LA.abd': 2.8, 'LA.flex': 0.4, 'LA.elbow': 0.3, 'RA.abd': 3.1, 'RA.flex': 0.5, 'RA.elbow': 0.5 }],
        [0.85, { ...LIE_L, hx: 0.3 }],
        [1.2, LIE_L],
      ],
    },
    // --- kaleci: havadan toplama ---
    'keeper-catch-high': {
      hands: 1,
      keys: [
        [0, { hy: -0.1, 'BA.flex': 1.2, 'BA.abd': 0.3, 'BA.elbow': 0.6 }],
        [0.15, { hy: 0.25, 'B.y': A + 0.22, 'B.pitch': -0.6, sp: -0.15, np: -0.35, 'L.z': 0.05,
          'BA.flex': 2.8, 'BA.abd': 0.3, 'BA.elbow': 0.4 }],
        [0.3, { hy: 0.2, 'B.y': A + 0.18, 'B.pitch': -0.5, sp: -0.05, np: -0.2, 'BA.flex': 2.4, 'BA.abd': 0.25, 'BA.elbow': 0.7 }],
        [0.5, { hy: -0.12, sp: 0.2, np: 0.3, 'BA.flex': 0.9, 'BA.abd': 0.15, 'BA.elbow': 2.0, 'BA.twist': 0.4 }],
        [0.75, { hy: -0.05, ...HOLD }],
      ],
    },
    // --- kaleci: yerden kucaklama (diz cokerek) ---
    'keeper-collect': {
      hands: 1,
      keys: [
        [0, { hy: -0.1, hp: 0.2 }],
        [0.22, { hy: -0.42, hp: 0.55, sp: 0.2, np: 0.3, 'L.ik': 0, 'L.flex': 0.15, 'L.knee': 1.65, 'L.pitch': -0.8,
          'R.z': 0.25, 'BA.flex': 0.5, 'BA.abd': 0.15, 'BA.elbow': 0.25, 'BA.twist': 0.3 }],
        [0.45, { hy: -0.4, hp: 0.45, sp: 0.2, np: 0.3, 'L.ik': 0, 'L.flex': 0.15, 'L.knee': 1.65, 'L.pitch': -0.8,
          'R.z': 0.25, 'BA.flex': 0.9, 'BA.abd': 0.12, 'BA.elbow': 1.9, 'BA.twist': 0.4 }],
        [0.9, { hy: -0.05, ...HOLD }],
      ],
    },
    'keeper-punch': {
      keys: [
        [0, { hy: -0.05 }],
        // yumruklar cene hizasinda toplanir, sonra iki yumruk birlikte one-yukari sert vurur (temas ~0.18), 0.2 s'de geri cekilir
        [0.08, { hy: -0.22, hp: 0.2, sp: 0.1, np: 0.1, 'BA.flex': 1.4, 'BA.abd': 0.15, 'BA.elbow': 2.0 }],
        [0.16, { hy: 0.12, 'B.y': A + 0.1, sp: -0.12, hp: -0.05, np: -0.1, 'BA.flex': 1.95, 'BA.abd': 0.12, 'BA.elbow': 0.15 }],
        [0.24, { hy: 0.14, 'B.y': A + 0.12, sp: -0.15, hp: -0.05, np: -0.1, 'BA.flex': 2.0, 'BA.abd': 0.12, 'BA.elbow': 0.12 }],
        [0.36, { hy: -0.1, sp: 0.05, 'BA.flex': 1.2, 'BA.abd': 0.15, 'BA.elbow': 1.7 }],
        [0.5, { hy: -0.04 }],
      ],
    },
    'keeper-hold': {
      loop: true,
      mode: 'body',
      hands: 1,
      keys: [
        [0, HOLD],
        [0.8, { ...HOLD, sp: 0.08 }],
        [1.6, HOLD],
      ],
    },
    // --- elle oyuna sokma (omuz ustu), birakma KEEPER_THROW_CONTACT 0.35 ---
    'keeper-throw': {
      keys: [
        [0, HOLD],
        [0.2, { 'L.z': 0.35, 'R.z': -0.25, hyaw: -0.4, syaw: -0.4, hp: -0.05, sp: -0.1,
          'RA.flex': -0.7, 'RA.abd': 0.6, 'RA.elbow': 0.4, 'RA.twist': 0.3, 'LA.flex': 1.2, 'LA.abd': 0.3, 'LA.elbow': 0.3 }],
        [0.35, { 'L.z': 0.35, 'R.z': -0.25, hyaw: 0.2, syaw: 0.3, hp: 0.15, sp: 0.15,
          'RA.flex': 2.3, 'RA.abd': 0.25, 'RA.elbow': 0.1, 'LA.flex': -0.2, 'LA.abd': 0.4 }],
        [0.55, { 'L.z': 0.35, 'R.z': -0.2, 'R.y': A + 0.06, hyaw: 0.3, syaw: 0.3, hp: 0.25, sp: 0.25,
          'RA.flex': 1.1, 'RA.abd': 0.2, 'LA.flex': -0.3, 'LA.abd': 0.4 }],
        [0.9, {}],
      ],
    },
    // --- elden vole, temas KEEPER_KICK_CONTACT 0.45 ---
    'keeper-kick': {
      keys: [
        [0, HOLD],
        [0.2, { hy: -0.03, 'BA.flex': 1.1, 'BA.abd': 0.15, 'BA.elbow': 0.3 }],
        [0.33, { ...PLANT(A, 0.15, 0.1), ...FK_R, hp: -0.08, 'R.flex': -0.5, 'R.knee': 1.4, 'R.pitch': -0.6,
          'BA.abd': 0.9, 'BA.flex': 0.3, 'BA.elbow': 0.3 }],
        [0.45, { ...PLANT(A, 0.15, 0.1), ...FK_R, hp: -0.12, sp: -0.1, 'R.flex': 0.9, 'R.knee': 0.15, 'R.pitch': -0.95,
          'BA.abd': 1.0, 'BA.flex': 0.1 }],
        [0.62, { ...PLANT(A + 0.04, 0.15, 0.1), ...FK_R, hp: -0.05, 'R.flex': 1.5, 'R.knee': 0.2, 'R.pitch': -0.5,
          'BA.abd': 0.8, 'LA.flex': -0.3 }],
        [1.0, { 'R.z': 0.3 }],
      ],
    },
    // --- bire bir: govdeyi acarak kapanma ---
    'keeper-spread': {
      hold: true,
      keys: [
        [0, READY],
        [0.25, { hy: -0.28, hp: 0.2, sp: 0.05, np: -0.1, 'B.x': 0.45, 'B.yaw': 0.3,
          'BA.abd': 1.3, 'BA.flex': 0.35, 'BA.elbow': 0.1 }],
      ],
    },
    'keeper-ready': {
      loop: true,
      mode: 'body',
      keys: [
        [0, READY],
        [0.35, { ...READY, hy: -0.15, 'BA.elbow': 0.8 }],
        [0.7, READY],
      ],
    },
    'keeper-shuffle-l': {
      loop: true,
      mode: 'body',
      keys: [
        [0, READY],
        [0.35, { ...READY, hy: -0.19 }],
        [0.7, READY],
      ],
    },
    // --- top kontrolu (temas animasyon basinda) ---
    'trap-foot': {
      fadeIn: 0.06,
      keys: [
        // temas animasyon basinda: ayak ici havada topa karsi, sonra geri cekilerek topu yumusatir (diz bukulur, govde one)
        [0, { ...PLANT(A, 0.13, -0.05), ...FK_R, hy: -0.05, hp: 0.12, sp: 0.1, np: 0.4, 'R.flex': 0.45, 'R.knee': 0.6, 'R.twist': 0.9,
          'R.abd': 0.12, 'R.pitch': 0.1, 'LA.abd': 0.55, 'LA.elbow': 0.4, 'RA.abd': 0.45, 'RA.elbow': 0.4 }],
        [0.14, { ...PLANT(A, 0.13, -0.05), ...FK_R, hy: -0.06, hp: 0.15, sp: 0.12, np: 0.4, 'R.flex': 0.12, 'R.knee': 0.6, 'R.twist': 0.8,
          'R.abd': 0.08, 'R.pitch': 0.15, 'LA.abd': 0.45, 'LA.elbow': 0.35, 'RA.abd': 0.35, 'RA.elbow': 0.35 }],
        [0.4, {}],
      ],
    },
    'trap-thigh': {
      fadeIn: 0.06,
      keys: [
        [0, { ...PLANT(A, 0.13, 0), ...FK_R, hy: -0.05, sp: 0.1, np: 0.45, 'R.flex': 1.0, 'R.knee': 1.3, 'R.pitch': -0.3,
          'BA.abd': 0.6, 'BA.elbow': 0.5 }],
        [0.2, { ...PLANT(A, 0.13, 0), ...FK_R, hy: -0.06, sp: 0.12, np: 0.45, 'R.flex': 0.55, 'R.knee': 0.9, 'R.pitch': -0.3,
          'BA.abd': 0.55, 'BA.elbow': 0.5 }],
        [0.6, {}],
      ],
    },
    'trap-chest': {
      mode: 'body',
      fadeIn: 0.06,
      keys: [
        [0, { hy: -0.05, hp: -0.15, sp: -0.3, np: 0.45, 'BA.abd': 0.85, 'BA.flex': 0.3, 'BA.elbow': 0.5 }],
        [0.18, { hy: -0.06, hp: 0.05, sp: 0.1, np: 0.5, 'BA.abd': 0.7, 'BA.flex': 0.25, 'BA.elbow': 0.5 }],
        [0.7, {}],
      ],
    },
    // --- ikili mucadele ---
    shield: {
      loop: true,
      mode: 'body',
      keys: [
        [0, { hy: -0.12, hp: 0.15, sp: 0.15, syaw: 0.25, np: 0.35, 'B.x': 0.26, sr: 0.05,
          'LA.abd': 0.85, 'LA.flex': -0.35, 'LA.elbow': 0.6, 'RA.abd': 0.35, 'RA.elbow': 0.5 }],
        [0.5, { hy: -0.13, hp: 0.17, sp: 0.15, syaw: 0.2, np: 0.35, 'B.x': 0.26, sr: -0.05,
          'LA.abd': 0.9, 'LA.flex': -0.3, 'LA.elbow': 0.6, 'RA.abd': 0.35, 'RA.elbow': 0.5 }],
        [1.0, { hy: -0.12, hp: 0.15, sp: 0.15, syaw: 0.25, np: 0.35, 'B.x': 0.26, sr: 0.05,
          'LA.abd': 0.85, 'LA.flex': -0.35, 'LA.elbow': 0.6, 'RA.abd': 0.35, 'RA.elbow': 0.5 }],
      ],
    },
    // omuz itisi: rakip solda (+x); sag tarafi ayna
    'shoulder-l': {
      mode: 'body',
      keys: [
        [0, {}],
        // agirlik rakibe dogru aktarilir: pelvis yana kayar, govde ve omuz yaslanir, uzak kol denge icin acilir
        [0.12, { hx: 0.07, hy: -0.06, hr: -0.36, sr: -0.22, hp: 0.16, sp: 0.12, syaw: 0.12, nyaw: -0.15, np: 0.1, 'B.x': 0.2,
          'LA.flex': 0.3, 'LA.abd': 0.05, 'LA.elbow': 1.45, 'LA.shrug': 0.3, 'LA.twist': 0.4,
          'RA.abd': 0.95, 'RA.flex': 0.25, 'RA.elbow': 0.6 }],
        [0.28, { hx: 0.05, hy: -0.05, hr: -0.3, sr: -0.18, hp: 0.14, sp: 0.1, syaw: 0.1, nyaw: -0.12, np: 0.1, 'B.x': 0.19,
          'LA.flex': 0.25, 'LA.abd': 0.08, 'LA.elbow': 1.4, 'LA.shrug': 0.25, 'LA.twist': 0.4,
          'RA.abd': 0.85, 'RA.flex': 0.2, 'RA.elbow': 0.6 }],
        [0.5, {}],
      ],
    },
    stumble: {
      mode: 'body',
      keys: [
        [0, {}],
        [0.15, { hp: 0.45, sp: 0.3, np: -0.35, hr: 0.15, 'LA.abd': 1.1, 'LA.flex': 0.9, 'LA.elbow': 0.4, 'RA.abd': 0.9, 'RA.flex': -0.3 }],
        [0.45, { hp: 0.3, sp: 0.2, np: -0.2, 'LA.abd': 0.8, 'RA.abd': 1.0, 'RA.flex': 0.6 }],
        [0.8, {}],
      ],
    },
    // --- kayistan sonra oturur durustan kalkis ---
    'getup-sit': {
      fadeIn: 0.1,
      keys: [
        [0, { ...FK_B, hy: -0.84, hz: 0.05, hp: -0.55, sp: 0.2, np: 0.25, hr: 0.15,
          'L.flex': 0.55, 'L.knee': 1.7, 'L.abd': 0.35, 'L.twist': 0.4, 'R.flex': 0.95, 'R.knee': 0.15,
          'LA.flex': -0.55, 'LA.abd': 0.75, 'LA.elbow': 0.2, 'RA.abd': 0.8, 'RA.flex': 0.3, 'RA.elbow': 0.7 }],
        [0.35, { hy: -0.6, hp: 0.3, hr: 0.25, sp: 0.15, np: 0.1, 'L.ik': 0, 'L.flex': 0.9, 'L.knee': 1.8, 'L.pitch': -0.7,
          'R.z': 0.25, 'LA.flex': 0.6, 'LA.abd': 0.5, 'LA.elbow': 0.1, 'RA.abd': 0.5 }],
        [0.7, { hy: -0.3, hp: 0.35, sp: 0.15, 'L.z': -0.15, 'R.z': 0.2, 'BA.abd': 0.4, 'BA.elbow': 0.4 }],
        [1.0, { hy: -0.03 }],
      ],
    },
    // --- ani donus ve top kontrolu ---
    'drag-back': {
      fadeIn: 0.06,
      keys: [
        [0, { hy: -0.04 }],
        [0.1, { ...PLANT(A, 0.13, -0.05), ...FK_R, hy: -0.07, sp: 0.15, np: 0.45,
          'R.flex': 0.5, 'R.knee': 0.55, 'R.pitch': 0.4, 'R.abd': 0.05, 'BA.abd': 0.45 }],
        [0.28, { ...PLANT(A, 0.13, -0.05), ...FK_R, hy: -0.08, hp: -0.05, sp: 0.12, np: 0.4,
          'R.flex': -0.15, 'R.knee': 0.75, 'R.pitch': 0.25, 'BA.abd': 0.5 }],
        [0.55, {}],
      ],
    },
    // sola kesme: sol destek, sag ayak iciyle topu govdenin onunden sola tasir
    'cut-l': {
      fadeIn: 0.06,
      keys: [
        [0, { hy: -0.04 }],
        [0.1, { ...PLANT(A, 0.2, 0), ...FK_R, hy: -0.1, hr: -0.15, hyaw: 0.15, syaw: 0.1, sp: 0.12, np: 0.35,
          'R.flex': 0.35, 'R.knee': 0.4, 'R.twist': 0.9, 'R.abd': -0.05, 'R.pitch': 0.1, 'RA.abd': 0.7, 'LA.abd': 0.45 }],
        [0.22, { ...PLANT(A, 0.2, 0), ...FK_R, hy: -0.12, hr: -0.3, hyaw: 0.35, syaw: 0.25, sp: 0.12, np: 0.35,
          'R.flex': 0.25, 'R.knee': 0.35, 'R.twist': 0.85, 'R.abd': -0.35, 'R.pitch': 0.1, 'RA.abd': 0.85, 'LA.abd': 0.5 }],
        [0.45, {}],
      ],
    },
    'sole-stop': {
      fadeIn: 0.06,
      keys: [
        [0, { ...PLANT(A, 0.13, -0.05), ...FK_R, hy: -0.06, sp: 0.1, np: 0.45, 'R.flex': 0.4, 'R.knee': 0.5, 'R.pitch': 0.45, 'BA.abd': 0.4 }],
        [0.25, { ...PLANT(A, 0.13, -0.05), ...FK_R, hy: -0.06, sp: 0.1, np: 0.45, 'R.flex': 0.38, 'R.knee': 0.5, 'R.pitch': 0.45, 'BA.abd': 0.4 }],
        [0.4, {}],
      ],
    },
    // --- jokey: alcak agirlik merkezi, rakibe donuk, yan kayma adimlari (bacaklar gait'ten, caprazlanmaz) ---
    jockey: {
      loop: true,
      mode: 'body',
      keys: [
        [0, { hy: -0.22, hp: 0.25, sp: 0.12, np: -0.15, 'B.x': 0.24, 'BA.abd': 0.55, 'BA.elbow': 0.7, 'BA.flex': 0.25 }],
        [0.4, { hy: -0.24, hp: 0.26, sp: 0.12, np: -0.15, 'B.x': 0.24, 'BA.abd': 0.58, 'BA.elbow': 0.7, 'BA.flex': 0.25 }],
        [0.8, { hy: -0.22, hp: 0.25, sp: 0.12, np: -0.15, 'B.x': 0.24, 'BA.abd': 0.55, 'BA.elbow': 0.7, 'BA.flex': 0.25 }],
      ],
    },
    // kirmizi kart: bas one egik yuruyerek cikis
    'sent-off': {
      loop: true,
      mode: 'body',
      keys: [
        [0, { np: 0.45, sp: 0.12, 'BA.abd': 0.1, 'BA.elbow': 0.15 }],
        [2, { np: 0.45, sp: 0.12, 'BA.abd': 0.1, 'BA.elbow': 0.15 }],
      ],
    },
    // endirekt serbest vurus: sag kol dik yukarida, avuc acik
    indirect: {
      mode: 'upper',
      loop: true,
      keys: [
        [0, { np: -0.1, 'RA.flex': 3.0, 'RA.abd': 0.12, 'RA.elbow': 0.03, 'LA.abd': 0.22 }],
        [1.0, { np: -0.12, 'RA.flex': 3.02, 'RA.abd': 0.1, 'RA.elbow': 0.03, 'LA.abd': 0.22 }],
        [2.0, { np: -0.1, 'RA.flex': 3.0, 'RA.abd': 0.12, 'RA.elbow': 0.03, 'LA.abd': 0.22 }],
      ],
    },
    // --- hakem VAR ---
    'var-listen': {
      loop: true,
      mode: 'upper',
      keys: [
        [0, { np: 0.2, nyaw: 0.15, 'RA.flex': 1.05, 'RA.abd': 0.4, 'RA.elbow': 2.55, 'RA.twist': -0.6 }],
        [0.9, { np: 0.27, nyaw: 0.1, 'RA.flex': 1.05, 'RA.abd': 0.4, 'RA.elbow': 2.55, 'RA.twist': -0.6 }],
        [1.8, { np: 0.2, nyaw: 0.15, 'RA.flex': 1.05, 'RA.abd': 0.4, 'RA.elbow': 2.55, 'RA.twist': -0.6 }],
      ],
    },
    'var-monitor': {
      loop: true,
      mode: 'body',
      keys: [
        [0, { hp: 0.15, sp: 0.2, np: 0.35, 'BA.flex': 0.35, 'BA.abd': 0.5, 'BA.elbow': 1.7, 'BA.twist': 0.8 }],
        [1.2, { hp: 0.15, sp: 0.22, np: 0.3, nyaw: 0.15, 'BA.flex': 0.35, 'BA.abd': 0.5, 'BA.elbow': 1.7, 'BA.twist': 0.8 }],
        [2.4, { hp: 0.15, sp: 0.2, np: 0.38, nyaw: -0.12, 'BA.flex': 0.35, 'BA.abd': 0.5, 'BA.elbow': 1.7, 'BA.twist': 0.8 }],
        [3.6, { hp: 0.15, sp: 0.2, np: 0.35, 'BA.flex': 0.35, 'BA.abd': 0.5, 'BA.elbow': 1.7, 'BA.twist': 0.8 }],
      ],
    },
    // TV isareti: iki elle havada dikdortgen
    'var-signal': {
      mode: 'upper',
      keys: [
        [0, {}],
        [0.25, { np: -0.05, 'BA.flex': 1.55, 'BA.abd': 0.05, 'BA.elbow': 0.7 }],
        [0.6, { np: -0.05, 'BA.flex': 1.55, 'BA.abd': 0.6, 'BA.elbow': 0.6 }],
        [0.9, { np: -0.05, 'BA.flex': 0.95, 'BA.abd': 0.6, 'BA.elbow': 0.8 }],
        [1.2, { np: -0.05, 'BA.flex': 0.95, 'BA.abd': 0.05, 'BA.elbow': 0.9 }],
        [1.6, {}],
      ],
    },
  }
}

// --- derlenmis klipler (notr durus + ozellestirme; boyutlara bagli) ---
interface Compiled {
  clip: Clip
  t: number[]
  poses: Pose[]
  dur: number
}

const cache = new Map<string, Record<string, Compiled>>()

export function neutral(d: Dims): Pose {
  const p = new Pose()
  for (let i = 0; i < 2; i++) {
    const L = p.legs[i]
    L.x = (i === 0 ? 1 : -1) * d.hipW * 1.08
    L.y = d.ankleH
    L.yaw = 0.12
  }
  p.hy = -0.015
  return p
}

function compile(d: Dims): Record<string, Compiled> {
  const out: Record<string, Compiled> = {}
  const src = clips()
  for (const name in src) {
    const clip = src[name]
    const poses = clip.keys.map(([, spec]) => {
      const p = neutral(d)
      // ayak yuksekligi yer tutucusu (A) gercek bilek yuksekligine kaydirilir
      const s: PoseSpec = {}
      for (const k in spec) s[k] = k.endsWith('.y') ? spec[k] - A + d.ankleH : spec[k]
      return applySpec(p, s)
    })
    out[name] = { clip, t: clip.keys.map((k) => k[0]), poses, dur: clip.keys[clip.keys.length - 1][0] }
  }
  // -r klipleri -l kliplerinin aynasi
  for (const name of Object.keys(out)) {
    if (!name.endsWith('-l')) continue
    const l = out[name]
    out[name.slice(0, -2) + '-r'] = { ...l, poses: l.poses.map((p) => mirrorPose(p, new Pose())) }
  }
  out['card-yellow'] = out.card
  out['card-red'] = out.card
  return out
}

// boyut degerine gore onbellek (her karakterin Dims nesnesi ayri ama degerler ayni)
const dimsKey = (d: Dims) => `${d.hipH.toFixed(3)}|${d.ankleH.toFixed(3)}|${d.hipW.toFixed(3)}`
const byObj = new WeakMap<Dims, Record<string, Compiled>>()
function get(d: Dims) {
  let map = byObj.get(d)
  if (map) return map
  const k = dimsKey(d)
  map = cache.get(k)
  if (!map) cache.set(k, (map = compile(d)))
  byObj.set(d, map)
  return map
}

const ss = (x: number) => x * x * (3 - 2 * x)

export function hasClip(d: Dims, name: AnimState | RefAnim) {
  return !!get(d)[name]
}

export function clipInfo(d: Dims, name: string): Clip | undefined {
  return get(d)[name]?.clip
}

/**
 * klibi t aninda ornekler; out'a yazar. Donus: karisim agirligi (giris/cikis yumusatmasi icin)
 */
export function sampleClip(d: Dims, name: string, t: number, out: Pose): number {
  const c = get(d)[name]
  if (!c) return 0
  let tt = t
  if (c.clip.loop) tt = t % c.dur
  else if (tt >= c.dur) {
    copyPose(c.poses[c.poses.length - 1], out)
    return c.clip.hold ? 1 : 0
  }
  let i = 1
  while (i < c.t.length - 1 && c.t[i] < tt) i++
  const t0 = c.t[i - 1]
  const t1 = c.t[i]
  const k = t1 > t0 ? Math.min(1, Math.max(0, (tt - t0) / (t1 - t0))) : 1
  lerpPose(c.poses[i - 1], c.poses[i], ss(k), out)
  if (c.clip.loop || c.clip.hold) return 1
  // cikista lokomosyona yumusak donus (son %25)
  const rem = c.dur - tt
  return Math.min(1, rem / Math.max(0.08, c.dur * 0.25))
}

export { CLIP_LEN }
