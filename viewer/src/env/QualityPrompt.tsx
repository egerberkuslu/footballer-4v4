import { useEffect, useState } from 'react'
import { QUALITY, setQuality } from './quality'

// Ilk 6 s sonrasi 3 s'lik ortalama fps < 40 ise kucuk bir oneri: kullanici karar verir (otomatik degisim yok).
// Secim localStorage'a yazilir (quality.ts). Menu stiline uyar (.hud button). App.tsx'e <QualityPrompt /> eklenir.
export function QualityPrompt() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (QUALITY === 'low') return
    try {
      if (sessionStorage.getItem('kalite-oneri-red')) return
    } catch {
      /* depolama kapali */
    }
    let raf = 0
    let n = 0
    let t0 = 0
    const start = performance.now() + 6000
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now < start || document.hidden) return
      if (!t0) t0 = now
      n++
      if (now - t0 >= 3000) {
        if ((n * 1000) / (now - t0) < 40) setShow(true)
        cancelAnimationFrame(raf)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  if (!show) return null
  const dismiss = () => {
    try {
      sessionStorage.setItem('kalite-oneri-red', '1')
    } catch {
      /* depolama kapali */
    }
    setShow(false)
  }
  return (
    <div className="hud" style={{ position: 'fixed', top: 'auto', left: 14, bottom: 14, zIndex: 20, pointerEvents: 'auto' }}>
      <div className="panel" role="status">
        <span className="title">Akıcılık düşük</span>
        <div className="row">
          <button className="primary" onClick={() => setQuality('low')}>
            Düşük kaliteye geç?
          </button>
          <button onClick={dismiss}>Kalsın</button>
        </div>
      </div>
    </div>
  )
}
