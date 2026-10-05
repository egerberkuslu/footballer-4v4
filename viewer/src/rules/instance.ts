// Tarayicidaki tekil kural motoru: gercek game, world topu ve F'nin world/locomotion arayuzu.
import { setControlled } from '../control/locomotion'
import { kick, placeBall } from '../control/worldApi'
import { game } from '../game/store'
import { world } from '../sim'
import { VAR_MONITOR } from '../var/monitor'
import { varState } from '../var/store'
import { Rules } from './engine'

// ?half=<dakika> devre suresi (varsayilan 3 dk)
function halfFromQuery(): number {
  try {
    const v = Number(new URLSearchParams(window.location.search).get('half'))
    if (Number.isFinite(v) && v > 0) return v * 60
  } catch {
    /* bassiz */
  }
  return 180
}

// HMR: bagimliliklardan biri degisince bu modul yeniden calisir ve yeni motor kurulur. Kare donguleri ve
// HUD her seferinde currentRules() ile EN YENI motoru okur; yeni motor eskinin durumunu devralir, eskisi susar.
const reg = globalThis as unknown as { __kRules?: Rules; __rulesN?: number }
const prev = reg.__kRules

export const rules = new Rules({
  game,
  ball: () => world.ball,
  placeBall,
  kick,
  setControlled,
  varMonitor: () => VAR_MONITOR, // G: kenar cizgisi disi, orta saha hizasi
  paused: () => varState.active,
  releaseHold: () => world.holdBall(false),
  halfLength: halfFromQuery(),
})
if (prev && prev !== rules) {
  rules.adopt(prev)
  prev.dispose()
}
reg.__kRules = rules
reg.__rulesN = (reg.__rulesN ?? 0) + 1

/** her zaman en yeni motor (HMR guvenli) */
export const currentRules = (): Rules => reg.__kRules ?? rules

// ayiklama/bassiz test icin canli ornege erisim
if (typeof window !== 'undefined') Object.assign(window, { __rules: rules, __game: game, __world: world })
