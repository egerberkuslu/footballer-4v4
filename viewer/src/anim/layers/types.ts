// Animasyon katmanlari: parametrik poz (RigDriver.apply) uygulandiktan SONRA, her kare sirayla calisir (layers/index.ts).
// Her katman yalniz kendi dosyasina dokunur; ctx.name (oyun anim adi) kendi aksiyonu degilse hemen doner.
import type { RigDriver } from '../rig'
import type { Animator, BallLocal } from '../animator'

export interface LayerCtx {
  rig: RigDriver
  anim: Animator
  /** karakter basina kalici durum: her katman kendi anahtariyla saklar (layerState) */
  st: Record<string, unknown>
  id: number // oyuncu id (hakem / test sayfasinda -1)
  name: string // oyun anim adi: idle jog run sprint dribble kick pass tackle slide fall getup header keeper-* ...
  animT: number // aksiyonun basindan beri saniye (kaleci dalisinda faz)
  hasBall: boolean
  lvx: number // karakter uzayi hiz (m/s): x sol +
  lvz: number // ileri +
  gdt: number // oyun zamani adimi (s)
  ball: BallLocal // top, karakter uzayi (x sol, y yukseklik, z ileri)
}

export type Layer = (ctx: LayerCtx) => void

/** karakter basina katman durumu: yoksa init ile olusturur */
export function layerState<T>(ctx: LayerCtx, key: string, init: () => T): T {
  return ((ctx.st[key] as T | undefined) ?? (ctx.st[key] = init())) as T
}
