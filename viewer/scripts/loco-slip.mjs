// Lokomosyon ajani: basan ayak kaymasi analizi (loco-dribble.mjs ciktisi). Basma: bilek y < 0.11 m (dinlenme bilegi 0.072-0.08 + ~3.5 cm),
// en az 3 ardisik kare; kayma = basma boyunca bilegin yatay yolu (cm). Kullanim: node scripts/loco-slip.mjs <x.json> [anim-filtre]
import fs from 'node:fs'
const R = JSON.parse(fs.readFileSync(process.argv[2]))
const filt = process.argv[3] ? new RegExp(process.argv[3]) : null
const rows = R.rows.filter((r) => (!filt || filt.test(r.anim)) && (r.w ?? 0) > 0.95)
const out = {}
for (const [k, X, Y, Z, TX, TY, TZ] of [['sag', 'ax', 'ay', 'az', 'tx', 'ty', 'tz'], ['sol', 'alx', 'aly', 'alz', 'tlx', 'tly', 'tlz']]) {
  const ymin = Math.min(...rows.map((r) => r[Y]))
  const segs = []
  let cur = null
  let prevT = -1
  for (const r of R.rows) {
    // temas: bilek < 0.10 m (duz basis) ya da parmak eklemi < 0.035 m (parmak ucunda kosu); kayma o noktanin yatay yolu
    const heel = r[Y] < 0.1
    const toe = r[TY] !== undefined && r[TY] < 0.035
    const ok = (!filt || filt.test(r.anim)) && (r.w ?? 0) > 0.95 && (heel || toe) && r.t - prevT < 40
    const px = toe && !heel ? r[TX] : r[X]
    const pz = toe && !heel ? r[TZ] : r[Z]
    prevT = r.t
    if (ok) {
      if (cur) cur.path += Math.hypot(px - cur.lx, pz - cur.lz), cur.n++
      else cur = { path: 0, n: 1, v: r.v }
      cur.lx = px; cur.lz = pz
    } else if (cur) {
      if (cur.n >= 3) segs.push({ cm: +(cur.path * 100).toFixed(2), n: cur.n, v: cur.v })
      cur = null
    }
  }
  const cm = segs.map((s) => s.cm).sort((a, b) => a - b)
  out[k] = { ymin: +ymin.toFixed(3), basma: segs.length, medCm: cm[Math.floor(cm.length / 2)], p90Cm: cm[Math.floor(cm.length * 0.9)], maxCm: cm[cm.length - 1], ornek: segs.slice(0, 8) }
}
console.log(JSON.stringify(out))
