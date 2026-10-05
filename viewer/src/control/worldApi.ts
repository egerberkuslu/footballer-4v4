// B'nin world API'si icin ince katman (kick / placeBall / onEvent / setDynamicColliders).
import { world, type DynCollider, type SimEvent } from '../sim'

type V3 = { x: number; y: number; z: number }

export const placeBall = (x: number, z: number) => world.placeBall(x, z)
export const kick = (v: V3, w: V3) => world.kick(v, w)
export const onWorldEvent = (fn: (e: SimEvent) => void) => world.onEvent(fn)
export const setColliders = (list: DynCollider[]) => world.setDynamicColliders(list)

// eski adlar (gecis): ShotController guncellenene dek
export const hasNativeEvents = () => true
export const onEvent = (fn: (e: SimEvent['type']) => void) => world.onEvent((e) => fn(e.type))
