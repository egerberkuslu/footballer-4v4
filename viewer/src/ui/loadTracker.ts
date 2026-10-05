// Yukleme ilerleme kaydi (M). Iki kaynak:
//  1) dosya yuklemeleri: THREE.DefaultLoadingManager (GLTF, TextureLoader) adres kovalarina ayrilir
//  2) elle kaydedilen adimlar: prosedurel doku uretimi, GPU yukleme, shader derleme ...
// Diger ajanlar kendi agir islerini kaydedebilir:
//   import { trackStep } from './ui/loadTracker'
//   const tex = trackStep('cim-doku', 'Çim dokusu', () => paintGrass())
import * as THREE from 'three'

export type StepState = 'wait' | 'run' | 'done'
export interface Step {
  id: string
  label: string
  weight: number
  frac: number
  state: StepState
  detail: string
  ms: number // olculen sure (bilgi)
  t0: number
}

const steps = new Map<string, Step>()
const subs = new Set<() => void>()
let version = 0
let queued = false

function bump() {
  version++
  // ayni karede cok sayida guncelleme tek bildirime iner
  if (queued) return
  queued = true
  queueMicrotask(() => {
    queued = false
    subs.forEach((f) => f())
  })
}

export const subscribeLoad = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
export const loadVersion = () => version

/** adimi tanimla (zaten varsa dokunmaz); agirlik toplam ilerlemedeki payidir */
export function defineStep(id: string, label: string, weight = 1): Step {
  let s = steps.get(id)
  if (!s) {
    s = { id, label, weight, frac: 0, state: 'wait', detail: '', ms: 0, t0: 0 }
    steps.set(id, s)
    bump()
  }
  return s
}

export function setProgress(id: string, frac: number, detail?: string) {
  const s = steps.get(id) ?? defineStep(id, id)
  if (s.state === 'done') return
  if (s.state === 'wait') {
    s.state = 'run'
    s.t0 = performance.now()
  }
  s.frac = Math.max(s.frac, Math.min(1, frac))
  if (detail !== undefined) s.detail = detail
  bump()
}

export function finishStep(id: string, detail?: string) {
  const s = steps.get(id) ?? defineStep(id, id)
  if (s.state === 'done') return
  if (s.t0) s.ms = performance.now() - s.t0
  s.state = 'done'
  s.frac = 1
  if (detail !== undefined) s.detail = detail
  bump()
}

/** senkron agir is (ör. canvas doku uretimi): sureyi olcer, adimi tamamlar */
export function trackStep<T>(id: string, label: string, fn: () => T, weight = 0.5): T {
  defineStep(id, label, weight)
  setProgress(id, 0)
  try {
    return fn()
  } finally {
    finishStep(id)
  }
}

export async function trackAsync<T>(id: string, label: string, fn: () => Promise<T>, weight = 0.5): Promise<T> {
  defineStep(id, label, weight)
  setProgress(id, 0)
  try {
    return await fn()
  } finally {
    finishStep(id)
  }
}

export function listSteps(): Step[] {
  return [...steps.values()]
}

/** agirlikli toplam ilerleme 0..1 */
export function overall(): number {
  let w = 0
  let d = 0
  for (const s of steps.values()) {
    w += s.weight
    d += s.weight * (s.state === 'done' ? 1 : s.frac)
  }
  return w ? d / w : 0
}

/** su an calisan (ya da siradaki) adim */
export function currentStep(): Step | null {
  let wait: Step | null = null
  for (const s of steps.values()) {
    if (s.state === 'run') return s
    if (s.state === 'wait' && !wait) wait = s
  }
  return wait
}

// ------------------------------------------------------------ dosya kovalari
interface Bucket {
  id: string
  started: number
  loaded: number
  failed: number
}
const RULES: [RegExp, string][] = [
  [/futbolcu_lod1\.glb/, 'model-lod'],
  [/futbolcu\.glb|^blob:/, 'model'],
  [/\/kits\//, 'kits'],
  [/\/env\/tree/, 'trees'],
]
const buckets = new Map<string, Bucket>()
let pending = 0
let lastIoT = 0

export const ioPending = () => pending
export const lastIo = () => lastIoT
/** kova basina baslayan dosya sayisi */
export function fileCounts(): Record<string, number> {
  const out: Record<string, number> = { model: 0, kits: 0 }
  for (const b of buckets.values()) out[b.id] = b.started
  return out
}

function bucketOf(url: string): Bucket {
  const id = RULES.find(([r]) => r.test(url))?.[1] ?? 'files'
  let b = buckets.get(id)
  if (!b) {
    b = { id, started: 0, loaded: 0, failed: 0 }
    buckets.set(id, b)
    if (!steps.has(id)) defineStep(id, 'Diğer dosyalar', 0.5)
  }
  return b
}

function refresh(b: Bucket) {
  const n = b.loaded + b.failed
  const detail = b.started > 1 ? `${n}/${b.started}` : ''
  if (n >= b.started) finishStep(b.id, b.failed ? `${detail} · ${b.failed} hata` : detail)
  else setProgress(b.id, n / b.started, detail)
}

let hooked = false
let errorHook: ((msg: string) => void) | null = null
export const onLoadError = (f: (msg: string) => void) => (errorHook = f)
/** DefaultLoadingManager'i sarar (drei useProgress'in onStart/onProgress'ine dokunmaz) */
export function hookLoadingManager() {
  if (hooked) return
  hooked = true
  const m = THREE.DefaultLoadingManager
  const start = m.itemStart.bind(m)
  const end = m.itemEnd.bind(m)
  const err = m.itemError.bind(m)
  m.itemStart = (url: string) => {
    const b = bucketOf(url)
    b.started++
    pending++
    lastIoT = performance.now()
    refresh(b)
    start(url)
  }
  m.itemEnd = (url: string) => {
    // ayni adres ayni anda iki kez istenebilir: kova adresten yeniden bulunur
    const b = bucketOf(url)
    b.loaded++
    pending = Math.max(0, pending - 1)
    lastIoT = performance.now()
    refresh(b)
    end(url)
  }
  m.itemError = (url: string) => {
    // itemError'dan sonra itemEnd de gelir; burada yalniz hatayi say
    const b = bucketOf(url)
    b.failed++
    b.loaded--
    errorHook?.(`Yüklenemedi: ${url.replace(/^.*\//, '')}`)
    err(url)
  }
}

/** yukleme bitti sayildiginda: hic baslamayan dosya kovalari "gerek yok" diye kapanir */
export function sealFiles() {
  for (const id of ['model', 'model-lod', 'kits', 'trees', 'files']) {
    const s = steps.get(id)
    if (s && s.state !== 'done') finishStep(id, buckets.get(id)?.started ? undefined : 'gerek yok')
  }
}
