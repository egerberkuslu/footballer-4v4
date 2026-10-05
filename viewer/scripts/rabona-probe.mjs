// rabona ajani: test sayfasinda katman sayaci + ayak konumlari (karakter uzayi yaklasik: dunya, face=0 => +z ileri, +x sol)
import { chromium } from 'playwright'
const ats = (process.argv[2] || '0.12,0.18,0.21,0.24,0.27,0.33').split(',')
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (const at of ats) {
  const p = await b.newPage({ viewport: { width: 300, height: 300 } })
  await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=pose&anims=rabona&at=${at}&face=0&cam=back&dist=3.6&fx=4`, { timeout: 180000 })
  await p.waitForTimeout(3500)
  const r = await p.evaluate(() => {
    const sc = window.__r3f.scene
    const out = {}
    const v = new (sc.position.constructor)()
    sc.traverse((o) => {
      if (o.isBone && /^(foot_l|foot_r|calf_l|thigh_l)$/.test(o.name)) {
        o.getWorldPosition(v)
        ;(out[o.name] ??= []).push([+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)])
      }
    })
    return { layers: window.__layers, bones: out }
  })
  // karakter 4 (fx=4 -> x=0) secilir
  const pick = (a) => a?.find((q) => Math.abs(q[0]) < 0.6)
  console.log(at, JSON.stringify(r.layers.rabona), 'L', pick(r.bones.foot_l), 'R', pick(r.bones.foot_r), 'calfL', pick(r.bones.calf_l))
  await p.close()
}
await b.close()
