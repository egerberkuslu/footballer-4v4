// F: kol ayar ekrani uctan uca (sahte getGamepads, gercek GPU Chrome): menude 'kol bagli', atama sihirbazi, ayar aciksa oyun girdisi yok,
// kapaninca geri gelir. GERCEK KOLLA DOGRULANMADI.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.addInitScript(() => {
  window.__pad = { id: '054c-09cc-Sony Interactive Entertainment Wireless Controller', mapping: '', connected: true, axes: [0, 0, -1, 0, 0, -1], buttons: Array.from({ length: 14 }, () => ({ pressed: false, value: 0 })) }
  navigator.getGamepads = () => [window.__pad]
})
await p.goto('http://127.0.0.1:5173/?mode=mac&blades=8000', { timeout: 120000 })
await p.waitForTimeout(8000)
const out = {}
// menu > Kol Ayarlari
await p.getByText('☰ Menü').click()
await p.getByText('Kol Ayarları').click()
await p.waitForTimeout(800)
out.baglantiGorunur = await p.evaluate(() => /PS4/.test(document.body.textContent))
// atama: Pas satirina tikla, sahte dugme 9 bas
await p.locator('.gps-chip').first().click()
await p.waitForTimeout(500)
out.sihirbazBekliyor = await p.evaluate(() => /Bir tuşa bas/.test(document.body.textContent))
await p.evaluate(() => { window.__pad.buttons[9] = { pressed: true, value: 1 } })
await p.waitForTimeout(400)
await p.evaluate(() => { window.__pad.buttons[9] = { pressed: false, value: 0 } })
await p.waitForTimeout(300)
out.chipSonra = await p.evaluate(() => document.querySelector('.gps-chip')?.textContent)
out.ls = await p.evaluate(() => localStorage.getItem('gamepadSettings'))
out.atamaSonrasi = await p.evaluate(() => JSON.parse(localStorage.getItem('gamepadSettings') || '{}').bindings)
// ayar acikken klavye hareketi oyunu etkilememeli
const pos = () => p.evaluate(() => { const c = window.__game.controlledPlayer(); return [c.x, c.z] })
const d0 = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1])
const a0 = await pos()
await p.keyboard.down('d')
await p.waitForTimeout(400)
out.ayarAcikGirdi = await p.evaluate(() => { const c = window.__game.controlledPlayer(); const i = window.__game.inputs[c.id]; return [i.move.x, i.move.z, i.sprint] })
await p.waitForTimeout(400)
await p.keyboard.up('d')
out.ayarAcikHareket = +d0(a0, await pos()).toFixed(2)
// kapat, oyun girdisi geri gelmeli (kontrol edilen oyuncu serbest ise)
await p.getByText('Bitti').first().click().catch(async () => { await p.keyboard.press('Escape') })
await p.waitForTimeout(500)
out.ayarKapandi = await p.evaluate(() => !document.querySelector('.gps-close'))
// menu kapali ve ekran kapali: klavye hareketi geri gelmeli (menu perdesi acik olabilir, ana menu kapat)
await p.evaluate(() => { const o = document.querySelector('.mp-overlay'); o && o.remove() })
const a1 = await pos()
await p.keyboard.down('d')
await p.waitForTimeout(800)
await p.keyboard.up('d')
out.kapaliHareket = +d0(a1, await pos()).toFixed(2)
console.log(JSON.stringify(out))
console.log(errs.join('\n') || 'pageerror yok')
await b.close()
