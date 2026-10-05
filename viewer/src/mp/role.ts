// Cok oyunculu rol bayraklari (L). Bagimliliksiz; F (MatchControl/App) ve J (AI) ucuzca okuyabilsin.
//   role 'off'  : tek oyunculu / antrenman (varsayilan, mevcut davranis)
//   role 'host' : simulasyonun tamamini bu tarayici kosar (AI + kurallar + locomotion)
//   role 'guest': yalniz girdi gonderir; durum host'tan gelir (AI, kurallar, locomotion KOSMAZ)
export type NetRole = 'off' | 'host' | 'guest'

/** HMR'de modul yeniden calissa da oturum durumu korunsun (diger ajanlarin duzenlemeleri odayi dusurmesin) */
export function keep<T>(key: string, init: () => T): T {
  const g = globalThis as unknown as { __mpKeep?: Record<string, unknown> }
  const s = (g.__mpKeep ??= {})
  return (s[key] ??= init()) as T
}

export const net = keep('net', () => ({
  role: 'off' as NetRole,
  /** bu tarayicidaki insanin oyuncusu (-1: izleyici ya da tek oyunculu) */
  localPlayer: -1,
  /** uzak insanlarin oyunculari (host'ta): AI bunlara girdi yazmamali */
  remote: new Set<number>(),
}))

export const netRole = (): NetRole => net.role
export const isGuest = () => net.role === 'guest'
export const isHost = () => net.role === 'host'
/** cok oyunculuda insan kontrolu sabit oyuncuya kilitli (otomatik/Q degisimi yok); -1 = kilit yok */
export const lockedPlayer = () => (net.role === 'off' ? -1 : net.localPlayer)
/** host'ta: bu oyuncu uzak bir insanin mi (AI atlamali) */
export const isRemoteHuman = (id: number) => net.remote.has(id)
