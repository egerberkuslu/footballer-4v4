import { useSyncExternalStore } from 'react'
import { ctl, ctlVersion, subscribeCtl, type PlayMode } from './store'

/** antrenman/mac modu (React). Mod degisince yeniden cizer. */
export function usePlayMode(): PlayMode {
  useSyncExternalStore(subscribeCtl, ctlVersion)
  return ctl.mode
}
