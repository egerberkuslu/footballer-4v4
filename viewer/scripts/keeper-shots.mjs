// Kaleci ajani: gercek mac sayfasinda dalis/tutma kare dizisi + katman sayaci. keeper-dive-shots.mjs'ten uyarlandi.
// Kullanim: scripts/run-browser.sh node scripts/keeper-shots.mjs <oneki> <clips 0|1> <senaryo> [n=24] [aralik_ms=70] [kamera=front|side]
//   senaryo: dive:<z>:<y>[:<hiz>]  (sut hedefi kale cizgisinde z, y; kaleci dalis komutu alir)
//            catch:<y>              (yavas top kaleciye: tutma, keeper-collect / catch-high)
import { chromium } from 'playwright'
const [prefix, clips = '1', scen = 'dive:2:1', nArg = '24', gapArg = '70', camArg = 'front'] = process.argv.slice(2)
const N = Number(nArg)
const GAP = Number(gapArg)
const [kind, a1, a2, a3] = scen.split(':')
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 720, height: 460 } })
const logs = []
p.on('pageerror', (e) => logs.push('pageerror ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()) })
await p.goto(`http://127.0.0.1:5173/?mode=mac&blades=20000&boot=0&clips=${clips}`)
await p.waitForTimeout(9000)
// arayuz katmanlarini gizle (yalniz tuval)
await p.addStyleTag({ content: 'body *:not(canvas){visibility:hidden !important} canvas{visibility:visible !important}' })
await p.evaluate(async ([kind, a1, a2, a3, KDBG, RNDV]) => {
  const g = window.__game
  const w = window.__shot.world
  const ctl = window.__shot.ctl
  const urlOf = (k) => performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes(k))
  window.__kd = await import(urlOf('/sim/keeperDive'))
  ctl.cam = 'serbest'
  g.match.phase = 'play'
  g.match.restart = null
  g.humanTeam = null
  for (const q of g.players) Object.assign(q, { x: -14 + q.id * 1.5, z: 11, vx: 0, vz: 0, hasBall: false, actionLock: 0, controlled: false })
  const K = g.players.find((q) => q.role === 'kaleci' && -g.match.attackDir[q.team] * 20 > 0)
  if (KDBG) window.__keeperDbg = []
  Object.assign(K, { x: 19.4, z: 0, facing: -Math.PI / 2, vx: 0, vz: 0 })
  window.__K = K
  if (kind === 'dive') {
    const tz = Number(a1), ty = Number(a2), V = Number(a3 ?? 20)
    w.placeBall(8, 0.2)
    const t = 12 / V
    w.kick({ x: V, y: (ty - 0.11 + 0.5 * 9.81 * t * t) / t, z: (tz - 0.2) / t }, { x: 0, y: 0, z: 0 })
    // dalis komutu ayni karede (AI'nin kosmaya baslamasindan once)
    Math.random = () => RNDV
    // AI ayni karede girdiyi ezebilir: komut ilk okunana kadar yazmalari yok say
    const inp = g.inputs[K.id]
    let pending = { type: 'dive', power: 0, aim: { x: 20, y: ty, z: tz } }
    Object.defineProperty(inp, 'action', {
      configurable: true,
      get() {
        if (K.anim.startsWith('keeper-dive') && pending) {
          pending = null
          Object.defineProperty(inp, 'action', { value: null, writable: true, configurable: true, enumerable: true })
        }
        return pending
      },
      set() {},
    })
  } else {
    const ty = Number(a1)
    w.placeBall(13, 0.2)
    const V = 6, t = 6.4 / V
    w.kick({ x: V, y: (ty - 0.11 + 0.5 * 9.81 * t * t) / t, z: 0 }, { x: 0, y: 0, z: 0 })
  }
}, [kind, a1, a2, a3, !!process.env.KDBG, Number(process.env.RND ?? 0.01)])
const cam = (camArg) => p.evaluate((camArg) => {
  const s = window.__r3f.get()
  const K = window.__K
  if (camArg === 'side') s.camera.position.set(K.x - 1.2, 1.2, K.z + 4.2)
  else s.camera.position.set(K.x - 4.2, 1.25, K.z)
  s.controls.target.set(K.x, 0.6, K.z)
  s.camera.lookAt(s.controls.target)
  const L = window.__layers?.keeper
  return { anim: K.anim, t: +K.animT.toFixed(2), kz: +K.z.toFixed(2), has: K.hasBall, layer: L ? `${L.loaded ? 'OK' : 'yok'}/${L.frames}` : '-' }
}, camArg)
if (kind === 'dive') {
  await p.waitForTimeout(10)
  // AI girdiyi ezebilir: dalis baslayana kadar komutu birkac kez yinele
  for (let k = 0; k < 12; k++) {
    const ok = await p.evaluate((RNDV) => {
      Math.random = () => RNDV
      const K = window.__K
      if (K.anim.startsWith('keeper-dive')) return true
      const bb = window.__shot.world.ball
      window.__game.inputs[K.id].action = { type: 'dive', power: 0, aim: { x: 20, y: bb.y, z: bb.z } }
      return false
    }, Number(process.env.RND ?? 0.01))
    if (ok) break
    await p.waitForTimeout(25)
  }
}
const rows = []
for (let i = 0; i < N; i++) {
  rows.push(await cam(camArg))
  await p.screenshot({ path: `${prefix}-${String(i).padStart(2, '0')}.png` })
  await p.waitForTimeout(GAP)
}
console.log(rows.map((r, i) => i + ' ' + JSON.stringify(r)).join('\n'))
if (process.env.KDBG) console.log('DBG', JSON.stringify(await p.evaluate(() => (window.__keeperDbg || []).filter((_, i) => i % 3 === 0))))
console.log(logs.join('\n') || 'console: temiz')
await b.close()
