// VAR arayuzu (Canvas disi): inceleme bandi, kamera adi, zaman cubugu, olcum paneli, karar karti,
// sag altta VAR dugmesi + otomatik ac/kapa. X: elle inceleme, Esc: atla.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { isGuest } from '../mp/role'
import { fmtCm } from './judge'
import { requestVar, setAuto, skipVar, subscribeVar, varState, varVersion } from './store'
import './var.css'

const sec = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2).replace('.', ',')} s`

// zaman cubugu: her karede DOM'a dogrudan yazilir
function Timeline() {
  const fill = useRef<HTMLDivElement>(null)
  const mark = useRef<HTMLDivElement>(null)
  const time = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let id = 0
    const loop = () => {
      const s = varState
      const span = Math.max(1e-3, s.t1 - s.t0)
      const k = Math.min(1, Math.max(0, (s.tNow - s.t0) / span))
      const c = Math.min(1, Math.max(0, (s.tc - s.t0) / span))
      if (fill.current) fill.current.style.transform = `scaleX(${k})`
      if (mark.current) mark.current.style.left = `${c * 100}%`
      if (time.current) time.current.textContent = sec(s.tNow - s.tc)
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div className="var-timeline">
      <span className="var-tl-lbl">KRİTİK ANA</span>
      <span ref={time} className="var-tl-time" />
      <div className="var-track">
        <div ref={fill} className="var-fill" />
        <div ref={mark} className="var-mark" />
      </div>
      <span className="var-tl-skip">
        <kbd>Esc</kbd> atla
      </span>
    </div>
  )
}

export function VarOverlay() {
  useSyncExternalStore(subscribeVar, varVersion)
  const s = varState
  const d = s.display

  // X: elle inceleme; inceleme sirasinda diger tuslar oyuna gitmez (F3 ve ` dev'e serbest)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'F3' || e.key === '`') return
      if (varState.active) {
        e.stopImmediatePropagation()
        e.preventDefault()
        if (e.key === 'Escape' && !e.repeat) skipVar()
        return
      }
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return
      if (e.key === 'x' || e.key === 'X') requestVar()
    }
    const keyUp = (e: KeyboardEvent) => {
      if (varState.active && e.key !== 'F3' && e.key !== '`') e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', keyUp, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', keyUp, true)
    }
  }, [])

  useEffect(() => {
    document.body.classList.toggle('var-on', s.active)
  }, [s.active])

  const guest = isGuest()
  const widget = (
    <>
      <div className="var-widget">
        <button className="var-btn" onClick={requestVar} disabled={s.active || guest} title="Son pozisyonu VAR ile incele">
          <i className="var-dot" />
          VAR <kbd>X</kbd>
        </button>
        <button
          className={`var-auto ${s.auto === 'acik' ? 'hepsi' : 'kapali'}`}
          onClick={() => setAuto(s.auto === 'acik' ? 'kapali' : 'acik')}
          title="Otomatik VAR: yalnız kıl payı gol çizgisi ve ofsayt pozisyonları"
        >
          {s.auto === 'acik' ? 'Oto VAR: açık' : 'Oto VAR: kapalı'}
        </button>
      </div>
      {s.toast && (
        <div key={s.toastId} className="var-toast">
          {s.toast}
        </div>
      )}
    </>
  )

  if (!s.active || !d) return widget

  const showCard = s.phase === 'verdict' || s.phase === 'signal' || s.phase === 'outro'
  const replay = s.phase === 'play' || s.phase === 'freeze' || s.phase === 'monitor'
  return (
    <>
      {widget}
      <div className={`var-root ph-${s.phase}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="var-bars" />
        <div className="var-band">
          <div className="var-band-main">
            <i className="var-rec" />
            <b>VAR İNCELEMESİ</b>
          </div>
          <div className="var-band-sub">{s.phase === 'walk' ? `${s.reason} · hakem monitöre gidiyor` : s.reason}</div>
        </div>

        {s.cam && (
          <div key={s.cam} className="var-cam">
            <span className="var-cam-name">{s.cam}</span>
            <span className="var-cam-speed">{s.phase === 'play' ? '0,25×' : s.phase === 'walk' || s.phase === 'signal' ? 'CANLI' : s.phase === 'monitor' ? 'TEKRAR' : 'DURDURULDU'}</span>
          </div>
        )}
        {s.cam && <div key={`f-${s.cam}`} className="var-flash" />}

        {s.phase === 'freeze' && (
          <div className={`var-measure ${d.ok ? 'ok' : 'no'}`}>
            <span className="var-m-lbl">{d.measure}</span>
            <b>{fmtCm(d.cm)}</b>
            <span className="var-m-sub">{d.ok ? d.okText : d.noText}</span>
          </div>
        )}

        {showCard && (
          <div className={`var-card ${d.cls} ${s.phase === 'outro' ? 'out' : ''} ${s.phase === 'signal' ? 'low' : ''}`}>
            <div className="var-card-tag">{d.tag}</div>
            <div className="var-card-title">{d.title}</div>
            <div className="var-card-sub">{d.sub}</div>
            <div className="var-card-stat">
              <span>{s.case?.kind === 'offside' ? 'Ofsayt farkı' : 'Çizgiye göre'}</span>
              <b>{fmtCm(d.cm)}</b>
            </div>
            <div className="var-card-sweep" />
          </div>
        )}

        {replay && <Timeline />}
      </div>
    </>
  )
}
