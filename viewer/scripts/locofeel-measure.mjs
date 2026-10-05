// locofeel: hiz basina sayisal lokomosyon imzasi (test sayfasi, yan profil). Kadans (adim/s, serbest oynatmadan), govde one egimi
// (pelvis->boyun, derece, devir ortalamasi), kol salinim genligi (el-omuz ileri bileseni tepe-tepe, cm), diz kaldirma (uyluk max one aci),
// dikey sekme (pelvis y tepe-tepe, cm). Kullanim: scripts/run-browser.sh node scripts/locofeel-measure.mjs <hiz,..> [ball=0|1]
import { launch } from './qa-lib.mjs'
const vs = (process.argv[2] || '1.5,3,5,6.2,8').split(',')
const ball = process.argv[3] || '0'
const extra = process.argv[4] ? '&' + process.argv[4] : ''
const { b, p } = await launch({ w: 800, h: 500 })
await p.addInitScript(() => (window.__locoDbg = {}))
const out = []
for (const v of vs) {
  await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=loco&v=${v}&anims=${ball === '1' ? 'dribble' : 'run'}&ball=${ball}&clips=1${extra}`)
  await p.waitForTimeout(5000)
  const cad = await p.evaluate(async () => {
    const g = () => Object.values(window.__locoDbg || {}).find((d) => d.ph !== undefined)
    const a = g(); const t0 = performance.now(); let acc = 0; let last = a.ph
    while (performance.now() - t0 < 2000) { await new Promise((r) => requestAnimationFrame(r)); const d = g(); acc += (((d.ph - last) % 1) + 1) % 1; last = d.ph }
    return { cad: (2 * acc) / ((performance.now() - t0) / 1000), dbg: g() }
  })
  const rows = []
  for (let i = 0; i < 24; i++) {
    await p.evaluate((ph) => (window.__locoPhase = ph), i / 24)
    await p.waitForTimeout(120)
    rows.push(await p.evaluate(() => {
      const sc = window.__r3f.scene; const P = {}
      for (const n of ['pelvis', 'neck_01', 'upperarm_l', 'hand_l', 'thigh_l', 'calf_l', 'thigh_r']) { const o = sc.getObjectByName(n); if (o) P[n] = o.getWorldPosition(new o.position.constructor()) }
      return Object.fromEntries(Object.entries(P).map(([k, q]) => [k, [q.x, q.y, q.z]]))
    }))
  }
  await p.evaluate(() => (window.__locoPhase = undefined))
  // ileri yon: kalca ekseni x yukari
  const r0 = rows[0]; const hx = [r0.thigh_r[0] - r0.thigh_l[0], r0.thigh_r[2] - r0.thigh_l[2]]
  let f = [hx[1], -hx[0]]; const fl = Math.hypot(...f); f = [f[0] / fl, f[1] / fl]
  const fw = (a, c) => (c[0] - a[0]) * f[0] + (c[2] - a[2]) * f[1]
  // isaret: el ileri salinimi pozitif olsun diye govde egimi ile ayni f kullanilir; egim isareti boyun pelvisin onundeyse +
  const pitch = rows.map((r) => (Math.atan2(fw(r.pelvis, r.neck_01), r.neck_01[1] - r.pelvis[1]) * 180) / Math.PI)
  const arm = rows.map((r) => fw(r.upperarm_l, r.hand_l))
  const thigh = rows.map((r) => (Math.atan2(fw(r.thigh_l, r.calf_l), r.thigh_l[1] - r.calf_l[1]) * 180) / Math.PI)
  const py = rows.map((r) => r.pelvis[1])
  const mean = (x) => x.reduce((s, y) => s + y, 0) / x.length
  const pp = (x) => Math.max(...x) - Math.min(...x)
  out.push({ v: +v, cad: +(cad.dbg.cad ?? 0).toFixed(2), mix: cad.dbg.mix, pitchDeg: +mean(pitch).toFixed(1), armPPcm: +(pp(arm) * 100).toFixed(1), kneeLiftDeg: +Math.max(...thigh).toFixed(1), bobCm: +(pp(py) * 100).toFixed(1) })
  console.log(JSON.stringify(out.at(-1)))
}
await b.close()
