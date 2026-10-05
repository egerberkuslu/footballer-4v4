// M2: Kol Ayarlari ekrani akisi (sahte navigator.getGamepads). Gercek DS4 YOK: yalniz on yuz akisi dogrulanir.
// Kullanim: scripts/run-browser.sh node scripts/ui-gamepad.mjs <onek> [--ff]
import { chromium, firefox } from 'playwright'
const args = process.argv.slice(2)
const pre = args[0]
const b = args.includes('--ff')
  ? await firefox.launch()
  : args.includes('--gpu')
  ? await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
  : await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 860 } })
const logs = []
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message))
p.on('console', (m) => m.type() === 'error' && !/vite|WebGL/.test(m.text()) && logs.push('[err] ' + m.text().slice(0, 160)))
await p.addInitScript(() => {
  window.__pad = { connected: false, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }
  navigator.getGamepads = () => (window.__pad.connected ? [{ id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', index: 0, connected: true, mapping: 'standard', buttons: window.__pad.buttons, axes: window.__pad.axes, vibrationActuator: { playEffect: () => { window.__rumble = (window.__rumble || 0) + 1; return Promise.resolve() } } }] : [null, null, null, null])
})
await p.goto('http://127.0.0.1:5173/?boot=0', { timeout: 120000 })
await p.waitForTimeout(3000)
const open = async () => { p.setDefaultTimeout(40000); await p.evaluate(() => import('/src/ui/gamepadUi.ts').then((m) => m.openGamepadSettings())); await p.waitForSelector('.gps-card', { state: 'attached', timeout: 120000 }) }
try { await open() } catch (e) { console.log(logs.join('\n')); console.log(await p.evaluate(() => document.body.innerText.slice(0,200))); process.exit(1) }
await p.waitForTimeout(500)
await p.screenshot({ path: `${pre}-yok.png` })
console.log('baglanti yok:', await p.textContent('.gps-pad'))
// kol tak
await p.evaluate(() => (window.__pad.connected = true))
await p.waitForTimeout(800)
await p.screenshot({ path: `${pre}-bagli.png` })
console.log('bagli:', await p.textContent('.gps-pad'))
// kaydirici + egri + test
await p.locator('.gps-row input[type=range]').first().fill('0.3')
await p.click('.gps-seg button:nth-child(2)')
await p.click('.gps-test')
await p.waitForTimeout(200)
console.log('titresim cagrisi', await p.evaluate(() => window.__rumble ?? 0))
console.log('kayitli', await p.evaluate(() => localStorage.getItem('gamepadSettings')))
// tus ata: 'Pas' satiri, sahte dugme 5 (R1)
await p.locator('.gps-bind .gps-chip').first().click()
await p.waitForTimeout(400)
await p.screenshot({ path: `${pre}-ogren.png` })
await p.evaluate(() => (window.__pad.buttons[5] = { pressed: true, value: 1 }))
await p.waitForTimeout(500)
await p.evaluate(() => (window.__pad.buttons[5] = { pressed: false, value: 0 }))
console.log('pas atamasi:', await p.locator('.gps-bind .gps-chip').first().textContent())
// ayni dugmeyi 'Sut'a ata: cakisma uyarisi
await p.locator('.gps-bind .gps-chip').nth(1).click()
await p.waitForTimeout(500)
await p.evaluate(() => (window.__pad.buttons[5] = { pressed: true, value: 1 }))
await p.waitForTimeout(500)
await p.evaluate(() => (window.__pad.buttons[5] = { pressed: false, value: 0 }))
await p.waitForTimeout(300)
console.log('cakisma:', await p.locator('.gps-warn').textContent().catch(() => 'uyari yok'))
await p.screenshot({ path: `${pre}-cakisma.png` })
// klavye oyuna gitmesin: W bas, Esc kapat
await p.keyboard.press('Escape')
await p.waitForTimeout(300)
console.log('Esc sonrasi ekran:', await p.locator('.gps-card').count())
try { await open() } catch (e) { console.log(logs.join('\n')); console.log(await p.evaluate(() => document.body.innerText.slice(0,200))); process.exit(1) }
await p.click('.gps-reset')
console.log('sifirlandi:', await p.evaluate(() => localStorage.getItem('gamepadSettings')))
await p.screenshot({ path: `${pre}-sifir.png` })
console.log(logs.join('\n') || 'console: temiz')
await b.close()
