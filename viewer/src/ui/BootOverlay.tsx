// Yukleme ekrani + gecis perdesi (M). Canvas DISINA takilir: <BootOverlay />.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { sfx } from '../rules/audio'
import { BOOT, boot, bootError, bootVersion, hideSplash, subscribeBoot } from './boot'
import { currentStep, listSteps, loadVersion, onLoadError, overall, subscribeLoad, type Step } from './loadTracker'

onLoadError(bootError)
import { startPlay } from './Warmup'
import './boot.css'

const TIPS: [string, string][] = [
  ['WASD / oklar', 'Koş; Shift ile sprint at.'],
  ['Sol tık / Boşluk', 'Basılı tut, bırak: şut. Nişanı fareyle al.'],
  ['Sağ tık / K', 'Fare yönündeki takım arkadaşına pas.'],
  ['Z', 'Pas ya da şutla birlikte basılırsa aşırtma olur.'],
  ['Fare tekerleği', 'Şuta sola ya da sağa falso verir.'],
  ['E / Shift+E', 'Müdahale ve kayarak müdahale. Geç kalan müdahale faul sayılır.'],
  ['Q', 'Topa en yakın oyuncuna geç.'],
  ['M', 'Antrenman ile maç arasında geçiş yapar.'],
  ['X', 'VAR incelemesi iste; Esc tekrarı geçer.'],
  ['V', 'Serbest kamera. F3 geliştirici panelini açar.'],
  ['Gamepad', 'Sol çubuk koşu, A pas, B şut, X aşırtma, RB müdahale.'],
  ['Kural', 'Top çizgiyi tamamen geçmeden gol yok; ince pozisyonu VAR inceler.'],
  ['Kural', 'Kırmızı kart (ikinci sarı dahil): oyuncu 30 saniye dışarıda kalır, sonra geri döner.'],
  ['4’e 4', 'Her takımda bir kaleci ve üç saha oyuncusu var.'],
]

const useBoot = () => useSyncExternalStore(subscribeBoot, bootVersion)
const useLoad = () => useSyncExternalStore(subscribeLoad, loadVersion)

// saha cizgileri: 40 x 25 m saha, 1 m = 10 birim
function PitchLines() {
  return (
    <svg className="boot-lines" viewBox="-30 -30 460 310" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g fill="none" stroke="rgba(255,255,255,0.82)" strokeWidth="1.6">
        <rect x="0" y="0" width="400" height="250" />
        <line x1="200" y1="0" x2="200" y2="250" />
        <circle cx="200" cy="125" r="40" />
        <rect x="0" y="55" width="70" height="140" />
        <rect x="330" y="55" width="70" height="140" />
        <rect x="0" y="95" width="25" height="60" />
        <rect x="375" y="95" width="25" height="60" />
        <path d="M70 100 A 32 32 0 0 1 70 150" />
        <path d="M330 100 A 32 32 0 0 0 330 150" />
        <path d="M0 6 A 6 6 0 0 0 6 0 M394 0 A 6 6 0 0 0 400 6 M0 244 A 6 6 0 0 1 6 250 M394 250 A 6 6 0 0 1 400 244" />
      </g>
      <g fill="rgba(255,255,255,0.85)">
        <circle cx="200" cy="125" r="1.8" />
        <circle cx="70" cy="125" r="1.6" />
        <circle cx="330" cy="125" r="1.6" />
      </g>
      <g fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2.4">
        <path d="M0 100 h-12 v50 h12" />
        <path d="M400 100 h12 v50 h-12" />
      </g>
    </svg>
  )
}

function StepRow({ s }: { s: Step }) {
  return (
    <li className={`boot-step ${s.state}`}>
      <i>{s.state === 'done' ? '✓' : ''}</i>
      <span>{s.label}</span>
      <small>{s.state === 'run' ? s.detail || `%${Math.round(s.frac * 100)}` : s.state === 'done' ? s.detail : ''}</small>
    </li>
  )
}

function Tip() {
  const [i, setI] = useState(() => Math.floor(Math.random() * TIPS.length))
  useEffect(() => {
    const t = setInterval(() => setI((k) => (k + 1) % TIPS.length), 4500)
    return () => clearInterval(t)
  }, [])
  const [k, v] = TIPS[i]
  return (
    <div key={i} className="boot-tip">
      <kbd>{k}</kbd>
      <span>{v}</span>
    </div>
  )
}

function play(force = false) {
  if (boot.phase === 'play' || (boot.phase !== 'ready' && !force)) return
  // ilk kullanici etkilesimi: ses baglami burada acilir
  sfx.init()
  startPlay()
}

const STALL_MS = 10000

function Loading({ leaving }: { leaving: boolean }) {
  useLoad()
  useBoot()
  const ready = boot.phase === 'ready' || boot.phase === 'play'
  const pct = Math.round(overall() * 100)
  const cur = currentStep()
  const steps = listSteps()

  // yukleme ekrani cizildi: index.html'deki acilis perdesi iki karede kalkar
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(hideSplash))
    return () => cancelAnimationFrame(id)
  }, [])

  // ilerleme 10 s kipirdamazsa ya da hata varsa: "Yine de oyna" (ekran kimseyi kilitlemez)
  const sig = `${pct}|${cur?.id}|${cur?.detail}`
  const [mark, setMark] = useState({ sig, t: performance.now() })
  const [, tick] = useState(0)
  if (mark.sig !== sig) setMark({ sig, t: performance.now() })
  useEffect(() => {
    const t = setInterval(() => tick((k) => k + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const stalled = !ready && (boot.errors.length > 0 || performance.now() - mark.t > STALL_MS)

  // yukleme sirasinda oyun tuslari oyuna gitmesin; hazirken Enter/Boşluk = Oyna
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (boot.phase === 'play' || e.key === 'F3' || e.key === '`') return
      e.stopImmediatePropagation()
      if ((e.key === 'Enter' || e.code === 'Space') && !e.repeat) {
        e.preventDefault()
        play()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div
      className={`boot ${leaving ? 'leaving' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="boot-sky" />
      <div className="boot-field">
        <div className="boot-plane">
          <div className="boot-grass" />
          <PitchLines />
          <div className="boot-cloud" />
        </div>
      </div>
      <div className="boot-sun" />
      <div className="boot-vignette" />

      <div className="boot-card">
        <div className="boot-brand">
          <b>4'e 4</b>
          <span>FUTBOL</span>
        </div>

        {!ready ? (
          <>
            <div className="boot-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="fill" style={{ transform: `scaleX(${Math.max(0.02, pct / 100)})` }} />
              <div className="shine" />
            </div>
            <div className="boot-now">
              <span>{cur ? `${cur.label}${cur.state === 'run' && cur.detail ? ` · ${cur.detail}` : ''}` : 'Hazırlanıyor'}</span>
              <b>%{pct}</b>
            </div>
            {stalled && (
              <button className="boot-anyway" onClick={() => play(true)}>
                {boot.errors.length ? 'Hataya rağmen oyna' : 'Uzun sürdü, yine de oyna'}
              </button>
            )}
          </>
        ) : (
          <button className="boot-play" onClick={() => play()} autoFocus>
            Oyna
            <kbd>Enter</kbd>
          </button>
        )}

        {boot.errors.map((e, i) => (
          <div key={i} className="boot-err">
            {e}
          </div>
        ))}
        <ul className="boot-steps">
          {steps.map((s) => (
            <StepRow key={s.id} s={s} />
          ))}
        </ul>
        <Tip />
      </div>
    </div>
  )
}

function Curtain() {
  useBoot()
  const on = boot.curtain
  // perde kalkarken etiket kaybolmasin
  const [label, setLabel] = useState(boot.curtainLabel)
  useEffect(() => {
    if (on) setLabel(boot.curtainLabel)
  }, [on])
  return (
    <div className={`boot-curtain ${on ? 'on' : ''}`} aria-hidden={!on}>
      <div className="boot-brand small">
        <b>4'e 4</b>
        <span>FUTBOL</span>
      </div>
      <div className="boot-curtain-label">
        <span className="boot-spin" />
        {label}
      </div>
    </div>
  )
}

export function BootOverlay() {
  useBoot()
  const [gone, setGone] = useState(!BOOT)
  const leaving = boot.phase === 'play'
  useEffect(() => {
    if (!leaving || gone) return
    const t = setTimeout(() => setGone(true), 700)
    return () => clearTimeout(t)
  }, [leaving, gone])
  return (
    <>
      {!gone && <Loading leaving={leaving} />}
      <Curtain />
    </>
  )
}
