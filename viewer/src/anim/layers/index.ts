// Katman siralayici: Characters.tsx her karede rig.apply(pose)'dan sonra runLayers(ctx) cagirir.
import { fallLayer } from './fall'
import { keeperLayer } from './keeper'
import { kickLayer } from './kick'
import { locoLayer } from './loco'
import { passLayer } from './pass'
import { rabonaLayer } from './rabona'
import { tackleLayer } from './tackle'
import type { Layer, LayerCtx } from './types'

export type { LayerCtx } from './types'

// sira: her katman yalniz kendi aksiyonunda is yapar; sira yalnizca ayni kareye birden cok katman dokunursa onem tasir
const LAYERS: Layer[] = [locoLayer, kickLayer, passLayer, tackleLayer, fallLayer, keeperLayer, rabonaLayer]

export function runLayers(ctx: LayerCtx) {
  for (const l of LAYERS) l(ctx)
}

/** gelistirme rozeti: yalniz localhost ya da ?dbg=1 (yayinda gorunmez). Katman durumlarini gosterir. */
export function installBadge() {
  if (typeof location === 'undefined') return
  if (!(['localhost', '127.0.0.1'].includes(location.hostname) || new URLSearchParams(location.search).get('dbg') === '1')) return
  const mk = () => {
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:#111d;color:#8f8;font:11px monospace;padding:4px 8px;border-radius:4px;pointer-events:none;white-space:pre'
    document.body.appendChild(el)
    setInterval(() => {
      const all = (globalThis as unknown as { __layers?: Record<string, { loaded: boolean; frames: number }> }).__layers ?? {}
      el.textContent = 'katmanlar v4 | ' + Object.entries(all).map(([k, v]) => `${k}:${v.loaded ? 'OK' : 'yok'}/${v.frames}`).join('  ')
    }, 500)
  }
  if (document.body) mk()
  else addEventListener('DOMContentLoaded', mk)
}
