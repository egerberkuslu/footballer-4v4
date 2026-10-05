// F: kol ile menu gezinme (sahte standart kol, gercek GPU Chrome): Options menuyu acar, D-pad odagi tasir, X tiklar, O geri; menu yokken pasif.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.addInitScript(() => {
  window.__pad = { id: 'Xbox 360 Controller', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }
  navigator.getGamepads = () => [window.__pad]
  localStorage.setItem('gamepadDirNotice', '1')
})
await p.goto('http://127.0.0.1:5173/?mode=mac&blades=8000', { timeout: 120000 })
await p.waitForTimeout(8000)
const tap = async (i, ms = 150) => {
  await p.evaluate(([i, d]) => new Promise((r) => { window.__pad.buttons[i] = { pressed: true, value: 1 }; setTimeout(() => { window.__pad.buttons[i] = { pressed: false, value: 0 }; r() }, d) }), [i, ms])
  await p.waitForTimeout(250)
}
const info = () => p.evaluate(() => ({ overlay: !!document.querySelector('.mp-overlay'), focus: document.querySelector('[data-pad-focus]')?.textContent?.trim().slice(0, 30) ?? null }))
const out = {}
out.menuYok = await info()
await tap(9) // Options
out.menuAcik = await info()
out.dom = await p.evaluate(() => ({ mm: !!document.querySelector('.mm-root'), mp: !!document.querySelector('.mp-overlay'), layers: [...document.querySelectorAll('[data-pad-layer]')].map((e) => e.className + '|' + (e.closest('.mm-root') ? 'in-mm' : '')), focusEl: document.querySelector('[data-pad-focus]')?.className, active: document.activeElement?.className }))
await tap(13) // d-pad asagi
out.asagi1 = await info()
await tap(13)
out.asagi2 = await info()
await tap(12) // yukari
out.yukari = await info()
await p.screenshot({ path: 'shots/f2-padnav-menu.png' })
await tap(1) // O geri
out.geri = await info()
// oyun girdisi: menu kapali, X pas
await tap(9)
await tap(9)
out.optionsIkiKez = await info()
console.log(JSON.stringify(out))
console.log(errs.join('\n') || 'pageerror yok')
await b.close()
