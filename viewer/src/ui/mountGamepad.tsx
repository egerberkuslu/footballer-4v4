// Kol Ayarlari kendi React kokunde calisir: App'e dokunmadan, ilk acista tembel yuklenir.
import { createRoot } from 'react-dom/client'
import { GamepadSettingsHost } from './GamepadSettings'

let mounted = false
export function ensureGamepadSettingsMounted() {
  if (mounted) return
  mounted = true
  const el = document.createElement('div')
  el.id = 'gps-root'
  document.body.appendChild(el)
  createRoot(el).render(<GamepadSettingsHost />)
}
