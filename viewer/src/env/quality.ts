// Kalite seviyesi: ?q=low|med|high (varsayilan high; RTX 3060 1080p ~60 fps hedefi)
//  low : son isleme yok, 2048 golge haritasi, dpr 1
//  med : AO yok, bloom + renk, 4096 golge
//  high: N8AO (yarim cozunurluk) dahil tum zincir
const params = new URLSearchParams(location.search)
// ?q= verilmediyse kullanicinin 'Dusuk kaliteye gec' secimi (localStorage) gecerli olur
let stored: string | null = null
try {
  stored = localStorage.getItem('kalite')
} catch {
  /* tarayici depolamasi kapali */
}
const raw = params.get('q') ?? stored
export type Quality = 'low' | 'med' | 'high'
export const QUALITY: Quality = raw === 'low' || raw === 'med' ? raw : 'high'
export const SHADOW_SIZE = QUALITY === 'low' ? 2048 : 4096
export const DPR: [number, number] = QUALITY === 'low' ? [1, 1] : [1, 1.5]

// Kullanici secimini kaydedip sayfayi yeniden yukler (kalite sabitleri modul yuklenirken okunur)
export function setQuality(q: Quality) {
  try {
    localStorage.setItem('kalite', q)
  } catch {
    /* kaydedilemezse URL parametresi yine de uygulanir */
  }
  const u = new URL(location.href)
  u.searchParams.set('q', q)
  location.href = u.toString()
}
