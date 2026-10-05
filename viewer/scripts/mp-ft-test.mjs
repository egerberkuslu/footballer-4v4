// Maç sonu -> host 'Yeniden oyna' -> misafir yeni maci alir; misafir 'Ana menu' temiz cikar (L2).
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

  // 4) maci bitir: skor/ceza kirli olsun, 2. yari sonuna sar
  await until(host, () => __game.match.phase === 'play', null, 60000)
  await host.evaluate(() => {
    const m = __game.match
    m.score = [2, 1]
    const p = __game.players.find((q) => q.team === 1 && q.role !== 'kaleci' && !q.controlled && !q.remote)
    __rules.suspend(p)
    m.half = 2
    m.clock = m.halfLength - 0.3
  })
  const ftH = await until(host, () => __game.match.phase === 'fulltime', null, 30000)
  const ftG = await until(guest, () => __game.match.phase === 'fulltime', null, 15000)
  await guest.waitForTimeout(500)
  const wait = await guest.evaluate(() => document.body.innerText.includes('Host bekleniyor'))
  const hostBtn = await host.evaluate(() => [...document.querySelectorAll('.rh-ft button')].map((b) => b.textContent.trim().split(' ')[0]).join(','))
  ok('maç sonu iki tarafta, misafirde Host bekleniyor', ftH && ftG && wait, `host düğmeleri ${hostBtn}`)
  await guest.screenshot({ path: `${shots}-ft-guest.png` })
  // 5) host Yeniden oyna
  await host.evaluate(() => document.querySelector('.rh-ft button:not(.alt)').click())
  const rsH = await until(host, () => __game.match.score[0] === 0 && __game.match.score[1] === 0 && __game.match.phase !== 'fulltime', null, 15000)
  const rsG = await until(guest, () => __game.match.score[0] === 0 && __game.match.score[1] === 0 && __game.match.phase !== 'fulltime' && __game.match.half === 1, null, 15000)
  await guest.waitForTimeout(1500)
  const st = (pg) =>
    pg.evaluate(() => ({
      ph: __game.match.phase,
      half: __game.match.half,
      clock: Math.round(__game.match.clock * 10) / 10,
      score: __game.match.score.join('-'),
      sus: (__game.match.suspended ?? []).length,
      off: __game.players.filter((p) => p.sentOff).length,
      pos: __game.players.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]),
      roles: __game.players.map((p) => p.role).join(','),
    }))
  const sh = await st(host)
  const sg = await st(guest)
  const dmax = Math.max(...sh.pos.map((a, i) => Math.hypot(a[0] - sg.pos[i][0], a[1] - sg.pos[i][1])))
  ok('misafir yeni maci aldi: 0-0, ilk yari, ceza yok', rsH && rsG && sg.half === 1 && sg.sus === 0 && sg.off === 0 && sh.roles === sg.roles, `host ${sh.ph}/${sh.clock}/${sh.score}/sus${sh.sus} misafir ${sg.ph}/${sg.clock}/${sg.score}/sus${sg.sus}/off${sg.off}`)
  ok('oyuncu konumlari host ile uyumlu', dmax < 1.5, `en buyuk fark ${dmax.toFixed(2)} m`)
  const play2 = await until(guest, () => __game.match.phase === 'play', null, 40000)
  const c0 = await guest.evaluate(() => __game.match.clock)
  await guest.waitForTimeout(2500)
  const c1 = await guest.evaluate(() => __game.match.clock)
  ok('oyun ilerliyor (misafir saati)', play2 && c1 - c0 > 1.5, `+${(c1 - c0).toFixed(2)} s`)
  await guest.screenshot({ path: `${shots}-restart-guest.png` })
  // 6) misafir Ana menu: temiz cikis
  await host.evaluate(() => { __game.match.half = 2; __game.match.clock = __game.match.halfLength - 0.3 })
  await until(guest, () => __game.match.phase === 'fulltime', null, 30000)
  await guest.waitForTimeout(400)
  await Promise.all([guest.waitForNavigation({ timeout: 60000 }).catch(() => {}), guest.evaluate(() => document.querySelector('.rh-ft button.alt').click())])
  await guest.waitForFunction(() => !!window.__mp, null, { timeout: 120000 })
  await guest.waitForTimeout(1500)
  const gm = await guest.evaluate(() => ({ url: location.search, screen: __mp.mp.screen, info: __mp.mp.info, error: __mp.mp.error, inMatch: __mp.mp.inMatch, conn: __mp.mp.conn, menu: !!document.querySelector('.mp-modes') }))
  ok('misafir Ana menu: temiz cikis, bayat bilgi yok', gm.url.includes('menu=1') && gm.menu && !gm.info && !gm.error && !gm.inMatch, JSON.stringify(gm))
  await guest.screenshot({ path: `${shots}-menu-guest.png` })
  const hostSees = await until(host, () => __mp.mp.lobby?.members.filter((m) => m.online).length === 1, null, 20000)
  ok('host misafirin ciktigini gordu', hostSees, await host.evaluate(() => JSON.stringify({ online: __mp.mp.lobby?.members.filter((m) => m.online).length, phase: __game.match.phase })))
} catch (e) {
  console.log('HATA', e.message)
} finally {
  for (const k of ['host', 'guest']) if (logs[k].length) console.log(`--- ${k} konsol:\n` + logs[k].slice(0, 30).join('\n'))
  await browser.close()
  const fail = results.filter((r) => !r.pass).length
  console.log(`\n${results.length - fail}/${results.length} gecti`)
  process.exit(fail ? 1 : 0)
}
