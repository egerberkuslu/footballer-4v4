// Lokomosyon ajani: topla kosu (surme) olcumu, gercek oyun sayfasi (antrenman modu: AI/kural yok), kontrol edilen oyuncu.
// Her cizilen karede: anim, hiz, katman (__locoDbg: tR, touchW, w, bm), sag ayak (bilek-parmak ortasi) - top yuzeyi mesafesi,
// topun karakter uzayindaki konumu; 'touch' dribble olaylari. Ayrica kare dizisi (oyun kamerasi) kaydeder.
// Kullanim: scripts/run-browser.sh node scripts/loco-dribble.mjs <cikti-oneki> [sprint=0|1] [sure_s=6] [ek-sorgu] [kare=0]
import fs from 'node:fs'
import { BASE, launch, waitReady } from './qa-lib.mjs'
const pre = process.argv[2] || '/tmp/asci/loco/dr'
const sprint = process.argv[3] === '1'
const SEC = Number(process.argv[4] || 6)
const extra = process.argv[5] || 'locoball=1'
const SHOTS = Number(process.argv[6] || 0)
const CAP = process.argv[7] === '1'
const NOBALL = process.argv[8] === '1'
const { b, p, logs } = await launch({ w: 1280, h: 720 })
await p.goto(`${BASE}?mode=mac&${extra}`)
await waitReady(p)
if (CAP) await p.evaluate(() => (window.__drCap = true))
await p.waitForTimeout(1500)
for (let i = 0; i < 60 && (await p.evaluate(() => window.__game.match.phase)) !== 'play'; i++) await p.waitForTimeout(500)
const info = await p.evaluate(([spr, NB]) => {
  window.__locoDbg = {}
  const L = window.__loco, S = window.__shot
  const { game, setControlled } = L
  const world = S.world
  const P = game.players.find((q) => q.controlled) || game.players[2]
  setControlled(P.id)
  world.timeScale = 1
  P.x = -20; P.z = 0; P.facing = Math.PI / 2; P.vx = 0; P.vz = 0
  if (!NB) world.placeBall ? world.placeBall(-19.6, 0) : S.placeBall(-19.6, 0)
  else { if (world.placeBall) world.placeBall(12, 6); else S.placeBall(12, 6); P.hasBall = false }
  const scene = window.__r3f.scene
  let sk = null
  const wp = (bone) => { bone.updateWorldMatrix(true, false); const e = bone.matrixWorld.elements; return [e[12], e[13], e[14]] }
  const all = []
  scene.traverse((o) => { if (o.isBone && o.name === 'pelvis') all.push(o) })
  const R = (window.__dr = { rows: [], ev: [], caps: [] })
  game.on((e) => { if (e.type === 'touch' && e.player === P.id) R.ev.push({ t: performance.now(), kind: e.kind }) })
  const t0 = performance.now()
  const find = (root, n) => { let r = null; root.traverse((x) => { if (!r && x.isBone && x.name === n) r = x }); return r }
  const loop = () => {
    requestAnimationFrame(loop)
    if (!P.controlled) setControlled(P.id)
    // diger oyuncular uzakta (kamerayi ve topu kapatmasinlar)
    if (window.__drClear !== false) for (const q of game.players) if (q !== P) { q.x = P.x - 12 - q.id * 1.5; q.z = 12; q.vx = q.vz = 0 }
    if (!sk || R.rows.length % 10 === 0) {
      let bd = 1e9
      sk = null
      for (const pel of all) { const q = wp(pel); const d = (q[0] - P.x) ** 2 + (q[2] - P.z) ** 2; if (d < bd) { bd = d; sk = { pel, fr: find(pel.parent, 'foot_r'), tr: find(pel.parent, 'ball_r'), fl: find(pel.parent, 'foot_l'), tl: find(pel.parent, 'ball_l') } } }
    }
    const A = wp(sk.fr), T = wp(sk.tr), AL = wp(sk.fl), TL = wp(sk.tl), PL = wp(sk.pel)
    const bl = world.ball
    const mid = [(A[0] + T[0]) / 2, (A[1] + T[1]) / 2, (A[2] + T[2]) / 2]
    const dR = Math.hypot(mid[0] - bl.x, mid[1] - bl.y, mid[2] - bl.z) - 0.11
    const midL = [(AL[0] + TL[0]) / 2, (AL[1] + TL[1]) / 2, (AL[2] + TL[2]) / 2]
    const dL = Math.hypot(midL[0] - bl.x, midL[1] - bl.y, midL[2] - bl.z) - 0.11
    const dbg = window.__locoDbg[sk.pel.uuid] || {}
    R.rows.push({ t: +(performance.now() - t0).toFixed(1), anim: P.anim, hb: P.hasBall ? 1 : 0, v: +Math.hypot(P.vx, P.vz).toFixed(2), bz: +(bl.x - P.x).toFixed(3), bx: +(bl.z - P.z).toFixed(3), by: +bl.y.toFixed(3), dR: +(dR * 100).toFixed(1), dL: +(dL * 100).toFixed(1), ay: +A[1].toFixed(3), ty: +T[1].toFixed(3), tx: +T[0].toFixed(3), tz: +T[2].toFixed(3), tly: +TL[1].toFixed(3), tlx: +TL[0].toFixed(3), tlz: +TL[2].toFixed(3), ax: +A[0].toFixed(3), az: +A[2].toFixed(3), aly: +AL[1].toFixed(3), alx: +AL[0].toFixed(3), alz: +AL[2].toFixed(3), tR: dbg.tR, tW: dbg.touchW, w: dbg.w, bm: dbg.bm, mix: dbg.mix, ph: dbg.ph, lL: dbg.lockL ? 1 : 0, lR: dbg.lockR ? 1 : 0 })
    if (R.ev.length && R.ev[R.ev.length - 1].row === undefined) R.ev[R.ev.length - 1].row = R.rows.length - 1
    // yakin yan kamera kareleri (kendi kameramizla ayri cizim): 2.2 s'den sonra 0.7 s boyunca her kare
    const tt = performance.now() - t0
    if (window.__drCap && tt > 2200 && tt < 2900 && R.caps.length < 45) {
      const g = window.__r3f.gl
      const W3 = 400, H3 = 360
      const cam = (window.__drCam ??= new window.__r3f.camera.constructor(28, W3 / H3, 0.1, 100))
      const rt = (window.__drRT ??= new (window.__RT ??= (() => { let C = null; scene.traverse((o) => { if (!C && o.shadow && o.shadow.map) C = o.shadow.map.constructor }); return C })())(W3, H3))
      cam.position.set(PL[0] + 0.3, 0.75, PL[2] + 4.2)
      cam.lookAt(PL[0] + 0.3, 0.5, PL[2])
      const old = g.getRenderTarget()
      g.setRenderTarget(rt)
      g.setClearColor(0x88aacc, 1)
      g.clear(true, true, true)
      g.render(scene, cam)
      const buf = new Uint8Array(W3 * H3 * 4)
      g.readRenderTargetPixels(rt, 0, 0, W3, H3, buf)
      g.setRenderTarget(old)
      R.caps.push({ t: tt, row: R.rows.length - 1, w: W3, h: H3, px: Array.from(buf) })
    }
  }
  requestAnimationFrame(loop)
  return { id: P.id, nsk: all.length }
}, [sprint, NOBALL])
// klavye: kamera gore +x dunya yonu (qa-lib HumanBot.dirKeys ile ayni)
const cf = await p.evaluate(() => { const c = window.__r3f.camera; const f = c.getWorldDirection(new c.position.constructor()); return [f.x, f.z] })
{
  const fl = Math.hypot(cf[0], cf[1]) || 1, fx = cf[0] / fl, fz = cf[1] / fl
  const iy = fx, ix = -fz
  const ks = []
  if (iy > 0.38) ks.push('w'); if (iy < -0.38) ks.push('s'); if (ix > 0.38) ks.push('d'); if (ix < -0.38) ks.push('a')
  if (sprint) ks.push('Shift')
  for (const k of ks) await p.keyboard.down(k)
  console.log('tuslar', ks.join('+'))
}
const shots = []
if (SHOTS) {
  await p.waitForTimeout(2500)
  for (let i = 0; i < SHOTS; i++) { const f = `${pre}_k${String(i).padStart(2, '0')}.png`; await p.screenshot({ path: f }); shots.push(f) }
}
await p.waitForTimeout(SEC * 1000)
const R = await p.evaluate(() => window.__dr)
for (const [i, c] of R.caps.entries()) {
  // RGBA ham (alt satirdan) -> PPM (ust satirdan), sonra convert ile PNG
  const hdr = Buffer.from(`P6 ${c.w} ${c.h} 255\n`)
  const body = Buffer.alloc(c.w * c.h * 3)
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { const si = ((c.h - 1 - y) * c.w + x) * 4, di = (y * c.w + x) * 3; body[di] = c.px[si]; body[di + 1] = c.px[si + 1]; body[di + 2] = c.px[si + 2] }
  fs.writeFileSync(`${pre}_c${String(i).padStart(2, '0')}.ppm`, Buffer.concat([hdr, body]))
  delete c.px
}
fs.writeFileSync(`${pre}.json`, JSON.stringify(R))
// ozet: dokunus anindaki mesafe (olay karesi)
const evs = R.ev.filter((e) => e.kind === 'dribble' && e.row !== undefined)
const at = evs.map((e) => R.rows[e.row])
const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null)
console.log(JSON.stringify({ info, dokunus: evs.length, dR_cm: at.map((r) => r.dR), tR: at.map((r) => r.tR && +r.tR.toFixed(3)), tW: at.map((r) => r.tW && +r.tW.toFixed(2)), v: at.map((r) => r.v), anim: [...new Set(R.rows.map((r) => r.anim))], medDR: med(at.map((r) => r.dR)), oncekiMinDR: evs.map((e) => Math.min(...R.rows.slice(Math.max(0, e.row - 9), e.row).filter((r) => r.t > R.rows[e.row].t - 150).map((r) => r.dR))), hata: logs.slice(0, 3), shots: shots.length }))
await b.close()
