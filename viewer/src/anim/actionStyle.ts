// Aksiyon animasyon cesidi (rabona ajani): control/locomotion.ts aksiyon basinda yazar, animasyon katmanlari (layers/pass.ts,
// layers/rabona.ts) okur. Yalniz gorsel secim icindir; simulasyon/fizik bunu OKUMAZ.
// Degerler: 'ground' (yerden pas), 'driven' (sert pas), 'through' (ara pas), 'lob' (havadan pas), 'shoot', 'rabona-*'.
// Cok oyunculu istemcide (sim yok) bos kalir: katmanlar varsayilan secime duser.
export const actionStyle: string[] = []
