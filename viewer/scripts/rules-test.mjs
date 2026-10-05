// Bassiz kural testleri: npx -y tsx scripts/rules-test.mjs
// Her senaryo taze oyun durumu + sahte topla Rules motorunu kare kare surer.
import { Rules, HL, HW, judgeContact } from '../src/rules/engine.ts'
import { game as proto } from '../src/game/store.ts'
import { SPOT_DIST, BALL_R } from '../src/pitch.ts'
import { setBodyPoints, bodyPoints, BODY_N } from '../src/game/bodyPoints.ts'

const DT = 1 / 60
let pass = 0
let fail = 0
const ok = (c, msg) => {
  if (c) pass++
  else {
    fail++
    console.log('  BASARISIZ:', msg)
  }
}

function fresh(half = 180) {
  const listeners = new Set()
  const events = []
  const g = {
    players: structuredClone(proto.players),
    inputs: proto.players.map(() => ({ move: { x: 0, z: 0 }, sprint: false, action: null })),
    referee: { x: 0, z: -9, vx: 0, vz: 0, facing: 0, anim: 'idle', animT: 0 },
    match: structuredClone(proto.match),
    humanTeam: 0,
    emit(e) {
      events.push(e)
      listeners.forEach((f) => f(e))
    },
    on(f) {
      listeners.add(f)
      return () => listeners.delete(f)
    },
  }
  const ball = { x: 0, y: 0.11, z: 0, vx: 0, vy: 0, vz: 0 }
  const kicks = []
  const releases = []
  const r = new Rules({
    game: g,
    ball: () => ball,
    placeBall: (x, z) => Object.assign(ball, { x, y: 0.11, z, vx: 0, vy: 0, vz: 0 }),
    kick: (v) => {
      kicks.push(v)
      Object.assign(ball, { vx: v.x, vy: 0, vz: v.z })
    },
    halfLength: half,
    varMonitor: () => ({ x: 0, z: -14.1, facing: 0 }),
    releaseHold: () => releases.push(1),
  })
  r.start()
  // ts: timeScale (VAR'da 0 olabilir; hakem gercek zamanla yurur)
  const step = (sec, ts = 1) => {
    for (let t = 0; t < sec; t += DT) {
      r.pre(DT * ts)
      ball.x += ball.vx * DT * ts
      ball.z += ball.vz * DT * ts
      r.post(DT * ts, DT)
    }
  }
  // baslama vurusunu yap: oyun 'play'
  const startPlay = () => {
    step(2)
    if (r.mode !== 'ready') return false
    ball.vx = 3
    step(0.3)
    ball.vx = 0
    return r.mode === 'play'
  }
  const touch = (player) => g.emit({ type: 'touch', player, kind: 'dribble' })
  return { g, r, ball, step, startPlay, touch, events, kicks, releases }
}

const contact = (a, b, o) => ({ type: 'contact', a, b, ballFirst: false, fromBehind: false, intensity: 0.5, kind: 'tackle', x: 0, z: 0, ...o })

// ---------------------------------------------------------------- saf karar tablosu
console.log('1) temas karari')
ok(judgeContact(contact(1, 5, { ballFirst: true, intensity: 0.3 }), 0).foul === false, 'ballFirst dusuk siddet temiz')
ok(judgeContact(contact(1, 5, { kind: 'slide', fromBehind: true, intensity: 0.4 }), 0).card === 'red', 'arkadan topsuz kayma kirmizi')
ok(judgeContact(contact(1, 5, { kind: 'slide', intensity: 0.8 }), 0).card === 'yellow', 'onden topsuz kayma sari')
ok(judgeContact(contact(1, 5, { kind: 'slide', intensity: 0.5 }), 0).card === null, 'hafif onden kayma: yalniz serbest vurus')
ok(judgeContact(contact(1, 5, { kind: 'slide', intensity: 1 }), 0).card === 'yellow', 'onden topsuz kayma, siddet doymus: yine sari')
ok(judgeContact(contact(1, 5, { kind: 'slide', intensity: 0.95, high: true }), 0).card === 'red', 'cok sert + yuksek temas kirmizi')
ok(judgeContact(contact(1, 5, { kind: 'slide', ballFirst: true, intensity: 0.7 }), 0).foul === false, 'topa once kayma temiz')
ok(judgeContact(contact(1, 5, { kind: 'body', intensity: 0.2 }), 0).foul === false, 'hafif govde temasi faul degil')
ok(judgeContact(contact(1, 5, { kind: 'tackle', intensity: 0.3 }), 0).foul === true, 'topsuz mudahale faul')
ok(judgeContact(contact(1, 5, { kind: 'tackle', intensity: 0.95 }), 0).card === 'red', 'cok sert ayakta mudahale kirmizi')
ok(judgeContact(contact(1, 5, { ballFirst: true, intensity: 0.8 }), 0).foul === false, 'once topa, sert ama asiri degil: temiz')
ok(judgeContact(contact(1, 5, { ballFirst: true, intensity: 0.95 }), 0).card === 'yellow', 'once topa asiri sert ayakta: en fazla sari')
// QA C1: once topa, onden kayma, siddet 1'e doymus -> faul yok, kirmizi asla
ok(judgeContact(contact(7, 2, { kind: 'slide', ballFirst: true, fromBehind: false, intensity: 1 }), 0).foul === false, 'QA C1: once topa onden kayma temiz')
ok(judgeContact(contact(7, 2, { kind: 'slide', ballFirst: true, fromBehind: true, intensity: 1 }), 0).card === 'yellow', 'once topa ama arkadan kayma: sari, kirmizi degil')
ok(judgeContact(contact(1, 5, { intensity: 0.5 }), 3).card === 'yellow' && judgeContact(contact(1, 5, { intensity: 0.5 }), 2).card === null, 'dorduncu faul sari, ucuncu kartsiz')

// ---------------------------------------------------------------- baslama vurusu
console.log('2) baslama vurusu')
{
  const { g, r, startPlay } = fresh()
  ok(r.mode === 'setup' && g.match.phase === 'kickoff', 'acilista kurulum')
  ok(g.players[3].x < 0 && Math.abs(g.players[3].x) < 1, 'ev forveti topun arkasinda')
  ok(g.players.filter((p) => p.team === 1).every((p) => p.x > 0 && Math.hypot(p.x, p.z) >= 3), 'rakip kendi yarisinda ve cember disinda')
  ok(startPlay(), 'vurusla oyun basliyor')
  ok(g.match.phase === 'play' && g.match.restart === null, 'faz play')
  ok(g.match.lastTouch?.player === 3, 'taker son dokunan')
}

// ---------------------------------------------------------------- out: taç
console.log('3) taç (ayakla)')
{
  const { g, r, ball, step, startPlay, touch, events } = fresh()
  startPlay()
  Object.assign(ball, { x: 5, z: HW - 1, vx: 0, vz: 6 })
  touch(2) // ev ortasi son dokunan
  step(0.4)
  ok(events.some((e) => e.type === 'out' && e.line === 'side'), 'yan cizgi outu')
  ok(r.mode === 'stopped', 'oyun durdu')
  ball.vz = 0
  step(3)
  ok(r.mode === 'ready' && g.match.phase === 'kickin', 'kickin hazir')
  ok(g.match.restart?.team === 1, 'deplasmanin taci')
  ok(Math.abs(ball.z - (HW - 0.12)) < 1e-6, 'top cizgide')
  ok(g.players.filter((p) => p.team === 0).every((p) => Math.hypot(p.x - ball.x, p.z - ball.z) >= 3), 'rakipler 3 m disinda')
  const tk = g.players[g.match.restart.taker]
  ok(tk.team === 1 && Math.hypot(tk.x - ball.x, tk.z - ball.z) < 1.2, 'taker topun basinda')
}

// ---------------------------------------------------------------- out: korner / kale vurusu
console.log('4) korner ve kale vurusu')
{
  const { g, r, ball, step, startPlay, touch } = fresh()
  startPlay()
  Object.assign(ball, { x: HL - 1, z: 6, vx: 8, vz: 0 })
  touch(5) // deplasman defansi (+x kalesini savunuyor)
  step(0.3)
  ball.vx = 0
  step(3)
  ok(g.match.phase === 'corner' && g.match.restart?.team === 0, 'savunan dokundu: ev kornesi')
  ok(ball.x > HL - 0.5 && ball.z > HW - 0.5, 'top kornerde')
}
{
  const { g, ball, step, startPlay, touch } = fresh()
  startPlay()
  Object.assign(ball, { x: HL - 1, z: 6, vx: 8, vz: 0 })
  touch(3) // ev forveti
  step(0.3)
  ball.vx = 0
  step(3)
  ok(g.match.phase === 'goalkick' && g.match.restart?.team === 1, 'hucumcu dokundu: kale vurusu')
  ok(g.match.restart?.taker === 4, 'kale vurusunu kaleci kullanir')
}

// ---------------------------------------------------------------- faul + sari + serbest vurus
console.log('5) arkadan kayma')
{
  const { g, r, ball, step, startPlay, events } = fresh()
  startPlay()
  ball.x = -2
  g.emit(contact(6, 2, { kind: 'slide', intensity: 0.8, x: -2, z: 1 }))
  step(0.1)
  ok(events.some((e) => e.type === 'foul' && e.by === 6 && !e.penalty), 'faul verildi')
  step(4)
  ok(g.players[6].yellow === 1 && !g.players[6].sentOff, 'sari kart')
  ok(events.some((e) => e.type === 'card' && e.player === 6 && e.color === 'yellow'), 'kart olayi')
  for (let i = 0; i < 300 && r.mode !== 'ready'; i++) step(DT)
  ok(g.match.phase === 'freekick' && g.match.restart?.team === 0, 'ev serbest vurusu')
  ok(Math.abs(ball.x + 2) < 1e-6 && Math.abs(ball.z - 1) < 1e-6, 'top faul yerinde')
  ok(g.players.filter((p) => p.team === 1).every((p) => Math.hypot(p.x - ball.x, p.z - ball.z) >= 5 - 1e-6), 'rakipler 5 m disinda')
  ok(r.mode === 'ready', 'hazir')
}

console.log('6) once topa temiz mudahale')
{
  const { g, r, startPlay, step, events } = fresh()
  startPlay()
  g.emit(contact(6, 2, { kind: 'tackle', ballFirst: true, intensity: 0.35 }))
  step(0.2)
  ok(!events.some((e) => e.type === 'foul') && r.mode === 'play', 'oyun suruyor')
}

// ---------------------------------------------------------------- penalti
console.log('7) ceza alaninda faul')
{
  const { g, ball, step, startPlay, events } = fresh()
  startPlay()
  ball.x = 16
  g.emit(contact(5, 3, { kind: 'tackle', intensity: 0.5, x: 16.5, z: 2 }))
  step(0.1)
  ok(events.some((e) => e.type === 'foul' && e.penalty), 'penalti faulu')
  step(6)
  ok(g.match.phase === 'penalty' && g.match.restart?.team === 0, 'ev penaltisi')
  ok(Math.abs(ball.x - (HL - SPOT_DIST)) < 1e-6 && ball.z === 0, 'top penalti noktasinda')
  ok(Math.abs(g.players[4].x - (HL - 0.2)) < 1e-6, 'kaleci cizgide')
  ok(g.players.filter((p) => p.id !== 3 && p.id !== 4).every((p) => Math.hypot(p.x - ball.x, p.z - ball.z) >= 3), 'digerleri uzakta')
}

// ---------------------------------------------------------------- ikinci sari
console.log('8) ikinci sari -> kirmizi')
{
  const { g, ball, step, startPlay, events } = fresh()
  startPlay()
  ball.x = -2
  g.emit(contact(6, 2, { kind: 'slide', intensity: 0.8, x: -2 }))
  step(8)
  ok(g.players[6].yellow === 1, 'ilk sari')
  ball.vx = 4
  step(0.3)
  ball.vx = 0
  ok(g.match.phase === 'play', 'oyun yeniden basladi')
  g.emit(contact(6, 1, { kind: 'slide', intensity: 0.8, x: 0, z: -3 }))
  step(8)
  ok(g.players[6].sentOff === true, 'oyundan atildi')
  ok(events.some((e) => e.type === 'card' && e.player === 6 && e.color === 'red'), 'kirmizi olayi')
  step(12)
  ok(Math.abs(g.players[6].z) > HW + 3, 'yuruyerek saha disina cikti')
}

console.log('9) cok sert mudahale direkt kirmizi')
{
  const { g, step, startPlay } = fresh()
  startPlay()
  g.emit(contact(7, 1, { kind: 'tackle', intensity: 0.97, x: -3 }))
  step(8)
  ok(g.players[7].sentOff && g.players[7].yellow === 0, 'direkt kirmizi')
}

console.log('9b) kirmizi kart: 30 s ceza ve geri donus')
{
  const { g, r, ball, step, startPlay, events } = fresh()
  startPlay()
  // rakip (deplasman, takim 1) oyuncusu 7 dogrudan kirmizi
  g.emit(contact(7, 1, { kind: 'tackle', intensity: 0.97, x: -3 }))
  step(8)
  const p = g.players[7]
  ok(p.sentOff, 'cezali: sahadan cikti')
  ok(g.match.suspended?.length === 1 && g.match.suspended[0].id === 7 && g.match.suspended[0].left > 20, 'match.suspended listede')
  // oyun baslat, 25 s canli oyun: hala disarida; saha oyuncusu sayisi 3
  ball.vx = 4; step(0.3); ball.vx = 0
  ok(r.mode === 'play', 'oyun devam')
  for (let i = 0; i < 25; i++) { ball.x = 0; ball.z = 0; step(1) }
  ok(p.sentOff && Math.abs(p.z) > HW + 2, '25 s: hala saha disinda bekliyor (z=' + p.z.toFixed(1) + ')')
  ok(g.players.filter((q) => q.team === 1 && !q.sentOff).length === 3, 'rakip 4e 3')
  // ofsayt hesabinda cezali yok: savunma cizgisi cezalinin x'ine bakmaz
  for (let i = 0; i < 8; i++) { ball.x = 0; ball.z = 0; step(1) }
  ok(!p.sentOff && Math.abs(Math.abs(p.z) - (HW - 0.4)) < 1e-6 && p.yellow === 0, '30 s sonra sahaya girdi, kartlar sifir')
  ok(events.some((e) => e.type === 'player-return' && e.player === 7), 'player-return olayi')
  ok(g.match.suspended.length === 0, 'liste bosaldi')
}
{
  // duran top suresi ceza sayacini yemez
  const { g, r, ball, step, startPlay } = fresh()
  startPlay()
  g.emit(contact(7, 1, { kind: 'tackle', intensity: 0.97, x: -3 }))
  step(8)
  ball.vx = 4; step(0.3); ball.vx = 0
  for (let i = 0; i < 10; i++) { ball.x = 0; ball.z = 0; step(1) }
  const l0 = g.match.suspended[0].left
  // faul: durak
  g.emit(contact(5, 3, { kind: 'tackle', intensity: 0.5, x: 0, z: 0 }))
  step(1)
  ok(r.mode !== 'play', 'durdu')
  step(3)
  ok(Math.abs(g.match.suspended[0].left - l0) < 1.2, 'duraklamada sayac akmaz (' + l0.toFixed(1) + ' -> ' + g.match.suspended[0].left.toFixed(1) + ')')
}
{
  // kaleci kirmizi: en yakin saha oyuncusu kaleci olur, ceza bitince rol geri
  const { g, r, ball, step, startPlay } = fresh()
  startPlay()
  const gk = g.players.find((q) => q.team === 1 && q.role === 'kaleci')
  const before = g.players.filter((q) => q.team === 1 && q.role === 'kaleci').length
  g.emit(contact(gk.id, 1, { kind: 'tackle', intensity: 0.97, x: 18 }))
  step(8)
  ok(gk.sentOff, 'kaleci cezali')
  const gks = g.players.filter((q) => q.team === 1 && q.role === 'kaleci' && !q.sentOff)
  ok(gks.length === 1 && gks[0].id !== gk.id, 'yedek kaleci devraldi')
  const subId = gks[0].id
  ball.vx = 4; step(0.3); ball.vx = 0
  for (let i = 0; i < 32; i++) { ball.x = 0; ball.z = 0; step(1) }
  ok(!gk.sentOff && gk.role === 'kaleci' && g.players[subId].role !== 'kaleci', 'ceza bitti: kaleci geri, yedek eski rolunde')
}

{
  // monitor basinda hakem ekranin yaninda: yan kayma 0.6-0.8, mesafe 1.1-1.3, yuz ekrana
  const { r } = fresh()
  const st = r.varStand()
  const M = { x: 0, z: -14.1 }
  const d = Math.hypot(st.x - M.x, st.z - M.z)
  ok(Math.abs(st.x - M.x) >= 0.6 && Math.abs(st.x - M.x) <= 0.8 && d >= 1.1 && d <= 1.3, `VAR duruslari yanda (yan ${(st.x - M.x).toFixed(2)}, mesafe ${d.toFixed(2)})`)
  const look = Math.atan2(M.x - st.x, M.z - st.z)
  ok(Math.abs(st.facing - look) < 1e-9, 'yuz ekrana')
}

console.log('9c) maç sonu: yeniden oyna')
{
  const { g, r, ball, step, startPlay } = fresh()
  startPlay()
  g.emit(contact(7, 1, { kind: 'tackle', intensity: 0.97, x: -3 }))
  step(8)
  g.match.score = [2, 1]
  r.endHalf()
  g.match.half = 2
  r.endHalf()
  ok(g.match.phase === 'fulltime', 'maç sonu fazı')
  r.start()
  step(2)
  ok(g.match.phase === 'kickoff' && g.match.score[0] === 0 && g.match.score[1] === 0 && g.match.clock === 0 && g.match.half === 1, 'yeni mac: 0-0, 1. yari, baslama vurusu')
  ok(g.match.suspended.length === 0 && g.players.every((p) => !p.sentOff && p.yellow === 0), 'ceza ve kartlar sifir')
  ok(startPlay() || r.mode === 'ready' || r.mode === 'play', 'yeni mac oynanir')
}

// ---------------------------------------------------------------- gol ve VAR iptali
console.log('10) gol + VAR iptali')
{
  const { g, r, ball, step, startPlay, touch, events } = fresh()
  startPlay()
  Object.assign(ball, { x: HL - 2, z: 0.5, y: 0.5, vx: 15, vz: 0 })
  touch(3)
  step(0.25)
  ok(g.match.score[0] === 1, 'skor 1-0')
  ok(events.some((e) => e.type === 'goal' && e.team === 0 && e.scorer === 3), 'gol olayi, golcu Arda')
  ball.vx = 0
  // G: VAR incelemesi
  g.match.phase = 'var'
  step(2)
  ok(r.mode === 'stopped', 'VAR sirasinda bekler')
  r.varDecision({ kind: 'goal-cancel', team: 0 })
  ok(g.match.score[0] === 0, 'skor geri alindi')
  step(4)
  ok(g.match.phase === 'goalkick' && g.match.restart?.team === 1, 'iptal sonrasi kale vurusu')
}
{
  const { g, ball, step, startPlay, touch } = fresh()
  startPlay()
  Object.assign(ball, { x: HL - 2, z: 0, vx: 15 })
  touch(3)
  step(0.25)
  ball.vx = 0
  step(6)
  ok(g.match.phase === 'kickoff' && g.match.restart?.team === 1, 'golden sonra yiyen takim baslar')
}
{
  const { g, ball, step, startPlay, touch } = fresh()
  startPlay()
  Object.assign(ball, { x: HL - 2, z: 3.2, vx: 15 }) // direk disi
  touch(3)
  step(0.25)
  ok(g.match.score[0] === 0, 'direk disindan gol yok')
}

// ---------------------------------------------------------------- avantaj
console.log('11) avantaj')
{
  const { g, r, ball, step, startPlay, touch, events } = fresh()
  startPlay()
  ball.x = 12
  g.players[3].hasBall = true
  touch(3)
  g.emit(contact(5, 2, { kind: 'tackle', intensity: 0.5, x: 9, z: 6 }))
  step(0.1)
  ok(g.match.advantageUntil > 0 && r.mode === 'play', 'avantaj verildi')
  step(2.2)
  ok(g.match.advantageUntil === 0 && r.mode === 'play', 'avantaj bitti, oyun suruyor')
  ok(!events.some((e) => e.type === 'whistle' && e.reason === 'foul'), 'duduk yok')
}
{
  const { g, r, ball, step, startPlay, touch } = fresh()
  startPlay()
  ball.x = 12
  g.players[3].hasBall = true
  touch(3)
  g.emit(contact(5, 2, { kind: 'tackle', intensity: 0.5, x: 9, z: 6 }))
  step(0.5)
  g.players[3].hasBall = false
  touch(6) // rakip topu kapti
  step(0.1)
  ok(r.mode === 'stopped', 'avantaj geri alindi')
  step(4)
  ok(g.match.phase === 'freekick' && Math.abs(ball.x - 9) < 1e-6, 'faul yerinden serbest vurus')
}

// ---------------------------------------------------------------- baraj
console.log('12) kaleye yakin serbest vurusta baraj')
{
  const { g, ball, step, startPlay } = fresh()
  startPlay()
  g.emit(contact(5, 3, { kind: 'tackle', intensity: 0.5, x: 9, z: 3 }))
  step(5)
  const wall = g.players.filter((p) => p.team === 1 && p.role !== 'kaleci' && Math.abs(Math.hypot(p.x - ball.x, p.z - ball.z) - 5) < 0.1)
  ok(wall.length === 2, 'iki kisilik baraj 5 m de')
}

// ---------------------------------------------------------------- devreler
console.log('13) devre arasi ve mac sonu')
{
  const { g, r, step, startPlay, events } = fresh(20)
  startPlay()
  step(20)
  ok(g.match.phase === 'halftime', 'devre arasi')
  step(6.5)
  ok(g.match.half === 2 && g.match.attackDir[0] === -1 && g.match.attackDir[1] === 1, 'taraf degisti')
  ok(g.match.restart?.team === 1 && g.match.phase === 'kickoff', 'ikinci yariyi deplasman baslatir')
  ok(g.players[7].x < 0 && g.players[7].x > -1, 'deplasman forveti (artik +x hucum) topun arkasinda')
  startPlay()
  step(21)
  ok(g.match.phase === 'fulltime' && r.mode === 'fulltime', 'mac sonu')
  ok(events.some((e) => e.type === 'whistle' && e.reason === 'end'), 'uc uzun duduk')
}

// ---------------------------------------------------------------- yapay zeka yedek vurusu + girdi kilidi
console.log('14) girdi kilidi ve YZ yedek vurusu')
{
  const { g, r, ball, step, startPlay, touch, kicks, events } = fresh()
  startPlay()
  Object.assign(ball, { x: 5, z: -HW + 1, vz: -6 })
  touch(2)
  step(0.4)
  ball.vz = 0
  step(0.2)
  g.inputs[0].action = { type: 'shoot', power: 1, aim: { x: 0, y: 0, z: 0 } }
  r.pre(DT)
  ok(g.inputs[0].action === null, 'duraklamada aksiyon silinir')
  step(3)
  ok(r.mode === 'ready', 'hazir')
  step(4)
  ok(kicks.length >= 1 && events.some((e) => e.type === 'phase' && e.phase === 'play'), 'YZ gecikince yedek pas')
}

console.log('14b) insan taker zaman asimi (baslama, penalti)')
{
  const f = fresh()
  const { g, r, step, kicks } = f
  step(2)
  const tk = g.players[g.match.restart.taker]
  ok(r.mode === 'ready' && tk.controlled, 'baslama: insan taker hazir')
  step(7)
  ok(r.mode === 'ready' && r.countdown === null, '~8 s: hala bekliyor, sayac sessiz')
  step(2)
  ok(r.mode === 'ready' && r.countdown !== null && r.countdown <= 3, '10 s: son 3 s sayaci')
  step(2.5)
  ok(r.mode === 'play' && kicks.length >= 1, '12 s sonra yedek pas, oyun devam')
}
{
  const { g, r, ball, step, startPlay, kicks } = fresh()
  startPlay()
  ball.x = 16
  g.emit(contact(5, 3, { kind: 'tackle', intensity: 0.5, x: 16.5, z: 2 }))
  step(0.1)
  for (let i = 0; i < 600 && r.mode !== 'ready'; i++) step(DT)
  ok(g.match.phase === 'penalty' && r.mode === 'ready', 'penalti hazir')
  const n0 = kicks.length
  step(10)
  ok(r.mode === 'ready' && kicks.length === n0, 'penalti: 10 s bekler')
  step(2.5)
  ok(kicks.length > n0, 'penalti: 12 s sonra yedek sut')
}

console.log('14c) kart dagilimi: rastgele temas akisi')
{
  // F'nin gercek araligi: ayakta 0.55-0.9, kayma 0.4-0.85, omuz 0.15-0.7, govde 0.1-0.5; arkadan %20
  let sd = 12345
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647)
  let fouls = 0, cards = 0, reds = 0
  let per = new Array(11).fill(0)
  for (let i = 0; i < 4000; i++) {
    if (i % 40 === 0) per = new Array(11).fill(0) // 40 temas ~ bir mac
    const kind = ['tackle', 'slide', 'shoulder', 'body'][Math.floor(rnd() * 4)]
    const [lo, hi] = { tackle: [0.55, 0.9], slide: [0.4, 0.85], shoulder: [0.15, 0.7], body: [0.1, 0.5] }[kind]
    const c = contact(1, 5, { kind, intensity: lo + rnd() * (hi - lo), fromBehind: rnd() < 0.2, ballFirst: rnd() < 0.4 })
    const who = Math.floor(rnd() * 11)
    const v = judgeContact(c, per[who], rnd() * 3)
    if (!v.foul) continue
    per[who]++
    fouls++
    if (v.card) cards++
    if (v.card === 'red') reds++
  }
  ok(fouls > 200 && cards / fouls <= 0.25, `kart orani ${(100 * cards / fouls).toFixed(1)}% (faul ${fouls}, kart ${cards}, kirmizi ${reds}) <= %25`)
}

// ---------------------------------------------------------------- ofsayt
// sahne: ev (0) +x'e hucum. Pasor Mert (1) x=5; alici Arda (3); deplasman savunmasi: kaleci 4 x=19, defans 5 x=12.
function offsideScene(recvX, opts = {}) {
  const f = fresh()
  const { g, ball, step, startPlay } = f
  startPlay()
  const P = g.players
  const put = (id, x, z) => Object.assign(P[id], { x, z, vx: 0, vz: 0 })
  put(1, 5, -3); put(2, 0, 4); put(3, recvX, 2)
  put(4, 19, 0); put(5, 12, -2); put(6, 2, -5); put(7, 1, 6)
  Object.assign(ball, { x: 5.3, z: -3, vx: 0, vz: 0 })
  step(0.05)
  const evs = []
  g.on((e) => evs.push(e))
  g.emit({ type: 'touch', player: 1, kind: 'pass' })
  step(0.05)
  // top aliciya ulasir
  Object.assign(ball, { x: recvX, z: 2 })
  g.emit({ type: 'touch', player: 3, kind: 'trap' })
  step(0.1)
  const chk = evs.find((e) => e.type === 'offside-check' && e.receiver === 3)
  return { ...f, chk, called: evs.some((e) => e.type === 'offside' && e.player === 3) }
}
console.log('15) ofsayt')
{
  const s = offsideScene(16)
  ok(s.chk && s.chk.margin > 4.1 && s.chk.margin < 4.2, 'net ofsayt: margin ~4.15 m (hucumcu one, savunmaci geri bakar)')
  ok(s.called && s.r.mode === 'stopped', 'net ofsayt: duduk')
  s.step(4)
  ok(s.g.match.phase === 'freekick' && s.g.match.restart?.team === 1 && Math.abs(s.ball.x - 16) < 1e-6, 'ofsayt yerinden deplasman serbest vurusu')
}
{
  const s = offsideScene(11.85)
  ok(s.chk && Math.abs(s.chk.margin) < 1e-9 && !s.called && s.r.mode === 'play', 'ayni hizada gecerli')
}
{
  const s = offsideScene(11.9)
  ok(s.chk && Math.abs(s.chk.margin - 0.05) < 1e-6 && s.called, '5 cm ofsayt')
}
{
  // alici kendi yari sahasinda: savunmanin onunde olsa da ofsayt degil
  const f = fresh()
  const { g, ball, step, startPlay } = f
  startPlay()
  const P = g.players
  Object.assign(P[1], { x: -8, z: 0 }); Object.assign(P[3], { x: -1, z: 2 })
  Object.assign(P[4], { x: 19, z: 0 }); Object.assign(P[5], { x: -3, z: 0 }); Object.assign(P[6], { x: -4, z: 3 }); Object.assign(P[7], { x: -6, z: -4 })
  Object.assign(ball, { x: -8, z: 0 })
  const evs = []
  g.on((e) => evs.push(e))
  g.emit({ type: 'touch', player: 1, kind: 'pass' })
  step(0.05)
  g.emit({ type: 'touch', player: 3, kind: 'trap' })
  step(0.1)
  const c = evs.find((e) => e.type === 'offside-check' && e.receiver === 3)
  ok(c && c.margin <= 0 && f.r.mode === 'play', 'kendi yari sahasinda gecerli')
}
{
  // kornerden dogrudan: ofsayt olmaz
  const f = fresh()
  const { g, ball, step, startPlay, touch } = f
  startPlay()
  Object.assign(ball, { x: HL - 1, z: 6, vx: 8 })
  touch(5)
  step(0.3)
  ball.vx = 0
  step(3)
  ok(g.match.phase === 'corner', 'korner hazir')
  const tk = g.match.restart.taker
  Object.assign(g.players[3 === tk ? 2 : 3], { x: 19, z: 1 }) // kaleci hizasinin onunde
  const evs = []
  g.on((e) => evs.push(e))
  g.emit({ type: 'touch', player: tk, kind: 'pass' })
  Object.assign(ball, { vx: -6, vz: -6 })
  step(0.2)
  g.emit({ type: 'touch', player: 3 === tk ? 2 : 3, kind: 'header' })
  step(0.1)
  ok(!evs.some((e) => (e.type === 'offside-check' && e.passer === tk) || e.type === 'offside') && f.r.mode === 'play', 'kornerden ofsayt yok')
}


// gercek vucut noktalari (bodyPoints): kafa, gogus, kalca, diz, bilek, ayak ucu; kol yok
{
  const pts = (o) => {
    const a = new Float32Array(BODY_N * 3)
    for (let i = 0; i < BODY_N; i++) {
      a[i * 3] = o.x + (o.dx?.[i] ?? 0)
      a[i * 3 + 1] = 1
      a[i * 3 + 2] = o.z
    }
    return a
  }
  // indeks: 0 kafa-ust 1 kafa 2 gogus 3 kalca 4-5 diz 6-7 bilek 8-9 ayak ucu
  const scene = (dxArm, setup) => {
    const f = fresh()
    const { g, ball, step, startPlay } = f
    startPlay()
    const P = g.players
    const put = (id, x, z) => Object.assign(P[id], { x, z, vx: 0, vz: 0 })
    put(1, 5, -3); put(2, 0, 4); put(3, 12, 2)
    put(4, 19, 0); put(5, 12, -2); put(6, 2, -5); put(7, 1, 6)
    setBodyPoints(3, pts({ x: 12, z: 2, dx: setup }))
    setBodyPoints(5, pts({ x: 12, z: -2 }))
    setBodyPoints(4, pts({ x: 19, z: 0 }))
    Object.assign(ball, { x: 5.3, z: -3 })
    step(0.05)
    const evs = []
    g.on((e) => evs.push(e))
    g.emit({ type: 'touch', player: 1, kind: 'pass' })
    step(0.05)
    const chk = evs.find((e) => e.type === 'offside-check' && e.receiver === 3)
    return chk
  }
  const c0 = scene(0, {})
  ok(c0 && c0.margin <= 1e-6, 'ayni hizada govde: ofsayt degil (' + c0?.margin + ')')
  const ahead = (idx, d) => scene(0, { [idx]: d })
  ok(ahead(8, 1.2).margin > 0, 'ayak ucu ileride: ofsayt')
  ok(ahead(1, 1.2).margin > 0, 'kafa ileride: ofsayt')
  ok(ahead(2, 1.2).margin > 0, 'gogus ileride: ofsayt')
  // kol: noktalarda yok, bu yuzden govde geride ise ofsayt degil (kol uzansa da)
  ok(scene(0, {}).margin <= 0, 'kol ileride: sayilmaz')
  // yarim saha: butun noktalar kendi yarisinda
  bodyPoints.clear()
  const h = scene(0, {})
  ok(h !== undefined, 'olcum yapildi')
  bodyPoints.clear()
}
{
  // yarim saha: en ileri nokta orta cizgiyi gecmemis => ofsayt yok, gecmis => olcum gecerli
  const f = fresh()
  const { g, ball, step, startPlay } = f
  startPlay()
  const P = g.players
  const put = (id, x, z) => Object.assign(P[id], { x, z, vx: 0, vz: 0 })
  put(1, -8, 0); put(3, -0.5, 2); put(4, 19, 0); put(5, -3, 0); put(6, -4, 3); put(7, -6, -4)
  Object.assign(ball, { x: -8, z: 0 })
  const evs = []
  g.on((e) => evs.push(e))
  g.emit({ type: 'touch', player: 1, kind: 'pass' })
  step(0.05)
  const c = evs.find((e) => e.type === 'offside-check' && e.receiver === 3)
  ok(c && c.margin <= 0, 'orta cizgi gerisi: ofsayt yok')
}
{
  // kayan alici (yedek kapsul, yatma payi 0.5): x=11.8 -> 12.3 > 12.2 ofsayt
  const f = fresh()
  const { g, ball, step, startPlay } = f
  startPlay()
  const P = g.players
  const put = (id, x, z) => Object.assign(P[id], { x, z, vx: 0, vz: 0 })
  put(1, 5, -3); put(3, 11.8, 2); put(4, 19, 0); put(5, 12, -2); put(6, 2, -5); put(7, 1, 6)
  P[3].anim = 'slide'
  Object.assign(ball, { x: 5.3, z: -3 })
  const evs = []
  g.on((e) => evs.push(e))
  g.emit({ type: 'touch', player: 1, kind: 'pass' })
  step(0.05)
  const c = evs.find((e) => e.type === 'offside-check' && e.receiver === 3)
  ok(c && Math.abs(c.margin - 0.1) < 1e-6, 'kayan oyuncu: yatma payi ile 10 cm ofsayt (' + c?.margin + ')')
}
{
  // top savunmanin ilerisinde: cizgiyi top belirler (merkez + BALL_R)
  const f = fresh()
  const { g, ball, step, startPlay } = f
  startPlay()
  const P = g.players
  const put = (id, x, z) => Object.assign(P[id], { x, z, vx: 0, vz: 0 })
  put(1, 13, -3); put(3, 13.3, 2); put(4, 19, 0); put(5, 12, -2); put(6, 2, -5); put(7, 1, 6)
  Object.assign(ball, { x: 13, z: -3 })
  const evs = []
  g.on((e) => evs.push(e))
  g.emit({ type: 'touch', player: 1, kind: 'pass' })
  step(0.05)
  const c = evs.find((e) => e.type === 'offside-check' && e.receiver === 3)
  ok(c && Math.abs(c.margin - (0.3 + 0.35 - BALL_R)) < 1e-6, 'cizgi topun yuzu: margin = 0.3+0.35-BALL_R (' + c?.margin + ')')
}

// ---------------------------------------------------------------- sahada VAR
console.log('16) VAR: monitor akisi')
function varGoal(verdict, reason = 'offside') {
  const f = offsideScene(11.8) // gecerli pozisyon, ince
  const { g, r, ball, step, touch } = f
  // alici kaleye atar: gol
  Object.assign(ball, { x: HL - 2, z: 0.5, vx: 15 })
  touch(3)
  step(0.25)
  ball.vx = 0
  const scored = g.match.score[0] === 1
  Object.assign(g.referee, { x: 14, z: 8, vx: 5, vz: 5 }) // hakem kosuyor: listen'de durmali, run'da monitore donmeli
  g.emit({ type: 'var-start', reason })
  step(0.1, 0)
  const s1 = { phase: g.match.phase, anim: g.referee.anim }
  step(0.95, 0)
  // monitore kos (oyun zamani durdu: timeScale 0)
  let t = 0
  const st0 = r.varStand()
  const dist = () => Math.hypot(g.referee.x - st0.x, g.referee.z - st0.z)
  let runStart = -1, worst = 0, last = dist()
  while (r.varS?.stage !== 'monitor' && t < 20) {
    step(0.1, 0); t += 0.1
    const dd = dist()
    if (r.varS?.stage === 'run' && runStart < 0) runStart = t
    if (runStart >= 0 && t - runStart > 1.0) worst = Math.max(worst, dd - last) // 1 s'lik donus payindan sonra uzaklasma yok
    last = dd
  }
  const st = r.varStand()
  const s2 = { stage: r.varS?.stage, anim: g.referee.anim, d: Math.hypot(g.referee.x - st.x, g.referee.z - st.z) }
  g.emit({ type: 'var-decision', reason, verdict, marginCm: -10 })
  step(1.2, 0)
  const s3 = g.referee.anim
  step(1.6, 0)
  return { ...f, scored, s1, s2, s3, t, worst }
}
{
  const v = varGoal('gol')
  ok(v.scored, 'gol sayildi')
  ok(v.s1.phase === 'var' && v.s1.anim === 'var-listen', 'var-start: faz var, hakem kulaklikta')
  ok(v.s2.stage === 'monitor' && v.s2.anim === 'var-monitor' && v.s2.d < 0.6, `hakem monitorde (${v.t.toFixed(1)} s)`)
  ok(v.s3 === 'var-signal', 'TV isareti')
  ok(v.worst < 0.02 && v.t < 5, `run: monitore uzaklasma yok (${v.worst.toFixed(3)}), sure ${v.t.toFixed(1)} s`)
  ok(v.g.match.phase === 'stopped' && v.g.match.score[0] === 1, 'gol gecerli, skor duruyor')
  v.step(4)
  ok(v.g.match.phase === 'kickoff' && v.g.match.restart?.team === 1, 'baslama vurusu')
}
{
  const v = varGoal('ofsayt')
  ok(v.g.match.score[0] === 0, 'ofsayt: gol iptal')
  v.step(4)
  ok(v.g.match.phase === 'freekick' && v.g.match.restart?.team === 1 && Math.abs(v.ball.x - 11.8) < 1e-6, 'ofsayt yerinden savunmaya serbest vurus')
}
{
  const v = varGoal('gol-degil', 'line')
  ok(v.g.match.score[0] === 0, 'cizgi: gol degil')
  v.step(4)
  ok(v.g.match.phase === 'goalkick' && v.g.match.restart?.team === 1, 'kale vurusu')
}
{
  const v = varGoal('korner', 'line')
  v.step(4)
  ok(v.g.match.phase === 'corner' && v.g.match.restart?.team === 0 && v.g.match.score[0] === 0, 'cizgi: korner')
}

// ---------------------------------------------------------------- insan taker: kilit yok, 10 s icinde play
console.log('17) insan baslama vurusu: yurur ve oynar')
{
  const f = fresh()
  const { g, r, ball } = f
  ok(g.match.restart?.type === 'kickoff' && g.match.restart.taker === 3, 'kurulumda restart dolu, taker 3')
  ok(g.players[3].controlled, 'kontrol taker da')
  const x0 = g.players[3].x
  let t = 0
  let played = -1
  let walked = 0
  // W basili (dunya -x? ev +x'e hucum eder: ileri = +x), F girdisi -30'da, K -20'de
  for (; t < 10; t += DT) {
    if (t < 2) g.inputs[3].move = { x: 1, z: 0 }
    else g.inputs[3].move = { x: 0, z: 0 }
    r.pre(DT)
    const p = g.players[3]
    p.x += g.inputs[3].move.x * 6 * DT // basit locomotion
    p.z += g.inputs[3].move.z * 6 * DT
    if (t > 2.5 && t < 2.5 + DT * 1.5 && r.mode === 'ready') {
      // geri donup pas: top oynar
      g.emit({ type: 'touch', player: 3, kind: 'pass' })
      ball.vx = 2
    }
    if (t > 3) ball.vx = 0
    if (t > 2 && t < 2 + DT) walked = g.players[3].x - x0
    ball.x += ball.vx * DT
    r.post(DT)
    if (r.mode === 'play' && played < 0) played = t
  }
  ok(walked >= 2, `W ile >= 2 m ilerledi (${walked.toFixed(2)} m)`)
  ok(played >= 0 && played < 10, `10 s icinde play (${played.toFixed(2)} s)`)
}
{
  // yavas kare: oyun zamani 1/30 ile kirpilsa da (gdt << rdt) kurulum gercek zamanla biter
  const f = fresh()
  const { r } = f
  for (let t = 0; t < 3; t += 0.5) {
    r.pre(1 / 30)
    r.post(1 / 30, 0.5)
  }
  ok(r.mode === 'ready', 'yavas karede kurulum gercek zamanla biter')
}

// ---------------------------------------------------------------- insan taker W: topu surer, 3 s icinde play
console.log('18) insan taker W ile surer')
{
  const f = fresh()
  const { g, r, ball } = f
  const p = g.players[3]
  const x0 = p.x
  let played = -1
  let pulled = false
  for (let t = 0; t < 3; t += DT) {
    g.inputs[3].move = { x: 1, z: 0 } // F (-30): W = ileri (+x)
    r.pre(DT, DT)
    if (g.inputs[3].move.x < 0.99) pulled = t > 0.2 // 0.15 s sonra kurallar girdiyi ezmemeli
    p.x += g.inputs[3].move.x * 6 * DT
    // basit locomotion: topa ulasinca surme dokunusu, top onde gider
    if (Math.abs(ball.x - p.x) < 0.5 && g.match.phase !== 'play' && r.mode === 'ready') g.emit({ type: 'touch', player: 3, kind: 'dribble' })
    if (p.x > ball.x - 0.5) ball.x = p.x + 0.5
    r.post(DT, DT)
    if (r.mode === 'play' && played < 0) played = t
  }
  ok(!pulled, 'kurallar insan taker girdisini geri cekmedi')
  ok(played >= 0 && played < 3, `3 s icinde play (${played.toFixed(2)} s)`)
  ok(p.x - x0 >= 2, `>= 2 m ilerledi (${(p.x - x0).toFixed(2)} m)`)
}

console.log('19) omuz omuza')
ok(judgeContact(contact(1, 5, { kind: 'shoulder', intensity: 0.4 }), 0, 0.8).foul === false, 'topa oynanirken omuz yasal')
ok(judgeContact(contact(1, 5, { kind: 'shoulder', intensity: 0.4 }), 0, 4).foul === true, 'top uzakta omuz faul')
ok(judgeContact(contact(1, 5, { kind: 'shoulder', intensity: 0.4, fromBehind: true }), 0, 0.8).foul === true, 'arkadan omuz faul')
ok(judgeContact(contact(1, 5, { kind: 'shoulder', intensity: 0.75 }), 0, 0.8).foul === true, 'itme siddetinde faul')
// F'nin olctugu degerler
ok(judgeContact(contact(1, 5, { kind: 'shoulder', intensity: 0.2 }), 0, 1).foul === false, 'normal paralel mucadele (0.20) yasal')
ok(judgeContact(contact(1, 5, { kind: 'shoulder', intensity: 0.63 }), 0, 1).foul === false, 'sprintte sert yuklenme (0.63) yasal')
ok(judgeContact(contact(1, 5, { kind: 'shoulder', intensity: 0.62, fromBehind: true }), 0, 1).foul === true, 'arkadan itme (0.62) faul')

console.log('20) kaleci 3 saniye')
{
  const f = fresh()
  const { g, r, ball, step, startPlay } = f
  startPlay()
  const k = g.players[4]
  Object.assign(k, { x: 18, z: 0, hasBall: true })
  Object.assign(ball, { x: 18, z: 0, y: 1.0 })
  step(2.8)
  ok(r.mode === 'play', '2.8 s: oyun suruyor')
  step(0.4)
  ok(r.mode === 'stopped', '3 s asildi: duduk')
  k.hasBall = false
  ball.y = 0.11
  step(4)
  ok(g.match.phase === 'freekick' && g.match.restart?.team === 0, 'rakibe serbest vurus')
  ok(ball.x > HL - 8 && ball.x < HL && Math.abs(ball.z) < 8, 'ceza alani icinden (endirekt)')
}

console.log('21) duran top 3 s sayaci')
{
  // insan (ev) taci: sure dolunca ayni tur rakibe
  const f = fresh()
  const { g, r, ball, step, startPlay, touch, events } = f
  startPlay()
  Object.assign(ball, { x: 5, z: HW - 1, vz: 6 })
  touch(6) // deplasman son dokundu -> ev taci (insan)
  step(0.4)
  ball.vz = 0
  step(2.5)
  ok(r.mode === 'ready' && g.match.restart?.team === 0 && g.players[g.match.restart.taker].controlled, 'insan taci hazir')
  ok(r.countdown !== null && r.countdown > 2, 'sayac basladi')
  step(2)
  ok(r.countdown !== null && r.countdown < 1.1, 'sayac akiyor')
  step(1.2)
  ok(events.some((e) => e.type === 'whistle' && e.reason === 'timeout') && r.banner?.text === 'SÜRE DOLDU', 'sure doldu')
  step(3)
  ok(g.match.phase === 'kickin' && g.match.restart?.team === 1, 'tac rakibe gecti')
  ok(f.kicks.length === 0, 'insan icin yedek vurus yok')
}
{
  // YZ (deplasman) korneri: 3 s icinde yedek vurus, sure asimi yok
  const f = fresh()
  const { g, r, ball, step, startPlay, touch, events, kicks } = f
  startPlay()
  Object.assign(ball, { x: -HL + 1, z: 6, vx: -8 })
  touch(1) // ev defansi kendi kalesinin arkasina: deplasman kornesi
  step(0.3)
  ball.vx = 0
  step(2.5)
  ok(g.match.phase === 'corner' && g.match.restart?.team === 1 && r.mode === 'ready', 'YZ korneri hazir')
  step(3.1)
  ok(kicks.length === 1 && !events.some((e) => e.type === 'whistle' && e.reason === 'timeout'), 'YZ 3 s icinde vurdu')
}

console.log('22) top koruyana (shield) mudahale')
ok(judgeContact(contact(6, 3, { kind: 'tackle', fromBehind: true, intensity: 0.4 }), 0, 0.9, true).foul === false, 'koruyana arkadan topa uzanan orta siddet temiz')
ok(judgeContact(contact(6, 3, { kind: 'tackle', fromBehind: true, intensity: 0.4 }), 0, 0.9, false).foul === true, 'korumasiz arkadan topsuz mudahale faul')
ok(judgeContact(contact(6, 3, { kind: 'tackle', fromBehind: true, intensity: 0.7 }), 0, 0.9, true).foul === true, 'koruyana yuksek siddet faul')
ok(judgeContact(contact(6, 3, { kind: 'tackle', fromBehind: true, intensity: 0.4 }), 0, 2.5, true).foul === true, 'top menzil disi: topa oynanmadi faul')
ok(judgeContact(contact(6, 3, { kind: 'slide', fromBehind: true, intensity: 0.3 }), 0, 0.5, true).foul === true, 'koruyana arkadan kayma faul')
ok(judgeContact(contact(6, 3, { kind: 'shoulder', fromBehind: true, intensity: 0.4 }), 0, 0.8, true).foul === false, 'koruyana omuz yasal')

console.log('23) endirekt serbest vurus')
function indirectScene() {
  // ofsayt -> deplasmana endirekt serbest vurus; YZ taker
  const s = offsideScene(16)
  const { g, r, step } = s
  for (let i = 0; i < 400 && r.mode !== 'ready'; i++) step(DT)
  return s
}
{
  const s = indirectScene()
  const { g, r, ball, step, touch } = s
  ok(g.match.restart?.indirect === true && g.match.restart.team === 1, 'ofsayt serbest vurusu endirekt')
  ok(r.brain.gesture === 'indirect' && g.referee.anim === 'indirect', 'hakem kolu havada (indirect)')
  // taker dogrudan ev kalesine (-x) vurur: gol yok, kale vurusu
  const tk = g.match.restart.taker
  touch(tk)
  Object.assign(ball, { x: -HL + 1.5, z: 0.4, y: 0.5, vx: -15, vz: 0 })
  step(0.2)
  ok(g.match.score[1] === 0, 'dogrudan kaleye: gol sayilmadi')
  ball.vx = 0
  for (let i = 0; i < 400 && r.mode !== 'ready'; i++) step(DT)
  ok(g.match.phase === 'goalkick' && g.match.restart?.team === 0, 'kale vurusu verildi')
}
{
  const s = indirectScene()
  const { g, r, ball, step, touch } = s
  const tk = g.match.restart.taker
  touch(tk)
  ball.vx = -4
  step(0.2)
  ok(r.mode === 'play' && r.indirect?.taker === tk, 'endirekt suruyor')
  touch(g.players.find((p) => p.team === 1 && p.id !== tk && p.role !== 'kaleci').id) // baska oyuncu degdi
  step(DT)
  ok(r.indirect === null, 'baska oyuncu dokununca endirekt biter')
  step(DT)
  ok(g.referee.anim !== 'indirect', 'kol indi')
  Object.assign(ball, { x: -HL + 1.5, z: 0.4, y: 0.5, vx: -15, vz: 0 })
  step(0.2)
  ok(g.match.score[1] === 1, 'dokunustan sonra gol gecerli')
}
{
  // kaleci 3 s -> endirekt
  const f = fresh()
  const { g, r, ball, step, startPlay } = f
  startPlay()
  Object.assign(g.players[4], { x: 18, z: 0, hasBall: true })
  Object.assign(ball, { x: 18, z: 0, y: 1.0 })
  step(3.3)
  g.players[4].hasBall = false
  ball.y = 0.11
  for (let i = 0; i < 400 && r.mode !== 'ready'; i++) step(DT)
  ok(g.match.restart?.indirect === true, 'kaleci 3 s serbest vurusu endirekt')
}

console.log('24) duraklamada kaleci topu birakir')
{
  const f = fresh()
  const { g, r, ball, step, startPlay, releases } = f
  startPlay()
  const k = g.players[4]
  Object.assign(k, { x: 18, z: 0, hasBall: true })
  Object.assign(ball, { x: 18, z: 0, y: 1.0 })
  step(2.0) // 2 s tutuldu
  // sahanin baska yerinde faul: oyun durur
  g.emit(contact(6, 2, { kind: 'tackle', intensity: 0.5, x: -5, z: 3 }))
  step(0.1)
  ok(r.mode === 'stopped' && !k.hasBall && releases.length >= 1, 'duraklamada kaleci birakti (hasBall false, holdBall(false))')
  ball.y = 0.11
  for (let i = 0; i < 400 && r.mode !== 'ready'; i++) step(DT)
  ok(Math.abs(ball.x + 5) < 1e-6 && Math.abs(ball.z - 3) < 1e-6, 'top faul yerinde')
  ok(g.match.restart?.taker !== 4, 'taker kural geregi en yakin saha oyuncusu')
  // oyun yeniden basladiktan sonra kaleci tekrar tutarsa sayac sifirdan
  ball.vx = 3
  step(0.3)
  ball.vx = 0
  Object.assign(k, { hasBall: true })
  Object.assign(ball, { x: 18, z: 0, y: 1.0 })
  step(2.0)
  ok(r.mode === 'play', 'sayac sifirlandi: 2 s + 2 s tutusta duduk yok')
  step(1.2)
  ok(r.mode === 'stopped', '3 s asilinca duduk')
}

console.log(`\n${pass} gecti, ${fail} basarisiz`)
process.exit(fail ? 1 : 0)
