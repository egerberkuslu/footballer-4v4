// Kural motorunu kare dongusune baglar: -20 (on: duran top girdileri), -0.5 (son: karar, saat, hakem).
// Mount olunca yeni mac baslar (F: mac moduna gecis). Sesleri oyun olaylarindan tetikler.
import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { game } from '../game/store'
import { world } from '../sim'
import { sfx } from './audio'
import { currentRules } from './instance'

const realDt = (dt: number) => Math.min(dt, 1 / 30)
// duran top zamanlayicilari ve VAR hakemi icin gercek zaman (yavas karede de kilit kalmasin)
const wallDt = (dt: number) => Math.min(dt, 0.25)

// HMR'de bilesen yeniden takilinca mac sifirlanmasin: sokme kalici ise (bir sonraki mount'a dek) mac biter
let mounted = 0

export function Rules() {
  useFrame((_, dt) => currentRules().pre(realDt(dt) * world.timeScale, wallDt(dt)), -20)
  useFrame((_, dt) => currentRules().post(realDt(dt) * world.timeScale, wallDt(dt)), -0.5)

  useEffect(() => {
    mounted++
    const r = currentRules()
    if (!r.started) r.start()
    sfx.arm()
    const off = game.on((e) => {
      switch (e.type) {
        case 'whistle':
          sfx.whistle(e.reason)
          if (e.reason === 'foul' || e.reason === 'penalty') sfx.murmur()
          break
        case 'touch': {
          if (e.kind === 'dribble' || e.kind === 'trap') break
          const b = world.ball
          sfx.kick(Math.max(0.4, Math.hypot(b.vx, b.vy, b.vz) / 30))
          break
        }
        case 'goal':
          sfx.net()
          sfx.roar(1)
          break
      }
    })
    return () => {
      off()
      mounted--
      // antrenmana gecis: bir sonraki maca geciste yeni mac
      setTimeout(() => {
        if (mounted === 0) currentRules().started = false
      }, 0)
    }
  }, [])
  return null
}
