// "Kol Ayarlari" ekrani (M2): yalniz on yuz. Mantik src/control/gamepadConfig.ts'te (F2).
// Kullanim: <GamepadSettingsHost /> bir kez (App), acmak icin openGamepadSettings() (ana menu / ☰ Menu).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  ACTIONS,
  DEFAULTS,
  actionLabel,
  clearBinding,
  getSettings,
  isLearning,
  onPadChange,
  onSettingsChange,
  resetSettings,
  rumble,
  setPreset,
  setSettings,
  startLearn,
  defaultOf,
  type ActionId,
  type GamepadSettings as Settings,
  type Logical,
  type PadInfo,
} from '../control/gamepadConfig'
import { closeGamepadSettings, gamepadSettingsOpen, gamepadUiVersion, subscribeGamepadUi } from './gamepadUi'
import './gamepadSettings.css'

const useOpen = () => {
  useSyncExternalStore(subscribeGamepadUi, gamepadUiVersion)
  return gamepadSettingsOpen()
}
let sv = 0
const subscribeSettings = (f: () => void) =>
  onSettingsChange(() => {
    sv++
    f()
  })
const useSettings = (): Settings => {
  useSyncExternalStore(subscribeSettings, () => sv)
  return getSettings()
}
function usePad(): PadInfo {
  const [p, setP] = useState<PadInfo>({
    connected: false,
    name: '',
    profile: 'standard',
    ps: false,
    needsLearn: false,
  })
  useEffect(() => onPadChange((i) => setP({ ...i })), [])
  return p
}

function badgeOf(p: PadInfo): string {
  if (!p.connected) return ''
  if (p.ps) return /dualsense|0ce6/i.test(p.name) ? 'PS5' : 'PS4'
  return p.profile === 'standard' ? 'Xbox' : 'Diğer'
}
const cleanName = (n: string) =>
  n
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim() || n

// ------------------------------------------------------------ kaydirici
function Slider(p: {
  label: string
  value: number
  min: number
  max: number
  step: number
  fmt: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="gps-row">
      <span className="gps-lab">{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
      <output>{p.fmt(p.value)}</output>
    </label>
  )
}
function Toggle(p: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`gps-toggle ${p.on ? 'on' : ''}`} role="switch" aria-checked={p.on} onClick={() => p.onChange(!p.on)}>
      <i />
      <span>{p.label}</span>
    </button>
  )
}

// ------------------------------------------------------------ PS duzeni semasi
// semada kisa ad; olmayan (yeni) eylem ACTIONS adina duser, tsc bozulmaz
const SHORT_TBL: Partial<Record<ActionId, string>> = {
  pass: 'Pas',
  shoot: 'Şut',
  lob: 'Aşırtma',
  switch: 'Değiştir',
  sprint: 'Sprint',
  tackle: 'Müdahale',
  precise: 'Hassas yürüme',
  pause: 'Menü',
  camera: 'Kamera',
  hints: 'Pas halkaları',
  camPrev: 'Önceki kamera',
  camNext: 'Sonraki kamera',
  through: 'Ara pas',
  driven: 'Sert pas',
  finesse: 'Falsolu şut',
  shield: 'Koruma',
  slide: 'Kayarak',
  press: 'Baskı',
  jockey: 'Jockey',
  teamPress: 'Takım baskısı',
}
const shortOf = (id: ActionId) => SHORT_TBL[id] ?? ACTIONS.find((a) => a.id === id)?.ad ?? id
const SYM: Partial<Record<Logical, string>> = {
  cross: '✕',
  circle: '○',
  square: '□',
  triangle: '△',
  l1: 'L1',
  r1: 'R1',
  l2: 'L2',
  r2: 'R2',
  options: 'Options',
  share: 'Share',
  ddown: '↓',
}

function PadScheme({ s }: { s: Settings }) {
  // varsayilan eslemeden: ozel atamasi olmayan eylemin adi dugmenin yaninda
  const at = (l: Logical) => {
    // ayni dugmedeki tum eylemler (topla / topsuz), ozel atamasi olmayanlar
    const as = ACTIONS.filter((x) => defaultOf(x, s.preset) === l && !s.bindings[x.id])
    return as.map((a) => shortOf(a.id))
  }
  const L = 'rgba(255,255,255,0.55)'
  // etiket: dugme simgesi + eylem adi; cizgi dolu
  const lab = (x: number, y: number, anchor: 'start' | 'end', l: Logical, tx: number, ty: number) =>
    !at(l).length ? null : (
      <g key={l}>
        <line x1={tx} y1={ty} x2={x + (anchor === 'start' ? -4 : 4)} y2={y - 4} stroke={L} strokeWidth="1" />
        <text x={x} y={y} textAnchor={anchor} className="gps-svg-act">
          {at(l).map((t, i) => (
            <tspan key={t} x={x} dy={i ? 11 : 0}>
              {t}
            </tspan>
          ))}
        </text>
      </g>
    )
  return (
    <svg className="gps-scheme" viewBox="-70 0 700 300" role="img" aria-label="PS düğme düzeni">
      {/* gövde */}
      <path
        d="M150 90 C120 90 96 112 82 168 C70 218 66 262 92 270 C118 278 136 240 160 212 C176 196 200 192 280 192 C360 192 384 196 400 212 C424 240 442 278 468 270 C494 262 490 218 478 168 C464 112 440 90 410 90 Z"
        fill="rgba(255,255,255,0.06)"
        stroke={L}
        strokeWidth="1.4"
      />
      {/* omuz: L2 R2 (ust), L1 R1 */}
      <rect x="132" y="56" width="70" height="20" rx="8" className="gps-key" />
      <rect x="358" y="56" width="70" height="20" rx="8" className="gps-key" />
      <rect x="128" y="76" width="82" height="12" rx="6" className="gps-key" />
      <rect x="350" y="76" width="82" height="12" rx="6" className="gps-key" />
      <text x="167" y="70" textAnchor="middle" className="gps-svg-sym">
        L2
      </text>
      <text x="393" y="70" textAnchor="middle" className="gps-svg-sym">
        R2
      </text>
      <text x="169" y="86" textAnchor="middle" className="gps-svg-sym s">
        L1
      </text>
      <text x="391" y="86" textAnchor="middle" className="gps-svg-sym s">
        R1
      </text>
      {/* yuz dugmeleri */}
      {(
        [
          ['triangle', 400, 118],
          ['cross', 400, 168],
          ['square', 374, 143],
          ['circle', 426, 143],
        ] as [Logical, number, number][]
      ).map(([l, x, y]) => (
        <g key={l}>
          <circle cx={x} cy={y} r="14" className="gps-key" />
          <text x={x} y={y + 5} textAnchor="middle" className="gps-svg-sym">
            {SYM[l]}
          </text>
        </g>
      ))}
      {/* yon tusu */}
      <path d="M150 128 h14 v-14 h14 v14 h14 v14 h-14 v14 h-14 v-14 h-14 z" className="gps-key" transform="translate(-12 4)" />
      {/* cubuklar */}
      <circle cx="222" cy="198" r="21" className="gps-key" />
      <circle cx="338" cy="198" r="21" className="gps-key" />
      <text x="222" y="203" textAnchor="middle" className="gps-svg-sym s">
        L
      </text>
      <text x="338" y="203" textAnchor="middle" className="gps-svg-sym s">
        R
      </text>
      {/* orta: share / options */}
      <rect x="236" y="104" width="22" height="9" rx="4" className="gps-key" />
      <rect x="302" y="104" width="22" height="9" rx="4" className="gps-key" />
      {/* etiketler (solda L tarafi, sagda R tarafi) */}
      {lab(112, 36, 'end', 'l2', 150, 56)}
      {lab(448, 36, 'start', 'r2', 410, 56)}
      {lab(100, 100, 'end', 'l1', 134, 82)}
      {lab(470, 92, 'start', 'r1', 426, 82)}
      {lab(482, 124, 'start', 'triangle', 414, 118)}
      {lab(496, 186, 'start', 'cross', 414, 168)}
      {lab(330, 126, 'end', 'square', 374, 143)}
      {lab(486, 150, 'start', 'circle', 440, 143)}
      <g>
        <line x1="247" y1="104" x2="247" y2="92" stroke={L} />
        <text x="247" y="88" textAnchor="middle" className="gps-svg-act">
          {at('share').join(' · ')}
        </text>
        <line x1="313" y1="104" x2="313" y2="92" stroke={L} />
        <text x="313" y="88" textAnchor="middle" className="gps-svg-act">
          {at('options').join(' · ')}
        </text>
        <line x1="142" y1="138" x2="108" y2="150" stroke={L} />
        {(
          [
            ['dleft', '← '],
            ['dright', '→ '],
            ['ddown', '↓ '],
          ] as [Logical, string][]
        ).map(([l, ar], i) => (
          <text key={l} x="104" y={150 + i * 16} textAnchor="end" className="gps-svg-act">
            {at(l).length ? ar + at(l).join(' · ') : ''}
          </text>
        ))}
        <line x1="222" y1="219" x2="222" y2="240" stroke={L} />
        <text x="222" y="254" textAnchor="middle" className="gps-svg-act">
          Koş
        </text>
        <line x1="338" y1="219" x2="338" y2="240" stroke={L} />
        <text x="338" y="254" textAnchor="middle" className="gps-svg-act">
          Kamera
        </text>
      </g>
    </svg>
  )
}

function useStopRef(onEsc: () => void) {
  const stop = useRef<(() => void) | null>(null)
  const esc = useRef(onEsc)
  esc.current = onEsc
  useEffect(() => {
    // Esc: ogrenmeyi iptal et (ekran kapanmaz)
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isLearning()) {
        stop.current?.()
        esc.current()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', k, true)
    return () => {
      window.removeEventListener('keydown', k, true)
      stop.current?.()
    }
  }, [])
  return stop
}

// ------------------------------------------------------------ tus atama tablosu
function Bindings({ s, pad }: { s: Settings; pad: PadInfo }) {
  const [learn, setLearn] = useState<ActionId | null>(null)
  const [warn, setWarn] = useState('')
  const stopRef = useStopRef(() => setLearn(null))
  useEffect(() => {
    // dis kaynak (ör. ekran kapanisi) ogrenmeyi bitirdiyse durum eslensin
    if (learn && isLearning() !== learn) setLearn(null)
  })
  const begin = (id: ActionId) => {
    setWarn('')
    if (learn === id) {
      // ayni satira tekrar tik: iptal (sihirbaz yok sayilir)
      setLearn(null)
      stopRef.current?.()
      return
    }
    stopRef.current?.()
    setLearn(id)
    stopRef.current = startLearn(id, (r) => {
      setLearn(null)
      if (r.conflicts.length) setWarn(`Bu giriş ayrıca şuna atanmış: ${r.conflicts.map((c) => shortOf(c)).join(', ')}`)
    })
  }
  const row = (a: (typeof ACTIONS)[number]) => {
    const custom = !!s.bindings[a.id]
    const active = learn === a.id
    return (
      <div key={a.id} className={`gps-bind ${active ? 'learn' : ''}`}>
        <span className="gps-bind-name" title={a.ad}>{shortOf(a.id)}</span>
        <button className="gps-chip" disabled={!pad.connected} onClick={() => begin(a.id)} title={pad.connected ? 'Değiştirmek için tıkla' : 'Kol bağlı değil'}>
          {active ? 'Bir tuşa bas…' : actionLabel(a.id)}
        </button>
        <button className="gps-x" disabled={!custom} onClick={() => clearBinding(a.id)} title="Varsayılana dön" aria-label="Varsayılana dön">
          ↺
        </button>
      </div>
    )
  }
  const col = (ctx: 'topla' | 'topsuz' | 'genel', title: string) => (
    <div className="gps-col">
      <div className="gps-col-t">{title}</div>
      {ACTIONS.filter((a) => a.ctx === ctx).map(row)}
    </div>
  )
  return (
    <div className="gps-binds">
      <div className="gps-presets" role="group" aria-label="Ön ayar">
        <button className={s.preset === 'fifa' ? 'on' : ''} onClick={() => setPreset('fifa')}>
          FIFA
        </button>
        <button className={s.preset === 'klasik' ? 'on' : ''} onClick={() => setPreset('klasik')}>
          Klasik
        </button>
      </div>
      <div className="gps-cols">
        {col('topla', 'Topla')}
        {col('topsuz', 'Topsuz')}
      </div>
      {col('genel', 'Genel')}
      {warn && <div className="gps-warn">{warn}</div>}
      {!pad.connected && <div className="gps-hint">Tuş atamak için kolu bağla ve bir tuşa bas.</div>}
    </div>
  )
}

// ------------------------------------------------------------ ekran
function Panel() {
  const s = useSettings()
  const pad = usePad()
  const set = (p: Partial<Settings>) => setSettings(p)
  const badge = badgeOf(pad)
  const pct = (v: number) => `${Math.round(v * 100)}%`

  // kol ayari acikken klavye oyuna gitmesin; Esc kapatir
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F3') return
      e.stopImmediatePropagation()
      if (e.key === 'Escape') closeGamepadSettings()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div
      className="gps-overlay"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="gps-card" role="dialog" aria-label="Kol Ayarları">
        <div className="gps-head">
          <h2>Kol Ayarları</h2>
          <button className="gps-close" onClick={closeGamepadSettings} aria-label="Kapat">
            ✕
          </button>
        </div>

        <div className={`gps-pad ${pad.connected ? 'on' : ''}`}>
          <i />
          {pad.connected ? (
            <>
              <span className="gps-pad-name">{cleanName(pad.name)}</span>
              <b className={`gps-badge ${badge.toLowerCase()}`}>{badge}</b>
              {pad.needsLearn && <small>Tanınmayan kol: tuşları aşağıdan ata</small>}
            </>
          ) : (
            <span className="gps-pad-name">Kol bağlı değil, bir tuşa bas</span>
          )}
        </div>

        <div className="gps-cols">
          <section>
            <h3>Çubuklar</h3>
            <Slider label="Sol çubuk ölü bölge" value={s.deadL} min={0.05} max={0.4} step={0.01} fmt={pct} onChange={(v) => set({ deadL: v })} />
            <Slider label="Sağ çubuk ölü bölge" value={s.deadR} min={0.05} max={0.4} step={0.01} fmt={pct} onChange={(v) => set({ deadR: v })} />
            <div className="gps-row">
              <span className="gps-lab">Hassasiyet eğrisi</span>
              <div className="gps-seg">
                <button className={s.curve === 'dogrusal' ? 'on' : ''} onClick={() => set({ curve: 'dogrusal' })}>
                  Doğrusal
                </button>
                <button className={s.curve === 'ustel' ? 'on' : ''} onClick={() => set({ curve: 'ustel' })}>
                  Üstel
                </button>
              </div>
            </div>
            <Slider
              label="Kamera hızı"
              value={s.camSpeed}
              min={0.3}
              max={2}
              step={0.05}
              fmt={(v) => `${v.toFixed(2)}x`}
              onChange={(v) => set({ camSpeed: v })}
            />
            <Slider label="Tetik eşiği" value={s.trigger} min={0.1} max={0.9} step={0.01} fmt={pct} onChange={(v) => set({ trigger: v })} />
            <Toggle label="Kamera Y eksenini ters çevir" on={s.invertY} onChange={(v) => set({ invertY: v })} />

            <h3>Titreşim</h3>
            <Toggle label="Titreşim açık" on={s.rumble} onChange={(v) => set({ rumble: v })} />
            <Slider label="Şiddet" value={s.rumbleLevel} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => set({ rumbleLevel: v })} />
            <button className="gps-test" disabled={!pad.connected || !s.rumble} onClick={() => rumble('gol')}>
              Test et
            </button>
            <h3>PS düzeni</h3>
            <PadScheme s={s} />
          </section>

          <section>
            <h3>Tuş ataması</h3>
            <Bindings s={s} pad={pad} />
          </section>
        </div>

        <div className="gps-foot">
          <button className="gps-reset" onClick={() => resetSettings()} disabled={JSON.stringify(s) === JSON.stringify(DEFAULTS)}>
            Varsayılana dön
          </button>
          <button className="gps-done" onClick={closeGamepadSettings}>
            Tamam
          </button>
        </div>
      </div>
    </div>
  )
}

export function GamepadSettingsHost() {
  return useOpen() ? <Panel /> : null
}
