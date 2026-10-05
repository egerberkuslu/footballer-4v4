// Cok oyunculu oturum (L): lobi, uyeler, sohbet, mac baslatma; host-otorite.
// UI (Lobby.tsx) mp durumunu useSyncExternalStore ile okur. Kare isi sync.ts'de.
import type { DataConnection } from 'peerjs'
import { setMode } from '../control/actions'
import { setControlled } from '../control/locomotion'
import { setAiLevel } from '../ai/config'
import { game } from '../game/store'
import type { GameEvent, TeamId } from '../game/types'
import { rules } from '../rules/instance'
import { bumpVar, endRemoteReview, startRemoteReview, varState, type VarCase } from '../var/store'
import { withCurtain } from '../ui/curtain'
import { keep, net } from './role'
import {
  BUILD, EMOTES, PROTO, cleanChat, cleanName, decodeGuest, decodeHost, normalizeCode, validCode,
  type Chat, type HostMsg, type Lobby, type Member, type Settings, type Side, type Snap,
} from './protocol'
import { GuestTransport, HostTransport } from './transport'
import { forwardable, guestOnEvent, guestOnSnap, guestReset, guestSetRtt, hostNow, hostOnInput as hostOnInputMsg, type RemoteIn } from './sync'

export type Screen = 'none' | 'menu' | 'mp' | 'lobby'
export type ConnState = 'idle' | 'connecting' | 'ok' | 'reconnecting' | 'lost'

export interface EmoteFx {
  id: number
  from: string
  e: string
  at: number
}

const NAME_KEY = 'mp.name'
const loadName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || ''
  } catch {
    return ''
  }
}

// yeniden baglanmada ayni uye kalmak icin sekmeye ozel anahtar
function token(): string {
  try {
    let t = sessionStorage.getItem('mp.token')
    if (!t) {
      t = Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
      sessionStorage.setItem('mp.token', t)
    }
    return t
  } catch {
    return Math.random().toString(36).slice(2, 12)
  }
}

export const mp = keep('mp', () => ({
  screen: 'none' as Screen,
  conn: 'idle' as ConnState,
  error: '',
  info: '',
  name: loadName(),
  me: '', // uye id
  lobby: null as Lobby | null,
  chat: [] as Chat[],
  emotes: [] as EmoteFx[],
  ping: -1, // ms (misafirde host'a)
  inMatch: false,
}))

const S = keep('subs', () => ({ subs: new Set<() => void>(), ver: 0 }))
export const subscribeMp = (f: () => void) => {
  S.subs.add(f)
  return () => {
    S.subs.delete(f)
  }
}
export const mpVersion = () => S.ver
export function bumpMp() {
  S.ver++
  S.subs.forEach((f) => f())
}

export function setScreen(s: Screen) {
  mp.screen = s
  mp.error = ''
  bumpMp()
}

export function setName(n: string) {
  mp.name = n.slice(0, 16)
  try {
    localStorage.setItem(NAME_KEY, mp.name)
  } catch {
    /* depolama yok */
  }
  bumpMp()
}

function addChat(c: Chat) {
  mp.chat.push(c)
  if (mp.chat.length > 60) mp.chat.shift()
  bumpMp()
}

let emoteId = 0
function addEmote(from: string, e: number) {
  const em = EMOTES[e]
  if (!em) return
  mp.emotes.push({ id: ++emoteId, from, e: em, at: performance.now() })
  if (mp.emotes.length > 8) mp.emotes.shift()
  addChat({ from, text: em, emote: true })
}

// uzak insanlar: net.remote (mp/role) + game.remote (koordinator store'u) birlikte
function addRemote(id: number) {
  net.remote.add(id)
  game.remote.add(id)
}
function delRemote(id: number) {
  net.remote.delete(id)
  game.remote.delete(id)
}
function clearRemote() {
  net.remote.clear()
  game.remote.clear()
}

// =================================================================== tek oyunculu kisayollar
export function playSolo(mode: 'antrenman' | 'mac') {
  leave()
  setMode(mode)
  if (mode === 'mac') {
    game.humanTeam = 0
    rules.start()
    for (const p of game.players) p.sentOff = false
  }
  setScreen('none')
}

// =================================================================== HOST
interface Guest {
  conn: DataConnection | null
  member: Member
  rin: RemoteIn
  pingAt: number
}

const H = keep('host', () => ({
  tr: null as HostTransport | null,
  guests: new Map<string, Guest>(), // token -> misafir
  byConn: new Map<DataConnection, string>(),
  banned: new Set<string>(),
  offGame: null as null | (() => void),
  timer: 0,
  lastVar: false,
}))

export const hostRemotes = () => {
  const out: RemoteIn[] = []
  for (const g of H.guests.values()) if (g.member.online && g.rin.pid >= 0) out.push(g.rin)
  return out
}

const DEFAULT_SETTINGS: Settings = { halfMin: 3, ai: 'orta', fill: true }

export function hostCreate() {
  leave()
  setMode('antrenman') // mac baslayinca gercek mod gecisi olsun (App kapilari yeniden cizilsin)
  const name = cleanName(mp.name)
  mp.conn = 'connecting'
  mp.error = ''
  mp.info = 'Oda açılıyor…'
  mp.me = 'host'
  mp.chat = []
  bumpMp()
  const tr = new HostTransport({
    open: (code) => {
      mp.lobby = {
        code,
        members: [{ id: 'host', name, side: 0, ready: true, ping: 0, online: true, host: true }],
        settings: { ...DEFAULT_SETTINGS },
        stage: 'lobby',
        assign: {},
      }
      mp.conn = 'ok'
      mp.info = ''
      net.role = 'host'
      mp.screen = 'lobby'
      addChat({ from: '', text: `Oda kuruldu: ${code}`, sys: true })
      bumpMp()
    },
    conn: () => {
      /* hello bekleniyor */
    },
    data: (c, d) => hostOnData(c, d),
    close: (c) => {
      const id = H.byConn.get(c)
      H.byConn.delete(c)
      const g = id ? H.guests.get(id) : undefined
      if (!g || g.conn !== c) return
      g.conn = null
      g.member.online = false
      delRemote(g.rin.pid)
      addChat({ from: '', text: `${g.member.name} bağlantısı koptu`, sys: true })
      hostBroadcastLobby()
      // lobide uzun sure donmezse cikar; macta yeri bot alir (yeniden baglanirsa geri verilir)
      setTimeout(() => {
        const cur = H.guests.get(id!)
        if (cur && !cur.member.online && mp.lobby?.stage === 'lobby') {
          H.guests.delete(id!)
          hostBroadcastLobby()
        }
      }, 45000)
    },
    error: (msg, fatal) => {
      mp.error = msg
      if (fatal) {
        mp.conn = 'lost'
        leave(true)
        mp.info = ''
        mp.screen = 'mp'
      }
      bumpMp()
    },
  })
  H.tr = tr
  tr.open()
  H.offGame = game.on((e: GameEvent) => {
    if (!mp.inMatch || !forwardable(e)) return
    hostSendAll({ t: 'ev', ht: hostNow(), e })
  })
  H.timer = window.setInterval(hostTick, 1000)
}

function hostSend(g: Guest, m: HostMsg) {
  if (g.conn && H.tr) H.tr.send(g.conn, m)
}

export function hostSendAll(m: HostMsg) {
  for (const g of H.guests.values()) hostSend(g, m)
}

/** -0.4 snapshot'i her misafire kendi ack'iyle */
export function hostSendSnap(body: Omit<Snap, 'ack' | 'aa' | 'ag'>) {
  for (const g of H.guests.values()) {
    if (!g.conn) continue
    hostSend(g, { t: 's', snap: { ...body, ack: g.rin.s, aa: g.rin.as, ag: Math.round((hostNow() - g.rin.at) * 1000) / 1000 } })
  }
}

function hostTick() {
  const t = performance.now()
  for (const g of H.guests.values()) {
    if (g.conn) hostSend(g, { t: 'ping', ts: t })
  }
  hostBroadcastLobby()
}

/** host'un VAR durumu misafire (kare basina NetSync cagirir) */
export function hostVarWatch() {
  const on = varState.active
  if (on === H.lastVar) return
  H.lastVar = on
  hostSendAll({ t: 'var', on, verdict: on ? varState.case : undefined, reason: varState.reason })
}

function lobbyMembers(): Member[] {
  if (!mp.lobby) return []
  const host = mp.lobby.members.find((m) => m.host)!
  return [host, ...[...H.guests.values()].map((g) => g.member)]
}

export function hostBroadcastLobby() {
  if (!mp.lobby || net.role !== 'host') return
  mp.lobby.members = lobbyMembers()
  hostSendAll({ t: 'lobby', lobby: mp.lobby })
  bumpMp()
}

const teamCount = (side: TeamId, except = '') => lobbyMembers().filter((m) => m.side === side && m.id !== except).length

function hostOnData(c: DataConnection, d: unknown) {
  const m = decodeGuest(d)
  if (!m || !mp.lobby) return
  if (m.t === 'hello') {
    const deny = (reason: string) => {
      H.tr?.send(c, { t: 'deny', reason })
      setTimeout(() => c.close(), 300)
    }
    if (m.v !== PROTO || m.build !== BUILD) return deny('Sürüm uyuşmuyor; sayfayı yenileyin')
    if (H.banned.has(m.token)) return deny('Bu odadan uzaklaştırıldınız')
    let g = H.guests.get(m.token)
    if (g) {
      // yeniden baglanma
      if (g.conn && g.conn !== c) g.conn.close()
      g.conn = c
      g.member.online = true
      g.member.name = m.name
      if (mp.lobby.stage === 'match' && g.rin.pid >= 0) addRemote(g.rin.pid)
      addChat({ from: '', text: `${m.name} yeniden bağlandı`, sys: true })
    } else {
      if (H.guests.size >= 15) return deny('Oda dolu')
      // bos takima yerlestir, ikisi de doluysa izleyici
      const side: Side = teamCount(1) < 4 && teamCount(1) <= teamCount(0) ? 1 : teamCount(0) < 4 ? 0 : teamCount(1) < 4 ? 1 : null
      g = {
        conn: c,
        member: { id: m.token, name: m.name, side, ready: false, ping: -1, online: true, host: false },
        rin: { pid: -1, mx: 0, mz: 0, sp: false, s: 0, as: 0, act: null, at: 0 },
        pingAt: 0,
      }
      H.guests.set(m.token, g)
      addChat({ from: '', text: `${m.name} odaya katıldı`, sys: true })
    }
    H.byConn.set(c, m.token)
    mp.lobby.members = lobbyMembers()
    hostSend(g, { t: 'welcome', you: m.token, lobby: mp.lobby })
    if (mp.lobby.stage === 'match') hostSend(g, { t: 'start', lobby: mp.lobby })
    hostBroadcastLobby()
    return
  }
  const id = H.byConn.get(c)
  const g = id ? H.guests.get(id) : undefined
  if (!g) return
  switch (m.t) {
    case 'in':
      if (g.rin.pid >= 0) hostOnInputMsg(g.rin, m)
      break
    case 'pref':
      if (mp.lobby.stage !== 'lobby') break
      if (m.side !== null && m.side !== g.member.side && teamCount(m.side, g.member.id) >= 4) break
      g.member.side = m.side
      g.member.ready = m.ready
      if (m.name) g.member.name = m.name
      hostBroadcastLobby()
      break
    case 'chat':
      hostRelayChat({ from: g.member.name, text: m.text })
      break
    case 'emo':
      hostSendAll({ t: 'emo', from: g.member.name, e: m.e })
      addEmote(g.member.name, m.e)
      break
    case 'ping':
      hostSend(g, { t: 'pong', ts: m.ts })
      break
    case 'pong':
      g.member.ping = Math.round(performance.now() - m.ts)
      bumpMp()
      break
    case 'bye':
      g.conn?.close()
      break
  }
}


function hostRelayChat(c: Chat) {
  hostSendAll({ t: 'chat', c })
  addChat(c)
}

export function hostSetSettings(s: Partial<Settings>) {
  if (!mp.lobby || net.role !== 'host') return
  Object.assign(mp.lobby.settings, s)
  if (s.ai) setAiLevel(s.ai)
  hostBroadcastLobby()
}

function hostSetPref(side: Side, ready: boolean) {
  const h = mp.lobby?.members.find((m) => m.host)
  if (!h || mp.lobby?.stage !== 'lobby') return
  if (side !== null && side !== h.side && teamCount(side, 'host') >= 4) return
  h.side = side
  h.ready = ready
  hostBroadcastLobby()
}

export function hostKick(id: string, ban = false) {
  const g = H.guests.get(id)
  if (!g) return
  if (ban) H.banned.add(id)
  hostSend(g, { t: 'kick', reason: ban ? 'Odadan uzaklaştırıldınız' : 'Odadan çıkarıldınız' })
  const c = g.conn
  setTimeout(() => c?.close(), 300)
  H.guests.delete(id)
  delRemote(g.rin.pid)
  addChat({ from: '', text: `${g.member.name} ${ban ? 'uzaklaştırıldı' : 'çıkarıldı'}`, sys: true })
  hostBroadcastLobby()
}

/** uyeleri oyunculara dagit: forvet, orta, defans, kaleci sirasiyla */
function assignPlayers(members: Member[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const team of [0, 1] as TeamId[]) {
    const slots = [3, 2, 1, 0]
    for (const m of members) {
      if (m.side !== team || !m.online) continue
      const s = slots.shift()
      if (s === undefined) break
      out[m.id] = team * 4 + s
    }
  }
  return out
}

/** uye listesine gore yerel oyunu kur (host ve misafir ortak) */
function setupLocal(lobby: Lobby) {
  const lp = lobby.assign[mp.me] ?? -1
  net.localPlayer = lp
  const me = lobby.members.find((m) => m.id === mp.me)
  game.humanTeam = lp >= 0 ? (game.players[lp].team as TeamId) : null
  game.resetInputs()
  if (lp >= 0) setControlled(lp)
  else for (const p of game.players) p.controlled = false
  setMode('mac')
  void me
}

export function hostStart() {
  void withCurtain(hostStartNow, 'Maça giriliyor')
}

function hostStartNow() {
  const L = mp.lobby
  if (!L || net.role !== 'host') return
  L.members = lobbyMembers()
  L.assign = assignPlayers(L.members)
  L.stage = 'match'
  clearRemote()
  for (const g of H.guests.values()) {
    const pid = L.assign[g.member.id] ?? -1
    Object.assign(g.rin, { pid, mx: 0, mz: 0, sp: false, act: null })
    if (pid >= 0 && g.member.online) addRemote(pid)
  }
  setAiLevel(L.settings.ai)
  setupLocal(L)
  rules.start()
  const half = Math.max(1, Math.min(45, L.settings.halfMin)) * 60
  game.match.halfLength = half
  ;(rules as unknown as { d: { halfLength?: number } }).d.halfLength = half
  // botsuz: insansiz oyuncular sahada yok
  const used = new Set(Object.values(L.assign))
  for (const p of game.players) p.sentOff = !L.settings.fill && !used.has(p.id)
  mp.inMatch = true
  mp.screen = 'none'
  H.lastVar = false
  hostSendAll({ t: 'start', lobby: L })
  addChat({ from: '', text: 'Maç başladı', sys: true })
  bumpMp()
}

/** maci bitir, lobiye don (host) */
export function hostStop() {
  if (!mp.lobby || net.role !== 'host') return
  mp.lobby.stage = 'lobby'
  for (const m of mp.lobby.members) if (!m.host) m.ready = false
  for (const g of H.guests.values()) g.member.ready = false
  hostSendAll({ t: 'stop' })
  endMatchLocal()
  hostBroadcastLobby()
}

function endMatchLocal() {
  mp.inMatch = false
  net.localPlayer = -1
  clearRemote()
  for (const p of game.players) p.sentOff = false
  game.humanTeam = 0
  setMode('antrenman')
  mp.screen = 'lobby'
  bumpMp()
}

// =================================================================== MISAFIR
const C = keep('guest', () => ({
  tr: null as GuestTransport | null,
  timer: 0,
}))

export function guestJoin(codeIn: string) {
  const code = normalizeCode(codeIn)
  if (!validCode(code)) {
    mp.error = 'Oda kodu 5 karakter olmalı'
    bumpMp()
    return
  }
  leave()
  setMode('antrenman')
  mp.conn = 'connecting'
  mp.error = ''
  mp.info = `${code} odasına bağlanılıyor…`
  mp.chat = []
  bumpMp()
  const tok = token()
  const tr = new GuestTransport(code, {
    open: () => {
      mp.conn = 'ok'
      mp.info = ''
      tr.send({ t: 'hello', v: PROTO, build: BUILD, name: cleanName(mp.name), token: tok })
      bumpMp()
    },
    data: (d) => guestOnData(d),
    drop: () => {
      mp.conn = 'reconnecting'
      mp.info = 'Bağlantı koptu, yeniden bağlanılıyor…'
      bumpMp()
    },
    lost: (msg) => {
      const wasMatch = mp.inMatch
      mp.error = msg
      mp.conn = 'lost'
      leave(true)
      mp.info = ''
      if (wasMatch) endMatchLocal()
      mp.screen = 'mp'
      bumpMp()
    },
  })
  C.tr = tr
  tr.start()
  C.timer = window.setInterval(() => tr.send({ t: 'ping', ts: performance.now() }), 1000)
}

export function guestSend(m: unknown) {
  C.tr?.send(m)
}

function guestOnData(d: unknown) {
  const m = decodeHost(d)
  if (!m) return
  switch (m.t) {
    case 's':
      if (mp.inMatch) guestOnSnap(m.snap)
      break
    case 'welcome':
      mp.me = m.you
      mp.lobby = m.lobby
      net.role = 'guest'
      if (mp.screen !== 'none' || !mp.inMatch) mp.screen = 'lobby'
      bumpMp()
      break
    case 'lobby': {
      const stage = mp.lobby?.stage
      mp.lobby = m.lobby
      if (stage === 'match' && m.lobby.stage === 'lobby' && mp.inMatch) endMatchLocal()
      bumpMp()
      break
    }
    case 'start': {
      mp.lobby = m.lobby
      const L = m.lobby
      const enter = () => {
        setupLocal(L)
        mp.inMatch = true
        mp.screen = 'none'
        bumpMp()
      }
      // ilk giris perde arkasinda (yeniden baglanmada dogrudan)
      if (mp.inMatch) enter()
      else {
        guestReset()
        void withCurtain(enter, 'Maça giriliyor')
      }
      break
    }
    case 'stop':
      if (mp.inMatch) endMatchLocal()
      break
    case 'ev':
      if (mp.inMatch) guestOnEvent(m.ht, m.e)
      break
    case 'chat':
      addChat(m.c)
      break
    case 'emo':
      addEmote(m.from, m.e)
      break
    case 'ping':
      C.tr?.send({ t: 'pong', ts: m.ts })
      break
    case 'pong':
      mp.ping = Math.round(performance.now() - m.ts)
      guestSetRtt(mp.ping)
      bumpMp()
      break
    case 'var':
      guestVar(m.on, m.verdict, m.reason ?? '')
      break
    case 'deny':
    case 'kick':
    case 'bye': {
      const wasMatch = mp.inMatch
      leave(true)
      if (wasMatch) endMatchLocal()
      mp.error = m.t === 'bye' ? `Host odayı kapattı${m.reason ? ': ' + m.reason : ''}` : m.reason
      mp.conn = 'lost'
      mp.screen = 'mp'
      bumpMp()
      break
    }
  }
}

// VAR: host karar verir; G'nin misafir kancasi varsa kendi tamponundan oynatir, yoksa yalniz bant
// (G: var/store startRemoteReview(VarCase) / endRemoteReview)
let varBandOnly = false
function guestVar(on: boolean, c: unknown, reason: string) {
  if (on) {
    if (c && typeof c === 'object' && 'kind' in c) startRemoteReview(c as VarCase)
    else {
      // vaka gelmediyse yalniz bant
      varBandOnly = true
      Object.assign(varState, { active: true, phase: 'freeze', reason })
      bumpVar()
    }
  } else if (varBandOnly) {
    varBandOnly = false
    Object.assign(varState, { active: false, phase: 'off', cam: '' })
    bumpVar()
  } else endRemoteReview()
}

// =================================================================== ortak
export function setPref(side: Side, ready: boolean) {
  if (net.role === 'host') hostSetPref(side, ready)
  else guestSend({ t: 'pref', side, ready, name: cleanName(mp.name) })
}

export function sendChat(text: string) {
  const t = cleanChat(text)
  if (!t) return
  if (net.role === 'host') hostRelayChat({ from: cleanName(mp.name), text: t })
  else guestSend({ t: 'chat', text: t })
}

let lastEmote = 0
export function sendEmote(i: number) {
  const t = performance.now()
  if (t - lastEmote < 600 || i < 0 || i >= EMOTES.length) return
  lastEmote = t
  if (net.role === 'host') {
    hostSendAll({ t: 'emo', from: cleanName(mp.name), e: i })
    addEmote(cleanName(mp.name), i)
  } else guestSend({ t: 'emo', e: i })
}

/** odadan cik (host ise odayi kapatir) */
export function leave(silent = false) {
  if (H.tr) {
    hostSendAll({ t: 'bye', reason: 'host ayrıldı' })
    const tr = H.tr
    H.tr = null
    setTimeout(() => tr.destroy(), 150)
    H.guests.clear()
    H.byConn.clear()
    H.banned.clear()
    H.offGame?.()
    H.offGame = null
    clearInterval(H.timer)
  }
  if (C.tr) {
    C.tr.send({ t: 'bye' })
    const tr = C.tr
    C.tr = null
    setTimeout(() => tr.destroy(), 100)
    clearInterval(C.timer)
  }
  const wasMatch = mp.inMatch && net.role !== 'off'
  net.role = 'off'
  net.localPlayer = -1
  clearRemote()
  mp.lobby = null
  mp.ping = -1
  if (!silent) {
    mp.conn = 'idle'
    mp.error = ''
    mp.info = ''
  }
  if (wasMatch) {
    mp.inMatch = false
    for (const p of game.players) p.sentOff = false
    game.humanTeam = 0
  }
  bumpMp()
}

if (typeof window !== 'undefined') {
  if (!keep('unload', () => ({ on: false })).on) {
    keep('unload', () => ({ on: true })).on = true
    window.addEventListener('beforeunload', () => leave(true))
  }
  // test/ayiklama
  Object.assign(window, { __mp: { mp, net, H, hostSendAll, hostCreate, guestJoin, hostStart, hostStop, setPref, sendChat, sendEmote, setName, leave } })
}
