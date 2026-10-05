// PeerJS tasima katmani (L): oda acma / katilma, yeniden baglanma. Oyun durumu tutmaz.
// Sinyal sunucusu: varsayilan PeerJS bulutu. ?peer=local -> 127.0.0.1:9000 (npx peerjs --port 9000),
// ?peer=host:port[/yol] -> kendi sunucun (https sayfada wss).
import Peer, { type DataConnection, type PeerOptions } from 'peerjs'
import { PEER_PREFIX, randomCode } from './protocol'

export function peerOptions(): PeerOptions {
  let v: string | null = null
  let dbg = 0
  try {
    const q = new URLSearchParams(location.search)
    v = q.get('peer')
    dbg = Number(q.get('peerdebug') ?? 0) || 0
  } catch {
    /* bassiz */
  }
  const base: PeerOptions = { debug: dbg }
  if (!v) return base
  if (v === 'local') v = '127.0.0.1:9000'
  const m = /^([^:/]+)(?::(\d+))?(\/.*)?$/.exec(v)
  if (!m) return base
  const secure = location.protocol === 'https:'
  return { ...base, host: m[1], port: m[2] ? Number(m[2]) : secure ? 443 : 80, path: m[3] ?? '/', secure, key: 'peerjs' }
}

export const signalLabel = () => {
  const o = peerOptions()
  return o.host ? `${o.host}:${o.port}` : 'PeerJS bulutu'
}

const ERR_TR: Record<string, string> = {
  'peer-unavailable': 'Oda bulunamadı',
  'unavailable-id': 'Oda kodu kullanımda',
  'browser-incompatible': 'Tarayıcı WebRTC desteklemiyor',
  network: 'Sinyal sunucusuna ulaşılamadı',
  'server-error': 'Sinyal sunucusu hatası',
  'socket-error': 'Sinyal bağlantısı hatası',
  'socket-closed': 'Sinyal bağlantısı kapandı',
  'ssl-unavailable': 'SSL kullanılamıyor',
  webrtc: 'WebRTC bağlantı hatası',
  disconnected: 'Sinyal sunucusundan koptu',
}
export const errText = (type: string) => ERR_TR[type] ?? `Bağlantı hatası (${type})`

const CONN_OPTS = { reliable: true, serialization: 'json' as const }

// ------------------------------------------------------------------ host
export interface HostCb {
  open(code: string): void
  conn(c: DataConnection): void
  data(c: DataConnection, d: unknown): void
  close(c: DataConnection): void
  error(msg: string, fatal: boolean): void
}

export class HostTransport {
  peer: Peer | null = null
  code = ''
  private tries = 0
  private dead = false
  readonly conns = new Set<DataConnection>()
  private cb: HostCb
  constructor(cb: HostCb) {
    this.cb = cb
  }

  open() {
    this.tries++
    const code = randomCode()
    this.code = code
    const peer = new Peer(PEER_PREFIX + code, peerOptions())
    this.peer = peer
    peer.on('open', () => !this.dead && this.cb.open(code))
    peer.on('connection', (c) => {
      c.on('open', () => {
        this.conns.add(c)
        this.cb.conn(c)
      })
      c.on('data', (d) => this.cb.data(c, d))
      const gone = () => {
        if (!this.conns.delete(c)) return
        this.cb.close(c)
      }
      c.on('close', gone)
      c.on('error', gone)
    })
    // sinyal koptu: mevcut veri kanallari surer, yeni katilim icin yeniden baglan
    peer.on('disconnected', () => {
      if (this.dead) return
      setTimeout(() => {
        if (!this.dead && peer.disconnected && !peer.destroyed) peer.reconnect()
      }, 1000)
    })
    peer.on('error', (e) => {
      const t = (e as { type?: string }).type ?? 'peer'
      if (t === 'unavailable-id' && this.tries < 4) {
        peer.destroy()
        this.open()
        return
      }
      // tek misafir hatasi oda icin olumcul degil
      const fatal = !peer.open && (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'browser-incompatible' || t === 'unavailable-id')
      this.cb.error(errText(t), fatal)
    })
  }

  send(c: DataConnection, m: unknown) {
    if (c.open) c.send(m)
  }

  destroy() {
    this.dead = true
    for (const c of this.conns) c.close()
    this.conns.clear()
    this.peer?.destroy()
    this.peer = null
  }
}

// ------------------------------------------------------------------ misafir
export interface GuestCb {
  open(): void // veri kanali acik (ilk ya da yeniden)
  data(d: unknown): void
  drop(): void // kanal koptu, yeniden deneniyor
  lost(msg: string): void // vazgecildi
}

const RETRY_MS = 1500
const GIVE_UP_MS = 30000
const JOIN_TIMEOUT = 30000

export class GuestTransport {
  peer: Peer | null = null
  conn: DataConnection | null = null
  private dead = false
  private everOpen = false
  private dropAt = 0
  private timer = 0
  private code: string
  private cb: GuestCb
  constructor(code: string, cb: GuestCb) {
    this.code = code
    this.cb = cb
  }

  start() {
    const peer = new Peer(peerOptions())
    this.peer = peer
    peer.on('open', () => this.connect())
    peer.on('disconnected', () => {
      if (!this.dead && !peer.destroyed) setTimeout(() => !this.dead && peer.disconnected && peer.reconnect(), 800)
    })
    peer.on('error', (e) => {
      const t = (e as { type?: string }).type ?? 'peer'
      if (this.dead) return
      if (!this.everOpen) {
        // ilk katilim basarisiz: kullaniciya hemen soyle
        if (t === 'peer-unavailable' || t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'browser-incompatible') {
          this.fail(errText(t))
        }
        return
      }
      // yeniden baglanma sirasinda: host henuz yok ya da sinyal gecici; dongu surer
      this.retry()
    })
  }

  private connect() {
    if (this.dead || !this.peer) return
    const c = this.peer.connect(PEER_PREFIX + this.code, CONN_OPTS)
    if (!c) {
      this.retry()
      return
    }
    this.conn = c
    let opened = false
    const to = window.setTimeout(() => {
      if (opened || this.dead) return
      if (!this.everOpen) this.fail('Oda bulunamadı (zaman aşımı)')
      else {
        c.close()
        this.retry()
      }
    }, this.everOpen ? 6000 : JOIN_TIMEOUT)
    c.on('open', () => {
      opened = true
      clearTimeout(to)
      this.everOpen = true
      this.dropAt = 0
      this.cb.open()
    })
    c.on('data', (d) => this.cb.data(d))
    const gone = () => {
      clearTimeout(to)
      if (this.conn !== c || this.dead) return
      this.conn = null
      if (!opened) return
      this.cb.drop()
      this.retry()
    }
    c.on('close', gone)
    c.on('error', gone)
  }

  private retry() {
    if (this.dead || this.timer) return
    if (!this.dropAt) this.dropAt = performance.now()
    if (performance.now() - this.dropAt > GIVE_UP_MS) {
      this.fail('Host ile bağlantı kurulamadı')
      return
    }
    this.timer = window.setTimeout(() => {
      this.timer = 0
      if (this.dead) return
      const p = this.peer
      if (!p || p.destroyed) {
        this.start()
        return
      }
      if (p.disconnected) {
        // sinyal once; sonraki turda kanal denenir
        p.reconnect()
        this.retry()
        return
      }
      this.connect()
    }, RETRY_MS)
  }

  private fail(msg: string) {
    if (this.dead) return
    this.destroy()
    this.cb.lost(msg)
  }

  send(m: unknown) {
    if (this.conn?.open) this.conn.send(m)
  }

  get connected() {
    return !!this.conn?.open
  }

  destroy() {
    this.dead = true
    clearTimeout(this.timer)
    this.conn?.close()
    this.conn = null
    this.peer?.destroy()
    this.peer = null
  }
}
