// Kaleci dalis kinematigi + kurtarma orani: npx -y tsx scripts/keeper-dive-test.mjs [N=4000]
import { planDive, diveState, ROOT_MAX, V_ROOT_MAX, MAX_SIDE, MAX_HIGH } from '../src/sim/keeperDive.ts'
import { freeStep, newBall } from '../src/sim/ball.ts'
import { PITCH_L, GOAL_W, GOAL_H } from '../src/pitch.ts'

const N = Number(process.argv[2] ?? 4000)
const skillArg = process.argv[3] !== undefined ? Number(process.argv[3]) : 0.5
let seed = 12345
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
const sgn = 1
const DMIN = Number(process.env.DMIN ?? 6)
const DMAX = Number(process.env.DMAX ?? 26)
const KSP = Number(process.env.KSP ?? 5)
const gx = (sgn * PITCH_L) / 2
const kx0 = gx - 0.6
const GW = GOAL_W / 2
const b = newBall()
const bad = []
const rows = { all: { n: 0, save: 0 }, ai: { n: 0, save: 0 }, hum: { n: 0, save: 0 }, soft: { n: 0, save: 0 }, hard: { n: 0, save: 0 }, close: { n: 0, save: 0 }, catch: 0, parry: 0 }
function trial(kind) {
  let v, d, tz, ty
  if (kind === 'ai') {
    d = 8 + rnd() * 14
    v = Math.max(21, Math.min(31, 21 + d * 0.65))
    const err = 0.5 * (0.6 + d / 15)
    tz = (rnd() < 0.5 ? -1 : 1) * (GW - 0.32) + gauss() * err
    ty = Math.max(0.15, Math.min(GOAL_H + 0.6, (rnd() < 0.5 ? 0.35 : 0.9 + rnd() * 0.6) + gauss() * err * 0.6))
  } else {
    d = DMIN + rnd() * (DMAX - DMIN)
    v = 10 + rnd() * 24
    tz = (rnd() * 2 - 1) * 3
    ty = 0.15 + rnd() * 2.4
  }
  // cizgiye dogrudan kivrimsiz uc: hiz yonu hedefe, serbest ucus + dusme icin kaba duzeltme
  const sx = gx - d
  const T = d / (v * 0.95)
  const vy = (ty - 0.11 + 0.5 * 9.81 * T * T) / T
  Object.assign(b, { x: sx, y: 0.11, z: 0, vx: v * 0.95, vy, vz: tz / T, wx: 0, wy: (rnd() - 0.5) * 60, wz: 0 })
  // gecis (kaleci cizgisi): ilk ucus
  const ball0 = { ...b }
  const s2 = newBall()
  Object.assign(s2, ball0)
  let tc = 0, cz = 0, cy = 0
  for (let i = 0; i < 600; i++) { freeStep(s2, 1 / 120); tc += 1 / 120; if (s2.x >= kx0) { cz = s2.z; cy = s2.y; break } }
  if (Math.abs(cz) > GW || cy > GOAL_H || cy < 0) return // isabetsiz
  // kaleci konumu: tepki sonrasi 3.5 m/s ile hedefe yurur, dalis t0 = tc - 0.6
  const react = 0.22
  const tDive = Math.max(react, tc - 0.6)
  const kz = Math.sign(cz) * Math.min(Math.abs(cz), KSP * Math.max(0, tDive - react)) * (rnd() < 0.15 ? -1 : 1)
  // top t0 anindaki durumu
  const sb = newBall()
  Object.assign(sb, ball0)
  for (let i = 0; i < Math.round(tDive * 120); i++) freeStep(sb, 1 / 120)
  const spec = planDive({ id: 9, t0: tDive, kx: kx0, kz, facing: -sgn * Math.PI / 2, goalX: gx, ball: { ...sb }, skill: skillArg, rnd, shotDist: d })
  // kinematik tutarlilik
  let prev = diveState(spec, spec.t0), maxV = 0
  for (let t = spec.t0; t < spec.tUp; t += 1 / 60) {
    const st = diveState(spec, t)
    const sp = Math.hypot(st.x - prev.x, st.z - prev.z) * 60
    if (sp > maxV) maxV = sp
    if (!(st.y >= 0.27)) bad.push('pelvis < zemin ' + st.y)
    if (Number.isNaN(st.x + st.y + st.z)) bad.push('NaN')
    prev = st
  }
  if (maxV > V_ROOT_MAX + 0.3) bad.push('kok hizi ' + maxV.toFixed(2))
  if (spec.reach) {
    const hs = diveState(spec, spec.tc)
    const e = Math.hypot(hs.hand.x - spec.contact.x, hs.hand.y - spec.contact.y, hs.hand.z - spec.contact.z)
    if (spec.outcome !== 'miss' && e > 0.05) bad.push('el temas noktasinda degil ' + e.toFixed(2))
    const lat = Math.hypot(spec.contact.x - kx0, spec.contact.z - kz)
    if (lat > MAX_SIDE + 0.05 || spec.contact.y > MAX_HIGH + 0.01) bad.push('menzil asimi ' + lat.toFixed(2) + ' y ' + spec.contact.y.toFixed(2))
  }
  const saved = spec.outcome !== 'miss'
  if (!spec.reach) { (rows.unr ??= []).push({ v: +v.toFixed(0), d: +d.toFixed(0), tcross: +tc.toFixed(2), t0: +tDive.toFixed(2), cz: +cz.toFixed(1), cy: +cy.toFixed(1), kz: +kz.toFixed(1), flight: +(spec.tc - spec.t0).toFixed(2), kind }) }
  rows.reachN = (rows.reachN ?? 0) + (spec.reach ? 1 : 0)
  rows.pSum = (rows.pSum ?? 0) + spec.p
  rows.tot = (rows.tot ?? 0) + 1
  for (const k of ['all', kind, v < 20 ? 'soft' : v >= 28 ? 'hard' : null, d <= 6.5 ? 'close' : null]) {
    if (!k) continue
    rows[k].n++
    if (saved) rows[k].save++
  }
  if (spec.outcome === 'catch') rows.catch++
  if (spec.outcome === 'parry') rows.parry++
}
for (let i = 0; i < N; i++) trial(i % 2 ? 'ai' : 'hum')
const pct = (r) => (r.n ? (100 * r.save / r.n).toFixed(1) + '% (n ' + r.n + ')' : '-')
console.log('kurtarma orani: tum', pct(rows.all), '| ai-benzeri', pct(rows.ai), '| insan-benzeri', pct(rows.hum))
console.log('yumusak (<20 m/s)', pct(rows.soft), '| sert (>=28 m/s)', pct(rows.hard), '| yakin (<=6.5 m)', pct(rows.close))
console.log('menzilde', (100 * rows.reachN / rows.tot).toFixed(1) + '%', 'ort p', (rows.pSum / rows.tot).toFixed(3))
if (rows.unr) console.log('ilk 12 ulasilamayan', JSON.stringify(rows.unr.slice(0, 12)))
console.log('tutma', rows.catch, 'yumruk', rows.parry)
if (bad.length) { console.error('BASARISIZ:', [...new Set(bad)].slice(0, 8)); process.exit(1) }
console.log('kinematik tutarli')
