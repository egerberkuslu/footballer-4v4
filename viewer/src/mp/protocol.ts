// Tel bicimi (L). PeerJS 'json' serilestirme, tek guvenilir+sirali kanal.
// GUVEN SINIRI: gelen her mesaj decode() ile dogrulanir; gecmeyen dusurulur.
import type { AnimState, GameEvent, MatchPhase, PlayerInput, RefAnim, Restart, Role, TeamId } from '../game/types'

export const PROTO = 1
/** derleme imzasi: farkli fizik/protokol surumu odaya alinmaz */
export const BUILD = 'f4v4-mp-1'
export const PEER_PREFIX = 'futbol4v4-'
export const CODE_LEN = 5
// karisan harfler (0/O, 1/I/L) yok
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export const SNAP_HZ = 20
export const INPUT_HZ = 30
export const INTERP_DELAY = 0.1 // s
export const MAX_NAME = 16
export const MAX_CHAT = 140
export const EMOTES = ['👏', '🔥', '😂', '😮', '😡', '👍', '⚽', '🧤'] as const

export function randomCode(): string {
  let s = ''
  const r = new Uint32Array(CODE_LEN)
  crypto.getRandomValues(r)
  for (let i = 0; i < CODE_LEN; i++) s += ALPHA[r[i] % ALPHA.length]
  return s
}

export function normalizeCode(c: string): string {
  return c
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LEN)
}

export const validCode = (c: string) => c.length === CODE_LEN && [...c].every((ch) => ALPHA.includes(ch))

export function cleanName(s: unknown): string {
  const t = typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME) : ''
  return t || 'Oyuncu'
}

export function cleanChat(s: unknown): string {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_CHAT) : ''
}

// ---------------------------------------------------------------- tipler
export type Side = TeamId | null // null = izleyici

export interface Settings {
  halfMin: number // devre suresi (dk)
  ai: 'kolay' | 'orta' | 'zor'
  fill: boolean // bos yerler botla dolsun mu
}

export interface Member {
  id: string // 'host' ya da misafir anahtari (token)
  name: string
  side: Side
  ready: boolean
  ping: number // ms, -1 bilinmiyor
  online: boolean
  host: boolean
}

export interface Lobby {
  code: string
  members: Member[]
  settings: Settings
  stage: 'lobby' | 'match'
  /** uye id -> oyuncu id (macta) */
  assign: Record<string, number>
}

export interface Chat {
  from: string
  text: string
  emote?: boolean
  sys?: boolean
}

export type Action = NonNullable<PlayerInput['action']>

// misafir -> host
export type GuestMsg =
  | { t: 'hello'; v: number; build: string; name: string; token: string }
  | { t: 'pref'; side: Side; ready: boolean; name?: string }
  | { t: 'in'; s: number; mx: number; mz: number; sp: boolean; as: number; a: Action | null }
  | { t: 'chat'; text: string }
  | { t: 'emo'; e: number }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'bye' }

// host -> misafir
export type HostMsg =
  | { t: 'welcome'; you: string; lobby: Lobby }
  | { t: 'lobby'; lobby: Lobby }
  | { t: 'deny'; reason: string }
  | { t: 'kick'; reason: string }
  | { t: 'start'; lobby: Lobby }
  | { t: 'stop' }
  | { t: 'chat'; c: Chat }
  | { t: 'emo'; from: string; e: number }
  | { t: 'ev'; ht: number; e: GameEvent }
  | { t: 'var'; on: boolean; verdict?: unknown; reason?: string }
  | { t: 's'; snap: Snap }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'bye'; reason: string }

// ---------------------------------------------------------------- snapshot
export const ANIMS: AnimState[] = [
  'idle', 'jog', 'run', 'sprint', 'dribble', 'kick', 'pass', 'tackle', 'slide', 'fall', 'getup',
  'celebrate', 'throwin', 'keeper-dive-l', 'keeper-dive-r', 'keeper-catch', 'header', 'rabona',
]
export const REF_ANIMS: RefAnim[] = [
  'idle', 'jog', 'run', 'whistle', 'point', 'card-yellow', 'card-red', 'advantage', 'var-listen', 'var-monitor', 'var-signal',
]
export const PHASES: MatchPhase[] = [
  'kickoff', 'play', 'stopped', 'freekick', 'penalty', 'corner', 'kickin', 'goalkick', 'halftime', 'fulltime', 'var',
]
export const P_STRIDE = 11 // x,z,vx,vz,facing,anim,animT,flags,stamina,yellow,actionLock
// flags: bit0 top, bit1 kirmizi (cezali), bit2-3 rol (ROLES indeksi; kaleci kirmizisinde rol devri senkronu)
export const ROLES: Role[] = ['kaleci', 'defans', 'orta', 'forvet']

export interface Banner {
  id: number
  kind: string
  text: string
  sub?: string
  until: number
}

export interface Snap {
  q: number // sira
  ht: number // host saati (s)
  ack: number // bu misafirin uygulanan son girdi sirasi
  aa: number // uygulanan son aksiyon sirasi
  ag: number // ack girdisinin host'a varisindan beri gecen sure (s)
  ts: number // world.timeScale
  b: number[] // x,y,z,vx,vy,vz,qx,qy,qz,qw
  p: number[] // oyuncu basina P_STRIDE
  r: number[] // hakem: x,z,vx,vz,facing,anim,animT
  m: number[] // phase,clock,half,s0,s1,ad0,ad1,halfLength,advUntil
  rs: Restart | null
  lt: { player: number; team: TeamId; t: number } | null
  bn: Banner | null
  sus?: [number, number][] // kirmizi kart cezalari: [oyuncu, kalan s]; sayac host'ta akar, misafir gosterir
}

// ---------------------------------------------------------------- dogrulama
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x))
const isSide = (x: unknown): x is Side => x === 0 || x === 1 || x === null
const ACTS = new Set(['shoot', 'pass', 'lob', 'tackle', 'slide', 'dive', 'header'])

function vec(x: unknown) {
  if (!isObj(x) || !fin(x.x) || !fin(x.y) || !fin(x.z)) return null
  const lim = (v: number) => Math.max(-200, Math.min(200, v))
  return { x: lim(x.x), y: lim(x.y), z: lim(x.z) }
}

function action(x: unknown): Action | null {
  if (!isObj(x) || typeof x.type !== 'string' || !ACTS.has(x.type) || !fin(x.power)) return null
  const aim = vec(x.aim)
  if (!aim) return null
  const a: Action = { type: x.type as Action['type'], power: Math.max(0, Math.min(1.3, x.power)), aim }
  const sp = x.spin === undefined ? null : vec(x.spin)
  if (sp) a.spin = sp
  return a
}

/** host'ta: misafir mesaji. Gecersizse null. */
export function decodeGuest(d: unknown): GuestMsg | null {
  if (!isObj(d) || typeof d.t !== 'string') return null
  switch (d.t) {
    case 'hello':
      if (!fin(d.v) || typeof d.build !== 'string' || typeof d.token !== 'string' || d.token.length > 40) return null
      return { t: 'hello', v: d.v, build: d.build, name: cleanName(d.name), token: d.token }
    case 'pref':
      if (!isSide(d.side) || typeof d.ready !== 'boolean') return null
      return { t: 'pref', side: d.side, ready: d.ready, name: d.name === undefined ? undefined : cleanName(d.name) }
    case 'in':
      if (!fin(d.s) || !fin(d.mx) || !fin(d.mz) || !fin(d.as)) return null
      return { t: 'in', s: d.s, mx: clamp1(d.mx), mz: clamp1(d.mz), sp: !!d.sp, as: d.as, a: d.a == null ? null : action(d.a) }
    case 'chat': {
      const text = cleanChat(d.text)
      return text ? { t: 'chat', text } : null
    }
    case 'emo':
      return fin(d.e) && d.e >= 0 && d.e < EMOTES.length ? { t: 'emo', e: d.e | 0 } : null
    case 'ping':
    case 'pong':
      return fin(d.ts) ? { t: d.t, ts: d.ts } : null
    case 'bye':
      return { t: 'bye' }
  }
  return null
}

/** misafirde: host mesaji (host guvenilir sayilir; yalniz bicim denetimi) */
export function decodeHost(d: unknown): HostMsg | null {
  if (!isObj(d) || typeof d.t !== 'string') return null
  switch (d.t) {
    case 's':
      return isObj(d.snap) && Array.isArray(d.snap.p) && Array.isArray(d.snap.b) && fin(d.snap.ht) ? (d as unknown as HostMsg) : null
    case 'welcome':
    case 'lobby':
    case 'start':
      return isObj(d.lobby) && Array.isArray(d.lobby.members) ? (d as unknown as HostMsg) : null
    case 'ev':
      return isObj(d.e) && fin(d.ht) ? (d as unknown as HostMsg) : null
    case 'chat':
      return isObj(d.c) && typeof d.c.text === 'string' ? (d as unknown as HostMsg) : null
    case 'emo':
      return fin(d.e) && d.e >= 0 && d.e < EMOTES.length ? (d as unknown as HostMsg) : null
    case 'ping':
    case 'pong':
      return fin(d.ts) ? (d as unknown as HostMsg) : null
    case 'deny':
    case 'kick':
    case 'bye':
      return { t: d.t, reason: typeof d.reason === 'string' ? d.reason.slice(0, 120) : '' }
    case 'stop':
      return { t: 'stop' }
    case 'var':
      return { t: 'var', on: !!d.on, verdict: d.verdict, reason: typeof d.reason === 'string' ? d.reason : '' }
  }
  return null
}

/** sayi yuvarlama (JSON boyutu) */
export const r3 = (x: number) => Math.round(x * 1000) / 1000
export const r2 = (x: number) => Math.round(x * 100) / 100
