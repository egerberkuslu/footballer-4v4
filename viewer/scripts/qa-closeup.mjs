// O2 (QA): yakin planlar. Kamera r3f'de her 16 ms hedef oyuncuya (x+1.2,1.5,z+1.2) -> (x,1.6,z) zorlanir. Kullanim: run-browser.sh node scripts/qa-closeup.mjs <klasor>
import fs from 'node:fs'
import { BASE, launch, waitReady } from './qa-lib.mjs'
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch({ w: 1280, h: 720 })
await p.goto(BASE + '?mode=mac&half=10&watch=1')
await waitReady(p)
await p.waitForTimeout(3000)
const targets = [['kaleci4', 4, 1.6, 1.5, 1.6], ['kaleci0', 0, 1.6, 1.5, 1.6], ['hakem', 'ref', 1.5, 1.5, 1.6], ['oyuncu1-ev', 1, 1.6, 1.5, 1.6], ['oyuncu2-ev', 2, 1.6, 1.5, 1.6], ['oyuncu3-ev', 3, 1.6, 1.5, 1.6], ['oyuncu5-dep', 5, 1.6, 1.5, 1.6], ['oyuncu6-dep', 6, 1.6, 1.5, 1.6], ['oyuncu7-dep', 7, 1.6, 1.5, 1.6], ['oyuncu2-yan', 2, 0, 1.2, 2.4]]
for (const [name, id] of targets) {
  await p.evaluate(([id, name]) => {
    clearInterval(window.__camIv)
    window.__camIv = setInterval(() => {
      const g = window.__game
      const t = id === 'ref' ? g.referee : g.players[id]
      const cam = window.__r3f.camera
      const dx = name.endsWith('yan') ? 2.4 : 0.9, dz = name.endsWith('yan') ? 0.2 : 1.6
      cam.position.set(t.x + dx, 1.45, t.z + dz)
      cam.lookAt(t.x, 1.5, t.z)
      cam.updateMatrixWorld()
    }, 8)
  }, [id, name])
  await p.waitForTimeout(700)
  await p.screenshot({ path: `${out}/${name}.png` })
}
await b.close()
