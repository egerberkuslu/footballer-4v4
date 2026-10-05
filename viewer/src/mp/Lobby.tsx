// Ana menu + cok oyunculu lobi + mac ici ag rozeti/sohbet (L). Canvas DISINA takilir: <MpOverlay />.
// Acilis: adres cubugunda parametre yoksa (ya da ?menu=1) ana menu acilir; ?oda=KOD (ya da ?room=) dogrudan katilir.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { EMOTES, MAX_CHAT, type Member, type Settings, type Side } from './protocol'
import { net } from './role'
import {
  guestJoin, hostKick, hostSetSettings, hostStart, hostStop, leave, mp, mpVersion,
  sendChat, sendEmote, setPref, setScreen, subscribeMp,
} from './session'
import { MainMenu, MpMenu } from '../ui/MainMenu'
import { setMenuOpen } from '../ui/gamepadUi'
import { guestStats } from './sync'
import './mp.css'

const useMp = () => useSyncExternalStore(subscribeMp, mpVersion)

const SIDE_NAME: Record<string, string> = { '0': 'Ev', '1': 'Deplasman', null: 'İzleyici' }
const sideKey = (s: Side) => String(s)

// acilis davranisi
;(() => {
  try {
    const q = new URLSearchParams(location.search)
    const room = q.get('oda') ?? q.get('room')
    if (room) {
      mp.screen = 'mp'
      setTimeout(() => guestJoin(room), 300)
    } else if (q.get('menu') === '1' || location.search === '') mp.screen = 'menu'
  } catch {
    /* bassiz */
  }
})()

function PingDot({ ms }: { ms: number }) {
  const c = ms < 0 ? 'na' : ms < 80 ? 'good' : ms < 160 ? 'mid' : 'bad'
  return (
    <span className={`mp-ping ${c}`}>
      <i />
      {ms < 0 ? '–' : `${ms} ms`}
    </span>
  )
}

function MemberRow({ m, isHost }: { m: Member; isHost: boolean }) {
  const me = m.id === mp.me
  return (
    <div className={`mp-member${me ? ' me' : ''}${m.online ? '' : ' off'}`}>
      <span className={`mp-ready${m.ready ? ' on' : ''}`} title={m.ready ? 'Hazır' : 'Hazır değil'} />
      <span className="mp-mname">
        {m.host && <em title="Host">★</em>}
        {m.name}
        {me && <small> (sen)</small>}
        {!m.online && <small> · koptu</small>}
      </span>
      {!m.host && <PingDot ms={m.ping} />}
      {isHost && !m.host && (
        <span className="mp-mod">
          <button title="Odadan çıkar" onClick={() => hostKick(m.id)}>
            Çıkar
          </button>
          <button title="Uzaklaştır (geri giremez)" onClick={() => hostKick(m.id, true)}>
            Yasakla
          </button>
        </span>
      )}
    </div>
  )
}

function Chat({ compact = false }: { compact?: boolean }) {
  useMp()
  const [text, setText] = useState('')
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
  }, [mp.chat.length])
  return (
    <div className={`mp-chat${compact ? ' compact' : ''}`}>
      <div ref={list} className="mp-msgs">
        {mp.chat.map((c, i) => (
          <div key={i} className={c.sys ? 'sys' : c.emote ? 'emo' : ''}>
            {c.from && <b>{c.from}</b>}
            <span>{c.text}</span>
          </div>
        ))}
      </div>
      <div className="mp-emotes">
        {EMOTES.map((e, i) => (
          <button key={i} title={`${i + 1}`} onClick={() => sendEmote(i)}>
            {e}
          </button>
        ))}
      </div>
      <input
        value={text}
        maxLength={MAX_CHAT}
        placeholder="Mesaj yaz, Enter"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            sendChat(text)
            setText('')
          }
        }}
      />
    </div>
  )
}

function Seg<T extends string | number | boolean>({ v, opts, on, dis }: { v: T; opts: [T, string][]; on: (x: T) => void; dis: boolean }) {
  return (
    <div className="mp-seg">
      {opts.map(([k, l]) => (
        <button key={String(k)} className={k === v ? 'on' : ''} disabled={dis} onClick={() => on(k)}>
          {l}
        </button>
      ))}
    </div>
  )
}

function LobbyView() {
  useMp()
  const L = mp.lobby
  const [copied, setCopied] = useState(false)
  if (!L) return null
  const isHost = net.role === 'host'
  const me = L.members.find((m) => m.id === mp.me)
  const S: Settings = L.settings
  const cols: Side[] = [0, 1, null]
  const inMatch = L.stage === 'match'
  const ready = L.members.filter((m) => m.ready || m.host).length
  const link = `${location.origin}${location.pathname}?oda=${L.code}`
  return (
    <div className="mp-card mp-lobby">
      <div className="mp-head">
        <button className="mp-back" onClick={() => (leave(), setScreen('mp'))}>
          ‹ {isHost ? 'Odayı kapat' : 'Odadan çık'}
        </button>
        <div className="mp-room">
          <span>ODA</span>
          <b>{L.code}</b>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(link).then(
                () => setCopied(true),
                () => setCopied(false),
              )
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? 'Kopyalandı' : 'Davet bağlantısı'}
          </button>
        </div>
        {!isHost && <PingDot ms={mp.ping} />}
        {inMatch && (
          <button className="mp-x" onClick={() => setScreen('none')} title="Maça dön">
            ✕
          </button>
        )}
      </div>
      {mp.conn === 'reconnecting' && <div className="mp-warn">{mp.info}</div>}
      <div className="mp-body">
        <div className="mp-teams">
          {cols.map((s) => {
            const list = L.members.filter((m) => m.side === s)
            const full = s !== null && list.length >= 4
            return (
              <div key={sideKey(s)} className={`mp-team t${sideKey(s)}`}>
                <div className="mp-thead">
                  <i />
                  <b>{SIDE_NAME[sideKey(s)]}</b>
                  {s !== null && <small>{list.length}/4</small>}
                  {me && me.side !== s && !inMatch && (
                    <button disabled={full} onClick={() => setPref(s, me.ready)}>
                      {full ? 'Dolu' : 'Geç'}
                    </button>
                  )}
                </div>
                {list.map((m) => (
                  <MemberRow key={m.id} m={m} isHost={isHost} />
                ))}
                {s !== null && !list.length && <div className="mp-empty">{S.fill ? 'Botlar oynar' : 'Boş'}</div>}
              </div>
            )
          })}
        </div>
        <div className="mp-side">
          <div className="mp-settings">
            <div className="mp-lbl">Maç ayarları {!isHost && <small>(host belirler)</small>}</div>
            <div className="mp-set">
              <span>Devre</span>
              <Seg v={S.halfMin} dis={!isHost || inMatch} on={(x) => hostSetSettings({ halfMin: x })} opts={[[2, '2 dk'], [3, '3 dk'], [5, '5 dk'], [10, '10 dk']]} />
            </div>
            <div className="mp-set">
              <span>Yapay zekâ</span>
              <Seg v={S.ai} dis={!isHost} on={(x) => hostSetSettings({ ai: x })} opts={[['kolay', 'Kolay'], ['orta', 'Orta'], ['zor', 'Zor']]} />
            </div>
            <div className="mp-set">
              <span>Boş yerler</span>
              <Seg v={S.fill} dis={!isHost || inMatch} on={(x) => hostSetSettings({ fill: x })} opts={[[true, 'Bot'], [false, 'Boş']]} />
            </div>
          </div>
          <Chat />
        </div>
      </div>
      <div className="mp-actions">
        {me && !isHost && !inMatch && (
          <button className={me.ready ? 'mp-ok' : ''} onClick={() => setPref(me.side, !me.ready)}>
            {me.ready ? '✓ Hazırım' : 'Hazır ol'}
          </button>
        )}
        {isHost && !inMatch && (
          <>
            <span className="mp-count">
              {ready}/{L.members.length} hazır
            </span>
            <button className="mp-primary" onClick={() => hostStart()}>
              Maçı başlat
            </button>
          </>
        )}
        {isHost && inMatch && (
          <button onClick={() => hostStop()}>Maçı bitir, lobiye dön</button>
        )}
        {!isHost && !inMatch && <span className="mp-count">Host maçı başlatınca oyun açılır</span>}
        {inMatch && <button className="mp-primary" onClick={() => setScreen('none')}>Maça dön</button>}
      </div>
    </div>
  )
}

// mac ici: sag ustte ag rozeti, solda kayan sohbet, ortada emoji balonlari
function InMatch() {
  useMp()
  const [chatOpen, setChatOpen] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 500)
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Enter') {
        setChatOpen(true)
        e.preventDefault()
      } else if (/^[1-8]$/.test(e.key) && !e.repeat) sendEmote(Number(e.key) - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  const L = mp.lobby
  if (!L) return null
  const isHost = net.role === 'host'
  const t = performance.now()
  const recent = mp.chat.slice(-5)
  const stale = net.role === 'guest' && guestStats().lastSnapAge > 0.6
  return (
    <>
      <div className="mp-badge">
        <span className={`mp-conn ${mp.conn}`} />
        <b>{L.code}</b>
        {isHost ? <span className="mp-role">Host · {L.members.filter((m) => m.online).length} kişi</span> : <PingDot ms={mp.ping} />}
        <button onClick={() => setScreen('lobby')}>Lobi</button>
      </div>
      {(mp.conn === 'reconnecting' || stale) && <div className="mp-banner">{mp.conn === 'reconnecting' ? mp.info : 'Host’tan veri gelmiyor…'}</div>}
      <div className="mp-feed">
        {!chatOpen &&
          recent.map((c, i) => (
            <div key={mp.chat.length - recent.length + i} className={c.sys ? 'sys' : ''}>
              {c.from && <b>{c.from}</b>} {c.text}
            </div>
          ))}
        {chatOpen && <ChatInput close={() => setChatOpen(false)} />}
        {!chatOpen && <small className="mp-hint">Enter sohbet · 1–8 tepki</small>}
      </div>
      <div className="mp-floats">
        {mp.emotes
          .filter((e) => t - e.at < 2600)
          .map((e) => (
            <div key={e.id} className="mp-float">
              <span>{e.e}</span>
              <small>{e.from}</small>
            </div>
          ))}
      </div>
    </>
  )
}

function ChatInput({ close }: { close: () => void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div className="mp-cin">
      <div className="mp-msgs">
        {mp.chat.slice(-8).map((c, i) => (
          <div key={i} className={c.sys ? 'sys' : ''}>
            {c.from && <b>{c.from}</b>} {c.text}
          </div>
        ))}
      </div>
      <input
        ref={ref}
        value={text}
        maxLength={MAX_CHAT}
        placeholder="Mesaj, Enter gönder · Esc kapat"
        onChange={(e) => setText(e.target.value)}
        onBlur={close}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            sendChat(text)
            close()
          } else if (e.key === 'Escape') close()
        }}
        onKeyUp={(e) => e.stopPropagation()}
      />
    </div>
  )
}

/** Canvas disina takilir. Menu kapaliyken sag ustte kucuk menu dugmesi. */
export function MpOverlay() {
  useMp()
  const s = mp.screen
  const overlay = s === 'menu' || s === 'mp' || s === 'lobby'
  // oyun girdisi, lobi acikken de menu kilidinde (ana menu/mp kendi kilidini ayrica koyar)
  useEffect(() => {
    if (s === 'lobby') setMenuOpen(true)
    return () => {
      if (s === 'lobby') setMenuOpen(false)
    }
  }, [s])
  return (
    <>
      {(s === 'menu' || s === 'mp') && (
        <div onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
          {s === 'menu' ? <MainMenu /> : <MpMenu />}
        </div>
      )}
      {s === 'lobby' && (
        <div className="mp-overlay" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
          <LobbyView />
        </div>
      )}
      {!overlay && mp.inMatch && <InMatch />}
      {!overlay && !mp.inMatch && !mp.lobby && (
        <button className="mp-menubtn" onClick={() => setScreen('menu')} title="Ana menü">
          ☰ Menü
        </button>
      )}
      {!overlay && !mp.inMatch && mp.lobby && (
        <button className="mp-menubtn" onClick={() => setScreen('lobby')}>
          ⇄ Lobi {mp.lobby.code}
        </button>
      )}
    </>
  )
}
