// B2+I2: kaleci dalisi kare dizisi (gercek GPU). El hedefi (kirmizi) ve temas noktasi (yesil) isaretleri diveState'ten cizilir.
// Kullanim: scripts/run-browser.sh node scripts/keeper-dive-shots.mjs [oneki=shots/dive] [z=2.0] [y=1.4] [hiz=20]
import { chromium } from 'playwright'
const prefix = process.argv[2] ?? 'shots/dive'
const tz = Number(process.argv[3] ?? 2.0)
const ty = Number(process.argv[4] ?? 1.4)
const V = Number(process.argv[5] ?? 20)
const RND = Number(process.argv[6] ?? 0.01) // Math.random sabiti: 0.01 -> tutma/yumruk, 0.99 -> kacirma
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1100, height: 650 } })
const logs = []
p.on('pageerror', (e) => logs.push('pageerror ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()) })
await p.goto('http://127.0.0.1:5173/?mode=mac&blades=20000&boot=0')
await p.waitForTimeout(9000)
const info = await p.evaluate(async ([tz, ty, V]) => {
  const g = window.__game
  const w = window.__shot.world
  const ctl = window.__shot.ctl
  const urlOf = (k) => performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes(k) && !n.includes('?t=' ) ) || performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes(k))
  const kd = await import(urlOf('/sim/keeperDive'))
  window.__kd = kd
  ctl.cam = 'serbest'
  g.match.phase = 'play'
  g.match.restart = null
  g.humanTeam = null
  for (const q of g.players) Object.assign(q, { x: -14 + q.id * 1.5, z: 11, vx: 0, vz: 0, hasBall: false, actionLock: 0, controlled: false })
  const K = g.players.find((q) => q.role === 'kaleci' && -g.match.attackDir[q.team] * 20 > 0)
  Object.assign(K, { x: 19.4, z: 0, facing: -Math.PI / 2, vx: 0, vz: 0 })
  window.__K = K
  w.placeBall(8, 0.2)
  const T0 = 6.0
  const v = { x: V, y: 0, z: 0 }
  const dx = 20 - 8
  const t = dx / V
  v.y = (ty - 0.11 + 0.5 * 9.81 * t * t) / t
  v.z = (tz - 0.2) / t
  w.kick(v, { x: 0, y: 0, z: 0 })
  // isaretler
  const s = window.__r3f.get()
  let ball
  s.scene.traverse((o) => { if (!ball && o.isMesh && o.geometry?.type === 'SphereGeometry' && Math.abs(o.geometry.parameters.radius - 0.11) < 0.02) ball = o })
  const mk = (color) => { const m = ball.clone(); m.material = ball.material.clone(); m.material.color?.set(color); m.material.emissive?.set(color); m.scale.setScalar(0.5); m.frustumCulled = false; s.scene.add(m); return m }
  window.__hm = mk('#ff2020')
  window.__cm = mk('#20ff20')
  return { keeper: K.id, role: K.role }
}, [tz, ty, V])
console.log('kaleci', JSON.stringify(info))
const cam = () => p.evaluate(() => {
  const s = window.__r3f.get()
  s.camera.position.set(12.5, 1.7, 0.3)
  s.controls.target.set(20, 1.0, 0)
  s.camera.lookAt(s.controls.target)
  const K = window.__K
  const sp = window.__kd.diveOf(K.id)
  if (sp) {
    const st = window.__kd.diveState(sp, window.__kd.diveClock.t)
    window.__hm.position.set(st.hand.x, st.hand.y, st.hand.z)
    window.__cm.position.set(sp.contact.x, sp.contact.y, sp.contact.z)
    return { phase: st.phase, u: +st.u.toFixed(2), root: [+st.x.toFixed(2), +st.y.toFixed(2), +st.z.toFixed(2)], hand: [+st.hand.x.toFixed(2), +st.hand.y.toFixed(2), +st.hand.z.toFixed(2)], outcome: sp.outcome, reach: sp.reach, contact: [+sp.contact.x.toFixed(2), +sp.contact.y.toFixed(2), +sp.contact.z.toFixed(2)], tcAbs: +sp.tc.toFixed(2), clock: +window.__kd.diveClock.t.toFixed(2), tc: +(sp.tc - window.__kd.diveClock.t).toFixed(2), anim: K.anim, kz: +K.z.toFixed(2), has: K.hasBall, ball: (({x,y,z})=>[+x.toFixed(2),+y.toFixed(2),+z.toFixed(2)])(window.__shot.world.ball) }
  }
  return { anim: K.anim, kz: +K.z.toFixed(2) }
})
await cam()
// dalis komutu: sutun hemen ardindan
await p.waitForTimeout(80)
await p.evaluate((RND) => {
  Math.random = () => RND
  const g = window.__game
  const K = window.__K
  const b = window.__shot.world.ball
  g.inputs[K.id].action = { type: 'dive', power: 0, aim: { x: 20, y: b.y, z: b.z } }
}, RND)
const rows = []
for (let i = 0; i < 16; i++) {
  rows.push(await cam())
  await p.screenshot({ path: `${prefix}-${String(i).padStart(2, '0')}.png` })
  await p.waitForTimeout(60)
}
console.log(rows.map((r) => JSON.stringify(r)).join('\n'))
console.log(logs.join('\n') || 'console: temiz')
await b.close()
