// O (QA): senaryolu akis testi (gercek GPU). Topu/son dokunusu/konumlari ayarlar, sonra GERCEK kural+AI+girdi akisini gozler.
// Kullanim: scripts/run-browser.sh node scripts/qa-scenarios.mjs <cikti-klasoru> [senaryo,...]
// Senaryolar: tac korner kaleci3 aikaleci ofsayt penalti var cizgi
import fs from 'node:fs'
import { BASE, installRecorder, launch, save, snapState, waitReady } from './qa-lib.mjs'

const args = process.argv.slice(2)
const out = args[0]
const only = (args[1] || 'tac,korner,kaleci3,aikaleci,ofsayt,penalti,var,kayma,cizgi').split(',')
fs.mkdirSync(out, { recursive: true })
const { b, p, logs } = await launch()
await p.addInitScript(() => localStorage.setItem('devFlags', JSON.stringify({ on: true, hitboxes: false, nodes: false, triggers: false, statics: false })))
await p.goto(BASE + '?mode=mac&dev=1&half=10')
await waitReady(p)
await installRecorder(p)
const results = []

const ev = () => p.evaluate(() => window.__qa.ev.length)
const evSince = (n) => p.evaluate((n) => window.__qa.ev.slice(n), n)
const phase = () => p.evaluate(() => window.__game.match.phase)
async function until(fn, ms, step = 100) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) return null
    await p.waitForTimeout(step)
  }
}
// oyun 'play' olana dek; insan duran topu ise K ile kullan
async function toPlay(ms = 25000) {
  return until(async () => {
    const s = await p.evaluate(() => ({ ph: window.__game.match.phase, r: window.__game.match.restart, c: window.__game.controlledPlayer()?.id, var: window.__game.match.phase === 'var' }))
    if (s.ph === 'play') return true
    if (s.r && s.r.taker === s.c && ['kickoff', 'freekick', 'corner', 'kickin', 'goalkick'].includes(s.ph)) {
      await p.keyboard.press('k')
      await p.waitForTimeout(400)
    }
    return false
  }, ms, 250)
}
let nshot = 0
const shot = async (tag) => {
  const f = `${out}/${String(nshot++).padStart(2, '0')}-${tag}.png`
  await p.screenshot({ path: f })
  save(f.replace('.png', '.json'), await snapState(p))
  return f
}
function rec(name, pass, detail, shots) {
  results.push({ name, pass, detail, shots })
  console.log(pass === true ? 'GECTI' : pass === false ? 'KALDI' : 'DOGRULANAMADI', name, JSON.stringify(detail).slice(0, 400))
}

// yardimci: son dokunusu ayarla + topu yerlestir + vur
const setBall = (o) =>
  p.evaluate((o) => {
    const g = window.__game
    const w = window.__world
    for (const q of g.players) q.hasBall = false
    if (o.touch !== undefined) {
      const q = g.players[o.touch]
      g.match.lastTouch = { player: q.id, team: q.team, t: window.__rules.time }
    }
    w.placeBall(o.x, o.z)
    if (o.v) w.kick(o.v, { x: 0, y: 0, z: 0 })
  }, o)

await p.waitForTimeout(1500)
await toPlay()

if (only.includes('tac')) {
  // ev oyuncusu son dokundu, top yan cizgiden cikiyor -> deplasmana ayakla tac; VAR BASLAMAMALI
  await toPlay()
  const n0 = await ev()
  await setBall({ touch: 2, x: 4, z: 11.8, v: { x: 0, y: 0, z: 9 } })
  const got = await until(() => p.evaluate(() => (window.__game.match.phase === 'kickin' ? window.__game.match.restart : null)), 6000, 30)
  const s1 = got ? await shot('tac') : await shot('tac-yok')
  const r = got
  await p.waitForTimeout(2500)
  const e = await evSince(n0)
  const varStart = e.some((x) => x.type === 'var-start')
  const ok = !!got && r?.team === 1 && !varStart
  const resumed = await toPlay(20000)
  const s2 = await shot('tac-sonra')
  rec('taç (ayakla) + VAR yok', ok && !!resumed, { restart: r, varStart, resumed: !!resumed, events: e.filter((x) => !['touch', 'offside-check'].includes(x.type)).map((x) => x.type + (x.reason ? ':' + x.reason : '')) }, [s1, s2])
}

if (only.includes('korner')) {
  await toPlay()
  const n0 = await ev()
  const s = await p.evaluate(() => window.__game.match.attackDir[1]) // deplasmanin hucum ettigi kale = evin kalesi
  // ev defansi (1) son dokundu, top kendi kale cizgisinden kale disindan cikiyor -> deplasmana korner
  await setBall({ touch: 1, x: s * 18.8, z: 7, v: { x: s * 10, y: 0, z: 0 } })
  const got = await until(async () => (await phase()) === 'corner', 6000)
  const s1 = await shot(got ? 'korner' : 'korner-yok')
  const r = await p.evaluate(() => window.__game.match.restart)
  const st = await snapState(p)
  const taker = r ? st.players[r.taker] : null
  await p.waitForTimeout(2000)
  const s2 = await shot('korner-hazir')
  const resumed = await toPlay(20000)
  const e = await evSince(n0)
  rec('korner', !!got && r?.team === 1 && !!resumed && !e.some((x) => x.type === 'var-start'), { restart: r, taker, resumed: !!resumed, events: e.filter((x) => !['touch', 'offside-check'].includes(x.type)).map((x) => x.type + (x.reason ? ':' + x.reason : '')) }, [s1, s2])
}

if (only.includes('kaleci3') || only.includes('aikaleci')) {
  for (const human of [true, false]) {
    if (human ? !only.includes('kaleci3') : !only.includes('aikaleci')) continue
    await toPlay()
    const n0 = await ev()
    const kid = human ? 0 : 4
    const k = await p.evaluate((kid) => { const q = window.__game.players[kid]; return { x: q.x, z: q.z } }, kid)
    const dir = k.x > 0 ? 1 : -1
    // diger oyunculari uzaga al (AI araya girip topu kesmesin)
    await p.evaluate((kid) => { const g = window.__game; const kx = g.players[kid].x; for (const q of g.players) if (q.id !== kid && q.role !== 'kaleci') Object.assign(q, { x: -Math.sign(kx) * 6, z: (q.id % 4) * 4 - 6, vx: 0, vz: 0, hasBall: false, actionLock: 0 }) }, kid)
    // yavas top kalecinin onune
    await setBall({ touch: human ? 6 : 2, x: k.x - dir * 3, z: k.z, v: { x: dir * 4.5, y: 1.2, z: 0 } })
    const held = await until(() => p.evaluate((kid) => window.__game.players[kid].hasBall && window.__world.ball.y > 0.3, kid), 4000, 50)
    const tHeld = Date.now()
    if (held) await shot(human ? 'kaleci-insan-tuttu' : 'kaleci-ai-tuttu')
    // insan: hicbir sey yapma; 3 s kurali bekleniyor
    const res = await until(async () => {
      const e = await evSince(n0)
      const w = e.find((x) => x.type === 'whistle')
      const rel = await p.evaluate((kid) => !window.__game.players[kid].hasBall, kid)
      return w ? { whistle: w.reason, after: (Date.now() - tHeld) / 1000 } : rel && Date.now() - tHeld > 300 ? { released: (Date.now() - tHeld) / 1000 } : null
    }, 7000, 100)
    const s1 = await shot(human ? 'kaleci-insan-sonuc' : 'kaleci-ai-sonuc')
    const banner = await p.evaluate(() => window.__rules?.banner?.text)
    if (human) rec('kaleci 3 s kuralı (insan kaleci bekliyor)', !!held && res?.whistle === 'keeper-hold', { held: !!held, res, banner }, [s1])
    else rec('AI kaleci 3 s içinde bırakıyor', !!held && !!res?.released && res.released < 3.2, { held: !!held, res, banner }, [s1])
  }
}

if (only.includes('ofsayt')) {
  await toPlay()
  const n0 = await ev()
  // ev forveti (3) son savunmacinin 4 m onunde, pasor orta (2) top ayaginda; insan K ile pas verir
  const setup = await p.evaluate(() => {
    const g = window.__game
    const d = g.match.attackDir[0]
    const pos = { 2: [d * 2, 0], 3: [d * 14, 3], 5: [d * 9, -2], 6: [d * 8, 4], 7: [d * 8, -7], 4: [d * 18.3, 0], 1: [-d * 8, 0] }
    for (const [id, [x, z]] of Object.entries(pos)) Object.assign(g.players[id], { x, z, vx: 0, vz: 0, hasBall: false, actionLock: 0 })
    window.__loco.setControlled(2)
    // rakipleri 4 s boyunca yerinde tut (AI araya girmesin)
    const hold = [5, 6, 7].map((id) => [id, g.players[id].x, g.players[id].z])
    const iv = setInterval(() => { for (const [id, x, z] of hold) Object.assign(g.players[id], { x, z, vx: 0, vz: 0 }) }, 30)
    setTimeout(() => clearInterval(iv), 4000)
    window.__world.placeBall(d * 2 + d * 0.5, 0)
    return d
  })
  await p.waitForTimeout(350)
  const sc = await p.evaluate(() => {
    const cam = window.__r3f.camera
    const q = window.__game.players[3]
    const v = new cam.position.constructor(q.x, 0, q.z).project(cam)
    return { sx: (v.x + 1) / 2 * innerWidth, sy: (1 - v.y) / 2 * innerHeight, has: window.__game.players[2].hasBall }
  })
  await p.mouse.move(sc.sx, sc.sy)
  await p.keyboard.press('k')
  const got = await until(async () => (await evSince(n0)).find((x) => x.type === 'offside'), 5000)
  const s1 = await shot(got ? 'ofsayt' : 'ofsayt-yok')
  await until(() => p.evaluate(() => !!window.__game.match.restart), 5000, 100)
  const r = await p.evaluate(() => window.__game.match.restart)
  const e = await evSince(n0)
  const chk = e.filter((x) => x.type === 'offside-check')
  rec('ofsayt (net, ~5 m)', !!got && r?.team === 1 && r?.indirect === true && !e.some((x) => x.type === 'var-start'), { hadBall: sc.has, checks: chk.map((c) => [c.passer, c.receiver, +c.margin.toFixed(2)]), restart: r, events: e.filter((x) => !['touch', 'offside-check'].includes(x.type)).map((x) => x.type + (x.reason ? ':' + x.reason : '')) }, [s1])
  await toPlay(20000)
}

if (only.includes('penalti')) {
  await toPlay()
  const n0 = await ev()
  // ceza sahasinda arkadan sert mudahale olayi (temas olayi yayilir; hakem karari gercek)
  const d = await p.evaluate(() => {
    const g = window.__game
    const d = g.match.attackDir[0]
    Object.assign(g.players[3], { x: d * 16, z: 1 })
    Object.assign(g.players[5], { x: d * 16.6, z: 1.2 })
    window.__world.placeBall(d * 15.6, 1)
    g.emit({ type: 'contact', a: 5, b: 3, ballFirst: false, fromBehind: true, intensity: 0.7, kind: 'tackle', x: d * 16, z: 1 })
    return d
  })
  const got = await until(async () => (await phase()) === 'penalty', 6000)
  await p.waitForTimeout(2500)
  const s1 = await shot(got ? 'penalti' : 'penalti-yok')
  const r = await p.evaluate(() => window.__game.match.restart)
  const st = await snapState(p)
  // insan kullanir: kaleye nisan, Bosluk 0,5 s
  const g = await p.evaluate((d) => { const cam = window.__r3f.camera; const v = new cam.position.constructor(d * 20, 0.8, 1.6).project(cam); return { sx: (v.x + 1) / 2 * innerWidth, sy: (1 - v.y) / 2 * innerHeight, ctl: window.__game.controlledPlayer()?.id } }, d)
  await p.mouse.move(g.sx, g.sy)
  await p.keyboard.down(' ')
  await p.waitForTimeout(550)
  await p.keyboard.up(' ')
  const after = await until(async () => (await evSince(n0)).find((x) => x.type === 'goal' || (x.type === 'out') || (x.type === 'touch' && x.kind === 'save')), 6000)
  const s2 = await shot('penalti-sonuc')
  const e = await evSince(n0)
  rec('penaltı (ceza sahasında faul → penaltı, insan kullanır)', !!got && r?.type === 'penalty' && r?.team === 0, { restart: r, taker: r && st.players[r.taker], controlled: g.ctl, outcome: after, events: e.filter((x) => !['touch', 'offside-check'].includes(x.type)).map((x) => x.type + (x.reason ? ':' + x.reason : '')) }, [s1, s2])
  await toPlay(25000)
}

if (only.includes('var')) {
  // gol sonrasi elle VAR (X): hakem dinler -> monitore kosar -> tekrar/karar -> oyun devam
  await toPlay()
  const n0 = await ev()
  const s = await p.evaluate(() => window.__game.match.attackDir[0])
  await setBall({ touch: 3, x: s * 19.2, z: 1.2, v: { x: s * 7, y: 0.3, z: 0 } })
  const goal = await until(async () => (await evSince(n0)).find((x) => x.type === 'goal'), 5000)
  await p.waitForTimeout(1200)
  await p.keyboard.press('x')
  const stages = []
  const shots = []
  const t0 = Date.now()
  let last = ''
  let started = false
  while (Date.now() - t0 < 45000) {
    const st = await p.evaluate(() => ({ ph: window.__game.match.phase, ref: window.__game.referee.anim, rx: +window.__game.referee.x.toFixed(1), rz: +window.__game.referee.z.toFixed(1), vph: document.querySelector('.var-overlay, [class*="var-"]')?.className || '', toast: document.body.innerText.match(/İncelenecek[^\n]*/)?.[0] || '' }))
    if (st.ph === 'var') started = true
    const k = st.ph + '/' + st.ref
    if (k !== last) {
      stages.push({ t: (Date.now() - t0) / 1000, ...st })
      last = k
      if (shots.length < 7) shots.push(await shot('var-' + st.ph + '-' + st.ref))
    }
    if ((started && st.ph !== 'var') || (!started && Date.now() - t0 > 6000)) break
    await p.waitForTimeout(150)
  }
  const e = await evSince(n0)
  const vs = e.filter((x) => x.type.startsWith('var'))
  const refs = stages.map((x) => x.ref)
  rec('gol sonrası elle VAR akışı (X)', !!goal && vs.some((x) => x.type === 'var-start') && vs.some((x) => x.type === 'var-decision') && refs.includes('var-monitor'), { goal: !!goal, stages, vs, score: (await snapState(p)).match.score }, shots)
  await toPlay(20000)
}

if (only.includes('kayma')) {
  // C1 regresyon: onden, once topa kayarak mudahale (siddet 1) -> kirmizi OLMAMALI
  await toPlay()
  const n0 = await ev()
  await p.evaluate(() => {
    const g = window.__game
    const a = g.players[7], v = g.players[2]
    window.__world.placeBall(v.x + 0.5, v.z)
    g.emit({ type: 'contact', a: 7, b: 2, ballFirst: true, fromBehind: false, intensity: 1, kind: 'slide', x: v.x, z: v.z })
  })
  await p.waitForTimeout(2500)
  const e = await evSince(n0)
  const card = e.find((x) => x.type === 'card')
  const s1 = await shot('kayma')
  rec('önden, önce topa kayma (şiddet 1) → kırmızı yok', !card || card.color !== 'red', { events: e.filter((x) => !['touch', 'offside-check'].includes(x.type)).map((x) => x.type + (x.color ? ':' + x.color : '')) }, [s1])
  await toPlay(20000)
}

if (only.includes('cizgi')) {
  // kale cizgisini 30 cm farkla, kale disindan gecen net aut: VAR BASLAMAMALI
  await toPlay()
  const n0 = await ev()
  const s = await p.evaluate(() => window.__game.match.attackDir[0])
  await setBall({ touch: 3, x: s * 19, z: 4.5, v: { x: s * 9, y: 0, z: 0 } })
  await until(async () => ['goalkick', 'corner'].includes(await phase()), 6000)
  await p.waitForTimeout(3000)
  const e = await evSince(n0)
  const s1 = await shot('net-aut')
  rec('net aut → kale vuruşu, VAR yok', !e.some((x) => x.type === 'var-start') && e.some((x) => x.type === 'out'), { events: e.filter((x) => !['touch', 'offside-check'].includes(x.type)).map((x) => x.type + (x.reason ? ':' + x.reason : '')) }, [s1])
}

save(`${out}/senaryolar.json`, { results, logs, long: await p.evaluate(() => window.__qa.long) })
console.log('OZET', results.map((r) => `${r.pass === true ? '✓' : r.pass === false ? '✗' : '?'} ${r.name}`).join(' | '), 'hata', logs.length)
await b.close()
