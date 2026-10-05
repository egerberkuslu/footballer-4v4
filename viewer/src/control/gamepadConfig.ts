// Gamepad ayarlari ve tuş atama (saf TS, React yok). Arayuzu M2 (src/ui) cizer; mantik burada.
// Ayarlar localStorage 'gamepadSettings' altinda kalici (erisilemezse bellekte).
// Kullanim: getSettings/setSettings/resetSettings, ACTIONS, startLearn, onPadChange, rumble.

export type ActionId =
  | 'pass'
  | 'shoot'
  | 'lob'
  | 'through'
  | 'driven'
  | 'finesse'
  | 'shield'
  | 'tackle'
  | 'slide'
  | 'press'
  | 'jockey'
  | 'switch'
  | 'teamPress'
  | 'sprint'
  | 'precise'
  | 'pause'
  | 'camera'
  | 'hints'
  | 'camPrev'
  | 'camNext'

/** baglam: topla (hucum, duran toplar dahil) / topsuz (savunma) / genel */
export type Ctx = 'topla' | 'topsuz' | 'genel'
export type Preset = 'fifa' | 'klasik'

/** mantiksal dugme adlari (PS adlari); profil bunlari ham indekse cevirir */
export type Logical =
  | 'cross'
  | 'circle'
  | 'square'
  | 'triangle'
  | 'l1'
  | 'r1'
  | 'l2'
  | 'r2'
  | 'share'
  | 'options'
  | 'l3'
  | 'r3'
  | 'ps'
  | 'touchpad'
  | 'dup'
  | 'ddown'
  | 'dleft'
  | 'dright'

/** kullanicinin atadigi ham giris: dugme indeksi ya da eksen yonu */
export type RawBinding = { t: 'b'; i: number } | { t: 'a'; i: number; dir: 1 | -1 }

export interface ActionDef {
  id: ActionId
  ad: string
  ctx: Ctx
  fifa: Logical | null // FIFA / EA FC PlayStation duzeni
  klasik: Logical | null // eski duzen (null: bu on ayarda yok)
  /** uyumluluk: FIFA varsayilani */
  varsayilan: Logical
}

const A = (id: ActionId, ad: string, ctx: Ctx, fifa: Logical | null, klasik: Logical | null): ActionDef => ({ id, ad, ctx, fifa, klasik, varsayilan: (fifa ?? klasik ?? 'cross') as Logical })

export const ACTIONS: ActionDef[] = [
  // topla
  A('pass', 'Pas (basılı tut: güç)', 'topla', 'cross', 'cross'),
  A('shoot', 'Şut (basılı tut: şarj)', 'topla', 'circle', 'circle'),
  A('lob', 'Orta / aşırtma', 'topla', 'square', 'square'),
  A('through', 'Ara pas', 'topla', 'triangle', null),
  A('driven', 'Sert pas (pas ile)', 'topla', 'l1', null),
  A('finesse', 'Falsolu şut (şut ile)', 'topla', 'r1', null),
  A('shield', 'Top koruma', 'topla', 'l2', null),
  // topsuz
  A('tackle', 'Müdahale', 'topsuz', 'square', 'r1'),
  A('slide', 'Kayarak müdahale', 'topsuz', 'circle', null),
  A('press', 'Baskı (basılı tut)', 'topsuz', 'cross', null),
  A('jockey', 'Jockey (basılı tut)', 'topsuz', 'l2', null),
  A('switch', 'Oyuncu değiştir', 'topsuz', 'l1', 'triangle'),
  A('teamPress', 'Takım baskısı', 'topsuz', 'r1', null),
  // genel
  A('sprint', 'Sprint (analog)', 'genel', 'r2', 'r2'),
  A('precise', 'Hassas yürüme', 'genel', null, 'l2'),
  A('pause', 'Menü', 'genel', 'options', 'options'),
  A('camera', 'Yayın kamerası', 'genel', 'share', 'share'),
  A('hints', 'Pas halkaları', 'genel', 'ddown', 'ddown'),
  A('camPrev', 'Önceki kamera', 'genel', 'dleft', 'dleft'),
  A('camNext', 'Sonraki kamera', 'genel', 'dright', 'dright'),
]

/** bu on ayarda eylemin varsayilan mantiksal dugmesi (yoksa null) */
export const defaultOf = (a: ActionDef, preset: Preset): Logical | null => a[preset]

export interface GamepadSettings {
  preset: Preset // 'fifa' (varsayilan) | 'klasik'
  deadL: number // sol cubuk olu bolge 0.05..0.4
  deadR: number
  curve: 'dogrusal' | 'ustel'
  camSpeed: number // sag cubuk kamera hizi carpani 0.3..2
  invertY: boolean
  trigger: number // analog tetik esigi 0.1..0.9
  rumble: boolean
  rumbleLevel: number // 0..1
  bindings: Partial<Record<ActionId, RawBinding>> // yoksa profil varsayilani
}

export const DEFAULTS: GamepadSettings = {
  preset: 'fifa',
  deadL: 0.18,
  deadR: 0.18,
  curve: 'dogrusal',
  camSpeed: 1,
  invertY: false,
  trigger: 0.35,
  rumble: true,
  rumbleLevel: 0.6,
  bindings: {},
}

const KEY = 'gamepadSettings'
let cur: GamepadSettings = { ...DEFAULTS, bindings: {} }
const subs = new Set<() => void>()

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function sanitize(s: Partial<GamepadSettings>): GamepadSettings {
  const o = { ...DEFAULTS, ...s }
  o.preset = o.preset === 'klasik' ? 'klasik' : 'fifa'
  o.deadL = clamp(Number(o.deadL), 0.05, 0.4)
  o.deadR = clamp(Number(o.deadR), 0.05, 0.4)
  o.camSpeed = clamp(Number(o.camSpeed), 0.3, 2)
  o.trigger = clamp(Number(o.trigger), 0.1, 0.9)
  o.rumbleLevel = clamp(Number(o.rumbleLevel), 0, 1)
  o.curve = o.curve === 'ustel' ? 'ustel' : 'dogrusal'
  o.invertY = !!o.invertY
  o.rumble = !!o.rumble
  o.bindings = { ...(s.bindings ?? {}) }
  return o
}

try {
  const raw = globalThis.localStorage?.getItem(KEY)
  if (raw) cur = sanitize(JSON.parse(raw))
} catch {
  /* erisim yok: varsayilanlar */
}

function persist() {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(cur))
  } catch {
    /* kalici degil */
  }
  subs.forEach((f) => f())
}

export const getSettings = (): GamepadSettings => cur
export function setSettings(patch: Partial<GamepadSettings>) {
  cur = sanitize({ ...cur, ...patch, bindings: patch.bindings ?? cur.bindings })
  persist()
}
/** on ayar degistir; ozel atamalar sifirlanir */
export function setPreset(p: Preset) {
  cur = sanitize({ ...cur, preset: p, bindings: {} })
  persist()
}
export function resetSettings() {
  cur = { ...DEFAULTS, bindings: {} }
  persist()
}
/** ayar degisince bildirir (arayuz yeniden cizsin) */
export function onSettingsChange(cb: () => void) {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

// ------------------------------------------------------------------ profiller
export type ProfileId = 'standard' | 'ds4-raw' | 'generic'

export interface PadInfo {
  connected: boolean
  name: string
  profile: ProfileId
  ps: boolean // PlayStation kolu (simgeler)
  needsLearn: boolean // taninmayan standart disi kol: tus atama onerilir
}

const NONE: PadInfo = { connected: false, name: '', profile: 'standard', ps: false, needsLearn: false }
let info: PadInfo = NONE
const padSubs = new Set<(i: PadInfo) => void>()

/** kol baglanti/ayrilma ve profil degisimi */
export function onPadChange(cb: (i: PadInfo) => void) {
  padSubs.add(cb)
  cb(info)
  return () => {
    padSubs.delete(cb)
  }
}

export function detectProfile(gp: { id: string; mapping: string; axes: readonly number[]; buttons: readonly unknown[] }): PadInfo {
  const id = gp.id.toLowerCase()
  const ps = /054c|dualshock|wireless controller|dualsense|playstation/.test(id)
  if (gp.mapping === 'standard') return { connected: true, name: gp.id, profile: 'standard', ps, needsLearn: false }
  if (ps) return { connected: true, name: gp.id, profile: 'ds4-raw', ps: true, needsLearn: false }
  return { connected: true, name: gp.id, profile: 'generic', ps: false, needsLearn: true }
}

export function setPadInfo(next: PadInfo) {
  if (info.connected === next.connected && info.name === next.name && info.profile === next.profile) return
  info = next
  padSubs.forEach((f) => f(info))
}
export const getPadInfo = () => info

type Map1 = Partial<Record<Logical, number>>
/** mantiksal dugme > ham dugme indeksi */
export const PROFILE_BUTTONS: Record<ProfileId, Map1> = {
  standard: { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, share: 8, options: 9, l3: 10, r3: 11, dup: 12, ddown: 13, dleft: 14, dright: 15, ps: 16, touchpad: 17 },
  // Firefox Linux DualShock 4, standart disi: 0 X, 1 O, 2 ucgen, 3 kare (gercek kolla dogrulanmadi)
  'ds4-raw': { cross: 0, circle: 1, triangle: 2, square: 3, l1: 4, r1: 5, l2: 6, r2: 7, share: 8, options: 9, l3: 10, r3: 11, ps: 12, touchpad: 13 },
  generic: { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, share: 8, options: 9, l3: 10, r3: 11 },
}

/** simge/etiket: PS kolunda ✕ ○ □ △ L1 R1 L2 R2, digerlerinde Xbox adlari */
const PS_LABEL: Record<Logical, string> = {
  cross: '✕', circle: '○', square: '□', triangle: '△', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2',
  share: 'Share', options: 'Options', l3: 'L3', r3: 'R3', ps: 'PS', touchpad: 'Touchpad', dup: '↑', ddown: '↓', dleft: '←', dright: '→',
}
const XB_LABEL: Record<Logical, string> = {
  cross: 'A', circle: 'B', square: 'X', triangle: 'Y', l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT',
  share: 'Back', options: 'Start', l3: 'LS', r3: 'RS', ps: 'Home', touchpad: 'Touchpad', dup: '↑', ddown: '↓', dleft: '←', dright: '→',
}
export const logicalLabel = (l: Logical, ps = info.ps) => (ps ? PS_LABEL : XB_LABEL)[l]

/** eylem icin gosterilecek dugme etiketi (atama varsa ham, yoksa mantiksal) */
export function actionLabel(id: ActionId): string {
  const b = cur.bindings[id]
  if (b) {
    if (b.t === 'b') {
      // ham indeksi profilin mantiksal dugmesine cevir (R1, ✕ ...)
      const m = PROFILE_BUTTONS[info.profile]
      const l = (Object.keys(m) as Logical[]).find((k) => m[k] === b.i)
      return l ? logicalLabel(l) : `Düğme ${b.i}`
    }
    return `Eksen ${b.i}${b.dir > 0 ? '+' : '-'}`
  }
  const def = ACTIONS.find((a) => a.id === id)!
  const l = defaultOf(def, cur.preset)
  return l ? logicalLabel(l) : '—'
}

// ------------------------------------------------------------------ atama sihirbazi
export interface LearnResult {
  binding: RawBinding
  conflicts: ActionId[] // ayni girise atanmis diger eylemler (uyari)
}
let learning: { id: ActionId; cb: (r: LearnResult) => void } | null = null
let learnArmed = false // ilk karede basili olan girisleri yoksay

export function startLearn(actionId: ActionId, cb: (r: LearnResult) => void) {
  learning = { id: actionId, cb }
  learnArmed = false
  learnBase = null
  return () => {
    if (learning?.id === actionId) learning = null
  }
}
export const isLearning = () => (learning ? learning.id : null)

const same = (a: RawBinding, b: RawBinding) => (a.t === 'b' && b.t === 'b' ? a.i === b.i : a.t === 'a' && b.t === 'a' ? a.i === b.i && a.dir === b.dir : false)

/** pollPad cagirir: ogrenme sirasinda ilk yeni girisi yakalar. true: bu kare girdi yutuldu.
 *  Eksenler baslangic degerine gore olculur (DS4 ham tetikleri dinlenmede -1 durur). */
let learnBase: number[] | null = null
export function learnStep(buttons: readonly { pressed: boolean }[], axes: readonly number[]): boolean {
  if (!learning) {
    learnBase = null
    return false
  }
  if (!learnBase) learnBase = axes.slice()
  const dAx = (i: number) => (axes[i] ?? 0) - (learnBase![i] ?? 0)
  let hit: RawBinding | null = null
  // hicbir sey basili degilken silahlan (sihirbaz acilirken basili tus atanmasin)
  const anyDown = buttons.some((b) => b.pressed) || axes.some((_, i) => i > 1 && Math.abs(dAx(i)) > 0.7)
  if (!learnArmed) {
    if (!anyDown) learnArmed = true
    return true
  }
  buttons.forEach((b, i) => {
    if (!hit && b.pressed) hit = { t: 'b', i }
  })
  if (!hit) {
    axes.forEach((_, i) => {
      // sol cubuk (0,1) atanamaz
      if (!hit && i > 1 && Math.abs(dAx(i)) > 0.7) hit = { t: 'a', i, dir: dAx(i) > 0 ? 1 : -1 }
    })
  }
  if (!hit) return true
  const b: RawBinding = hit
  const ctxOf = (id: ActionId) => ACTIONS.find((a) => a.id === id)!.ctx
  const overlap = (x: ActionId, y: ActionId) => ctxOf(x) === ctxOf(y) || ctxOf(x) === 'genel' || ctxOf(y) === 'genel'
  const conflicts = (Object.keys(cur.bindings) as ActionId[]).filter((k) => k !== learning!.id && cur.bindings[k] && same(cur.bindings[k]!, b) && overlap(k, learning!.id))
  const { id, cb } = learning
  learning = null
  learnBase = null
  setSettings({ bindings: { ...cur.bindings, [id]: b } })
  cb({ binding: b, conflicts })
  return true
}

/** tek eylemin atamasini kaldir (profil varsayilanina don) */
export function clearBinding(id: ActionId) {
  const bs = { ...cur.bindings }
  delete bs[id]
  setSettings({ bindings: bs })
}

// ------------------------------------------------------------------ titresim
export type RumbleKind = 'sut' | 'gol' | 'faul' | 'kart' | 'kurtaris'
const RUMBLE: Record<RumbleKind, { d: number; w: number; s: number }> = {
  sut: { d: 90, w: 0.5, s: 0.7 },
  gol: { d: 450, w: 0.9, s: 0.9 },
  faul: { d: 160, w: 0.6, s: 0.3 },
  kart: { d: 260, w: 0.8, s: 0.5 },
  kurtaris: { d: 140, w: 0.6, s: 0.6 },
}
/** titresim eyleyicisi (poll her karede gunceller) */
let actuator: { playEffect?: (t: string, p: object) => Promise<unknown> } | null = null
export const setActuator = (a: typeof actuator) => {
  actuator = a
}
export const rumbleStats = { calls: 0, last: '' }

export function rumble(kind: RumbleKind) {
  if (!cur.rumble || cur.rumbleLevel <= 0 || !actuator?.playEffect) return
  const r = RUMBLE[kind]
  rumbleStats.calls++
  rumbleStats.last = kind
  try {
    void actuator
      .playEffect('dual-rumble', { startDelay: 0, duration: r.d, weakMagnitude: clamp(r.w * cur.rumbleLevel, 0, 1), strongMagnitude: clamp(r.s * cur.rumbleLevel, 0, 1) })
      ?.catch?.(() => {})
  } catch {
    /* desteklenmiyor */
  }
}
