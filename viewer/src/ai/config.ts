import { keeperTune } from '../sim/keeperDive'
// Yapay zeka zorluk ayari: ?ai=kolay|orta|zor (varsayilan orta), ?watch=1 izleme modu.
export type AiLevel = 'kolay' | 'orta' | 'zor'

export interface AiTuning {
  decideHz: number // takim karari (Hz)
  react: number // kalecinin sut tepkisi ve baski degisiminde gecikme (s)
  passErr: number // pas hedef sapmasi (m, 15 m pasta)
  shotErr: number // sut hedef sapmasi (m, kale duzleminde)
  misjudge: number // pas yolu risk tahmininde gurultu (s)
  tackleBehind: number // arkadan mudahaleye girme olasiligi (karar basina)
  slide: number // kayarak mudahale olasiligi (uygun durumda, karar basina)
  shootBias: number // sut esigi kaydirma (+ = daha cok sut)
  lineErr: number // kosucunun ofsayt cizgisini tutturma sapmasi (m)
  offsideTrap: number // savunmanin ofsayt tuzagi kurma olasiligi (uygun durumda, karar basina)
  keeperHold: [number, number] // kalecinin topu elde tutma araligi (s); kural en fazla 3 s
  takerDelay: [number, number] // duran top hazir olduktan sonra vurus beklemesi (s); kural en fazla 3 s
  keeperPosErr: number // kalecinin aci kapatma konum hatasi (m)
  keeperMiss: number // sutu gec gorup dalmama olasiligi (sut basina)
  pressSpeed: number // baski kosusu hiz carpani (<1: depar yok)
  tackleP: number // uygun durumda ayakta mudahaleye girme olasiligi (karar basina)
  markLoose: number // markaj mesafesi carpani (>1 gevsek)
  keeperSkill: number // kurtarma olasiligi carpani (sim/keeperDive keeperTune.skill)
  jockey: number // yakin baskida jockey durusuna girme olasiligi (karar basina)
}

const LEVELS: Record<AiLevel, AiTuning> = {
  kolay: { decideHz: 5, react: 0.25, passErr: 1.6, shotErr: 0.9, misjudge: 0.25, tackleBehind: 0.08, slide: 0.03, shootBias: -0.05, lineErr: 0.75, offsideTrap: 0, keeperHold: [1.2, 2.2], takerDelay: [1.0, 2.0], keeperPosErr: 0.9, keeperMiss: 0.35, pressSpeed: 0.75, tackleP: 0.3, markLoose: 1.8, jockey: 0.3, keeperSkill: 0.1 },
  orta: { decideHz: 7, react: 0.2, passErr: 0.9, shotErr: 0.5, misjudge: 0.12, tackleBehind: 0.03, slide: 0.05, shootBias: 0, lineErr: 0.45, offsideTrap: 0, keeperHold: [0.9, 2.0], takerDelay: [0.7, 1.6], keeperPosErr: 0.4, keeperMiss: 0.1, pressSpeed: 1, tackleP: 0.6, markLoose: 1, jockey: 0.7, keeperSkill: 0.3 },
  zor: { decideHz: 10, react: 0.15, passErr: 0.45, shotErr: 0.28, misjudge: 0.04, tackleBehind: 0.01, slide: 0.06, shootBias: 0.05, lineErr: 0.25, offsideTrap: 0.12, keeperHold: [0.8, 1.6], takerDelay: [0.5, 1.2], keeperPosErr: 0.2, keeperMiss: 0.02, pressSpeed: 1.05, tackleP: 0.7, markLoose: 0.85, jockey: 0.95, keeperSkill: 0.5 },
}

const param = (k: string): string | null => {
  try {
    return typeof location === 'undefined' ? null : new URLSearchParams(location.search).get(k)
  } catch {
    return null
  }
}

const lv = param('ai')
export let aiLevel: AiLevel = lv === 'kolay' || lv === 'zor' ? lv : 'orta'
export let AI: AiTuning = { ...LEVELS[aiLevel] }
keeperTune.skill = AI.keeperSkill
export const watchMode = param('watch') === '1'

/** takim ayari: zorluk rakibe uygulanir; insanin takim arkadaslari en az 'orta' oynar */
export function tuneFor(team: 0 | 1, humanTeam: 0 | 1 | null): AiTuning {
  if (humanTeam === team) return aiLevel === 'zor' ? AI : LEVELS.orta
  return AI
}

/** test ve ayar paneli icin */
export function setAiLevel(l: AiLevel) {
  aiLevel = l
  AI = { ...LEVELS[l] }
  keeperTune.skill = AI.keeperSkill
}

// tohumlanabilir rastgelelik (bassiz test tekrar uretilebilir olsun)
let seed = (Math.random() * 2 ** 32) >>> 0
export function seedAI(s: number) {
  seed = s >>> 0
}
export function rnd(): number {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
export const gauss = () => {
  const u = rnd() || 1e-9
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
}
