// Kol ile menu gezinme (tum arayuz katmanlari) + yon testi onerisi.
// Kol bagliyken bir menu/katman aciksa: D-pad ya da sol cubuk odagi uzamsal en yakin ogeye tasir, X tiklar, O geri (Esc),
// Options menu kapatir/Oyna, kaydiricida sol/sag deger degistirir. Menu yokken pasif (oyun girdisini calmaz).
// Katman = '.gps-overlay', '.mp-overlay', '.boot', '[data-pad-layer]' ya da kalite onerisi. Gorunur odak: [data-pad-focus].
import { useEffect, useState } from 'react'
import { pollPad, type PadFrame } from '../control/gamepad'
import { getPadInfo, getSettings, onPadChange, onSettingsChange } from '../control/gamepadConfig'
import { ctl } from '../control/store'
import { setScreen } from '../mp/session'
import { openGamepadSettings } from './gamepadUi'

const LAYERS = ['.mp-overlay', '[data-pad-layer]']
const OWN = '.boot, .mm-root, .gps-overlay'
const FOCUSABLE = 'button:not([disabled]), [role="button"]:not([aria-disabled="true"]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

let layerOpen = false
/** menu/katman acik mi: oyun girdisi kapatilmali (MatchControl bunu okur) */
export const padNavLayerOpen = () => layerOpen

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  const st = getComputedStyle(el)
  return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0'
}

/** en ustteki katman koku (sirayla ilk bulunan; modal oldugu icin tek katman beklenir) */
function layerRoot(): HTMLElement | null {
  for (const sel of LAYERS) {
    // yukleme, ana menu ve kol ayarlari kendi gezinmesini (M2 menuNav) yapar: burada devre disi
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((e) => visible(e) && !e.closest(OWN) && !e.querySelector(OWN))
    if (els.length) return els[els.length - 1]
  }
  return null
}

const items = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible)

function setFocus(el: HTMLElement) {
  document.querySelectorAll('[data-pad-focus]').forEach((n) => n.removeAttribute('data-pad-focus'))
  el.setAttribute('data-pad-focus', '1')
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

type Dir = 'up' | 'down' | 'left' | 'right'
/** uzamsal en yakin oge: yon dogrultusundaki merkez farki + yan sapma cezasi */
export function pickNext(cur: HTMLElement, all: HTMLElement[], dir: Dir): HTMLElement | null {
  const c = cur.getBoundingClientRect()
  const cx = c.left + c.width / 2
  const cy = c.top + c.height / 2
  let best: HTMLElement | null = null
  let bs = Infinity
  for (const el of all) {
    if (el === cur) continue
    const r = el.getBoundingClientRect()
    const dx = r.left + r.width / 2 - cx
    const dy = r.top + r.height / 2 - cy
    const main = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx
    const side = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy)
    if (main < 4) continue
    const sc = main + 2.2 * side
    if (sc < bs) {
      bs = sc
      best = el
    }
  }
  return best
}

function adjustRange(el: HTMLInputElement, sign: 1 | -1) {
  const min = Number(el.min || 0)
  const max = Number(el.max || 100)
  const step = Number(el.step) > 0 ? Number(el.step) : (max - min) / 20
  const v = Math.max(min, Math.min(max, Number(el.value) + sign * step))
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  set?.call(el, String(v)) // React'in izledigi setter
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function pressBack(root: HTMLElement) {
  const close = root.querySelector<HTMLElement>('.gps-close, [aria-label="Kapat"], [data-pad-back]')
  if (close) return close.click()
  const ev = () => new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
  window.dispatchEvent(ev())
}

const REPEAT_FIRST = 350
const REPEAT_EVERY = 120

export function PadNav() {
  useEffect(() => {
    let raf = 0
    let lastRoot: HTMLElement | null = null
    const prev: Record<string, boolean> = {}
    const heldSince: Record<string, number> = {}
    const lastFire: Record<string, number> = {}

    // tus tekrari: ilk basista hemen, 0.35 s sonra 0.12 s aralikla
    const fire = (k: string, on: boolean, t: number): boolean => {
      if (!on) {
        prev[k] = false
        return false
      }
      if (!prev[k]) {
        prev[k] = true
        heldSince[k] = t
        lastFire[k] = t
        return true
      }
      if (t - heldSince[k] > REPEAT_FIRST && t - lastFire[k] > REPEAT_EVERY) {
        lastFire[k] = t
        return true
      }
      return false
    }

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      const f: PadFrame | null = pollPad()
      const root = f ? layerRoot() : null
      layerOpen = !!root
      if (!f) {
        lastRoot = null
        return
      }
      if (!root) {
        lastRoot = null
        // menu yok: antrenmanda Options menuyu acar (macta MatchControl acar)
        if (fire('menu', f.nav.menu, t) && ctl.mode === 'antrenman') setScreen('menu')
        for (const k of ['up', 'down', 'left', 'right', 'ok', 'back']) fire(k, false, t)
        return
      }
      const all = items(root)
      // katman yeni acildi ya da odak kayboldu: ilk (ya da otofokus) ogeye
      let cur = (document.activeElement as HTMLElement | null) ?? null
      if (!cur || !root.contains(cur) || !all.includes(cur)) {
        const first = root.querySelector<HTMLElement>('[autofocus], .boot-play, [data-pad-default]') ?? all[0]
        if (first && (root !== lastRoot || !cur || !root.contains(cur))) {
          setFocus(first)
          cur = first
        }
      }
      const fresh = root !== lastRoot
      lastRoot = root
      if (fresh) {
        // katman yeni acildi: o an basili tuslar yutulur (acan tus ilk ogeyi tiklamasin)
        for (const k of ['up', 'down', 'left', 'right', 'ok', 'back', 'menu'] as const) {
          prev[k] = f.nav[k]
          heldSince[k] = t
          lastFire[k] = t
        }
        return
      }
      // ilk basista hemen basili olanlari yut (acan tus menuyu aninda tetiklemesin)
      const up = fire('up', f.nav.up, t)
      const down = fire('down', f.nav.down, t)
      const left = fire('left', f.nav.left, t)
      const right = fire('right', f.nav.right, t)
      const ok = fire('ok', f.nav.ok, t)
      const back = fire('back', f.nav.back, t)
      const menu = fire('menu', f.nav.menu, t)
      if (!cur) return
      const isRange = cur instanceof HTMLInputElement && cur.type === 'range'
      const mv: Dir | null = up ? 'up' : down ? 'down' : isRange ? null : left ? 'left' : right ? 'right' : null
      if (isRange && (left || right)) adjustRange(cur as HTMLInputElement, left ? -1 : 1)
      else if (mv) {
        const n = pickNext(cur, all, mv)
        if (n) setFocus(n)
      }
      if (ok && !isRange) {
        if (root.matches('.boot') && !cur.matches('button')) root.querySelector<HTMLElement>('.boot-play')?.click()
        else cur.click()
      }
      if (back) pressBack(root)
      if (menu) {
        // yukleme ekraninda Oyna; digerlerinde menuyu kapat
        const play = root.matches('.boot') ? root.querySelector<HTMLElement>('.boot-play') : null
        if (play) play.click()
        else pressBack(root)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      layerOpen = false
    }
  }, [])
  return null
}

const SEEN = 'gamepadDirNotice'
/** ilk baglanista (standart disi ya da taninmayan kol) bir kez 'Yon testi' onerisi */
export function PadNotice() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const check = () => {
      const i = getPadInfo()
      let seen = false
      try {
        seen = !!localStorage.getItem(SEEN)
      } catch {
        /* depolama kapali */
      }
      if (i.connected && !seen && !getSettings().dirTested && (i.profile !== 'standard' || i.needsLearn)) setShow(true)
      else if (!i.connected) setShow(false)
    }
    const u1 = onPadChange(check)
    const u2 = onSettingsChange(check)
    return () => {
      u1()
      u2()
    }
  }, [])
  if (!show) return null
  const dismiss = () => {
    try {
      localStorage.setItem(SEEN, '1')
    } catch {
      /* depolama kapali */
    }
    setShow(false)
  }
  return (
    <div className="hud pad-notice" data-pad-layer style={{ position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 30, pointerEvents: 'auto' }}>
      <div className="panel" role="status">
        <span className="title">Kol algılandı</span>
        <div>Dikey yönler ters olabilir. Hızlı yön testi yapalım mı?</div>
        <div className="row">
          <button
            className="primary"
            data-pad-default
            onClick={() => {
              dismiss()
              openGamepadSettings()
              window.dispatchEvent(new CustomEvent('pad-dir-test'))
            }}
          >
            Şimdi test et
          </button>
          <button onClick={dismiss}>Atla</button>
        </div>
      </div>
    </div>
  )
}
