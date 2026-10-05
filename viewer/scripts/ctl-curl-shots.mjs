// B2: macta falso kare dizisi (gercek GPU): sarj sirasinda kivrimli onizleme + gercek ucus.
// Kullanim: scripts/run-browser.sh node scripts/ctl-curl-shots.mjs [oneki=shots/curl] [curl=3] [guc_ms=700]
import { chromium } from 'playwright'
const prefix = process.argv[2] ?? 'shots/curl'
const curl = Number(process.argv[3] ?? 3)
const chargeMs = Number(process.argv[4] ?? 700)
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1100, height: 650 } })
const logs = []
p.on('pageerror', (e) => logs.push('pageerror ' + e.message))
await p.goto('http://127.0.0.1:5173/?mode=mac&blades=20000&boot=0')
await p.waitForTimeout(9000)
await p.evaluate((curl) => {
  const g = window.__game
  const w = window.__shot.world
  const ctl = window.__shot.ctl
  ctl.cam = 'serbest'
  g.match.phase = 'play'
  g.match.restart = null
  for (const q of g.players) Object.assign(q, { x: -14 + q.id * 1.5, z: 11, vx: 0, vz: 0, hasBall: false, actionLock: 0 })
  const A = g.players[3]
  Object.assign(A, { x: -2, z: 0, facing: Math.PI / 2 })
  for (const q of g.players) q.controlled = q.id === 3
  w.placeBall(-1.45, 0)
  ctl.curl = curl
  window.__setCam = () => {
    const s = window.__r3f.get()
    s.camera.position.set(-9, 3.2, 6.5)
    s.controls.target.set(8, 0.6, 0)
    s.camera.lookAt(s.controls.target)
    s.camera.updateMatrixWorld()
    // fare: kale ortasina (nisan)
    const v = new (s.camera.position.constructor)(20, 1.0, 0).project(s.camera)
    ctl.aimNdc = [v.x, v.y]
  }
}, curl)
const cam = () => p.evaluate(() => window.__setCam())
await cam()
await p.waitForTimeout(500)
await cam()
await p.keyboard.down('Space')
const t0 = Date.now()
let n = 0
while (Date.now() - t0 < chargeMs) {
  await cam()
  if (n === 0 || Date.now() - t0 > chargeMs - 250) await p.screenshot({ path: `${prefix}-sarj-${n}.png` })
  n++
  await p.waitForTimeout(80)
}
await p.keyboard.up('Space')
const track = []
for (let i = 0; i < 14; i++) {
  await cam()
  track.push(await p.evaluate(() => { const b = window.__shot.world.ball; return [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)] }))
  await p.screenshot({ path: `${prefix}-ucus-${String(i).padStart(2, '0')}.png` })
  await p.waitForTimeout(100)
}
console.log('top izi (x,y,z):', JSON.stringify(track))
console.log(logs.join('\n') || 'console: temiz')
await b.close()
