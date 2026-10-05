// Lokomosyon ajani: GERCEK mac (AI-AI, gercek zaman) icinde kosu olcumu.
// Her cizilen karede saha oyuncularinin ayak kemiklerinin dunya konumu okunur:
//  - basan ayak kaymasi: bilek zemine yakin (en alcak + 2.5 cm) iken yatay yol (cm), basma basina
//  - zemin: bilek / parmak eklemi en alcak yukseklik (m)
//  - surme dokunusu: 'touch' dribble olayinda sag ayak (bilek-parmak ortasi) ile top yuzeyi mesafesi (cm)
//  - hiz/faz: __locoDbg (katman), anim adi
// Kullanim: scripts/run-browser.sh node scripts/loco-match.mjs <cikti.json> [saniye=60] [ek-sorgu]
import fs from 'node:fs'
import { BASE, launch, waitReady } from './qa-lib.mjs'
const out = process.argv[2] || '/tmp/asci/loco/match.json'
const SEC = Number(process.argv[3] || 60)
const extra = process.argv[4] || ''
const { b, p, logs } = await launch({ w: 1280, h: 720 })
await p.goto(`${BASE}?mode=mac&dev=1&watch=1&half=3${extra ? '&' + extra : ''}`)
console.log('hazir ms', await waitReady(p))
await p.evaluate(() => {
  window.__locoDbg = {}
  const g = window.__game
  const W = window.__world
  const scene = window.__r3f.scene
  const R = (window.__lm = { feet: {}, touches: [], pend: [], frames: 0, stance: [], minAnkle: 9, minToe: 9, speeds: [], fps: [] })
  // iskeletler -> oyuncu (pelvis en yakin)
  const sk = []
  scene.traverse((o) => {
    if (o.isBone && o.name === 'pelvis') {
      const root = o.parent
      const find = (n) => {
        let r = null
        root.traverse((x) => { if (!r && x.isBone && x.name === n) r = x })
        return r
      }
      sk.push({ pel: o, fl: find('foot_l'), fr: find('foot_r'), tl: find('ball_l'), tr: find('ball_r') })
    }
  })
  R.nsk = sk.length
  const V = window.__V3 || (window.__V3 = class { constructor() { this.x = 0; this.y = 0; this.z = 0 } })
  g.on((e) => {
    if (e.type === 'touch' && e.kind === 'dribble') R.pend.push({ id: e.player, t: performance.now() })
  })
  const st = {} // id -> {L:{on, path, last}, R:...}
  const tmp = { x: 0, y: 0, z: 0 }
  const wp = (bone) => {
    bone.updateWorldMatrix(true, false)
    const e = bone.matrixWorld.elements
    return [e[12], e[13], e[14]]
  }
  let prev = performance.now()
  const loop = () => {
    requestAnimationFrame(loop)
    const now = performance.now()
    R.fps.push(now - prev)
    prev = now
    if (g.match.phase !== 'play') return
    R.frames++
    const map = {}
    for (const q of g.players) {
      if (q.role === 'kaleci' || q.sentOff) continue
      let best = null, bd = 1e9
      for (const s of sk) {
        const pp = wp(s.pel)
        const d = (pp[0] - q.x) ** 2 + (pp[2] - q.z) ** 2
        if (d < bd) { bd = d; best = s }
      }
      if (!best || bd > 1) continue
      map[q.id] = best
      const dbg = window.__locoDbg[best.pel.uuid]
      const active = dbg && dbg.w > 0.95 && ['jog', 'run', 'sprint', 'dribble', 'walk'].includes(q.anim)
      const sp = Math.hypot(q.vx, q.vz)
      const S = (st[q.id] ??= { l: { on: false, path: 0, n: 0, last: null }, r: { on: false, path: 0, n: 0, last: null } })
      for (const side of ['l', 'r']) {
        const A = wp(best['f' + side])
        const T = wp(best['t' + side])
        if (active) {
          R.minAnkle = Math.min(R.minAnkle, A[1])
          R.minToe = Math.min(R.minToe, T[1])
        }
        const F = S[side]
        if (active) F.min = Math.min(F.min ?? 9, A[1])
        const low = A[1] < (F.min ?? 9) + 0.02 // oyuncunun en alcak bilegi + 2 cm
        if (low && active) {
          if (F.on && F.last) F.path += Math.hypot(A[0] - F.last[0], A[2] - F.last[1])
          F.on = true
          F.n++
          F.last = [A[0], A[2]]
          F.sp = sp
        } else {
          if (F.on && F.n >= 3) R.stance.push({ id: q.id, side, cm: +(F.path * 100).toFixed(2), n: F.n, v: +F.sp.toFixed(2), anim: q.anim, ball: q.hasBall ? 1 : 0 })
          F.on = false
          F.path = 0
          F.n = 0
          F.last = null
        }
      }
      R.act = (R.act || 0) + (active ? 1 : 0)
      R.all = (R.all || 0) + 1
      if (active && R.frames % 6 === 0) R.speeds.push([+sp.toFixed(2), q.anim, q.hasBall ? 1 : 0, +(dbg.rate ?? 1).toFixed(2), +(dbg.stride ?? 1).toFixed(2)])
    }
    // dokunuslar: olay sonrasi ilk cizilen kare
    while (R.pend.length) {
      const t = R.pend.shift()
      const s = map[t.id]
      if (!s) continue
      const q = g.players[t.id]
      const A = wp(s.fr), T = wp(s.tr), AL = wp(s.fl), TL = wp(s.tl)
      const mid = [(A[0] + T[0]) / 2, (A[1] + T[1]) / 2, (A[2] + T[2]) / 2]
      const midL = [(AL[0] + TL[0]) / 2, (AL[1] + TL[1]) / 2, (AL[2] + TL[2]) / 2]
      const bl = W.ball
      const d = Math.hypot(mid[0] - bl.x, mid[1] - bl.y, mid[2] - bl.z) - 0.11
      const dl = Math.hypot(midL[0] - bl.x, midL[1] - bl.y, midL[2] - bl.z) - 0.11
      const dbg = window.__locoDbg[s.pel.uuid]
      R.touches.push({ id: t.id, cmR: +(d * 100).toFixed(1), cmL: +(dl * 100).toFixed(1), v: +Math.hypot(q.vx, q.vz).toFixed(2), clip: dbg ? +dbg.w.toFixed(2) : -1, tW: dbg ? +dbg.touchW.toFixed(2) : -1, tR: dbg ? +dbg.tR.toFixed(3) : -1, anim: q.anim })
    }
  }
  requestAnimationFrame(loop)
})
await p.waitForTimeout(SEC * 1000)
const R = await p.evaluate(() => {
  const r = window.__lm
  return { act: r.act, all: r.all, nsk: r.nsk, frames: r.frames, stance: r.stance, touches: r.touches, minAnkle: r.minAnkle, minToe: r.minToe, speeds: r.speeds, fps: r.fps.length ? 1000 / (r.fps.reduce((a, b) => a + b, 0) / r.fps.length) : 0, layers: window.__layers }
})
const q = (a, f) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : null)
const sum = {}
for (const [k, f] of [['topsuz', (s) => !s.ball], ['topla', (s) => s.ball]]) {
  const xs = R.stance.filter(f).map((s) => s.cm)
  sum[k] = { n: xs.length, med: q(xs, 0.5), p90: q(xs, 0.9), max: q(xs, 1) }
}
const bySp = {}
for (const s of R.stance) {
  const k = s.v < 2 ? '<2' : s.v < 3.5 ? '2-3.5' : s.v < 5 ? '3.5-5' : s.v < 7 ? '5-7' : '7+'
  ;(bySp[k] ??= []).push(s.cm)
}
const tc = R.touches.filter((t) => t.clip > 0.9).map((t) => t.cmR)
const res = { aktifOran: +(R.act / R.all).toFixed(3), frames: R.frames, nsk: R.nsk, fps: +R.fps.toFixed(1), kayma: sum, kaymaHiz: Object.fromEntries(Object.entries(bySp).map(([k, v]) => [k, { n: v.length, med: q(v, 0.5), p90: q(v, 0.9) }])), minAnkle: R.minAnkle, minToe: R.minToe, dokunus: { n: R.touches.length, klipte: tc.length, medCm: q(tc, 0.5), p90Cm: q(tc, 0.9), ornek: R.touches.slice(0, 12) }, layers: R.layers, hatalar: logs.slice(0, 4) }
fs.writeFileSync(out, JSON.stringify({ ...res, stance: R.stance, touches: R.touches, speeds: R.speeds }))
console.log(JSON.stringify(res, null, 1))
await b.close()
