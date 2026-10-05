import { useSyncExternalStore } from 'react'
import { getTimeOfDay, setTimeOfDay, subscribeTimeOfDay, TIMES } from './timeOfDay'

// HUD icin gunun saati secici (F yerlestirir). Tiklama ve ?time= ayni durumu kullanir.
export function TimeOfDayPicker({ className = '' }: { className?: string }) {
  const t = useSyncExternalStore(subscribeTimeOfDay, getTimeOfDay)
  return (
    <div className={'tod ' + className} role="group" aria-label="Günün saati">
      {TIMES.map((x) => (
        <button key={x.id} className={x.id === t ? 'on' : ''} onClick={() => setTimeOfDay(x.id)}>
          {x.label}
        </button>
      ))}
    </div>
  )
}
