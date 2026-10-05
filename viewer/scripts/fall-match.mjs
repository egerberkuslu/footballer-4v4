// Gercek mac sayfasinda dusme/kalkis katmani.
//  A) zorla dusme: bir oyuncuya simulasyonun faul sonucu verdigi durumu yazar (anim='fall', actionLock=fall+getup), her
//     karede bas/pelvis/el dunya konumu ve derili mesh en alt noktasi kaydedilir -> pop (kare arasi sicrama) ve penetrasyon.
//  B) gercek faul: kontrol edilen oyuncu top sahibine arkadan kayar (E E), tum oyuncularda 'fall' sayilir.
// Kullanim: scripts/run-browser.sh node scripts/fall-match.mjs /tmp/asci/fall/mac [denemeSayisi]
import { chromium } from 'playwright'
const pre = process.argv[2] || '/tmp/asci/fall/mac'
const tries = Number(process.argv[3] ?? 6)
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 960, height: 540 } })
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:5173/?mode=mac', { timeout: 180000 })
await p.waitForTimeout(9000)

// --- A: zorla dusme, kare kare kayit ---
const A = await p.evaluate(async () => {
  const { game } = window.__loco
  const scene = window.__r3f?.scene
  const P = game.players.find((q) => q.role !== 'kaleci' && !q.hasBall && !q.controlled) ?? game.players[2]
  // oyuncunun iskeleti: ayakta, en yakin 'pelvis' kemigi
  const V = (x, y, z) => ({ x, y, z })
  let pel = null, bd = 1e9
  const tmp = { x: 0, y: 0, z: 0 }
  const wp = (o) => { o.updateWorldMatrix(true, false); const e = o.matrixWorld.elements; return V(e[12], e[13], e[14]) }
  let skm = null
  scene.traverse((o) => { if (o.isSkinnedMesh && o.visible) { const pb = o.skeleton.bones.find((x) => x.name === 'pelvis'); if (!pb) return; const w = wp(pb); const d = Math.hypot(w.x - P.x, w.z - P.z); if (d < bd) (bd = d), (pel = pb), (skm = o) } })
  if (!pel) return { yok: 'pelvis yok' }
  let root = pel; while (root.parent && !root.parent.isScene) root = root.parent
  const find = (n) => skm.skeleton.bones.find((x) => x.name === n)
  const bones = { head: find('head'), pelvis: pel, hand_l: find('hand_l'), foot_r: find('foot_r') }
  const meshes = []; scene.traverse((o) => { if (o.isSkinnedMesh && o.skeleton.bones.includes(pel)) meshes.push(o) })
  const v3 = new (pel.position.constructor)()
  const minY = () => { let m = 1e9; for (const o of meshes) { if (!o.visible) continue; const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i += 11) { o.getVertexPosition(i, v3); v3.applyMatrix4(o.matrixWorld); if (v3.y < m) m = v3.y } } return m }
  const rec = []
  P.anim = 'fall'; P.animT = 0; P.actionLock = 2.1
  const t0 = performance.now()
  await new Promise((res) => {
    const step = () => {
      const r = { t: performance.now() - t0, lf: window.__layers?.fall?.frames, lock: P.actionLock.toFixed(2), anim: P.anim, animT: P.animT, x: P.x, z: P.z, minY: 0 }
      r.minY = (rec.length % 4 === 0) ? minY() : 9
      for (const k in bones) r[k] = wp(bones[k])
      rec.push(r)
      if (performance.now() - t0 < 60000 && (P.anim === 'fall' || P.anim === 'getup' || performance.now() - t0 < 600 || rec.filter((q) => q.anim !== 'fall' && q.anim !== 'getup').length < 8)) requestAnimationFrame(step); else res()
    }
    requestAnimationFrame(step)
  })
  return { id: P.id, dist0: bd, n: rec.length, rec, layers: window.__layers }
})
if (A.yok) { console.log(A); process.exit(1) }
// pop: bir kemigin kok-goreli kare arasi yer degisimi, komsu karelerin medyaninin 4 katindan ve 6 cm'den buyukse
const rel = (r, k) => ({ x: r[k].x - r.x, y: r[k].y, z: r[k].z - r.z })
const pops = []
let maxStep = {}
for (const k of ['head', 'pelvis', 'hand_l', 'foot_r']) {
  const d = []
  for (let i = 1; i < A.rec.length; i++) { const a = rel(A.rec[i - 1], k), c = rel(A.rec[i], k); const dg = A.rec[i].anim === A.rec[i - 1].anim ? A.rec[i].animT - A.rec[i - 1].animT : A.rec[i].animT + 0.02
    d.push(Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z) / Math.max(0.01, dg)) }
  for (let i = 3; i < d.length - 3; i++) {
    const nb = [d[i - 3], d[i - 2], d[i - 1], d[i + 1], d[i + 2], d[i + 3]].sort((u, v) => u - v)
    const med = (nb[2] + nb[3]) / 2
    if (d[i] > 1.5 && d[i] > 3 * med) pops.push(`${k}@${A.rec[i + 1].anim}:${A.rec[i + 1].animT.toFixed(2)} ${d[i].toFixed(2)} m/s (komsu medyan ${med.toFixed(2)})`)
  }
  maxStep[k] = Math.max(...d).toFixed(2) + ' m/s (oyun zamani)'
}
const seq = []; for (const r of A.rec) if (!seq.length || seq[seq.length - 1][0] !== r.anim) seq.push([r.anim, Math.round(r.t)])
const lying = A.rec.filter((r) => r.pelvis.y < 0.3)
const pen = Math.min(...A.rec.map((r) => r.minY))
console.log('kare hizi ~', (A.n / 3.6).toFixed(1), 'fps')
const penLie = lying.length ? Math.min(...lying.map((r) => r.minY)) : null
const slideEnd = A.rec[A.rec.length - 1]
const s = A.rec.find((r) => r.anim !== 'fall' && r.anim !== 'getup' && r.t > 2000)
const resA = { oyuncu: A.id, kare: A.n, animSirasi: seq.map((x) => x.join('@') + 'ms').join(' > '), popSayisi: pops.length, poplar: pops.slice(0, 12), enBuyukAdim: maxStep,
  minMeshY_cm: (pen * 100).toFixed(1), yatarkenMinMeshY_cm: penLie === null ? null : (penLie * 100).toFixed(1), yatanKare: lying.length,
  kalkisSonuPelvisKokFarki_cm: s ? (Math.hypot(s.pelvis.x - s.x, s.pelvis.z - s.z) * 100).toFixed(1) : null, katman: A.layers?.fall }
console.log('A', JSON.stringify(resA, null, 1))
console.log('izler', A.rec.filter((r, i) => i % 2 === 0).map((r) => `${r.anim}:${r.animT.toFixed(2)}:py${r.pelvis.y.toFixed(2)}:lf${r.lf}:d${Math.hypot(r.pelvis.x - r.x, r.pelvis.z - r.z).toFixed(2)}`).join(' '))

// --- B: gercek faul denemeleri ---
const f0 = await p.evaluate(() => window.__layers?.fall?.frames ?? 0)
const falls = []
for (let k = 0; k < tries; k++) {
  const r = await p.evaluate(async () => {
    const { game, setControlled } = window.__loco
    const W = window.__shot.world
    W.timeScale = 1
    const own = game.players.find((q) => q.hasBall)
    if (!own) return { yok: 'top sahibi yok' }
    const D = game.players.filter((q) => q.team !== own.team && q.role !== 'kaleci').sort((a, c) => Math.hypot(a.x - own.x, a.z - own.z) - Math.hypot(c.x - own.x, c.z - own.z))[0]
    setControlled(D.id)
    // savunmaciyi top sahibinin 1.6 m arkasina, ona bakar sekilde koy
    const fx = Math.sin(own.facing), fz = Math.cos(own.facing)
    D.x = own.x - fx * 1.6; D.z = own.z - fz * 1.6; D.facing = own.facing; D.vx = fx * 6; D.vz = fz * 6
    window.__fh = []
    const iv = setInterval(() => { for (const q of game.players) if (q.anim === 'fall' && !window.__fh.includes(q.id)) window.__fh.push(q.id) }, 10)
    window.__fiv = iv
    return { D: D.id, own: own.id }
  })
  if (r.yok) { await p.waitForTimeout(1500); continue }
  await p.keyboard.press('e'); await p.waitForTimeout(60); await p.keyboard.press('e')
  await p.waitForTimeout(450)
  if (k === 0) await p.screenshot({ path: `${pre}_faul_${k}.png` })
  await p.waitForTimeout(2600)
  const fh = await p.evaluate(() => { clearInterval(window.__fiv); return window.__fh })
  falls.push({ deneme: k, ...r, dusenler: fh })
}
const f1 = await p.evaluate(() => window.__layers?.fall?.frames ?? 0)
console.log('B', JSON.stringify({ denemeler: falls, dusmeOlanDeneme: falls.filter((f) => f.dusenler?.length).length, katmanKareArtisi: f1 - f0 }))
console.log('hata:', errs.length ? errs.slice(0, 3) : 'yok')
await b.close()
