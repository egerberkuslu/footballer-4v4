// Kirmizi kart cezasi testi: 4'e 3 iken AI cezaliya pas vermiyor, donunce 2 s sonra normale donuyor.
// npx -y tsx scripts/ai-susp.mjs [tohum_sayisi=4]
import './ai-env.mjs'
import { world } from '../src/sim.ts'
import { game } from '../src/game/store.ts'
import { Rules } from '../src/rules/engine.ts'
import { updateAI, resetAI, aiStats } from '../src/ai/brain.ts'
import { seedAI, setAiLevel } from '../src/ai/config.ts'
import { stepLocomotion } from '../src/control/locomotion.ts'

const N = Number(process.argv[2] ?? 4)
const DT = 1 / 60
let bad = 0
let afterOk = 0
const rows = []
for (let seed = 1; seed <= N; seed++) {
  for (const who of ['saha', 'kaleci']) {
    let s = seed
    Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    seedAI(seed); setAiLevel('orta'); world.seed(seed); resetAI()
    game.humanTeam = null
    for (const p of game.players) p.controlled = false
    const rules = new Rules({ game, ball: () => world.ball, placeBall: (x, z) => world.placeBall(x, z), kick: (v, w) => world.kick(v, w), halfLength: 150 })
    rules.start?.()
    let t = 0
    const step = () => { t += DT; updateAI(DT); rules.pre(DT); stepLocomotion(DT); world.side = world.ball.x >= 0 ? 1 : -1; world.step(DT); rules.post(DT) }
    for (let f = 0; f < 60 * 10; f++) step()
    const v = game.players.find((p) => p.team === 0 && (who === 'kaleci' ? p.role === 'kaleci' : p.role === 'orta'))
    const vid = v.id
    let retT = -1
    const un = game.on((e) => { if (e.type === 'player-return' && e.player === vid) retT = t })
    const logStart = aiStats.passLog.length
    rules.suspend(v)
    let passDuring = 0
    let passRet2 = 0
    let passAfter = 0
    let n = 0
    let minD = 99
    let nS = 0
    let nClose = 0
    let keeperAbsent = 0
    let fr = 0
    for (let f = 0; f < 60 * 50; f++) {
      step()
      if (retT < 0 && ++fr % 30 === 0 && f > 60 * 5) {
        const m3 = game.players.filter((p) => p.team === 0 && !p.sentOff)
        const fld = m3.filter((p) => p.role !== 'kaleci')
        let sm = 99
        for (let i = 0; i < fld.length; i++) for (let j = i + 1; j < fld.length; j++) sm = Math.min(sm, Math.hypot(fld[i].x - fld[j].x, fld[i].z - fld[j].z))
        nS++
        if (sm < 3) nClose++
        for (let i = 0; i < fld.length; i++) for (let j = i + 1; j < fld.length; j++) minD = Math.min(minD, Math.hypot(fld[i].x - fld[j].x, fld[i].z - fld[j].z))
        const k = m3.find((p) => p.role === 'kaleci')
        if (!k || Math.abs(k.x) < 12) keeperAbsent++
      }
      while (aiStats.passLog.length > logStart + n) {
        const e = aiStats.passLog[logStart + n++]
        if (e.id !== vid) continue
        if (retT < 0) passDuring++
        else if (t - retT < 2) passRet2++
        else passAfter++
      }
    }
    un()
    const alive = game.players.filter((p) => p.team === 0 && !p.sentOff).length
    const kp = game.players.filter((p) => p.team === 0 && p.role === 'kaleci').length
    if (passDuring || passRet2) bad++
    if (retT > 0) afterOk++
    rows.push(`tohum ${seed} ${who}: ceza sirasinda pas ${passDuring}, donus sonrasi ilk 2 s ${passRet2}, sonra ${passAfter}, donus ${retT > 0 ? retT.toFixed(0) + ' s' : 'yok'}, sahada ${alive}, saha oyunculari <3 m orani ${((100 * nClose) / (nS || 1)).toFixed(0)}% (min ${minD.toFixed(1)} m), kale bos ornek ${keeperAbsent}, kaleci sayisi ${kp}`)
  }
}
console.log(rows.join('\n'))
console.log(`ihlal ${bad}/${N * 2}, donen ${afterOk}/${N * 2}`)
