// Mac kurallari ve akisi (saf mantik; React/three/sim icermez, bassiz test edilir).
// Yazar: game.match, game.referee, players[].yellow/sentOff; duran top kurulumunda
// players x,z,vx,vz,facing ve placeBall. Bkz. CONTRACT.md "Oynanis mimarisi".
import { BALL_R, GOAL_H, GOAL_W, PITCH_L, PITCH_W, SPOT_DIST } from '../pitch'
import { RefereeBrain } from '../referee/motion'
import { ballExtent, bodyExtent } from '../game/bodyPoints'
import type {
  GameEvent,
  MatchPhase,
  MatchState,
  Player,
  PlayerInput,
  Referee,
  Restart,
  TeamId,
  Vec3,
} from '../game/types'

export const HL = PITCH_L / 2
export const HW = PITCH_W / 2
export const BOX_D = 8 // ceza alani derinligi (pitch.ts cizimiyle ayni)
export const BOX_W = 16
export const WALL_DIST = 5 // serbest vuruşta baraj mesafesi (4'e 4)
export const RESTART_DIST = 3 // diger duran toplarda rakip mesafesi
export const ADV_TIME = 2 // avantaj suresi (s)
export const TEAM_NAMES = ['EV', 'DEP'] as const

// faul esikleri
export const BODY_FOUL_I = 0.4 // topa dokunmadan govde temasi bu siddetin ustunde faul
export const HARD_I = 0.9 // her durumda faul + sari (altindaki temas yalniz serbest vurus)
export const SHOULDER_CARD_I = 0.95 // omuz itmesinde sari siniri
export const SLIDE_CARD_I = 0.8 // onden topsuz kaymada sari siniri; altinda yalniz serbest vurus
export const BEHIND_CARD_I = 0.9 // arkadan (kayma disi) faulde sari siniri; altinda yalniz serbest vurus
export const RED_I = 0.92 // cok sert mudahale: kirmizi
export const REPEAT_FOULS = 4 // bu kadar faulde bir sari
export const SHOULDER_PUSH_I = 0.7 // omuz temasinda itme sayilan siddet (F: normal 0.2-0.4, sprintte sert yuklenme ~0.63 yasal)
export const SHOULDER_BALL_D = 2.0 // temas noktasi topa bundan uzaksa topa oynanmiyor
export const WALK_OFF_V = 2.6 // cezali oyuncunun cikis yuruyusu (m/s)
export const VAR_STAND_FWD = 0.9 // hakem: ekran normali yonunde (m)
export const VAR_STAND_SIDE = 0.7 // hakem: ekranin yanina kayma (m); ~1.14 m mesafe
export const RED_SUSPEND = 30 // kirmizi kart cezasi: canli oyun suresi (s)
export const KEEPER_HOLD = 3 // kalecinin topu elinde tutma siniri (s)
export const RESTART_LIMIT = 3 // hazir duran topu kullanma siniri (s)
const TIMED_RESTARTS = new Set(['freekick', 'kickin', 'corner'])
// baslama, kale vurusu, penalti: kural suresi yok ama insan taker bekleyip maci kilitlemesin
export const HUMAN_TAKER_LIMIT = 12 // s; dolunca en yakin takim arkadasina yedek vurus
const LONG_RESTARTS = new Set(['kickoff', 'goalkick', 'penalty'])
export const SHIELD_REACH = 1.3 // koruyana uzanan mudahalede topa oynanmis sayilan menzil
export const SHIELD_I = 0.55

export interface BallLike {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export interface GameLike {
  players: Player[]
  inputs: PlayerInput[]
  referee: Referee
  match: MatchState
  humanTeam: TeamId | null
  emit(e: GameEvent): void
  on(fn: (e: GameEvent) => void): () => void
}

export interface RulesDeps {
  game: GameLike
  ball: () => BallLike
  placeBall: (x: number, z: number) => void
  /** yapay zeka taker'i gecikirse yedek vurus (istege bagli) */
  kick?: (v: Vec3, w: Vec3) => void
  halfLength?: number
  /** insan kontrolunu oyuncuya gecir (F: control/locomotion setControlled) */
  setControlled?: (id: number) => void
  /** VAR monitorunun konumu ve ekranin baktigi yon (G: var/monitor VAR_MONITOR) */
  varMonitor?: () => { x: number; z: number; facing: number }
  /** tekrar/arayuz oynatiliyor: duran top sayaci ve yedek vurus bekler (G: varState.active) */
  paused?: () => boolean
  /** kaleci tutusunu birak (B: world.holdBall(false)) */
  releaseHold?: () => void
}

// ofsayt olcumu bodyPoints.bodyExtent ile (kafa, govde, kalca, diz, bilek, ayak ucu; kollar yok)
const OFFSIDE_KINDS = new Set(['pass', 'lob', 'shoot', 'header'])
const NO_OFFSIDE_RESTARTS = new Set(['corner', 'kickin', 'goalkick'])
export type VarVerdict = Extract<GameEvent, { type: 'var-decision' }>['verdict']

interface PassSnap {
  passer: number
  team: TeamId
  t: number
  margins: Map<number, { margin: number; x: number; z: number }>
  involved: number | null
}

interface VarState {
  stage: 'listen' | 'run' | 'monitor' | 'signal'
  t: number
  reason: string
  verdict: VarVerdict | null
  prev: Mode // incelemeden onceki mod
}

export type Mode = 'play' | 'stopped' | 'setup' | 'ready' | 'halftime' | 'fulltime'
export type ContactEv = Extract<GameEvent, { type: 'contact' }>

export interface Banner {
  id: number
  kind: 'goal' | 'foul' | 'card-yellow' | 'card-red' | 'info' | 'adv' | 'var'
  text: string
  sub: string
  until: number // rules.time
}

export interface LogEntry {
  t: number // toplam oyun zamani
  half: 1 | 2
  clock: number
  e: GameEvent
}

export interface Verdict {
  foul: boolean
  card: null | 'yellow' | 'red'
}

/** Temas kararı (saf). fouls: a'nin bu temastan ONCEKI faul sayisi. */
/**
 * Temas karari (saf). fouls: a'nin bu temastan ONCEKI faul sayisi; ballDist: temas noktasinin topa uzakligi;
 * shield: temas edilen topu sirtiyla koruyor (anim 'shield'): arkadan gelmek tek basina faul sebebi degil.
 */
export function judgeContact(c: ContactEv, fouls: number, ballDist = 0, shield = false): Verdict {
  const behind = c.fromBehind && !shield
  // omuz omuza: yasal mucadele; itme siddetinde, top uzaktayken (topa oynamiyor) ya da arkadan faul
  if (c.kind === 'shoulder') {
    const foul = behind || c.intensity >= SHOULDER_PUSH_I || ballDist > SHOULDER_BALL_D
    if (!foul) return { foul, card: null }
    const card: Verdict['card'] = c.intensity >= SHOULDER_CARD_I || (fouls + 1) % REPEAT_FOULS === 0 ? 'yellow' : null
    return { foul, card }
  }
  const behindSlide = c.kind === 'slide' && c.fromBehind // kayarak arkadan: koruma olsa da faul
  // once topa, onden: temiz mudahale. F'nin kayma siddeti 1'e doyar, bu yuzden siddet tek basina
  // faul/kart sebebi degil; yalniz kayma disi asiri sert (RED_I) temas faul + en fazla sari.
  if (c.ballFirst && !behindSlide) {
    if (c.kind === 'slide' || c.intensity < RED_I) return { foul: false, card: null }
    return { foul: true, card: 'yellow' }
  }
  let foul: boolean
  if (behindSlide || c.intensity >= HARD_I) foul = true
  else if (shield && c.kind !== 'slide') {
    // korunan topa ayakta uzanma: top menzildeyse ve siddet orta alti ise topa oynanmis sayilir
    foul = ballDist > SHIELD_REACH || c.intensity > SHIELD_I
  } else foul = c.kind !== 'body' || c.intensity > BODY_FOUL_I
  if (!foul) return { foul, card: null }
  let card: Verdict['card'] = null
  if (c.ballFirst) card = 'yellow' // once topa ama arkadan kayma: en fazla sari
  else if (behindSlide) card = 'red' // arkadan topsuz kayma: dogrudan kirmizi
  else if (c.kind === 'slide') {
    // onden topsuz kayma: sari; kirmizi yalniz asiri sert + rakip havada/yuksek temas (ContactEv.high, F doldurursa)
    card = c.intensity >= RED_I && (c as { high?: boolean }).high ? 'red' : c.intensity >= SLIDE_CARD_I ? 'yellow' : null
  } else if (c.intensity >= RED_I && c.kind !== 'body') card = 'red'
  else if ((behind && c.intensity >= BEHIND_CARD_I) || c.intensity >= HARD_I || (fouls + 1) % REPEAT_FOULS === 0) card = 'yellow'
  return { foul, card }
}

const phaseOf: Record<Restart['type'], MatchPhase> = {
  kickoff: 'kickoff',
  freekick: 'freekick',
  penalty: 'penalty',
  corner: 'corner',
  kickin: 'kickin',
  goalkick: 'goalkick',
  dropball: 'freekick',
}

export const RESTART_TEXT: Record<Restart['type'], string> = {
  kickoff: 'BAŞLAMA VURUŞU',
  freekick: 'SERBEST VURUŞ',
  penalty: 'PENALTI',
  corner: 'KORNER',
  kickin: 'TAÇ (AYAKLA)',
  goalkick: 'KALE VURUŞU',
  dropball: 'HAKEM TOPU',
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

interface Advantage {
  foul: { by: number; on: number; x: number; z: number }
  victim: TeamId
  until: number
  t0: number // avantajin basladigi toplam zaman
}

export class Rules {
  mode: Mode = 'setup'
  time = 0 // toplam oyun zamani (s)
  banner: Banner | null = null
  log: LogEntry[] = []
  fouls: number[] = []
  readonly brain = new RefereeBrain()

  private g: GameLike
  private d: RulesDeps
  private pending: Restart | null = null
  private wait = 0 // stopped/setup/halftime geri sayimi
  private readyT = 0
  private readyTouched = false
  private humanMoveT = 0
  /** endirekt vurus yapildi, henuz baska oyuncu degmedi: vurucu id */
  indirect: { taker: number } | null = null
  private holdT = 0
  private exits = new Map<number, { x: number; z: number }>()
  /** cezali oyuncular: kalan canli oyun suresi, cikis tarafi; kaleciyse yerine gecen oyuncunun eski rolu */
  private susp = new Map<number, { left: number; side: 1 | -1; sub?: { id: number; role: Player['role'] } }>()
  private spot = { x: 0, z: 0 }
  private focus: { x: number; z: number } | null = null
  private adv: Advantage | null = null
  private cards: { player: number; color: 'yellow' | 'red' }[] = []
  private contactsQ: ContactEv[] = []
  private touchQ: { player: number; kind: string }[] = []
  private lastPair = new Map<string, number>()
  private prev = { x: 0, y: 0, z: 0 }
  private firstKick: TeamId = 0
  private bannerId = 0
  private wallIds: number[] = []
  private off: () => void
  started = false
  snap: PassSnap | null = null // son pas anindaki ofsayt olcumu
  lastSnap: PassSnap | null = null // VAR icin: son olcum (temizlenmez)
  varS: VarState | null = null
  private lastGoal: { team: TeamId; side: 1 | -1 } | null = null
  private varQ: GameEvent[] = []

  constructor(deps: RulesDeps) {
    this.d = deps
    this.g = deps.game
    this.fouls = this.g.players.map(() => 0)
    this.off = this.g.on((e) => {
      if (e.type === 'contact') this.contactsQ.push(e)
      else if (e.type === 'touch') this.touchQ.push({ player: e.player, kind: e.kind })
      else if (e.type === 'var-start' || e.type === 'var-decision') this.varQ.push(e)
    })
  }

  /** Yeni mac: skor, saat, kartlar sifir; ev takimi baslama vurusu. Bilesen mount olunca cagrilir. */
  start() {
    const m = this.g.match
    Object.assign(m, {
      phase: 'kickoff',
      clock: 0,
      half: 1,
      score: [0, 0],
      attackDir: [1, -1],
      restart: null,
      lastTouch: null,
      advantageUntil: 0,
    })
    if (this.d.halfLength) m.halfLength = this.d.halfLength
    for (const [id, sp] of this.susp) this.restoreRoles(id, sp)
    this.susp.clear()
    this.exits.clear()
    for (const p of this.g.players) {
      p.yellow = 0
      p.sentOff = false
    }
    this.syncSuspended()
    this.fouls = this.g.players.map(() => 0)
    this.cards = []
    this.adv = null
    this.snap = this.lastSnap = null
    this.varS = null
    this.lastGoal = null
    this.contactsQ = []
    this.touchQ = []
    this.varQ = []
    this.banner = null
    this.started = true
    this.kickoff(this.firstKick, 0, 'start')
  }

  dispose() {
    this.off()
  }

  /** HMR: eski motorun durumunu devral (mac sifirlanmasin). Oyun durumu yeni game'e kopyalanir. */
  adopt(old: Rules) {
    const keep = ['mode', 'time', 'banner', 'log', 'fouls', 'pending', 'wait', 'readyT', 'spot', 'focus', 'adv', 'cards', 'firstKick', 'bannerId', 'wallIds', 'started', 'snap', 'lastSnap', 'varS', 'lastGoal', 'indirect', 'susp', 'exits'] as const
    const src = old as unknown as Record<string, unknown>
    const dst = this as unknown as Record<string, unknown>
    for (const k of keep) dst[k] = src[k]
    Object.assign(this.brain, old.brain)
    if (old.g !== this.g) {
      Object.assign(this.g.match, structuredClone(old.g.match))
      Object.assign(this.g.referee, old.g.referee)
      old.g.players.forEach((p, i) => {
        const q = this.g.players[i]
        if (q) Object.assign(q, { x: p.x, z: p.z, facing: p.facing, yellow: p.yellow, sentOff: p.sentOff, controlled: p.controlled })
      })
    }
  }

  get match() {
    return this.g.match
  }

  // ------------------------------------------------------------------ on (-20)
  /** Duran top dizilisi: girdileri ezer (oyun 'play' degilken). gdt = dt * timeScale */
  /** rdt: gercek zaman adimi (insan taker'in hareket suresi) */
  pre(_gdt: number, rdt = 1 / 60) {
    const { players, inputs } = this.g
    for (const p of players) {
      if (p.sentOff) {
        const inp = inputs[p.id]
        inp.move.x = inp.move.z = 0
        inp.sprint = false
        inp.action = null
      }
    }
    if (!this.started) return
    if (this.varS || this.g.match.phase === 'var') {
      // VAR: herkes durur, yavas yurur
      for (const inp of inputs) {
        const l = Math.hypot(inp.move.x, inp.move.z)
        if (l > 0.3) {
          inp.move.x *= 0.3 / l
          inp.move.z *= 0.3 / l
        }
        inp.sprint = false
        inp.action = null
      }
      return
    }
    if (this.mode === 'play' || this.mode === 'fulltime') return
    const r = this.pending
    const b = this.d.ball()
    for (const p of players) {
      if (p.sentOff) continue
      const inp = inputs[p.id]
      const isTaker = !!r && r.taker === p.id
      if (this.mode === 'ready' && isTaker) continue // taker serbest (insan ya da YZ)
      inp.action = null
      if (this.mode === 'halftime') {
        inp.move.x = inp.move.z = 0
        inp.sprint = false
        continue
      }
      if (isTaker && r) {
        // insan taker kurulumda >= 0.15 s hareket ederse kilit kalkar: vurus beklemeye gec, geri cekme
        if (p.controlled && this.mode === 'setup') {
          const mv = Math.hypot(inp.move.x, inp.move.z)
          this.humanMoveT = mv > 0.3 ? this.humanMoveT + rdt : 0
          if (this.humanMoveT >= 0.15) {
            this.makeReady()
            continue
          }
          if (this.humanMoveT > 0) continue
        }
        // stopped/setup: topa yuru; vardiysa girdiye dokunma (kurulumda insan serbest)
        const [sx, sz] = this.takerSpot(r)
        const dx = sx - p.x
        const dz = sz - p.z
        const l = Math.hypot(dx, dz)
        if (this.mode === 'setup' && l < 0.3) continue
        const m = Math.min(1, l / 2)
        inp.move.x = l > 0.05 ? (dx / l) * m : 0
        inp.move.z = l > 0.05 ? (dz / l) * m : 0
        inp.sprint = l > 8
        continue
      }
      if (p.controlled && this.mode !== 'ready') {
        // insan kurulum boyunca kilitli
        inp.move.x = inp.move.z = 0
        inp.sprint = false
      }
      // rakipler duran top mesafesinin disina
      if (r && p.team !== r.team && this.mode !== 'stopped') {
        const R = this.radiusOf(r) + 0.2
        const dx = p.x - b.x
        const dz = p.z - b.z
        const l = Math.hypot(dx, dz)
        if (l < R && !this.wallIds.includes(p.id)) {
          inp.move.x = l > 1e-3 ? dx / l : 1
          inp.move.z = l > 1e-3 ? dz / l : 0
          inp.sprint = false
        }
      }
    }
  }

  // ------------------------------------------------------------------ son (-0.5)
  /** gdt: oyun zamani adimi; rdt: gercek zaman adimi (VAR'da hakem timeScale=0 iken de yurur) */
  post(gdt: number, rdt = gdt) {
    const m = this.g.match
    if (!this.started) return
    this.handleVarEvents()
    if (!this.varS && m.phase === 'var') this.beginVar('manual') // G fazi dogrudan yazdiysa
    if (this.varS) {
      this.contactsQ.length = 0
      this.touchQ.length = 0
      this.updateVar(rdt)
      return
    }
    // duran top zamanlayicilari GERCEK zamanla: yavas karede (oyun zamani 1/30 ile kirpilir) kilit kalmasin
    const tdt = rdt
    if (gdt <= 0 && this.mode === 'play') return
    this.time += gdt
    const b = this.d.ball()
    this.handleTouches()
    this.scanPossession()

    switch (this.mode) {
      case 'play':
        m.clock += gdt
        if (this.snap && this.time - this.snap.t > 8) this.snap = null
        this.handleContacts()
        if (this.mode === 'play') this.checkBall(b)
        if (this.mode === 'play') this.updateAdvantage()
        if (this.mode === 'play') this.checkKeeperHold(b, gdt)
        if (this.mode === 'play' && m.clock >= m.halfLength) this.endHalf()
        break
      case 'stopped':
        this.contactsQ.length = 0
        this.wait -= tdt
        if (this.wait <= 0) {
          if (this.pending) this.setup()
          else this.resume() // guvenlik: bekleyen yeniden baslatma yoksa oyuna don
        }
        break
      case 'setup':
        this.contactsQ.length = 0
        if (this.pending) this.d.placeBall(this.pending.x, this.pending.z)
        this.wait -= tdt
        if (this.wait <= 0) this.makeReady()
        break
      case 'ready': {
        this.contactsQ.length = 0
        if (!this.d.paused?.()) this.readyT += tdt
        const moved = Math.hypot(b.x - this.spot.x, b.z - this.spot.z)
        // guvenlik agi: vurus/surme dokunusu, top 0.35 m oynadi ya da hizlandi -> oyun
        if (this.readyTouched || moved > 0.35 || Math.hypot(b.vx, b.vz) > 1.5) this.resume()
        else if (!this.timeoutRestart()) this.aiFallback()
        break
      }
      case 'halftime':
        this.wait -= tdt
        if (this.wait <= 0) this.secondHalf()
        break
      case 'fulltime':
        break
    }
    this.prev.x = b.x
    this.prev.y = b.y
    this.prev.z = b.z
    this.tickSuspensions(this.mode === 'play' ? gdt : 0)
    this.walkOff(tdt)
    this.updateReferee(this.mode === 'play' ? gdt : tdt, b)
    if (this.banner && this.time > this.banner.until) this.banner = null
  }

  // ------------------------------------------------------------------ olaylar
  private handleTouches() {
    const m = this.g.match
    const q = this.touchQ
    this.touchQ = []
    for (const t of q) {
      const p = this.g.players[t.player]
      if (!p) continue
      // ofsayt: pastan sonra topa ilk dokunan takim arkadasi oyuna mudahil olur
      const s = this.snap
      if (s && p.id !== s.passer) {
        if (p.team === s.team) {
          s.involved = p.id
          this.lastSnap = s
          this.snap = null
          const r = s.margins.get(p.id)
          if (r && r.margin > 0 && this.mode === 'play') {
            m.lastTouch = { player: p.id, team: p.team, t: this.time }
            this.offside(p, r)
            return
          }
        } else if (t.kind !== 'save') this.snap = null // rakip topu bilincli oynadi
      } else if (s && p.id === s.passer && !OFFSIDE_KINDS.has(t.kind)) this.snap = null
      if (this.indirect && p.id !== this.indirect.taker) this.indirect = null
      m.lastTouch = { player: p.id, team: p.team, t: this.time }
      this.record({ type: 'touch', player: p.id, kind: t.kind as 'dribble' })
      if (this.mode === 'ready' && t.kind !== 'trap') this.readyTouched = true
      if (OFFSIDE_KINDS.has(t.kind)) {
        const fromRestart = this.mode === 'ready' && !!this.pending && NO_OFFSIDE_RESTARTS.has(this.pending.type)
        if ((this.mode === 'play' || this.mode === 'ready') && !fromRestart) this.measureOffside(p)
        else this.snap = null
      }
    }
  }

  /** Pas/sut aninda her takim arkadasi icin isaretli ofsayt farki (m, + = ofsayt). */
  measureOffside(p: Player) {
    const m = this.g.match
    const d = m.attackDir[p.team]
    const b = this.d.ball()
    const opp = this.g.players
      .filter((q) => q.team !== p.team && !q.sentOff)
      .map((q) => bodyExtent(q, d))
      .sort((a, c) => c - a)
    const second = opp.length >= 2 ? opp[1] : -1e9 // sondan ikinci savunmaci (kaleci dahil)
    const line = Math.max(second, ballExtent(b.x, d, BALL_R))
    const snap: PassSnap = { passer: p.id, team: p.team, t: this.time, margins: new Map(), involved: null }
    for (const q of this.g.players) {
      if (q.team !== p.team || q.id === p.id || q.sentOff) continue
      const front = bodyExtent(q, d)
      let margin = front - line
      if (front <= 0) margin = Math.min(margin, front) // kendi yari sahasinda ofsayt olmaz
      snap.margins.set(q.id, { margin, x: q.x, z: q.z })
      const ev: GameEvent = { type: 'offside-check', passer: p.id, receiver: q.id, margin, t: this.time }
      this.g.emit(ev)
      this.record(ev)
    }
    this.snap = snap
    this.lastSnap = snap
  }

  private offside(p: Player, r: { x: number; z: number }) {
    const ev: GameEvent = { type: 'offside', player: p.id, x: r.x, z: r.z }
    this.g.emit(ev)
    this.record(ev)
    const x = clamp(r.x, -HL + 0.5, HL - 0.5)
    const z = clamp(r.z, -HW + 0.5, HW - 0.5)
    this.stop('offside', { type: 'freekick', team: (1 - p.team) as TeamId, x, z, indirect: true }, 2.2, { x, z })
    this.say('foul', 'OFSAYT', `${p.name} (${TEAM_NAMES[p.team]} ${p.number})`, 2.2)
  }

  // top ayaginda olan oyuncu son dokunan sayilir (surme her karede olay yaymayabilir)
  private scanPossession() {
    if (this.mode !== 'play') return
    for (const p of this.g.players) {
      if (p.hasBall && !p.sentOff) {
        const lt = this.g.match.lastTouch
        if (!lt || lt.player !== p.id) this.g.match.lastTouch = { player: p.id, team: p.team, t: this.time }
        else lt.t = this.time
        return
      }
    }
  }

  private possessionTeam(): TeamId | null {
    for (const p of this.g.players) if (p.hasBall && !p.sentOff) return p.team
    return this.g.match.lastTouch?.team ?? null
  }

  private handleContacts() {
    const q = this.contactsQ
    this.contactsQ = []
    for (const c of q) {
      if (this.mode !== 'play') break
      this.onContact(c)
    }
  }

  /** Tek temasi degerlendir (testler dogrudan cagirabilir). */
  onContact(c: ContactEv) {
    const pa = this.g.players[c.a]
    const pb = this.g.players[c.b]
    if (!pa || !pb || pa.team === pb.team || pa.sentOff || pb.sentOff) return
    // ayni ciftin ardisik temaslari tek olay
    const key = `${c.a}-${c.b}`
    const last = this.lastPair.get(key) ?? -9
    this.lastPair.set(key, this.time)
    if (this.time - last < 0.8) return
    this.record(c)
    const bl = this.d.ball()
    const v = judgeContact(c, this.fouls[c.a], Math.hypot(bl.x - c.x, bl.z - c.z), pb.anim === 'shield')
    if (!v.foul) return
    this.fouls[c.a]++
    if (v.card) this.cards.push({ player: c.a, color: v.card })
    const victim = pb.team
    const m = this.g.match
    const goalSide = m.attackDir[victim]
    const inBox = goalSide * c.x > HL - BOX_D && Math.abs(c.z) < BOX_W / 2
    const foul = { by: c.a, on: c.b, x: c.x, z: c.z }
    if (inBox) {
      this.g.emit({ type: 'foul', ...foul, penalty: true })
      this.record({ type: 'foul', ...foul, penalty: true })
      this.adv = null
      m.advantageUntil = 0
      this.stop('penalty', { type: 'penalty', team: victim, x: goalSide * (HL - SPOT_DIST), z: 0 }, 2.6, { x: c.x, z: c.z })
      this.say('foul', 'PENALTI', `${pa.name} → ${pb.name}`, 3)
      return
    }
    this.g.emit({ type: 'foul', ...foul, penalty: false })
    this.record({ type: 'foul', ...foul, penalty: false })
    // avantaj: faul yapilan takim topu tutuyor ve hucum ucuncu bolgesinde
    const b = this.d.ball()
    const dangerous = goalSide * b.x > HL / 3
    if (!this.adv && this.possessionTeam() === victim && dangerous && v.card !== 'red') {
      this.adv = { foul, victim, until: m.clock + ADV_TIME, t0: this.time }
      m.advantageUntil = this.adv.until
      this.brain.gestureFor('advantage', 1.6)
      this.say('adv', 'AVANTAJ', `${pa.name} faul`, ADV_TIME)
      this.g.emit({ type: 'whistle', reason: 'advantage' })
      return
    }
    this.foulKick(foul, victim, pa.name)
  }

  private foulKick(f: { by: number; x: number; z: number }, team: TeamId, name: string) {
    this.adv = null
    this.g.match.advantageUntil = 0
    const x = clamp(f.x, -HL + 0.5, HL - 0.5)
    const z = clamp(f.z, -HW + 0.5, HW - 0.5)
    this.stop('foul', { type: 'freekick', team, x, z }, 2.4, { x, z })
    if (!this.banner || this.banner.kind === 'adv') this.say('foul', 'FAUL', name, 2.2)
  }

  private updateAdvantage() {
    const a = this.adv
    if (!a) return
    const m = this.g.match
    const lt = m.lastTouch
    // rakip topu kazandiysa geri donup faulu cal
    if (lt && lt.team !== a.victim && lt.t > a.t0 + 0.05) {
      const p = this.g.players[a.foul.by]
      this.foulKick(a.foul, a.victim, p.name)
      return
    }
    if (m.clock >= a.until) {
      this.adv = null
      m.advantageUntil = 0
    }
  }

  // ------------------------------------------------------------------ top: gol / out
  private checkBall(b: BallLike) {
    const m = this.g.match
    const p = this.prev
    // gol: top tamamen cizgiyi direkler arasindan ve ust direk altindan gecti
    for (const s of [1, -1] as const) {
      const d0 = s * p.x - HL
      const d1 = s * b.x - HL
      if (d0 < BALL_R && d1 >= BALL_R) {
        const f = (BALL_R - d0) / (d1 - d0 || 1e-9)
        const z = p.z + (b.z - p.z) * f
        const y = p.y + (b.y - p.y) * f
        if (Math.abs(z) < GOAL_W / 2 && y < GOAL_H) {
          const team: TeamId = m.attackDir[0] === s ? 0 : 1
          const ind = this.indirect
          if (ind) {
            // endirekt vurus baska oyuncuya degmeden kaleye: gol yok
            this.indirect = null
            const defending = (1 - team) as TeamId
            const lt = m.lastTouch
            if (lt && lt.team === defending) {
              // kendi kalesine dogrudan: rakibe korner
              this.stop('indirect', { type: 'corner', team, x: s * (HL - 0.35), z: (z >= 0 ? 1 : -1) * (HW - 0.35) }, 1.8, null)
            } else {
              this.stop('indirect', { type: 'goalkick', team: defending, x: s * (HL - 2), z: 0 }, 1.8, null)
            }
            this.say('info', 'GOL YOK', 'Endirekt vuruş doğrudan kaleye', 2.4)
            return
          }
          this.goal(team)
          return
        }
      }
    }
    const lt = m.lastTouch
    if (Math.abs(b.x) > HL + BALL_R) {
      // kale cizgisi: savunan takimin son dokunusu korner, aksi kale vurusu
      const s = b.x > 0 ? 1 : -1
      const defending: TeamId = m.attackDir[0] === s ? 1 : 0
      const attacking = (1 - defending) as TeamId
      this.g.emit({ type: 'out', line: 'goal', x: b.x, z: b.z })
      this.record({ type: 'out', line: 'goal', x: b.x, z: b.z })
      if (lt && lt.team === defending) {
        const cz = (b.z >= 0 ? 1 : -1) * (HW - 0.35)
        this.stop('out', { type: 'corner', team: attacking, x: s * (HL - 0.35), z: cz }, 1.8, null)
      } else {
        this.stop('out', { type: 'goalkick', team: defending, x: s * (HL - 2), z: clamp(b.z * 0.4, -3, 3) }, 1.8, null)
      }
      return
    }
    if (Math.abs(b.z) > HW + BALL_R) {
      const team: TeamId = lt ? ((1 - lt.team) as TeamId) : 0
      this.g.emit({ type: 'out', line: 'side', x: b.x, z: b.z })
      this.record({ type: 'out', line: 'side', x: b.x, z: b.z })
      const x = clamp(p.x, -HL + 0.6, HL - 0.6)
      this.stop('out', { type: 'kickin', team, x, z: (b.z > 0 ? 1 : -1) * (HW - 0.12) }, 1.6, null)
    }
  }

  // kaleci topu elinde (top yerden yukarida, sahiplik kalecide) en fazla KEEPER_HOLD s tutabilir
  private checkKeeperHold(b: BallLike, gdt: number) {
    const k = this.g.players.find((p) => p.role === 'kaleci' && p.hasBall && !p.sentOff)
    if (!k || b.y < 0.3) {
      this.holdT = 0
      return
    }
    this.holdT += gdt
    if (this.holdT <= KEEPER_HOLD) return
    this.holdT = 0
    // ceza alani icinden endirekt serbest vurus
    const s = k.x >= 0 ? 1 : -1
    const x = s * clamp(Math.abs(k.x), HL - BOX_D + 0.5, HL - 1)
    const z = clamp(k.z, -BOX_W / 2 + 0.5, BOX_W / 2 - 0.5)
    this.stop('keeper-hold', { type: 'freekick', team: (1 - k.team) as TeamId, x, z, indirect: true }, 2.0, { x, z })
    this.say('foul', 'KALECİ 3 SANİYE', `${k.name} · endirekt serbest vuruş`, 2.2)
  }

  private goal(team: TeamId) {
    const m = this.g.match
    const lt = m.lastTouch
    const scorer = lt ? lt.player : null
    m.score[team]++
    this.lastGoal = { team, side: m.attackDir[team] }
    this.adv = null
    m.advantageUntil = 0
    const ev: GameEvent = { type: 'goal', team, scorer }
    this.g.emit(ev)
    this.record(ev)
    const conceding = (1 - team) as TeamId
    this.stop('goal', { type: 'kickoff', team: conceding, x: 0, z: 0 }, 3.2, null)
    const sp = scorer !== null ? this.g.players[scorer] : null
    const own = sp && sp.team !== team
    this.say(
      'goal',
      `GOL! ${TEAM_NAMES[0]} ${m.score[0]} - ${m.score[1]} ${TEAM_NAMES[1]}`,
      sp ? (own ? `${sp.name} (kendi kalesine)` : sp.name) : '',
      3.2,
    )
  }

  // ------------------------------------------------------------------ duraklama / duran top
  private stop(reason: string, r: Restart, wait: number, focus: { x: number; z: number } | null) {
    const m = this.g.match
    this.mode = 'stopped'
    this.pending = r
    r.taker = this.pickTaker(r)
    this.wait = wait
    this.focus = focus
    this.wallIds = []
    this.snap = null
    this.indirect = null
    m.restart = null
    // oyun durdu: kimse topu tutmuyor (kaleci elindeki topu birakir), kaleci sayaci sifir
    for (const p of this.g.players) p.hasBall = false
    this.d.releaseHold?.()
    this.holdT = 0
    this.g.emit({ type: 'whistle', reason })
    this.record({ type: 'whistle', reason })
    this.brain.gestureFor('whistle', 0.55)
    this.setPhase('stopped')
    if (focus && (reason === 'foul' || reason === 'penalty')) {
      // duduk -> faul yerini gosterme
      setTimeoutLike(this, 0.55, () => this.brain.gestureFor('point', 1.4))
    }
    this.applyCards()
    if (reason !== 'goal' && reason !== 'foul' && reason !== 'penalty') this.say('info', RESTART_TEXT[r.type], TEAM_NAMES[r.team], 1.8)
  }

  private applyCards() {
    if (!this.cards.length) return
    let delay = 0.6
    for (const c of this.cards) {
      const p = this.g.players[c.player]
      if (!p || p.sentOff) continue
      let color = c.color
      if (color === 'yellow') {
        p.yellow++
        if (p.yellow >= 2) color = 'red'
      }
      this.g.emit({ type: 'card', player: p.id, color: c.color })
      this.record({ type: 'card', player: p.id, color: c.color })
      if (color === 'red') {
        this.suspend(p)
        if (c.color === 'yellow') {
          this.g.emit({ type: 'card', player: p.id, color: 'red' })
          this.record({ type: 'card', player: p.id, color: 'red' })
        }
      }
      const anim = color === 'red' ? 'card-red' : 'card-yellow'
      setTimeoutLike(this, delay, () => {
        this.brain.gestureFor(anim, 2)
        this.say(
          anim,
          color === 'red' ? (c.color === 'yellow' ? 'İKİNCİ SARI → KIRMIZI' : 'KIRMIZI KART') : 'SARI KART',
          `${p.name} (${TEAM_NAMES[p.team]} ${p.number})`,
          2.6,
        )
      })
      delay += 2.1
      if (this.mode === 'stopped') this.wait = Math.max(this.wait, delay + 0.4)
    }
    this.cards = []
    // atilan oyuncu: insan kontroldeyse kontrol takim arkadasina gecer; taker ise yeniden sec
    if (this.pending && this.pending.taker !== undefined && this.g.players[this.pending.taker]?.sentOff) {
      this.pending.taker = this.pickTaker(this.pending)
    }
  }

  private setup() {
    const r = this.pending!
    const { players } = this.g
    this.d.placeBall(r.x, r.z)
    if (r.type === 'kickoff') this.formKickoff(r.team)
    else if (r.type === 'penalty') this.formPenalty(r)
    else this.formRestart(r)
    // insan takimi vuruyorsa kontrol taker'a gecer
    const human = this.g.humanTeam
    if (human !== null) {
      const want = r.team === human && r.taker !== undefined ? r.taker : undefined
      const cur = players.find((p) => p.controlled && p.team === human)
      if (want !== undefined && (!cur || cur.id !== want)) this.control(human, want)
      else if (cur?.sentOff) {
        const alt = this.nearest(human, r.x, r.z, true)
        if (alt) this.control(human, alt.id)
      }
    }
    this.humanMoveT = 0
    this.mode = 'setup'
    this.wait = r.type === 'kickoff' || r.type === 'penalty' ? 1.0 : 0.6
    this.focus = null
    this.g.match.restart = { ...r }
    this.g.emit({ type: 'restart', restart: { ...r } })
    this.record({ type: 'restart', restart: { ...r } })
    this.setPhase(phaseOf[r.type])
  }

  private makeReady() {
    const r = this.pending!
    const m = this.g.match
    this.d.placeBall(r.x, r.z)
    this.spot = { x: r.x, z: r.z }
    this.mode = 'ready'
    this.readyT = 0
    if (r.indirect) this.brain.gestureFor('indirect', 1e9) // endirekt: kol dik yukarida, vurus yapilip baskasi degene dek
    this.readyTouched = false
    m.restart = { ...r }
    if (r.type === 'kickoff' || r.type === 'penalty') {
      this.g.emit({ type: 'whistle', reason: r.type === 'kickoff' ? 'kickoff' : 'penalty-go' })
      this.brain.gestureFor('whistle', 0.5)
    }
  }

  private resume() {
    const m = this.g.match
    const r = this.pending
    // vurus olayi gelmediyse taker son dokunan sayilir
    if (r && r.taker !== undefined && (!m.lastTouch || m.lastTouch.t < this.time - this.readyT - 1e-6)) {
      const p = this.g.players[r.taker]
      m.lastTouch = { player: p.id, team: p.team, t: this.time }
    }
    if (r?.type === 'kickoff') this.lastGoal = null
    this.indirect = r?.indirect && r.taker !== undefined ? { taker: r.taker } : null
    this.mode = 'play'
    this.pending = null
    this.wallIds = []
    m.restart = null
    this.setPhase('play')
  }

  /** sureli duran topta kalan sure (s); yoksa null. HUD sayaci okur. */
  get countdown(): number | null {
    const r = this.pending
    if (this.mode !== 'ready' || !r) return null
    if (TIMED_RESTARTS.has(r.type)) return Math.max(0, RESTART_LIMIT - this.readyT)
    if (LONG_RESTARTS.has(r.type) && this.humanTakes(r)) {
      const left = HUMAN_TAKER_LIMIT - this.readyT
      return left <= 3 ? Math.max(0, left) : null // son 3 s'de 3-2-1, oncesi sessiz
    }
    return null
  }

  private humanTakes(r: Restart): boolean {
    const p = r.taker !== undefined ? this.g.players[r.taker] : undefined
    return !!p && p.controlled
  }

  // insan taker 3 s'de kullanmazsa ayni tur duran top rakibe
  private timeoutRestart(): boolean {
    const r = this.pending
    if (!r || !TIMED_RESTARTS.has(r.type) || this.readyT < RESTART_LIMIT) return false
    const p = r.taker !== undefined ? this.g.players[r.taker] : undefined
    if (!p || !p.controlled) return false
    const team = (1 - r.team) as TeamId
    this.stop('timeout', { type: r.type, team, x: r.x, z: r.z }, 1.0, null)
    this.say('info', 'SÜRE DOLDU', `${RESTART_TEXT[r.type]} → ${TEAM_NAMES[team]}`, 1.8)
    return true
  }

  // yapay zeka taker'i gec kalirsa yakin takim arkadasina pas (insan icin 15 s)
  private aiFallback() {
    const r = this.pending
    if (!r || r.taker === undefined || !this.d.kick) return
    const p = this.g.players[r.taker]
    // insan: sureli toplarda yedek yok (timeoutRestart); baslama/kale vurusu/penaltida 12 s sonra yedek
    const limit = p.controlled ? (LONG_RESTARTS.has(r.type) ? HUMAN_TAKER_LIMIT : Infinity) : RESTART_LIMIT
    if (this.readyT < limit) return
    const b = this.d.ball()
    let tx = this.g.match.attackDir[r.team] * HL
    let tz = 0
    if (r.type !== 'penalty') {
      const mate = this.nearest(r.team, b.x, b.z, false, p.id)
      if (mate) {
        tx = mate.x
        tz = mate.z
      }
    }
    const dx = tx - b.x
    const dz = tz - b.z
    const l = Math.hypot(dx, dz) || 1
    const v = r.type === 'penalty' ? 22 : clamp(6 + l * 0.9, 8, 18)
    this.d.kick({ x: (dx / l) * v, y: l > 14 ? 3 : 0.4, z: (dz / l) * v }, { x: 0, y: 0, z: 0 })
    this.g.emit({ type: 'touch', player: p.id, kind: r.type === 'penalty' ? 'shoot' : 'pass' })
    this.g.match.lastTouch = { player: p.id, team: p.team, t: this.time }
    this.resume()
  }

  // ------------------------------------------------------------------ devreler
  private kickoff(team: TeamId, wait: number, reason: string) {
    this.pending = { type: 'kickoff', team, x: 0, z: 0 }
    this.pending.taker = this.pickTaker(this.pending)
    if (wait > 0) {
      this.mode = 'stopped'
      this.wait = wait
      this.setPhase('stopped')
      this.g.emit({ type: 'whistle', reason })
    } else this.setup()
    this.say('info', RESTART_TEXT.kickoff, TEAM_NAMES[team], 2)
  }

  private endHalf() {
    const m = this.g.match
    this.adv = null
    m.advantageUntil = 0
    m.restart = null
    this.pending = null
    if (m.half === 1) {
      this.mode = 'halftime'
      this.wait = 5
      this.g.emit({ type: 'whistle', reason: 'half' })
      this.record({ type: 'whistle', reason: 'half' })
      this.setPhase('halftime')
      this.say('info', 'DEVRE ARASI', `${TEAM_NAMES[0]} ${m.score[0]} - ${m.score[1]} ${TEAM_NAMES[1]}`, 5)
    } else {
      this.mode = 'fulltime'
      this.g.emit({ type: 'whistle', reason: 'end' })
      this.record({ type: 'whistle', reason: 'end' })
      this.setPhase('fulltime')
      this.say('info', 'MAÇ SONU', `${TEAM_NAMES[0]} ${m.score[0]} - ${m.score[1]} ${TEAM_NAMES[1]}`, 1e9)
    }
    this.brain.gestureFor('whistle', 1.2)
  }

  private secondHalf() {
    const m = this.g.match
    m.half = 2
    m.clock = 0
    m.attackDir = [m.attackDir[0] === 1 ? -1 : 1, m.attackDir[1] === 1 ? -1 : 1]
    m.lastTouch = null
    this.kickoff((1 - this.firstKick) as TeamId, 0, 'kickoff')
  }

  // ------------------------------------------------------------------ yerlesim
  private put(p: Player, x: number, z: number, facing: number) {
    p.x = x
    p.z = z
    p.vx = p.vz = 0
    p.facing = facing
  }

  private faceTo(p: Player, x: number, z: number) {
    return Math.atan2(x - p.x, z - p.z)
  }

  private formKickoff(kick: TeamId) {
    const m = this.g.match
    for (const p of this.g.players) {
      if (p.sentOff) continue
      const d = m.attackDir[p.team]
      const k = p.team === kick
      const f = d > 0 ? Math.PI / 2 : -Math.PI / 2
      const lat = p.team === 0 ? 1 : -1
      let x: number
      let z: number
      switch (p.role) {
        case 'kaleci':
          x = -d * (HL - 1.2)
          z = 0
          break
        case 'defans':
          x = -d * 11
          z = 0
          break
        case 'orta':
          x = -d * (k ? 3 : 6)
          z = -4 * lat
          break
        default:
          x = -d * (k ? 0.45 : 4.2)
          z = k ? 0 : 2.5 * lat
      }
      this.put(p, x, z, f)
    }
    // forvet atildiysa taker topun arkasina
    const r = this.pending!
    if (r.taker !== undefined) {
      const t = this.g.players[r.taker]
      const [sx, sz] = this.takerSpot(r)
      this.put(t, sx, sz, m.attackDir[kick] > 0 ? Math.PI / 2 : -Math.PI / 2)
    }
  }

  private formPenalty(r: Restart) {
    const m = this.g.match
    const s = m.attackDir[r.team]
    const zs = [-6, 6, -3.5, 3.5, -8, 8]
    let i = 0
    for (const p of this.g.players) {
      if (p.sentOff) continue
      if (p.id === r.taker) {
        this.put(p, r.x - s * 1.3, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2)
      } else if (p.role === 'kaleci' && p.team !== r.team) {
        this.put(p, s * (HL - 0.2), 0, s > 0 ? -Math.PI / 2 : Math.PI / 2)
      } else if (p.role === 'kaleci') {
        this.put(p, -s * (HL - 1.2), 0, s > 0 ? Math.PI / 2 : -Math.PI / 2)
      } else {
        this.put(p, s * (HL - BOX_D - 1.5), zs[i++ % zs.length], s > 0 ? Math.PI / 2 : -Math.PI / 2)
      }
    }
  }

  // korner, ayakla taç, kale vurusu, serbest vurus: yalniz taker ve yakin rakipler
  private formRestart(r: Restart) {
    const m = this.g.match
    const [tx, tz] = this.targetOf(r)
    const R = this.radiusOf(r)
    if (r.taker !== undefined) {
      const t = this.g.players[r.taker]
      const [sx, sz] = this.takerSpot(r)
      this.put(t, sx, sz, Math.atan2(tx - r.x, tz - r.z))
    }
    // baraj: savunan takimin kalesine 18 m'den yakin serbest vurus
    this.wallIds = []
    const def = (1 - r.team) as TeamId
    const gx = -m.attackDir[def] * HL
    if (r.type === 'freekick' && Math.hypot(gx - r.x, r.z) < 18) {
      const ux0 = gx - r.x
      const uz0 = -r.z
      const ul = Math.hypot(ux0, uz0) || 1
      const ux = ux0 / ul
      const uz = uz0 / ul
      const cand = this.g.players
        .filter((p) => p.team === def && !p.sentOff && p.role !== 'kaleci')
        .sort((a, b) => Math.hypot(a.x - r.x, a.z - r.z) - Math.hypot(b.x - r.x, b.z - r.z))
        .slice(0, 2)
      cand.forEach((p, i) => {
        const o = (i - (cand.length - 1) / 2) * 0.62
        // kaleye 5 m'den yakin vuruşta baraj kale cizgisinde
        const x = clamp(r.x + ux * WALL_DIST - uz * o, -HL + 0.3, HL - 0.3)
        const z = r.z + uz * WALL_DIST + ux * o
        this.put(p, x, z, Math.atan2(r.x - x, r.z - z))
        this.wallIds.push(p.id)
      })
    }
    for (const p of this.g.players) {
      if (p.sentOff || p.team === r.team || this.wallIds.includes(p.id)) continue
      const dx = p.x - r.x
      const dz = p.z - r.z
      if (Math.hypot(dx, dz) >= R) continue
      this.pushOut(p, r, R + 0.4)
    }
  }

  // rakibi topun R metre disina, saha icinde, mumkunse kendi kalesi tarafina koy
  private pushOut(p: Player, r: Restart, R: number) {
    const base = Math.atan2(p.z - r.z, p.x - r.x)
    for (let i = 0; i < 24; i++) {
      const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12)
      const x = r.x + Math.cos(a) * R
      const z = r.z + Math.sin(a) * R
      if (Math.abs(x) < HL - 0.4 && Math.abs(z) < HW - 0.4) {
        this.put(p, x, z, 0)
        p.facing = this.faceTo(p, r.x, r.z)
        return
      }
    }
  }

  private radiusOf(r: Restart) {
    return r.type === 'freekick' ? WALL_DIST : r.type === 'goalkick' ? 6 : RESTART_DIST
  }

  // vurusun dogal hedefi: hucum kalesi (serbest vurus, korner) ya da saha ici
  private targetOf(r: Restart): [number, number] {
    const d = this.g.match.attackDir[r.team]
    if (r.type === 'corner') return [d * (HL - SPOT_DIST), 0]
    if (r.type === 'kickin') return [r.x + d * 4, 0]
    if (r.type === 'goalkick') return [0, r.z * 0.5]
    return [d * HL, 0]
  }

  takerSpot(r: Restart): [number, number] {
    const [tx, tz] = this.targetOf(r)
    const dx = tx - r.x
    const dz = tz - r.z
    const l = Math.hypot(dx, dz) || 1
    const back = r.type === 'penalty' ? 1.3 : 0.75
    return [r.x - (dx / l) * back, r.z - (dz / l) * back]
  }

  private nearest(team: TeamId, x: number, z: number, keeper: boolean, except = -1): Player | undefined {
    let best: Player | undefined
    let bd = 1e9
    for (const p of this.g.players) {
      if (p.team !== team || p.sentOff || p.id === except) continue
      if (!keeper && p.role === 'kaleci') continue
      const d = Math.hypot(p.x - x, p.z - z)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best ?? (keeper ? undefined : this.nearest(team, x, z, true, except))
  }

  private pickTaker(r: Restart): number | undefined {
    const ps = this.g.players.filter((p) => p.team === r.team && !p.sentOff)
    if (r.type === 'goalkick') return (ps.find((p) => p.role === 'kaleci') ?? this.nearest(r.team, r.x, r.z, true))?.id
    if (r.type === 'kickoff' || r.type === 'penalty') {
      return (ps.find((p) => p.role === 'forvet') ?? ps.find((p) => p.role === 'orta') ?? this.nearest(r.team, r.x, r.z, false))?.id
    }
    // serbest vurus kendi ceza alaninda: kaleci de olabilir
    const d = this.g.match.attackDir[r.team]
    const ownBox = -d * r.x > HL - BOX_D && Math.abs(r.z) < BOX_W / 2
    return this.nearest(r.team, r.x, r.z, ownBox)?.id
  }

  // ------------------------------------------------------------------ hakem
  private updateReferee(gdt: number, b: BallLike) {
    // endirekt isaret: vurus sonrasi baska oyuncu degince ya da oyun durunca kol iner
    if (this.brain.gesture === 'indirect' && ((this.mode === 'play' && !this.indirect) || this.mode === 'stopped')) this.brain.clearGesture()
    const pt = this.possessionTeam()
    this.brain.update(
      this.g.referee,
      {
        ball: b,
        players: this.g.players,
        attackDir: pt === null ? 1 : this.g.match.attackDir[pt],
        focus: this.mode === 'stopped' ? this.focus : null,
      },
      gdt,
    )
    runTimers(this, gdt)
  }

  // ------------------------------------------------------------------ kirmizi kart: 30 s ceza
  /** oyuncu cezali: sahadan cikar (sentOff = oyun disi), 30 s canli oyun sonra kendi yarisindan doner */
  private suspend(p: Player) {
    p.sentOff = true
    p.hasBall = false
    const side: 1 | -1 = p.z >= 0 ? 1 : -1
    const sp: { left: number; side: 1 | -1; sub?: { id: number; role: Player['role'] } } = { left: RED_SUSPEND, side }
    // kaleci cezali: en yakin saha oyuncusu kaleciligi devralir, ceza bitince geri verir
    if (p.role === 'kaleci') {
      const own = -this.g.match.attackDir[p.team] * HL
      let best: Player | undefined
      let bd = 1e9
      for (const q of this.g.players) {
        if (q.team !== p.team || q.sentOff || q.id === p.id || q.role === 'kaleci') continue
        const d = Math.hypot(q.x - own, q.z)
        if (d < bd) {
          bd = d
          best = q
        }
      }
      if (best) {
        sp.sub = { id: best.id, role: best.role }
        best.role = 'kaleci'
      }
    }
    this.susp.set(p.id, sp)
    // insan kontrolundaysa en yakin takim arkadasina gecer (ceza bitince eski oyuncuya DONMEZ)
    if (p.controlled) {
      const alt = this.nearest(p.team, p.x, p.z, false, p.id)
      if (alt) this.control(p.team, alt.id)
    }
    this.syncSuspended()
  }

  private restoreRoles(id: number, sp: { sub?: { id: number; role: Player['role'] } }) {
    if (!sp.sub) return
    const q = this.g.players[sp.sub.id]
    if (q) q.role = sp.sub.role
    const p = this.g.players[id]
    if (p) p.role = 'kaleci'
  }

  /** yalniz canli oyunda (gdt > 0) akar; bitince oyuncu kendi kale tarafindaki dokunma cizgisinden girer */
  private tickSuspensions(gdt: number) {
    if (!this.susp.size) return
    for (const [id, sp] of this.susp) {
      sp.left -= gdt
      if (sp.left > 0) continue
      const p = this.g.players[id]
      this.susp.delete(id)
      this.exits.delete(id)
      if (!p) continue
      this.restoreRoles(id, sp)
      const own = -this.g.match.attackDir[p.team]
      Object.assign(p, {
        sentOff: false,
        yellow: 0,
        x: own * (HL - 6),
        z: sp.side * (HW - 0.4),
        vx: 0,
        vz: 0,
        facing: Math.atan2(-own * 4, -sp.side * 6),
        hasBall: false,
      })
      this.fouls[id] = 0
      const ev = { type: 'player-return', player: id } as unknown as GameEvent
      this.g.emit(ev)
      this.record(ev)
      this.say('info', 'OYUNA DÖNDÜ', `${p.name} (${TEAM_NAMES[p.team]} ${p.number})`, 2)
    }
    this.syncSuspended()
  }

  /** game.match.suspended: HUD ve ag senkronu icin {id, left} listesi */
  private syncSuspended() {
    ;(this.g.match as unknown as { suspended: { id: number; left: number }[] }).suspended = [...this.susp].map(([id, sp]) => ({ id, left: Math.max(0, sp.left) }))
  }

  // atilan oyuncu en yakin kenar cizgisine yuruyerek cikar (locomotion atlar; I vx,vz'den yurur)
  private walkOff(dt: number) {
    for (const p of this.g.players) {
      if (!p.sentOff) {
        this.exits.delete(p.id)
        continue
      }
      let e = this.exits.get(p.id)
      if (!e) {
        const sp = this.susp.get(p.id)
        const own = -this.g.match.attackDir[p.team]
        e = { x: sp ? own * (HL - 6) : clamp(p.x, -HL + 2, HL - 2), z: (sp ? sp.side : p.z >= 0 ? 1 : -1) * (HW + 3.5) }
        this.exits.set(p.id, e)
      }
      const dx = e.x - p.x
      const dz = e.z - p.z
      const d = Math.hypot(dx, dz)
      if (d < 0.05) {
        p.vx = p.vz = 0
        continue
      }
      const v = Math.min(WALK_OFF_V, d / Math.max(dt, 1e-3))
      p.vx = (dx / d) * v
      p.vz = (dz / d) * v
      p.x += p.vx * dt
      p.z += p.vz * dt
      p.facing = Math.atan2(dx, dz)
    }
  }

  // ------------------------------------------------------------------ yardimcilar
  private control(team: TeamId, id: number) {
    if (this.d.setControlled) this.d.setControlled(id)
    else for (const p of this.g.players) if (p.team === team) p.controlled = p.id === id
  }

  private setPhase(p: MatchPhase) {
    if (this.g.match.phase === p) return
    this.g.match.phase = p
    this.g.emit({ type: 'phase', phase: p })
  }

  say(kind: Banner['kind'], text: string, sub: string, dur: number) {
    this.banner = { id: ++this.bannerId, kind, text, sub, until: this.time + dur }
  }

  private record(e: GameEvent) {
    const m = this.g.match
    this.log.push({ t: this.time, half: m.half, clock: m.clock, e })
    if (this.log.length > 400) this.log.splice(0, 100)
  }

  // ------------------------------------------------------------------ VAR: sahada inceleme
  private handleVarEvents() {
    const q = this.varQ
    if (!q.length) return
    this.varQ = []
    for (const e of q) {
      if (e.type === 'var-start') {
        if (!this.varS && this.mode !== 'fulltime') this.beginVar(e.reason)
      } else if (e.type === 'var-decision') {
        if (!this.varS) this.beginVar(e.reason)
        this.varS!.verdict = e.verdict
      }
    }
  }

  private beginVar(reason: string) {
    this.varS = { stage: 'listen', t: 0, reason, verdict: null, prev: this.mode }
    this.adv = null
    this.g.match.advantageUntil = 0
    this.setPhase('var')
    this.brain.gestureFor('var-listen', 1.0)
    const why = reason === 'offside' ? 'Ofsayt kontrolü' : reason === 'line' ? 'Çizgi kontrolü' : 'İnceleme'
    this.say('var', 'VAR', why, 1e9)
  }

  /** monitor yaninda durulacak nokta: ekran normalinde 0.9 m, ekranin sagina 0.7 m (toplam ~1.14 m, ~38 derece), yuz ekrana; kamerayi kapatmaz */
  varStand() {
    const M = this.d.varMonitor?.() ?? { x: 0, z: -(HW + 1.6), facing: 0 }
    const fx = Math.sin(M.facing)
    const fz = Math.cos(M.facing)
    const x = M.x + fx * VAR_STAND_FWD + fz * VAR_STAND_SIDE // ekranin sagi = (cos f, -sin f)
    const z = M.z + fz * VAR_STAND_FWD - fx * VAR_STAND_SIDE
    return { x, z, facing: Math.atan2(M.x - x, M.z - z) }
  }

  private updateVar(rdt: number) {
    const v = this.varS!
    if (rdt <= 0) return
    v.t += rdt
    const ref = this.g.referee
    const stand = this.varStand()
    let goto: typeof stand | null = stand
    switch (v.stage) {
      case 'listen':
        goto = { x: ref.x, z: ref.z, facing: ref.facing } // yerinde dur (hizi sonumlenir), eli kulakta
        if (v.t >= 0.7) {
          v.stage = 'run'
          v.t = 0
          this.brain.clearGesture()
        }
        break
      case 'run':
        if (this.brain.at(ref, stand.x, stand.z, 0.6)) {
          v.stage = 'monitor'
          v.t = 0
          this.brain.gestureFor('var-monitor', 1e9)
        }
        break
      case 'monitor':
        if (v.verdict && v.t >= 1) {
          v.stage = 'signal'
          v.t = 0
          this.brain.gestureFor('var-signal', 1.5)
        }
        break
      case 'signal':
        if (v.t >= 1.5) {
          this.varS = null
          this.brain.clearGesture()
          if (this.banner?.kind === 'var') this.banner = null
          this.applyVerdict(v.verdict!, v.prev)
          return
        }
        break
    }
    const pt = this.possessionTeam()
    this.brain.update(
      ref,
      { ball: this.d.ball(), players: this.g.players, attackDir: pt === null ? 1 : this.g.match.attackDir[pt], focus: null, goto },
      rdt,
    )
    runTimers(this, rdt)
  }

  /** VAR kararini uygula: duduk + yeniden baslatma. */
  applyVerdict(vd: VarVerdict, prev: Mode = this.mode) {
    const m = this.g.match
    const b = this.d.ball()
    const lg = this.lastGoal
    const side: 1 | -1 = lg ? lg.side : b.x >= 0 ? 1 : -1
    const defending: TeamId = m.attackDir[0] === side ? 1 : 0
    const attacking = (1 - defending) as TeamId
    const undo = () => {
      if (!this.lastGoal) return false
      const t = this.lastGoal.team
      if (m.score[t] > 0) m.score[t]--
      this.lastGoal = null
      return true
    }
    const wait = 1.4
    switch (vd) {
      case 'gol':
        if (lg) {
          this.stop('var', { type: 'kickoff', team: (1 - lg.team) as TeamId, x: 0, z: 0 }, wait, null)
          this.say('var', 'GOL GEÇERLİ', 'VAR kararı', 2.2)
        } else this.goal(attacking)
        return
      case 'gol-degil': {
        const had = undo()
        this.stop('var', { type: 'goalkick', team: defending, x: side * (HL - 2), z: 0 }, wait, null)
        this.say('var', had ? 'GOL İPTAL' : 'GOL DEĞİL', 'Top çizgiyi geçmedi', 2.4)
        return
      }
      case 'ofsayt': {
        undo()
        const s = this.lastSnap
        let pos = { x: b.x, z: b.z }
        let team = defending
        let who: Player | undefined
        if (s) {
          team = (1 - s.team) as TeamId
          let id = s.involved
          if (id === null || !s.margins.has(id)) {
            let best = -1e9
            s.margins.forEach((r, k) => {
              if (r.margin > best) {
                best = r.margin
                id = k
              }
            })
          }
          const r = id !== null ? s.margins.get(id) : undefined
          if (r) pos = { x: r.x, z: r.z }
          who = id !== null ? this.g.players[id] : undefined
        }
        if (who) {
          const ev: GameEvent = { type: 'offside', player: who.id, x: pos.x, z: pos.z }
          this.g.emit(ev)
          this.record(ev)
        }
        const x = clamp(pos.x, -HL + 0.5, HL - 0.5)
        const z = clamp(pos.z, -HW + 0.5, HW - 0.5)
        this.stop('var', { type: 'freekick', team, x, z, indirect: true }, wait, { x, z })
        this.say('var', 'OFSAYT', who ? `${who.name} · gol iptal` : 'VAR kararı', 2.4)
        return
      }
      case 'korner':
        undo()
        this.stop('var', { type: 'corner', team: attacking, x: side * (HL - 0.35), z: (b.z >= 0 ? 1 : -1) * (HW - 0.35) }, wait, null)
        this.say('var', 'KORNER', 'VAR kararı', 2.2)
        return
      case 'kale-vurusu':
        undo()
        this.stop('var', { type: 'goalkick', team: defending, x: side * (HL - 2), z: 0 }, wait, null)
        this.say('var', 'KALE VURUŞU', 'VAR kararı', 2.2)
        return
      case 'kickin':
      case 'aut': {
        undo()
        const lt = m.lastTouch
        const team: TeamId = lt ? ((1 - lt.team) as TeamId) : defending
        this.stop('var', { type: 'kickin', team, x: clamp(b.x, -HL + 0.6, HL - 0.6), z: (b.z >= 0 ? 1 : -1) * (HW - 0.12) }, wait, null)
        this.say('var', 'TAÇ', 'VAR kararı', 2.2)
        return
      }
    }
    void prev
  }

  // ------------------------------------------------------------------ VAR (G)
  /** G'nin VAR karari. Bkz. src/rules/api.ts */
  varDecision(
    d:
      | { kind: 'goal-stand' }
      | { kind: 'resume' }
      | { kind: 'goal-cancel'; team: TeamId; restart?: Restart }
      | { kind: 'penalty'; team: TeamId }
      | { kind: 'freekick'; team: TeamId; x: number; z: number }
      | { kind: 'red'; player: number },
  ) {
    const m = this.g.match
    this.varS = null
    this.brain.clearGesture()
    const back = () => {
      // var fazindan cik: duraklamadaysa kaldigi yerden, oyundaysa 'play'
      const ph: MatchPhase =
        this.mode === 'play' ? 'play' : this.mode === 'stopped' ? 'stopped' : this.mode === 'halftime' ? 'halftime' : this.mode === 'fulltime' ? 'fulltime' : phaseOf[this.pending?.type ?? 'kickoff']
      m.phase = 'stopped' // setPhase degisikligi kesin yaysin
      this.setPhase(ph)
    }
    switch (d.kind) {
      case 'goal-stand':
      case 'resume':
        back()
        return
      case 'goal-cancel': {
        if (m.score[d.team] > 0) m.score[d.team]--
        const def = (1 - d.team) as TeamId
        const s = m.attackDir[d.team]
        const r = d.restart ?? { type: 'goalkick', team: def, x: s * (HL - 2), z: 0 }
        this.say('var', 'GOL İPTAL', 'VAR incelemesi', 3)
        this.stop('var', { ...r }, 1.5, null)
        back()
        return
      }
      case 'penalty': {
        const s = m.attackDir[d.team]
        this.say('var', 'PENALTI', 'VAR incelemesi', 3)
        this.stop('var', { type: 'penalty', team: d.team, x: s * (HL - SPOT_DIST), z: 0 }, 1.5, null)
        back()
        return
      }
      case 'freekick':
        this.stop('var', { type: 'freekick', team: d.team, x: d.x, z: d.z }, 1.5, null)
        back()
        return
      case 'red':
        this.cards.push({ player: d.player, color: 'red' })
        if (this.mode === 'play') {
          const p = this.g.players[d.player]
          const b = this.d.ball()
          this.stop('var', { type: 'freekick', team: (1 - p.team) as TeamId, x: b.x, z: b.z }, 1.5, null)
        } else this.applyCards()
        back()
        return
    }
  }
}

// --- oyun zamanina bagli kucuk gecikmeler (setTimeout yerine; yavas cekim/VAR'da durur)
const timers = new WeakMap<Rules, { t: number; f: () => void }[]>()
function setTimeoutLike(r: Rules, t: number, f: () => void) {
  const l = timers.get(r) ?? []
  l.push({ t, f })
  timers.set(r, l)
}
function runTimers(r: Rules, dt: number) {
  const l = timers.get(r)
  if (!l || !l.length) return
  const due: (() => void)[] = []
  for (let i = l.length - 1; i >= 0; i--) {
    l[i].t -= dt
    if (l[i].t <= 0) {
      due.push(l[i].f)
      l.splice(i, 1)
    }
  }
  due.reverse().forEach((f) => f())
}
