// Yukleme ekrani + gecis perdesi (M). Canvas DISINA takilir: <BootOverlay />.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { sfx } from '../rules/audio'
import { BOOT, boot, bootError, bootVersion, hideSplash, subscribeBoot } from './boot'
import { currentStep, listSteps, loadVersion, onLoadError, overall, subscribeLoad, type Step } from './loadTracker'

onLoadError(bootError)
import { startPlay } from './Warmup'
import { okLabel, useNav, usePad } from './menuNav'
import './boot.css'

const TIPS: [string, string][] = [
  ['Çay demlendi', 'Maç başlıyor, ısınmayı fazla uzatma.'],
  ['Berberler', 'Bu sene iddialılar; sarı kırmızı formayı sen giyiyorsun.'],
  ['Bakkallar', 'Veresiye topu çalıyor; orta sahada dikkatli ol.'],
  ['WASD / Shift', 'Koş; Shift ile sprint at. Sol tık basılı tut, bırak: şut.'],
  ['Sağ tık / K', 'Fare yönündeki takım arkadaşına pas. Z ile aşırtma.'],
  ['E / Shift+E', 'Müdahale ve kayarak müdahale. Geç kalan müdahale faul sayılır.'],
  ['Kural', 'Top çizgiyi tamamen geçmeden gol yok; ince pozisyonu VAR inceler.'],
  ['Kural', 'Kırmızı kart (ikinci sarı dahil): oyuncu 30 saniye dışarıda kalır, sonra geri döner.'],
]

const useBoot = () => useSyncExternalStore(subscribeBoot, bootVersion)
const useLoad = () => useSyncExternalStore(subscribeLoad, loadVersion)

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
    const t = setInterval(() => setI((k) => (k + 1) % TIPS.length), 4000)
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

const FRIENDLY: Record<string, string> = {
  scene: 'Saha hazırlanıyor',
  model: 'Oyuncular hazırlanıyor',
  'model-lod': 'Oyuncular hazırlanıyor',
  kits: 'Formalar hazırlanıyor',
  trees: 'Çevre hazırlanıyor',
  files: 'Dosyalar yükleniyor',
  gpu: 'Dokular ekran kartına aktarılıyor',
  shader: 'Efektler hazırlanıyor',
  frames: 'Son hazırlıklar yapılıyor',
}
const friendly = (s: Step) => `${FRIENDLY[s.id] ?? s.label}…`

/** yuzde degeri yumusak akar (gercek ilerlemeyi geride kovalar, asla ondan ileri gecmez) */
function useSmooth(target: number) {
  const [v, setV] = useState(0)
  const t = useRef(target)
  t.current = target
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const f = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      setV((x) => {
        const g = t.current
        if (x >= g) return g
        return Math.min(g, x + Math.max(0.15, (g - x) * 5 * dt * 3))
      })
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [])
  return v
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

  const [open, setOpen] = useState(false)
  const shown = useSmooth(ready ? 100 : pct)
  const pad = usePad()
  // kol: onay tusu da Oyna'dir (acilista basili tus tetiklemez)
  useNav((k) => {
    if (k === 'ok') play()
  })
  const label = ready ? 'Hazır' : cur ? friendly(cur) : 'Hazırlanıyor…'

  const p = Math.max(0, Math.min(1, shown / 100))
  const WORD = 'ESNAF'.split('')
  return (
    <div
      className={`boot kl ${leaving ? 'leaving' : ''} ${ready ? 'ready' : ''}`}
      style={{ ['--p' as string]: p }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="kl-glow" />
      <Wire />
      <div className="kl-grain" />

      <div className="kl-pct" aria-hidden>
        <b>{Math.round(shown)}</b>
        <small>%</small>
      </div>

      <div className="kl-center">
        <h1 className="kl-word" aria-label="ESNAF KUPASI">
          <i className="kl-line l" />
          <span className="kl-letters">
            {WORD.map((c, i) => (
              <b key={i} style={{ animationDelay: `${0.08 * i}s` }}>
                {c}
              </b>
            ))}
          </span>
          <i className="kl-line r" />
        </h1>
        <div className="kl-kupa">KUPASI</div>
        <div className="kl-sub">HALI SAHA 4'E 4</div>

        <div className="kl-track" role="progressbar" aria-valuenow={Math.round(shown)} aria-valuemin={0} aria-valuemax={100}>
          <div className="kl-rail" />
          <div className="kl-trail" />
          <div className="kl-ball">
            <Ball />
          </div>
          <div className="kl-goal">
            <GoalNet />
            {ready && (
              <div className="kl-burst">
                {Array.from({ length: 10 }, (_, i) => (
                  <u key={i} style={{ ['--a' as string]: `${i * 36}deg` }} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="kl-action">
          {ready ? (
            <button className="bl-play kl-play" onClick={() => play()} autoFocus>
              OYNA
              <kbd>{okLabel(pad)}</kbd>
            </button>
          ) : (
            stalled && (
              <button className="boot-anyway" onClick={() => play(true)}>
                {boot.errors.length ? 'Hataya rağmen oyna' : 'Uzun sürdü, yine de oyna'}
              </button>
            )
          )}
          {boot.errors.map((e, i) => (
            <div key={i} className="boot-err">
              {e}
            </div>
          ))}
        </div>
      </div>

      <div className="kl-foot">
        <div className="kl-glass">
          <span className="kl-step">{label}</span>
          <Tip />
        </div>
        <button className="bl-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Ayrıntılar {open ? '▴' : '▾'}
        </button>
        {open && (
          <ul className="boot-steps bl-steps">
            {steps.map((s) => (
              <StepRow key={s.id} s={s} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** kose saha yaylari + kafes tel orgusu (cok dusuk opaklik) */
function Wire() {
  return (
    <svg className="kl-wire" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id="kl-mesh" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0H26M0 0V26" stroke="#fff" strokeWidth="1" fill="none" />
        </pattern>
        <linearGradient id="kl-fade" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.28" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.72" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" />
        </linearGradient>
        <mask id="kl-m">
          <rect width="1000" height="600" fill="url(#kl-fade)" />
        </mask>
      </defs>
      <rect width="1000" height="600" fill="url(#kl-mesh)" mask="url(#kl-m)" opacity="0.5" />
      <g fill="none" stroke="#fff" strokeWidth="2">
        <path d="M0 70 A70 70 0 0 0 70 0" />
        <path d="M1000 70 A70 70 0 0 1 930 0" />
        <path d="M0 530 A70 70 0 0 1 70 600" />
        <path d="M1000 530 A70 70 0 0 0 930 600" />
      </g>
    </svg>
  )
}

function Ball() {
  return (
    <svg viewBox="-20 -20 40 40" aria-hidden>
      <circle r="18" fill="#f6f7f9" stroke="#1a1d22" strokeWidth="1.6" />
      <path d="M0 -7 L6.7 -2.2 L4.1 5.7 L-4.1 5.7 L-6.7 -2.2 Z" fill="#15181d" />
      <g stroke="#15181d" strokeWidth="1.4" fill="none" strokeLinecap="round">
        <path d="M0 -7 L0 -17M6.7 -2.2 L16 -5.5M4.1 5.7 L10 14M-4.1 5.7 L-10 14M-6.7 -2.2 L-16 -5.5" />
      </g>
      <g fill="#15181d">
        <path d="M-9 -15 L-3 -17 L-5 -11 Z" />
        <path d="M9 -15 L3 -17 L5 -11 Z" />
        <path d="M16 3 L15 9 L11 6 Z" />
        <path d="M-16 3 L-15 9 L-11 6 Z" />
        <path d="M0 18 L-5 16 L5 16 Z" />
      </g>
    </svg>
  )
}

function GoalNet() {
  return (
    <svg viewBox="0 0 60 44" aria-hidden>
      <path d="M4 42 V6 H56 V42" fill="none" stroke="#f4f6f8" strokeWidth="3" strokeLinecap="round" />
      <g stroke="rgba(255,255,255,0.45)" strokeWidth="1">
        {Array.from({ length: 8 }, (_, i) => (
          <path key={'v' + i} d={`M${10 + i * 6} 6V42`} />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <path key={'h' + i} d={`M4 ${12 + i * 6}H56`} />
        ))}
      </g>
    </svg>
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
        <b>ESNAF KUPASI</b>
        <span>HALI SAHA 4'E 4</span>
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
