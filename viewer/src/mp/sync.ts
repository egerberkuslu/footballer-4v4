// Kare basina ag esitleme (L). React'siz; NetSync.tsx useFrame ile cagirir.
//   HOST  : -22 uzak girdileri game.inputs'a yazar (AI'in yazdiginin ustune), -0.4 snapshot (20 Hz)
//   MISAFIR: -29 yerel girdiyi yakala + gonder (30 Hz) + kendi oyuncusunu tahmin et,
//            -14 enterpolasyonlu durumu yaz (oyuncular, hakem, mac, top). Ag world.step ile yerelde.
import { game } from '../game/store'
import type { GameEvent, Player, PlayerInput } from '../game/types'
import { ACCEL, DECEL, DRIBBLE_MUL, KEEPER_MUL, RUN_SPEED, SPRINT_SPEED, TURN_RATE } from '../control/locomotionApi'
import { PITCH_L, PITCH_W } from '../pitch'
import { rules } from '../rules/instance'
import { sfx } from '../rules/audio'
import { world } from '../sim'
import { varState } from '../var/store'
import { keep, net } from './role'
import {
  ANIMS, ROLES, INPUT_HZ, INTERP_DELAY, P_STRIDE, PHASES, REF_ANIMS, SNAP_HZ, r2, r3,
  type Action, type Banner, type Snap,
} from './protocol'

const now = () => performance.now() / 1000

// =================================================================== HOST
export interface RemoteIn {
  pid: number
  mx: number
  mz: number
  sp: boolean
  s: number // son girdi sirasi
  as: number // kabul edilen son aksiyon sirasi
  act: Action | null // uygulanmayi bekleyen aksiyon
  at: number // son girdi zamani (s)
}

/** misafir girdisi geldi (session cagirir) */
export function hostOnInput(r: RemoteIn, m: { s: number; mx: number; mz: number; sp: boolean; as: number; a: Action | null }) {
  r.at = now()
  if (m.s > r.s) {
    r.s = m.s
    r.mx = m.mx
    r.mz = m.mz
    r.sp = m.sp
  }
  // aksiyon: misafir onaylanana dek tekrar yollar; yalniz yenisi uygulanir
  if (m.a && m.as > r.as) {
    r.as = m.as
    r.act = m.a
  }
}

/** -22: AI'dan sonra, kurallardan once. Uzak insanlarin girdisi. */
export function hostApplyInputs(remotes: Iterable<RemoteIn>) {
  const ph = game.match.phase
  const rs = game.match.restart
  const t = now()
  for (const r of remotes) {
    const p = game.players[r.pid]
    if (!p || p.sentOff) continue
    const inp: PlayerInput = game.inputs[r.pid]
    // duran topta yalniz kullanan oynar (F'nin insan kurali ile ayni); VAR'da herkes durur
    const allow = !varState.active && (ph === 'play' || rs?.taker === r.pid)
    // girdi 0.5 s gelmezse (kopma) yerinde dur
    const fresh = t - r.at < 0.5
    inp.move.x = allow && fresh ? r.mx : 0
    inp.move.z = allow && fresh ? r.mz : 0
    inp.sprint = allow && fresh && r.sp
    // izin yokken gelen aksiyon bayatlar; saklanmaz
    inp.action = allow && r.act ? r.act : null
    r.act = null
  }
}

const HS = keep('hsnap', () => ({ acc: 0, seq: 0 }))

/** -0.4: snapshot zamani geldiyse ortak govdeyi uret (misafir basina ack ayri eklenir) */
export function hostSnapshot(realDt: number): Omit<Snap, 'ack' | 'aa' | 'ag'> | null {
  HS.acc += realDt
  if (HS.acc < 1 / SNAP_HZ) return null
  HS.acc = Math.min(HS.acc - 1 / SNAP_HZ, 1 / SNAP_HZ)
  const b = world.ball
  const p: number[] = []
  for (const q of game.players) {
    p.push(
      r3(q.x), r3(q.z), r2(q.vx), r2(q.vz), r3(q.facing), Math.max(0, ANIMS.indexOf(q.anim)), r2(q.animT),
      (q.hasBall ? 1 : 0) | (q.sentOff ? 2 : 0) | (Math.max(0, ROLES.indexOf(q.role)) << 2), r2(q.stamina), q.yellow, r2(q.actionLock),
    )
  }
  const rf = game.referee
  const m = game.match
  const bn = rules.banner as Banner | null
  return {
    q: ++HS.seq,
    ht: r3(now()),
    ts: world.timeScale,
    b: [r3(b.x), r3(b.y), r3(b.z), r2(b.vx), r2(b.vy), r2(b.vz), r3(b.q.x), r3(b.q.y), r3(b.q.z), r3(b.q.w)],
    p,
    r: [r3(rf.x), r3(rf.z), r2(rf.vx), r2(rf.vz), r3(rf.facing), Math.max(0, REF_ANIMS.indexOf(rf.anim)), r2(rf.animT)],
    m: [PHASES.indexOf(m.phase), r2(m.clock), m.half, m.score[0], m.score[1], m.attackDir[0], m.attackDir[1], m.halfLength, r2(m.advantageUntil)],
    rs: m.restart,
    lt: m.lastTouch,
    bn: bn ? { id: bn.id, kind: bn.kind, text: bn.text, sub: bn.sub, until: bn.until } : null,
    sus: (m.suspended ?? []).map((x) => [x.id, r2(x.left)] as [number, number]),
  }
}

/** misafire iletilen olaylar (dribble/trap dokunuslari ve temaslar gereksiz) */
export function forwardable(e: GameEvent): boolean {
  if (e.type === 'touch') return e.kind !== 'dribble' && e.kind !== 'trap'
  return e.type !== 'contact' && e.type !== 'offside-check'
}

export const hostNow = now

// =================================================================== MISAFIR
interface Pred {
  x: number
  z: number
  vx: number
  vz: number
  facing: number
  // gorsel duzeltme (fizik aninda duzelir, goruntu yumusak)
  ox: number
  oz: number
  init: boolean
}

const G = keep('sync', () => ({
  buf: [] as Snap[],
  off: NaN, // host saati - yerel saat (tahmin)
  seq: 0,
  actSeq: 0,
  pendingAct: null as null | { s: number; a: Action },
  sendAcc: 0,
  hist: [] as { s: number; t: number; x: number; z: number }[],
  pred: { x: 0, z: 0, vx: 0, vz: 0, facing: 0, ox: 0, oz: 0, init: false } as Pred,
  evq: [] as { ht: number; e: GameEvent }[],
  lastQ: 0,
  rtt: 0.08,
  lastSnapAt: 0,
}))

export function guestReset() {
  G.buf.length = 0
  G.off = NaN
  G.pendingAct = null
  G.hist.length = 0
  G.pred.init = false
  G.evq.length = 0
  G.lastQ = 0
}

export const guestStats = () => ({
  buffered: G.buf.length,
  offset: G.off,
  pending: G.hist.length,
  lastSnapAge: G.lastSnapAt ? now() - G.lastSnapAt : -1,
  pred: { ...G.pred },
})

export function guestSetRtt(ms: number) {
  G.rtt = ms / 1000
}

export function guestOnSnap(s: Snap) {
  if (s.q <= G.lastQ) return // eski/tekrar
  G.lastQ = s.q
  const t = now()
  G.lastSnapAt = t
  const off = s.ht - t
  // ofset: dusuk gecikmeli ornege hemen, yuksege yavas uyum (titresim emici)
  if (!Number.isFinite(G.off) || Math.abs(off - G.off) > 1) G.off = off
  else if (off > G.off) G.off = off
  else G.off += (off - G.off) * 0.02
  G.buf.push(s)
  if (G.buf.length > 40) G.buf.shift()
  // aksiyon onaylandi
  if (G.pendingAct && s.aa >= G.pendingAct.s) G.pendingAct = null
  reconcile(s)
}

export function guestOnEvent(ht: number, e: GameEvent) {
  G.evq.push({ ht, e })
}

// ---- kendi oyuncumuzun tahmini (control/locomotion.ts move() ile ayni dinamik, sade)
function predictStep(p: Player, inp: PlayerInput, gdt: number) {
  const P = G.pred
  let mx = inp.move.x
  let mz = inp.move.z
  let m = Math.hypot(mx, mz)
  if (m > 1) {
    mx /= m
    mz /= m
    m = 1
  }
  let max = inp.sprint && p.stamina > 0.05 ? SPRINT_SPEED : RUN_SPEED
  if (inp.sprint) max = RUN_SPEED + (SPRINT_SPEED - RUN_SPEED) * Math.min(1, p.stamina / 0.3)
  if (p.hasBall) max *= DRIBBLE_MUL
  if (p.role === 'kaleci') max *= KEEPER_MUL
  const sp = Math.hypot(P.vx, P.vz)
  if (m > 0.05) {
    const want = Math.atan2(mx, mz)
    let da = want - P.facing
    da = Math.atan2(Math.sin(da), Math.cos(da))
    const rate = TURN_RATE / (1 + sp * 0.18)
    P.facing += Math.max(-rate * gdt, Math.min(rate * gdt, da))
    max *= 0.45 + 0.55 * Math.max(0, Math.cos(da))
  }
  const tvx = mx * max * m
  const tvz = mz * max * m
  const ex = tvx - P.vx
  const ez = tvz - P.vz
  const e = Math.hypot(ex, ez)
  if (e > 1e-4) {
    const speeding = tvx * P.vx + tvz * P.vz > 0 && Math.hypot(tvx, tvz) > sp
    const k = Math.min(1, ((speeding ? ACCEL : DECEL) * gdt) / e)
    P.vx += ex * k
    P.vz += ez * k
  }
  P.x += P.vx * gdt
  P.z += P.vz * gdt
  const xm = PITCH_L / 2 + 2.5
  const zm = PITCH_W / 2 + 2
  if (Math.abs(P.x) > xm) {
    P.x = Math.sign(P.x) * xm
    P.vx = 0
  }
  if (Math.abs(P.z) > zm) {
    P.z = Math.sign(P.z) * zm
    P.vz = 0
  }
}

// sunucu kilitli durumdaysa (aksiyon, dusme, duran top yerlestirmesi) tahmin yerine sunucuyu izle
function serverLocked(s: Snap, lp: number) {
  const o = lp * P_STRIDE
  const anim = ANIMS[s.p[o + 5]]
  return s.p[o + 10] > 0.02 || anim === 'fall' || anim === 'getup' || anim === 'slide' || anim === 'tackle' || anim === 'celebrate'
}

function reconcile(s: Snap) {
  const lp = net.localPlayer
  if (lp < 0) return
  const o = lp * P_STRIDE
  const sx = s.p[o]
  const sz = s.p[o + 1]
  const P = G.pred
  // gecmisten: onaylanan girdi gonderildikten 'ag' sonra (host o girdiyi o kadar uyguladi)
  let h: { x: number; z: number } | undefined
  const i0 = G.hist.findIndex((q) => q.s === s.ack)
  if (i0 >= 0) {
    const target = G.hist[i0].t + Math.max(0, s.ag ?? 0)
    let j = i0
    while (j + 1 < G.hist.length && G.hist[j + 1].t <= target) j++
    const A = G.hist[j]
    const B = G.hist[j + 1]
    if (B && B.t > A.t) {
      const k = Math.min(1, (target - A.t) / (B.t - A.t))
      h = { x: A.x + (B.x - A.x) * k, z: A.z + (B.z - A.z) * k }
    } else h = { x: A.x, z: A.z }
    G.hist.splice(0, j + 1)
  } else while (G.hist.length && G.hist[0].s < s.ack) G.hist.shift()
  if (!P.init || serverLocked(s, lp) || !h) {
    if (!P.init || serverLocked(s, lp)) {
      // dogrudan sunucu (+ yarim gidis-donus kadar ileri)
      const lead = G.rtt * 0.5
      const nx = sx + s.p[o + 2] * lead
      const nz = sz + s.p[o + 3] * lead
      if (P.init) {
        P.ox += P.x - nx
        P.oz += P.z - nz
      }
      P.x = nx
      P.z = nz
      P.vx = s.p[o + 2]
      P.vz = s.p[o + 3]
      P.facing = s.p[o + 4]
      P.init = true
      G.hist.length = 0
    }
    return
  }
  const ex = sx - h.x
  const ez = sz - h.z
  if (Math.hypot(ex, ez) > 2.5) {
    // buyuk sapma (isinlama): aninda
    P.x = sx
    P.z = sz
    P.vx = s.p[o + 2]
    P.vz = s.p[o + 3]
    P.ox = P.oz = 0
    G.hist.length = 0
    return
  }
  if (Math.hypot(ex, ez) < 0.02) return
  P.x += ex
  P.z += ez
  P.ox -= ex
  P.oz -= ez
  for (const q of G.hist) {
    q.x += ex
    q.z += ez
  }
}

/** -29: yerel girdiyi yakala, tahmin et, 30 Hz gonder. send() null donerse kanal yok. */
export function guestInputFrame(dt: number, send: (m: unknown) => void) {
  const lp = net.localPlayer
  if (lp < 0) return
  const inp = game.inputs[lp]
  const p = game.players[lp]
  if (!inp || !p) return
  if (inp.action) {
    G.pendingAct = { s: ++G.actSeq, a: inp.action }
    inp.action = null // yerelde uygulanmaz; host karar verir
  }
  const gdt = Math.min(dt, 1 / 30) * world.timeScale
  const latest = G.buf[G.buf.length - 1]
  if (G.pred.init && gdt > 0 && latest && !serverLocked(latest, lp)) predictStep(p, inp, gdt)
  G.sendAcc += dt
  if (G.sendAcc >= 1 / INPUT_HZ) {
    G.sendAcc = Math.min(G.sendAcc - 1 / INPUT_HZ, 1 / INPUT_HZ)
    const pa = G.pendingAct
    send({ t: 'in', s: ++G.seq, mx: r3(inp.move.x), mz: r3(inp.move.z), sp: inp.sprint, as: pa ? pa.s : G.actSeq, a: pa ? pa.a : null })
  }
  G.hist.push({ s: G.seq, t: now(), x: G.pred.x, z: G.pred.z })
  if (G.hist.length > 240) G.hist.shift()
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const lerpAng = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k

function playSfx(e: GameEvent) {
  switch (e.type) {
    case 'whistle':
      sfx.whistle(e.reason)
      if (e.reason === 'foul' || e.reason === 'penalty') sfx.murmur()
      break
    case 'touch': {
      const b = world.ball
      sfx.kick(Math.max(0.4, Math.hypot(b.vx, b.vy, b.vz) / 30))
      break
    }
    case 'goal':
      sfx.net()
      sfx.roar(1)
      break
  }
}

/** -14: enterpolasyonlu durumu oyuna yaz. Donus: oynatilan host zamani (ya da -1). */
export function guestApplyFrame(dt: number): number {
  const buf = G.buf
  if (!buf.length) return -1
  const rt = now() + G.off - INTERP_DELAY
  // [a, b] araligi
  let a = buf[0]
  let b = buf[0]
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i].ht <= rt) {
      a = buf[i]
      b = buf[Math.min(buf.length - 1, i + 1)]
      break
    }
  }
  // eski ornekleri at (a'dan oncesi gereksiz)
  while (buf.length > 2 && buf[1].ht <= rt - 0.5) buf.shift()
  const span = b.ht - a.ht
  let k = span > 1e-4 ? (rt - a.ht) / span : 0
  // b de gecmisteyse (paket gecikti) en fazla 0.25 s hizla ileri tahmin
  let ext = 0
  if (k > 1 || span <= 1e-4) {
    ext = Math.min(0.25, Math.max(0, rt - b.ht)) * b.ts
    a = b
    k = 0
  }
  k = Math.max(0, Math.min(1, k))

  // --- oyuncular
  const lp = net.localPlayer
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i]
    const o = i * P_STRIDE
    const A = a.p
    const B = b.p
    if (o + P_STRIDE > A.length || o + P_STRIDE > B.length) continue
    const flags = A[o + 7] | B[o + 7]
    p.sentOff = (B[o + 7] & 2) !== 0
    p.role = ROLES[(B[o + 7] >> 2) & 3] ?? p.role
    p.hasBall = ((k < 0.5 ? A : B)[o + 7] & 1) !== 0
    p.stamina = lerp(A[o + 8], B[o + 8], k)
    p.yellow = B[o + 9]
    p.actionLock = lerp(A[o + 10], B[o + 10], k)
    void flags
    const src = k < 0.5 ? A : B
    const anim = ANIMS[src[o + 5]] ?? 'idle'
    const srcT = k < 0.5 ? a.ht : b.ht
    if (i === lp && G.pred.init) {
      const P = G.pred
      const fade = Math.exp(-dt * 10)
      P.ox *= fade
      P.oz *= fade
      p.x = P.x + P.ox
      p.z = P.z + P.oz
      p.vx = P.vx
      p.vz = P.vz
      p.facing = P.facing
      if (serverLocked(b, lp)) {
        p.anim = anim
        p.animT = src[o + 6] + Math.max(0, rt - srcT) * a.ts
      } else {
        const spd = Math.hypot(P.vx, P.vz)
        const want = spd < 0.35 ? 'idle' : p.hasBall ? 'dribble' : spd < 3.2 ? 'jog' : spd < RUN_SPEED + 0.4 ? 'run' : 'sprint'
        if (p.anim !== want) {
          p.anim = want
          p.animT = 0
        } else p.animT += dt * world.timeScale
      }
      continue
    }
    p.x = lerp(A[o], B[o], k) + B[o + 2] * ext
    p.z = lerp(A[o + 1], B[o + 1], k) + B[o + 3] * ext
    p.vx = lerp(A[o + 2], B[o + 2], k)
    p.vz = lerp(A[o + 3], B[o + 3], k)
    p.facing = lerpAng(A[o + 4], B[o + 4], k)
    if (p.anim !== anim) p.anim = anim
    p.animT = src[o + 6] + Math.max(0, rt - srcT) * b.ts
  }

  // --- hakem
  const R = game.referee
  const ra = a.r
  const rb = b.r
  R.x = lerp(ra[0], rb[0], k) + rb[2] * ext
  R.z = lerp(ra[1], rb[1], k) + rb[3] * ext
  R.vx = lerp(ra[2], rb[2], k)
  R.vz = lerp(ra[3], rb[3], k)
  R.facing = lerpAng(ra[4], rb[4], k)
  const rsrc = k < 0.5 ? ra : rb
  R.anim = REF_ANIMS[rsrc[5]] ?? 'idle'
  R.animT = rsrc[6] + Math.max(0, rt - (k < 0.5 ? a.ht : b.ht))

  // --- mac durumu (en yeni ornek: skor/saat gecikmesin diye b)
  const m = game.match
  const M = b.m
  m.phase = PHASES[M[0]] ?? m.phase
  m.clock = lerp(a.m[1], M[1], k)
  m.half = M[2] === 2 ? 2 : 1
  if (m.score[0] !== M[3] || m.score[1] !== M[4]) m.score = [M[3], M[4]]
  m.attackDir = [M[5] > 0 ? 1 : -1, M[6] > 0 ? 1 : -1]
  m.halfLength = M[7]
  m.advantageUntil = M[8]
  m.restart = b.rs
  m.lastTouch = b.lt
  m.suspended = Array.isArray(b.sus) ? b.sus.map(([id, left]) => ({ id, left })) : undefined
  // karar bandi (RulesHud rules.banner'i okur)
  const bn = b.bn
  if (!bn) rules.banner = null
  else if (!rules.banner || rules.banner.id !== bn.id) rules.banner = { ...bn } as typeof rules.banner

  // --- top (yerel VAR tekrari oynarken dokunma)
  world.timeScale = b.ts
  if (!varState.active) {
    const ball = world.ball
    const BA = a.b
    const BB = b.b
    const nx = lerp(BA[0], BB[0], k) + BB[3] * ext
    const ny = Math.max(0.11 * 0.5, lerp(BA[1], BB[1], k) + BB[4] * ext)
    let nz = lerp(BA[2], BB[2], k) + BB[5] * ext
    let fx = nx
    // topu suren biz isek: top bizim tahmini konumumuza gore (gecikmede geride kalmasin)
    if (lp >= 0 && G.pred.init && game.players[lp].hasBall) {
      const o = lp * P_STRIDE
      const hx = lerp(a.p[o], b.p[o], k)
      const hz = lerp(a.p[o + 1], b.p[o + 1], k)
      fx += game.players[lp].x - hx
      nz += game.players[lp].z - hz
    }
    ball.px = ball.x
    ball.py = ball.y
    ball.pz = ball.z
    ball.x = fx
    ball.y = ny
    ball.z = nz
    ball.vx = lerp(BA[3], BB[3], k)
    ball.vy = lerp(BA[4], BB[4], k)
    ball.vz = lerp(BA[5], BB[5], k)
    // donus host'tan geliyor; yerel adim onu degistirmesin
    ball.wx = ball.wy = ball.wz = 0
    // donus: nlerp
    const dot = BA[6] * BB[6] + BA[7] * BB[7] + BA[8] * BB[8] + BA[9] * BB[9]
    const sg = dot < 0 ? -1 : 1
    let qx = lerp(BA[6], sg * BB[6], k)
    let qy = lerp(BA[7], sg * BB[7], k)
    let qz = lerp(BA[8], sg * BB[8], k)
    let qw = lerp(BA[9], sg * BB[9], k)
    const n = Math.hypot(qx, qy, qz, qw) || 1
    qx /= n
    qy /= n
    qz /= n
    qw /= n
    Object.assign(ball.q, { x: qx, y: qy, z: qz, w: qw })
  }

  // --- olaylar: goruntuyle ayni anda
  while (G.evq.length && G.evq[0].ht <= rt) {
    const { e } = G.evq.shift()!
    game.emit(e)
    playSfx(e)
  }
  return rt
}
