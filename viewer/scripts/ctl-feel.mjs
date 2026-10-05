// F: top surme ve savunma "his" olcumu (Node, render yok). Kullanim: npx -y tsx scripts/ctl-feel.mjs
// Olculenler: yakin kontrolde top mesafesi, 90 derece donuste topun kacma orani (yakin/sprint), girdi gecikmesi,
// durma (top kacmiyor mu), ayakta mudahalenin mesafeye gore basari egrisi, kayarak mudahale menzili.
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { stepLocomotion, setControlled } from '../src/control/locomotion.ts'

const DT = 1 / 60
const P = game.players
let seed = 11
Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
game.match.phase = 'play'
const ev = []
game.on((e) => ev.push(e))
const step = (n, fn) => {
  for (let i = 0; i < n; i++) {
    fn && fn(i)
    stepLocomotion(DT)
    world.step(DT)
  }
}
const inp = (id) => game.inputs[id]
function reset() {
  for (const q of P) {
    Object.assign(q, { x: -16 - q.id * 1.6, z: 11.5, vx: 0, vz: 0, hasBall: false, actionLock: 0, anim: 'idle', stamina: 1, facing: 0 })
    game.inputs[q.id] = { move: { x: 0, z: 0 }, sprint: false, action: null }
  }
  world.placeBall(0, 0)
  ev.length = 0
  step(40) // eski aksiyon/kilit/hayalet sureleri dolsun
}
const A = P[3] // surucu (insan)
const D = P[5] // savunmaci
/** A'ya topu ver (+x yonune bakar) */
function giveBall(x = 0, z = 0) {
  reset()
  Object.assign(A, { x, z, facing: Math.PI / 2 })
  setControlled(A.id)
  world.placeBall(x + 0.45, z)
  step(4)
}
const pct = (a, n) => `${Math.round((100 * a) / n)}%`
const out = {}

// 1) yakin kontrol: 4 s duz + zikzak, top mesafesi dagilimi
{
  giveBall()
  const ds = []
  let lost = 0
  step(240, (i) => {
    const t = i * DT
    inp(A.id).move = t < 2 ? { x: 1, z: 0 } : { x: 0.7, z: Math.sin(t * 3) * 0.7 }
    if (i > 30) {
      if (A.hasBall) ds.push(Math.hypot(world.ball.x - A.x, world.ball.z - A.z))
      else lost++
    }
  })
  ds.sort((a, b) => a - b)
  const q = (f) => ds[Math.floor(f * (ds.length - 1))]?.toFixed(2)
  const inBand = ds.filter((d) => d >= 0.3 && d <= 0.65).length
  out.yakinKontrol = { p10: q(0.1), p50: q(0.5), p90: q(0.9), bant_0_3_0_65: pct(inBand, ds.length || 1), sahipsizKare: lost, hiz: +Math.hypot(A.vx, A.vz).toFixed(2) }
}

// 2) 90 derece donus: kacma orani (yakin kontrol / sprint), 40'ar deneme
for (const sprint of [false, true]) {
  let escaped = 0
  const N = 40
  for (let k = 0; k < N; k++) {
    giveBall()
    const pre = sprint ? 90 : 70
    const side = k % 2 ? 1 : -1
    step(pre, () => {
      inp(A.id).move = { x: 1, z: 0 }
      inp(A.id).sprint = sprint
    })
    step(60, () => {
      inp(A.id).move = { x: 0.15, z: side }
      inp(A.id).sprint = sprint
    })
    if (!A.hasBall || Math.hypot(world.ball.x - A.x, world.ball.z - A.z) > 2.2) escaped++
  }
  out[sprint ? 'donus90_sprint_kacma' : 'donus90_yakin_kacma'] = pct(escaped, N)
}

// 3) girdi gecikmesi: kosarken yonu 90 derece degistir; hiz yonu yeni yone 20 derece icinde girene dek sure
{
  reset()
  Object.assign(A, { x: 0, z: 0, facing: Math.PI / 2 })
  step(60, () => (inp(A.id).move = { x: 1, z: 0 }))
  let tTurn = -1
  let tHalf = -1
  step(60, (i) => {
    inp(A.id).move = { x: 0, z: 1 }
    const sp = Math.hypot(A.vx, A.vz)
    const ang = Math.abs(Math.atan2(A.vx, A.vz))
    if (tTurn < 0 && sp > 0.5 && ang < (20 * Math.PI) / 180) tTurn = (i + 1) * DT
    if (tHalf < 0 && A.vz > 3) tHalf = (i + 1) * DT
  })
  // duruştan kalkis
  reset()
  Object.assign(A, { x: 0, z: 0, facing: 0 })
  let t50 = -1
  step(60, (i) => {
    inp(A.id).move = { x: 1, z: 0 }
    if (t50 < 0 && Math.hypot(A.vx, A.vz) > 3.1) t50 = (i + 1) * DT
  })
  out.gecikme = { yon90_20derece_s: +tTurn.toFixed(2), yon90_3ms_s: +tHalf.toFixed(2), kalkis_yariHiz_s: +t50.toFixed(2) }
}

// 4) durma: topla kosarken tus birakilir; top oyuncudan kaciyor mu
{
  giveBall()
  step(90, () => (inp(A.id).move = { x: 1, z: 0 }))
  step(90, () => (inp(A.id).move = { x: 0, z: 0 }))
  out.durma = { sahip: A.hasBall, topMesafe: +Math.hypot(world.ball.x - A.x, world.ball.z - A.z).toFixed(2), topHizi: +Math.hypot(world.ball.vx, world.ball.vz).toFixed(2) }
}

// 5) ayakta mudahale: surucu D'ye dogru 4 m/s gelir; D tetikleme anindaki mesafeye gore basari
{
  const curve = []
  for (const dist of [0.8, 1.1, 1.4, 1.7, 2.0, 2.4, 3.0]) {
    let ok = 0
    const N = 10
    for (let k = 0; k < N; k++) {
      giveBall(-6, 0)
      Object.assign(D, { x: 0, z: (k - 5) * 0.03, facing: -Math.PI / 2 })
      let fired = -1
      let won = false
      step(200, (i) => {
        inp(A.id).move = { x: 0.65, z: 0 }
        if (fired < 0 && Math.hypot(world.ball.x - D.x, world.ball.z - D.z) <= dist) {
          fired = i
          inp(D.id).action = { type: 'tackle', power: 0, aim: { x: world.ball.x, y: 0, z: world.ball.z } }
        }
        // basari: mudahaleden 0.5 s sonra D topu aldi ya da top A'dan cikti
        if (fired >= 0 && i === fired + 30) won = D.hasBall || !A.hasBall
      })
      if (won) ok++
    }
    curve.push(`${dist} m: ${pct(ok, N)}`)
  }
  out.ayaktaMudahale = curve
}

// 5c) tasiyiciya karsi ayakta mudahale: topa ulasma (menzil), iska orani, iskada govde temasi (= faul adayi) orani
{
  const rows = []
  const modes = {
    onden: () => { Object.assign(D, { x: 0, z: 0, facing: -Math.PI / 2 }) },
    capraz: () => { Object.assign(D, { x: 0, z: 1.1, facing: -Math.PI / 2 }) },
    arkadan: () => { Object.assign(D, { x: -9.5, z: 0, facing: Math.PI / 2 }) },
  }
  for (const [mode, place] of Object.entries(modes)) {
    for (const dist of [0.8, 1.1, 1.4, 1.7, 2.0]) {
      let fired = 0, won = 0, contacts = 0, clean = 0, foulish = 0, hard = 0
      const N = 20
      for (let k = 0; k < N; k++) {
        giveBall(-6, 0)
        place()
        D.z += (k - 10) * 0.03
        ev.length = 0
        let f = -1
        step(220, (i) => {
          inp(A.id).move = { x: 0.65, z: 0 }
          if (mode === 'arkadan') { inp(D.id).move = { x: 1, z: 0 }; inp(D.id).sprint = true }
          if (f < 0 && D.actionLock <= 0 && Math.hypot(world.ball.x - D.x, world.ball.z - D.z) <= dist) {
            f = i
            inp(D.id).move = { x: 0, z: 0 }
            inp(D.id).sprint = false
            inp(D.id).action = { type: 'tackle', power: 0, aim: { x: world.ball.x, y: 0, z: world.ball.z } }
          }
          if (f >= 0 && i === f + 30) {
            fired++
            if (D.hasBall || !A.hasBall) won++
          }
        })
        for (const e of ev) {
          if (e.type === 'contact' && e.a === D.id && e.kind === 'tackle') {
            contacts++
            if (e.ballFirst) clean++
            else foulish++
            if (e.intensity >= 0.6) hard++
          }
        }
      }
      rows.push(`${mode} ${dist} m: tetik ${fired}/${N}, topu ${pct(won, fired || 1)}, temas ${contacts} (ballFirst ${clean}, topsuz ${foulish}, siddet>=0.6: ${hard}), topsuz-temas orani ${pct(foulish, fired || 1)}`)
    }
  }
  out.mudahaleTasiyici = rows
}

// 5b) ayakta mudahale, durgun top (saf menzil)
{
  const r = []
  for (const dist of [0.6, 0.9, 1.1, 1.3, 1.5, 1.8]) {
    reset()
    world.placeBall(0, 0)
    Object.assign(D, { x: -dist, z: 0, facing: Math.PI / 2 })
    inp(D.id).action = { type: 'tackle', power: 0, aim: { x: 0, y: 0, z: 0 } }
    ev.length = 0
    step(30)
    r.push(`${dist} m: ${ev.some((e) => e.type === 'touch' && e.player === D.id && e.kind === 'tackle') ? 'ulasti' : 'iska'}`)
  }
  out.ayaktaMenzil_durgun = r
}

// 5c) jockey: surucu D'nin kalesine (D takim 1, kendi kalesi +x) yuruyerek gelir; D E basili
{
  giveBall(0, 0)
  Object.assign(D, { x: 4, z: 0.5, facing: -Math.PI / 2 })
  const ds = []
  let between = 0
  let n = 0
  step(180, (i) => {
    inp(A.id).move = { x: 0.55, z: Math.sin(i * 0.05) * 0.4 }
    game.inputs[D.id].jockey = true
    if (i > 40) {
      n++
      ds.push(Math.hypot(D.x - A.x, D.z - A.z))
      if (D.x > A.x) between++
    }
  })
  ds.sort((a, b) => a - b)
  out.jockey = { mesafe_p10: ds[Math.floor(ds.length * 0.1)].toFixed(2), p50: ds[Math.floor(ds.length / 2)].toFixed(2), p90: ds[Math.floor(ds.length * 0.9)].toFixed(2), kaleTarafinda: pct(between, n), anim: D.anim }
}

// 6) kayarak mudahale menzili: durgun topa farkli mesafelerden
{
  const r = []
  for (const dist of [1.5, 2.5, 3.0, 3.5, 4.0, 4.5, 5.5]) {
    reset()
    world.placeBall(0, 0)
    Object.assign(D, { x: -dist, z: 0, facing: Math.PI / 2 })
    inp(D.id).action = { type: 'slide', power: 0, aim: { x: 0, y: 0, z: 0 } }
    ev.length = 0
    step(90)
    const hit = ev.some((e) => e.type === 'touch' && e.player === D.id && e.kind === 'tackle')
    r.push(`${dist} m: ${hit ? 'temas' : 'iska'}${hit ? ' top ' + Math.hypot(world.ball.vx, world.ball.vz).toFixed(1) + ' m/s' : ''}`)
  }
  out.kaymaMenzil = r
}

console.log(JSON.stringify(out, null, 1))
