// Mac HUD'u: skor tabelasi + saat + devre, faz/karar bandi, ses ayari.
// F'nin HUD'una <RulesHud /> olarak takilir (Canvas DISINDA). Kare basina React render'i yok:
// saat DOM'a dogrudan yazilir, skor/bant degisince yeniden cizilir.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { game } from '../game/store'
import { isVarActive } from '../var/store'
import { sfx } from './audio'
import { TEAM_NAMES } from './engine'
import { currentRules } from './instance'
import './rules.css'

const PHASE_TEXT: Partial<Record<string, string>> = {
  kickoff: 'Başlama vuruşu',
  freekick: 'Serbest vuruş',
  penalty: 'Penaltı',
  corner: 'Korner',
  kickin: 'Taç (ayakla)',
  goalkick: 'Kale vuruşu',
  halftime: 'Devre arası',
  fulltime: 'Maç sonu',
  stopped: 'Oyun durdu',
  var: 'VAR incelemesi',
}

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

function SoundCtl() {
  const v = useSyncExternalStore(
    (f) => sfx.subscribe(f),
    () => `${sfx.muted}|${sfx.volume}|${sfx.ready}`,
  )
  const [muted, vol, ready] = v.split('|')
  return (
    <div className="rh-sound" onPointerDown={(e) => e.stopPropagation()}>
      <button
        className={muted === 'true' ? 'off' : ''}
        title={ready === 'true' ? 'Sesi aç/kapat' : 'Ses ilk tıklamada açılır'}
        onClick={() => {
          sfx.init()
          sfx.toggleMute()
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
          {muted === 'true' ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12" />}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={Number(vol)}
        onChange={(e) => {
          sfx.init()
          sfx.setVolume(Number(e.target.value))
        }}
        aria-label="Ses düzeyi"
      />
    </div>
  )
}

export function RulesHud() {
  const clock = useRef<HTMLSpanElement>(null)
  const count = useRef<HTMLDivElement>(null)
  const adv = useRef<HTMLDivElement>(null)
  const susp = useRef<HTMLDivElement>(null)
  const [snap, setSnap] = useState('')

  useEffect(() => {
    let id = 0
    let last = ''
    let lastClock = ''
    const loop = () => {
      const m = game.match
      const c = `${m.half}. Y  ${fmt(m.clock)}`
      if (c !== lastClock && clock.current) {
        clock.current.textContent = c
        lastClock = c
      }
      if (adv.current) {
        const on = m.advantageUntil > 0
        adv.current.style.opacity = on ? '1' : '0'
        if (on) adv.current.style.setProperty('--k', String(Math.max(0, (m.advantageUntil - m.clock) / 2)))
      }
      // duran top geri sayimi (3-2-1): her tam saniyede yeniden atar
      const cd = currentRules().countdown
      const el = count.current
      if (el) {
        const n = cd === null || isVarActive() ? '' : String(Math.max(1, Math.ceil(cd)))
        if (el.textContent !== n) {
          el.textContent = n
          el.classList.remove('beat')
          if (n) {
            void el.offsetWidth // animasyonu yeniden baslat
            el.classList.add('beat')
          }
        }
        el.classList.toggle('last', cd !== null && cd <= 1)
      }
      // cezali (kirmizi kart) oyuncular: simge + kalan sure, her kare yazilir
      const sl = (m as unknown as { suspended?: { id: number; left: number }[] }).suspended ?? []
      if (susp.current) {
        const nodes = susp.current.children
        if (nodes.length !== sl.length) {
          susp.current.replaceChildren(...sl.map(() => document.createElement('span')))
        }
        sl.forEach((e, i) => {
          const q = game.players[e.id]
          const t = `\u{1F7E5} ${TEAM_NAMES[q.team]} ${q.number} · ${Math.ceil(e.left)} sn`
          const el = susp.current!.children[i] as HTMLElement
          if (el.textContent !== t) el.textContent = t
          el.className = q.team === 0 ? 't0' : 't1'
        })
      }
      const b = currentRules().banner
      const tk = m.restart?.taker
      const mine = tk !== undefined && !!game.players[tk]?.controlled
      const s = `${m.score[0]}|${m.score[1]}|${m.phase}|${b ? b.id : 0}|${mine}|${!!m.restart?.indirect}|${isVarActive()}`
      if (s !== last) {
        last = s
        setSnap(s)
      }
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])

  const m = game.match
  // VAR tekrari acikken G'nin katmani konusur: orta bant, faz satiri ve ipucu gizli
  const varOn = isVarActive()
  const b = varOn ? null : currentRules().banner
  const phase = PHASE_TEXT[m.phase]
  const tk = m.restart?.taker
  const ind = m.restart?.indirect ? ' (endirekt)' : ''
  const hint = !varOn && m.phase !== 'play' && tk !== undefined && game.players[tk]?.controlled ? `${phase ?? 'Duran top'}${ind}: pas (K) / şut (Boşluk)` : ''
  void snap
  return (
    <div className="rh">
      <div className="rh-board">
        <span className="rh-team t0">
          <i />
          {TEAM_NAMES[0]}
        </span>
        <b className="rh-score">
          {m.score[0]}
          <em>-</em>
          {m.score[1]}
        </b>
        <span className="rh-team t1">
          {TEAM_NAMES[1]}
          <i />
        </span>
        <span ref={clock} className="rh-clock" />
      </div>
      <div ref={susp} className="rh-susp" />
      <div className="rh-phase">{phase && !b && !varOn ? phase + (m.restart?.indirect ? ' · endirekt' : '') : ''}</div>
      <div ref={adv} className="rh-adv">
        AVANTAJ
        <span />
      </div>
      {b && (
        <div key={b.id} className={`rh-banner ${b.kind}`}>
          <div className="t">{b.text}</div>
          {b.sub && <div className="s">{b.sub}</div>}
        </div>
      )}
      {hint && <div className="rh-hint">{hint}</div>}
      <div ref={count} className="rh-count" />
      <SoundCtl />
    </div>
  )
}
