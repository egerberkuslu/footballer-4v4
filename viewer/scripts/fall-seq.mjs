// Dusme/kalkis kare dizisi + zemin penetrasyonu (derili mesh en alt vertex y, m). Test sayfasi, tek odak karakter.
// Kullanim: scripts/run-browser.sh node scripts/fall-seq.mjs <onek> <fall|getup> <fallKlip> <getupKlip> [at-listesi] [cam] [clips]
import { chromium } from 'playwright'
const [pre = '/tmp/asci/fall/s', anim = 'fall', fk = 'fall_back', gk = 'getup_back', atsS = '0.1,0.3,0.5,0.7,0.9', cam = 'side', clips = '1'] = process.argv.slice(2)
const ats = atsS.split(',')
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const rows = []
for (let i = 0; i < ats.length; i++) {
  const p = await b.newPage({ viewport: { width: 640, height: 420 } })
  await p.addInitScript((s) => { window.__fallSel = s }, { fall: fk, getup: gk })
  await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=pose&anims=${anim}&at=${ats[i]}&face=1.5708&cam=${cam}&dist=5.5&h=1.1&ly=0.45&fx=4&clips=${clips}`, { timeout: 180000 })
  await p.waitForTimeout(5000)
  const m = await p.evaluate(() => {
    const s = window.__r3f.scene
    const v = { x: 0, y: 0, z: 0 }
    let min = 1e9, n = 0
    s.traverse((o) => {
      if (!o.isSkinnedMesh || !o.visible) return
      o.updateMatrixWorld(true)
      // odak karakter: dunya x ~ 0 (test dizisi 1.7 m aralik)
      const bx = o.skeleton.bones[0].getWorldPosition(new o.position.constructor()).x
      if (Math.abs(bx) > 0.85) return
      const pos = o.geometry.attributes.position
      const t = new o.position.constructor()
      for (let i = 0; i < pos.count; i++) {
        o.getVertexPosition(i, t)
        t.applyMatrix4(o.matrixWorld)
        if (t.y < min) min = t.y
        n++
      }
    })
    return { min, n, layers: window.__layers }
  })
  rows.push(`${anim} t=${ats[i]} minY=${(m.min * 100).toFixed(1)} cm (n=${m.n}) fall=${JSON.stringify(m.layers?.fall)}`)
  await p.screenshot({ path: `${pre}_${anim}_${i}.png` })
  await p.close()
}
console.log(rows.join('\n'))
await b.close()
