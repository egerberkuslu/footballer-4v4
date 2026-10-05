// Ag esitleme bileseni (L): Canvas ICINE takilir. Tek oyunculuda hicbir sey yapmaz.
//   -29 misafir girdi+tahmin · -22 host uzak girdiler · -14 misafir durum yazimi · -0.4 host snapshot
import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { startBackgroundTick } from './bgTick'
import { setControlled } from '../control/locomotion'
import { ctl } from '../control/store'
import { game } from '../game/store'
import { net } from './role'
import { guestSend, hostRemotes, hostSendSnap, hostVarWatch, mp } from './session'
import { guestApplyFrame, guestInputFrame, hostApplyInputs, hostSnapshot } from './sync'

const live = () => mp.inMatch && ctl.mode === 'mac'

// insan kontrolu yerel oyuncuya kilitli: F'nin otomatik devri baska oyuncuya gecirdiyse girdiyi geri tasi
function holdLock() {
  const lp = net.localPlayer
  if (lp < 0) return
  const cur = game.controlledPlayer()
  if (cur && cur.id !== lp) {
    const a = game.inputs[cur.id]
    const b = game.inputs[lp]
    b.move.x = a.move.x
    b.move.z = a.move.z
    b.sprint = a.sprint
    if (a.action) b.action = a.action
    a.move.x = a.move.z = 0
    a.sprint = false
    a.action = null
  }
  if (!cur || cur.id !== lp) setControlled(lp)
}

export function NetSync() {
  // host sekmesi gizliyken simulasyon Worker tik'iyle surer (render yok)
  const get = useThree((s) => s.get)
  useEffect(() => startBackgroundTick(get, () => net.role === 'host' && live()), [get])
  useFrame(() => {
    if (net.role !== 'off' && live()) holdLock()
  }, -29.5)
  useFrame((_, dt) => {
    if (net.role === 'guest' && live()) guestInputFrame(dt, guestSend)
  }, -29)
  useFrame(() => {
    if (net.role === 'host' && live()) hostApplyInputs(hostRemotes())
  }, -22)
  useFrame((_, dt) => {
    if (net.role === 'guest' && live()) guestApplyFrame(Math.min(dt, 0.1))
  }, -14)
  useFrame((_, dt) => {
    if (net.role !== 'host' || !live()) return
    const body = hostSnapshot(Math.min(dt, 0.1))
    if (body) hostSendSnap(body)
    hostVarWatch()
  }, -0.4)
  return null
}
