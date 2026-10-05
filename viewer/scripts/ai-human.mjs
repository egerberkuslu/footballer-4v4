// Bassiz "insan taklidi" maci: ev takimi (0) basit bir insan suruculu, kalani AI.
// Zorluk hissini ve insana destegi olcer. npx -y tsx scripts/ai-human.mjs [devre_sn=120] [tohum=1] [seviye=orta]
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { BALL_R, PITCH_L } from '../src/pitch.ts'
import { Rules } from '../src/rules/engine.ts'
import { updateAI, resetAI, passHints, hintDbg, humanReceiver } from '../src/ai/brain.ts'
import { seedAI, setAiLevel } from '../src/ai/config.ts'
import { stepLocomotion } from '../src/control/locomotion.ts'

globalThis.NOCHECK = !!process.env.NOCHECK
const HALF = Number(process.argv[2] ?? 120)
const SEED = Number(process.argv[3] ?? 1)
const LEVEL = process.argv[4] ?? 'orta'
const DT = 1 / 60
const HL = PITCH_L / 2
let s = SEED
Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
seedAI(SEED)
setAiLevel(LEVEL)
world.seed(SEED)
resetAI()
game.humanTeam = 0
const rules = new Rules({ game, ball: () => world.ball, placeBall: (x, z) => world.placeBall(x, z), kick: (v, w) => world.kick(v, w), halfLength: HALF })
rules.start?.()

const H = 0
const st = { hShots: 0, hGoals: 0, aGoals: 0, hPass: 0, hPassOk: 0, aiShotsOnH: 0, hLost: 0, hintN: 0, hintT: 0, dbl: 0, pressFrames: 0, aiPressWhenFree: 0, freeFrames: 0, saves: 0, oppShots: 0, recvRun: 0, recvChk: 0, hint1: 0, dblSame: 0, sameChk: 0 }
let t = 0
let cool = 0
let switchT = 0
let pend = null // insan pasi: { t }
const ctrl = () => game.players.find((p) => p.controlled)
function setCtrl(id) {
  for (const p of game.players) if (p.team === H) p.controlled = p.id === id
}
setCtrl(3)
game.on((e) => {
  if (process.env.FOULS && (e.type === 'foul' || e.type === 'card')) { const q = game.players[e.by ?? e.player]; console.log(t.toFixed(0), e.type, e.color ?? '', q.team + q.role, q.controlled ? 'INSAN' : '', e.on !== undefined ? 'on ' + game.players[e.on].team + game.players[e.on].role : '', q.anim) }
  if (e.type === 'goal') e.team === H ? st.hGoals++ : st.aGoals++
  if (e.type === 'touch') {
    const p = game.players[e.player]
    if (e.kind === 'shoot') p.team === H && p.controlled ? st.hShots++ : p.team !== H && st.oppShots++
    if ((e.kind === 'pass' || e.kind === 'lob') && p.controlled) {
      st.hPass++
      pend = { t }
    }
    if (e.kind === 'save' && p.team !== H) st.saves++
  }
})

function drive() {
  driveRaw()
  const p = ctrl()
  if (!p || game.match.phase !== 'play') return
  const inp = game.inputs[p.id]
  if (inp.jockey) return
  // insan gibi cevresinden dolanma: yakin rakipten (<2,2 m) uzaklasan bilesen, yakinda sprint yok
  let ax = 0
  let az = 0
  for (const o of game.players) {
    if (o.team === H || o.sentOff) continue
    const dx = p.x - o.x
    const dz = p.z - o.z
    const d = Math.hypot(dx, dz)
    if (d < 2.2 && d > 1e-3) {
      const k = (2.2 - d) / 2.2
      ax += (dx / d) * k * 1.4
      az += (dz / d) * k * 1.4
      if (d < 2) inp.sprint = false
    }
  }
  if (ax || az) {
    const mx = inp.move.x + ax
    const mz = inp.move.z + az
    const l = Math.hypot(mx, mz) || 1
    const m0 = Math.min(1, Math.hypot(inp.move.x, inp.move.z) + 0.2)
    inp.move.x = (mx / l) * m0
    inp.move.z = (mz / l) * m0
  }
}
function driveRaw() {
  const m = game.match
  // otomatik kontrol gecisi (F'nin MatchControl'u gibi): topu alan takim oyuncusu; yoksa topa en yakin
  const own = game.players.find((p) => p.team === H && p.hasBall && p.role !== 'kaleci')
  if (process.env.NOSWITCH) { /* kontrol gecisi yok: sabit oyuncu */ }
  else if (own && !own.controlled) setCtrl(own.id)
  else if (!own && t > switchT && m.phase === 'play') {
    switchT = t + 0.6
    let best = null
    let bd = 1e9
    for (const p of game.players) {
      if (p.team !== H || p.role === 'kaleci' || p.sentOff) continue
      const d = Math.hypot(p.x - world.ball.x, p.z - world.ball.z)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    if (best && !(ctrl()?.hasBall)) setCtrl(best.id)
  }
  if (m.phase !== 'play' && m.restart?.taker !== undefined && game.players[m.restart.taker].team === H) setCtrl(m.restart.taker)
  const p = ctrl()
  if (!p) return
  const inp = game.inputs[p.id]
  inp.action = null
  inp.sprint = false
  inp.jockey = false
  const b = world.ball
  const dir = m.attackDir[H]
  if (m.phase !== 'play') {
    // duran top: taker ise topa yuru; 1 s sonra penaltida sut, digerlerinde en yakin arkadasa pas
    inp.move.x = inp.move.z = 0
    if (m.restart?.taker !== p.id) return
    const bd = Math.hypot(b.x - p.x, b.z - p.z)
    if (bd > 0.9) {
      inp.move.x = ((b.x - p.x) / bd) * 0.5
      inp.move.z = ((b.z - p.z) / bd) * 0.5
      return
    }
    if (t > cool) {
      if (m.restart.type === 'penalty') inp.action = { type: 'shoot', power: 0.7, aim: { x: dir * HL, y: 0.5, z: Math.random() < 0.5 ? -1.8 : 1.8 } }
      else {
        const mate = game.players.filter((q) => q.team === H && q !== p && q.role !== 'kaleci').sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0]
        if (mate) inp.action = { type: 'pass', power: 0, aim: { x: mate.x, y: 0, z: mate.z } }
      }
      cool = t + 1
    }
    return
  }
  if (p.hasBall) {
    st.hintT++
    st.hintN += passHints.length
    if (passHints.length) st.hint1++
    if (!p.hadBallT) p.hadBallT = t
    if (process.env.DIAG) {
      const opps = game.players.filter((o) => o.team !== H && !o.sentOff && o.role !== 'kaleci')
      const dn = (q) => Math.min(...opps.map((o) => Math.hypot(o.x - q.x, o.z - q.z)))
      globalThis.dg ??= { n: 0, c: 0, md: 0, mo: 0, k: 0, lane: 0 }
      const D = globalThis.dg
      D.n++; D.c += dn(p)
      for (const q of game.players.filter((q) => q.team === H && q !== p && q.role !== 'kaleci')) { D.k++; D.md += Math.hypot(q.x - p.x, q.z - p.z); D.mo += dn(q) }
    }
    const gx = dir * HL
    const dg = Math.hypot(gx - p.x, p.z)
    // insan gibi surme: kaleye dogru, onundeki savunmaciyi yandan dolasarak; yakinda rakip yoksa kosu
    let mx = gx - p.x
    let mz = -p.z * 0.5
    let block = false
    let near = 99
    for (const o of game.players) {
      if (o.team === H || o.sentOff) continue
      const d = Math.hypot(o.x - p.x, o.z - p.z)
      near = Math.min(near, d)
      if (d < 3 && (o.x - p.x) * dir > -0.3 && o.role !== 'kaleci') {
        block = true
        // yandan dolas: rakibin bulundugu tarafin tersine
        const side = (o.z - p.z) * 1 > 0 ? -1 : 1
        mz += side * 3.0 * (3 - d)
      }
    }
    const ml = Math.hypot(mx, mz) || 1
    inp.move.x = mx / ml
    inp.move.z = mz / ml
    inp.sprint = near > 4.5
    if (near < 1.6) { inp.move.x *= 0.6; inp.move.z *= 0.6 }
    if (dg < 13 && t > cool) {
      const k = game.players.find((o) => o.team !== H && o.role === 'kaleci')
      const z = k && k.z > 0 ? -1.9 : 1.9
      inp.action = { type: 'shoot', power: 0.75, aim: { x: gx, y: 0.6, z } }
      cool = t + 1
    } else if (passHints.length && t > cool && ((block && near < 3) || t - p.hadBallT > 3.0)) {
      // sikisinca ya da uzun sure surunce acik arkadasa pas
      const h = passHints.slice().sort((a, c) => c.q - a.q)[0]
      const q = game.players[h.id]
      inp.action = { type: 'pass', power: 0, aim: { x: q.x + q.vx * 0.4, y: 0, z: q.z + q.vz * 0.4 } }
      cool = t + 0.8
    }
    return
  }
  p.hadBallT = 0
  // topsuz
  const carrier = game.players.find((o) => o.hasBall)
  const dx = b.x - p.x
  const dz = b.z - p.z
  const d = Math.hypot(dx, dz) || 1
  if (carrier && carrier.team !== H) {
    // savunma: yaklas, yakinda jockey (E), top acilinca mudahale
    const cd = Math.hypot(carrier.x - p.x, carrier.z - p.z)
    if (process.env.NOSWITCH && cd > 9) { inp.move.x = 0; inp.move.z = 0; inp.sprint = false; return }
    inp.move.x = (carrier.x - p.x) / (cd || 1)
    inp.move.z = (carrier.z - p.z) / (cd || 1)
    inp.sprint = cd > 5
    if (cd < 1.8 && !(inp.jockey)) { inp.move.x = 0; inp.move.z = 0 }
    inp.jockey = cd < 2.8 && cd > 1
    const front = (p.x - carrier.x) * Math.sin(carrier.facing) + (p.z - carrier.z) * Math.cos(carrier.facing) > 0.3 * cd
    const exposed = Math.hypot(carrier.x - b.x, carrier.z - b.z) > 0.7
    if (d < 1.0 && front && exposed && t > cool && p.actionLock <= 0 && carrier.role !== 'kaleci') {
      inp.action = { type: 'tackle', power: 0.6, aim: { x: b.x, y: 0, z: b.z } }
      cool = t + 1.5
    }
    return
  }
  inp.jockey = false
  inp.move.x = dx / d
  inp.move.z = dz / d
  inp.sprint = d > 5
}

let prevOwnerTeam = -1
const MAXF = Math.round((HALF * 2 * 2.5 + 60) / DT)
for (let f = 0; f < MAXF && game.match.phase !== 'fulltime'; f++) {
  t += DT
  drive()
  updateAI(DT)
  rules.pre(DT)
  stepLocomotion(DT)
  world.side = world.ball.x >= 0 ? 1 : -1
  world.step(DT)
  rules.post(DT)
  const m = game.match
  if (m.phase !== 'play') continue
  const owner = game.players.find((p) => p.hasBall)
  // insan pasi sonucu
  if (pend && owner && owner !== ctrl()) {
    if (owner.team === H) st.hPassOk++
    pend = null
  } else if (pend && t - pend.t > 5) pend = null
  // insan kaybi
  if (owner && prevOwnerTeam === H && owner.team !== H) st.hLost++
  if (owner) prevOwnerTeam = owner.team
  // savunma: insan baskida mi, AI ikinci adam mi
  if (owner && owner.team !== H) {
    const h = ctrl()
    const dh = h ? Math.hypot(h.x - owner.x, h.z - owner.z) : 99
    const ais = game.players.filter((q) => q.team === H && !q.controlled && q.role !== 'kaleci')
    const near = ais.filter((q) => Math.hypot(q.x - owner.x, q.z - owner.z) < 2.5).length
    if (dh > 3) { const near2 = ais.filter((q) => Math.hypot(q.x - owner.x, q.z - owner.z) < 3.5 && Math.hypot(q.vx, q.vz) > 1); st.sameChk++; if (near2.length > 1 || (near2.length && dh < 6)) st.dblSame++ }
    if (dh < 3) {
      st.pressFrames++
      if (near > 0) st.dbl++
    } else if (dh > 8) {
      st.freeFrames++
      if (ais.some((q) => Math.hypot(q.x - owner.x, q.z - owner.z) < 4)) st.aiPressWhenFree++
    }
  }
  // insan pasindan sonra AI alicisi topa kosuyor mu (0.2-0.6 s): hizinin topa dogru bileseni
  if (pend && t - pend.t > 0.2 && t - pend.t < 0.6 && humanReceiver.id >= 0) {
    const r = game.players[humanReceiver.id]
    const b = world.ball
    const d = Math.hypot(r.x - b.x, r.z - b.z) || 1
    st.recvChk++
    if ((r.vx * (b.x - r.x) + r.vz * (b.z - r.z)) / d > 1.5 || d < 1.2) st.recvRun++
  }
}
const pct = (a, b) => (b ? `%${((100 * a) / b).toFixed(0)}` : '-')
console.log(`insan taklidi: 2x${HALF}s tohum ${SEED} seviye ${LEVEL}: skor insan ${game.match.score[0]} - ${game.match.score[1]} AI`)
console.log(`  insan sut ${st.hShots}, rakip sut ${st.oppShots}, rakip kaleci kurtaris/dokunus ${st.saves}; insan top kaybi ${st.hLost}`)
console.log(`  insan pasi ${st.hPass}, AI arkadasa ulasan ${pct(st.hPassOk, st.hPass)}; pas sonrasi alici topa kosuyor ${pct(st.recvRun, st.recvChk)}`)
console.log(`  kirmizi kart ${game.players.filter((p) => p.sentOff).map((p) => p.team + p.role).join(",")} sari ${game.players.filter((p) => p.yellow).length}`)
console.log(`  insan topla kare ${st.hintT}`)
console.log(`  top insandayken ort acik pas secenegi ${(st.hintN / (st.hintT || 1)).toFixed(2)} (en az 1 secenekli kare ${pct(st.hint1, st.hintT)})`)
console.log(`  baskida degilken (>8 m) 4 m icinde AI ${pct(st.aiPressWhenFree, st.freeFrames)} (kare ${st.freeFrames}); ayni oyuncuya cift gidis ${pct(st.dblSame, st.sameChk)}`)
console.log(`  insan baskidayken (3 m) 2.5 m icinde AI arkadas da var ${pct(st.dbl, st.pressFrames)}`)
console.log(`  ipucu teshis: degerlendirme ${hintDbg.n}, ofsayt ${hintDbg.off}, ort marj ${(hintDbg.sum / (hintDbg.n || 1)).toFixed(2)} s, ort mesafe ${(hintDbg.d / (hintDbg.n || 1)).toFixed(1)} m; karar ${hintDbg.calls} yakin(<3m) ${hintDbg.close} uzak ${hintDbg.far}; karar basina acik secenek ${(st.hintN / (hintDbg.calls || 1)).toFixed(2)}`)

if (process.env.DIAG) { const D = globalThis.dg; console.log('DIAG tasiyici-rakip', (D.c / D.n).toFixed(1), 'arkadas-tasiyici', (D.md / D.k).toFixed(1), 'arkadas-rakip', (D.mo / D.k).toFixed(1)) }
