import { firefox } from 'playwright'
const b = await firefox.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
p.on('console', m => logs.push(m.type() + ': ' + m.text().slice(0, 300)))
p.on('pageerror', e => logs.push('pageerror: ' + e.message))
await p.addInitScript(() => { document.addEventListener('webglcontextlost', () => console.error('CONTEXT LOST'), true) })
await p.goto('http://127.0.0.1:5173/src/ui/test/index.html')
await p.waitForTimeout(12000)
const info = await p.evaluate(() => { const s = window.__r3f; if (!s) return 'r3f yok'; const i = s.gl.info; return { frame: i.render.frame, lost: s.gl.getContext().isContextLost(), gl2: !!s.gl.getContext().texStorage2D } }).catch(e => 'eval hata: ' + e.message)
console.log(JSON.stringify(info))
await p.screenshot({ path: 'shots/I2-ms-ff.png', timeout: 90000 }).catch(e => console.log('shot hata', e.message))
console.log(logs.slice(0, 30).join('\n'))
await b.close()
