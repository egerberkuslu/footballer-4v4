// O (QA): gorsel gerceklik denetimi. AI-AI mac, carpisma kutulari kapali; yakin / orta / uzak kareler.
// Kullanim: scripts/run-browser.sh node scripts/qa-visual.mjs <cikti-klasoru> [--wait 25000]
import fs from 'node:fs'
import { BASE, launch, save, snapState, waitReady } from './qa-lib.mjs'
const args = process.argv.slice(2)
const out = args[0]
const WAIT = Number(args[args.indexOf('--wait') + 1] || 25000) || 25000
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch()
await p.addInitScript(() => localStorage.setItem('devFlags', JSON.stringify({ on: false, hitboxes: false, nodes: false, triggers: false, statics: false })))
await p.goto(BASE + '?mode=mac&watch=1&half=3')
await waitReady(p)
await p.waitForTimeout(WAIT)

// kamerayi oyuncuya gore yerlestir (serbest kamera)
const aim = (sel, dist, h, side, th) =>
  p.evaluate(
    ([sel, dist, h, side, th]) => {
      const g = window.__game
      const s = window.__r3f
      window.__loco.ctl.cam = 'serbest'
      let t
      if (sel === 'ref') t = g.referee
      else if (sel === 'ball') t = { x: window.__world.ball.x, z: window.__world.ball.z, facing: 0 }
      else if (sel === 'carrier') t = g.players.find((q) => q.hasBall) || g.players.reduce((a, q) => (Math.hypot(q.x - window.__world.ball.x, q.z - window.__world.ball.z) < Math.hypot(a.x - window.__world.ball.x, a.z - window.__world.ball.z) ? q : a))
      else t = g.players[sel]
      // oyuncunun yanindan (bakis yonune dik) bak
      const f = t.facing ?? 0
      const dx = Math.sin(f + side * Math.PI / 2)
      const dz = Math.cos(f + side * Math.PI / 2)
      s.camera.position.set(t.x + dx * dist, h, t.z + dz * dist)
      if (s.controls) s.controls.target.set(t.x, th, t.z)
      s.camera.lookAt(t.x, th, t.z)
      if (s.controls) s.controls.update()
      return { id: t.id, anim: t.anim, x: +t.x.toFixed(2), z: +t.z.toFixed(2) }
    },
    [sel, dist, h, side, th],
  )
const shots = []
const take = async (name, sel, dist, h, side = 1, th = 1.0, burst = 1) => {
  for (let i = 0; i < burst; i++) {
    const info = await aim(sel, dist, h, side, th)
    await p.waitForTimeout(i ? 110 : 400)
    await aim(sel, dist, h, side, th)
    const f = `${out}/${name}${burst > 1 ? '-' + i : ''}.png`
    await p.screenshot({ path: f })
    const cam = await p.evaluate(() => { const c = window.__r3f.camera; return { cx: +c.position.x.toFixed(1), cy: +c.position.y.toFixed(1), cz: +c.position.z.toFixed(1), mode: window.__loco.ctl.cam } })
    shots.push({ f, ...info, ...cam })
  }
}
await take('yakin-topcu', 'carrier', 2.6, 1.3, 1, 0.9, 3)
await take('yakin-topcu-on', 'carrier', 2.6, 1.2, 0, 1.0)
await take('yakin-kaleci0', 0, 3.0, 1.4, 1, 0.9)
await take('yakin-kaleci4', 4, 3.0, 1.4, -1, 0.9)
await take('yakin-hakem', 'ref', 2.6, 1.4, 1, 1.0)
await take('ayak-topcu', 'carrier', 1.6, 0.35, 1, 0.15, 3)
await take('orta-top', 'ball', 9, 4, 1, 0.5)
// uzak: tribun preset
await p.evaluate(() => [...document.querySelectorAll('.hud button')].find((x) => x.textContent.trim() === 'Tribün')?.click())
await p.waitForTimeout(2500)
await p.screenshot({ path: `${out}/uzak-tribun.png` })
// yayin (takip) kamerasi
await p.evaluate(() => { window.__loco.ctl.cam = 'yayin' })
await p.waitForTimeout(2500)
await p.screenshot({ path: `${out}/uzak-yayin.png` })
save(`${out}/visual.json`, { shots, state: await snapState(p), logs })
console.log(JSON.stringify(shots), 'hata', logs.length)
await b.close()
