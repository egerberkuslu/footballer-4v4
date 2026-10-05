// O (QA): gercek GPU'da mac oyun testi ya da AI-AI izleme.
// Kullanim: scripts/run-browser.sh node scripts/qa-match.mjs <cikti-klasoru> [--sec 180] [--watch] [--half 2] [--shots 30] [--q "ek=param"]
import fs from 'node:fs'
import { BASE, HumanBot, devPanel, frameStats, installRecorder, launch, save, snapState, waitReady } from './qa-lib.mjs'

const args = process.argv.slice(2)
const out = args[0]
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const SEC = Number(opt('--sec', '180'))
const WATCH = args.includes('--watch')
const HALF = opt('--half', '2')
const MAXSHOTS = Number(opt('--shots', '30'))
const extra = opt('--q', '')
fs.mkdirSync(out, { recursive: true })

const { b, p, logs } = await launch()
const url = `${BASE}?mode=mac&dev=1&half=${HALF}${WATCH ? '&watch=1' : ''}${extra ? '&' + extra : ''}`
console.log(url)
const T0 = Date.now()
await p.goto(url)
const readyMs = await waitReady(p)
console.log('hazir', readyMs, 'ms')
await installRecorder(p)
let nShot = 0
const shot = async (tag) => {
  if (nShot >= MAXSHOTS) return
  const n = String(nShot++).padStart(2, '0')
  const f = `${out}/${n}-${tag}.png`
  await p.screenshot({ path: f }).catch((e) => console.log('shot hata', e.message))
  save(`${out}/${n}-${tag}.json`, await snapState(p))
}
await shot('baslangic')

const bot = WATCH ? null : new HumanBot(p)
const windows = []
let seen = 0
let lastWin = Date.now()
const track = new Map() // izleme: takili oyuncu tespiti
const stuck = []
let ballIdle = 0
const ballIdleEv = []
let lastSample = 0
const interesting = new Set(['goal', 'card', 'foul', 'var-start', 'var-decision', 'offside', 'out', 'phase'])

while (Date.now() - T0 - readyMs < SEC * 1000) {
  const tNow = Date.now()
  if (bot) await bot.tick(tNow).catch((e) => console.log('bot', e.message.split('\n')[0]))
  // yeni olaylar -> goruntu
  const ev = await p.evaluate((s) => window.__qa.ev.slice(s), seen)
  seen += ev.length
  for (const e of ev) {
    if (!interesting.has(e.type)) continue
    const tag = e.type === 'phase' ? 'faz-' + e.phase : e.type === 'out' ? 'out-' + e.line : e.type === 'var-decision' ? 'var-' + e.verdict : e.type
    if (e.type === 'phase' && ['play'].includes(e.phase)) continue
    console.log(`[${e.t}s saat ${e.clock}] ${JSON.stringify(e)}`)
    await shot(tag)
  }
  // izleme: her 1 s konum ornegi
  if (tNow - lastSample > 1000) {
    lastSample = tNow
    const s = await snapState(p)
    if (s.match.phase === 'play') {
      for (const q of s.players) {
        const k = track.get(q.id) || { x: q.x, z: q.z, n: 0 }
        if (Math.hypot(q.x - k.x, q.z - k.z) < 0.05) k.n++
        else Object.assign(k, { x: q.x, z: q.z, n: 0 })
        if (k.n === 10 && q.role !== 'kaleci' && !q.off) stuck.push({ t: (tNow - T0) / 1000, id: q.id, x: q.x, z: q.z, anim: q.anim })
        track.set(q.id, k)
      }
      const near = Math.min(...s.players.map((q) => Math.hypot(q.x - s.ball.x, q.z - s.ball.z)))
      if (s.ball.v < 0.2 && near > 2.5) {
        ballIdle++
        if (ballIdle === 8) ballIdleEv.push({ t: (tNow - T0) / 1000, ball: s.ball, near: +near.toFixed(1) })
      } else ballIdle = 0
    } else track.clear()
  }
  if (tNow - lastWin > 10000) {
    lastWin = tNow
    const fs1 = await frameStats(p, 500)
    const ph = await p.evaluate(() => window.__game.match.phase)
    windows.push({ t: ((tNow - T0) / 1000).toFixed(0), phase: ph, ...fs1 })
    console.log('kare', JSON.stringify(windows.at(-1)))
  }
  await p.waitForTimeout(bot ? 60 : 250)
}
if (bot) await bot.releaseAll()
await shot('son')
const qa = await p.evaluate(() => ({ ev: window.__qa.ev, phases: window.__qa.phases, long: window.__qa.long, nan: window.__qa.nan.slice(0, 20), anims: window.__qa.anims, log: (window.__rules?.log || []).slice(-80).map((l) => ({ t: +l.t.toFixed(1), clock: +l.clock.toFixed(1), e: l.e })) }))
const res = {
  url,
  readyMs,
  dev: await devPanel(p),
  bot: bot && { stats: bot.stats, log: bot.log.slice(-200) },
  windows,
  stuck,
  ballIdle: ballIdleEv,
  final: await snapState(p),
  logs: logs.slice(0, 60),
  ...qa,
}
save(`${out}/sonuc.json`, res)
const cnt = {}
for (const e of qa.ev) cnt[e.type] = (cnt[e.type] || 0) + 1
console.log('OZET', JSON.stringify({ readyMs, events: cnt, long: qa.long.length, nan: qa.nan.length, stuck: stuck.length, ballIdle: ballIdleEv.length, pageerrors: logs.length, bot: bot?.stats, score: res.final.match.score }))
await b.close()
