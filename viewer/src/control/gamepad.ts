// Gamepad okuma: profil algilama, olu bolge, egri, analog tetik, atanmis dugmeler, kenar (basma/birakma) olaylari.
// MatchControl yalniz pollPad() cagirir. Ayar/atama: gamepadConfig.ts.
import { game } from '../game/store'
import {
  ACTIONS,
  defaultOf,
  PROFILE_BUTTONS,
  detectProfile,
  getPadInfo,
  getSettings,
  setSettings,
  learnStep,
  rumble,
  setActuator,
  setPadInfo,
  type ActionId,
  type Logical,
  type RawBinding,
} from './gamepadConfig'

import { useEffect } from 'react'

/** mod bagimsiz kol okuma (baglanti algilama, ayar ekraninda tus atama); sahnenin disina takilir */
export function PadPoll() {
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      pollPad()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return null
}

export interface PadFrame {
  name: string
  move: { x: number; y: number } // sol cubuk, y yukari +
  look: { x: number; y: number } // sag cubuk
  held: Record<ActionId, boolean>
  down: Record<ActionId, boolean> // bu karede basildi
  up: Record<ActionId, boolean> // bu karede birakildi
  l1: boolean
  r1: boolean
  r1Down: boolean
  analog: { l2: number; r2: number }
  /** menu gezinme (mod bagimsiz, atamalardan bagimsiz): d-pad ya da sol cubuk */
  nav: { up: boolean; down: boolean; left: boolean; right: boolean; ok: boolean; back: boolean; menu: boolean }
}

/** son kare cubuk/d-pad yorumu (ters cevirme sonrasi), arayuz gostergesi icin */
export const padLive = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, dpad: { x: 0, y: 0 }, raw: [] as number[] }


type PadLike = {
  id: string
  mapping: string
  connected: boolean
  axes: readonly number[]
  buttons: readonly { pressed: boolean; value: number }[]
  vibrationActuator?: unknown
}

const prev: Partial<Record<ActionId, boolean>> = {}
let prevR1 = false

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** radyal olu bolge + egri; cikis -1..1 */
export function stick(x: number, y: number, dead: number, curve: 'dogrusal' | 'ustel'): [number, number] {
  const m = Math.hypot(x, y)
  if (m < dead) return [0, 0]
  let k = Math.min(1, (m - dead) / (1 - dead))
  if (curve === 'ustel') k = k ** 1.7
  return [(x / m) * k, (y / m) * k]
}

/** sag cubuk eksenleri: 6+ eksenli standart disi kolda 3,4 (2 ve 5 tetik), digerlerinde 2,3 */
function rightAxes(gp: PadLike, std: boolean): [number, number] {
  if (!std && gp.axes.length >= 6) return [3, 4]
  return [2, 3]
}

/** mantiksal dugmenin analog degeri 0..1 (tetiklerde eksen yedegi) */
function logicalValue(gp: PadLike, l: Logical, std: boolean, profile: keyof typeof PROFILE_BUTTONS): number {
  if (getSettings().dpadInvert) l = l === 'dup' ? 'ddown' : l === 'ddown' ? 'dup' : l
  const idx = PROFILE_BUTTONS[profile][l]
  if (l === 'dleft' || l === 'dright' || l === 'dup' || l === 'ddown') {
    if (idx !== undefined && gp.buttons[idx]) return gp.buttons[idx].pressed ? 1 : 0
    // standart disi: sapka ekseni 6 (x), 7 (y)
    if (!std && gp.axes.length >= 8) {
      const ax = gp.axes[6] ?? 0
      const ay = gp.axes[7] ?? 0
      return (l === 'dleft' && ax < -0.5) || (l === 'dright' && ax > 0.5) || (l === 'dup' && ay < -0.5) || (l === 'ddown' && ay > 0.5) ? 1 : 0
    }
    return 0
  }
  if (idx === undefined) return 0
  const b = gp.buttons[idx]
  if (b) {
    if (b.value > 0 && b.value < 1) return b.value
    if (b.pressed) return 1
  }
  // tetik dugmesi yoksa ya da basili degilse eksen yedegi (standart disi: L2 ekseni 2, R2 ekseni 5, -1..1)
  if (!std && gp.axes.length >= 6 && (l === 'l2' || l === 'r2')) {
    const v = gp.axes[l === 'l2' ? 2 : 5] ?? -1
    return clamp((v + 1) / 2, 0, 1)
  }
  return 0
}

function rawValue(gp: PadLike, r: RawBinding): number {
  if (r.t === 'b') {
    const b = gp.buttons[r.i]
    return b ? (b.value > 0 && b.value < 1 ? b.value : b.pressed ? 1 : 0) : 0
  }
  const v = gp.axes[r.i] ?? 0
  return clamp(v * r.dir, 0, 1)
}

/** test: kare onbellegini kapat */
export const padCache = { on: true }
let cacheT = -1e9
let cacheV: PadFrame | null = null
/** ilk bagli kol; yoksa null. Ayni karede (6 ms) birden cok cagri ayni sonucu (kenar olaylari dahil) alir:
 *  <PadPoll /> modtan bagimsiz her karede okur, MatchControl ayni kareyi paylasir. */
export function pollPad(): PadFrame | null {
  const t = typeof performance !== 'undefined' ? performance.now() : 0
  if (padCache.on && t - cacheT < 6) return cacheV
  cacheT = t
  cacheV = pollPadRaw()
  return cacheV
}

const NO_NAV = { up: false, down: false, left: false, right: false, ok: false, back: false, menu: false }
function emptyFrame(name: string): PadFrame {
  const z = () => Object.fromEntries(ACTIONS.map((a) => [a.id, false])) as Record<ActionId, boolean>
  return { name, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, held: z(), down: z(), up: z(), l1: false, r1: false, r1Down: false, analog: { l2: 0, r2: 0 }, nav: { ...NO_NAV } }
}

// ------------------------------------------------------------------ yon testi (dikey eksen isaretleri)
export type DirStep = 'left' | 'right' | 'dpad'
const dir = { step: null as DirStep | null, base: null as number[] | null, armed: false, msg: '', done: false }
const dirSubs = new Set<() => void>()
const dirNotify = () => dirSubs.forEach((f) => f())
export const getDirTest = () => ({ step: dir.step, msg: dir.msg, done: dir.done })
export function onDirTestChange(cb: () => void) {
  dirSubs.add(cb)
  return () => {
    dirSubs.delete(cb)
  }
}
const DIR_MSG: Record<DirStep, string> = { left: 'Sol çubuğu YUKARI it', right: 'Sağ çubuğu YUKARI it', dpad: 'D-pad YUKARI (↑) bas' }
export function startDirTest() {
  dir.step = 'left'
  dir.base = null
  dir.armed = false
  dir.done = false
  dir.msg = DIR_MSG.left
  dirNotify()
}
export function cancelDirTest() {
  dir.step = null
  dir.base = null
  dir.msg = ''
  dir.done = false
  dirNotify()
}
function dirNext(step: DirStep | null, msg = '') {
  dir.step = step
  dir.base = null
  dir.armed = false
  dir.msg = step ? DIR_MSG[step] : msg
  dir.done = step === null
  if (step === null) setSettings({ dirTested: true })
  dirNotify()
}
/** d-pad yukari/asagi FIZIKSEL raporu (ters cevirme uygulanmaz): -1 yukari, +1 asagi, 0 yok, null olculemez */
function dpadPhysicalY(gp: PadLike, std: boolean): number | null {
  if (std || gp.buttons.length >= 16) {
    if (gp.buttons[12]?.pressed) return -1
    if (gp.buttons[13]?.pressed) return 1
    return 0
  }
  if (gp.axes.length >= 8 && dir.base) {
    const v = (gp.axes[7] ?? 0) - (dir.base[7] ?? 0)
    return Math.abs(v) > 0.6 ? Math.sign(v) : 0
  }
  return null
}
/** yon testi adimi; true: bu kare oyun girdisi yutulsun */
function dirStep(gp: PadLike, std: boolean): boolean {
  if (!dir.step) return false
  if (!dir.base) dir.base = Array.from(gp.axes)
  const base = dir.base
  const [, ryA] = rightAxes(gp, std)
  const idx = dir.step === 'left' ? 1 : ryA
  if (dir.step === 'dpad') {
    const y = dpadPhysicalY(gp, std)
    if (y === null) {
      dirNext(null, 'D-pad bu kolda ölçülemedi (atlandı)')
      return true
    }
    if (!dir.armed) {
      if (y === 0) dir.armed = true
      return true
    }
    if (y !== 0) {
      // yukari basinca +1 (asagi) raporlandiysa ters
      setSettings({ dpadInvert: y > 0 })
      dirNext(null, y > 0 ? 'D-pad ↑/↓ çevrildi' : 'D-pad doğru')
    }
    return true
  }
  const d = (gp.axes[idx] ?? 0) - (base[idx] ?? 0)
  if (!dir.armed) {
    if (Math.abs(d) < 0.3) dir.armed = true
    return true
  }
  if (Math.abs(d) > 0.6) {
    // yukari itince ham deger NEGATIF olmali; pozitifse ters
    if (dir.step === 'left') setSettings({ invertL: d > 0 })
    else setSettings({ invertY: d > 0 })
    dirNext(dir.step === 'left' ? 'right' : 'dpad')
  }
  return true
}

function pollPadRaw(): PadFrame | null {
  const gps = (navigator.getGamepads?.() ?? []) as (PadLike | null)[]
  const gp = gps.find((g) => g && g.connected) ?? null
  if (!gp) {
    if (getPadInfo().connected) setPadInfo({ connected: false, name: '', profile: 'standard', ps: false, needsLearn: false })
    return null
  }
  const pi = detectProfile(gp)
  setPadInfo(pi)
  setActuator((gp.vibrationActuator as never) ?? null)
  const std = pi.profile === 'standard'
  const S = getSettings()
  // atama sihirbazi ya da yon testi acikken oyun girdisi yutulur
  const swallowDir = dirStep(gp, std)
  if (learnStep(gp.buttons, gp.axes) || swallowDir) {
    for (const a of ACTIONS) prev[a.id] = true
    prevR1 = true
    return emptyFrame(pi.name)
  }
  const [mx, my] = stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0, S.deadL, S.curve)
  const [rxA, ryA] = rightAxes(gp, std)
  const [lx, ly] = stick(gp.axes[rxA] ?? 0, gp.axes[ryA] ?? 0, S.deadR, S.curve)
  // ham eksen: yukari itince NEGATIF; hareket y yukari +. invertL aygit tersse duzeltir
  const moveY = (S.invertL ? 1 : -1) * my
  const held = {} as Record<ActionId, boolean>
  const down = {} as Record<ActionId, boolean>
  const up = {} as Record<ActionId, boolean>
  const analog = { l2: logicalValue(gp, 'l2', std, pi.profile), r2: logicalValue(gp, 'r2', std, pi.profile) }
  for (const a of ACTIONS) {
    const b = S.bindings[a.id]
    const dl = defaultOf(a, S.preset)
    const v = b ? rawValue(gp, b) : dl ? logicalValue(gp, dl, std, pi.profile) : 0
    // analog tetiklerde esik ayari, dugmelerde 0.5
    const isTrig = !b && (dl === 'l2' || dl === 'r2')
    const h = v > (isTrig ? S.trigger : 0.5)
    held[a.id] = h
    down[a.id] = h && !prev[a.id]
    up[a.id] = !h && !!prev[a.id]
    prev[a.id] = h
  }
  const r1 = logicalValue(gp, 'r1', std, pi.profile) > 0.5
  const l1 = logicalValue(gp, 'l1', std, pi.profile) > 0.5
  const r1Down = r1 && !prevR1
  prevR1 = r1
  const lookY = S.invertY ? ly : -ly // y yukari +
  const dv = (l: Logical) => logicalValue(gp, l, std, pi.profile) > 0.5
  const dpadY = dv('dup') ? 1 : dv('ddown') ? -1 : 0
  const dpadX = dv('dright') ? 1 : dv('dleft') ? -1 : 0
  padLive.move.x = mx
  padLive.move.y = moveY
  padLive.look.x = lx
  padLive.look.y = lookY
  padLive.dpad.x = dpadX
  padLive.dpad.y = dpadY
  padLive.raw = Array.from(gp.axes)
  return {
    name: pi.name,
    move: { x: mx, y: moveY },
    look: { x: lx, y: lookY },
    nav: {
      up: dpadY > 0 || moveY > 0.6,
      down: dpadY < 0 || moveY < -0.6,
      left: dpadX < 0 || mx < -0.6,
      right: dpadX > 0 || mx > 0.6,
      ok: dv('cross'),
      back: dv('circle'),
      menu: dv('options'),
    },
    held,
    down,
    up,
    l1,
    r1,
    r1Down,
    analog,
  }
}

let rumbleInstalled = false
/** oyun olaylarina titresim bagla (bir kez) */
export function installRumble() {
  if (rumbleInstalled) return
  rumbleInstalled = true
  game.on((e) => {
    if (e.type === 'touch') {
      const p = game.players[e.player]
      if (p?.controlled && (e.kind === 'shoot' || e.kind === 'lob')) rumble('sut')
      if (p?.controlled && e.kind === 'save') rumble('kurtaris')
    } else if (e.type === 'goal') rumble('gol')
    else if (e.type === 'foul') rumble('faul')
    else if (e.type === 'card') rumble('kart')
  })
}
