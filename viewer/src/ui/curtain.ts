// Gecis perdesi (M): mod degisimi ve oda girisi gibi ani donmalari perdenin arkasina alir.
//   import { withCurtain } from './ui/curtain'
//   withCurtain(() => setMode('mac'), 'Maç hazırlanıyor')
// Akis: perde kararir (~0,2 s) -> fn -> yeni sahne parcalari on isitilir, kareler oturur -> perde acilir.
import { boot, bumpBoot } from './boot'
import { rewarm } from './Warmup'

export const CURTAIN_IN_MS = 200
/** perde en fazla bu kadar iner kalir; kalan isitma arka planda surer */
export const CURTAIN_MAX_MS = 2500

const paint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

let busy = false

export async function withCurtain(fn: () => void | Promise<void>, label = 'Hazırlanıyor'): Promise<void> {
  // yukleme ekrani acikken ya da perde zaten inikken dogrudan uygula
  if (busy || boot.phase !== 'play') {
    await fn()
    return
  }
  busy = true
  boot.curtain = true
  boot.curtainLabel = label
  bumpBoot()
  try {
    await new Promise((r) => setTimeout(r, CURTAIN_IN_MS + 30))
    await paint()
    const t0 = performance.now()
    await fn()
    // kesin ust sinir: isitma bitmese de perde kalkar (kullanici kilitlenmez)
    const left = Math.max(300, CURTAIN_MAX_MS - (performance.now() - t0))
    await Promise.race([rewarm(left).catch(() => {}), new Promise((r) => setTimeout(r, left))])
  } finally {
    boot.curtain = false
    bumpBoot()
    busy = false
  }
}
