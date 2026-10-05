// Hareket + top aksiyonlari: TEK modul. Insan ve AI ayni PlayerInput'u uretir; burada uygulanir.
// Arayuz ve aksiyon semantigi: control/locomotionApi.ts.
import { game } from '../game/store'
import type { ActionType, AnimState, Player, PlayerInput, Vec3 } from '../game/types'
import { BALL_R, PITCH_L, PITCH_W } from '../pitch'
import { world, type DynCollider } from '../sim'
import { G, freeStep, newBall } from '../sim/ball'
import { CLIP_LEN } from '../anim/timing'
import { DOWN_T, diveClock, diveOf, diveState, keeperTune, planDive, saveProb } from '../sim/keeperDive'
import { footTiming } from '../anim/events'
import { CURL_W, solveShot } from './aim'
import { CURL_STEPS } from './store'
import {
  ACCEL,
  CATCH_SPEED,
  DECEL,
  DRIBBLE_MUL,
  HEADER_REACH,
  KEEPER_CATCH_T,
  KEEPER_KICK_CONTACT,
  KEEPER_KICK_T,
  KEEPER_MUL,
  KEEPER_PUNCH_T,
  KEEPER_THROW_CONTACT,
  KEEPER_THROW_T,
  LOSE_DIST,
  PUNCH_SPEED,
  RUN_SPEED,
  SLIDE_DIST,
  SLIDE_LOCK,
  SLIDE_GETUP_AT,
  SPRINT_DRIBBLE_MUL,
  SPRINT_ESCAPE,
  SPRINT_SPEED,
  STUMBLE_LOCK,
  JOCKEY_DIST,
  JOCKEY_SPEED,
  SLIDE_HIT_R,
  SLIDE_LEG,
  SLIDE_PREP,
  TACKLE_HIT_R,
  TACKLE_LEG,
  TACKLE_LUNGE,
  TACKLE_LOCK,
  TRAP_ANIM_T,
  TRAP_DIST,
  TURN_RATE,
  V_MAX,
  V_MIN,
} from './locomotionApi'

const _ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env
// A/B testi icin ortam degiskenleri (varsayilan = guncel degerler)
const TUNE = {
  mu: Number(_ENV?.LOCO_MU ?? 0.18),
  hitR: Number(_ENV?.LOCO_HITR ?? 0),
  body: Number(_ENV?.LOCO_BODY ?? 0.35),
  stop: Number(_ENV?.LOCO_STOP ?? 0.6),
  idle: _ENV?.LOCO_IDLE !== '0',
  queue: _ENV?.LOCO_QUEUE !== '0',
}
const HL = PITCH_L / 2
const HW = PITCH_W / 2
const FOOT = 0.45 // ayak noktasi: govdenin bu kadar onu
const BODY_R = 0.22
const PUSH_R = 0.3 // oyuncu-oyuncu itisme yaricapi
const SHOULDER_R = 0.78 // paralel kosan rakipler bu mesafede omuz omuza
const KICK_LOCK = 0.38
const HEADER_LOCK = 0.5
const FALL_LOCK = CLIP_LEN.fall + CLIP_LEN.getup
const TRAP_MAX_SPEED = 13 // bunun ustunde top yalniz kapsule carpar
const KICKER_GHOST = 0.22 // vurusta vurucunun kapsulu bu kadar yok sayilir (top geri sekmesin)
const BOX_D = 8 // ceza alani derinligi
const BOX_W = 8 // yari genislik

// zemin yuvarlanma direnci (sim/ball.ts ile ayni): a = C0 + C1 v
const ROLL_C0 = 0.9
const ROLL_C1 = 0.09

interface Act {
  type: ActionType
  t: number
  aim: Vec3
  power: number
  spin?: Vec3
  done: boolean
  dx: number // aksiyon yonu (birim)
  dz: number
  sx: number // baslangic konumu
  sz: number
  hit: Set<number> // temas yayilan rakipler
  ballFirst: boolean
  keeper: '' | 'throw' | 'kick' // kalecinin elden vurusu
  getupAt: number // kayarken getup baslangici (animT)
}

const acts: (Act | null)[] = []
const lastTouch: number[] = [] // oyuncunun topa son dokunusu (oyun zamani)
const noPickup: number[] = [] // bu zamana kadar topu alamaz
const kickT: number[] = [] // son vurus ani (kapsul hayaleti)
const holdUntil: number[] = [] // bu zamana kadar hareket animasyonu ezmez (trap/omuz/kaleci klibi)
const pairT = new Map<number, number>() // govde temasi yayma araligi
let T = 0
let keeperHolding = -1
const cols: DynCollider[] = []

const fwd = (p: Player) => [Math.sin(p.facing), Math.cos(p.facing)] as const
const ownGoalX = (p: Player) => -game.match.attackDir[p.team] * HL
const now = () => T
const rnd = () => Math.random()

function setAnim(p: Player, a: AnimState) {
  if (p.anim !== a) {
    p.anim = a
    p.animT = 0
  }
}

/** klibi dur suresince tut (hareket animasyonu ezmez) */
function holdAnim(p: Player, a: AnimState, dur: number) {
  setAnim(p, a)
  holdUntil[p.id] = T + dur
}

function touch(p: Player, kind: 'dribble' | 'pass' | 'shoot' | 'lob' | 'tackle' | 'header' | 'save' | 'trap') {
  lastTouch[p.id] = T
  game.emit({ type: 'touch', player: p.id, kind })
}

/** insan kontrolunu bu oyuncuya gecir (tek kontrollu oyuncu) */
export function setControlled(id: number) {
  for (const p of game.players) p.controlled = p.id === id
}

/** topu birakmak: tum sahiplikleri dusur */
function releaseBall(except = -1) {
  for (const q of game.players) if (q.id !== except) q.hasBall = false
  if (keeperHolding >= 0 && keeperHolding !== except) {
    world.holdBall(false)
    keeperHolding = -1
  }
}

// yuvarlanan topun v0'dan v1'e inene dek aldigi yol: zemin direnci (C0 + C1 v) + hava surtunmesi
// (sim/ball.ts airStep ile ayni Cd). Sayisal, 1/120 s.
const AIR_K = (0.5 * 1.2 * Math.PI * BALL_R * BALL_R) / 0.43
function rollDist(v0: number, v1: number) {
  let v = v0
  let d = 0
  const h = 1 / 120
  for (let i = 0; i < 4000 && v > v1; i++) {
    const cd = 0.24 + 0.2 / (1 + Math.exp((v - 11) / 1.5))
    const a = ROLL_C0 + ROLL_C1 * v + AIR_K * cd * v * v
    d += v * h
    v -= a * h
  }
  return d
}

/** yerden pas: mesafe d'yi top ~arrive hizla bitirsin */
export function passSpeed(d: number, arrive = 4.5) {
  let lo = arrive
  let hi = 40
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2
    if (rollDist(m, arrive) < d) lo = m
    else hi = m
  }
  return lo
}

// yuvarlanma spini: kaymadan yuvarlansin (sim/ball groundContact ile ayni isaret)
const rollSpin = (vx: number, vz: number): Vec3 => ({ x: vz / BALL_R, y: 0, z: -vx / BALL_R })

const BISECT = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {} // bisect bayraklari (yalniz Node testleri)
let shotFromX = 0 // son vurusun yapildigi x (dalista yakin sut olasiligi icin)
let shotFromT = -9
let shotByHuman = false // son vurusu insan kontrolundeki oyuncu yapti (ayakta kurtarma zari yalniz insan sutlarinda)
let standT = -99 // ayakta kurtaris zarinin atildigi sut
let standOk = true

function kickBall(p: Player, v: Vec3, w: Vec3) {
  releaseBall()
  const b = world.ball
  shotFromX = b.x
  shotFromT = T
  shotByHuman = p.controlled || game.remote.has(p.id) // uzak insan (misafir) de insan sayilir
  if (b.y < BALL_R) b.y = BALL_R
  world.kick(v, w)
  noPickup[p.id] = T + 0.3
  kickT[p.id] = T
}

const sim = newBall()
/** asirtma: ~40 derece, inis noktasi aim olacak hiz (surukleme dahil, birkac yineleme) */
export function lobVelocity(bx: number, bz: number, ax: number, az: number, by = BALL_R, wy = 0): Vec3 {
  if (wy !== 0) return lobCurled(bx, bz, ax, az, by, wy)
  const th = (40 * Math.PI) / 180
  const dx = ax - bx
  const dz = az - bz
  const D = Math.hypot(dx, dz) || 1
  let V = Math.sqrt((-G * D) / Math.sin(2 * th))
  for (let it = 0; it < 6; it++) {
    const c = Math.cos(th)
    Object.assign(sim, { x: bx, y: by, z: bz, vx: (V * c * dx) / D, vy: V * Math.sin(th), vz: (V * c * dz) / D, wx: 0, wy: 0, wz: 0 })
    let t = 0
    while (t < 5) {
      // ilk inis: zemin temasi vy'yi ayni adimda cevirir, bu yuzden onceki vy'ye bak
      const vyPrev = sim.vy
      freeStep(sim, 1 / 120)
      t += 1 / 120
      if (vyPrev < 0 && sim.y <= BALL_R + 1e-3) break
    }
    const got = Math.hypot(sim.x - bx, sim.z - bz)
    if (got < 0.1) break
    V *= Math.sqrt(D / got)
    if (Math.abs(got - D) < 0.05) break
  }
  V = Math.min(V, V_MAX)
  const c = Math.cos(th)
  return { x: (V * c * dx) / D, y: V * Math.sin(th), z: (V * c * dz) / D }
}

/** falsolu asirtma: inis noktasi (ax,az) olacak sekilde cikis yonu ve hizi coz (dusey donme wy) */
function lobCurled(bx: number, bz: number, ax: number, az: number, by: number, wy: number): Vec3 {
  const th = (40 * Math.PI) / 180
  const c = Math.cos(th)
  const dx = ax - bx
  const dz = az - bz
  const D = Math.hypot(dx, dz) || 1
  let V = Math.sqrt((-G * D) / Math.sin(2 * th))
  let tx = ax
  let tz = az
  for (let it = 0; it < 10; it++) {
    const ex = tx - bx
    const ez = tz - bz
    const E = Math.hypot(ex, ez) || 1
    Object.assign(sim, { x: bx, y: by, z: bz, vx: (V * c * ex) / E, vy: V * Math.sin(th), vz: (V * c * ez) / E, wx: 0, wy, wz: 0 })
    let t = 0
    while (t < 5) {
      const vyPrev = sim.vy
      freeStep(sim, 1 / 120)
      t += 1 / 120
      if (vyPrev < 0 && sim.y <= BALL_R + 1e-3) break
    }
    const rx = ax - sim.x
    const rz = az - sim.z
    if (Math.hypot(rx, rz) < 0.1) break
    // yanal hata: nisani kaydir; boyuna hata: hizi olcekle
    tx += rx
    tz += rz
    const got = Math.hypot(sim.x - bx, sim.z - bz)
    V *= Math.sqrt(Math.min(1.5, Math.max(0.67, D / Math.max(0.5, got))))
  }
  V = Math.min(V, V_MAX)
  const ex = tx - bx
  const ez = tz - bz
  const E = Math.hypot(ex, ez) || 1
  return { x: (V * c * ex) / E, y: V * Math.sin(th), z: (V * c * ez) / E }
}

function ballDist(p: Player) {
  const [fx, fz] = fwd(p)
  const b = world.ball
  return Math.hypot(b.x - (p.x + fx * FOOT), b.z - (p.z + fz * FOOT))
}

// karsilama mesafesi: ayak noktasi ya da govde cevresi (yandan/arkadan gelen top da alinir)
const trapDist = (p: Player) => Math.min(ballDist(p), Math.max(0, Math.hypot(world.ball.x - p.x, world.ball.z - p.z) - 0.2))


// --------------------------------------------------------------- aksiyonlar
function startAction(p: Player, a: NonNullable<PlayerInput['action']>) {
  if (a.type === 'dive' && p.role !== 'kaleci') return
  if (a.type === 'dive' && BISECT.KS_DIVEOFF) return
  let ax = a.aim.x
  let az = a.aim.z
  // mudahale: hedef topsa topun temas anindaki (0.22 s) konumuna one hedefle (kosan surucunun topu onde gider)
  if (a.type === 'tackle') {
    const bb = world.ball
    if (Math.hypot(ax - bb.x, az - bb.z) < 0.6) {
      ax = bb.x + bb.vx * CLIP_LEN.tackleContact
      az = bb.z + bb.vz * CLIP_LEN.tackleContact
    }
  }
  let dx = ax - p.x
  let dz = az - p.z
  const d = Math.hypot(dx, dz)
  if (d > 1e-3) {
    dx /= d
    dz /= d
  } else [dx, dz] = fwd(p)
  const act: Act = { ...a, t: 0, done: false, dx, dz, sx: p.x, sz: p.z, hit: new Set(), ballFirst: false, keeper: '', getupAt: SLIDE_GETUP_AT }
  acts[p.id] = act
  const b = world.ball
  // vurus oncesi: govde vurus yonune doner, suren oyuncu topu ayaginin onune "yerlestirir"
  const plant = () => {
    p.facing = Math.atan2(dx, dz)
    if (p.hasBall && b.y < 0.5) {
      const vx = p.vx * 0.5
      const vz = p.vz * 0.5
      world.kick({ x: vx, y: 0, z: vz }, rollSpin(vx, vz))
    }
  }
  switch (a.type) {
    case 'shoot':
    case 'lob':
    case 'pass':
      if (keeperHolding === p.id) {
        // elden: atis (yerden pas) ya da vole
        act.keeper = a.type === 'pass' ? 'throw' : 'kick'
        p.facing = Math.atan2(dx, dz)
        setAnim(p, act.keeper === 'throw' ? 'keeper-throw' : 'keeper-kick')
        p.actionLock = act.keeper === 'throw' ? KEEPER_THROW_T : KEEPER_KICK_T
        break
      }
      plant()
      setAnim(p, a.type === 'pass' ? 'pass' : 'kick')
      p.actionLock = KICK_LOCK
      break
    case 'tackle':
      // kisa atilma; iska varsayilan kilit (temas + 0.4 s toparlanma), basarida kisalir
      setAnim(p, 'tackle')
      p.actionLock = TACKLE_LOCK
      p.facing = Math.atan2(dx, dz)
      break
    case 'slide':
      // 0.15 s hazirlik + 0.5 s kayma + iskada 0.9 s yerde (temasta 0.5 s)
      setAnim(p, 'slide')
      p.actionLock = SLIDE_LOCK
      p.facing = Math.atan2(dx, dz)
      break
    case 'header':
      setAnim(p, 'header')
      p.actionLock = HEADER_LOCK
      break
    case 'dive': {
      // kalecinin bakisina gore sol/sag, hedef yuksekligine gore alcak/yuksek
      // karakterin solu dunyada (cos f, -sin f) (glTF ileri +Z, sol +X)
      const gxk = ownGoalX(p)
      const spec = planDive({
        id: p.id,
        t0: T,
        kx: p.x,
        kz: p.z,
        facing: p.facing,
        goalX: gxk,
        ball: b,
        aim: { x: a.aim.x, y: a.aim.y, z: a.aim.z },
        skill: keeperTune.skill,
        shotDist: T - shotFromT < 6 ? Math.abs(gxk - shotFromX) : undefined,
      })
      // hareket ve el yonu spec'ten (top yolunun ulasilabilir ilk noktasi)
      act.dx = spec.dir.x
      act.dz = spec.dir.z
      act.aim = { x: spec.contact.x, y: spec.contact.y, z: spec.contact.z }
      setAnim(p, `keeper-dive-${spec.high ? 'high' : 'low'}-${spec.side}` as AnimState)
      p.actionLock = Math.max(0.5, spec.tUp - T)
      break
    }
  }
  // ayni klip art arda (ikinci sut/pas) da bastan oynasin
  p.animT = 0
}

/** (px,pz) noktasinin (ax,az)-(bx,bz) dogru parcasina uzakligi */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax
  const vz = bz - az
  const L2 = vx * vx + vz * vz || 1e-9
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L2))
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t))
}

function shoulderContact(a: Player, b: Player, intensity: number, fromBehind: boolean, ballFirst: boolean) {
  const k = Math.max(0, Math.min(1, intensity))
  game.emit({ type: 'contact', a: a.id, b: b.id, ballFirst, fromBehind, intensity: k, kind: 'shoulder', x: b.x, z: b.z })
}

function contactWith(a: Player, b: Player, kind: 'tackle' | 'slide' | 'body' | 'shoulder', intensity: number, ballFirst: boolean) {
  // arkadan: KONUM tabanli. kurbandan baslataniya vektor ile kurbanin bakisi arasi aci > 120 derece
  // (hareket yonu kullanilmaz: geri giden jockey'li onden savunmaci arkadan sayilmasin)
  const [bx, bz] = fwd(b)
  const rx = a.x - b.x
  const rz = a.z - b.z
  const rl = Math.hypot(rx, rz) || 1
  const fromBehind = kind !== 'shoulder' && (rx * bx + rz * bz) / rl < -0.5
  const k = Math.max(0, Math.min(1, intensity))
  // yuksek temas: rakip havada (kafa vurusu, kaleci ucusu) ve temas kayma/mudahaleyse
  const air = b.anim === 'header' || b.anim.startsWith('keeper-dive') || b.anim === 'keeper-catch-high'
  game.emit({ type: 'contact', a: a.id, b: b.id, ballFirst, fromBehind, intensity: k, kind, x: b.x, z: b.z, high: (kind === 'slide' || kind === 'tackle') && air })
  if (kind !== 'shoulder' && k > 0.55 && b.actionLock < FALL_LOCK) {
    setAnim(b, 'fall')
    b.actionLock = FALL_LOCK
    if (b.hasBall) releaseBall()
    noPickup[b.id] = T + FALL_LOCK
  }
}

function runAction(p: Player, act: Act, gdt: number) {
  act.t += gdt
  const b = world.ball
  switch (act.type) {
    case 'shoot':
    case 'pass':
    case 'lob': {
      if (act.keeper) {
        // kalecinin elden vurusu
        const at = act.keeper === 'throw' ? KEEPER_THROW_CONTACT : KEEPER_KICK_CONTACT
        if (act.done || act.t < at || keeperHolding !== p.id) break
        act.done = true
        const [fx, fz] = fwd(p)
        world.holdBall(false)
        keeperHolding = -1
        if (act.keeper === 'throw') {
          // atis: el hizasindan alcak, yere inip yuvarlanir
          b.x = p.x + fx * 0.5
          b.z = p.z + fz * 0.5
          b.y = 0.9
          const d = Math.hypot(act.aim.x - b.x, act.aim.z - b.z) || 1
          const v = Math.min(18, passSpeed(d) * 0.95)
          kickBall(p, { x: ((act.aim.x - b.x) / d) * v, y: 1.0, z: ((act.aim.z - b.z) / d) * v }, { x: 0, y: 0, z: 0 })
          touch(p, 'pass')
        } else {
          // vole: dizden (y ~0.5) uzun
          b.x = p.x + fx * 0.55
          b.z = p.z + fz * 0.55
          b.y = 0.5
          const aim = act.type === 'shoot' ? { x: act.aim.x, z: act.aim.z } : act.aim
          kickBall(p, lobVelocity(b.x, b.z, aim.x, aim.z, 0.5), { x: 0, y: 0, z: 0 })
          touch(p, act.type === 'shoot' ? 'shoot' : 'lob')
        }
        break
      }
      // vurus ani animasyonla ayni (anim/timing.ts)
      const at = act.type === 'pass' ? CLIP_LEN.passContact : CLIP_LEN.kickContact
      if (act.done || act.t < at) break
      act.done = true
      // duran topta kullanan, sahiplik olmadan durgun topa vurur
      const reach = game.match.phase === 'play' ? 0.9 : 1.1
      const near = p.hasBall || (ballDist(p) < reach && b.y < 0.7)
      if (!near) break
      if (act.type === 'shoot') {
        const pw = Math.max(0, Math.min(1, act.power))
        const speed = V_MIN + (V_MAX - V_MIN) * pw
        const side = act.aim.x >= 0 ? 1 : -1
        // spin.y falso olarak cozucuye verilir (telafili); yoksa hafif ust donme
        const curl = act.spin ? Math.max(-CURL_STEPS, Math.min(CURL_STEPS, (-act.spin.y / CURL_W) * CURL_STEPS)) : 0
        const sh = solveShot(b.x, b.z, side, Math.max(BALL_R, act.aim.y), act.aim.z, speed, 'normal', curl)
        kickBall(p, sh.v, sh.w)
        touch(p, 'shoot')
      } else if (act.type === 'pass') {
        // power > 0: sutla ayni olcek (V_MIN..V_MAX); <= 0: mesafeden otomatik
        // aim aynen kullanilir (alicinin onunu AI/insan girdisi karsilar)
        const dx = act.aim.x - b.x
        const dz = act.aim.z - b.z
        const d = Math.hypot(dx, dz) || 1
        const v = act.power > 0 ? V_MIN + (V_MAX - V_MIN) * Math.min(1, act.power) : passSpeed(d)
        const vx = (v * dx) / d
        const vz = (v * dz) / d
        const rs = rollSpin(vx, vz)
        // falso: kisa dokunusta yari olcek (yerde Magnus yanal kivrim verir)
        if (act.spin) rs.y = act.spin.y * 0.5
        kickBall(p, { x: vx, y: 0, z: vz }, rs)
        touch(p, 'pass')
      } else {
        // top havadaysa (sekerken) gercek yukseklikten coz
        const lw = act.spin ? act.spin.y * 0.5 : 0
        kickBall(p, lobVelocity(b.x, b.z, act.aim.x, act.aim.z, Math.max(BALL_R, b.y), lw), { x: 0, y: lw, z: 0 })
        touch(p, 'lob')
      }
      break
    }
    case 'tackle': {
      // atilma: 0.22 s boyunca TACKLE_LUNGE (govde ~0.7 m) + bacak 0.5 m => menzil ~1.2 m.
      // Rakibin icine girmez: onundeki rakibe 0.55 m kalinca atilma durur (govde teması yalniz gercek carpisma olsun)
      let k = act.t < 0.22 ? 1 : Math.max(0, 1 - (act.t - 0.22) / 0.2)
      for (const q of game.players) {
        if (q.team === p.team || q.sentOff) continue
        const rx = q.x - p.x
        const rz = q.z - p.z
        const rd = Math.hypot(rx, rz)
        if (rd < TUNE.stop && rx * act.dx + rz * act.dz > 0) k = 0
      }
      p.vx = act.dx * TACKLE_LUNGE * k
      p.vz = act.dz * TACKLE_LUNGE * k
      if (act.done || act.t < CLIP_LEN.tackleContact) break
      act.done = true
      // bacak ucu
      const lx = p.x + act.dx * TACKLE_LEG
      const lz = p.z + act.dz * TACKLE_LEG
      // top bacak boyunca (govdeden bacak ucuna) herhangi bir noktaya yakinsa ulasilir (ONCE topa bakilir)
      const dBall = segDist(b.x, b.z, p.x, p.z, lx, lz)
      const owner = game.players.find((q) => q.hasBall && q.team !== p.team)
      let ok = b.y < 0.6 && dBall < (TUNE.hitR || TACKLE_HIT_R)
      // zamanlama/aci: sahip hizli kosuyorsa, yon degistirdiyse ya da mudahale arkadan/yandan geliyorsa topu kacirabilir.
      // Kacirma = top degdi ama alinamadi (sektirir, faul degil); gercekten ıska ise temas yok
      let slip = false
      if (ok && owner) {
        const osp = Math.hypot(owner.vx, owner.vz)
        const [of, og] = fwd(owner)
        const head = act.dx * of + act.dz * og // -1: onden, +1: arkadan
        let pOk = 0.97 - 0.3 * Math.min(1, osp / SPRINT_SPEED) - 0.12 * Math.max(0, head) - 0.15 * (dBall / TACKLE_HIT_R)
        if (T - (cutT[owner.id] ?? -9) < 0.35) pOk -= 0.25
        if (owner.anim === 'shield') pOk -= 0.15
        if (rnd() > Math.max(0.4, pOk)) slip = true
      }
      if (ok) {
        act.ballFirst = true
        p.actionLock = Math.min(p.actionLock, 0.3) // basarida hizli toparlanma
        if (owner) noPickup[owner.id] = T + 0.5
        // onden mudahale (tackler sahibin onunde): top tackler'a; yandan/arkadan: top durtulur
        let front = true
        if (owner) {
          const [of, og] = fwd(owner)
          front = act.dx * of + act.dz * og < -0.3
        }
        if (front && !slip) {
          releaseBall()
          p.hasBall = true
          const vx = p.vx * 0.4
          const vz = p.vz * 0.4
          world.kick({ x: vx, y: 0, z: vz }, rollSpin(vx, vz))
          lastTouch[p.id] = T
          game.emit({ type: 'touch', player: p.id, kind: 'tackle' })
        } else {
          // yana durtus: bacagin topa vurdugu taraf belirler (rastgele degil)
          const off = (b.x - lx) * -act.dz + (b.z - lz) * act.dx
          const sx = act.dx * 3.2 - act.dz * off * 6
          const sz = act.dz * 3.2 + act.dx * off * 6
          kickBall(p, { x: sx, y: 0, z: sz }, rollSpin(sx, sz))
          noPickup[p.id] = T
          touch(p, 'tackle')
        }
      }
      // rakip temasi: yalniz gercekten ic ice girisse (0.35 m) ve topa ulasilmadiysa ya da govde topa gore daha yakinsa.
      // Topa once degdiyse temas 'ballFirst' ve dusuk siddetli (K temiz sayar)
      for (const q of game.players) {
        if (q.team === p.team || q.sentOff) continue
        const dBody = segDist(q.x, q.z, p.x, p.z, lx, lz)
        if (dBody >= TUNE.body) continue
        if (ok) {
          // top once: govde yalniz bacak topa degdikten sonra sürtünür
          contactWith(p, q, 'tackle', 0.2 + Math.min(0.15, Math.hypot(p.vx, p.vz) / 24), true)
        } else {
          contactWith(p, q, 'tackle', 0.3 + Math.min(0.2, Math.hypot(p.vx - q.vx, p.vz - q.vz) / 16), false)
        }
      }
      break
    }
    case 'slide': {
      // hazirlik (yavasla), sonra dogrusal yavaslayarak SLIDE_DIST, sonra yerde
      const prep = SLIDE_PREP
      const dur = 0.5
      const v0 = (2 * SLIDE_DIST) / dur
      if (act.t < prep) {
        p.vx *= 0.8
        p.vz *= 0.8
        break
      }
      const ts = act.t - prep
      const k = Math.max(0, 1 - ts / dur)
      p.vx = act.dx * v0 * k
      p.vz = act.dz * v0 * k
      if (ts > dur) break
      const fx = p.x + act.dx * SLIDE_LEG
      const fz = p.z + act.dz * SLIDE_LEG
      const dB = segDist(b.x, b.z, p.x, p.z, fx, fz)
      // rakip govdesine toptan once degme (faul adayi)
      for (const q of game.players) {
        if (q.team === p.team || q.sentOff || act.hit.has(q.id)) continue
        if (Math.hypot(q.x - fx, q.z - fz) < 0.6) {
          act.hit.add(q.id)
          contactWith(p, q, 'slide', 0.25 + 0.4 * ((v0 * k) / 14) + (act.done ? 0 : 0.2), act.done)
        }
      }
      if (!act.done && b.y < 0.5 && dB < SLIDE_HIT_R) {
        act.done = true
        act.ballFirst = act.hit.size === 0
        for (const q of game.players) if (q.hasBall && q.id !== p.id) noPickup[q.id] = T + 0.6
        // top guclu disari: kayma yonu + bacagin topa degdigi yana sapma
        const off = (b.x - fx) * -act.dz + (b.z - fz) * act.dx
        // kayan oyuncudan hizli olmali (yoksa govde topu gecip geri iter)
        const sp = Math.max(7 + 2 * k, v0 * k * 1.2 + 2)
        const vx = (act.dx - act.dz * off * 2.5) * sp
        const vz = (act.dz + act.dx * off * 2.5) * sp
        kickBall(p, { x: vx, y: 0.5, z: vz }, { x: 0, y: 0, z: 0 })
        touch(p, 'tackle')
        // temasta yerde daha kisa
        p.actionLock = Math.min(p.actionLock, prep + dur - ts + 0.5)
        act.getupAt = Math.max(0.55, act.t + 0.15)
      }
      break
    }
    case 'header': {
      if (act.done || act.t < CLIP_LEN.headerContact) break
      act.done = true
      if (b.y > 1.1 && b.y < 2.5 && Math.hypot(b.x - p.x, b.z - p.z) < HEADER_REACH) {
        const sp = 8 + 10 * Math.max(0, Math.min(1, act.power))
        let dx = act.aim.x - b.x
        let dy = act.aim.y - b.y
        let dz = act.aim.z - b.z
        const d = Math.hypot(dx, dy, dz) || 1
        dx /= d
        dy /= d
        dz /= d
        kickBall(p, { x: dx * sp, y: dy * sp + 1.5, z: dz * sp }, { x: 0, y: 0, z: 0 })
        touch(p, 'header')
      }
      break
    }
    case 'dive': {
      // ucus profili: itis 0-0.1 s (hizlanma), havada 0.1-0.45 s (sabit), inis kaymasi 0.45-0.75 s (yavaslama)
      // menzil 1.5-2.5 m (hedef daha yakinsa en az 0.6 m); toplam yol = V * 0.55
      // sim/keeperDive.ts: itis -> havada sabit yatay hiz -> inisten sonra kayma; yerde kalma, sonra kalkis
      const sp = diveOf(p.id)
      if (sp) {
        const st = diveState(sp, T)
        p.vx = sp.dir.x * st.v
        p.vz = sp.dir.z * st.v
        if (T > sp.tStop + DOWN_T && keeperHolding !== p.id) setAnim(p, 'getup')
      } else {
        p.vx = 0
        p.vz = 0
      }
      break
    }
  }
}

// --------------------------------------------------------------- kaleci
/** el alani: top kalecinin ellerinin ulastigi bolgede mi */
function inHands(p: Player): boolean {
  const b = world.ball
  const act = acts[p.id]
  const [fx, fz] = fwd(p)
  if (act?.type === 'dive' && act.t > 0.05 && act.t < 0.9) {
    // dalis: govde merkezinden dalis yonunde 1.2 m'lik el segmenti, hedef yuksekliginde
    const hy = Math.max(0.25, Math.min(2.3, act.aim.y))
    const rx = b.x - p.x
    const rz = b.z - p.z
    const along = Math.max(-0.3, Math.min(1.2, rx * act.dx + rz * act.dz))
    const ex = rx - act.dx * along
    const ez = rz - act.dz * along
    return Math.hypot(ex, ez) < 0.45 && Math.abs(b.y - hy) < 0.6
  }
  // ayakta: yanlara 0.85 m, onde 1.0 m (egilip toplar), yukari 2.3 m
  const rx = b.x - p.x
  const rz = b.z - p.z
  const ahead = rx * fx + rz * fz
  const lat = Math.abs(rx * fz - rz * fx)
  return ahead > -0.35 && ahead < 1.0 && lat < 0.85 && b.y < 2.3
}

// kalecinin kendi ceza alani
const inOwnBox = (p: Player, x: number, z: number) => Math.abs(x - ownGoalX(p)) < BOX_D && Math.abs(z) < BOX_W
// takim arkadasinin bilerek verdigi top elle alinmaz (geri pas): son dokunan ayni takimsa ve top yerdeyse ayakla
function backPass(p: Player) {
  const lt = game.match.lastTouch
  return !!lt && lt.team === p.team && lt.player !== p.id && world.ball.y < 0.4
}

function keeperSave(p: Player) {
  if (p.role !== 'kaleci' || keeperHolding >= 0 || T < (noPickup[p.id] ?? 0)) return
  if (game.match.phase !== 'play') return
  const b = world.ball
  const gx = ownGoalX(p)
  // kendi ceza alaninda
  if (Math.abs(b.x - gx) > BOX_D || Math.abs(b.z) > BOX_W) return
  if (Math.abs(p.x - gx) > BOX_D + 0.5) return
  if (backPass(p)) return
  const sp = Math.hypot(b.vx, b.vy, b.vz)
  const act = acts[p.id]
  const spec = diveOf(p.id)
  const diving = act?.type === 'dive' && !!spec && T < spec.tStop
  if (diving) {
    // dalis: sonuc planda (sim/keeperDive.ts) onceden belli; yalniz temas penceresinde ve top ele yakinken uygulanir
    if (!spec || spec.outcome === 'miss' || Math.abs(T - spec.tc) > 0.12) return
    const h = diveState(spec, T).hand
    if (Math.hypot(b.x - h.x, b.y - h.y, b.z - h.z) > 0.75) return
    if (spec.outcome === 'parry') {
      world.kick(spec.parry, { x: 0, y: 0, z: 0 })
      noPickup[p.id] = T + 0.5
      kickT[p.id] = T
      touch(p, 'save')
      return
    }
    releaseBall()
    keeperHolding = p.id
    p.hasBall = true
    touch(p, 'save')
    return
  }
  if (!inHands(p)) return
  // ayakta kurtaris da olasiliksal: sut basina bir kez (>3 m/s, son vurustan 4 s icinde); basarisizsa eller tutmaz, top kapsulden sekebilir/gecebilir
  // ayakta kurtarma zari yalniz INSAN sutlarinda acik (bisect: AI-AI'da acikken gol/mac 2 kat artti); KS_ROLL=off|8|3 ile zorlanabilir
  const roll = BISECT.KS_ROLL ?? (shotByHuman ? '3' : 'off')
  if (roll === 'off') standOk = true
  const shotLive = roll === 'off' ? false : roll === '3' ? T - shotFromT < 4 : sp > 8 // son 4 s icinde bir vurustan gelen top (kisa/yuvarlanan sut dahil)
  if (sp > 3 && shotLive && shotFromT !== standT) {
    standT = shotFromT
    const [fx, fz] = fwd(p)
    const lat = Math.abs((b.x - p.x) * fz - (b.z - p.z) * fx)
    const margin = 1 - Math.min(1, lat / 0.85)
    const sd = T - shotFromT < 6 ? Math.abs(gx - shotFromX) : 12
    standOk = Math.random() < Math.min(0.97, saveProb(sp, margin, b.y, sd, keeperTune.skill) * keeperTune.stand)
  }
  if (sp > 3 && shotLive && !standOk) {
    if (BISECT.KS_NOPICK === '1') noPickup[p.id] = T + 0.8 // tutamadi: sekip kalan topu hemen toplamasin (kurtaris sayilmaz)
    return
  }
  if (sp > PUNCH_SPEED) return // kapsul carpismasi sektirir
  if (sp > CATCH_SPEED) {
    // yumrukla: sahanin icine, yana
    const field = -Math.sign(gx) || 1
    const side = b.z >= p.z ? 1 : -1
    world.kick({ x: field * (5 + sp * 0.12), y: 3 + (b.y > 1.5 ? 2 : 0), z: side * 3.5 }, { x: 0, y: 0, z: 0 })
    if (!diving) holdAnim(p, 'keeper-punch', KEEPER_PUNCH_T)
    noPickup[p.id] = T + 0.5
    kickT[p.id] = T
    touch(p, 'save')
    return
  }
  releaseBall()
  keeperHolding = p.id
  p.hasBall = true
  if (!diving) holdAnim(p, b.y > 1.2 ? 'keeper-catch-high' : 'keeper-collect', KEEPER_CATCH_T)
  touch(p, 'save')
}

// kaleci duruslari (aksiyon yokken)
function keeperAnim(p: Player, spd: number): AnimState | null {
  if (p.role !== 'kaleci') return null
  if (keeperHolding === p.id) return spd < 0.35 ? 'keeper-hold' : null
  const b = world.ball
  const gx = ownGoalX(p)
  // bire bir: topla rakip 4 m icinde, kaleci kendi alaninda
  const owner = game.players.find((q) => q.hasBall)
  if (
    owner &&
    owner.team !== p.team &&
    Math.hypot(owner.x - p.x, owner.z - p.z) < 4 &&
    Math.abs(p.x - gx) < BOX_D
  )
    return 'keeper-spread'
  if (Math.hypot(b.x - p.x, b.z - p.z) > 25) return null
  if (spd < 0.35) return 'keeper-ready'
  if (spd < 3.5) {
    const [fx, fz] = fwd(p)
    const lat = p.vx * fz - p.vz * fx // >0: sola
    const ahead = p.vx * fx + p.vz * fz
    if (Math.abs(lat) > Math.abs(ahead)) return lat > 0 ? 'keeper-shuffle-l' : 'keeper-shuffle-r'
  }
  return null
}

// --------------------------------------------------------------- sahiplik + ilk dokunus + surme
function trapKind(y: number): 'foot' | 'thigh' | 'chest' {
  return y < 0.35 ? 'foot' : y < 0.95 ? 'thigh' : 'chest'
}

/** ilk dokunus: iyi -> topu ayagin onune/yana yumusak alir; kotu -> 1-2 m seker */
function firstTouch(p: Player) {
  const b = world.ball
  // dusey hiz kismen sayilir (inen asirtmayi karsilamak yatay hizdan kolay)
  const rel = Math.hypot(b.vx - p.vx, b.vy * 0.4, b.vz - p.vz)
  const kind = trapKind(b.y)
  const [fx, fz] = fwd(p)
  const bsp = Math.hypot(b.vx, b.vz)
  // top arkadan geliyorsa (gelis yonu bakisla ayni) zor
  const back = bsp > 1 ? Math.max(0, (b.vx * fx + b.vz * fz) / bsp) : 0
  const q = rel / TRAP_MAX_SPEED + (1 - p.stamina) * 0.25 + back * 0.3 + (kind === 'foot' ? 0 : 0.12)
  const bad = rnd() < Math.max(0, Math.min(0.7, (q - 0.5) * 1.3))
  holdAnim(p, `trap-${kind}` as AnimState, TRAP_ANIM_T[kind])
  if (bad) {
    // kotu dokunus: gelis yonune ters, rastgele yana, 1.5-3 m/s (1-2 m)
    const s = 1.5 + rnd() * 1.5
    let dx = bsp > 0.5 ? b.vx / bsp : fx
    let dz = bsp > 0.5 ? b.vz / bsp : fz
    const a = (rnd() - 0.5) * 1.6
    const c = Math.cos(a)
    const sn = Math.sin(a)
    ;[dx, dz] = [dx * c - dz * sn, dx * sn + dz * c]
    const vx = dx * s * 0.6 + p.vx * 0.4
    const vz = dz * s * 0.6 + p.vz * 0.4
    world.kick({ x: vx, y: kind === 'foot' ? 0 : 0.8, z: vz }, { x: 0, y: 0, z: 0 })
    noPickup[p.id] = T + 0.35
    touch(p, 'trap')
    return
  }
  releaseBall()
  p.hasBall = true
  // yon: insan hareket girdisi (topu bir yana alma), yoksa oyuncunun hizi
  const inp = game.inputs[p.id]
  const m = Math.hypot(inp.move.x, inp.move.z)
  let vx: number
  let vz: number
  if (p.controlled && m > 0.2) {
    const s = 1.2 + 0.3 * Math.hypot(p.vx, p.vz)
    vx = (inp.move.x / m) * s
    vz = (inp.move.z / m) * s
  } else {
    vx = p.vx * 0.9
    vz = p.vz * 0.9
  }
  if (Math.hypot(p.vx, p.vz) < 1 && !(p.controlled && m > 0.2)) p.facing = Math.atan2(b.x - p.x, b.z - p.z)
  world.kick({ x: vx, y: kind === 'foot' ? 0 : -0.5, z: vz }, kind === 'foot' ? rollSpin(vx, vz) : { x: 0, y: 0, z: 0 })
  touch(p, 'trap')
}

function possession(gdt: number) {
  const b = world.ball
  if (keeperHolding >= 0) {
    const k = game.players[keeperHolding]
    if (!k || k.sentOff || !k.hasBall) {
      world.holdBall(false)
      keeperHolding = -1
    } else {
      const [fx, fz] = fwd(k)
      let hx = k.x + fx * 0.3
      let hy = 1.0
      let hz = k.z + fz * 0.3
      // dalistan tutulan top eldedir (yerde); kalkarken yavasca normal tutus noktasina gecer
      const ds = diveOf(k.id)
      if (ds && T < ds.tUp && T > ds.tc) {
        const st = diveState(ds, T)
        const e = st.phase === 'getup' ? st.u * st.u * (3 - 2 * st.u) : 0
        // havada: eldeki nokta; inisten sonra gogusun onunde yerde (govde+0.55 m ileri, 0.2 m yuksek)
        const lying = T > ds.tLand
        const gx0 = lying ? st.x + ds.dir.x * 0.55 : st.hand.x
        const gy0 = lying ? 0.2 : Math.max(0.16, st.hand.y + 0.05)
        const gz0 = lying ? st.z + ds.dir.z * 0.55 : st.hand.z
        hx = gx0 + (hx - gx0) * e
        hy = gy0 + (hy - gy0) * e
        hz = gz0 + (hz - gz0) * e
      }
      world.holdBall(true, hx, hy, hz)
      return
    }
  }
  const owner = game.players.find((q) => q.hasBall)
  if (owner && (Math.hypot(b.x - owner.x, b.z - owner.z) > LOSE_DIST || b.y > 1.2)) owner.hasBall = false
  const cur = game.players.find((q) => q.hasBall)

  // duran topta yalniz kullanan topu alip surebilir (ilk dokunus oyunu baslatir; gecis K'da)
  const playing = game.match.phase === 'play'
  const taker = playing ? -1 : (game.match.restart?.taker ?? -2)
  // duraklamada kaleci de topu birakir (sonraki karede holdBall(false))
  if (!playing) for (const q of game.players) if (q.id !== taker) q.hasBall = false

  if (b.y < 1.6) {
    let best: Player | null = null
    let bestD = TRAP_DIST
    for (const q of game.players) {
      if (q.sentOff || q.hasBall || q.actionLock > 0 || T < (noPickup[q.id] ?? 0)) continue
      if (!playing && q.id !== taker) continue
      // kendi alanindaki kaleci topu elle alir (keeperSave), ayakla karsilamaz
      if (playing && q.role === 'kaleci' && inOwnBox(q, b.x, b.z) && !backPass(q)) continue
      // yuksek top: govdeye yakin olmali
      const d = b.y < 0.5 ? trapDist(q) : Math.hypot(b.x - q.x, b.z - q.z) - 0.05
      if (d >= bestD) continue
      const rel = Math.hypot(b.vx - q.vx, b.vz - q.vz)
      if (rel > TRAP_MAX_SPEED) continue
      if (b.y >= 0.5 && b.vy > 2) continue // yukselen top alinmaz
      // sahipli topu yalniz daha yakinsa ve sahip bir suredir dokunmadiysa al
      if (cur && (ballDist(cur) < d + 0.3 || T - (lastTouch[cur.id] ?? -9) < 0.25)) continue
      best = q
      bestD = d
    }
    if (best) {
      if (!playing) {
        // duran top: kullanan durgun topu alir (kalite denetimi yok)
        releaseBall()
        best.hasBall = true
      } else firstTouch(best)
    }
  }
  const o = game.players.find((q) => q.hasBall)
  // duran topta bekleyen taker topu cekmesin (top kipirdayinca kurallar oyunu erken baslatiyordu); yalniz hareket varsa surer
  const idleTaker = TUNE.idle && !playing && !game.inputs[o?.id ?? 0]?.move.x && !game.inputs[o?.id ?? 0]?.move.z
  if (o && o.actionLock <= 0 && keeperHolding !== o.id && !idleTaker) dribble(o, gdt)
}

/** rakip arkada mi (top koruma) */
function shieldFrom(p: Player): Player | null {
  let best: Player | null = null
  let bd = 1.3
  for (const q of game.players) {
    if (q.team === p.team || q.sentOff) continue
    const d = Math.hypot(q.x - p.x, q.z - p.z)
    if (d < bd) {
      bd = d
      best = q
    }
  }
  return best
}

const dribPhase: number[] = []
const escapeT: number[] = []
const cutT: number[] = [] // son ani donus (kesme/geri cekme) ani
const prevM: number[] = [] // onceki karede girdi buyuklugu
const prevSp: number[] = []
const lastDrib: number[] = [] // son surme dokunusu

/** Top surme: top ayagin onunde bir hedef noktaya "yapisik" surulur (hiz dogrudan yazilir, gecikme yok).
 *  Yakin kontrol: 0.3-0.6 m, 2 adimda bir yumusak dokunus ritmi; yon degisince ayni karede yeni yone.
 *  Sprintle surme: 1-1.8 m, dusuk kazanc (genis donus); sert donuste top kacabilir. Durunca top tabanda. */
function dribble(p: Player, gdt: number) {
  const b = world.ball
  if (b.y > 0.35) return // havadaki top (sekme) surulmez
  const inp = game.inputs[p.id]
  const sp = Math.hypot(p.vx, p.vz)
  const m = Math.hypot(inp.move.x, inp.move.z)
  const [fx, fz] = fwd(p)
  const rx = b.x - p.x
  const rz = b.z - p.z
  const dist = Math.hypot(rx, rz)

  // top koruma: yavasken rakip yakindaysa sirtini don, topu uzak ayakta tut
  if (locoTuning.shield && sp < 1.5 && m < 0.6 && game.match.phase === 'play') {
    const opp = shieldFrom(p)
    if (opp) {
      let ax = p.x - opp.x
      let az = p.z - opp.z
      const al = Math.hypot(ax, az) || 1
      ax /= al
      az /= al
      const want = Math.atan2(ax, az)
      let da = want - p.facing
      da = Math.atan2(Math.sin(da), Math.cos(da))
      p.facing += Math.max(-5 * gdt, Math.min(5 * gdt, da))
      holdAnim(p, 'shield', 0.2)
      steerBall(p.x + ax * 0.55, p.z + az * 0.55, p.vx, p.vz, 10)
      return
    }
  }

  // istenen yon: girdi varsa girdi (top ayni karede yeni yone), yoksa bakis
  let ux = fx
  let uz = fz
  if (m > 0.15) {
    ux = inp.move.x / m
    uz = inp.move.z / m
  }
  const sprint = inp.sprint && sp > RUN_SPEED * 0.75
  // dokunus ritmi: adim frekansi ~1.6 + 0.25 v (Hz), 2 adimda bir dokunus
  // animasyon ayak zamanlamasi (footTiming.r: sag ayagin salinim sonuna kalan sure) varsa dokunus ona senkron,
  // yoksa (basiz test) kendi sayacimiz
  const f = 1.6 + 0.25 * sp
  let ph = (dribPhase[p.id] ?? 0) + (gdt * f) / 2
  const ft = footTiming[p.id]?.r ?? 9
  const live = ft < 8
  const strike = live ? ft < gdt && T - (lastDrib[p.id] ?? -9) > 0.25 : ph >= 1
  if (strike) {
    ph = 0
    if (m > 0.15) {
      touch(p, 'dribble')
      lastDrib[p.id] = T
    }
  }
  dribPhase[p.id] = ph % 1
  const saw = 1 - (ph % 1) // dokunusta onde, sonra ayaga geri gelir

  // ani donus ve durma animasyonlari (mekanik asagida: top ayni karede yeni yone / taban altinda)
  const pm = prevM[p.id] ?? 0
  const psp = prevSp[p.id] ?? 0
  prevM[p.id] = m
  prevSp[p.id] = sp
  if (T - (cutT[p.id] ?? -9) > 0.7 && psp > 2.2 && m > 0.3 && sp > 0.5) {
    // gecen hiz yonu ile istenen yon arasindaki aci
    const vx = p.vx / sp
    const vz = p.vz / sp
    const cosA = vx * ux + vz * uz
    if (cosA < 0.05) {
      // >= 90 derece
      cutT[p.id] = T
      if (cosA < -0.8) holdAnim(p, 'drag-back', 0.55)
      else {
        const left = ux * Math.cos(p.facing) - uz * Math.sin(p.facing) > 0
        holdAnim(p, left ? 'cut-l' : 'cut-r', 0.45)
      }
    }
  } else if (m < 0.15 && pm > 0.3 && psp > 2.5) {
    holdAnim(p, 'sole-stop', 0.4)
  }

  if (!sprint) {
    // yakin kontrol
    const lead = m > 0.15 ? 0.32 + 0.22 * saw * Math.min(1, sp / 4) : 0.3
    steerBall(p.x + ux * lead, p.z + uz * lead, p.vx, p.vz, 14)
    return
  }
  // sprintle surme: top 1-1.8 m onde, gec takip; sert donuste kacabilir
  const ahead = rx * ux + rz * uz
  const turnCos = dist > 0.2 ? ahead / dist : 1
  if (turnCos < 0.26 && dist > 0.9 && T > (escapeT[p.id] ?? -9)) {
    escapeT[p.id] = T + 0.8
    if (rnd() < SPRINT_ESCAPE) {
      // top kacti: mevcut hiziyla serbest
      p.hasBall = false
      noPickup[p.id] = T + 0.35
      return
    }
  }
  const lead = 1.0 + 0.8 * saw
  steerBall(p.x + ux * lead, p.z + uz * lead, p.vx, p.vz, 4.5)
}

/** topu (tx,tz) hedefine oyuncu hiziyla birlikte surer: v = vOyuncu + k (hedef - top), yuvarlanma spini */
function steerBall(tx: number, tz: number, pvx: number, pvz: number, k: number) {
  const b = world.ball
  // cizgide top iceride kalir (oyuncu disari kossa da top cizgiyi gecmez; ayrilirsa sahiplik duser)
  tz = Math.max(-HW + 0.35, Math.min(HW - 0.35, tz))
  tx = Math.max(-HL + 0.35, Math.min(HL - 0.35, tx))
  let vx = pvx + (tx - b.x) * k
  let vz = pvz + (tz - b.z) * k
  const v = Math.hypot(vx, vz)
  const vmax = Math.hypot(pvx, pvz) * 1.15 + 2.5
  if (v > vmax) {
    vx *= vmax / v
    vz *= vmax / v
  }
  b.vx = vx
  b.vz = vz
  if (b.vy > 0) b.vy = 0
  b.wx = vz / BALL_R
  b.wz = -vx / BALL_R
}

// --------------------------------------------------------------- hareket
// jockey: rakibe donuk, kale-tarafinda ~1.5 m mesafe, yavas yan/geri adim (insan: E basili; AI: input.jockey)
function jockeyMove(p: Player, inp: PlayerInput, gdt: number) {
  const b = world.ball
  const owner = game.players.find((q) => q.hasBall && q.team !== p.team)
  const fx0 = owner ? owner.x : b.x
  const fz0 = owner ? owner.z : b.z
  // hedef: sahip ile kendi kalesi arasinda, sahipten JOCKEY_DIST
  const gx = ownGoalX(p)
  let ux = gx - fx0
  let uz = -fz0
  const ul = Math.hypot(ux, uz) || 1
  ux /= ul
  uz /= ul
  let tx = fx0 + ux * JOCKEY_DIST
  let tz = fz0 + uz * JOCKEY_DIST
  // insan girdisi hedefi yana kaydirir
  tx += inp.move.x * 0.8
  tz += inp.move.z * 0.8
  // sahibin hizini on-besleme + konum hatasi
  let vx = (owner ? owner.vx : 0) + (tx - p.x) * 3
  let vz = (owner ? owner.vz : 0) + (tz - p.z) * 3
  const v = Math.hypot(vx, vz)
  if (v > JOCKEY_SPEED) {
    vx *= JOCKEY_SPEED / v
    vz *= JOCKEY_SPEED / v
  }
  // hizli ama sinirli ivme
  const k = Math.min(1, (ACCEL * gdt) / (Math.hypot(vx - p.vx, vz - p.vz) || 1))
  p.vx += (vx - p.vx) * k
  p.vz += (vz - p.vz) * k
  // bakis: topa/sahibe
  const want = Math.atan2(fx0 - p.x, fz0 - p.z)
  let da = want - p.facing
  da = Math.atan2(Math.sin(da), Math.cos(da))
  p.facing += Math.max(-TURN_RATE * gdt, Math.min(TURN_RATE * gdt, da))
  p.stamina = Math.min(1, p.stamina + 0.03 * gdt)
  holdAnim(p, 'jockey', 0.1)
}

function move(p: Player, inp: PlayerInput, gdt: number) {
  let mx = inp.move.x
  let mz = inp.move.z
  let m = Math.hypot(mx, mz)
  if (m > 1) {
    mx /= m
    mz /= m
    m = 1
  }
  const locked = p.actionLock > 0
  const act = acts[p.id]
  const special = act && (act.type === 'tackle' || act.type === 'slide' || act.type === 'dive') && act.t < 1.5
  const jockey = !special && !locked && !p.hasBall && inp.jockey === true
  if (jockey) jockeyMove(p, inp, gdt)
  else if (!special) {
    let max = inp.sprint && p.stamina > 0.05 ? SPRINT_SPEED : RUN_SPEED
    // yorgunlukta sprint dusar
    if (inp.sprint) max = RUN_SPEED + (SPRINT_SPEED - RUN_SPEED) * Math.min(1, p.stamina / 0.3)
    if (p.hasBall) max *= inp.sprint ? SPRINT_DRIBBLE_MUL : DRIBBLE_MUL
    if (p.role === 'kaleci') max *= KEEPER_MUL
    if (keeperHolding === p.id) max = Math.min(max, 3)
    if (p.anim === 'keeper-spread') max = Math.min(max, 2.5)
    if (p.anim === 'shield') max = Math.min(max, 2.6)
    if (locked) m = 0 // vurus/dusme sirasinda yavasla
    // bakis: istenen yone sinirli hizla don
    const sp = Math.hypot(p.vx, p.vz)
    if (m > 0.05 && p.anim !== 'shield') {
      const want = Math.atan2(mx, mz)
      let da = want - p.facing
      da = Math.atan2(Math.sin(da), Math.cos(da))
      const rate = TURN_RATE / (1 + sp * 0.18)
      p.facing += Math.max(-rate * gdt, Math.min(rate * gdt, da))
      // bakis ile istek arasindaki aci buyukse hiz siniri (donerken yavaslama)
      max *= 0.45 + 0.55 * Math.max(0, Math.cos(da))
    }
    const tvx = mx * max * m
    const tvz = mz * max * m
    // hizlanma/yavaslama: istenen hiza dogru, yavaslarken DECEL
    const ex = tvx - p.vx
    const ez = tvz - p.vz
    const e = Math.hypot(ex, ez)
    if (e > 1e-4) {
      const speeding = tvx * p.vx + tvz * p.vz > 0 && Math.hypot(tvx, tvz) > sp
      const a = (speeding ? ACCEL : DECEL) * gdt
      const k = Math.min(1, a / e)
      p.vx += ex * k
      p.vz += ez * k
    }
    // stamina
    const spd = Math.hypot(p.vx, p.vz)
    if (inp.sprint && spd > RUN_SPEED * 0.9) p.stamina = Math.max(0, p.stamina - 0.075 * gdt)
    else p.stamina = Math.min(1, p.stamina + (spd < 2 ? 0.06 : 0.03) * gdt)
  }
  p.x += p.vx * gdt
  p.z += p.vz * gdt
  // saha plakasi icinde
  const xm = HL + 2.5
  const zm = HW + 2
  if (Math.abs(p.x) > xm) {
    p.x = Math.sign(p.x) * xm
    p.vx = 0
  }
  if (Math.abs(p.z) > zm) {
    p.z = Math.sign(p.z) * zm
    p.vz = 0
  }
  // hareket animasyonu (aksiyon ya da tutulan klip yokken)
  if (!locked && T >= (holdUntil[p.id] ?? 0)) {
    const spd = Math.hypot(p.vx, p.vz)
    const a: AnimState =
      keeperAnim(p, spd) ??
      (spd < 0.35 ? 'idle' : p.hasBall ? 'dribble' : spd < 3.2 ? 'jog' : spd < RUN_SPEED + 0.4 ? 'run' : 'sprint')
    setAnim(p, a)
  }
}

// guc: hiz, stamina, topa sahiplik (omuz mucadelesi)
const strength = (p: Player) => Math.hypot(p.vx, p.vz) * (0.6 + 0.4 * p.stamina) + (p.hasBall ? 0.4 : 0) + (p.role === 'kaleci' ? 0.6 : 0)

// oyuncu-oyuncu itisme, omuz mucadelesi ve govde temasi
function pushApart() {
  const ps = game.players
  const b = world.ball
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i]
    if (a.sentOff) continue
    for (let j = i + 1; j < ps.length; j++) {
      const c = ps[j]
      if (c.sentOff) continue
      let nx = c.x - a.x
      let nz = c.z - a.z
      const d = Math.hypot(nx, nz)
      // omuz mucadelesi biraz daha genis temas bandinda (kollar/omuzlar)
      if (d >= SHOULDER_R || d < 1e-5) continue
      nx /= d
      nz /= d
      const key = i * 16 + j
      const sa = Math.hypot(a.vx, a.vz)
      const sc = Math.hypot(c.vx, c.vz)
      // omuz omuza: rakip, ikisi de kosuyor, paralel, top yakin
      const parallel = sa > 2.5 && sc > 2.5 && (a.vx * c.vx + a.vz * c.vz) / (sa * sc) > 0.6
      const ballNear = Math.hypot(b.x - (a.x + c.x) / 2, b.z - (a.z + c.z) / 2) < 4
      if (a.team !== c.team && parallel && ballNear) {
        const pen = (SHOULDER_R - d) * 0.5
        // itme oncesi yanal yaklasma hizlari (n: a -> c)
        const la = a.vx * nx + a.vz * nz
        const lc = c.vx * nx + c.vz * nz
        const A = strength(a)
        const C = strength(c)
        // guclu olan daha az itilir
        const wa = C / (A + C || 1)
        const wc = A / (A + C || 1)
        a.x -= nx * pen * wa
        a.z -= nz * pen * wa
        c.x += nx * pen * wc
        c.z += nz * pen * wc
        a.vx -= nx * 0.8 * wa
        a.vz -= nz * 0.8 * wa
        c.vx += nx * 0.8 * wc
        c.vz += nz * 0.8 * wc
        if (T - (pairT.get(key) ?? -9) > 0.8) {
          pairT.set(key, T)
          // baslatan: karsiya dogru yanal hizi buyuk olan
          const aIn = la >= -lc
          const [s, v] = aIn ? [a, c] : [c, a]
          const diff = Math.abs(A - C)
          const ra = Math.max(0, la - lc) // goreli yanal yaklasma (m/s)
          // normal paralel mucadele 0.2-0.4; sprintte sert yuklenme 0.6'yi gecer
          const sp = Math.hypot(s.vx, s.vz)
          const intensity = 0.15 + ra * 0.12 + diff * 0.06 + (sp > RUN_SPEED + 0.6 ? 0.13 : 0)
          // arkadan: baslatan, hedefin arkasinda (hedef -> baslatan yonu hedefin bakisiyla >120 derece)
          const [vf, vg] = fwd(v)
          const bx = s.x - v.x
          const bz = s.z - v.z
          const bl = Math.hypot(bx, bz) || 1
          const behind = (bx * vf + bz * vg) / bl < -0.5
          shoulderContact(s, v, intensity, behind, T - (lastTouch[s.id] ?? -9) < 0.3)
          if (a.actionLock <= 0) holdAnim(a, 'shoulder', 0.35)
          if (c.actionLock <= 0) holdAnim(c, 'shoulder', 0.35)
          // denge kaybi
          if (diff > 1.2 && rnd() < 0.35 && v.actionLock <= 0) {
            setAnim(v, 'stumble')
            v.actionLock = STUMBLE_LOCK
            v.vx *= 0.5
            v.vz *= 0.5
            if (v.hasBall) {
              releaseBall()
              noPickup[v.id] = T + 0.5
            }
          }
        }
        continue
      }
      if (d >= 2 * PUSH_R) continue
      const pen = 2 * PUSH_R - d
      a.x -= nx * pen * 0.5
      a.z -= nz * pen * 0.5
      c.x += nx * pen * 0.5
      c.z += nz * pen * 0.5
      // yaklasma hizi
      const va = a.vx * nx + a.vz * nz
      const vc = c.vx * nx + c.vz * nz
      const rel = va - vc
      if (rel > 0) {
        // esit kutle, kismen esnek olmayan
        const jn = rel * 0.5 * 0.8
        a.vx -= nx * jn
        a.vz -= nz * jn
        c.vx += nx * jn
        c.vz += nz * jn
        const busy = (q: Player) => {
          const t = acts[q.id]?.type
          return t === 'tackle' || t === 'slide' || t === 'dive'
        }
        if (a.team !== c.team && rel > 2 && !busy(a) && !busy(c) && T - (pairT.get(key) ?? -9) > 0.6) {
          pairT.set(key, T)
          // baslatan: yaklasma hizina daha cok katkisi olan
          const [s, v] = va >= -vc ? [a, c] : [c, a]
          const ballFirst = T - (lastTouch[s.id] ?? -9) < 0.3
          // yalniz yaklasma bileseni, yumusatilmis (yan yana surtunme kart sebebi olmasin)
          contactWith(s, v, 'body', (rel / 8) * 0.6, ballFirst)
        }
      }
    }
  }
}

function slot(n: number): DynCollider {
  let c = cols[n]
  if (!c) c = cols[n] = { a: [0, 0, 0], b: [0, 0, 0], r: BODY_R, vx: 0, vy: 0, vz: 0, e: 0.3, mu: 0.4, tag: 'oyuncu', id: 0 }
  c.e = 0.3
  c.mu = TUNE.mu // dusuk: yuvarlanan sert top govdede havaya firlamasin (B2 probu)
  c.tag = 'oyuncu'
  return c
}

function writeColliders() {
  const ps = game.players
  let n = 0
  for (const p of ps) {
    if (p.sentOff) continue
    // vurustan hemen sonra vurucunun kapsulu yok (top kendi govdesinden geri sekmesin)
    if (T - (kickT[p.id] ?? -9) < KICKER_GHOST) continue
    const c = slot(n++)
    c.id = p.id
    c.vx = p.vx
    c.vy = 0
    c.vz = p.vz
    // topu suren ya da vuran oyuncunun govdesi ince (ayak onunde)
    c.r = p.hasBall || p.actionLock > 0 ? 0.13 : BODY_R
    const act = acts[p.id]
    const [fx, fz] = fwd(p)
    if (act?.type === 'slide' && act.t < SLIDE_LOCK) {
      // yerde: ayaklar ileri
      c.a = [p.x + act.dx * 0.8, 0.15, p.z + act.dz * 0.8]
      c.b = [p.x - act.dx * 0.6, 0.3, p.z - act.dz * 0.6]
      c.r = 0.18
    } else if (act?.type === 'dive' && diveOf(p.id) && T < diveOf(p.id)!.tStop + DOWN_T) {
      // uzanan kaleci (sim/keeperDive.ts): govde kokten yatik, eller planin el noktasinda
      const sp = diveOf(p.id)!
      const st = diveState(sp, T)
      c.a = [st.x - sp.dir.x * 0.9, Math.max(0.2, st.y - 0.25), st.z - sp.dir.z * 0.9]
      c.b = [st.x + sp.dir.x * 0.5, st.y + 0.15, st.z + sp.dir.z * 0.5]
      c.r = 0.25
      c.e = 0.25
      // el kapsulu YALNIZ temas penceresinden sonra (tc+0.15): once sonuc keeperSave'de planla belirlenir, el topu onceden sektirmesin
      if (sp.outcome !== 'miss' && T > sp.tc + 0.15 && T < sp.tStop) {
        const h = slot(n++)
        h.id = p.id
        h.tag = 'kaleci-el'
        h.vx = p.vx
        h.vz = p.vz
        h.a = [st.x + sp.dir.x * 0.5, st.y + 0.15, st.z + sp.dir.z * 0.5]
        h.b = [st.hand.x, st.hand.y, st.hand.z]
        h.r = 0.12
        h.e = 0.2
      }
    } else if (p.role === 'kaleci' && p.anim === 'keeper-spread') {
      // bire bir: alcak, genis govde
      c.a = [p.x - fz * 0.8, 0.35, p.z + fx * 0.8]
      c.b = [p.x + fz * 0.8, 0.35, p.z - fx * 0.8]
      c.r = 0.3
    } else {
      c.a = [p.x, 0.1, p.z]
      c.b = [p.x, p.role === 'kaleci' ? 1.95 : 1.75, p.z]
      if (p.role === 'kaleci' && keeperHolding !== p.id) {
        // ayakta kalecinin elleri: omuz hizasinda yana acik
        const h = slot(n++)
        h.id = p.id
        h.tag = 'kaleci-el'
        h.vx = p.vx
        h.vz = p.vz
        h.a = [p.x + fz * 0.75, 1.25, p.z - fx * 0.75]
        h.b = [p.x - fz * 0.75, 1.25, p.z + fx * 0.75]
        h.r = 0.1
        h.e = 0.2
      }
    }
  }
  cols.length = n
  world.setDynamicColliders(cols)
}

// kapsul temaslari -> touch (son dokunan icin; sapan top da 'trap' sayilir)
let unsubWorld: (() => void) | null = null
function ensureWorldEvents() {
  if (unsubWorld) return
  unsubWorld = world.onEvent((e) => {
    if (e.type !== 'oyuncu' || typeof e.id !== 'number') return
    const p = game.players[e.id]
    // topu suren oyuncunun kendi govde temasi dokunus sayilmaz (zaten sahip)
    if (p && !p.hasBall && T - (lastTouch[p.id] ?? -9) > 0.15) touch(p, p.role === 'kaleci' ? 'save' : 'trap')
  })
}

/** Saf adim: game.inputs -> game.players (+ world.kick, game.emit). gdt = oyun zamani (s). */
export function stepLocomotion(gdt: number) {
  if (gdt <= 0) return
  ensureWorldEvents()
  T += gdt
  diveClock.t = T
  for (const p of game.players) {
    const inp = game.inputs[p.id]
    const a = inp.action
    inp.action = null
    if (p.sentOff) continue
    p.animT += gdt
    p.actionLock = Math.max(0, p.actionLock - gdt)
    // cift dokunus: temasa girmemis (ilk 0.2 s) ayakta mudahale kayarak mudahaleye cevrilebilir
    const pa = acts[p.id]
    const upgrade = !!a && a.type === 'slide' && pa?.type === 'tackle' && !pa.done && pa.t < 0.2
    if (a && (p.actionLock <= 0 || upgrade)) {
      if (upgrade) p.actionLock = 0
      startAction(p, a)
    }
    const act = acts[p.id]
    if (act) {
      runAction(p, act, gdt)
      if (p.actionLock <= 0 && act.t > 0.2) acts[p.id] = null
    }
    if (p.anim === 'fall' && p.actionLock < CLIP_LEN.getup) setAnim(p, 'getup')
    if (p.anim === 'slide' && act?.type === 'slide' && p.animT >= act.getupAt && p.actionLock > 0.2) setAnim(p, 'getup')
    move(p, inp, gdt)
    keeperSave(p)
  }
  pushApart()
  possession(gdt)
  writeColliders()
}

/** ayar/test anahtarlari */
const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env
export const locoTuning = { shield: ENV?.NOSHIELD !== '1' }

/** test/ayiklama */
export const locoState = { acts, now, keeper: () => keeperHolding }
