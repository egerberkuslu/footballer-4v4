// Bassiz AI-AI mac: npx -y tsx scripts/ai-match.mjs [devre_sn=150] [tohum=1] [seviye=orta]
// Render yok. Kare sirasi oyundaki gibi: AI(-25) -> kurallar on(-20) -> hareket(-15) -> world.step(-1) -> kurallar son(-0.5).
// Hareket: F'nin control/locomotion'u varsa o (MOCK=1 ile taklit zorlanir), yoksa src/ai/mockLocomotion taklidi.
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { BALL_R, GOAL_H, GOAL_W, PITCH_L } from '../src/pitch.ts'
import { Rules } from '../src/rules/engine.ts'
import { updateAI, aiStats, resetAI, aiFlags, aiDebug } from '../src/ai/brain.ts'
import { seedAI, setAiLevel } from '../src/ai/config.ts'
import { pred, predictBall, PRED_N } from '../src/ai/predict.ts'
import { freeStep, newBall } from '../src/sim/ball.ts'
import { stepMockLocomotion, mockStats, setMockRand } from '../src/ai/mockLocomotion.ts'

let lastContact = ''
const HALF = Number(process.argv[2] ?? 150)
const SEED = Number(process.argv[3] ?? 1)
const LEVEL = process.argv[4] ?? 'orta'
const DT = 1 / 60
const HL = PITCH_L / 2

let s = SEED
const rand = () => {
  s = (s * 16807) % 2147483647
  return s / 2147483647
}
Math.random = rand // kurallar/hareket icindeki rastgelelik de tekrar uretilebilir
seedAI(SEED)
// AI_OFF=duel,shield,touch ile davranis kapatilir (A/B)
for (const k of (process.env.AI_OFF ?? '').split(',').filter(Boolean)) aiFlags[k] = false
setAiLevel(LEVEL)
setMockRand(rand)
world.seed(SEED)
resetAI()
game.humanTeam = null
for (const p of game.players) p.controlled = false

function placeBall(x, z) {
  const b = world.ball
  b.x = b.px = x
  b.y = b.py = BALL_R
  b.z = b.pz = z
  b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0
}
function kick(v, w) {
  Object.assign(world.ball, { vx: v.x, vy: v.y, vz: v.z, wx: w.x, wy: w.y, wz: w.z })
}

// F'nin gercek locomotion'u varsa onu kullan
let stepLoco = stepMockLocomotion
let locoName = 'taklit'
if (!process.env.MOCK) {
  try {
    const m = await import('../src/control/locomotion.ts')
    m.setPlayMode?.('mac')
    const f = m.stepLocomotion ?? m.updateLocomotion
    if (typeof f === 'function') {
      stepLoco = (dt) => f(dt)
      locoName = 'F/locomotion'
    }
  } catch (e) {
    console.log('F/locomotion yuklenemedi, taklit kullaniliyor:', String(e).split('\n')[0])
  }
}

const rules = new Rules({
  game,
  ball: () => world.ball,
  placeBall: typeof world.placeBall === 'function' ? (x, z) => world.placeBall(x, z) : placeBall,
  kick: typeof world.kick === 'function' ? (v, w) => world.kick(v, w) : kick,
  halfLength: HALF,
})
rules.start?.()
if (process.env.DBG2) { const o = rules.measureOffside.bind(rules); rules.measureOffside = (p) => { console.log('olc', p.id, rules.mode); return o(p) } }

const st = {
  shots: [0, 0], onTarget: [0, 0], frame: [0, 0], passes: [0, 0], passOk: [0, 0], passBad: [0, 0], passInt: 0, passTimeout: 0,
  out: { side: 0, goal: 0 }, restarts: {}, fallback: 0, stuck: 0, unreach: 0, possT: [0, 0], shotD: [], passD: [],
  fouls: 0, cards: 0, outBy: {}, kickSent: 0, kickFail: {}, anims: {}, keeperHold: [], offside: 0, offTight: [0, 0], checks: 0, nearLine: 0, penalties: 0, goalsBy: {}, readyT: [],
}
let pendingPass = null
let pendingShot = null
let t = 0
const contacts = {}
let lastTouchEv = null
const kickPend = []
const prevAnim = []
const holdStart = [-1, -1, -1, -1, -1, -1, -1, -1]
game.on((e) => {
  if (e.type === 'offside') st.offside++
  if (e.type === 'offside-check') {
    st.checks++
    if (e.margin > 0) st.offTight[e.margin < 0.5 ? 0 : 1]++
    else if (e.margin > -1) st.nearLine++
  }
  if (e.type === 'contact') {
    lastContact = `${e.kind} i=${e.intensity.toFixed(2)} ${e.fromBehind?'arka ':''}${e.ballFirst?'topa':''}`
    const a = game.players[e.a]
    const k = `${e.kind}${e.fromBehind ? '-arka' : ''}${e.ballFirst ? '-topa' : ''}:${a.role}`
    contacts[k] = (contacts[k] ?? 0) + 1
    { const vb = game.players[e.b]; if (vb.role === 'kaleci' && vb.hasBall) contacts['KALECI-TUTARKEN-TEMAS'] = (contacts['KALECI-TUTARKEN-TEMAS'] ?? 0) + 1 }
    if (process.env.DBG) {
      const b = game.players[e.b]
      const f = (q) => `${q.id}${q.role[0]}${q.hasBall ? '*' : ''} v=(${q.vx.toFixed(1)},${q.vz.toFixed(1)}) in=(${game.inputs[q.id].move.x.toFixed(2)},${game.inputs[q.id].move.z.toFixed(2)}${game.inputs[q.id].sprint ? ' S' : ''})`
      const bd = Math.hypot(world.ball.x - a.x, world.ball.z - a.z)
      console.log('temas', t.toFixed(2), e.kind, 'i', e.intensity.toFixed(2), e.fromBehind ? 'arka' : '', e.ballFirst ? 'topa' : '', '|', f(a), '->', f(b), 'top-a', bd.toFixed(1), 'topv', Math.hypot(world.ball.vx, world.ball.vz).toFixed(1))
    }
  }
  if (e.type === 'touch' && (e.kind === 'pass' || e.kind === 'lob' || e.kind === 'shoot')) kickPend[e.player] = null
  if (e.type === 'touch' && e.kind === 'trap' && pendingPass && e.player === pendingPass.rid) pendingPass.trapRcv = true
  if (e.type === 'touch') lastTouchEv = { ...e, t, x: game.players[e.player].x, z: game.players[e.player].z, has: game.players[e.player].hasBall, bv: Math.hypot(world.ball.vx, world.ball.vz).toFixed(1) }
  if (e.type === 'out') {
    st.out[e.line]++
    const k = lastTouchEv ? `${e.line}:${lastTouchEv.kind}` : `${e.line}:?`
    st.outBy[k] = (st.outBy[k] ?? 0) + 1
    if (process.env.DBG && lastTouchEv) {
      const q = game.players[lastTouchEv.player]
      console.log(`out ${e.line} t=${t.toFixed(1)} son=${lastTouchEv.kind} ${q.id}${q.role} ${(t - lastTouchEv.t).toFixed(2)}s once, oyuncu=(${lastTouchEv.x.toFixed(1)},${lastTouchEv.z.toFixed(1)}) top=(${e.x.toFixed(1)},${e.z.toFixed(1)}) hasBall@touch=${lastTouchEv.has} topv@touch=${lastTouchEv.bv}`)
    }
  }
  else if (e.type === 'restart') st.restarts[e.restart.type] = (st.restarts[e.restart.type] ?? 0) + 1
  else if (e.type === 'foul') {
    st.fouls++
    if (e.penalty) st.penalties++
  } else if (e.type === 'card') { st.cards++; console.log('KART', e.color, e.player, lastContact) }
  else if (e.type === 'goal' && e.scorer !== null) {
    const r = game.players[e.scorer].role
    st.goalsBy[r] = (st.goalsBy[r] ?? 0) + 1
  }
})
// vuruslar: F'nin locomotion'u 'touch' olayi yayar (taklit de)
const onKick = (k) => {
  const ac = lastAct[k.by]
  if (k.type === 'pass' || k.type === 'lob') {
    st.passes[k.team]++
    const pl = aiStats.passLog
    const it = aiStats.intent[k.by]
    const ok = it && t - it.t < 2
    aiStats.intent[k.by] = undefined // bayat niyet sonraki vurusa tasinmasin
    pendingPass = { rid: ok ? it.rid : -1, margin: ok ? it.margin : NaN, team: k.team, by: k.by, t, sx: world.ball.x, sz: world.ball.z, ax: ok ? it.ax : ac?.aim.x ?? NaN, az: ok ? it.az : ac?.aim.z ?? NaN, type: k.type, trapRcv: false }
    // cozucu sapmasi: locomotion'a giden gercek aim ile serbest ucus tahmini (asirtmada y=BALL_R'ye
    // ilk inis, ornekler arasi dogrusal ara deger; yerden pasta hedefe en yakin gecis)
    const aimX = ac?.aim.x ?? pendingPass.ax
    const aimZ = ac?.aim.z ?? pendingPass.az
    let best = 1e9
    let land = null
    if (k.type === 'lob') {
      // ince adimli serbest ucus (1/240 s): ilk zemin temasi = inis
      const bb = Object.assign(newBall(), { x: world.ball.x, y: world.ball.y, z: world.ball.z, vx: world.ball.vx, vy: world.ball.vy, vz: world.ball.vz, wx: world.ball.wx, wy: world.ball.wy, wz: world.ball.wz })
      for (let i = 0; i < 240 * 4; i++) {
        const vy0 = bb.vy
        freeStep(bb, 1 / 240)
        if (i > 10 && vy0 < 0 && bb.y <= BALL_R + 1e-3) {
          land = [bb.x, bb.z]
          best = Math.hypot(bb.x - aimX, bb.z - aimZ)
          break
        }
      }
    } else {
      predictBall(world.ball)
      for (let i = 0; i < PRED_N; i++) best = Math.min(best, Math.hypot(pred[i * 3] - aimX, pred[i * 3 + 2] - aimZ))
    }
    if (process.env.DBG5 && best > 2) {
      const b = world.ball
      console.log(`sapma ${k.type} ${best.toFixed(2)} m: aim=(${aimX.toFixed(2)},${aimZ.toFixed(2)}) inis=${land ? land.map((v) => v.toFixed(2)).join(',') : '-'} top=(${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}) v=(${b.vx.toFixed(2)},${b.vy.toFixed(2)},${b.vz.toFixed(2)}) w=(${b.wx.toFixed(1)},${b.wy.toFixed(1)},${b.wz.toFixed(1)}) t=${t.toFixed(2)} vurucu=${k.by}`)
    }
    pendingPass.aimErr = best
    st.passD.push(Math.hypot(world.ball.x - (ac?.aim.x ?? 0), world.ball.z - (ac?.aim.z ?? 0)))
  } else if (k.type === 'shoot') {
    st.shots[k.team]++
    pendingShot = { team: k.team, t, on: false }
    // cerceveye mi: serbest ucus tahmini kale cizgisini direkler arasindan mi geciyor
    predictBall(world.ball)
    const gx = game.match.attackDir[k.team] * HL
    for (let i = 1; i < PRED_N; i++) {
      if ((pred[i * 3] - gx) * Math.sign(gx) >= 0) {
        if (Math.abs(pred[i * 3 + 2]) < GOAL_W / 2 && pred[i * 3 + 1] < GOAL_H) st.frame[k.team]++
        break
      }
    }
    pendingPass = null
    const dir = game.match.attackDir[k.team]
    st.shotD.push(Math.hypot(world.ball.x - dir * HL, world.ball.z))
  }
}
const lastAct = []
game.on((e) => {
  if (e.type === 'touch' && (e.kind === 'pass' || e.kind === 'lob' || e.kind === 'shoot')) {
    const p = game.players[e.player]
    if (process.env.DBG) console.log('vurus', t.toFixed(2), e.kind, p.id, p.role, game.match.phase, rules.mode, JSON.stringify(lastAct[p.id]?.aim))
    onKick({ by: p.id, team: p.team, type: e.kind })
  }
})
const marginBins = {}
const lossCls = {}
const lossInfo = { a: [], b: [] }
function resolvePass(ok) {
  if (!pendingPass) return
  if (!ok) {
    const pp = pendingPass
    const o = game.players.find((q) => q.hasBall)
    const b = world.ball
    let c
    if (pp.rid < 0) c = 'hedefsiz (uzaklastirma/yedek)'
    else if (pp.aimErr > 2) c = 'd: hedef/guc sapmasi'
    else if (pp.trapRcv) c = 'c: alici kotu ilk dokunus'
    else {
      const L = Math.hypot(pp.ax - pp.sx, pp.az - pp.sz) || 1
      const frac = Math.hypot(b.x - pp.sx, b.z - pp.sz) / L
      const r = game.players[pp.rid]
      const rd = Math.hypot(r.x - b.x, r.z - b.z)
      const rsp = Math.hypot(r.vx, r.vz)
      const toBall = rd > 0.01 ? (r.vx * (b.x - r.x) + r.vz * (b.z - r.z)) / rd : 0
      if (o && o.team !== pp.team && frac < 0.75) {
        c = 'a: ucusta kesildi'
        lossInfo.a.push({ d: frac * L, t: t - pp.t })
      } else {
        c = 'b: alici yetismedi'
        lossInfo.b.push({ rd, rsp, toBall })
      }
    }
    c = (pp.type === 'lob' ? 'L/' : 'Y/') + c
    lossCls[c] = (lossCls[c] ?? 0) + 1
  }
  if (Number.isFinite(pendingPass.margin)) {
    const k = (pendingPass.type === 'lob' ? 'L' : 'Y') + Math.max(-0.6, Math.min(1.0, Math.floor(pendingPass.margin * 5) / 5)).toFixed(1)
    marginBins[k] ??= [0, 0]
    marginBins[k][ok ? 0 : 1]++
    if (process.env.CAL2 && !ok && pendingPass.margin > 0 && pendingPass.type === 'pass') {
      const pp = pendingPass
      const o = game.players.find((q) => q.hasBall)
      const rcv = game.players[pp.rid ?? 0]
      console.log(`basarisiz guvenli pas: t=${t.toFixed(1)} sure=${(t - pp.t).toFixed(2)} tip=${pp.type} hedef=(${pp.ax?.toFixed(1)},${pp.az?.toFixed(1)}) bas=(${pp.sx?.toFixed(1)},${pp.sz?.toFixed(1)}) alan=${o ? o.id + o.role + (o.team === pp.team ? '(arkadas)' : '(rakip)') : 'yok'} top=(${world.ball.x.toFixed(1)},${world.ball.z.toFixed(1)},y${world.ball.y.toFixed(1)}) v=${Math.hypot(world.ball.vx, world.ball.vz).toFixed(1)} faz=${game.match.phase} alici=${rcv.id} alici_konum=(${rcv.x.toFixed(1)},${rcv.z.toFixed(1)}) alici_anim=${rcv.anim}`)
    }
  }
  if (ok) st.passOk[pendingPass.team]++
  else st.passBad[pendingPass.team]++
  pendingPass = null
}

const track = game.players.map((p) => ({ x: p.x, z: p.z, want: 0 }))
let freeStill = 0
let maxAi = 0
let aiSum = 0
let frames = 0
let readyStart = -1
const MAXF = Math.round((HALF * 2 * 2.5 + 60) / DT)
for (let f = 0; f < MAXF && game.match.phase !== 'fulltime'; f++) {
  frames++
  t += DT
  const a0 = performance.now()
  updateAI(DT)
  const ad = performance.now() - a0
  aiSum += ad
  if (f > 60) maxAi = Math.max(maxAi, ad)
  rules.pre(DT)
  for (const p of game.players) {
    const a = game.inputs[p.id].action
    if (!a) continue
    lastAct[p.id] = a
    if ((a.type === 'pass' || a.type === 'lob' || a.type === 'shoot') && p.actionLock <= 0 && !kickPend[p.id]) {
      kickPend[p.id] = { t, type: a.type, has: p.hasBall, bd: Math.hypot(world.ball.x - p.x, world.ball.z - p.z) }
      st.kickSent++
    }
  }
  stepLoco(DT)
  const b = world.ball
  world.side = b.x >= 0 ? 1 : -1
  world.step(DT)
  rules.post(DT)

  const m = game.match
  // duran topta 'ready' -> 'play' suresi (kurallarin 3.5 s yedek vurusu = AI gec kaldi)
  if (rules.mode === 'ready') {
    if (readyStart < 0) readyStart = t
  } else if (readyStart >= 0) {
    const d = t - readyStart
    st.readyT.push(d)
    if (d > 3.45) st.fallback++
    readyStart = -1
  }
  for (const p of game.players) {
    const k = kickPend[p.id]
    if (k && t - k.t > 0.6) {
      kickPend[p.id] = null
      const o = game.players.find((q) => q.hasBall)
      const why = `${k.type}:${k.has ? 'sahipti' : 'sahipsiz'}:${o ? (o.id === p.id ? 'hala-onda' : o.team === p.team ? 'arkadas' : 'rakip') : 'serbest'}:${p.anim}`
      st.kickFail[why] = (st.kickFail[why] ?? 0) + 1
    }
  }
  for (const p of game.players) {
    if (p.anim !== prevAnim[p.id]) {
      prevAnim[p.id] = p.anim
      if (!/^(idle|jog|run|sprint|dribble)$/.test(p.anim)) st.anims[p.anim] = (st.anims[p.anim] ?? 0) + 1
    }
    if (p.role === 'kaleci') {
      if (process.env.DBG4 && p.hasBall && holdStart[p.id] >= 0 && t - holdStart[p.id] > 1.8 && f % 6 === 0)
        console.log('kaleci tutuyor', p.id, (t - holdStart[p.id]).toFixed(2), p.anim, 'kilit', p.actionLock.toFixed(2), 'faz', game.match.phase, rules.mode, 'ai', JSON.stringify(aiDebug()[p.id]))
      // 3 s kurali yalniz oyun akarken sayilir
      if (game.match.phase !== 'play') holdStart[p.id] = -1
      else if (p.hasBall && holdStart[p.id] < 0) holdStart[p.id] = t
      if (!p.hasBall && holdStart[p.id] >= 0) {
        st.keeperHold.push(t - holdStart[p.id])
        if (process.env.DBG3) console.log("kaleci birakti", p.id, (t - holdStart[p.id]).toFixed(2), p.anim, JSON.stringify(lastAct[p.id]?.type), game.match.phase, (lastTouchEv?.player === p.id ? lastTouchEv.kind : "baska"))
        holdStart[p.id] = -1
      }
    }
  }
  const owner = game.players.find((p) => p.hasBall)
  if (owner) {
    st.possT[owner.team] += DT
    if (pendingPass && owner.id !== pendingPass.by) {
      if (owner.team !== pendingPass.team) st.passInt++
      if (process.env.DBG) {
        const pp = pendingPass
        console.log(`pas t${pp.team} ${pp.by}->${owner.id}${owner.team === pp.team ? ' OK' : ' KESILDI'} sure=${(t - pp.t).toFixed(2)} bas=(${pp.sx.toFixed(1)},${pp.sz.toFixed(1)}) hedef=(${pp.ax.toFixed(1)},${pp.az.toFixed(1)}) alan=(${owner.x.toFixed(1)},${owner.z.toFixed(1)}) tip=${pp.type} y=${world.ball.y.toFixed(2)} v=${Math.hypot(world.ball.vx, world.ball.vz).toFixed(1)} faz=${m.phase}`)
      }
      resolvePass(owner.team === pendingPass.team)
    }
    pendingShot = null
  }
  if (pendingPass && (t - pendingPass.t > 6 || m.phase !== 'play')) {
    if (m.phase === 'play') st.passTimeout++
    resolvePass(false)
  }
  if (pendingShot && !pendingShot.on && Math.abs(b.x) > HL - 0.3 && Math.abs(b.z) < GOAL_W / 2 + 0.1 && b.y < GOAL_H + 0.1) {
    pendingShot.on = true
    st.onTarget[pendingShot.team]++
  }
  if (m.phase === 'play') {
    if (!owner && Math.hypot(b.vx, b.vz) < 0.3) {
      freeStill += DT
      if (freeStill > 5) {
        st.unreach++
        freeStill = -1e9
      }
    } else if (owner) freeStill = 0
  } else freeStill = 0
  // takili oyuncu: 3 s boyunca hareket istiyor ama 0.6 m'den az yol aldi
  if (f % 180 === 0) {
    game.players.forEach((p, i) => {
      const tr = track[i]
      if (tr.want > 150 && Math.hypot(p.x - tr.x, p.z - tr.z) < 0.6 && m.phase === 'play') st.stuck++
      tr.x = p.x
      tr.z = p.z
      tr.want = 0
    })
  } else {
    game.players.forEach((p, i) => {
      const inp = game.inputs[p.id]
      if (Math.hypot(inp.move.x, inp.move.z) > 0.5) track[i].want++
    })
  }
  if (!Number.isFinite(b.x + b.z)) {
    console.log('NaN top', f)
    break
  }
}

const m = game.match
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(0) + '%' : '-')
const avg = (a) => (a.reduce((x, y) => x + y, 0) / (a.length || 1)).toFixed(1)
const mins = (m.half === 2 ? HALF + m.clock : m.clock) / 60
console.log(`AI-AI mac: 2x${HALF}s, tohum ${SEED}, seviye ${LEVEL}, hareket=${locoName}, faz=${m.phase}, gercek sure ${(t / 60).toFixed(1)} dk`)
console.log(`skor ${m.score[0]}-${m.score[1]}  sut ${st.shots[0]}/${st.shots[1]} (cerceve ${st.frame[0]}/${st.frame[1]}, cizgiye ulasan ${st.onTarget[0]}/${st.onTarget[1]}), gol atan rol ${JSON.stringify(st.goalsBy)}`)
console.log(`pas ${st.passes[0]}/${st.passes[1]}  isabet ${pct(st.passOk[0], st.passOk[0] + st.passBad[0])} / ${pct(st.passOk[1], st.passOk[1] + st.passBad[1])}; kesilen ${st.passInt}, sahipsiz ${st.passTimeout}; ort pas ${avg(st.passD)} m, ort sut ${avg(st.shotD)} m`)
console.log(`topa sahip olma ${st.possT[0].toFixed(0)}s / ${st.possT[1].toFixed(0)}s`)
console.log(`out: kenar ${st.out.side}, kale cizgisi ${st.out.goal} (oyun dk basina ${((st.out.side + st.out.goal) / (mins || 1)).toFixed(1)}); duran toplar ${JSON.stringify(st.restarts)}`)
console.log(`vurus gonderilen ${st.kickSent}, olmayan ${JSON.stringify(st.kickFail)}`)
console.log(`out oncesi son dokunus ${JSON.stringify(st.outBy)}`)
console.log(`duran top hazir->vurus ort ${avg(st.readyT)} s, en cok ${Math.max(0, ...st.readyT).toFixed(2)} s (>3 s: ${st.readyT.filter((x) => x > 3).length}), kural yedek vurusu ${st.fallback}`)
console.log(`ofsayt cagrisi ${st.offside}; pas anindaki ofsayt konumlu arkadas: <0.5 m ${st.offTight[0]}, >=0.5 m ${st.offTight[1]}; olcum ${st.checks}, cizgiye 1 m icinde onside ${st.nearLine}`)
console.log(`faul ${st.fouls} (penalti ${st.penalties}), kart ${st.cards}; takilma ${st.stuck}, ulasilamayan top ${st.unreach}`)
console.log(`kaleci tutarken temas ${contacts['KALECI-TUTARKEN-TEMAS'] ?? 0}`)
console.log(`temaslar ${JSON.stringify(contacts)}`)
console.log(`taklit: mudahale ok ${mockStats.tackleOk} kacan ${mockStats.tackleMiss}, kurtaris ${mockStats.saves} tutus ${mockStats.catches}`)
console.log(`AI karar ${aiStats.decisions}, pas ${aiStats.passes} asirtma ${aiStats.lobs} sut ${aiStats.shots} mudahale ${aiStats.tackles} kayarak ${aiStats.slides} dalis ${aiStats.dives}`)
console.log(`animasyonlar ${JSON.stringify(st.anims)}`)
console.log(`kaleci elde tutma ort ${avg(st.keeperHold)} s (n=${st.keeperHold.length}, en az ${Math.min(...st.keeperHold, 99).toFixed(1)}, en cok ${Math.max(...st.keeperHold, 0).toFixed(1)})`)
console.log(`tasiyici kararlari ${JSON.stringify(aiStats.carrier)}`)
if (process.env.CAL) {
  console.log('marj kutusu -> [basarili, basarisiz]', JSON.stringify(Object.fromEntries(Object.entries(marginBins).sort())))
  const rb = {}
  for (const m of aiStats.riskyMargins) { const k = Math.max(-1, Math.min(1, Math.floor(m * 5) / 5)).toFixed(1); rb[k] = (rb[k] ?? 0) + 1 }
  console.log('surulen anlarda en iyi pas marji dagilimi', JSON.stringify(Object.fromEntries(Object.entries(rb).sort((a, b) => a[0] - b[0]))))
}
{
  const tot = Object.values(lossCls).reduce((a, b) => a + b, 0)
  console.log(`pas kayip siniflari (n=${tot}): ` + Object.entries(lossCls).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (%${((100 * v) / tot).toFixed(0)})`).join('; '))
  const m = (arr, f) => (arr.length ? (arr.reduce((s, x) => s + f(x), 0) / arr.length).toFixed(2) : '-')
  console.log(`(a) kesme: ort mesafe ${m(lossInfo.a, (x) => x.d)} m, ort sure ${m(lossInfo.a, (x) => x.t)} s | (b) alici: topa uzaklik ${m(lossInfo.b, (x) => x.rd)} m, hiz ${m(lossInfo.b, (x) => x.rsp)} m/s, topa dogru hiz ${m(lossInfo.b, (x) => x.toBall)} m/s`)
}
console.log(`AI maliyeti ort ${(aiSum / frames).toFixed(3)} ms/kare, en cok ${maxAi.toFixed(3)} ms`)
