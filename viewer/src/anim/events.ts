// Animasyondan okunur olaylar (I yazar, F okur). Mantik yok; yalniz zamanlama bilgisi.
// footTiming[id].l / .r: o ayagin salinim sonuna (one inip topa degebilecegi ana) kalan sure (s).
// Surmede dokunusu bu ana denk getirirsen ayak topa tam degmis gorunur.
export interface FootTiming {
  l: number
  r: number
}

export const footTiming: FootTiming[] = Array.from({ length: 16 }, () => ({ l: 9, r: 9 }))
