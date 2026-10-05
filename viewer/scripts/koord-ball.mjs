import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
p.on('pageerror', e => logs.push('pageerror: ' + e.message))
await p.goto('http://127.0.0.1:5173/?blades=20000', { timeout: 180000 })
await p.waitForTimeout(8000)
const r = await p.evaluate(() => {
  const s = window.__r3f
  const w = window.__shot?.world
  let ball = null
  s.scene.traverse(o => { if (o.isMesh && o.geometry?.parameters?.radius > 0.1 && o.geometry.parameters.radius < 0.12) ball = o })
  const wp = ball ? ball.getWorldPosition(new ball.position.constructor()) : null
  return {
    worldBall: w ? { x: +w.ball.x.toFixed(2), y: +w.ball.y.toFixed(2), z: +w.ball.z.toFixed(2), speed: Math.hypot(w.ball.vx, w.ball.vy, w.ball.vz).toFixed(2) } : 'no __shot',
    mesh: ball ? { visible: ball.visible, parentVisible: ball.parent?.visible, pos: [wp.x, wp.y, wp.z].map(v => +v.toFixed(2)), scale: ball.scale.toArray(), matVisible: ball.material.visible, opacity: ball.material.opacity } : 'top mesh bulunamadi',
  }
})
console.log(JSON.stringify(r, null, 1))
console.log(logs.join('\n') || 'pageerror yok')
await b.close()
