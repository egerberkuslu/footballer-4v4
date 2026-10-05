import type * as THREE from 'three'

// ?gprof=1: cim cizimlerinin GPU suresini EXT_disjoint_timer_query_webgl2 ile olcer.
// Sonuc window.__grassMs = { ad: ortalama ms } (son 60 olcum). Firefox'ta uzanti yoksa sessizce kapali.
export const GPROF = new URLSearchParams(location.search).get('gprof') === '1'

type Slot = { q: WebGLQuery | null; pending: WebGLQuery[]; samples: number[] }
const slots = new Map<string, Slot>()

export function attachGpuTimer(mesh: THREE.Mesh, name: string) {
  if (!GPROF) return
  mesh.onBeforeRender = (renderer) => {
    const gl = renderer.getContext() as WebGL2RenderingContext
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    if (!ext) return
    let s = slots.get(name)
    if (!s) slots.set(name, (s = { q: null, pending: [], samples: [] }))
    // biten sorgulari topla
    while (s.pending.length && gl.getQueryParameter(s.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = s.pending.shift()!
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) s.samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6)
      gl.deleteQuery(q)
      if (s.samples.length > 60) s.samples.shift()
    }
    s.q = gl.createQuery()
    gl.beginQuery(ext.TIME_ELAPSED_EXT, s.q!)
  }
  mesh.onAfterRender = (renderer) => {
    const gl = renderer.getContext() as WebGL2RenderingContext
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    const s = slots.get(name)
    if (!ext || !s?.q) return
    gl.endQuery(ext.TIME_ELAPSED_EXT)
    s.pending.push(s.q)
    s.q = null
  }
  const w = window as unknown as { __grassMs?: () => Record<string, number> }
  w.__grassMs = () => {
    const r: Record<string, number> = {}
    for (const [k, s] of slots) r[k] = s.samples.length ? s.samples.reduce((a, b) => a + b, 0) / s.samples.length : -1
    return r
  }
}
