// Takim yapay zekasi: 4'e 4, iki takim. Yalniz game.inputs[id] yazar (insan kontrolundekiler haric).
// Karar takim basina decideHz ile (5-10 Hz), hareket girdisi her kare hedeften uretilir.
import { CURL_W } from '../control/aim'
import { GOAL_H, GOAL_W, PITCH_L, PITCH_W } from '../pitch'
import { game } from '../game/store'
import { world } from '../sim'
import type { ActionType, Player, PlayerInput, Restart, TeamId } from '../game/types'
import { isRemoteHuman } from '../mp/role'
import { AI, type AiTuning, gauss, rnd, tuneFor } from './config'
import { diveReachable } from '../sim/keeperDive'
import { PASS_CONTACT, PRED_H, PRED_N, avgPassSpeed, pred, predictBall } from './predict'

// etkin takim ayari (her takim isleminden once use(team))
let T: AiTuning = AI
const use = (team: TeamId) => (T = tuneFor(team, game.humanTeam))
const HL = PITCH_L / 2
const HW = PITCH_W / 2
const GW = GOAL_W / 2
const BOX_D = 8
const BOX_W = 8 // yari genislik
const RUN_V = 6.2 // kosu hizi (control/locomotionApi RUN_SPEED)
const SPRINT_V = 8.0
/** durgun baslayan oyuncunun x metreyi alma suresi (locomotion ACCEL 20 ama donus/engel payi: etkin ~12, kosu 6.2 m/s) */
const ACC = 12
const X_ACC = (RUN_V * RUN_V) / (2 * ACC)
const runTime = (x: number) => (x <= 0 ? 0 : x < X_ACC ? Math.sqrt((2 * x) / ACC) : RUN_V / ACC + (x - X_ACC) / RUN_V)
// sut hizini F'nin power olcegine cevirir (locomotionApi: shoot power 0..1 -> 8..34 m/s)
export const KICK_V_MIN = 8
export const KICK_V_MAX = 34
export const speedToPower = (v: number) => Math.min(1, Math.max(0, (v - KICK_V_MIN) / (KICK_V_MAX - KICK_V_MIN)))

interface Act {
  type: ActionType
  power: number
  x: number
  y: number
  z: number
  curl?: number // falso -3..+3 (+: top +z'ye kivrilir, cikis dogrusu merkeze bakar)
  until: number // bu zamana kadar (ya da tuketilene kadar) gonderilir
  sent: boolean // girdiye yazildi (locomotion ayni karede tuketir)
}

interface Brain {
  tx: number
  tz: number
  sprint: boolean
  speed: number // 0..1 hareket buyuklugu ust siniri
  act: Act | null
  holdUntil: number // top alindiktan sonra en az bu zamana kadar sur (pas zinciri ping-pong olmasin)
  receiveUntil: number // pas bekleniyor: hedef noktaya kos
  rx: number
  rz: number
  cool: number // mudahale bekleme
  jx: number // canli gorunum icin yavas degisen konum sapmasi
  jz: number
  jT: number
  hadBall: boolean
  keeperHoldT: number
  holdStart: number // kalecinin topu ele aldigi an (<0 yok); 3 s kurali icin sert sayac
  wasCarrying: boolean
  hold: number
  duel: boolean // topa yarista omuz omuza mucadeleye gir (rakipten kacinma yok)
  shieldT: number // top korumaya baslama zamani (<0 yok)
  checkAt: number // sonraki kopma kosusu en erken zamani
  checkUntil: number
  cx: number
  cz: number
  noTackle: number // faul yaptiktan sonra bu zamana kadar yalniz jockey ile baski
  jockey: boolean // baski: locomotion jockey durusu (rakibe donuk, 1,5 m mesafe tutar)
}

const newBrain = (): Brain => ({
  tx: 0,
  tz: 0,
  sprint: false,
  speed: 1,
  act: null,
  holdUntil: 0,
  receiveUntil: 0,
  rx: 0,
  rz: 0,
  cool: 0,
  jx: 0,
  jz: 0,
  jT: 0,
  hadBall: false,
  keeperHoldT: 0,
  holdStart: -1,
  wasCarrying: false,
  hold: 0.7,
  duel: false,
  shieldT: -1,
  checkAt: 0,
  checkUntil: 0,
  cx: 0,
  cz: 0,
  noTackle: 0,
  jockey: false,
})

const brains: Brain[] = []
let t = 0
const nextDecide: [number, number] = [0, 0.07]
const trapUntil: [number, number] = [0, 0]
// kalecinin algiladigi sut (tepki gecikmesi icin)
const threat: [number, number] = [-1, -1] // algilanma zamani, -1 yok
const threatMiss: [boolean, boolean] = [false, false] // bu sutu gec gordu (kolayda sik)
let lastPhase = ''
let lastRestart: Restart | null = null
let restartT = 0
let takerDelay = 1 // bu duran topta vurmadan once bekleme (s), kural en fazla 3 s
let tick = 0
// istatistik/ayiklama icin disari acik
export const aiStats = { passCancel: 0, intent: [] as ({ rid: number; ax: number; az: number; margin: number; lob: boolean; t: number } | undefined)[], carrier: {} as Record<string, number>, passLog: [] as { id: number; margin: number; d: number; lob: boolean }[], riskyMargins: [] as number[], decisions: 0, curls: 0, shotLog: [] as { curl: number; d: number; t: number }[], passes: 0, shots: 0, lobs: 0, tackles: 0, slides: 0, tkLog: [] as { id: number; t: number; bd: number; sp: number }[], dives: 0, ms: 0, msMax: 0 }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const inField = (b: Brain, m = 0.8) => {
  b.tx = clamp(b.tx, -HL + m, HL - m)
  b.tz = clamp(b.tz, -HW + m, HW - m)
}
const active = (p: Player) => !p.sentOff
/** insan oynuyor (yerel ya da cok oyunculuda uzak): AI girdi yazmaz, ama takim arkadasi sayilir */
const human = (p: Player) => p.controlled || isRemoteHuman(p.id) || !!game.remote?.has(p.id)
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz)

export function resetAI() {
  indirectTaker = -1
  for (const k of Object.keys(retUntil)) delete retUntil[Number(k)]
  brains.length = 0
  t = 0
  nextDecide[0] = 0
  nextDecide[1] = 0.07
  trapUntil[0] = trapUntil[1] = 0
  humanKick = null
  threat[0] = threat[1] = -1
  threatMiss[0] = threatMiss[1] = false
  lastPhase = ''
  lastRestart = null
  restartT = 0
  takerDelay = 1
  tick = 0
}

function brainOf(id: number): Brain {
  while (brains.length <= id) {
    // yeni beyin: hedef oyuncunun kendi yeri (yoksa herkes orta noktaya yurur)
    const b = newBrain()
    const p = game.players[brains.length]
    if (p) {
      b.tx = p.x
      b.tz = p.z
    }
    brains.push(b)
  }
  return brains[id]
}

// --- yardimcilar
const dirOf = (team: TeamId) => game.match.attackDir[team]
const teamOf = (team: TeamId) => game.players.filter((p) => p.team === team && active(p))
const keeperOf = (team: TeamId) => game.players.find((p) => p.team === team && p.role === 'kaleci' && active(p))

/** ofsayt: hucum yonunde isaretli (dir*x) en ileri izinli govde merkezi.
 *  K'nin olcumu: on (dir*x + 0.25) > max(sondan ikinci rakip, top); kendi yari sahasinda ofsayt yok. */
const TK_MAXV = 3.4 // tasiyici bu hizdan hizliysa ayakta mudahale denenmez (olculen temas ~%0-20); jockey ile surup yavaslamasini bekler
const DIVE_ANY = false // true: menzil disi tahminde de kaleye giden sutta dal (maç basina 14-19 dalis, hepsi ıska); false: yalniz planDive menzilindeki sutlara dal (~0-1)
const TK_R = 1.15 // tahmini top mesafesi siniri (m)
const TK_LEAD = 0.18 // mudahale temas gecikmesi (s)
const OFF_BODY = 0.25
function onsideMax(team: TeamId, bx: number): number {
  const d = dirOf(team)
  let a = -1e9
  let b2 = -1e9
  for (const o of game.players) {
    if (o.team === team || !active(o)) continue
    const v = d * o.x + OFF_BODY
    if (v > a) {
      b2 = a
      a = v
    } else if (v > b2) b2 = v
  }
  return Math.max(b2, d * bx + OFF_BODY, 0) - OFF_BODY
}

/** oyuncunun topa ulasma suresi (tahmin orneklerinden) */
function interceptTime(p: Player, keeper = false): { t: number; x: number; z: number } {
  const reach = keeper ? 2.0 : 0.9
  const v = SPRINT_V
  for (let i = 0; i < PRED_N; i++) {
    const y = pred[i * 3 + 1]
    if (y > reach) continue
    const bx = pred[i * 3]
    const bz = pred[i * 3 + 2]
    const ti = i * PRED_H
    const d = dist(p.x, p.z, bx, bz) - 0.5
    if (d <= v * Math.max(0, ti - 0.15)) return { t: ti, x: bx, z: bz }
  }
  const i = PRED_N - 1
  const bx = pred[i * 3]
  const bz = pred[i * 3 + 2]
  return { t: 3 + dist(p.x, p.z, bx, bz) / v, x: bx, z: bz }
}

/** pas yolu: rakibin topu kesme payi (s); negatif = kesilir */
function laneMargin(team: TeamId, sx: number, sz: number, ex: number, ez: number, lob: boolean): number {
  const L = dist(sx, sz, ex, ez)
  const vb = lob ? L / Math.max(0.8, L / 14) : avgPassSpeed(L)
  let worst = 9
  for (const o of game.players) {
    if (o.team === team || !active(o)) continue
    // segment uzerinde en yakin nokta
    const ux = (ex - sx) / (L || 1)
    const uz = (ez - sz) / (L || 1)
    let s = (o.x - sx) * ux + (o.z - sz) * uz
    s = clamp(s, 0, L)
    if (lob && s < L - 3) continue // asirtmada yalniz inis bolgesi kesilebilir
    const px = sx + ux * s
    const pz = sz + uz * s
    const reach = o.role === 'kaleci' ? 1.6 : 1.1 // ayak noktasi 0.4 m onde + trap 0.55 + uzanma
    // pasorun yanindaki rakip ayagini uzatir: tepki payi kisa mesafede kucuk
    // rakip o noktaya dogru kosuyorsa yolun bir kismini zaten aliyor
    const od = dist(o.x, o.z, px, pz)
    const vTo = od > 0.01 ? Math.max(0, (o.vx * (px - o.x) + o.vz * (pz - o.z)) / od) : 0
    const tOpp = runTime(od - reach - vTo * 0.35) + 0.1 + 0.15 * Math.min(1, s / 3)
    const tBall = PASS_CONTACT + s / vb
    let mg = tOpp - tBall
    // olculen kayiplarin %40'i pasordan ~3 m icinde 0.5 s'de kesme: yakin rakip pas yonune
    // 50 derece koni icindeyse vurus temasi beklenirken araya girer
    if (!lob) {
      // rakibin vurus temasi (~0.4 s) sonraki yeri: kosarak pas yoluna girer
      const ox = o.x + o.vx * 0.4
      const oz = o.z + o.vz * 0.4
      const od0 = dist(ox, oz, sx, sz)
      if (od0 < 4) {
        const cosA = ((ox - sx) * ux + (oz - sz) * uz) / (od0 || 1)
        if (cosA > 0.64) mg = Math.min(mg, -0.3 + (od0 - 1) * 0.15 + (1 - cosA) * 0.8)
      }
    }
    worst = Math.min(worst, mg + gauss() * T.misjudge)
  }
  return worst
}

const nearestOpp = (p: Player) => {
  let best: Player | null = null
  let bd = 1e9
  for (const o of game.players) {
    if (o.team === p.team || !active(o)) continue
    const d = dist(o.x, o.z, p.x, p.z)
    if (d < bd) {
      bd = d
      best = o
    }
  }
  return { o: best, d: bd }
}

function setAct(b: Brain, type: ActionType, power: number, x: number, y: number, z: number, hold = 0.3) {
  // bekleme suresi kilit (ilk dokunus/animasyon) bitene dek: en az 0.7 s
  b.act = { type, power, x, y, z, until: t + Math.max(hold, 0.7), sent: false }
}

// ---------------------------------------------------------------- top surucu
interface PassOpt {
  mate: Player
  x: number
  z: number
  score: number
  margin: number
  lob: boolean
  d: number
}

function bestPass(p: Player, allowKeeper: boolean, longOk = false): PassOpt | null {
  const dir = dirOf(p.team)
  const onMax = onsideMax(p.team, world.ball.x)
  let best: PassOpt | null = null
  for (const m of teamOf(p.team)) {
    if (m === p || returning(m)) continue
    if (m.role === 'kaleci' && !allowKeeper) continue
    // ofsayt: vurus temasi ~0.15 s sonra olculur; kosucunun o anki yeri (pasorun gozu yanilabilir)
    const ahead = dir * (m.x + m.vx * 0.2) - onMax + gauss() * T.lineErr * 0.3
    if (ahead > 0) continue
    const opts: [number, number, boolean][] = [
      // kosu yonune onden pas
      [clamp(m.x + m.vx * 0.45, -HL + 1.5, HL - 1.5), clamp(m.z + m.vz * 0.45, -HW + 2, HW - 2), false],
    ]
    // cizgideki kosucu: savunmanin arkasina pas (kosu pasla baslar)
    if (ahead > -2.5 && m.role !== 'kaleci' && dir * m.x > 0) {
      opts.push([clamp(m.x + dir * 5.5, -HL + 2.5, HL - 2.5), clamp(m.z * 0.85, -HW + 2.5, HW - 2.5), true])
    }
    for (const [lx, lz, through] of opts) {
      const d = dist(p.x, p.z, lx, lz)
      if (d < 3.5 || d > (longOk ? 34 : 24)) continue
      if (through) {
        // alici topa yetisebilmeli
        const tRecv = dist(m.x, m.z, lx, lz) / SPRINT_V + 0.3
        if (tRecv > d / avgPassSpeed(d) + 0.5) continue
      }
      let open = 9
      for (const o of game.players) if (o.team !== p.team && active(o)) open = Math.min(open, dist(o.x, o.z, lx, lz))
      const ground = laneMargin(p.team, p.x, p.z, lx, lz, false)
      const lobM = d > 9 ? laneMargin(p.team, p.x, p.z, lx, lz, true) - 0.25 : -9
      const lob = ground < 0.15 && lobM > 0.25 && d > 11
      // varis noktasi yarisi: alici oraya en yakin rakipten once ulasir mi (ikisi de simdi kalkar;
      // rakip tepki payi 0.2 s). Asirtmada top havadayken rakip ayarlanir: ek 0.3 s ceza
      const tRecv = runTime(dist(m.x, m.z, lx, lz) - 0.5)
      let oppEnd = 9
      for (const o of game.players) {
        if (o.team === p.team || !active(o)) continue
        oppEnd = Math.min(oppEnd, runTime(dist(o.x, o.z, lx, lz) - (o.role === 'kaleci' ? 1.6 : 0.9)) + 0.2)
      }
      const contest = oppEnd - tRecv - (lob ? 0.3 : 0)
      const margin = Math.min(lob ? lobM : ground, contest + 0.15)
      const progress = (lx - p.x) * dir
      const threatPos = (lx * dir) / HL // kaleye yakinlik
      let score = progress * 0.35 + Math.min(open, 6) * 0.55 + threatPos * 2.2 + Math.min(margin, 0.6) * 4 + (through ? 1.2 : 0)
      if (margin < 0.05) score -= 6
      // uzun pas riskli: ilk dokunus ve kesme olasiligi mesafeyle artar
      if (d > 12) score -= (d - 12) * 0.18
      // asirtma son care (ilk dokunus zor, inis bolgesi cekismeli); kisa yerden pas oyunun ozu
      if (lob) score -= 3
      else if (d < 11) score += 1
      if (m.role === 'kaleci') score -= 2.5
      if (!best || score > best.score) best = { mate: m, x: lx, z: lz, score, margin, lob, d }
    }
  }
  return best
}

/** tasiyici savunmaciya dogru mu ilerliyor (kayarak mudahale ancak onden) */
function approaching(c: Player, p: Player): boolean {
  const dx = p.x - c.x
  const dz = p.z - c.z
  const d = Math.hypot(dx, dz) || 1
  return (c.vx * dx + c.vz * dz) / d > 0.5
}

/** jockey sirasinda her karede: top ayaktan acilip menzile girince onden mudahale (arkadan asla) */
function jockeyTackle(p: Player, b: Brain, gdt: number) {
  if (b.act || p.actionLock > 0 || t < b.cool || t < b.noTackle) return
  const c = game.players.find((q) => q.hasBall && q.team !== p.team)
  if (!c || (c.role === 'kaleci' && (world.ball.y > 0.3 || Math.abs(c.x) > HL - BOX_D))) return
  const bl = world.ball
  const bd = dist(p.x + p.vx * TK_LEAD * 0.5, p.z + p.vz * TK_LEAD * 0.5, bl.x + bl.vx * TK_LEAD, bl.z + bl.vz * TK_LEAD)
  const cd = dist(c.x, c.z, bl.x, bl.z)
  // top rakip ayagindan acildi (>0.8 m) ve bize yakin
  if (bd > TK_R || cd < 0.3 || bl.y > 0.5 || Math.hypot(c.vx, c.vz) >= TK_MAXV) return
  const fx = Math.sin(c.facing)
  const fz = Math.cos(c.facing)
  if ((p.x - c.x) * fx + (p.z - c.z) * fz < 0.2) return // rakibin onunde degiliz: girme
  if (c.anim === 'shield') return
  // karar basina degil saniyede: seviye tackleP'si ~0.15 s icinde karar verir
  if (rnd() < T.tackleP * Math.min(1, gdt * 7)) {
    setAct(b, 'tackle', 0.6, bl.x + bl.vx * TK_LEAD, 0, bl.z + bl.vz * TK_LEAD, 0.2)
    b.cool = t + 2.1 + rnd() * 0.5
    aiStats.tackles++
    aiStats.tkLog.push({ id: p.id, t, bd, sp: Math.hypot(c.vx, c.vz) })
  }
}

/** kaleye sut degerlendirmesi: hedef kose, isabet olasiligi kabasi */
function shotOption(p: Player, maxD = 22) {
  const dir = dirOf(p.team)
  const gx = dir * HL
  const d = dist(p.x, p.z, gx, 0)
  if (d > maxD || (gx - p.x) * dir < 1) return null
  const k = keeperOf((1 - p.team) as TeamId)
  let best = { z: 0, q: -1, y: 0.4, clear: false }
  for (const s of [-1, 1]) {
    const z = s * (GW - 0.32)
    // kaleciye uzaklik (kose bosluğu)
    const gap = k ? Math.abs(z - k.z) + Math.abs(gx - k.x) * 0.3 : 3
    // sut yolu: savunmaci engeli
    let block = 0
    const L = dist(p.x, p.z, gx, z)
    const ux = (gx - p.x) / L
    const uz = (z - p.z) / L
    for (const o of game.players) {
      if (o.team === p.team || !active(o) || o.role === 'kaleci') continue
      const s2 = (o.x - p.x) * ux + (o.z - p.z) * uz
      if (s2 < 0.3 || s2 > L) continue
      const off = Math.abs((o.x - p.x) * uz - (o.z - p.z) * ux)
      if (off < 0.9) block += 1 - off / 0.9
    }
    const q = Math.min(gap, 3) / 3 - block * 0.8
    if (q > best.q) best = { z, q, y: rnd() < 0.5 ? 0.35 : 0.9 + rnd() * 0.6, clear: block < 0.05 }
  }
  // gorulen kale acisi
  const a1 = Math.atan2(GW - p.z, (gx - p.x) * dir)
  const a2 = Math.atan2(-GW - p.z, (gx - p.x) * dir)
  const angle = Math.abs(a1 - a2)
  const quality = best.q * 0.6 + angle * 1.1 - d * 0.035 + T.shootBias
  return { x: gx, z: best.z, y: best.y, d, quality, clear: best.clear }
}

function shoot(b: Brain, s: { x: number; z: number; y: number; d: number; clear?: boolean }) {
  const err = T.shotErr * (0.6 + s.d / 15)
  const z = s.z + gauss() * err
  const y = clamp(s.y + gauss() * err * 0.6, 0.15, GOAL_H + 0.6)
  // uzak sut, engelsiz yol: kosedeki falsolu secenek (cikis dogrusu merkeze bakar, top kose icine kivrilir)
  const curl = aiFlags.curl && s.clear && s.d >= 18 && Math.abs(s.z) > 0.6 && rnd() < 0.9
  if (curl) {
    const v = 22 + rnd() * 4
    setAct(b, 'shoot', speedToPower(v), s.x, y, z)
    if (b.act) b.act.curl = Math.sign(z) * (2 + rnd())
    aiStats.shots++
    aiStats.curls++
    aiStats.shotLog.push({ curl: b.act?.curl ?? 0, d: s.d, t })
    return
  }
  // kalecinin tutamayacagi hiz (>19 m/s), mesafeyle artar
  const v = clamp(21 + s.d * 0.65, 21, 31)
  setAct(b, 'shoot', speedToPower(v), s.x, y, z)
  aiStats.shots++
  aiStats.shotLog.push({ curl: 0, d: s.d, t })
}

function pass(b: Brain, o: PassOpt) {
  if (aiStats.passLog.length < 5000) aiStats.passLog.push({ id: o.mate.id, margin: o.margin, d: o.d, lob: o.lob })
  const err = T.passErr * (o.d / 15)
  const x = clamp(o.x + gauss() * err, -HL + 0.5, HL - 0.5)
  const z = clamp(o.z + gauss() * err, -HW + 0.5, HW - 0.5)
  const passer = brains.indexOf(b)
  if (passer >= 0) aiStats.intent[passer] = { rid: o.mate.id, ax: x, az: z, margin: o.margin, lob: o.lob, t }
  if (o.lob) {
    const v = clamp(9 + o.d * 0.55, 10, 22)
    setAct(b, 'lob', speedToPower(v), x, 0, z)
    aiStats.lobs++
  } else {
    // power 0: hizi locomotion mesafeden cozer (top ~3 m/s ile varir)
    setAct(b, 'pass', 0, x, 0, z)
  }
  aiStats.passes++
  const mb = brainOf(o.mate.id)
  mb.receiveUntil = t + 0.6 + o.d / 9
  // alici topa gelir: yerden pasta bulusma noktasi hedefin ~1.5 m pasora dogru onu
  const back = o.lob ? 0 : Math.min(1.5, o.d * 0.15)
  const ux = (world.ball.x - x) / (o.d || 1)
  const uz = (world.ball.z - z) / (o.d || 1)
  mb.rx = x + ux * back
  mb.rz = z + uz * back
  // hemen (takim karar karesini beklemeden) harekete gec
  mb.tx = mb.rx
  mb.tz = mb.rz
  mb.sprint = dist(o.mate.x, o.mate.z, mb.rx, mb.rz) > 1.2
  mb.speed = 1
}

/** top vurus yonunde onde mi; degilse once o yone donulur (top govdeye carpip geri sekmesin) */
function lined(p: Player, b: Brain, ax: number, az: number): boolean {
  const ball = world.ball
  const dx = ax - p.x
  const dz = az - p.z
  const d = Math.hypot(dx, dz) || 1
  const bx = ball.x - p.x
  const bz = ball.z - p.z
  const bl = Math.hypot(bx, bz) || 1
  const fx = Math.sin(p.facing)
  const fz = Math.cos(p.facing)
  // top vurus yonunde onde ve govde kabaca o yone donuk
  // locomotion vurusta bakisi hedefe cevirir; yalniz top govdenin arkasinda kalmasin
  if ((bx * dx + bz * dz) / (bl * d) > -0.1 || (fx * dx + fz * dz) / d > 0.5) return true
  // donus: hedef yonune kisa kosu (top suruculugu topu one alir)
  b.tx = p.x + (dx / d) * 3
  b.tz = p.z + (dz / d) * 3
  b.sprint = false
  b.speed = 0.6
  inField(b, 1)
  return false
}

/** davranis anahtarlari (bassiz A/B testleri icin) */
export const aiFlags = { duel: true, shield: true, touch: true, attackBall: false, curl: true } // attackBall: 6 tohum A/B'de isabeti dusurdu (%66 vs %68)
const cs = (k: string) => (aiStats.carrier[k] = (aiStats.carrier[k] ?? 0) + 1)
function decideCarrier(p: Player, b: Brain) {
  const dir = dirOf(p.team)
  const { o: no, d: nd } = nearestOpp(p)
  // baski: ondeki ya da cok yakin rakip
  const front = no ? ((no.x - p.x) * dir > -0.5 ? 1 : 0.55) : 0
  const pressure = no ? (nd < 4 ? (1 - nd / 4) * front : 0) : 0

  if (b.act) return
  const sh = indirectTaker === p.id ? null : shotOption(p) // endirekt vurusu kullanan baskasi degene dek sut cekmez (gol sayilmaz)
  if (sh) {
    // uzak (>=18 m) engelsiz yolda falsolu sut daha cok denenir; falso kapaliysa eskisi gibi sikı esik
    const need = sh.d < 9 ? 0.35 : sh.d < 14 ? 0.62 : 0.85
    if (sh.quality > need - pressure * 0.15 + (rnd() - 0.5) * 0.15) {
      if (lined(p, b, sh.x, sh.z)) {
        shoot(b, sh)
        cs('sut')
      } else cs('sut-don')
      return
    }
  }
  // uzak (18-24 m) engelsiz yolda seyrek falsolu sut (normal sut kosulundan bagimsiz, hafif)
  if (aiFlags.curl && indirectTaker !== p.id && !sh && pressure < 0.5 && rnd() < 0.04) {
    const fs = shotOption(p, 24)
    if (fs && fs.d >= 18 && fs.clear && fs.quality > 0.3 && lined(p, b, fs.x, fs.z)) {
      shoot(b, fs)
      cs('sut-falso')
      return
    }
  }
  const bp = bestPass(p, pressure > 0.5 && (p.x * dir < -HL * 0.4))
  if (indirectTaker === p.id && t >= b.holdUntil) {
    // endirekt: sut yok, kaleye surerken sikisip kalmamak icin hemen pas (yoksa en yakin arkadasa)
    let o: PassOpt | null = bp
    if (!o) {
      let nd2 = 1e9
      for (const m of teamOf(p.team)) {
        if (m === p || m.role === 'kaleci') continue
        const d = dist(p.x, p.z, m.x, m.z)
        if (d > 2 && d < nd2) {
          nd2 = d
          o = { mate: m, x: m.x, z: m.z, score: 0, margin: 0, lob: false, d }
        }
      }
    }
    if (o && lined(p, b, o.x, o.z)) {
      pass(b, o)
      cs('pas-endirekt')
      return
    }
    if (o) return
  }
  // ileride bos alan: surus degeri
  let space = 9
  for (const o of game.players) {
    if (o.team === p.team || !active(o)) continue
    const ahead = (o.x - p.x) * dir
    if (ahead < -0.5) continue
    space = Math.min(space, dist(o.x, o.z, p.x + dir * 2.5, p.z))
  }
  const dribbleScore = Math.min(space, 7) * 0.5 + ((p.x * dir) / HL) * 2 - pressure * 4
  // esik: kisa yerden pas daha serbest, asirtma daha siki (olculen basari: yerden marj>0 ~%80, asirtma ~%55)
  // baski altinda kisa pas riski kabul (surup kaybetmekten iyi)
  const canPass = bp && bp.margin > (bp.lob ? 0.7 : bp.d < 11 ? (pressure > 0.5 ? -0.1 : 0.05) : 0.2)
  // 4'e 4'te paslasma esas: iyi secenek varsa surmeye tercih edilir
  if (canPass && ((t >= b.holdUntil && (pressure > 0.35 || bp!.score > dribbleScore - 0.5 || rnd() < 0.4)) || pressure > 0.75)) {
    if (lined(p, b, bp!.x, bp!.z)) {
      pass(b, bp!)
      cs('pas')
    } else cs('pas-don')
    return
  }
  // cikis yok ve cok sikisik: uzaga temizle (savunma bolgesinde)
  if (pressure > 0.8 && p.x * dir < -HL * 0.3 && rnd() < 0.5) {
    const tx = clamp(p.x + dir * 22, -HL + 3, HL - 3)
    const tz = clamp(p.z * 0.5 + (rnd() - 0.5) * 10, -HW + 2, HW - 2)
    setAct(b, 'lob', speedToPower(19), tx, 0, tz)
    aiStats.lobs++
    return
  }
  // top koruma: rakip arkada (<2 m) ve onu kapali: yavasla, sirtini don (locomotion 'shield'), destek bekle.
  // en fazla ~2.5 s; sonra rakipten uzaga donup sur
  const fx = Math.sin(p.facing)
  const fz = Math.cos(p.facing)
  if (aiFlags.shield && no && nd < 1.6 && (no.x - p.x) * fx + (no.z - p.z) * fz < 0 && (space < 2.5 || Math.abs(p.z) > HW - 3)) {
    if (b.shieldT < 0 || t - b.shieldT > 3.5) b.shieldT = t
    if (t - b.shieldT < 1.5) {
      const ax = p.x - no.x
      const az = p.z - no.z
      const al = Math.hypot(ax, az) || 1
      b.tx = p.x + (ax / al) * 0.8
      b.tz = p.z + (az / al) * 0.8
      b.speed = 0.25
      b.sprint = false
      inField(b, 1.5)
      cs('koru')
      return
    }
  } else b.shieldT = -1
  cs(bp ? (bp.margin > 0.2 ? 'sur-pas-var' : 'sur-pas-riskli') : 'sur-pas-yok')
  if (bp && aiStats.riskyMargins.length < 5000) aiStats.riskyMargins.push(bp.margin)
  // surme: kaleye dogru, rakipten kacinarak
  const gx = dir * HL
  let vx = (gx - p.x) / (dist(p.x, p.z, gx, 0) || 1)
  let vz = (0 - p.z) / (dist(p.x, p.z, gx, 0) || 1) * 0.6
  for (const o of game.players) {
    if (o.team === p.team || !active(o)) continue
    const d = dist(o.x, o.z, p.x, p.z)
    if (d > 5.5) continue
    const w = (5.5 - d) / 5.5
    vx += ((p.x - o.x) / d) * w * 1.1
    vz += ((p.z - o.z) / d) * w * 1.4
  }
  // kenara dayaninca iceri
  if (Math.abs(p.z) > HW - 3.5) vz -= Math.sign(p.z) * 1.2
  const n = Math.hypot(vx, vz) || 1
  b.tx = p.x + (vx / n) * 4
  b.tz = p.z + (vz / n) * 4
  // ileri gitmeyi koru (geri kacisi sinirla)
  if ((b.tx - p.x) * dir < -1.5 && pressure < 0.6) b.tx = p.x - dir * 1.5
  inField(b, 2.4)
  b.sprint = space > 5 && p.stamina > 0.35
  b.speed = 1
}

// ---------------------------------------------------------------- konumlar
/** yakin destek: tasiyicinin 7 m cevresinde pas yolu en acik ve rakipten uzak nokta */
function supportSpot(team: TeamId, bx: number, bz: number, side: number) {
  const dir = dirOf(team)
  let best = { x: bx - dir * 1.5, z: clamp(bz - side * 6, -HW + 2.5, HW - 2.5), pref: 'orta' }
  let bs = -1e9
  // baski altinda mi: en yakin rakip (tasiyiciyi kapatan yon)
  let pr: Player | null = null
  let prd = 9
  for (const o of game.players) {
    if (o.team === team || !active(o)) continue
    const d = dist(o.x, o.z, bx, bz)
    if (d < prd) {
      prd = d
      pr = o
    }
  }
  const pressed = pr !== null && prd < 3.8
  // acilar ve iki yaricap (6-9 m): pas yolu acik, rakipten uzak nokta
  for (const [a, R] of [[55, 6.5], [90, 6.5], [125, 6.5], [155, 6.5], [-55, 6.5], [-90, 6.5], [-125, 6.5], [-155, 6.5], [55, 9], [90, 9], [125, 9], [-55, 9], [-90, 9], [-125, 9]] as [number, number][]) {
    const r = (a * Math.PI) / 180
    const x = clamp(bx + Math.cos(r) * dir * R, -HL + 2, HL - 2)
    const z = clamp(bz + Math.sin(r) * R, -HW + 2, HW - 2)
    let open = 9
    for (const o of game.players) if (o.team !== team && active(o)) open = Math.min(open, dist(o.x, o.z, x, z))
    const lane = laneMargin(team, bx, bz, x, z, false)
    let sc = Math.min(lane, 0.8) * 3 + Math.min(open, 5) * 0.6 - (open < 3 ? (3 - open) * 1.2 : 0) + (Math.abs(a) < 100 ? 0.6 : 0) - (Math.sign(Math.sin(r)) === side ? 0.4 : 0)
    if (pressed && pr) {
      // pres altinda: baskidan uzaga, tasiyicinin govdesi pas yolunu korusun (capraz geri/yan)
      const ax = x - bx
      const az = z - bz
      const px = bx - pr.x
      const pz = bz - pr.z
      const al = Math.hypot(ax, az) || 1
      const pl = Math.hypot(px, pz) || 1
      const away = (ax * px + az * pz) / (al * pl)
      sc += away * 2.2 - (Math.abs(a) > 150 ? 0.5 : 0)
    }
    if (sc > bs) {
      bs = sc
      best = { x, z, pref: 'orta' }
    }
  }
  return best
}

/** hucumda topsuz oyuncu: destek, derinlik, geride kalan */
function attackSlots(team: TeamId, bx0: number, bz0: number, carrierId: number) {
  const dir = dirOf(team)
  // tasiyicinin ~0,7 s sonraki yerine gore konumlan (sprintle gecilen destek geride kalmasin)
  const cp = carrierId >= 0 ? game.players[carrierId] : null
  const bx = cp ? clamp(bx0 + cp.vx * 0.7, -HL + 2, HL - 2) : bx0
  const bz = cp ? clamp(bz0 + cp.vz * 0.7, -HW + 2, HW - 2) : bz0
  const side = bz >= 0 ? 1 : -1
  const slots = [
    // destek: topun yaninda, hafif geride, ters kanada acik
    // kisa pas istasyonu (6-8 m, pas yolu acik aci)
    supportSpot(team, bx, bz, side),
    // derinlik: ileride, karsi kanada
    // (oyunda ofsayt cizgisine kadar cekilir: cizgide bekler)
    { x: clamp(bx + dir * 14, -HL + 4, HL - 4), z: -side * 5 + bz * 0.2, pref: 'forvet' },
    // geride: dengeleyici
    { x: clamp(bx - dir * 9, -HL + 6, HL - 6), z: bz * 0.25, pref: 'defans' },
  ]
  slots[1].x = clamp(slots[1].x, -HL + 3, HL - 3)
  const out = new Map<number, { x: number; z: number }>()
  const mates = teamOf(team).filter((m) => m.role !== 'kaleci' && m.id !== carrierId)
  const used = new Set<number>()
  // once rol eslesmesi, sonra en yakin
  const order = mates.slice().sort((a, b) => (a.role === 'forvet' ? -1 : 0) - (b.role === 'forvet' ? -1 : 0))
  for (const m of order) {
    let bi = -1
    let bc = 1e9
    slots.forEach((s, i) => {
      if (used.has(i)) return
      const c = dist(m.x, m.z, s.x, s.z) - (s.pref === m.role ? 6 : 0) + (i === 2 && mates.length > 1 ? 4 : 0)
      if (c < bc) {
        bc = c
        bi = i
      }
    })
    if (bi < 0) continue
    used.add(bi)
    out.set(m.id, slots[bi])
  }
  return out
}

function defendTargets(team: TeamId, bx: number, bz: number, presserId: number) {
  const dir = dirOf(team)
  const ogx = -dir * HL // kendi kalemiz
  const out = new Map<number, { x: number; z: number }>()
  const defs = teamOf(team).filter((m) => m.role !== 'kaleci' && m.id !== presserId)
  // tehlike sirasina gore rakipler (topa sahip olan haric)
  const opps = game.players
    .filter((o) => o.team !== team && active(o) && o.role !== 'kaleci' && !o.hasBall)
    .sort((a, b) => dist(a.x, a.z, ogx, 0) - dist(b.x, b.z, ogx, 0))
  const free = defs.slice()
  for (const o of opps) {
    if (!free.length) break
    // kale tarafinda, topa dogru hafif kaymis markaj noktasi
    const dgx = ogx - o.x
    const dgz = -o.z
    const dl = Math.hypot(dgx, dgz) || 1
    const close = (dist(o.x, o.z, ogx, 0) < 14 ? 1.2 : 2.2) * T.markLoose
    let mx = o.x + (dgx / dl) * close + (bx - o.x) * 0.15
    let mz = o.z + (dgz / dl) * close + (bz - o.z) * 0.15
    // kompaktlik: toptan cok uzaga, hucum yonune cikma
    if ((mx - bx) * dir > 2) mx = bx + dir * 2
    let bi = 0
    let bc = 1e9
    free.forEach((m, i) => {
      const c = dist(m.x, m.z, mx, mz) + (m.role === 'defans' && i >= 0 ? -2 * (dist(o.x, o.z, ogx, 0) < 15 ? 1 : 0) : 0)
      if (c < bc) {
        bc = c
        bi = i
      }
    })
    out.set(free[bi].id, { x: mx, z: mz })
    free.splice(bi, 1)
  }
  // bosta kalan: top-kale hattini kapat
  for (const m of free) out.set(m.id, { x: bx + (ogx - bx) * 0.45, z: bz * 0.5 })
  // savunma cizgisi birlikte: toptan 9 m'den (ceza alani onunden) derine inme; geride kalan forvet ofsayta duser
  const lineMin = Math.min(dir * bx - 1, Math.max(dir * bx - 9, -HL + BOX_D - 1)) // dir*x en kucuk izin
  for (const v of out.values()) if (dir * v.x < lineMin) v.x = dir * lineMin
  // ofsayt tuzagi (zor): rakip forvet cizgimizdeyken hep birlikte one cik
  if (trapUntil[team] > t) {
    let deepest = 1e9
    for (const v of out.values()) deepest = Math.min(deepest, dir * v.x)
    for (const v of out.values()) if (dir * v.x < deepest + 1) v.x = dir * (dir * v.x + 2)
  }
  return out
}

function keeperHome(k: Player, bx: number, bz: number) {
  const dir = dirOf(k.team)
  const gx = -dir * HL
  const db = dist(bx, bz, gx, 0)
  const depth = clamp(0.4 + db * 0.09, 0.4, 2.6)
  const ux = (bx - gx) / (db || 1)
  const uz = bz / (db || 1)
  return { x: gx + ux * depth, z: clamp(uz * depth * 1.4 + bz * 0.08, -GW + 0.3, GW - 0.3) }
}

// ---------------------------------------------------------------- kaleci
/** kalecinin yanal konumlanma hizi (move buyuklugu): 4.2 m/s = RUN_SPEED(6.2) * KEEPER_MUL(0.9) * 0.75 */
const KEEPER_LAT = 0.75

function keeperThink(k: Player, b: Brain, carrier: Player | null) {
  use(k.team)
  const dir = dirOf(k.team)
  const gx = -dir * HL
  const ball = world.ball
  const home = keeperHome(k, ball.x, ball.z)
  // seviyeye gore aci kapatma hatasi (yavas degisen)
  if (t > b.jT) {
    b.jz = gauss()
    b.jT = t + 1.5 + rnd() * 1.5
  }
  b.tx = home.x
  b.tz = clamp(home.z + b.jz * T.keeperPosErr, -GW + 0.2, GW - 0.2)
  // hazir durus: kucuk duzeltmeler yavas yan adimla (locomotion 'keeper-shuffle'), uzaksa kos
  const far = dist(k.x, k.z, home.x, home.z)
  b.sprint = false
  b.speed = far > 2.5 ? KEEPER_LAT : 0.45 // yanal konumlanma hizi sinirli (~4.2 m/s); topa cikis (1v1) ayri

  if (k.hasBall) {
    // elde 1-4 s; hizli hucum firsati varsa erken
    b.tx = gx + dir * 2.5
    b.tz = clamp(k.z, -4, 4)
    b.speed = 0.4
    if (t > b.keeperHoldT && !b.act) {
      // once: 15 m icinde bos (4 m icinde rakip yok) arkadasa elle kisa atis
      let near: Player | null = null
      let nd = 15
      for (const m of teamOf(k.team)) {
        if (m === k || returning(m)) continue
        const d = dist(k.x, k.z, m.x, m.z)
        if (d > nd || d < 4) continue
        let free = true
        for (const o of game.players) if (o.team !== k.team && active(o) && dist(o.x, o.z, m.x, m.z) < 4) free = false
        if (free && laneMargin(k.team, k.x, k.z, m.x, m.z, false) > 0) {
          near = m
          nd = d
        }
      }
      const bp = bestPass(k, false, true)
      if (near) {
        pass(b, { mate: near, x: near.x + near.vx * 0.3, z: near.z + near.vz * 0.3, score: 0, margin: 0.5, lob: false, d: nd })
      } else if (bp && bp.margin > 0.1 && bp.d < 20 && !bp.lob) {
        // kisa: elle atis (locomotion 'keeper-throw')
        pass(b, bp)
      } else if (bp && bp.margin > 0) {
        // uzun: vole (locomotion 'keeper-kick')
        setAct(b, 'lob', 0, bp.x, 0, bp.z)
        aiStats.lobs++
        aiStats.passes++
        const mb = brainOf(bp.mate.id)
        mb.receiveUntil = t + 2.5
        mb.rx = bp.x
        mb.rz = bp.z
      } else {
        const tz = (rnd() < 0.5 ? -1 : 1) * (4 + rnd() * 5)
        setAct(b, 'lob', 0, gx + dir * 24, 0, tz)
        aiStats.lobs++
      }
    }
    return
  }
  const team = k.team as 0 | 1
  // sut algilama: top kaleye geliyor ve kimsede degil; serbest ucus tahmini (predictBall = sim/ball adimi)
  const toward = ball.vx * -dir
  let cross: { t: number; y: number; z: number } | null = null
  if (!carrier && toward > 4) {
    // kale CIZGISI kesisimi (falsolu/ineli sutta kalecinin onundeki x'ten farkli olabilir); iki ornek arasi dogrusal
    for (let i = 1; i < PRED_N; i++) {
      const x = pred[i * 3]
      if ((x - gx) * -dir >= 0) {
        const x0 = pred[(i - 1) * 3]
        const f = Math.abs(x - x0) > 1e-6 ? clamp((gx - x0) / (x - x0), 0, 1) : 1
        cross = {
          t: (i - 1 + f) * PRED_H,
          y: pred[(i - 1) * 3 + 1] + (pred[i * 3 + 1] - pred[(i - 1) * 3 + 1]) * f,
          z: pred[(i - 1) * 3 + 2] + (pred[i * 3 + 2] - pred[(i - 1) * 3 + 2]) * f,
        }
        break
      }
    }
  }
  // kalecinin durdugu x'te top yolu: konumlanma ve dalis hedefi burasidir (kale cizgisi kesisimi yalniz 'kaleye gidiyor mu' karari)
  let atK: { t: number; y: number; z: number } | null = null
  if (cross) {
    for (let i = 1; i < PRED_N; i++) {
      if ((pred[i * 3] - k.x) * -dir >= 0) {
        const x0 = pred[(i - 1) * 3]
        const x1 = pred[i * 3]
        const f = Math.abs(x1 - x0) > 1e-6 ? clamp((k.x - x0) / (x1 - x0), 0, 1) : 1
        atK = {
          t: (i - 1 + f) * PRED_H,
          y: pred[(i - 1) * 3 + 1] + (pred[i * 3 + 1] - pred[(i - 1) * 3 + 1]) * f,
          z: pred[(i - 1) * 3 + 2] + (pred[i * 3 + 2] - pred[(i - 1) * 3 + 2]) * f,
        }
        break
      }
    }
  }
  const onTarget = cross && Math.abs(cross.z) < GW + 0.6 && cross.y < GOAL_H + 0.4
  if (onTarget) {
    if (threat[team] < 0) {
      threat[team] = t
      threatMiss[team] = rnd() < T.keeperMiss
    }
    if (t - threat[team] >= T.react + (threatMiss[team] ? 0.2 : 0)) {
      const c = atK ?? cross!
      const cl = cross!
      b.tx = k.x
      b.tz = c.z
      const off = Math.abs(c.z - k.z)
      b.sprint = false // gercek kaleci yanal shuffle ~4.2 m/s: uzak koseye yetisemezse dalar
      b.speed = KEEPER_LAT
      // dalis: yatayda en uzak an 0.40 s; top keciye o surede varacakken kalk (alcak/yuksek aim.y ile)
      const late = c.t < 0.55
      // dalis yalniz kaleye giden (direk ici) ve ulasilabilir sutta: yan 2,3 m, yukseklik 2,6 m, kok hizi <= 4,5 m/s
      const diveOn = Math.abs(cl.z) < GW + 0.2 && cl.y < GOAL_H + 0.2
      const canReach = diveReachable(Math.hypot(c.z - k.z, gx - k.x), c.y, c.t) // sim/keeperDive ile ayni kriter
      if (diveOn && (canReach || DIVE_ANY) && (off > 0.9 || c.y > 1.9 || (late && off > 0.9)) && c.t < 0.9 && k.actionLock <= 0 && !b.act) {
        setAct(b, 'dive', 1, k.x, c.y, c.z, 0.15)
        aiStats.dives++
      }
    }
    return
  }
  threat[team] = -1
  // bostaki top ceza alaninda: cik ve al
  if (!carrier) {
    const it = interceptTime(k, true)
    const inBox = (it.x - gx) * dir < BOX_D && Math.abs(it.z) < BOX_W
    if (inBox) {
      let oppT = 9
      for (const o of game.players) if (o.team !== k.team && active(o)) oppT = Math.min(oppT, interceptTime(o).t)
      if (it.t < oppT + 0.1) {
        b.tx = it.x
        b.tz = it.z
        b.sprint = true
        b.speed = 1
        return
      }
    }
  } else if (carrier.team !== k.team) {
    // bire bir: aciyi daralt; 4 m icinde yavasla, govdeyi ac (locomotion 'keeper-spread')
    const cd = dist(carrier.x, carrier.z, gx, 0)
    if (cd < 11) {
      const depth = clamp(cd * 0.35, 0.6, 4)
      b.tx = gx + ((carrier.x - gx) / cd) * depth
      b.tz = (carrier.z / cd) * depth
      const d = dist(k.x, k.z, carrier.x, carrier.z)
      b.sprint = cd < 8 && d > 4.5
      b.speed = d < 4 ? 0.35 : 1
      // ayaklara atilma: top suruculen acildiginda (topa taşiyicidan once yetisir)
      const bd = dist(k.x, k.z, ball.x, ball.z)
      const open = dist(carrier.x, carrier.z, ball.x, ball.z) > 0.9
      if (bd < 2.2 && open && k.actionLock <= 0 && !b.act) {
        setAct(b, 'dive', 1, ball.x, 0.2, ball.z, 0.15)
        aiStats.dives++
      }
    }
  }
}

/** pas alici: top gelirken hafifce bos alana kay; locomotion ilk dokunusu oyuncunun hiz yonune yapar */
function prepareTouch(p: Player, b: Brain, cx: number, cz: number) {
  if (!aiFlags.touch) return
  const ball = world.ball
  const bsp = Math.hypot(ball.vx, ball.vz)
  const bd = dist(p.x, p.z, ball.x, ball.z)
  if (bsp < 1.5 || bd > 2.2 || dist(p.x, p.z, cx, cz) > 0.7) return
  // gelis yonune ragmen, topun geldigi taraftan uzaklasma: yon = rakipten uzak + hucum yonu
  const dir = dirOf(p.team)
  let ox = dir * 1.0
  let oz = -p.z * 0.06
  for (const o of game.players) {
    if (o.team === p.team || !active(o)) continue
    const d = dist(o.x, o.z, p.x, p.z)
    if (d > 6 || d < 0.01) continue
    const w = (6 - d) / 6
    ox += ((p.x - o.x) / d) * w * 1.6
    oz += ((p.z - o.z) / d) * w * 1.6
  }
  // topa dogru gelen yonu koru: ters yone (gelis hattinda geri) kacma
  const ux = ball.vx / bsp
  const uz = ball.vz / bsp
  const back = ox * ux + oz * uz
  if (back > 0) {
    ox -= ux * back * 0.7
    oz -= uz * back * 0.7
  }
  const l = Math.hypot(ox, oz) || 1
  b.tx = p.x + (ox / l) * 2
  b.tz = p.z + (oz / l) * 2
  b.speed = 0.4
  b.sprint = false
  inField(b, 1.5)
}

// ---------------------------------------------------------------- takim karari
function decideTeam(team: TeamId) {
  use(team)
  aiStats.decisions++
  const ball = world.ball
  const dir = dirOf(team)
  const ogx = -dir * HL
  const carrier = game.players.find((p) => p.hasBall && active(p)) ?? null
  const mine = teamOf(team)

  // sahiplik: topa sahip takim, yoksa son dokunan + top serbest (pas yolda)
  const lt = game.match.lastTouch
  let poss: TeamId | null = carrier ? carrier.team : lt && Math.hypot(ball.vx, ball.vz) > 3 ? lt.team : null
  if (poss === null) {
    // serbest top: topa belirgin once ulasacak takim hucum dizilisine gecer
    const tm = [9, 9]
    for (const p of game.players) if (active(p) && p.role !== 'kaleci') tm[p.team] = Math.min(tm[p.team], interceptTime(p).t)
    if (tm[0] < tm[1] - 0.35) poss = 0
    else if (tm[1] < tm[0] - 0.35) poss = 1
  }

  // topa en hizli ulasan (bu takimdan, kaleci haric)
  let chaser: Player | null = null
  let ct = 1e9
  let cx = ball.x
  let cz = ball.z
  // insan takim arkadasi baskida mi: rakip tasiyiciya 4 m icinde ya da 8 m icinde ona kosuyor.
  // Baskidaysa AI ikinci adam olarak ayni oyuncuya gitmez (markajda kalir); degilse en yakin AI baskiya cikar
  let humanPress: Player | null = null
  if (carrier && carrier.team !== team) {
    for (const h of mine) {
      if (!human(h)) continue
      const d = dist(h.x, h.z, carrier.x, carrier.z)
      const vTo = d > 0.01 ? (h.vx * (carrier.x - h.x) + h.vz * (carrier.z - h.z)) / d : 0
      if (d < 4 || (d < 8 && vTo > 2)) humanPress = h
    }
  }
  if (humanPress) {
    chaser = humanPress
  } else if (!carrier || carrier.team !== team) {
    for (const p of mine) {
      if (p.role === 'kaleci') continue
      // kovalayan AI'dan secilir (insan kendi karar verir)
      if (human(p)) continue
      const b = brainOf(p.id)
      let it = interceptTime(p)
      // pas alicisi onceliklidir
      if (b.receiveUntil > t && poss === team) it = { ...it, t: it.t - 0.6 }
      if (it.t < ct) {
        ct = it.t
        chaser = p
        cx = it.x
        cz = it.z
      }
    }
  }

  if (carrier && carrier.team === team) updatePassHints(carrier)
  else if (!carrier) passHints.length = 0
  const slots = poss === team ? attackSlots(team, carrier ? carrier.x : ball.x, carrier ? carrier.z : ball.z, carrier?.id ?? -1) : null
  const presserId = carrier && carrier.team !== team ? chaser?.id ?? -1 : chaser?.id ?? -1
  if (poss !== team && carrier && trapUntil[team] < t - 3 && T.offsideTrap > 0) {
    // rakibin en ondeki oyuncusu cizgimize yakin ve tasiyici uzakta: tuzak
    const od = dirOf(carrier.team)
    const onMaxOpp = onsideMax(carrier.team, ball.x)
    let near = false
    for (const o of game.players)
      if (o.team === carrier.team && o !== carrier && active(o) && o.role !== 'kaleci' && od * o.x > onMaxOpp - 1.2) near = true
    if (near && dist(carrier.x, carrier.z, ball.x, ball.z) < 2 && od * carrier.x < onMaxOpp - 7 && rnd() < T.offsideTrap) trapUntil[team] = t + 1.4
  }
  const marks = poss !== team ? defendTargets(team, ball.x, ball.z, presserId) : null
  const onMax = slots ? onsideMax(team, ball.x) : null

  for (const p of mine) {
    if (human(p)) continue
    const b = brainOf(p.id)
    if (b.act && t > b.act.until) b.act = null
    if (p.hasBall && !b.hadBall) b.holdUntil = t + 0.2 + rnd() * 0.35
    b.speed = 1
    b.sprint = false
    b.duel = false
    const wasJockey = b.jockey
    b.jockey = false

    if (p.role === 'kaleci') {
      keeperThink(p, b, carrier)
      b.hadBall = p.hasBall
      continue
    }
    if (p.hasBall) {
      decideCarrier(p, b)
      b.hadBall = true
      continue
    }
    b.hadBall = false

    // canli gorunum: yavas degisen sapma
    if (t > b.jT) {
      b.jx = (rnd() - 0.5) * 3
      b.jz = (rnd() - 0.5) * 4
      b.jT = t + 1.5 + rnd() * 2.5
      // cizgiden geri durma payi (m); kucuk ya da negatif = ofsayt riski
      b.hold = 0.7 + gauss() * T.lineErr
    }

    if (chaser === p) {
      if (carrier && carrier.team !== team) {
        // baski: kale tarafindan yaklas, onden mudahale
        const dgx = ogx - carrier.x
        const dgz = -carrier.z
        const dl = Math.hypot(dgx, dgz) || 1
        const d = dist(p.x, p.z, carrier.x, carrier.z)
        // yakinda tasiyicinin hizina uy, carpma (govde temasi faul olur)
        const stand = d > 3 ? 1.4 : 1.1
        b.tx = carrier.x + (dgx / dl) * stand + carrier.vx * 0.3
        b.tz = carrier.z + (dgz / dl) * stand + carrier.vz * 0.3
        b.sprint = d > 4 && p.stamina > 0.2 && T.pressSpeed >= 1
        b.speed = Math.min(1, (d > 3 ? 1 : 0.55 + d * 0.15) * T.pressSpeed)
        // hizli kosan tasiyicinin yanina gelindiyse: yaninda kos, omuz omuza (locomotion 'shoulder', yasal)
        const csp = Math.hypot(carrier.vx, carrier.vz)
        if (aiFlags.duel && csp > 3 && d < 2.6) {
          const lat = Math.abs(((p.x - carrier.x) * carrier.vz - (p.z - carrier.z) * carrier.vx) / csp)
          const along = ((p.x - carrier.x) * carrier.vx + (p.z - carrier.z) * carrier.vz) / csp
          if (lat > 0.3 && along > -1.2 && along < 0.8) {
            b.tx = carrier.x + carrier.vx * 0.35
            b.tz = carrier.z + carrier.vz * 0.35
            b.sprint = true
            b.speed = 1
            b.duel = true
          }
        }
        // arkadan mi: tasiyicinin bakis yonune gore
        const fx = Math.sin(carrier.facing)
        const fz = Math.cos(carrier.facing)
        // locomotion'un 'arkadan' olcutu: mudahalecinin hareket yonu tasiyicinin bakisiyla ayni yonde
        const sp = Math.hypot(p.vx, p.vz)
        const mx = sp > 0.3 ? p.vx / sp : Math.sin(p.facing)
        const mz = sp > 0.3 ? p.vz / sp : Math.cos(p.facing)
        const behind = mx * fx + mz * fz > 0.35 || (p.x - carrier.x) * fx + (p.z - carrier.z) * fz < -0.3 * d
        // top koruyan (shield) rakibe arkadan mudahale faul: yanina dolan, topa yandan uzan
        const shielding = carrier.anim === 'shield'
        if (shielding && behind && d < 3) {
          const px = -fz
          const pz = fx
          const sgn = (p.x - carrier.x) * px + (p.z - carrier.z) * pz >= 0 ? 1 : -1
          b.tx = carrier.x + px * sgn * 1.0 + fx * 0.3
          b.tz = carrier.z + pz * sgn * 1.0 + fz * 0.3
          b.sprint = false
          b.speed = 0.6
        }
        // elinde top tutan kaleciye mudahale yok (faul): yalniz 2 m'de baski, atis yolunu kapat
        const keeperHolds = carrier.role === 'kaleci' && (world.ball.y > 0.3 || Math.abs(carrier.x) > HL - BOX_D)
        if (keeperHolds) {
          // sahaya dogru onde dur (kale cizgisi tarafina gecme), atis yolunu kapat
          const hd = dirOf(carrier.team)
          b.tx = clamp(carrier.x + hd * 3, -HL + 1, HL - 1)
          b.tz = clamp(carrier.z * 0.7, -HW + 1, HW - 1)
          b.sprint = false
          b.speed = 0.6
          b.act = null
          b.duel = false
        }
        if (!keeperHolds && t > b.cool && p.actionLock <= 0 && !b.act) {
          // top bizim tarafimizda ve ayak menzilinde degilse girme (topsuz mudahale faul olur)
          // temas ~0,18 s sonra: top (ve biz) o ana gore ilerler
          const bdist = dist(p.x + p.vx * TK_LEAD * 0.5, p.z + p.vz * TK_LEAD * 0.5, world.ball.x + world.ball.vx * TK_LEAD, world.ball.z + world.ball.vz * TK_LEAD)
          // topun bacak menzilinde (<=1,1 m) ve rakip ayagindan acikta oldugunda dene
          const ballSide = bdist <= TK_R && bdist < d + 0.1
          const csp2 = Math.hypot(carrier.vx, carrier.vz)
          if (t > b.noTackle && ballSide && csp2 < TK_MAXV && (behind ? !shielding && rnd() < T.tackleBehind : rnd() < T.tackleP)) {
            setAct(b, 'tackle', 0.6, world.ball.x + world.ball.vx * TK_LEAD, 0, world.ball.z + world.ball.vz * TK_LEAD, 0.2)
            b.cool = t + 2.1 + rnd() * 0.5
            aiStats.tackles++
            aiStats.tkLog.push({ id: p.id, t, bd: bdist, sp: Math.hypot(carrier.vx, carrier.vz) })
          } else if (t > b.noTackle && d > 1.6 && d < 3.0 && !behind && approaching(carrier, p) && dist(carrier.x, carrier.z, ogx, 0) < 15 && rnd() < T.slide) {
            setAct(b, 'slide', 0.8, world.ball.x, 0, world.ball.z, 0.2)
            b.cool = t + 2.5
            aiStats.slides++
          }
        }
        if (!keeperHolds && !b.act && !behind && !shielding && d < (wasJockey ? 3.6 : 2.8) && d > 0.9 && (wasJockey || rnd() < T.jockey)) {
          // gecikmeli baski: dur, rakibe donuk mesafe tut; top ayaktan acilinca mudahale (jockeyTackle)
          b.jockey = true
          b.duel = false
          b.sprint = false
        }
      } else {
        // serbest top: kesme noktasina; rakiple yan yana gelirse omuz omuza
        b.tx = cx
        b.tz = cz
        b.sprint = dist(p.x, p.z, cx, cz) > 3
        b.duel = aiFlags.duel
        prepareTouch(p, b, cx, cz)
      }
      inField(b, 0.2)
      continue
    }

    if (b.receiveUntil > t && poss === team) {
      // topa gel: top yoldaysa en erken bulusma noktasina (beklemek yerine karsila), degilse hedefe
      const moving = Math.hypot(ball.vx, ball.vz) > 2
      const it = moving ? interceptTime(p) : null
      const mx = it && it.t < 3 ? it.x : b.rx
      const mz = it && it.t < 3 ? it.z : b.rz
      b.tx = mx
      b.tz = mz
      // top yakin ve bize geliyorsa beklemeden uzerine yuru (araya giren rakibe yer birakma)
      const bdx = ball.x - p.x
      const bdz = ball.z - p.z
      const bdd = Math.hypot(bdx, bdz)
      if (aiFlags.attackBall && moving && bdd < 6 && (ball.vx * -bdx + ball.vz * -bdz) / (bdd || 1) > 1) {
        b.tx = ball.x + ball.vx * 0.2
        b.tz = ball.z + ball.vz * 0.2
      }
      const dm = dist(p.x, p.z, b.tx, b.tz)
      b.sprint = dm > 1.2
      b.speed = 1
      prepareTouch(p, b, mx, mz)
      continue
    }

    if (slots) {
      const s = slots.get(p.id)
      if (s) {
        b.tx = s.x + b.jx
        b.tz = s.z + b.jz
        // derinlik kosusu: bosluk varsa depar; insan suruyorsa ona yetis (pas secenegi olmak icin)
        b.sprint = dist(p.x, p.z, b.tx, b.tz) > (carrier && human(carrier) ? 3 : 6)
        if (carrier && carrier.team === team && carrier !== p && !(globalThis as { NOCHECK?: boolean }).NOCHECK) {
          // tasiyiciya cok yakin duran: 6 m'ye ac (pas yolu ve aci)
          const dc = dist(p.x, p.z, carrier.x, carrier.z)
          if (dc < 3.5) {
            const ux = dc > 0.3 ? (p.x - carrier.x) / dc : 0
            const uz = dc > 0.3 ? (p.z - carrier.z) / dc : p.z >= 0 ? 1 : -1
            b.tx = carrier.x + ux * 6
            b.tz = carrier.z + uz * 6
            b.sprint = true
          }
          // markajdan kopma: marker < 2,2 m ise marker'dan uzaga ve topa dogru kisa atilim, sonra yuvaya don
          if (t >= b.checkUntil) {
            let mk: Player | null = null
            let md = 2.2
            for (const o of game.players) {
              if (o.team === team || !active(o) || o.role === 'kaleci') continue
              const d = dist(o.x, o.z, p.x, p.z)
              if (d < md) {
                md = d
                mk = o
              }
            }
            if (mk && t > b.checkAt) {
              const ax = (p.x - mk.x) / (md || 1)
              const az = (p.z - mk.z) / (md || 1)
              const tl = dist(p.x, p.z, carrier.x, carrier.z) || 1
              let ux = 0.6 * ax + 0.4 * ((carrier.x - p.x) / tl)
              let uz = 0.6 * az + 0.4 * ((carrier.z - p.z) / tl)
              const ul = Math.hypot(ux, uz) || 1
              ux /= ul
              uz /= ul
              b.cx = clamp(p.x + ux * 2.2, -HL + 2, HL - 2)
              b.cz = clamp(p.z + uz * 2.2, -HW + 2, HW - 2)
              b.checkUntil = t + 0.8
              b.checkAt = t + 1.8 + rnd() * 1.6 + (p.id % 3) * 0.4
            }
          } else {
            b.tx = b.cx
            b.tz = b.cz
            b.sprint = true
          }
        }
      }
    } else if (marks) {
      const m = marks.get(p.id)
      if (m) {
        b.tx = m.x + b.jx * 0.3
        b.tz = m.z + b.jz * 0.3
        b.sprint = dist(p.x, p.z, b.tx, b.tz) > 5
      }
    }
    // takim arkadasindan ayrik dur
    for (const m of mine) {
      if (m === p) continue
      const d = dist(m.x, m.z, b.tx, b.tz)
      if (d < 4 && d > 0.01) {
        b.tx += ((b.tx - m.x) / d) * (4 - d) * 0.6
        b.tz += ((b.tz - m.z) / d) * (4 - d) * 0.6
      }
    }
    // ofsayt: cizgide bekle, kosu pasla baslar (receiveUntil). Bazen az farkla ofsayta duser.
    if (slots && onMax !== null) {
      const lim = onMax - b.hold
      if (dir * b.tx > lim) {
        b.tx = dir * lim
        b.sprint = false
      }
    }
    inField(b, 1)
  }
}

// ---------------------------------------------------------------- duran toplar
function restartThink(team: TeamId, r: Restart, since: number) {
  use(team)
  const dir = dirOf(team)
  const ogx = -dir * HL
  const attacking = r.team === team
  const mine = teamOf(team)
  // kullanan: K belirlemediyse en yakin uygun oyuncu
  let takerId = r.taker
  if (attacking && takerId === undefined) {
    let bd = 1e9
    for (const p of mine) {
      const ok = r.type === 'goalkick' ? p.role === 'kaleci' : p.role !== 'kaleci'
      const d = dist(p.x, p.z, r.x, r.z)
      if (ok && d < bd) {
        bd = d
        takerId = p.id
      }
    }
  }
  for (const p of mine) {
    if (human(p)) continue
    const b = brainOf(p.id)
    if (b.act && t > b.act.until) b.act = null
    b.sprint = false
    b.speed = 0.85
    if (p.id === takerId && attacking) {
      takerThink(p, b, r, since)
      continue
    }
    let tx: number
    let tz: number
    if (p.role === 'kaleci') {
      const h = keeperHome(p, r.x, r.z)
      tx = h.x
      tz = h.z
    } else if (r.type === 'kickoff') {
      // kendi yari sahamizda dizilis; rakip orta yuvarlagin disinda
      const i = p.role === 'defans' ? 0 : p.role === 'orta' ? 1 : 2
      tx = ogx * [0.55, 0.28, attacking ? 0.04 : 0.2][i]
      tz = [0, -5, 4][i] * (team === 0 ? 1 : -1)
    } else if (r.type === 'penalty') {
      // ceza alani disi, penalti noktasinin gerisi
      const px = r.x
      const s = Math.sign(px) || 1
      tx = px - s * (3.5 + (p.id % 3))
      tz = ((p.id % 3) - 1) * 5
    } else if (attacking) {
      if (r.type === 'corner') {
        // kale onune: on direk, arka direk, ceza alani kenari
        const gx = dir * HL
        const i = p.role === 'forvet' ? 0 : p.role === 'orta' ? 1 : 2
        tx = gx - dir * [3.5, 5.5, 11][i]
        tz = [Math.sign(r.z) * 1.5, -Math.sign(r.z) * 2, 0][i]
      } else {
        const s = attackSlots(team, r.x, r.z, takerId ?? -1).get(p.id)
        tx = s ? s.x : r.x - dir * 6
        tz = s ? s.z : 0
      }
    } else {
      const m = defendTargets(team, r.x, r.z, -1).get(p.id)
      tx = m ? m.x : (r.x + ogx) / 2
      tz = m ? m.z : r.z * 0.5
    }
    // topa mesafe kurali (rakip): en az 3.5 m
    if (!attacking && r.type !== 'kickoff') {
      const d = dist(tx, tz, r.x, r.z)
      if (d < 3.5) {
        const ux = d > 0.01 ? (tx - r.x) / d : -dir
        const uz = d > 0.01 ? (tz - r.z) / d : 0
        tx = r.x + ux * 3.5
        tz = r.z + uz * 3.5
      }
    }
    b.tx = tx
    b.tz = tz
    inField(b, 0.6)
  }
}

function takerThink(p: Player, b: Brain, r: Restart, since: number) {
  const dir = dirOf(p.team)
  const ball = world.ball
  // vurus yonu: hedefi once sec, topun arkasina gec
  let aimX = dir * HL
  let aimZ = 0
  if (r.type === 'kickoff' || r.type === 'kickin' || r.type === 'goalkick' || r.type === 'corner' || r.type === 'freekick') {
    const bp = bestPass(p, false, r.type === 'goalkick')
    if (bp) {
      aimX = bp.x
      aimZ = bp.z
    }
  }
  const ax = aimX - ball.x
  const az = aimZ - ball.z
  const al = Math.hypot(ax, az) || 1
  b.tx = ball.x - (ax / al) * 0.55
  b.tz = ball.z - (az / al) * 0.55
  b.speed = 0.7
  // hazir: topa yakin ve bekleme doldu; 2.3 s'de yerlesmemis olsa da 1.1 m icindeyse vur (3 s kurali)
  const bd = dist(p.x, p.z, ball.x, ball.z)
  const ready = (bd < 1.0 && since > takerDelay) || (bd < 1.1 && since > 2.3)
  if (!ready || b.act || p.actionLock > 0) return
  const sh = shotOption(p)
  if (r.type === 'penalty' && sh) return shoot(b, { ...sh, y: rnd() < 0.5 ? 0.3 : 1.3 })
  // endirekt serbest vuruşta dogrudan gol sayilmaz: once pas
  if (r.type === 'freekick' && !r.indirect && sh && sh.d < 20 && sh.quality > 0.45) return shoot(b, sh)
  if (r.type === 'corner') {
    // orta: kale onundeki takim arkadasina asirtma
    const mates = teamOf(p.team).filter((m) => m !== p && m.role !== 'kaleci')
    const tgt = mates.sort((a, c) => Math.abs(a.x - dir * HL) - Math.abs(c.x - dir * HL))[0]
    if (tgt && rnd() < 0.7) {
      const d = dist(p.x, p.z, tgt.x, tgt.z)
      setAct(b, 'lob', speedToPower(clamp(10 + d * 0.5, 11, 20)), tgt.x, 0, tgt.z)
      aiStats.lobs++
      aiStats.passes++
      return
    }
  }
  const bp = bestPass(p, false, true)
  if (bp) return pass(b, bp)
  if (r.indirect) {
    // endirekt: dogrudan kaleye gitmesin; pas yoksa en yakin arkadasa kisa pas
    let near: Player | null = null
    let nd = 1e9
    for (const m of teamOf(p.team)) {
      if (m === p || m.role === 'kaleci') continue
      const d = dist(p.x, p.z, m.x, m.z)
      if (d > 2 && d < nd) {
        nd = d
        near = m
      }
    }
    if (near) return pass(b, { mate: near, x: near.x, z: near.z, score: 0, margin: 0, lob: false, d: nd })
    return setAct(b, 'pass', 0, p.x - dir * 4, 0, clamp(p.z, -HW + 2, HW - 2))
  }
  setAct(b, 'lob', speedToPower(18), clamp(p.x + dir * 18, -HL + 3, HL - 3), 0, clamp(p.z * 0.5, -6, 6))
}

// ---------------------------------------------------------------- kare girisi
const AVOID_D = 1.0 // en yakin yaklasma bundan azsa kacin (govde temasi 0.6 m'de)
const AVOID_T = 0.8 // ileriye bakis (s)
function writeInput(p: Player, b: Brain, inp: PlayerInput) {
  const dx = b.tx - p.x
  const dz = b.tz - p.z
  const d = Math.hypot(dx, dz)
  let m = d > 1.6 ? 1 : d < 0.25 ? 0 : (d - 0.25) / 1.35
  m *= b.speed
  let ux = d > 1e-4 ? dx / d : 0
  let uz = d > 1e-4 ? dz / d : 0
  // carpismadan kacinma (goreli hizla en yakin yaklasma): yandan dolas, yavasla.
  // mudahale aninda zayif, top surerken orta
  if (m > 0.05) {
    const weak = b.act ? 0.3 : p.hasBall ? 0.7 : 1
    const sp0 = Math.hypot(p.vx, p.vz)
    const vd = m * (b.sprint ? SPRINT_V : RUN_V)
    let slow = 1
    let sx = 0
    let sz = 0
    for (const q of game.players) {
      if (q === p || q.sentOff) continue
      const rx = q.x - p.x
      const rz = q.z - p.z
      const r = Math.hypot(rx, rz)
      if (r > 4 || r < 1e-3) continue
      if (b.duel && q.team !== p.team && r < 2.2) {
        // omuz: yalniz ayni yone paralel kosan rakibe yanal yaslan (locomotion 'shoulder', yasal);
        // paralel degilse normal kacinma (govde itisi 'body' faul olur)
        const sq = Math.hypot(q.vx, q.vz)
        const along = (rx * ux + rz * uz) / r
        if (sp0 > 2.5 && sq > 2.5 && (p.vx * q.vx + p.vz * q.vz) / (sp0 * sq) > 0.75 && Math.abs(along) < 0.6) {
          sx += (rx / r) * 0.3
          sz += (rz / r) * 0.3
          continue
        }
      }
      const wx = ux * vd - q.vx
      const wz = uz * vd - q.vz
      const w2 = wx * wx + wz * wz
      if (w2 < 0.25) continue
      const tc = Math.min(AVOID_T, Math.max(0, (rx * wx + rz * wz) / w2))
      if (tc <= 0) continue
      const cx = rx - wx * tc // en yakin anda q'nun bize gore konumu
      const cz = rz - wz * tc
      const dc = Math.hypot(cx, cz)
      if (dc >= AVOID_D) continue
      const k = (1 - dc / AVOID_D) * (1 - (0.6 * tc) / AVOID_T) * weak
      // q'nun en yakin anda kaldigi tarafin tersine
      let px = -uz
      let pz = ux
      if (px * cx + pz * cz > 0) {
        px = -px
        pz = -pz
      }
      sx += px * k * 1.6
      sz += pz * k * 1.6
      slow = Math.min(slow, 1 - k * 0.6)
    }
    ux += sx
    uz += sz
    const ul = Math.hypot(ux, uz) || 1
    ux /= ul
    uz /= ul
    m *= slow
  }
  // top surerken sert donus topu kacirir: aci buyukse yavasla (locomotion donerken topu toplar)
  if (p.hasBall) {
    const sp = Math.hypot(p.vx, p.vz)
    if (sp > 2) {
      const c = (p.vx * ux + p.vz * uz) / sp
      if (c < 0.6) m *= 0.35 + 0.4 * Math.max(0, c)
    }
  }
  // elde topu tutan kaleci (ceza alani): 2,2 m'den yaklasma, yakindaysa sahaya dogru uzaklas; bekleyen mudahaleyi sil
  const hk = game.players.find((q) => q.role === 'kaleci' && q.hasBall && q.team !== p.team && (world.ball.y > 0.3 || Math.abs(q.x) > HL - BOX_D))
  if (hk) {
    if (b.act && (b.act.type === 'tackle' || b.act.type === 'slide')) b.act = null
    b.jockey = false
    const kx = p.x - hk.x
    const kz = p.z - hk.z
    const kd = Math.hypot(kx, kz) || 1
    if (kd < 2.2) {
      const hd = dirOf(hk.team)
      let ax = kx / kd
      let az = kz / kd
      ax += hd * 0.8
      const al = Math.hypot(ax, az) || 1
      inp.move.x = (ax / al) * 0.8
      inp.move.z = (az / al) * 0.8
      inp.sprint = false
      inp.action = null
      ;(inp as PlayerInput & { jockey?: boolean }).jockey = false
      return
    }
    if (kd < 3 && m > 0.05) m = Math.min(m, 0.3)
  }
  const jk = b.jockey && !b.act && !p.hasBall
  inp.move.x = jk ? 0 : ux * m
  inp.move.z = jk ? 0 : uz * m
  ;(inp as PlayerInput & { jockey?: boolean }).jockey = jk
  inp.sprint = b.sprint && m > 0.7 && !jk
  const a = b.act
  if (a && p.actionLock <= 0) {
    inp.action = { type: a.type, power: a.power, aim: { x: a.x, y: a.y, z: a.z } }
    if (a.curl) inp.action.spin = { x: 0, y: (-a.curl / 3) * CURL_W, z: 0 }
    a.sent = true
  } else inp.action = null
}

// insan pasi: alici AI topa kossun (kontrol gecisi F'de, top alininca)
/** son insan pasinin AI alicisi (olcum ve gosterge icin) */
export const humanReceiver = { id: -1 }
let humanKick: { team: TeamId; by: number } | null = null
/** endirekt serbest vurusu kullanan oyuncu: baska oyuncu topa degene dek dogrudan sut yok */
let indirectTaker = -1
/** kirmizi cezasindan donen oyuncu: bu zamana kadar pas almaz (yerlesene dek) */
const retUntil: Record<number, number> = {}
const returning = (m: Player) => (retUntil[m.id] ?? 0) > t
let unsub: (() => void) | null = null
function ensureEvents() {
  if (unsub) return
  unsub = game.on((e) => {
    if ((e as { type: string }).type === 'player-return') {
      const id = (e as unknown as { player: number }).player
      retUntil[id] = t + 2
      const rb = brainOf(id)
      if (rb) rb.act = null
    }
    if (e.type === 'restart') indirectTaker = e.restart.indirect && e.restart.taker !== undefined ? e.restart.taker : -1
    else if (e.type === 'whistle') indirectTaker = -1
    else if (e.type === 'touch' && indirectTaker >= 0 && e.player !== indirectTaker) indirectTaker = -1
    if (e.type === 'foul') {
      const f = game.players[e.by]
      if (f && !human(f)) brainOf(f.id).noTackle = t + 6
      return
    }
    if (e.type !== 'touch' || (e.kind !== 'pass' && e.kind !== 'lob')) return
    const p = game.players[e.player]
    if (p && human(p)) humanKick = { team: p.team, by: p.id }
  })
}

/** insan top surerken pas secenekleri: takim arkadasi id -> 0..1 (pas yolu acikligi). Gosterge icin (F/I) */
export const hintDbg = { n: 0, off: 0, sum: 0, d: 0, calls: 0, close: 0, far: 0 }
export const passHints: { id: number; q: number }[] = []
function updatePassHints(carrier: Player | null) {
  passHints.length = 0
  if (!carrier || !human(carrier)) return
  hintDbg.calls++
  for (const m of teamOf(carrier.team)) {
    if (m === carrier || m.role === 'kaleci' || returning(m)) continue
    const d = dist(carrier.x, carrier.z, m.x, m.z)
    if (d < 3) hintDbg.close++
    if (d > 26) hintDbg.far++
    if (d < 3 || d > 26) continue
    const lx = m.x + m.vx * 0.45
    const lz = m.z + m.vz * 0.45
    const ahead = dirOf(m.team) * (m.x + m.vx * 0.2) - onsideMax(m.team, world.ball.x)
    if (ahead > 0) {
      hintDbg.off++
      continue // ofsaytta
    }
    const mg = laneMargin(carrier.team, carrier.x, carrier.z, lx, lz, false)
    hintDbg.n++
    hintDbg.sum += Math.max(-2, Math.min(2, mg))
    hintDbg.d += d
    // insan icin gosterge: hafif riskli secenek de gosterilir (kalite 0..1)
    if (mg > -0.15) passHints.push({ id: m.id, q: clamp((mg + 0.15) / 0.75, 0, 1) })
  }
}

/** her kare: gdt = dt * timeScale (oyun zamani) */
export function updateAI(gdt: number) {
  ensureEvents()
  if (gdt <= 0) return
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0
  t += gdt
  tick++
  const m = game.match
  if (m.phase !== lastPhase) {
    lastPhase = m.phase
    for (const b of brains) b.act = null
  }
  if (m.restart !== lastRestart) {
    lastRestart = m.restart
    restartT = t
    use(m.restart?.team ?? 0)
    takerDelay = T.takerDelay[0] + rnd() * (T.takerDelay[1] - T.takerDelay[0])
  }
  predictBall(world.ball)
  if (humanKick) {
    // en erken bulusabilen AI takim arkadasi alici olur
    let best: Player | null = null
    let bt = 9
    for (const p of teamOf(humanKick.team)) {
      if (p.id === humanKick.by || human(p) || p.role === 'kaleci') continue
      const it = interceptTime(p)
      if (it.t < bt) {
        bt = it.t
        best = p
      }
    }
    humanReceiver.id = best ? best.id : -1
    if (best) {
      const it = interceptTime(best)
      const b = brainOf(best.id)
      b.receiveUntil = t + Math.min(3, it.t + 0.8)
      b.rx = b.tx = it.x
      b.rz = b.tz = it.z
      b.sprint = true
      b.speed = 1
    }
    humanKick = null
  }

  const idle = m.phase === 'halftime' || m.phase === 'fulltime' || m.phase === 'var'
  const restart = m.phase !== 'play' && m.restart && !idle ? m.restart : null
  for (const team of [0, 1] as TeamId[]) {
    if (t < nextDecide[team]) continue
    use(team)
    nextDecide[team] = t + 1 / T.decideHz
    if (restart) restartThink(team, restart, t - restartT)
    else if (m.phase === 'play') decideTeam(team)
    else {
      // durmus oyun: sakin konum
      for (const p of teamOf(team)) {
        const b = brainOf(p.id)
        b.act = null
        b.sprint = false
        b.speed = 0.5
        // duraklama/kurulum: kurallar yerlestirir; yerinde kal
        b.tx = p.x
        b.tz = p.z
      }
    }
  }
  // kaleci sut tepkisi ve bosta pasin onune kosma her kare icin daha sik: kaleci kararlarini her karede
  if (m.phase === 'play') {
    const carrier = game.players.find((p) => p.hasBall && active(p)) ?? null
    for (const team of [0, 1] as TeamId[]) {
      const k = keeperOf(team)
      if (k && !human(k) && !k.hasBall && (tick & 1) === 0) keeperThink(k, brainOf(k.id), carrier)
    }
  }
  // kaleci elde tutma: sert ust sinir. Kural 3 s; atis/vole temasi 0.35-0.45 s surdugu icin
  // aksiyon en gec 2.2 s'de gonderilir (kilit varsa kilit biter bitmez)
  for (const team of [0, 1] as TeamId[]) {
    const k = keeperOf(team)
    if (!k || human(k)) continue
    const b = brainOf(k.id)
    if (!k.hasBall) {
      b.holdStart = -1
      continue
    }
    if (b.holdStart < 0) {
      use(team)
      b.holdStart = t
      const quick = bestPass(k, false, true)
      const counter = quick && quick.margin > 0.5 && (quick.x - k.x) * dirOf(team) > 14 && rnd() < 0.5
      b.keeperHoldT = t + (counter ? 0.8 + rnd() * 0.3 : T.keeperHold[0] + rnd() * (T.keeperHold[1] - T.keeperHold[0]))
    }
    b.keeperHoldT = Math.min(b.keeperHoldT, b.holdStart + 2.2)
    // dagitim zamani geldi ve bekleyen aksiyon yok: hemen karar ver (takim karar karesini bekleme)
    if (m.phase === 'play' && t > b.keeperHoldT && !b.act) keeperThink(k, b, null)
  }
  for (const p of game.players) {
    if (human(p)) continue
    const inp = game.inputs[p.id]
    if (!inp) continue
    if (!active(p) || idle) {
      inp.move.x = inp.move.z = 0
      inp.sprint = false
      inp.action = null
      continue
    }
    const b = brainOf(p.id)
    // aksiyon tuketildi mi: gonderildi ve locomotion aldi (kilit basladi), ya da sure doldu.
    // gondermeden onceki kilit (ilk dokunus, dusme) aksiyonu silmez, bitince gonderilir
    if (b.act && ((b.act.sent && (p.actionLock > 0 || inp.action === null)) || t > b.act.until)) b.act = null
    const ballAct = b.act && (b.act.type === 'pass' || b.act.type === 'shoot' || b.act.type === 'lob')
    if (ballAct && b.wasCarrying && !p.hasBall) b.act = null
    b.wasCarrying = p.hasBall
    if (b.jockey) jockeyTackle(p, b, gdt)
    writeInput(p, b, inp)
  }
  if (t0) {
    const ms = performance.now() - t0
    aiStats.ms = aiStats.ms * 0.98 + ms * 0.02
    aiStats.msMax = Math.max(aiStats.msMax * 0.999, ms)
  }
}

/** ayiklama: oyuncu hedefleri ve bekleyen aksiyonlar */
export const aiDebug = () => brains.map((b) => ({ tx: b.tx, tz: b.tz, sprint: b.sprint, act: b.act?.type ?? null }))
