// Ana menu + cok oyunculu giris (M2 tasarimi). Mantik (oda kur/katil, mod baslatma) src/mp/session.ts'te; burasi gorunum.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { aiLevel, setAiLevel, type AiLevel } from '../ai/config'
import { QUALITY, setQuality, type Quality } from '../env/quality'
import { TIMES, getTimeOfDay, setTimeOfDay, subscribeTimeOfDay } from '../env/timeOfDay'
import { guestJoin, hostCreate, leave, mp, mpVersion, playSolo, setName, setScreen, subscribeMp } from '../mp/session'
import { normalizeCode } from '../mp/protocol'
import { signalLabel } from '../mp/transport'
import { withCurtain } from './curtain'
import { openGamepadSettings, setMenuOpen } from './gamepadUi'
import { backLabel, okLabel, useNav, usePad, type NavKey } from './menuNav'
import './menu.css'

const useMp = () => useSyncExternalStore(subscribeMp, mpVersion)
const useTod = () => useSyncExternalStore(subscribeTimeOfDay, getTimeOfDay)
const VERSION = 'v1.0'

// ------------------------------------------------------------ ortak parcalar
function Strip() {
  const [on, setOn] = useState(() => navigator.onLine)
  useEffect(() => {
    const a = () => setOn(true)
    const b = () => setOn(false)
    window.addEventListener('online', a)
    window.addEventListener('offline', b)
    return () => {
      window.removeEventListener('online', a)
      window.removeEventListener('offline', b)
    }
  }, [])
  return (
    <div className="mm-strip">
      <div className="mm-logo">
        <b>4'e 4</b>
        <span>FUTBOL</span>
      </div>
      <div className="mm-status">
        <span>{VERSION}</span>
        <span className={`mm-net ${on ? 'on' : ''}`}>
          <i />
          {on ? 'Çevrimiçi' : 'Çevrimdışı'}
        </span>
      </div>
    </div>
  )
}

function Hints({ extra }: { extra?: [string, string][] }) {
  const pad = usePad()
  const items: [string, string][] = [[okLabel(pad), 'Seç'], [backLabel(pad), 'Geri'], [pad.connected ? '↑↓' : '↑ ↓', 'Gezin'], ...(extra ?? [])]
  return (
    <div className="mm-hints">
      {items.map(([k, l]) => (
        <span key={l}>
          <kbd>{k}</kbd>
          {l}
        </span>
      ))}
    </div>
  )
}

function Seg<T extends string>({ v, opts, on }: { v: T; opts: [T, string][]; on: (x: T) => void }) {
  return (
    <div className="mm-seg">
      {opts.map(([k, l]) => (
        <button key={k} className={k === v ? 'on' : ''} onClick={() => on(k)}>
          {l}
        </button>
      ))}
    </div>
  )
}

function NameField() {
  useMp()
  return (
    <label className="mm-field">
      <span>Oyuncu adı</span>
      <input value={mp.name} maxLength={16} placeholder="Adın" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
    </label>
  )
}

function Jersey({ a, b, stripe, label, sub, num }: { a: string; b: string; stripe: number; label: string; sub: string; num: number }) {
  const id = `jc-${label}`
  const shirt = 'M32 18 L62 6 Q80 22 98 6 L128 18 L158 52 L134 74 L120 62 L120 152 L40 152 L40 62 L26 74 L2 52 Z'
  const bars: ReactNode[] = []
  if (stripe) for (let x = 0; x < 160; x += stripe * 2) bars.push(<rect key={x} x={x} y="0" width={stripe} height="160" fill={b} />)
  return (
    <figure className="mm-jersey">
      <svg viewBox="0 0 160 160" role="img" aria-label={label}>
        <defs>
          <linearGradient id="mm-shade" x1="0" x2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.28" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0.08" />
            <stop offset="1" stopColor="#000" stopOpacity="0.3" />
          </linearGradient>
          <clipPath id={id}>
            <path d={shirt} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${id})`}>
          <rect width="160" height="160" fill={a} />
          {bars}
          <rect width="160" height="160" fill="url(#mm-shade)" />
        </g>
        <path d={shirt} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
        <path d="M62 6 Q80 22 98 6" fill="none" stroke="#fff" strokeWidth="3" opacity="0.9" />
        <text x="80" y="108" textAnchor="middle" className="mm-jnum">
          {num}
        </text>
      </svg>
      <figcaption>
        <b>{label}</b>
        <small>{sub}</small>
      </figcaption>
    </figure>
  )
}

const CONTROLS: [string, string, string][] = [
  ['Koş', 'WASD / oklar', 'Sol çubuk'],
  ['Sprint', 'Shift', 'R2'],
  ['Şut (basılı tut)', 'Sol tık / Boşluk', '○'],
  ['Pas', 'Sağ tık / K', '✕'],
  ['Aşırtma', 'Z + pas / şut', '□'],
  ['Müdahale / kayarak', 'E / Shift+E', 'R1'],
  ['Oyuncu değiştir', 'Q', '△'],
  ['Kamera', 'C / V', 'Share'],
  ['VAR incelemesi', 'X', ''],
  ['Mod değiştir', 'M', ''],
]

// ------------------------------------------------------------ sag paneller
function PlayPanel() {
  const [lv, setLv] = useState<AiLevel>(aiLevel)
  useEffect(() => {
    const on = (e: Event) => setLv((e as CustomEvent<AiLevel>).detail)
    window.addEventListener('mm-ai', on)
    return () => window.removeEventListener('mm-ai', on)
  }, [])
  return (
    <div className="mm-panel">
      <h3>Takımlar</h3>
      <div className="mm-jerseys">
        <Jersey a="#b80f22" b="#f2b705" stripe={27} label="EV" sub="Sarı kırmızı" num={9} />
        <Jersey a="#16224a" b="#16224a" stripe={0} label="DEPLASMAN" sub="Lacivert" num={7} />
      </div>
      <h3>Zorluk</h3>
      <Seg<AiLevel> v={lv} on={(x) => (setAiLevel(x), setLv(x))} opts={[['kolay', 'Kolay'], ['orta', 'Orta'], ['zor', 'Zor']]} />
      <NameField />
    </div>
  )
}

function ControlsPanel() {
  const pad = usePad()
  return (
    <div className="mm-panel">
      <h3>Kontroller</h3>
      <div className="mm-ctl head">
        <span />
        <span>Klavye / fare</span>
        <span>{pad.connected && pad.ps ? 'PS kolu' : 'Kol'}</span>
      </div>
      {CONTROLS.map(([a, k, p]) => (
        <div key={a} className="mm-ctl">
          <span>{a}</span>
          <kbd>{k}</kbd>
          <kbd className="pad">{p || '–'}</kbd>
        </div>
      ))}
    </div>
  )
}

function SettingsPanel() {
  const tod = useTod()
  const [lv, setLv] = useState<AiLevel>(aiLevel)
  return (
    <div className="mm-panel">
      <h3>Zorluk</h3>
      <Seg<AiLevel>
        v={lv}
        on={(x) => {
          setAiLevel(x)
          setLv(x)
          window.dispatchEvent(new CustomEvent('mm-ai', { detail: x }))
        }}
        opts={[['kolay', 'Kolay'], ['orta', 'Orta'], ['zor', 'Zor']]}
      />
      <h3>Gün saati</h3>
      <Seg v={tod} on={setTimeOfDay} opts={TIMES.map((t) => [t.id, t.label])} />
      <h3>Grafik kalitesi</h3>
      <Seg<Quality> v={QUALITY} on={(q) => q !== QUALITY && setQuality(q)} opts={[['low', 'Düşük'], ['med', 'Orta'], ['high', 'Yüksek']]} />
      <p className="mm-note">Kalite değişince sayfa yeniden yüklenir.</p>
    </div>
  )
}

function AboutPanel() {
  return (
    <div className="mm-panel">
      <h3>Hakkında</h3>
      <p className="mm-about">
        4'e 4 Futbol, tarayıcıda çalışan gerçek zamanlı bir halı saha oyunudur. Her takımda bir kaleci ve üç saha oyuncusu bulunur; hakem, faul, kart, duran toplar ve VAR incelemesi
        oyunun içindedir.
      </p>
      <p className="mm-about dim">Sürüm {VERSION}</p>
    </div>
  )
}

// ------------------------------------------------------------ ana menu
interface Item {
  id: string
  label: string
  sub: string
  go: () => void
  panel: 'play' | 'controls' | 'settings' | 'about'
}

export function MainMenu() {
  useMp()
  const ITEMS: Item[] = [
    { id: 'solo', label: 'Tek Oyunculu Maç', sub: 'Yapay zekâya karşı 4\'e 4', go: () => withCurtain(() => playSolo('mac'), 'Maç hazırlanıyor'), panel: 'play' },
    { id: 'mp', label: 'Çok Oyunculu', sub: 'Oda kur ya da odaya katıl', go: () => setScreen('mp'), panel: 'play' },
    { id: 'train', label: 'Antrenman', sub: 'Serbest şut çalışması', go: () => withCurtain(() => playSolo('antrenman'), 'Antrenman hazırlanıyor'), panel: 'play' },
    { id: 'pad', label: 'Kol Ayarları', sub: 'Eşleme, ölü bölge, titreşim', go: () => openGamepadSettings(), panel: 'play' },
    { id: 'ctl', label: 'Kontroller', sub: 'Klavye ve kol düzeni', go: () => {}, panel: 'controls' },
    { id: 'set', label: 'Ayarlar', sub: 'Zorluk, gün saati, kalite', go: () => {}, panel: 'settings' },
    { id: 'about', label: 'Hakkında', sub: '', go: () => {}, panel: 'about' },
  ]
  const [idx, setIdx] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    setMenuOpen(true)
    return () => setMenuOpen(false)
  }, [])
  useEffect(() => {
    refs.current[idx]?.focus({ preventScroll: true })
  }, [idx])
  const cycleAi = (d: number) => {
    const L: AiLevel[] = ['kolay', 'orta', 'zor']
    const n = L[Math.max(0, Math.min(2, L.indexOf(aiLevel) + d))]
    setAiLevel(n)
    window.dispatchEvent(new CustomEvent('mm-ai', { detail: n }))
  }
  useNav((k: NavKey) => {
    if (k === 'up') setIdx((i) => (i + ITEMS.length - 1) % ITEMS.length)
    else if (k === 'down') setIdx((i) => (i + 1) % ITEMS.length)
    else if (k === 'left') cycleAi(-1)
    else if (k === 'right') cycleAi(1)
    else if (k === 'ok') ITEMS[idx].go()
    else if (k === 'back') setScreen('none')
  })
  const cur = ITEMS[idx]
  return (
    <div className="mm-root">
      <Strip />
      <div className="mm-main">
        <nav className="mm-list" aria-label="Ana menü">
          {ITEMS.map((it, i) => (
            <button
              key={it.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={`mm-item ${i === idx ? 'sel' : ''}`}
              data-pad-focus={i === idx ? '' : undefined}
              onMouseEnter={() => setIdx(i)}
              onFocus={() => setIdx(i)}
              onClick={it.go}
            >
              <b>{it.label}</b>
              {it.sub && <small>{it.sub}</small>}
            </button>
          ))}
        </nav>
        {cur.panel === 'play' && <PlayPanel />}
        {cur.panel === 'controls' && <ControlsPanel />}
        {cur.panel === 'settings' && <SettingsPanel />}
        {cur.panel === 'about' && <AboutPanel />}
      </div>
      <Hints extra={[['◄ ►', 'Zorluk']]} />
    </div>
  )
}

// ------------------------------------------------------------ cok oyunculu giris
export function MpMenu() {
  useMp()
  const [code, setCode] = useState('')
  const busy = mp.conn === 'connecting'
  const refs = useRef<(HTMLElement | null)[]>([])
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    setMenuOpen(true)
    return () => setMenuOpen(false)
  }, [])
  useEffect(() => {
    refs.current[idx]?.focus({ preventScroll: true })
  }, [idx])
  const back = () => (leave(), setScreen('menu'))
  const actions = [() => hostCreate(), () => code.length === 5 && guestJoin(code), () => code.length === 5 && guestJoin(code), back]
  useNav((k: NavKey) => {
    if (k === 'up') setIdx((i) => (i + 3) % 4)
    else if (k === 'down') setIdx((i) => (i + 1) % 4)
    else if (k === 'ok') !busy && actions[idx]()
    else if (k === 'back') back()
  })
  const ref = (i: number) => (el: HTMLElement | null) => {
    refs.current[i] = el
  }
  return (
    <div className="mm-root">
      <Strip />
      <div className="mm-main">
        <nav className="mm-list" aria-label="Çok oyunculu">
          <button ref={ref(0)} className={`mm-item ${idx === 0 ? 'sel' : ''}`} disabled={busy} onMouseEnter={() => setIdx(0)} onFocus={() => setIdx(0)} onClick={() => hostCreate()}>
            <b>Oda Kur</b>
            <small>Arkadaşların kodla katılsın</small>
          </button>
          <div className={`mm-item code ${idx === 1 ? 'sel' : ''}`} onMouseEnter={() => setIdx(1)}>
            <b>Odaya Katıl</b>
            <input
              ref={ref(1)}
              className="mm-code"
              value={code}
              placeholder="KOD"
              maxLength={5}
              onFocus={() => setIdx(1)}
              onChange={(e) => setCode(normalizeCode(e.target.value))}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && code.length === 5) guestJoin(code)
              }}
            />
          </div>
          <button ref={ref(2)} className={`mm-item ${idx === 2 ? 'sel' : ''}`} disabled={busy || code.length !== 5} onMouseEnter={() => setIdx(2)} onFocus={() => setIdx(2)} onClick={() => guestJoin(code)}>
            <b>Katıl</b>
            <small>{code.length === 5 ? `Oda ${code}` : '5 harfli kodu gir'}</small>
          </button>
          <button ref={ref(3)} className={`mm-item back ${idx === 3 ? 'sel' : ''}`} onMouseEnter={() => setIdx(3)} onFocus={() => setIdx(3)} onClick={back}>
            <b>‹ Geri</b>
          </button>
        </nav>
        <div className="mm-panel">
          <h3>Çok oyunculu</h3>
          <NameField />
          {mp.info && <div className="mm-msg">{mp.info}</div>}
          {mp.error && <div className="mm-msg err">{mp.error}</div>}
          <p className="mm-note">Sinyal: {signalLabel()}</p>
        </div>
      </div>
      <Hints />
    </div>
  )
}
