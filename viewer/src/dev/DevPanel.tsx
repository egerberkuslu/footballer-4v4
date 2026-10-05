import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { world } from '../sim'
import { devStats, getDev, setDev, subscribeDev, type DevFlags } from './devStore'

const box: CSSProperties = {
  position: 'fixed',
  right: 12,
  top: 12,
  zIndex: 20,
  font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#e8eef5',
  background: 'rgba(8, 12, 18, 0.72)',
  borderRadius: 8,
  padding: '6px 10px',
  pointerEvents: 'auto',
  minWidth: 92,
  backdropFilter: 'blur(4px)',
}

function fpsColor(fps: number) {
  if (fps >= 58) return '#4ade80'
  if (fps >= 45) return '#facc15'
  return '#f87171'
}

const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)

function Toggle({ k, label, flags }: { k: keyof DevFlags; label: string; flags: DevFlags }) {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
      <input type="checkbox" checked={flags[k]} onChange={(e) => setDev({ [k]: e.target.checked })} />
      {label}
    </label>
  )
}

export function DevPanel() {
  const flags = useSyncExternalStore(subscribeDev, getDev)
  const [, tick] = useState(0)

  // panel 4 Hz guncellenir; her karede React render'i yapilmaz
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F3' || (e.key === '`' && !e.repeat)) {
        e.preventDefault()
        setDev({ on: !getDev().on })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const s = devStats
  const b = world.ball
  const speed = Math.hypot(b.vx, b.vy, b.vz)
  const spin = Math.hypot(b.wx, b.wy, b.wz)

  return (
    <div style={box}>
      <div
        style={{ display: 'flex', alignItems: 'baseline', gap: 6, cursor: 'pointer' }}
        title="Dev modu: F3"
        onClick={() => setDev({ on: !flags.on })}
      >
        <b style={{ fontSize: 18, color: fpsColor(s.fps) }}>{Math.round(s.fps)}</b>
        <span>fps</span>
        <span style={{ opacity: 0.7 }}>{f2(s.frameMs)} ms</span>
      </div>
      {flags.on && (
        <div style={{ marginTop: 6, display: 'grid', gap: 2 }}>
          <div>en kötü %1: {f1(s.worstMs)} ms</div>
          <div>bütçe 60 fps: {f1(16.67 - s.frameMs)} ms {s.frameMs <= 16.67 && s.worstMs <= 20 ? '✓' : '✗'}</div>
          <div>oyun mantığı (CPU): {f2(s.logicMs)} ms</div>
          <div>fizik: {f2(s.simMs)} ms</div>
          {s.clothN > 0 && (
            <div>
              kumaş: {f2(s.clothMs)} ms · {s.clothN} parçacık
            </div>
          )}
          <div>draw call: {s.calls}</div>
          <div>üçgen: {(s.tris / 1e6).toFixed(2)} M</div>
          <div>geometri / doku: {s.geoms} / {s.textures}</div>
          <div style={{ marginTop: 4 }}>top hız: {f1(speed)} m/s · spin: {f1(spin)} rad/s</div>
          <div>
            top: {f2(b.x)}, {f2(b.y)}, {f2(b.z)}
          </div>
          <div>ağ düğümü: {world.pos.length / 3} · temas: {world.netContact ? 'evet' : 'hayır'}</div>
          <div style={{ marginTop: 6, display: 'grid', gap: 2 }}>
            <Toggle k="hitboxes" label="top + direk kutuları" flags={flags} />
            <Toggle k="nodes" label="ağ düğümleri" flags={flags} />
            <Toggle k="triggers" label="gol hacmi + saha sınırı" flags={flags} />
            <Toggle k="statics" label="kafes + çevre çarpışmaları" flags={flags} />
            <Toggle k="offside" label="ofsayt vücut noktaları + çizgi" flags={flags} />
          </div>
          <div style={{ opacity: 0.6, marginTop: 4 }}>F3: dev modu aç/kapa</div>
        </div>
      )}
    </div>
  )
}
