// Cok oyunculu uctan uca test (L): tek Chromium, iki baglam. Host oda kurar, misafir kodla katilir.
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

  // 4) misafir W -> host'ta hareket
  const fps = async (pg) => {
    const f0 = await pg.evaluate(() => window.__r3f.gl.info.render.frame)
    await pg.waitForTimeout(2000)
    return ((await pg.evaluate(() => window.__r3f.gl.info.render.frame)) - f0) / 2
  }
  console.log(`  kare hizi: host ${await fps(host)} fps, misafir ${await fps(guest)} fps `)
  // oyun 'play' iken W'yi 1.5 s tut; duran top (faul/out) araya girerse yeniden dene
  const pos = (pg) => pg.evaluate((i) => ({ x: __game.players[i].x, z: __game.players[i].z, ph: __game.match.phase }), pid)
  let p0, g0, p1, g1
  for (let tries = 0; tries < 12; tries++) {
    await until(host, () => __game.match.phase === 'play', null, 30000)
    p0 = await pos(host)
    g0 = await pos(guest)
    await guest.keyboard.down('w')
    await guest.waitForTimeout(700)
    if (tries === 0) {
      const tg = await guest.evaluate((i) => ({ inp: __game.inputs[i].move, phase: __game.match.phase }), pid)
      const th = await host.evaluate((i) => ({ inp: __game.inputs[i].move, rin: [...__mp.H.guests.values()].map((g) => ({ s: g.rin.s, mz: g.rin.mz })) }), pid)
      console.log('  tani:', JSON.stringify(tg), JSON.stringify(th))
    }
    await guest.waitForTimeout(800)
    if (tries === 0) await guest.screenshot({ path: `${shots}-run-guest.png` })
    p1 = await pos(host)
    g1 = await pos(guest)
    await guest.keyboard.up('w')
    if (p1.ph === 'play' && Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2) break
    await guest.waitForTimeout(500)
  }
  const dh = Math.hypot(p1.x - p0.x, p1.z - p0.z)
  const dg = Math.hypot(g1.x - g0.x, g1.z - g0.z)
  ok('misafir W -> host oyuncusu hareket etti', dh > 2, `host ${dh.toFixed(2)} m, misafir tahmini ${dg.toFixed(2)} m`)
  await until(host, (i) => Math.hypot(__game.players[i].vx, __game.players[i].vz) < 0.05, pid, 30000)
  await guest.waitForTimeout(2500)
  const gap = await Promise.all([
    host.evaluate((i) => ({ x: __game.players[i].x, z: __game.players[i].z }), pid),
    guest.evaluate((i) => ({ x: __game.players[i].x, z: __game.players[i].z }), pid),
  ])
  ok('durunca iki taraf uzlasti', Math.hypot(gap[0].x - gap[1].x, gap[0].z - gap[1].z) < 0.6, `fark ${Math.hypot(gap[0].x - gap[1].x, gap[0].z - gap[1].z).toFixed(2)} m`)

  // 5) gol: host'ta topu ev takiminin hucum ettigi kaleye yolla
  // duran top / kaleci kurtarisi araya girerse yeniden dene
  let scored = false
  for (let k = 0; k < 5 && !scored; k++) {
    await until(host, () => __game.match.phase === 'play', null, 30000)
    await host.evaluate(() => {
      const dir = __game.match.attackDir[0]
      __world.placeBall(dir * 17, 0)
      __world.kick({ x: dir * 18, y: 3, z: 11 }, { x: 0, y: 0, z: 0 })
    })
    scored = await until(host, () => __game.match.score[0] + __game.match.score[1] > 0, null, 8000)
  }
  const synced = await until(guest, (s) => __game.match.score.join('-') === s, await host.evaluate(() => __game.match.score.join('-')), 20000)
  const sh = await host.evaluate(() => __game.match.score.join('-'))
  const sg = await guest.evaluate(() => __game.match.score.join('-'))
  ok('gol host skoruna yazildi', scored, `host ${sh}`)
  ok('skor iki tarafta ayni', synced && sh === sg, `host ${sh} · misafir ${sg}`)
  await until(guest, () => window.__mpEv.includes('goal'), null, 30000)
  const evH = await host.evaluate(() => window.__mpEv)
  const evG = await guest.evaluate(() => window.__mpEv)
  ok('gol olayi iki tarafta', evH.includes('goal') && evG.includes('goal'), `host [${evH}] · misafir [${evG}]`)
  await guest.waitForTimeout(500)
  await host.screenshot({ path: `${shots}-goal-host.png` })
  await guest.screenshot({ path: `${shots}-goal-guest.png` })

  // 6) VAR: host elle inceleme baslatir; misafir kendi tamponundan oynatir, karar host'un
  await until(host, () => __game.match.phase === 'play', null, 30000)
  await host.waitForTimeout(1500)
  // elle tetik pozisyon ister; protokol yolu icin host'tan topun konumunda bir cizgi vakasi yollanir
  await host.evaluate(() => {
    const b = __world.ball
    const v = window.__var.judgeAt(b.x, b.y, b.z)
    __mp.hostSendAll({ t: 'var', on: true, verdict: { kind: 'line', reason: 'manual', v }, reason: 'Test incelemesi' })
  })
  const vg = await until(guest, () => window.__var?.state.active, null, 8000)
  if (vg) {
    await guest.waitForTimeout(3000)
    await guest.screenshot({ path: `${shots}-var-guest.png` })
  }
  const vinfo = await guest.evaluate(() => ({ phase: window.__var?.state.phase, kind: window.__var?.state.case?.kind ?? null }))
  ok('VAR karari misafirde oynatildi', vg, JSON.stringify(vinfo))
  await host.evaluate(() => __mp.hostSendAll({ t: 'var', on: false }))
  const vend = await until(guest, () => !window.__var?.state.active, null, 60000)
  ok('VAR misafirde kapandi', vend)

  // 7) host sekmesi arka planda: Worker tik'i simulasyonu surdurur, misafire snapshot gider
  // bassizda sekme gizlenemiyor: rAF dongusu durdurulur ve document.hidden taklit edilir (gercek gizli sekme gibi)
  const setHidden = (pg, h) =>
    pg.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') })
      window.__r3f.setFrameloop(h ? 'never' : 'always')
      document.dispatchEvent(new Event('visibilitychange'))
      return document.hidden
    }, h)
  const hid = await setHidden(host, true)
  const f0 = await host.evaluate(() => window.__r3f.gl.info.render.frame)
  const w0 = await host.evaluate(() => __world.time)
  const s0 = await guest.evaluate(() => __game.match.clock)
  await host.waitForTimeout(3000)
  const w1 = await host.evaluate(() => __world.time)
  const s1 = await guest.evaluate(() => __game.match.clock)
  const f1 = await host.evaluate(() => window.__r3f.gl.info.render.frame)
  ok('host arka planda simulasyon suruyor', hid && w1 - w0 > 2 && f1 === f0, `gizli=${hid}, host sim +${(w1 - w0).toFixed(2)} s, render ${f1 - f0} kare, misafir saat +${(s1 - s0).toFixed(2)} s`)
  await setHidden(host, false)
  await host.waitForTimeout(500)
  const f2 = await host.evaluate(() => window.__r3f.gl.info.render.frame)
  ok('gorunur olunca render geri geldi', f2 > f1, `+${f2 - f1} kare`)

  const st = await guest.evaluate(() => ({ ping: __mp.mp.ping, conn: __mp.mp.conn }))
  ok('ping olculdu', st.ping >= 0, `${st.ping} ms, ${st.conn}`)
  await guest.evaluate(() => __mp.sendChat('Güzel goldü'))
  await guest.evaluate(() => __mp.sendEmote(1))
  await host.waitForTimeout(700)
  await host.screenshot({ path: `${shots}-chat-host.png` })
} catch (e) {
  console.log('HATA', e.message)
} finally {
  for (const k of ['host', 'guest']) if (logs[k].length) console.log(`--- ${k} konsol:\n` + logs[k].slice(0, 60).join('\n'))
  await browser.close()
  const fail = results.filter((r) => !r.pass).length
  console.log(`\n${results.length - fail}/${results.length} gecti`)
  process.exit(fail ? 1 : 0)
}
