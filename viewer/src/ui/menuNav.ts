// Menu gezinmesi (M2): klavye + kol (D-pad / sol cubuk, ✕ onay, ○ geri) ve kol glifleri.
import { useEffect, useRef, useState } from 'react'
import { onPadChange, type PadInfo } from '../control/gamepadConfig'
import { settingsPanelOpen } from './gamepadUi'

export type NavKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back'

export function usePad(): PadInfo {
  const [p, setP] = useState<PadInfo>({ connected: false, name: '', profile: 'standard', ps: false, needsLearn: false })
  useEffect(() => onPadChange((i) => setP({ ...i })), [])
  return p
}
export const okLabel = (p: PadInfo) => (p.connected ? (p.ps ? '✕' : 'A') : 'Enter')
export const backLabel = (p: PadInfo) => (p.connected ? (p.ps ? '○' : 'B') : 'Esc')
export const padLabelsOn = (p: PadInfo) => p.connected

const KEYS: Record<string, NavKey> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Escape: 'back', Backspace: 'back' }

/** klavye ve kol olaylarini NavKey'e cevirir; menu acikken oyun tuslari yutulur (F3 haric, metin kutusunda yazim serbest) */
export function useNav(on: (k: NavKey) => void, active = true) {
  const cb = useRef(on)
  cb.current = on
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (settingsPanelOpen() || e.key === 'F3' || e.key === '`' || e.ctrlKey || e.metaKey || e.altKey) return
      const k = KEYS[e.key]
      const input = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (input && !(k === 'up' || k === 'down' || k === 'back')) return
      e.stopImmediatePropagation()
      if (!k || e.repeat && (k === 'ok' || k === 'back')) return
      if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName === 'BUTTON') return // dugme kendi tiklamasini yapar
      e.preventDefault()
      cb.current(k)
    }
    window.addEventListener('keydown', onKey, true)
    // kol: kenar algilama + tutunca tekrar
    let raf = 0
    const prev: Record<string, boolean> = {}
    const heldAt: Record<string, number> = {}
    let primed = false
    const poll = () => {
      raf = requestAnimationFrame(poll)
      const gp = (navigator.getGamepads?.() ?? []).find((g) => g && g.connected)
      if (!gp) return
      const b = (i: number) => !!gp.buttons[i]?.pressed
      const ax = gp.axes[0] ?? 0
      const ay = gp.axes[1] ?? 0
      const now: Record<NavKey, boolean> = {
        up: b(12) || ay < -0.6,
        down: b(13) || ay > 0.6,
        left: b(14) || ax < -0.6,
        right: b(15) || ax > 0.6,
        ok: b(0),
        back: b(1),
      }
      const t = performance.now()
      for (const k of Object.keys(now) as NavKey[]) {
        const rep = k !== 'ok' && k !== 'back'
        let fire = false
        if (now[k]) {
          if (!prev[k]) {
            fire = primed // acilista basili olan tus (ör. Oyna'ya basis) tetiklemez
            heldAt[k] = t + 380
          } else if (rep && t >= heldAt[k]) {
            fire = true
            heldAt[k] = t + 150
          }
        }
        prev[k] = now[k]
        if (fire && !settingsPanelOpen()) cb.current(k)
      }
      primed = true
    }
    raf = requestAnimationFrame(poll)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      cancelAnimationFrame(raf)
    }
  }, [active])
}
