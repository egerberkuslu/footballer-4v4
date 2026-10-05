// Acilis durumu (M): yukleme ekrani, on isitma, gecis perdesi ve olcum.
//  ?boot=0  yukleme ekrani yok (bassiz testlerde zaten kapali; ?boot=1 ile acilir)
//  ?warm=0  on isitma yok (karsilastirma olcumu icin)
import { defineStep, hookLoadingManager, setProgress } from './loadTracker'

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
const webdriver = typeof navigator !== 'undefined' && !!navigator.webdriver
/** yukleme ekrani: kullanicida acik, otomasyonda (playwright) yalniz ?boot=1 ile */
// sicak modul degisimi (HMR, yalniz gelistirme): modul ikinci kez degerlendirilirse canli oyunun ortasindayiz, ekran acilmaz.
// (Eskiden sure olcuyordu: yavas aglarda paket 20 s'den gec gelince yukleme ekrani HIC acilmiyordu.)
const hot = (import.meta as ImportMeta & { hot?: { data: Record<string, unknown> } }).hot
const late = !!hot?.data.booted
if (hot) hot.data.booted = true
export const BOOT = !late && (q.get('boot') === '1' || (q.get('boot') !== '0' && !webdriver))
/** on isitma: yukleme ekrani varken ya da ?warm=1 */
export const WARM = q.get('warm') === '1' || (BOOT && q.get('warm') !== '0')

export type Phase = 'load' | 'warm' | 'ready' | 'play'

export const boot = {
  phase: (BOOT ? 'load' : 'play') as Phase,
  // gecis perdesi (mod degisimi, oda girisi)
  curtain: false,
  curtainLabel: '',
  // acilista yakalanan hatalar (ekranda gosterilir, oyuna gecis engellenmez)
  errors: [] as string[],
  // olcum: "Oyna"dan sonraki ilk 20 s
  stats: { warm: WARM, t0: 0, frames: 0, worst: 0, over33: 0, over50: 0, worstAt: 0, logicMax: 0, worstP1Max: 0, loadMs: 0 },
}

const subs = new Set<() => void>()
let version = 0
export function bumpBoot() {
  version++
  subs.forEach((f) => f())
}
export const subscribeBoot = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
export const bootVersion = () => version

export function setPhase(p: Phase) {
  // oyuna gecildiyse geri donulmez (ör. "Yine de oyna" sonrasi isitma biterse)
  if (boot.phase === p || boot.phase === 'play') return
  boot.phase = p
  bumpBoot()
}

// adimlar bastan tanimli: ilerleme cubugu erken %100'e varmasin
hookLoadingManager()
if (BOOT) {
  defineStep('scene', 'Saha, çim ve çizgi dokuları', 2)
  defineStep('model', 'Oyuncu modeli', 3)
  defineStep('kits', 'Forma dokuları', 2)
  defineStep('trees', 'Ağaç billboard’ları', 1)
  defineStep('model-lod', 'Uzak çekim modeli', 1)
  defineStep('gpu', 'Dokular ekran kartına', 2)
  defineStep('shader', 'Shader derleme', 4)
  defineStep('frames', 'Gölge ve efekt ön ısıtma', 1)
  setProgress('scene', 0)
}

/** index.html'deki acilis perdesini kaldirir (yukleme ekrani cizilince; takilirsa 25 s sonra yine kalkar) */
export function hideSplash() {
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-splash')
}
if (typeof window !== 'undefined') {
  if (!BOOT) hideSplash()
  else setTimeout(hideSplash, 25000)
}

export function bootError(msg: string) {
  const m = msg.slice(0, 140)
  // ayni hata (ör. StrictMode cift istek) bir kez gosterilir
  if (boot.phase === 'play' || boot.errors.length >= 3 || boot.errors.includes(m)) return
  boot.errors.push(m)
  bumpBoot()
}

if (typeof window !== 'undefined') {
  Object.assign(window, { __boot: boot })
  if (BOOT) {
    window.addEventListener('error', (e) => bootError(e.message || 'Betik hatası'))
    window.addEventListener('unhandledrejection', (e) => bootError(String((e.reason as Error)?.message ?? e.reason)))
  }
}
