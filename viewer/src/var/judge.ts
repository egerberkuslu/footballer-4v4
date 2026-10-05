// VAR karar mantigi: saf fonksiyonlar (sahne/React yok), sayisal test buradan yapilir.
// Kural: topun TAMAMI cizginin dis kenarini (x = ±PITCH_L/2, z = ±PITCH_W/2) gecerse gol/aut.
// d = top merkezinin cizginin otesine uzakligi; tamami gecti <=> d >= BALL_R.
import { BALL_R, GOAL_H, GOAL_W, PITCH_L, POST_R } from '../pitch'

/** Otomatik VAR esikleri (tek yer). Cizgi: topun tamamen gecmesine kalan / gecme payi (m). */
export const LINE_TOL = 0.06
/** Ofsayt: |margin| bu degerin altindaysa ve pozisyon golle bittiyse incelenir (m) */
export const OFFSIDE_TOL = 0.3

// Yalniz kale cizgisi incelenir; tac/yan cizgi VAR kapsaminda degil.
export type LineId = 'kale+' | 'kale-'
export const LINES: LineId[] = ['kale+', 'kale-']

export type VerdictKind = 'gol' | 'gol-degil' | 'kale-vurusu' | 'korner' | 'oyunda'

export interface Verdict {
  kind: VerdictKind
  title: string
  tag: string // ust kucuk etiket (AUT / GOL ÇİZGİSİ ...)
  sub: string
  line: LineId
  crossed: boolean
  /** cizgiyi tamamen gecme payi (cm): + gecti, - eksik */
  cm: number
  /** kritik kare (cagiranin dizinine gore, tam sayi: kritik anin ait oldugu aralik basi) */
  frame: number
  /** kritik an: kesirli kare (frame + aralik ici pay) */
  fr: number
  x: number
  y: number
  z: number
  /** kale agzinin kenarina (direk/ust direk) yakin gecti mi: kil payi sayilir */
  tight: boolean
}

const G = PITCH_L / 2
const HW = GOAL_W / 2

/** top merkezinin cizginin disina uzakligi (m); + saha disi yonunde */
export function lineDist(line: LineId, x: number, _z = 0): number {
  return line === 'kale+' ? x - G : -x - G
}

export const isGoalLine = (_l: LineId) => true
export const lineSign = (l: LineId) => (l === 'kale+' ? 1 : -1)

/** top merkezi kale agzinin icinden mi geciyor (direkler arasi, ust diregin alti) */
export const inMouth = (y: number, z: number) => Math.abs(z) < HW && y < GOAL_H

/** gecis noktasinin direk/ust direge uzakligi (m) */
function frameGap(y: number, z: number) {
  const dz = HW - POST_R - Math.abs(z)
  const dy = GOAL_H - POST_R - y
  return Math.min(Math.abs(dz), y < GOAL_H + 0.5 ? Math.abs(dy) : 9)
}

const fmt = (v: number) => {
  const a = Math.abs(v)
  return (a < 10 ? a.toFixed(1) : Math.round(a).toString()).replace('.', ',')
}
export const fmtCm = (cm: number) => `${cm < 0 ? '−' : cm > 0 ? '+' : ''}${fmt(cm)} cm`

/**
 * Tek bir konumdan (cizgi ve kritik kare biliniyorsa) karar.
 * side: hucum edilen kale (+1 / -1); son dokunan sutcu (hucum takimi) kabul edilir.
 */
export function classify(line: LineId, x: number, y: number, z: number, side: 1 | -1, frame = 0, fr = frame): Verdict {
  const d = lineDist(line, x, z)
  const crossed = d >= BALL_R
  const cm = (d - BALL_R) * 100
  const base = { line, crossed, cm, frame, fr, x, y, z }
  const goalLine = true
  const own = lineSign(line) !== side // savunulan (kendi) kale cizgisi
  const mouth = goalLine && inMouth(y, z)
  const tight = goalLine && frameGap(y, z) < 0.35
  if (crossed) {
    if (mouth)
      return {
        ...base,
        kind: 'gol',
        title: 'GOL',
        tag: own ? 'KENDİ KALESİNE' : 'GOL ÇİZGİSİ TEKNOLOJİSİ',
        sub: 'Topun tamamı kale çizgisini geçti',
        tight,
      }
    if (goalLine)
      return {
        ...base,
        kind: own ? 'korner' : 'kale-vurusu',
        title: own ? 'KORNER' : 'KALE VURUŞU',
        tag: 'AUT',
        sub: y >= GOAL_H && Math.abs(z) < HW ? 'Top üst direğin üzerinden çıktı' : 'Top kale çizgisinden auta çıktı',
        tight,
      }
    return { ...base, kind: 'oyunda', title: 'TOP OYUNDA', tag: 'KALE ÇİZGİSİ', sub: 'Top kale ağzının dışında', tight: false }
  }
  // gol degil: top kale agzinda ve cizgiye yakin (uzakta duran top 'oyunda')
  if (goalLine && Math.abs(z) < HW + BALL_R && y < GOAL_H + BALL_R && d > -BALL_R - 0.5)
    return {
      ...base,
      kind: 'gol-degil',
      title: 'GOL DEĞİL',
      tag: 'GOL ÇİZGİSİ TEKNOLOJİSİ',
      sub: 'Topun tamamı çizgiyi geçmedi',
      tight: true,
    }
  return { ...base, kind: 'oyunda', title: 'TOP OYUNDA', tag: 'KALE ÇİZGİSİ', sub: 'Topun tamamı çizgiyi geçmedi', tight: false }
}

export interface Track {
  /** k. ornegin top merkezi */
  get(k: number, out: { x: number; y: number; z: number }): void
  /** k. ornekteki top hizi (m/s); varsa kareler arasi balistik (Hermite) cozum yapilir */
  vel?(k: number, out: { x: number; y: number; z: number }): void
  /** k. ornegin sim zamani (s) */
  time?(k: number): number
  /** k. ornekle k+1 arasi surekli degil (top isinlandi) */
  gap?(k: number): boolean
}

/** kritik an penceresi: ilk tam gecisten sonra en fazla bu kadar sn icindeki en buyuk pay alinir */
const CROSS_WIN = 0.1
/** belirgin gol icin gosterilen en fazla pay (m) */
const OPEN_M = 0.3

const hermite = (s: number, p0: number, p1: number, m0: number, m1: number) => {
  const s2 = s * s
  const s3 = s2 * s
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1
}

/**
 * [k, k+1] araliginda x(s)'nin en buyuk degeri (s in [0,1]) ve yeri.
 * Konum + hizdan kubik Hermite: sabit ivmede (yercekimi) tam, surtunmede ihmal edilebilir sapma.
 * Hiz yoksa dogrusal uc noktalar. Cozum: x'(s)=0 ikinci derece denklemi.
 */
export function segMaxX(
  x0: number,
  x1: number,
  vx0: number,
  vx1: number,
  h: number,
  sign: 1 | -1,
): { v: number; s: number } {
  const m0 = vx0 * h
  const m1 = vx1 * h
  const f = (s: number) => sign * hermite(s, x0, x1, m0, m1)
  let bv = f(0)
  let bs = 0
  const e = f(1)
  if (e > bv) {
    bv = e
    bs = 1
  }
  // d/ds Hermite: A s^2 + B s + C
  const A = 6 * (x0 - x1) + 3 * (m0 + m1)
  const B = 6 * (x1 - x0) - 4 * m0 - 2 * m1
  const C = m0
  const roots: number[] = []
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) roots.push(-C / B)
  } else {
    const D = B * B - 4 * A * C
    if (D >= 0) {
      const q = Math.sqrt(D)
      roots.push((-B + q) / (2 * A), (-B - q) / (2 * A))
    }
  }
  for (const s of roots)
    if (s > 0 && s < 1) {
      const v = f(s)
      if (v > bv) {
        bv = v
        bs = s
      }
    }
  return { v: bv, s: bs }
}

/** k ile k+1 arasi s kesrinde top konumu (Hermite; hiz yoksa dogrusal) */
export function trackAt(tr: Track, k: number, s: number, out: { x: number; y: number; z: number }) {
  const a = { x: 0, y: 0, z: 0 }
  const b = { x: 0, y: 0, z: 0 }
  tr.get(k, a)
  if (s <= 0) return Object.assign(out, a)
  tr.get(k + 1, b)
  if (s >= 1) return Object.assign(out, b)
  if (tr.vel && tr.time && !(tr.gap && tr.gap(k))) {
    const va = { x: 0, y: 0, z: 0 }
    const vb = { x: 0, y: 0, z: 0 }
    tr.vel(k, va)
    tr.vel(k + 1, vb)
    const h = tr.time(k + 1) - tr.time(k)
    out.x = hermite(s, a.x, b.x, va.x * h, vb.x * h)
    out.y = hermite(s, a.y, b.y, va.y * h, vb.y * h)
    out.z = hermite(s, a.z, b.z, va.z * h, vb.z * h)
  } else {
    out.x = a.x + (b.x - a.x) * s
    out.y = a.y + (b.y - a.y) * s
    out.z = a.z + (b.z - a.z) * s
  }
  return out
}

/** [k, k+1] aralikta cizgiye gore en buyuk top merkezi uzakligi d ve yeri s */
export function segMaxD(tr: Track, line: LineId, k: number): { d: number; s: number } {
  const a = { x: 0, y: 0, z: 0 }
  const b = { x: 0, y: 0, z: 0 }
  tr.get(k, a)
  tr.get(k + 1, b)
  const sign = lineSign(line)
  if (tr.vel && tr.time && !(tr.gap && tr.gap(k))) {
    const va = { x: 0, y: 0, z: 0 }
    const vb = { x: 0, y: 0, z: 0 }
    tr.vel(k, va)
    tr.vel(k + 1, vb)
    const m = segMaxX(a.x, b.x, va.x, vb.x, tr.time(k + 1) - tr.time(k), sign)
    return { d: m.v - G, s: m.s }
  }
  const da = lineDist(line, a.x)
  const db = lineDist(line, b.x)
  return da >= db ? { d: da, s: 0 } : { d: db, s: 1 }
}

/**
 * Bir kayit araligi icin karar: [from, to] (dahil).
 * Kareler arasi balistik cozumle: topun cizgiye en cok yaklastigi (en buyuk d) an bulunur.
 * Tam gecis varsa ilk tam gecisten CROSS_WIN sn icindeki en buyuk pay alinir; yoksa tum aralikta en buyuk d.
 */
export function judgeTrack(tr: Track, from: number, to: number, side: 1 | -1): Verdict {
  const p = { x: 0, y: 0, z: 0 }
  const pref: LineId = side === 1 ? 'kale+' : 'kale-'
  let best = -Infinity
  let bk = from
  let bs = 0
  let bl: LineId = pref
  let tCross = Infinity
  const T = (k: number) => (tr.time ? tr.time(k) : k / 60)
  const n = to - from
  const step = (k: number, line: LineId, d: number, s: number) => {
    // esitlikte hucum kale cizgisi oncelikli
    if (d > best + 1e-9 || (Math.abs(d - best) <= 1e-9 && line === pref)) {
      best = d
      bk = k
      bs = s
      bl = line
    }
  }
  if (n <= 0) {
    tr.get(from, p)
    for (const l of LINES) step(from, l, lineDist(l, p.x), 0)
  }
  for (let k = from; k < to; k++) {
    if (tr.gap && tr.gap(k)) {
      // sureksiz aralik: yalniz uc nokta
      tr.get(k, p)
      for (const l of LINES) step(k, l, lineDist(l, p.x), 0)
      continue
    }
    for (const l of LINES) {
      const m = segMaxD(tr, l, k)
      const tm = T(k) + (T(k + 1) - T(k)) * m.s
      if (m.d >= BALL_R && tCross === Infinity) tCross = tm
      if (tm <= tCross + CROSS_WIN) step(k, l, m.d, m.s)
    }
  }
  // belirgin gol: kritik an, payin OPEN_CM'e ulastigi ilk an (kartta makul bir santim; topun kaleye girisi)
  if (best - BALL_R > OPEN_M) {
    const tgt = BALL_R + OPEN_M
    for (let k = from; k < to; k++) {
      if (tr.gap && tr.gap(k)) continue
      if (segMaxD(tr, bl, k).d < tgt) continue
      let lo = 0
      let hi = 1
      for (let it = 0; it < 30; it++) {
        const m = (lo + hi) / 2
        trackAt(tr, k, m, p)
        if (lineDist(bl, p.x) >= tgt) hi = m
        else lo = m
      }
      bk = k
      bs = hi
      break
    }
  }
  trackAt(tr, bk, bs, p)
  return classify(bl, p.x, p.y, p.z, side, bk, bk + bs)
}

/** karar -> oyun olayi (var-decision.verdict) */
export function eventVerdict(kind: VerdictKind): 'gol' | 'gol-degil' | 'korner' | 'kale-vurusu' {
  switch (kind) {
    case 'gol':
      return 'gol'
    case 'korner':
      return 'korner'
    case 'kale-vurusu':
      return 'kale-vurusu'
    default:
      return 'gol-degil'
  }
}

const KIND_CLASS: Record<VerdictKind, string> = {
  gol: 'k-gol',
  'gol-degil': 'k-no',
  'kale-vurusu': 'k-out',
  korner: 'k-korner',
  oyunda: 'k-play',
}

export function lineDisplay(v: Verdict) {
  // belirgin gol (kil payi degil): kartta en buyuk gecme payi yazilir
  const open = v.kind === 'gol' && v.cm > LINE_TOL * 100
  return {
    title: v.title,
    tag: v.tag,
    sub: open ? `Açık gol · topun tamamı çizgiyi ${fmt(v.cm)} cm geçti` : v.sub,
    cm: v.cm,
    cls: KIND_CLASS[v.kind],
    ok: v.crossed,
    measure: `${isGoalLine(v.line) ? 'KALE ÇİZGİSİ' : 'TAÇ ÇİZGİSİ'} · ÖLÇÜM`,
    okText: 'Topun tamamı çizgiyi geçti',
    noText: 'Topun tamamı çizgiyi geçmedi',
  }
}

/** ofsayt: margin (m, + = ofsayt) -> karar ekrani */
export function offsideDisplay(margin: number, name: string) {
  const off = margin > 0
  return {
    title: off ? 'OFSAYT' : 'GOL',
    tag: 'OFSAYT İNCELEMESİ',
    sub: off ? `${name} pas anında ofsayttaydı · gol iptal` : `${name} pas anında ofsayt değildi · gol geçerli`,
    cm: margin * 100,
    cls: off ? 'k-no' : 'k-gol',
    ok: !off,
    measure: 'OFSAYT ÇİZGİSİ · ÖLÇÜM',
    okText: 'Hücumcu son savunmacının gerisinde',
    noText: 'Hücumcu son savunmacının önünde',
  }
}
