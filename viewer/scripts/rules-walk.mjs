// Mac modunda W basiliyken kontrol edilen oyuncu hareket ediyor mu?
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const logs = []
p.on('pageerror', e => logs.push('pageerror: ' + e.message))
p.on('console', m => { if (m.type() === 'error') logs.push('err: ' + m.text().slice(0, 200)) })
await p.goto('http://127.0.0.1:5173/?blades=8000&mode=mac&fx=0', { timeout: 180000 })
await p.waitForTimeout(9000)
const snap = () => p.evaluate(async () => {
  const g = window.__game
  const c = g.players.find(q => q.controlled)
  const i = c ? g.inputs[c.id] : null
  const R = window.__rules, B = window.__world.ball; return { ts: window.__world.timeScale, varS: R.varS?.stage ?? null, frame: window.__r3f.gl.info.render.frame, mode: R.mode, rt: +R.time.toFixed(2), readyT: +R.readyT?.toFixed?.(1), ball: [+B.x.toFixed(2), +B.z.toFixed(2)], spot: R.spot, taker: g.match.restart?.taker, phase: g.match.phase, clock: +g.match.clock.toFixed(1), restart: g.match.restart?.type ?? null, ctrl: c ? { id: c.id, x: +c.x.toFixed(2), z: +c.z.toFixed(2), v: +Math.hypot(c.vx, c.vz).toFixed(2), anim: c.anim, lock: +c.actionLock.toFixed(2), hasBall: c.hasBall } : null, input: i ? { mx: i.move.x, mz: i.move.z } : null, focus: document.hasFocus(), active: document.activeElement?.tagName }
})
console.log('once:', JSON.stringify(await snap()))
await p.mouse.click(640, 400) // odak + ses baglami
await p.keyboard.down('KeyW')
await p.waitForTimeout(2500)
console.log('W basili:', JSON.stringify(await snap()))
await p.keyboard.up('KeyW')
await p.waitForTimeout(6000)
console.log('6 s sonra:', JSON.stringify(await snap()))
await p.keyboard.down('KeyW')
await p.waitForTimeout(2500)
console.log('W tekrar:', JSON.stringify(await snap()))
await p.keyboard.up('KeyW')
console.log(logs.slice(0, 10).join('\n') || 'hata yok')
await b.close()
