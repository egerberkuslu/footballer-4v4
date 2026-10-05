// Takim yapay zekasi bileseni: useFrame onceligi -25 (insan girdisinden sonra, kurallardan once).
import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { game } from '../game/store'
import { world } from '../sim'
import { updateAI, aiStats } from './brain'
import { watchMode } from './config'

/** ?watch=1: iki takim da yapay zeka (insan kontrolu yok) */
export function applyWatchMode() {
  if (!watchMode) return
  game.humanTeam = null
  for (const p of game.players) p.controlled = false
}

export function TeamAI() {
  useEffect(() => {
    applyWatchMode()
    Object.assign(window, { __ai: aiStats })
  }, [])
  useFrame((_, dt) => updateAI(Math.min(dt, 1 / 30) * world.timeScale), -25)
  return null
}
