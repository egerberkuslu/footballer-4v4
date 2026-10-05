// Parametrik poz: tum karakter durusu duz sayilardan olusur, karisim = dogrusal ara deger.
// Karakter uzayi: +z ileri, +y yukari, +x karakterin SOLU. Uzunluk metre, aci radyan.
// Isaretler: pitch + = one egilme, roll + = saga yatma, yaw + = sola donme.

export class Leg {
  ik = 1 // 1: ayak hedefi (x,y,z) ile IK, 0: aci ile FK
  x = 0 // ayak bilegi hedefi (karakter uzayi)
  y = 0.08 // bilegin zeminden yuksekligi
  z = 0
  pitch = 0 // ayak: + = burun yukari
  yaw = 0 // IK'da ayak yonu: + = burun disa
  toe = 0 // parmak kirilmasi: + = parmaklar yukari
  flex = 0 // FK uyluk: + = one kaldir
  abd = 0 // FK uyluk: + = disa ac
  twist = 0 // FK uyluk: + = dis rotasyon (ayak ici vurus)
  knee = 0 // FK diz bukumu (+)
}

export class Arm {
  flex = 0 // + = one kaldir (pi: tam yukari)
  abd = 0.16 // + = yana ac
  elbow = 0.25 // dirsek bukumu (+)
  twist = 0
  shrug = 0
  ik = 0 // 1: el bilegi hedefi (tx,ty,tz; karakter uzayi, zeminden) ile IK
  tx = 0
  ty = 1
  tz = 0.3
}

export class Pose {
  hx = 0 // pelvis ofseti (dinlenme konumuna gore)
  hy = 0
  hz = 0
  hp = 0 // pelvis donusu (tum govdeyi tasir)
  hyaw = 0
  hr = 0
  sp = 0 // omurga toplam bukum (3 omura dagitilir)
  syaw = 0
  sr = 0
  np = 0 // bas: + = asagi bak
  nyaw = 0
  legs: [Leg, Leg] = [new Leg(), new Leg()] // 0: sol, 1: sag
  arms: [Arm, Arm] = [new Arm(), new Arm()]
}

const POSE_KEYS = Object.keys(new Pose()).filter((k) => k !== 'legs' && k !== 'arms') as (keyof Pose)[]
const LEG_KEYS = Object.keys(new Leg()) as (keyof Leg)[]
const ARM_KEYS = Object.keys(new Arm()) as (keyof Arm)[]

type Num = Record<string, number>

function lerpObj(keys: string[], a: Num, b: Num, t: number, o: Num) {
  for (const k of keys) o[k] = a[k] + (b[k] - a[k]) * t
}

/** o = a + (b - a) t ; o, a ya da b ile ayni olabilir */
export function lerpPose(a: Pose, b: Pose, t: number, o: Pose): Pose {
  lerpObj(POSE_KEYS as string[], a as unknown as Num, b as unknown as Num, t, o as unknown as Num)
  for (let i = 0; i < 2; i++) {
    lerpObj(LEG_KEYS, a.legs[i] as unknown as Num, b.legs[i] as unknown as Num, t, o.legs[i] as unknown as Num)
    lerpObj(ARM_KEYS, a.arms[i] as unknown as Num, b.arms[i] as unknown as Num, t, o.arms[i] as unknown as Num)
  }
  return o
}

/** yalniz govde ustu (omurga, bas, kollar) karistir; bacaklar ve pelvis konumu a'da kalir */
export function lerpUpper(a: Pose, b: Pose, t: number, o: Pose): Pose {
  if (o !== a) copyPose(a, o)
  for (const k of ['sp', 'syaw', 'sr', 'np', 'nyaw'] as const) o[k] = a[k] + (b[k] - a[k]) * t
  for (let i = 0; i < 2; i++)
    lerpObj(ARM_KEYS, a.arms[i] as unknown as Num, b.arms[i] as unknown as Num, t, o.arms[i] as unknown as Num)
  return o
}

/** govde karisimi: bacak IK hedefleri a'dan (lokomosyon), digerleri b'den; b'nin ayak acikligi (nx'e gore) eklenir */
export function lerpBody(a: Pose, b: Pose, t: number, nx: number, o: Pose): Pose {
  if (o !== a) copyPose(a, o)
  lerpObj(POSE_KEYS as string[], a as unknown as Num, b as unknown as Num, t, o as unknown as Num)
  for (let i = 0; i < 2; i++) {
    lerpObj(ARM_KEYS, a.arms[i] as unknown as Num, b.arms[i] as unknown as Num, t, o.arms[i] as unknown as Num)
    const sg = i === 0 ? 1 : -1
    o.legs[i].x = a.legs[i].x + (b.legs[i].x - sg * nx) * t
    o.legs[i].yaw = a.legs[i].yaw + (b.legs[i].yaw - a.legs[i].yaw) * t
  }
  return o
}

export const copyPose = (a: Pose, o: Pose) => lerpPose(a, a, 0, o)

/** sol-sag ayna (sag kaleci uclusu sol ucustan) */
export function mirrorPose(a: Pose, o: Pose): Pose {
  const t = new Pose()
  copyPose(a, t)
  t.hx = -a.hx
  t.hyaw = -a.hyaw
  t.hr = -a.hr
  t.syaw = -a.syaw
  t.sr = -a.sr
  t.nyaw = -a.nyaw
  for (let i = 0; i < 2; i++) {
    lerpObj(LEG_KEYS, a.legs[1 - i] as unknown as Num, a.legs[1 - i] as unknown as Num, 0, t.legs[i] as unknown as Num)
    t.legs[i].x = -a.legs[1 - i].x
    lerpObj(ARM_KEYS, a.arms[1 - i] as unknown as Num, a.arms[1 - i] as unknown as Num, 0, t.arms[i] as unknown as Num)
    t.arms[i].tx = -a.arms[1 - i].tx
  }
  return copyPose(t, o)
}

// --- anahtar kare tanimi: "L.flex" / "R.knee" / "LA.abd" / "RA.elbow" / "B.*" (iki bacak) / "BA.*" (iki kol) ---
export type PoseSpec = Record<string, number>

export function applySpec(p: Pose, spec: PoseSpec): Pose {
  for (const key in spec) {
    const v = spec[key]
    const dot = key.indexOf('.')
    if (dot < 0) {
      ;(p as unknown as Num)[key] = v
      continue
    }
    const part = key.slice(0, dot)
    const f = key.slice(dot + 1)
    if ((part === 'B' && f === 'x') || (part === 'BA' && f === 'tx')) {
      // iki yanda x aynalanir: sol +, sag -
      const pr = (part === 'B' ? p.legs : p.arms) as unknown as Num[]
      pr[0][f] = v
      pr[1][f] = -v
      continue
    }
    const tgt: Num[] =
      part === 'L' ? [p.legs[0] as unknown as Num]
      : part === 'R' ? [p.legs[1] as unknown as Num]
      : part === 'B' ? (p.legs as unknown as Num[])
      : part === 'LA' ? [p.arms[0] as unknown as Num]
      : part === 'RA' ? [p.arms[1] as unknown as Num]
      : (p.arms as unknown as Num[])
    for (const o of tgt) o[f] = v
  }
  return p
}
