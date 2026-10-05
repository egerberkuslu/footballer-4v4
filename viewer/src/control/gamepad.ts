// Gamepad okuma: profil algilama, olu bolge, egri, analog tetik, atanmis dugmeler, kenar (basma/birakma) olaylari.
// MatchControl yalniz pollPad() cagirir. Ayar/atama: gamepadConfig.ts.
import { game } from '../game/store'
import {
  ACTIONS,
  PROFILE_BUTTONS,
  detectProfile,
  getPadInfo,
  getSettings,
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
}

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
  // atama sihirbazi acikken girdi yutulur
  if (learnStep(gp.buttons, gp.axes)) {
    for (const a of ACTIONS) prev[a.id] = true
    prevR1 = true
    return {
      name: pi.name,
      move: { x: 0, y: 0 },
      look: { x: 0, y: 0 },
      held: Object.fromEntries(ACTIONS.map((a) => [a.id, false])) as Record<ActionId, boolean>,
      down: Object.fromEntries(ACTIONS.map((a) => [a.id, false])) as Record<ActionId, boolean>,
      up: Object.fromEntries(ACTIONS.map((a) => [a.id, false])) as Record<ActionId, boolean>,
      l1: false,
      r1: false,
      r1Down: false,
      analog: { l2: 0, r2: 0 },
    }
  }
  const [mx, my] = stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0, S.deadL, S.curve)
  const [rxA, ryA] = rightAxes(gp, std)
  const [lx, ly] = stick(gp.axes[rxA] ?? 0, gp.axes[ryA] ?? 0, S.deadR, S.curve)
  const held = {} as Record<ActionId, boolean>
  const down = {} as Record<ActionId, boolean>
  const up = {} as Record<ActionId, boolean>
  const analog = { l2: logicalValue(gp, 'l2', std, pi.profile), r2: logicalValue(gp, 'r2', std, pi.profile) }
  for (const a of ACTIONS) {
    const b = S.bindings[a.id]
    const v = b ? rawValue(gp, b) : logicalValue(gp, a.varsayilan, std, pi.profile)
    // analog tetiklerde esik ayari, dugmelerde 0.5
    const isTrig = !b && (a.varsayilan === 'l2' || a.varsayilan === 'r2')
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
  return {
    name: pi.name,
    move: { x: mx, y: my },
    look: { x: lx, y: S.invertY ? ly : -ly }, // y yukari +
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
