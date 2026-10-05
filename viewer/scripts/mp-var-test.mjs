// Otomatik VAR iki tarayicida (L2): gercek autoDetect tetiklemesi, host-misafir senkronu.
// (mp-test.mjs'den turetildi) Cok oyunculu uctan uca test (L): tek Chromium, iki baglam. Host oda kurar, misafir kodla katilir.
// Denetler: misafir W -> oyuncusu host'ta hareket; skor iki tarafta ayni; gol olayi iki tarafta.
// Kullanim: scripts/run-browser.sh node scripts/mp-test.mjs [--local] [--swiftshader] [--url <site/>] [--shots shots/mp] [--port 5173] [--entry mp.html]
//   --local: PeerJS bulutu yerine 127.0.0.1:9000 (once: npx -y peer --port 9000)
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const local = args.includes('--local')
const shots = opt('--shots', 'shots/mp')
const port = opt('--port', '5173')
const q = `blades=0&grass=0&q=low&fx=0${local ? '&peer=local' : ''}${args.includes('--debug') ? '&peerdebug=3' : ''}`
const entry = opt('--entry', '') // ornek: mp.html (App'e baglanmadan once test girisi)
// --url https://127.0.0.1:8443/futbol/ : derlenmis site (alt yol + HTTPS) testi
const url = `${opt('--url', `http://127.0.0.1:${port}/`)}${entry}?${q}`

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  // varsayilan gercek GPU (SwiftShader'da host ~1 fps, oyun zamani ilerlemez); --swiftshader ile yazilim
  args: [
    ...(args.includes('--swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=gl-egl', '--enable-gpu']),
    '--ignore-gpu-blocklist',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
  ],
})
const results = []
const ok = (name, pass, info = '') => {
  results.push({ name, pass, info })
  console.log(`${pass ? 'GECTI' : 'KALDI'}  ${name}${info ? '  — ' + info : ''}`)
}
const logs = { host: [], guest: [] }
async function open(tag, path = url) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 }, ignoreHTTPSErrors: true })
  const name = tag === 'host' ? 'Ege' : 'Misafir'
  await ctx.addInitScript((n) => localStorage.setItem('mp.name', n), name)
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning' || /peerjs/i.test(m.text())) logs[tag].push(`[${m.type()}] ${m.text().slice(0, 200)}`)
  })
  page.on('pageerror', (e) => logs[tag].push(`[pageerror] ${e.message}`))
  page.on('response', (r) => {
    if (r.status() >= 400) logs[tag].push(`[http ${r.status()}] ${r.url()}`)
  })
  await page.goto(path, { timeout: 180000 })
  await page.waitForFunction(() => !!window.__mp && !!window.__game, null, { timeout: 120000 })
  return page
}
const until = async (page, fn, arg, ms = 30000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 200 })
    return true
  } catch {
    return false
  }
}

try {
  const host = await open('host')

  // 1) oda kur; host izleyici (iki takimi AI oynar, baslama vurusu beklemesin)
  await host.evaluate(() => {
    __mp.setName('Ege')
    __mp.hostCreate()
  })
  const opened = await until(host, () => !!__mp.mp.lobby?.code, null, 30000)
  const code = await host.evaluate(() => __mp.mp.lobby?.code ?? null)
  ok('oda kuruldu', opened, `kod ${code} · ${await host.evaluate(() => __mp.mp.error || 'hata yok')}`)
  if (!opened) throw new Error('oda yok')
  await host.evaluate(() => __mp.setPref(null, true))

  // 2) davet baglantisiyla katil (?oda=KOD)
  const guest = await open('guest', `${url}&oda=${code}`)
  const joined = await until(host, () => __mp.mp.lobby?.members.filter((m) => m.online).length === 2, null, 60000)
  ok('misafir katildi', joined, await guest.evaluate(() => __mp.mp.error || __mp.mp.conn))
  if (!joined) throw new Error('katilim yok')
  await guest.evaluate(() => __mp.setPref(1, true))
  await host.evaluate(() => __mp.sendChat('Merhaba, hoş geldin'))
  await guest.evaluate(() => __mp.sendEmote(0))
  await until(guest, () => __mp.mp.lobby?.members.find((m) => m.name === 'Misafir')?.ready, null, 10000)
  await host.waitForTimeout(1200)
  await host.screenshot({ path: `${shots}-lobby-host.png` })
  await guest.screenshot({ path: `${shots}-lobby-guest.png` })

  // 3) mac
  await host.evaluate(() => __mp.hostStart())
  const started = await until(guest, () => __mp.mp.inMatch && __mp.net.localPlayer >= 0, null, 20000)
  const pid = await guest.evaluate(() => __mp.net.localPlayer)
  ok('mac iki tarafta basladi', started, `misafir oyuncu id ${pid}`)
  // olay kaydi (iki tarafta)
  for (const p of [host, guest])
    await p.evaluate(() => {
      window.__mpEv = []
      __game.on((e) => {
        if (e.type === 'goal' || e.type === 'whistle') window.__mpEv.push(e.type)
      })
    })
  const play = await until(host, () => __game.match.phase === 'play', null, 40000)
  ok('oyun basladi (play)', play, await host.evaluate(() => __game.match.phase))
  await guest.waitForTimeout(800)

  // 4) gercek otomatik tetik: top kale cizgisine kil payi (m ~ -3 cm) yaklasip duruyor, her kare yerlestirilir
  await until(host, () => __game.match.phase === 'play', null, 40000)
  await host.waitForTimeout(1000)
  await host.evaluate(() => {
    const w = __world
    const R = 0.11
    const side = 1
    const xEnd = 20 + R - 0.03
    let n = 0
    window.__drive = setInterval(() => {
      const t = Math.min(1, n++ / 60)
      const b = w.ball
      b.x = b.px = side * (19.4 + (xEnd - 19.4) * t)
      b.y = b.py = R
      b.z = b.pz = 0
      b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0
    }, 1000 / 60)
  })
  const hv = await until(host, () => window.__var?.state.active, null, 20000)
  const hcase = await host.evaluate(() => ({ kind: window.__var?.state.case?.kind ?? null, reason: window.__var?.state.case?.reason ?? null, cm: window.__var?.state.case?.v?.cm ?? null, phase: window.__var?.state.phase, mp: __game.match.phase }))
  await host.evaluate(() => clearInterval(window.__drive))
  ok('host otomatik VAR tetikledi', hv, JSON.stringify(hcase))
  const gv = await until(guest, () => window.__var?.state.active, null, 10000)
  const gcase = await guest.evaluate(() => ({ kind: window.__var?.state.case?.kind ?? null, phase: window.__var?.state.phase, mp: __game.match.phase }))
  ok('misafirde VAR basladi', gv, JSON.stringify(gcase))
  await guest.waitForTimeout(4000)
  await host.screenshot({ path: `${shots}-auto-host.png` })
  await guest.screenshot({ path: `${shots}-auto-guest.png` })
  const hp = await host.evaluate(() => ({ phase: __var.state.phase, mp: __game.match.phase, ref: __game.referee?.anim }))
  console.log('  host durum', JSON.stringify(hp))
  const vend = await until(host, () => !window.__var?.state.active, null, 90000)
  ok('host VAR bitti', vend, JSON.stringify(await host.evaluate(() => ({ mp: __game.match.phase, score: __game.match.score }))))
  const gend = await until(guest, () => !window.__var?.state.active, null, 20000)
  ok('misafir VAR bitti', gend)
  const resumed = await until(host, () => __game.match.phase === 'play', null, 40000)
  ok('oyun yeniden basladi', resumed, await host.evaluate(() => __game.match.phase))
} catch (e) {
  console.log('HATA', e.message)
} finally {
  for (const k of ['host', 'guest']) if (logs[k].length) console.log(`--- ${k} konsol:\n` + logs[k].slice(0, 40).join('\n'))
  await browser.close()
  const fail = results.filter((r) => !r.pass).length
  console.log(`\n${results.length - fail}/${results.length} gecti`)
  process.exit(fail ? 1 : 0)
}
