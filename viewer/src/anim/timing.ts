// Klip sureleri ve temas anlari (s). F/K bu degerleri okuyabilir: ornegin sut animasyonu
// basladiktan kickContact sonra world.kick cagrilirsa ayak topa tam o anda degmis gorunur.
export const CLIP_LEN = {
  kick: 0.75,
  kickContact: 0.28,
  pass: 0.55,
  passContact: 0.22,
  rabona: 0.75, // arapas: sutla ayni sure ve temas (fizik hatti ayni)
  rabonaContact: 0.28,
  tackle: 0.7,
  tackleContact: 0.22,
  slide: 0.8, // sonra oturur kalir; kalkis 'getup' (1.0 s, oturustan)
  slideContact: 0.25,
  fall: 1.0, // sonra yuzustu kalir; kalkmak icin anim = 'getup'
  getup: 1.1,
  header: 0.6,
  headerContact: 0.38,
  diveFlight: 0.4, // kaleci yatay en uzak ana
  dive: 1.2, // sonra yerde kalir
  catch: 0.6,
  throwin: 1.0,
  whistle: 1.1,
  point: 1.5,
  card: 1.8,
  advantage: 1.4,
} as const
