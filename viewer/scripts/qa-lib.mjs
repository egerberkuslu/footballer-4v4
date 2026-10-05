// O (QA): ortak yardimcilar. Gercek GPU'lu sistem Chrome'u, kayitci, insan gibi oynayan klavye/fare botu.
// Dogrudan calistirilmaz; qa-*.mjs betikleri kullanir (her zaman scripts/run-browser.sh ile).
import { chromium, firefox } from 'playwright'
import fs from 'node:fs'

export const BASE = 'http://127.0.0.1:5173/'

export async function launch({ ff = false, w = 1920, h = 1080 } = {}) {
  const b = ff
    ? await firefox.launch()
    : await chromium.launch({
        headless: true,
        executablePath: '/opt/google/chrome/chrome',
        args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
      })
  const p = await b.newPage({ viewport: { width: w, height: h } })
  const logs = []
  p.on('pageerror', (e) => logs.push({ t: Date.now(), kind: 'pageerror', msg: e.message.slice(0, 400) }))
  p.on('console', (m) => {
    if (m.type() === 'error') logs.push({ t: Date.now(), kind: 'console.error', msg: m.text().slice(0, 300) })
  })
  // vite tam yeniden yukleme (baska ajanin duzenlemesi) kaydi
  let loads = 0
  p.on('load', () => { if (++loads > 1) logs.push({ t: Date.now(), kind: 'reload', msg: 'sayfa yeniden yuklendi (HMR tam yenileme?)' }) })
  p.setDefaultTimeout(180000)
  return { b, p, logs }
}

// sahne hazir mi: r3f, oyun ve birkac yuz kare
export async function waitReady(p, maxMs = 90000) {
  const t0 = Date.now()
  for (;;) {
    const ok = await p
      .evaluate(() => !!(window.__r3f && window.__game && window.__r3f.gl.info.render.frame > 120))
      .catch(() => false)
    if (ok) return Date.now() - t0
    if (Date.now() - t0 > maxMs) return -1
    await p.waitForTimeout(500)
  }
}

// sayfa ici kayitci: olaylar, faz gecisleri, uzun kareler, NaN, kare sureleri
export async function installRecorder(p) {
  await p.evaluate(() => {
    if (window.__qa) return
    const g = window.__game
    const qa = (window.__qa = { ev: [], phases: [], long: [], nan: [], frames: [], t0: performance.now(), lastPhase: null, lastEv: null, anims: {} })
    const now = () => +((performance.now() - qa.t0) / 1000).toFixed(2)
    g.on((e) => {
      if (e.type === 'touch' && e.kind === 'dribble') return
      const r = { t: now(), clock: +g.match.clock.toFixed(1), phase: g.match.phase, ...e }
      qa.ev.push(r)
      qa.lastEv = e.type + (e.reason ? ':' + e.reason : '') + (e.verdict ? ':' + e.verdict : '')
      if (qa.ev.length > 4000) qa.ev.shift()
    })
    let prev = performance.now()
    const loop = () => {
      const t = performance.now()
      const dt = t - prev
      prev = t
      qa.frames.push(dt)
      if (qa.frames.length > 20000) qa.frames.shift()
      const ph = g.match.phase
      if (ph !== qa.lastPhase) {
        qa.phases.push({ t: now(), phase: ph, restart: g.match.restart ? g.match.restart.type : null, score: [...g.match.score] })
        qa.lastPhase = ph
      }
      if (dt > 50) qa.long.push({ t: now(), ms: +dt.toFixed(1), phase: ph, lastEv: qa.lastEv, var: !!document.querySelector('.var-overlay, .var-full') })
      const b = window.__world.ball
      if (!Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz)) qa.nan.push({ t: now(), what: 'ball' })
      for (const pl of g.players) {
        if (!Number.isFinite(pl.x + pl.z + pl.vx + pl.vz + pl.facing)) qa.nan.push({ t: now(), what: 'player ' + pl.id })
        qa.anims[pl.anim] = (qa.anims[pl.anim] || 0) + 1
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
}

export async function snapState(p) {
  return p.evaluate(() => {
    const g = window.__game
    const b = window.__world.ball
    const r = (v) => +v.toFixed(2)
    return {
      match: { phase: g.match.phase, clock: r(g.match.clock), half: g.match.half, score: g.match.score, restart: g.match.restart, attackDir: g.match.attackDir },
      ball: { x: r(b.x), y: r(b.y), z: r(b.z), v: r(Math.hypot(b.vx, b.vy, b.vz)) },
      players: g.players.map((q) => ({ id: q.id, t: q.team, role: q.role, x: r(q.x), z: r(q.z), anim: q.anim, ball: q.hasBall, ctl: q.controlled, st: r(q.stamina), y: q.yellow, off: q.sentOff })),
      referee: { x: r(g.referee.x), z: r(g.referee.z), anim: g.referee.anim },
      banner: window.__rules?.banner?.text ?? null,
    }
  })
}

export async function devPanel(p) {
  return p.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => d.title === 'Dev modu: F3')?.parentElement
    return el ? el.innerText.replace(/\n+/g, ' | ') : null
  })
}

// kare istatistigi (sayfa ici kayittan), son n kare
export async function frameStats(p, n = 600) {
  return p.evaluate((n) => {
    if (!window.__qa) return null
    const a = window.__qa.frames.slice(-n).slice()
    if (!a.length) return null
    const avg = a.reduce((s, v) => s + v, 0) / a.length
    const s = a.slice().sort((x, y) => y - x)
    return {
      n: a.length,
      fps: +(1000 / avg).toFixed(1),
      avgMs: +avg.toFixed(2),
      p1Ms: +s[Math.floor(a.length / 100)].toFixed(1),
      maxMs: +s[0].toFixed(1),
      over33: a.filter((v) => v > 33).length,
      over50: a.filter((v) => v > 50).length,
      calls: window.__r3f.gl.info.render.calls,
      tris: window.__r3f.gl.info.render.triangles,
    }
  }, n)
}

// ---- insan gibi oynayan bot (yalniz klavye + fare; durum okumasi yalniz karar icin) ----
export class HumanBot {
  constructor(p) {
    this.p = p
    this.held = new Set()
    this.charging = 0
    this.log = []
    this.lastPass = 0
    this.lastTackle = 0
    this.stats = { shots: 0, passes: 0, tackles: 0, switches: 0, restartsTaken: 0 }
  }
  async setKeys(want) {
    for (const k of [...this.held]) if (!want.has(k)) { await this.p.keyboard.up(k); this.held.delete(k) }
    for (const k of want) if (!this.held.has(k)) { await this.p.keyboard.down(k); this.held.add(k) }
  }
  async releaseAll() {
    await this.setKeys(new Set())
  }
  async state() {
    return this.p.evaluate(() => {
      const g = window.__game
      const b = window.__world.ball
      const cam = window.__r3f.camera
      const f = cam.getWorldDirection(new cam.position.constructor())
      const me = g.players.find((q) => q.controlled)
      const team = g.humanTeam ?? 0
      const proj = (x, y, z) => {
        const v = new cam.position.constructor(x, y, z).project(cam)
        return { sx: (v.x + 1) / 2 * innerWidth, sy: (1 - v.y) / 2 * innerHeight, ok: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }
      }
      const dir = g.match.attackDir[team]
      const mates = g.players.filter((q) => q.team === team && !q.controlled && q.role !== 'kaleci' && !q.sentOff).map((q) => ({ id: q.id, x: q.x, z: q.z }))
      const opp = g.players.filter((q) => q.team !== team && !q.sentOff).map((q) => ({ id: q.id, x: q.x, z: q.z, ball: q.hasBall, role: q.role }))
      return {
        phase: g.match.phase,
        restart: g.match.restart,
        me: me && { id: me.id, x: me.x, z: me.z, ball: me.hasBall, lock: me.actionLock, anim: me.anim },
        ball: { x: b.x, y: b.y, z: b.z, v: Math.hypot(b.vx, b.vz) },
        fx: f.x, fz: f.z, dir, mates, opp,
        goalScr: proj(dir * 20, 1.0, (Math.random() - 0.5) * 3.2),
        mateScr: mates.map((m) => proj(m.x, 0, m.z)),
        hint: document.body.innerText.includes('Sıra sende'),
        var: g.match.phase === 'var',
      }
    })
  }
  dirKeys(s, dx, dz, sprint) {
    const fl = Math.hypot(s.fx, s.fz) || 1
    const fx = s.fx / fl, fz = s.fz / fl
    const rx = -fz, rz = fx
    const l = Math.hypot(dx, dz) || 1
    const iy = (dx * fx + dz * fz) / l
    const ix = (dx * rx + dz * rz) / l
    const k = new Set()
    if (iy > 0.38) k.add('w')
    if (iy < -0.38) k.add('s')
    if (ix > 0.38) k.add('d')
    if (ix < -0.38) k.add('a')
    if (sprint) k.add('Shift')
    return k
  }
  async tick(tNow) {
    const s = await this.state()
    if (!s.me || s.var) {
      if (this.charging) { await this.p.keyboard.up(' '); this.charging = 0 }
      await this.setKeys(new Set())
      return s
    }
    const me = s.me
    // duran top bizde: kisa bekle, pas ver
    if (s.phase !== 'play') {
      if (this.charging) { await this.p.keyboard.up(' '); this.charging = 0 }
      if (s.restart?.taker === me.id) return this.restart(s, tNow)
      await this.setKeys(new Set())
      return s
    }
    const gx = s.dir * 20
    if (this.charging) {
      // sarj suruyor: ~0.55 s sonra birak
      if (tNow - this.charging > 550) {
        await this.p.keyboard.up(' ')
        this.charging = 0
        this.stats.shots++
        this.log.push({ t: tNow, a: 'shot-release' })
      }
      return s
    }
    if (me.ball) {
      const dg = Math.hypot(gx - me.x, -me.z)
      if (dg < 15 && Math.abs(me.z) < 9) {
        if (s.goalScr.ok) await this.p.mouse.move(s.goalScr.sx, s.goalScr.sy)
        await this.setKeys(this.dirKeys(s, gx - me.x, -me.z, false))
        await this.p.keyboard.down(' ')
        this.charging = tNow
        this.log.push({ t: tNow, a: 'shot-charge', x: me.x, z: me.z })
        return s
      }
      // rakip yakin ve takim arkadasi onde: pas
      const press = s.opp.some((o) => Math.hypot(o.x - me.x, o.z - me.z) < 2.2)
      if (press && tNow - this.lastPass > 1500 && s.mates.length) {
        const i = s.mates.reduce((bi, m, j, a) => ((m.x - me.x) * s.dir > (a[bi].x - me.x) * s.dir ? j : bi), 0)
        const sc = s.mateScr[i]
        if (sc?.ok) await this.p.mouse.move(sc.sx, sc.sy)
        await this.p.keyboard.press('k')
        this.lastPass = tNow
        this.stats.passes++
        this.log.push({ t: tNow, a: 'pass', to: s.mates[i].id })
        return s
      }
      // kaleye dogru sur (hafif zigzag)
      const zig = Math.sin(tNow / 900) * 4
      await this.setKeys(this.dirKeys(s, gx - me.x, zig - me.z, dg > 20))
      return s
    }
    // topsuz: topa kos; rakipte top yakinsa mudahale
    const db = Math.hypot(s.ball.x - me.x, s.ball.z - me.z)
    const carrier = s.opp.find((o) => o.ball)
    if (carrier && Math.hypot(carrier.x - me.x, carrier.z - me.z) < 1.6 && tNow - this.lastTackle > 1200) {
      await this.p.keyboard.press('e')
      this.lastTackle = tNow
      this.stats.tackles++
      this.log.push({ t: tNow, a: 'tackle', on: carrier.id })
    }
    if (db > 12 && tNow - (this.lastSwitch || 0) > 3000) {
      await this.p.keyboard.press('q')
      this.lastSwitch = tNow
      this.stats.switches++
    }
    await this.setKeys(this.dirKeys(s, s.ball.x - me.x, s.ball.z - me.z, db > 4))
    return s
  }
  async restart(s, tNow) {
    if (!this.rsT || this.rsKey !== JSON.stringify(s.restart)) {
      this.rsT = tNow
      this.rsKey = JSON.stringify(s.restart)
      return s
    }
    if (tNow - this.rsT > 1200) {
      const i = s.mates.length ? 0 : -1
      if (i >= 0 && s.mateScr[i]?.ok) await this.p.mouse.move(s.mateScr[i].sx, s.mateScr[i].sy)
      await this.p.keyboard.press('k')
      this.stats.restartsTaken++
      this.log.push({ t: tNow, a: 'restart-pass', type: s.restart?.type })
      this.rsT = tNow + 4000
    }
    return s
  }
}

export function save(path, obj) {
  fs.writeFileSync(path, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1))
}
