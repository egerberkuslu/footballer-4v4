import { chromium } from 'playwright'
const [anim, at, fk, gk] = process.argv.slice(2)
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 400, height: 300 } })
await p.addInitScript((s) => { window.__fallSel = s }, { fall: fk, getup: gk })
await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=pose&anims=${anim}&at=${at}&face=1.5708&cam=front&fx=4`, { timeout: 180000 })
await p.waitForTimeout(5000)
console.log(JSON.stringify(await p.evaluate(() => {
  const s = window.__r3f.scene; const res = []
  s.traverse((o) => {
    if (!o.isSkinnedMesh) return
    const bx = o.skeleton.bones[0].getWorldPosition(new o.position.constructor()).x
    if (Math.abs(bx) > 0.85) return
    const pos = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex, t = new o.position.constructor()
    let min = 1e9, mi = -1
    for (let i = 0; i < pos.count; i++) { o.getVertexPosition(i, t); t.applyMatrix4(o.matrixWorld); if (t.y < min) { min = t.y; mi = i } }
    res.push([o.name, +(min * 100).toFixed(1), o.skeleton.bones[si.getX(mi)].name, o.skeleton.bones[0].parent?.parent?.scale?.x])
  })
  return res
})))
await b.close()
