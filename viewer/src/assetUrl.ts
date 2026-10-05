// Varlik yollari: GitHub Pages alt yolda (https://kullanici.github.io/depo/) servis eder.
// '/futbolcu.glb' gibi mutlak yol alt yolda 404 verir; bunun yerine asset('futbolcu.glb') kullan.
export const asset = (path: string): string => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
