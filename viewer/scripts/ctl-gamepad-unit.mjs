// F: gamepad birim testi (sahte navigator.getGamepads): profil algilama, esleme, olu bolge/egri, analog tetik,
// tus atama sihirbazi, titresim. GERCEK KOLLA DOGRULANMADI. npx -y tsx scripts/ctl-gamepad-unit.mjs
import './ai-env.mjs'
const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) }
let pads = []
globalThis.navigator = { getGamepads: () => pads }
const { pollPad, stick, padCache } = await import('../src/control/gamepad.ts')
padCache.on = false
const cfg = await import('../src/control/gamepadConfig.ts')

let fail = 0
const ok = (name, cond, extra = '') => {
  if (!cond) fail++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`)
}
const mkBtns = (n, down = {}) => Array.from({ length: n }, (_, i) => ({ pressed: down[i] !== undefined, value: down[i] ?? 0 }))
const pad = (o) => ({ connected: true, vibrationActuator: undefined, ...o })

// 1) standart eslem (Xbox/Chrome DS4)
pads = [pad({ id: 'Xbox 360 Controller', mapping: 'standard', axes: [0, 0, 0, 0], buttons: mkBtns(17, { 0: 1 }) })]
let f = pollPad()
ok('standart: A/cross -> pass down', f.down.pass && f.held.pass)
pads = [pad({ id: 'Xbox 360 Controller', mapping: 'standard', axes: [0, 0, 0, 0], buttons: mkBtns(17) })]
f = pollPad()
ok('standart: birakinca up', f.up.pass && !f.held.pass)
ok('standart profil, PS degil', cfg.getPadInfo().profile === 'standard' && !cfg.getPadInfo().ps)

// 2) Firefox-Linux DualShock 4 (standart disi)
const ds4 = '054c-09cc-Sony Interactive Entertainment Wireless Controller'
pads = [pad({ id: ds4, mapping: '', axes: [0, 0, -1, 0.6, -0.8, -1], buttons: mkBtns(14, { 0: 1, 3: 1 }) })]
f = pollPad()
ok('ds4-raw profil + PS simgeleri', cfg.getPadInfo().profile === 'ds4-raw' && cfg.getPadInfo().ps && cfg.logicalLabel('cross') === '✕')
ok('ds4-raw: 0 = cross -> pass, 3 = square -> lob', f.held.pass && f.held.lob && !f.held.switch)
ok('ds4-raw: sag cubuk eksen 3,4 (y yukari +)', Math.abs(f.look.x) > 0.3 && f.look.y > 0.3, JSON.stringify(f.look))
pads = [pad({ id: ds4, mapping: '', axes: [0, 0, -1, 0, 0, 1], buttons: mkBtns(14, { 2: 1 }) })]
f = pollPad()
ok('ds4-raw: 2 = triangle -> switch', f.held.switch)
ok('ds4-raw: R2 ekseni 5 (=1) -> sprint analog', f.held.sprint && f.analog.r2 > 0.9)

// 3) olu bolge ve egri
ok('olu bolge: 0.1 -> 0', stick(0.1, 0, 0.18, 'dogrusal')[0] === 0)
const half = stick(0.59, 0, 0.18, 'dogrusal')[0]
ok('olu bolge sonrasi 0.5', Math.abs(half - 0.5) < 0.01, String(half))
ok('ustel egri doguslarda kucuk', stick(0.59, 0, 0.18, 'ustel')[0] < half)
cfg.setSettings({ deadL: 0.3 })
pads = [pad({ id: 'Xbox', mapping: 'standard', axes: [0.25, 0, 0, 0], buttons: mkBtns(17) })]
f = pollPad()
ok('ayar: olu bolge 0.3 ile 0.25 sifir', f.move.x === 0)
cfg.resetSettings()

// 4) analog tetik esigi
pads = [pad({ id: 'Xbox', mapping: 'standard', axes: [0, 0, 0, 0], buttons: mkBtns(17, { 7: 0.2 }).map((b, i) => (i === 7 ? { pressed: false, value: 0.2 } : b)) })]
f = pollPad()
ok('R2 0.2 < esik: sprint yok', !f.held.sprint)
pads = [pad({ id: 'Xbox', mapping: 'standard', axes: [0, 0, 0, 0], buttons: mkBtns(17).map((b, i) => (i === 7 ? { pressed: true, value: 0.7 } : b)) })]
f = pollPad()
ok('R2 0.7: sprint', f.held.sprint && Math.abs(f.analog.r2 - 0.7) < 1e-6)

// 5) taninmayan kol + tus atama sihirbazi
const odd = 'Generic USB Joystick (Vendor: 1234 Product: abcd)'
pads = [pad({ id: odd, mapping: '', axes: [0, 0], buttons: mkBtns(8) })]
pollPad()
ok('taninmayan kol: needsLearn', cfg.getPadInfo().needsLearn && cfg.getPadInfo().profile === 'generic')
let learned = null
cfg.startLearn('pass', (r) => (learned = r))
pollPad() // silahlanma
pads = [pad({ id: odd, mapping: '', axes: [0, 0], buttons: mkBtns(8, { 5: 1 }) })]
pollPad()
ok('ogrenme: dugme 5 yakalandi', learned && learned.binding.t === 'b' && learned.binding.i === 5 && learned.conflicts.length === 0)
f = pollPad()
ok('atanan dugme pas oldu', f.held.pass)
// cakisma uyarisi
let l2 = null
cfg.startLearn('lob', (r) => (l2 = r))
pads = [pad({ id: odd, mapping: '', axes: [0, 0], buttons: mkBtns(8) })]
pollPad()
pads = [pad({ id: odd, mapping: '', axes: [0, 0], buttons: mkBtns(8, { 5: 1 }) })]
pollPad()
ok('cakisma uyarisi (pass ile ayni dugme)', l2 && l2.conflicts.includes('pass'))
cfg.resetSettings()
ok('varsayilana don: atama temiz', Object.keys(cfg.getSettings().bindings).length === 0)

// 5b) DS4 ham: tetik eksenleri dinlenmede -1; sihirbaz silahlanmali ve eksen girisini yakalamali
let l3 = null
cfg.startLearn('hints', (r) => (l3 = r))
pads = [pad({ id: ds4, mapping: '', axes: [0, 0, -1, 0, 0, -1], buttons: mkBtns(14) })]
pollPad()
pollPad()
ok('dinlenmede -1 eksen sihirbazi kilitlemiyor (hala bekliyor)', l3 === null)
pads = [pad({ id: ds4, mapping: '', axes: [0, 0, -1, 0, 0, 1], buttons: mkBtns(14) })]
pollPad()
ok('eksen 5 (R2 cekildi) yakalandi', l3 && l3.binding.t === 'a' && l3.binding.i === 5 && l3.binding.dir === 1, JSON.stringify(l3))
cfg.resetSettings()

// 6) titresim
let called = []
pads = [pad({ id: 'Xbox', mapping: 'standard', axes: [0, 0, 0, 0], buttons: mkBtns(17), vibrationActuator: { playEffect: async (t, p) => (called.push([t, p]), 'complete') } })]
pollPad()
cfg.rumble('gol')
ok('titresim: dual-rumble cagrildi', called.length === 1 && called[0][0] === 'dual-rumble' && called[0][1].duration > 0, JSON.stringify(called[0]))
cfg.setSettings({ rumble: false })
cfg.rumble('gol')
ok('titresim kapaliyken cagri yok', called.length === 1)
cfg.resetSettings()
// 7) kalici ayar
cfg.setSettings({ camSpeed: 1.5 })
ok('ayar localStorage ya yazildi', JSON.parse(store.get('gamepadSettings')).camSpeed === 1.5)
cfg.resetSettings()
console.log(fail ? `${fail} BASARISIZ` : 'hepsi OK (gercek kolla dogrulanmadi)')
process.exit(fail ? 1 : 0)
