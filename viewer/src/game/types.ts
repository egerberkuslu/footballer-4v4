// Oynanis ortak sozlesmesi (koordinator). Degisiklik icin team-lead'e sor.
// Eksenler: x = saha boyu, z = saha eni, y = yukari. facing: yaw (rad), 0 = +z yonune bakis.

export type TeamId = 0 | 1 // 0: ev (kirmizi-sari), 1: deplasman (lacivert)
export type Role = 'kaleci' | 'defans' | 'orta' | 'forvet'

export type AnimState =
  | 'idle'
  | 'jog'
  | 'run'
  | 'sprint'
  | 'dribble'
  | 'kick'
  | 'rabona' // arapas: vuran sag bacak destek bacaginin ARKASINDAN dolanir (sut/pas/lob; fizik ayni)
  | 'pass'
  | 'tackle' // ayakta mudahale
  | 'slide' // kayarak mudahale
  | 'fall'
  | 'getup'
  | 'celebrate'
  | 'throwin'
  | 'keeper-dive-l'
  | 'keeper-dive-r'
  | 'keeper-catch'
  | 'header'
  // top kontrolu (ilk dokunus)
  | 'trap-foot' // ayak icine/altina durdurma
  | 'trap-thigh' // uylukla yumusatma
  | 'trap-chest' // gogusle indirme
  // top surme ve yon degistirme
  | 'drag-back' // tabanla topu geri cekme
  | 'cut-l' // ic/dis ayakla sola kesme (l = karakterin solu)
  | 'cut-r'
  | 'sole-stop' // topu taban altinda durdurma
  // savunma
  | 'jockey' // alcak savunma durusu, yan ve geri kayma
  // ikili mucadele
  | 'shield' // topu vucutla koruma (sirt rakibe)
  | 'shoulder' // omuz omuza itis
  | 'stumble' // itiste dengesini kaybetme
  // kaleci
  | 'keeper-ready' // hazir durusu (dizler bukuk, kollar acik)
  | 'keeper-shuffle-l' // yana adim
  | 'keeper-shuffle-r'
  | 'keeper-dive-low-l' // yerden uzanma
  | 'keeper-dive-low-r'
  | 'keeper-dive-high-l' // ust koseye ucma
  | 'keeper-dive-high-r'
  | 'keeper-catch-high' // havadan topu toplama
  | 'keeper-collect' // yerden topu kucaklama
  | 'keeper-punch' // yumruklama
  | 'keeper-hold' // top elde bekleme
  | 'keeper-throw' // elle oyuna sokma
  | 'keeper-kick' // elden vole vurus
  | 'keeper-spread' // bire bir: govdeyi acarak kapanma

export type ActionType = 'shoot' | 'pass' | 'lob' | 'tackle' | 'slide' | 'dive' | 'header'

export interface Vec3 {
  x: number
  y: number
  z: number
}

// Insan ve yapay zeka AYNI girdiyi uretir; hareket ve top aksiyonlarini tek modul (control/locomotion) uygular.
export interface PlayerInput {
  move: { x: number; z: number } // dunya duzleminde istenen yon, buyukluk 0..1
  sprint: boolean
  jockey?: boolean // savunma: rakibe donuk kalip yana/geri kayma (E basili)
  action: null | {
    type: ActionType
    power: number // 0..1
    aim: Vec3 // dunya hedef noktasi
    spin?: Vec3 // istege bagli acisal hiz (falso)
    style?: 'rabona' | 'through' | 'driven' // yalniz animasyon secimi (top hizi/yonu ayni)
  }
}

export interface Player {
  id: number
  team: TeamId
  role: Role
  number: number
  name: string
  x: number
  z: number
  vx: number
  vz: number
  facing: number
  anim: AnimState
  animT: number // mevcut animasyonda gecen sure (s)
  actionLock: number // >0 iken yeni aksiyon/hareket kilitli (s)
  controlled: boolean // insan kontrolunde mi
  hasBall: boolean // top ayaginda (surme mesafesinde ve kontrolunde)
  stamina: number // 0..1
  yellow: number
  sentOff: boolean
}

export type RefAnim =
  | 'idle'
  | 'jog'
  | 'run'
  | 'whistle'
  | 'point'
  | 'card-yellow'
  | 'card-red'
  | 'advantage'
  | 'indirect' // endirekt serbest vurus: kol dik yukarida, baska oyuncu dokunana dek
  | 'var-listen' // kulaklik dinler (eli kulakta)
  | 'var-monitor' // monitor basinda izler (one egik)
  | 'var-signal' // TV isareti: havada dikdortgen cizer

export interface Referee {
  x: number
  z: number
  vx: number
  vz: number
  facing: number
  anim: RefAnim
  animT: number
}

export type MatchPhase =
  | 'kickoff'
  | 'play'
  | 'stopped'
  | 'freekick'
  | 'penalty'
  | 'corner'
  | 'kickin' // 4'e 4'te tac yerine ayakla oyuna sokma
  | 'goalkick'
  | 'halftime'
  | 'fulltime'
  | 'var'

export interface Restart {
  type: 'kickoff' | 'freekick' | 'penalty' | 'corner' | 'kickin' | 'goalkick' | 'dropball'
  team: TeamId
  x: number
  z: number
  taker?: number // oyuncu id
  indirect?: boolean // endirekt serbest vurus: baska bir oyuncu dokunmadan gol olmaz
}

export interface MatchState {
  phase: MatchPhase
  clock: number // saniye, devre ici
  halfLength: number // saniye
  half: 1 | 2
  score: [number, number]
  attackDir: [1 | -1, 1 | -1] // takimin hucum ettigi kale (x isareti); devre arasi degisir
  restart: Restart | null
  lastTouch: { player: number; team: TeamId; t: number } | null
  advantageUntil: number // >0: avantaj suruyor (oyun saati)
  /** kirmizi kart cezasi (30 s): cezali oyuncular ve kalan sure (canli oyun saniyesi); K uretir */
  suspended?: { id: number; left: number }[]
}

export type GameEvent =
  | { type: 'touch'; player: number; kind: 'dribble' | 'pass' | 'shoot' | 'lob' | 'tackle' | 'header' | 'save' | 'trap' }
  | {
      type: 'contact' // oyuncu-oyuncu temas (locomotion uretir, hakem degerlendirir)
      a: number // temasi baslatan
      b: number // temas edilen
      ballFirst: boolean // a once topa mi dokundu
      fromBehind: boolean
      intensity: number // 0..1
      high?: boolean // temas yuksekte (diz ustu/rakip havada): sert kayma kirmizisinin kosulu
      kind: 'body' | 'tackle' | 'slide' | 'shoulder'
      x: number
      z: number
    }
  | { type: 'whistle'; reason: string }
  | { type: 'foul'; by: number; on: number; x: number; z: number; penalty: boolean }
  | { type: 'card'; player: number; color: 'yellow' | 'red' }
  | { type: 'player-return'; player: number } // kirmizi kart cezasi bitti, oyuncu sahaya donuyor
  | { type: 'restart'; restart: Restart }
  | { type: 'goal'; team: TeamId; scorer: number | null }
  | { type: 'out'; line: 'goal' | 'side'; x: number; z: number }
  | { type: 'phase'; phase: MatchPhase }
  // pas/sut aninda ofsayt olcumu (K uretir). margin: isaretli metre, pozitif = ofsayt
  | { type: 'offside-check'; passer: number; receiver: number; margin: number; t: number }
  | { type: 'offside'; player: number; x: number; z: number }
  // VAR (G uretir): inceleme basladi / karar
  | { type: 'var-start'; reason: 'line' | 'offside' | 'manual' }
  | {
      type: 'var-decision'
      reason: 'line' | 'offside' | 'manual'
      verdict: 'gol' | 'gol-degil' | 'ofsayt' | 'aut' | 'korner' | 'kale-vurusu' | 'kickin'
      marginCm: number
    }
