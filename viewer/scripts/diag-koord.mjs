import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
p.on('console', m => { if (['error','warning'].includes(m.type())) logs.push(m.type()+': '+m.text().slice(0,200)) })
p.on('pageerror', e => logs.push('pageerror: '+e.message))
await p.addInitScript(() => { document.addEventListener('webglcontextlost', () => console.error('CONTEXT LOST'), true) })
await p.goto('http://127.0.0.1:5173/?blades=20000')
await p.waitForTimeout(20000)
const info = await p.evaluate(() => {
  const s = window.__r3f; if (!s) return 'r3f yok'
  const i = s.gl.info
  let meshes = 0, tris = 0
  s.scene.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; const c = g.index ? g.index.count : (g.attributes.position?.count ?? 0); tris += (o.isInstancedMesh ? o.count : 1) * c / 3 } })
  return { calls: i.render.calls, tris: i.render.triangles, frame: i.render.frame, textures: i.memory.textures, geoms: i.memory.geometries, meshes, sceneTrisM: (tris/1e6).toFixed(2), lost: s.gl.getContext().isContextLost() }
}, null).catch(e => 'eval hata: '+e.message)
console.log(JSON.stringify(info))
console.log(logs.slice(0, 20).join('\n') || 'log temiz')
await b.close()
