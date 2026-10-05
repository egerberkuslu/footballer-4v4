// Host arka planda (L): sekme gizliyken rAF durur, mac herkes icin donardi. Worker zamanlayicisi 60 Hz
// tik atar; oncelik <= 0 useFrame aboneleri (girdi, AI, kurallar, locomotion, world.step, snapshot,
// VAR akisi, animasyon olaylari) kosar. gl.render ve son isleme (pozitif oncelik) calismaz.
// Sekme gorunur olunca rAF devralir.
import type { RootState, Subscription } from '@react-three/fiber'

const WORKER_SRC = `let id=0;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}`

export function startBackgroundTick(getState: () => RootState, active: () => boolean): () => void {
  let worker: Worker | null = null
  let last = 0
  const tick = () => {
    if (!document.hidden || !active()) {
      last = 0
      return
    }
    const now = performance.now()
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
    last = now
    const st = getState()
    const subs = (st.internal as unknown as { subscribers: Subscription[] }).subscribers
    // R3F aboneleri oncelige gore sirali tutar; yine de sirala (kopya)
    const list = subs.filter((s) => s.priority <= 0).sort((a, b) => a.priority - b.priority)
    for (const s of list) s.ref.current?.(s.store.getState(), dt)
  }
  const onVis = () => {
    if (!worker) return
    worker.postMessage(document.hidden ? 1000 / 60 : 0)
    last = 0
  }
  try {
    worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })))
    worker.onmessage = tick
    document.addEventListener('visibilitychange', onVis)
    onVis()
  } catch {
    // Worker yoksa (CSP vb.) arka plan tik'i yok
    worker = null
  }
  return () => {
    document.removeEventListener('visibilitychange', onVis)
    worker?.terminate()
    worker = null
  }
}
