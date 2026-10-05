// Kirmizi kart 30 s ceza senkronu (L2): saha oyuncusu ve kaleci senaryosu, host-misafir ayni durumu gormeli.
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

  // 4) kirmizi kart: ceza sayaci host'ta akar, misafir snapshot'tan gosterir
  const rec = async (pg) =>
    pg.evaluate(() => {
      window.__ret = []
      __game.on((e) => {
        if (e.type === 'player-return') window.__ret.push(e.player)
      })
    })
  await rec(host)
  await rec(guest)
  const view = (pg, id) =>
    pg.evaluate((i) => {
      const p = __game.players[i]
      const sl = __game.match.suspended ?? []
      return { sentOff: p.sentOff, role: p.role, sus: sl.map((x) => [x.id, Math.round(x.left)]), hud: document.body.innerText.includes('\u{1F7E5}'), ret: window.__ret.slice() }
    }, id)
  const roles = (pg) => pg.evaluate(() => __game.players.map((p) => p.role).join(','))
  const toLive = async () => {
    await until(host, () => __game.match.phase === 'play', null, 60000)
  }
  // A) saha oyuncusu (AI, takim 1, kaleci degil)
  await toLive()
  const fid = await host.evaluate(() => __game.players.find((p) => p.team === 1 && p.role !== 'kaleci' && !p.controlled && !p.remote)?.id ?? -1)
  await host.evaluate((i) => __rules.suspend(__game.players[i]), fid)
  const aOk = await until(guest, (i) => __game.players[i].sentOff && (__game.match.suspended ?? []).some((x) => x.id === i), fid, 10000)
  await guest.waitForTimeout(600)
  const ga = await view(guest, fid)
  const ha = await view(host, fid)
  ok('saha oyuncusu cezasi misafirde gorunuyor', aOk && ga.hud, JSON.stringify(ga))
  ok('ceza listesi host ve misafirde ayni', JSON.stringify(ga.sus.map((x) => x[0])) === JSON.stringify(ha.sus.map((x) => x[0])), `host ${JSON.stringify(ha.sus)} misafir ${JSON.stringify(ga.sus)}`)
  await guest.screenshot({ path: `${shots}-red-guest.png` })
  // sayac akisi: host'ta kalani 3 s'ye cek (gercek tickSuspensions yolu), misafir geri sayim gorsun
  await host.evaluate((i) => { __rules.susp.get(i).left = 3 }, fid)
  await guest.waitForTimeout(1200)
  const left1 = await guest.evaluate((i) => (__game.match.suspended ?? []).find((x) => x.id === i)?.left ?? null, fid)
  ok('misafir sayaci geri sayiyor', left1 !== null && left1 < 2.9 && left1 > 0, `kalan ${left1}`)
  const back = await until(guest, (i) => !__game.players[i].sentOff && window.__ret.includes(i), fid, 40000)
  const gb = await view(guest, fid)
  const hb = await view(host, fid)
  ok('player-return iki tarafta, oyuncu dondu', back && hb.ret.includes(fid) && !hb.sentOff, `host ${JSON.stringify(hb.ret)} misafir ${JSON.stringify(gb.ret)}`)
  // B) kaleci kirmizi: rol devri ve geri donus
  await toLive()
  const r0h = await roles(host)
  const kid = await host.evaluate(() => __game.players.find((p) => p.team === 1 && p.role === 'kaleci')?.id ?? -1)
  await host.evaluate((i) => __rules.suspend(__game.players[i]), kid)
  await host.waitForTimeout(200)
  const r1h = await roles(host)
  const gotGk = await until(guest, (r) => __game.players.map((p) => p.role).join(',') === r, r1h, 10000)
  ok('kaleci kirmizisinda rol devri iki tarafta ayni', r1h !== r0h && gotGk, `onceki ${r0h} sonra ${r1h} misafir ${await roles(guest)}`)
  await guest.screenshot({ path: `${shots}-gk-red-guest.png` })
  await host.evaluate((i) => { __rules.susp.get(i).left = 1.5 }, kid)
  const kb = await until(guest, (i) => !__game.players[i].sentOff && window.__ret.includes(i), kid, 40000)
  await guest.waitForTimeout(600)
  const r2h = await roles(host)
  const gotBack = await until(guest, (r) => __game.players.map((p) => p.role).join(',') === r, r2h, 10000)
  ok('ceza bitince roller geri dondu (iki tarafta)', kb && gotBack && r2h === r0h, `host ${r2h} (beklenen ${r0h}) misafir ${await roles(guest)}`)
} catch (e) {
  console.log('HATA', e.message)
} finally {
  for (const k of ['host', 'guest']) if (logs[k].length) console.log(`--- ${k} konsol:\n` + logs[k].slice(0, 40).join('\n'))
  await browser.close()
  const fail = results.filter((r) => !r.pass).length
  console.log(`\n${results.length - fail}/${results.length} gecti`)
  process.exit(fail ? 1 : 0)
}
