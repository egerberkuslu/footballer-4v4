// F: gercek GPU ile his kare dizisi (100 ms arayla): surme, donus, jockey, ayakta ve kayarak mudahale.
// Kullanim: scripts/run-browser.sh node scripts/ctl-feel-shots.mjs [cikti_oneki=shots/feel]
import { chromium } from 'playwright'
const prefix = process.argv[2] ?? 'shots/feel'
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 960, height: 600 } })
const logs = []
p.on('pageerror', (e) => logs.push('pageerror ' + e.message))
await p.goto('http://127.0.0.1:5173/?mode=mac&blades=20000&boot=0')
await p.waitForTimeout(9000)

// sahne: kontrol edilen #3 (0,0) topla, rakip #5 karsida; oyun 'play'; serbest kamera oyuncunun yaninda
const setup = (scn) =>
  p.evaluate((scn) => {
    const g = window.__game
    const w = window.__shot.world
    const ctl = window.__shot.ctl
    ctl.cam = 'serbest'
    g.match.phase = 'play'
    g.match.restart = null
    for (const q of g.players) Object.assign(q, { x: -14 + q.id * 1.5, z: 11, vx: 0, vz: 0, hasBall: false, actionLock: 0 })
    const A = g.players[3]
    const D = g.players[5]
    for (const q of g.players) q.controlled = q.id === (scn === 'def' ? 1 : 3)
    if (scn === 'def') {
      // savunma: rakip #5 (deplasman, -x'e hucum) topla bize gelir, biz #1 onunde
      Object.assign(D, { x: -2, z: 0, facing: -Math.PI / 2 })
      Object.assign(g.players[1], { x: -6.5, z: 0, facing: Math.PI / 2 })
      w.placeBall(-2.45, 0)
    } else {
      Object.assign(A, { x: 0, z: 0, facing: Math.PI / 2 })
      Object.assign(D, { x: 9, z: 4 })
      w.placeBall(0.45, 0)
    }
  }, scn)
// kamera: oyuncunun 7 m yaninda, 3.5 m yukarida
const cam = (id) =>
  p.evaluate((id) => {
    const s = window.__r3f.get()
    const pl = window.__game.players[id]
    s.camera.position.set(pl.x - 1.5, 3.4, pl.z + 7)
    s.controls.target.set(pl.x + 0.8, 0.6, pl.z)
    s.camera.lookAt(s.controls.target)
  }, id)
let n = 0
async function frames(k, id, label) {
  for (let i = 0; i < k; i++) {
    await cam(id)
    await p.screenshot({ path: `${prefix}-${String(n).padStart(2, '0')}-${label}.png` })
    n++
    await p.waitForTimeout(100)
  }
}

await setup('att')
await p.keyboard.down('d')
await frames(6, 3, 'surme')
await p.keyboard.down('w') // sola (kameraya gore yukari) 90 derece
await p.keyboard.up('d')
await frames(5, 3, 'donus')
await p.keyboard.up('w')
await frames(3, 3, 'durma')

await setup('def')
await p.waitForTimeout(200)
await p.keyboard.down('e') // basili: jockey
await frames(6, 1, 'jockey')
await p.keyboard.up('e')
await p.keyboard.press('e') // dokunus: ayakta mudahale
await frames(5, 1, 'mudahale')
await setup('def')
await p.waitForTimeout(400)
await p.keyboard.down('Shift')
await p.keyboard.press('e') // kayarak
await p.keyboard.up('Shift')
await frames(8, 1, 'kayma')

const st = await p.evaluate(() => ({ fps: window.__r3f.get().gl.info.render.frame }))
console.log(JSON.stringify(st), n, 'kare')
console.log(logs.join('\n') || 'hata yok')
await b.close()
