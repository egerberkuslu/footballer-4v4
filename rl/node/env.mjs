// FootballEnv: oyunun gercek sim/locomotion/rules'u ile basiz RL ortami (bkz. rl/SPEC.md).
// Calistirma: tsx ile (npx -y tsx ...). Modul tekilleri (game, world, locomotion) yuzunden IS PARCACIGI/SUREC BASINA TEK ortam.
import '../../viewer/scripts/ai-env.mjs'
import { world } from '../../viewer/src/sim.ts'
import { game } from '../../viewer/src/game/store.ts'
import { Rules } from '../../viewer/src/rules/engine.ts'
import { updateAI, resetAI } from '../../viewer/src/ai/brain.ts'
import { seedAI, setAiLevel } from '../../viewer/src/ai/config.ts'
import { stepLocomotion, resetLocomotion } from '../../viewer/src/control/locomotion.ts'
import { PITCH_L, PITCH_W, GOAL_W, GOAL_H } from '../../viewer/src/pitch.ts'
import { CURL_W } from '../../viewer/src/control/aim.ts'

// ---------------------------------------------------------------- sozlesme sabitleri (SPEC.md ile ayni)
export const OBS_VERSION = 1
export const OBS_DIM = 113
export const STATE_DIM = 70
export const ACT_DIM = 8 // [move_x, move_z, sprint, aim_z, aim_y, power, curl, discrete]
export const N_DISC = 10
export const DISC = ['none', 'pass1', 'pass2', 'pass3', 'shoot', 'lob', 'tackle', 'slide', 'jockey', 'dive']
export const TERMS = ['goal', 'ball_approach', 'ball_progress', 'pass_ok', 'steal', 'foul', 'card']
export const N_TERMS = TERMS.length
export const INFO_DIM = 6 // [score0, score1, game_time, phase_index, n_decisions, episode_index]
export const PHASES = ['kickoff', 'play', 'stopped', 'freekick', 'penalty', 'corner', 'kickin', 'goalkick', 'halftime', 'fulltime', 'var']
export const ROLES = ['kaleci', 'defans', 'orta', 'forvet']
export const TEAM_SIZE = 4

const HL = PITCH_L / 2
const HW = PITCH_W / 2
const DT = 1 / 60
const DN = PITCH_L / 2 // goreli konum olcegi
const VN = 8
const BVN = 25
const DEFAULT_WEIGHTS = { goal: 1, ball_approach: 0.02, ball_progress: 0.2, pass_ok: 0.05, steal: 0.05, foul: 0.1, card: 0.2 }

const mulberry32 = (a) => () => {
  a = (a + 0x6d2b79f5) >>> 0
  let t = a
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// baslangic dizilisi (store.makePlayers ile ayni)
const DEPTH = { kaleci: 0.47, defans: 0.3, orta: 0.18, forvet: 0.06 }
const LATERAL = { kaleci: 0, defans: 0, orta: -5, forvet: 3 }

let ACTIVE = null // modul tekilleri: tek ortam
let listenerOn = false

export class FootballEnv {
  constructor(cfg = {}) {
    // modul tekilleri (game/world/locomotion) yuzunden surec/is parcacigi basina TEK etkin ortam: yeni ornek eskisini gecersiz kilar
    ACTIVE = this
    const c = { teamSize: 4, seed: 1, decisionHz: 10, episodeSec: 120, onGoal: 'continue', opponent: 'heuristic:orta', team0: 'external', rolesOn: true, weights: {}, ...cfg }
    if (c.teamSize !== TEAM_SIZE) throw new Error('M0: yalniz teamSize=4 (parametrik saha 5v5+ ayri is, bkz. RL_PLAN.md S10)')
    this.cfg = c
    this.weights = { ...DEFAULT_WEIGHTS, ...c.weights }
    this.skip = Math.max(1, Math.round(60 / c.decisionHz))
    const spec = [c.team0, c.opponent]
    this.mode = spec.map((s) => (s === 'external' ? { ext: true } : { ext: false, level: s.split(':')[1] ?? 'orta' }))
    this.agents = [] // id listesi (dis takimlar, takim sirasi + rol sirasi)
    for (let tm = 0; tm < 2; tm++) if (this.mode[tm].ext) for (let r = 0; r < TEAM_SIZE; r++) this.agents.push(tm * TEAM_SIZE + r)
    this.nAg = this.agents.length
    this.nTeamsExt = this.mode.filter((m) => m.ext).length
    this.obs = new Float32Array(this.nAg * OBS_DIM)
    this.state = new Float32Array(this.nAg * STATE_DIM) // ajan basina (takim bakisli, takim icinde ayni)
    this.mask = new Uint8Array(this.nAg * N_DISC)
    this.reward = new Float32Array(this.nAg)
    this.terms = new Float32Array(this.nAg * N_TERMS)
    this.info = new Float32Array(INFO_DIM)
    this.done = false
    this.truncated = false
    this.episode = 0
    this.nDec = 0
    this.hash = 0x811c9dc5
    this.rules = null
    this.rt = new Float32Array(this.nAg * N_TERMS)
    this.near = [null, null] // takim basina topa en yakin oyuncu (id, onceki mesafe)
    this.pend = null // bekleyen pas {by, team, t}
    this.possTeam = -1
    this.prevBx = [0, 0]
    this.goalThisDec = false
    if (!listenerOn) {
      listenerOn = true
      game.on((e) => ACTIVE && ACTIVE._onEvent(e))
    }
  }

  // ------------------------------------------------------------ olaylar -> odul terimleri
  _agIdx(id) {
    return this.agents.indexOf(id)
  }
  _addTerm(id, k, v) {
    const i = this._agIdx(id)
    if (i >= 0) this.rt[i * N_TERMS + k] += v
  }
  _onEvent(e) {
    if (this.warm) return
    const T = this.t
    if (e.type === 'goal') {
      this.goalThisDec = true
      for (const id of this.agents) this._addTerm(id, 0, game.players[id].team === e.team ? 1 : -1)
    } else if (e.type === 'foul') this._addTerm(e.by, 5, -1)
    else if (e.type === 'card') this._addTerm(e.player, 6, e.color === 'red' ? -3 : -1)
    else if (e.type === 'touch') {
      const p = game.players[e.player]
      if (e.kind === 'pass' || e.kind === 'lob') this.pend = { by: p.id, team: p.team, t: T }
      else if (this.pend && p.id !== this.pend.by && ['trap', 'dribble', 'tackle', 'save', 'header'].includes(e.kind)) {
        if (p.team === this.pend.team && T - this.pend.t < 4) this._addTerm(this.pend.by, 3, 1)
        this.pend = null
      }
      if (['trap', 'dribble', 'tackle', 'save'].includes(e.kind)) {
        if (this.possTeam >= 0 && this.possTeam !== p.team) this._addTerm(p.id, 4, 1)
        this.possTeam = p.team
      } else if (e.kind === 'pass' || e.kind === 'lob' || e.kind === 'shoot') this.possTeam = p.team
    }
  }

  // ------------------------------------------------------------ sifirlama
  reset(seed) {
    const c = this.cfg
    const s = (seed ?? c.seed + this.episode) >>> 0
    this.seed = s
    this.episode++
    const rand = mulberry32(s)
    Math.random = rand
    seedAI(s)
    world.netPhysics = false
    world.resetEpisode(s)
    resetLocomotion()
    resetAI()
    setAiLevel(this.mode.find((m) => !m.ext)?.level ?? 'orta')
    game.humanTeam = null
    game.remote.clear()
    // oyuncular
    for (const p of game.players) {
      const dir = p.team === 0 ? 1 : -1
      Object.assign(p, {
        x: -dir * DEPTH[p.role] * PITCH_L,
        z: LATERAL[p.role] * (p.team === 0 ? 1 : -1),
        vx: 0,
        vz: 0,
        facing: dir > 0 ? Math.PI / 2 : -Math.PI / 2,
        anim: 'idle',
        animT: 0,
        actionLock: 0,
        controlled: false,
        hasBall: false,
        stamina: 1,
        yellow: 0,
        sentOff: false,
      })
    }
    game.resetInputs()
    Object.assign(game.referee, { x: 0, z: -9, vx: 0, vz: 0, facing: 0, anim: 'idle', animT: 0 })
    game.match.suspended = undefined
    this.rules = new Rules({ game, ball: () => world.ball, placeBall: (x, z) => world.placeBall(x, z), kick: (v, w) => world.kick(v, w), halfLength: 1e6 })
    this.rules.start()
    this.t = 0
    this.warm = true
    // isinma: iki takim da el yazmasi AI, oyun 'play' olana dek (kickoff)
    let guard = 0
    while (game.match.phase !== 'play' && guard++ < 60 * 60) this._frame(true, null, 0)
    this.warm = false
    for (const id of this.agents) game.remote.add(id)
    this.t = 0
    this.nDec = 0
    this.done = false
    this.truncated = false
    this.rt.fill(0)
    this.pend = null
    this.possTeam = -1
    this.goalThisDec = false
    this.hash = 0x811c9dc5
    this._capturePotentials()
    this._writeObs()
    this.reward.fill(0)
    this.terms.fill(0)
    this._writeInfo()
    return this
  }

  // ------------------------------------------------------------ bir oyun karesi
  _frame(aiAll, acts, f) {
    if (aiAll || this.mode.some((m) => !m.ext)) updateAI(DT)
    if (acts) {
      for (let i = 0; i < this.nAg; i++) {
        const inp = game.inputs[this.agents[i]]
        const a = acts[i]
        inp.move.x = a.mx
        inp.move.z = a.mz
        inp.sprint = a.sprint
        inp.jockey = a.jockey
        inp.action = f === 0 ? a.action : null
      }
    }
    this.rules.pre(DT)
    stepLocomotion(DT)
    world.side = world.ball.x >= 0 ? 1 : -1
    world.step(DT)
    this.rules.post(DT)
    this.t += DT
  }

  // ------------------------------------------------------------ eylem -> PlayerInput
  _decodeActions(actions) {
    const out = []
    const ball = world.ball
    for (let i = 0; i < this.nAg; i++) {
      const o = i * ACT_DIM
      const id = this.agents[i]
      const p = game.players[id]
      const sgn = game.match.attackDir[p.team]
      let mx = clamp(actions[o], -1, 1)
      let mz = clamp(actions[o + 1], -1, 1)
      const mag = Math.hypot(mx, mz)
      if (mag > 1) {
        mx /= mag
        mz /= mag
      }
      const d = Math.round(clamp(actions[o + 7], 0, N_DISC - 1))
      const mk = this.mask[i * N_DISC + d] ? d : 0 // gecersiz eylem -> yok
      const power01 = (clamp(actions[o + 5], -1, 1) + 1) / 2
      const aimZ = clamp(actions[o + 3], -1, 1) * (GOAL_W / 2 + 1.5)
      const aimY = 0.11 + ((clamp(actions[o + 4], -1, 1) + 1) / 2) * (GOAL_H + 1.2 - 0.11)
      const curl = Math.round(clamp(actions[o + 6], -1, 1) * 3)
      const spin = { x: 0, y: (-curl / 3) * CURL_W, z: 0 }
      const gx = sgn * HL
      const a = { mx: sgn * mx, mz: sgn * mz, sprint: actions[o + 2] > 0, jockey: false, action: null }
      if (mk >= 1 && mk <= 3) {
        const mate = this._teammates(p)[mk - 1]
        if (mate) {
          const pw = power01 > 0.05 ? power01 : 0
          a.action = { type: 'pass', power: pw, aim: { x: clamp(mate.x + mate.vx * 0.3, -HL + 0.5, HL - 0.5), y: 0, z: clamp(mate.z + mate.vz * 0.3, -HW + 0.5, HW - 0.5) }, spin: curl ? spin : undefined }
        }
      } else if (mk === 4) a.action = { type: 'shoot', power: Math.max(0.05, power01), aim: { x: gx, y: aimY, z: aimZ }, spin }
      else if (mk === 5) a.action = { type: 'lob', power: 0, aim: { x: gx, y: 0, z: aimZ }, spin: curl ? spin : undefined }
      else if (mk === 6) a.action = { type: 'tackle', power: 0, aim: { x: ball.x, y: 0, z: ball.z } }
      else if (mk === 7) a.action = { type: 'slide', power: 0, aim: { x: ball.x, y: 0, z: ball.z } }
      else if (mk === 8) a.jockey = true
      else if (mk === 9) a.action = { type: 'dive', power: 1, aim: { x: -sgn * HL, y: aimY, z: aimZ } }
      out.push(a)
    }
    return out
  }

  // takim arkadaslari (kendisi haric, cezali/atilan haric), mesafeye gore
  _teammates(p) {
    const l = []
    for (const q of game.players) if (q.team === p.team && q.id !== p.id && this._active(q)) l.push(q)
    l.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z) || a.id - b.id)
    return l
  }
  _opponents(p) {
    const l = []
    for (const q of game.players) if (q.team !== p.team && this._active(q)) l.push(q)
    l.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z) || a.id - b.id)
    return l
  }
  _active(q) {
    if (q.sentOff) return false
    const s = game.match.suspended
    return !(s && s.some((e) => e.id === q.id))
  }
  _suspLeft(q) {
    const s = game.match.suspended
    const e = s && s.find((e) => e.id === q.id)
    return e ? e.left : 0
  }

  // ------------------------------------------------------------ gozlem / maske / durum
  _writeObs() {
    const ball = world.ball
    const m = game.match
    const phaseIdx = Math.max(0, PHASES.indexOf(m.phase))
    const tLeft = clamp(1 - this.t / this.cfg.episodeSec, 0, 1)
    for (let i = 0; i < this.nAg; i++) {
      const p = game.players[this.agents[i]]
      const sgn = m.attackDir[p.team]
      const o = i * OBS_DIM
      const ob = this.obs
      let k = o
      const put = (v) => {
        ob[k++] = v
      }
      // self (14)
      const ax = sgn * p.x
      const az = sgn * p.z
      put(ax / HL)
      put(az / HW)
      put((sgn * p.vx) / VN)
      put((sgn * p.vz) / VN)
      put(sgn * Math.sin(p.facing))
      put(sgn * Math.cos(p.facing))
      put(p.stamina)
      put(p.hasBall ? 1 : 0)
      for (let r = 0; r < 4; r++) put(p.role === ROLES[r] ? 1 : 0)
      put(this._suspLeft(p) / 30)
      put(p.yellow / 2)
      // top (9)
      const bx = sgn * ball.x
      const bz = sgn * ball.z
      const bd = Math.hypot(ball.x - p.x, ball.z - p.z)
      put((bx - ax) / DN)
      put((bz - az) / DN)
      put((sgn * ball.vx) / BVN)
      put((sgn * ball.vz) / BVN)
      put(ball.y / 3)
      put(ball.vy / 15)
      put(bd / 40)
      put(bx / HL)
      put(bz / HW)
      // kaleler (4): rakip kale (+HL,0), kendi kale (-HL,0) benmerkezli
      put((HL - ax) / DN)
      put(-az / DN)
      put((-HL - ax) / DN)
      put(-az / DN)
      // takim arkadaslari (3 x 10) ve rakipler (4 x 10), mesafeye gore
      const tm = this._teammates(p)
      const op = this._opponents(p)
      const setRow = (q) => {
        if (!q) {
          for (let j = 0; j < 10; j++) put(0)
          return
        }
        put((sgn * q.x - ax) / DN)
        put((sgn * q.z - az) / DN)
        put((sgn * (q.vx - p.vx)) / VN)
        put((sgn * (q.vz - p.vz)) / VN)
        for (let r = 0; r < 4; r++) put(q.role === ROLES[r] ? 1 : 0)
        put(q.hasBall ? 1 : 0)
        put(this._suspLeft(q) > 0 ? 1 : 0)
      }
      for (let j = 0; j < 3; j++) setRow(tm[j])
      for (let j = 0; j < 4; j++) setRow(op[j])
      // mac (16)
      for (let j = 0; j < 11; j++) put(j === phaseIdx ? 1 : 0)
      const rs = m.restart
      put(rs && rs.team === p.team ? 1 : 0)
      put(rs && rs.taker === p.id ? 1 : 0)
      put(tLeft)
      put(clamp((m.score[p.team] - m.score[1 - p.team]) / 3, -1, 1))
      put(this._canKick(p) ? 1 : 0)
      // maske (N_DISC)
      this._writeMask(i, p, tm, op)
      // kritik durum (takim bakisli)
      this._writeState(i, p, sgn, phaseIdx, tLeft)
    }
  }

  _canKick(p) {
    if (p.actionLock > 0 || !this._active(p)) return false
    const m = game.match
    const allowed = m.phase === 'play' || (m.restart && m.restart.taker === p.id)
    if (!allowed) return false
    const b = world.ball
    return p.hasBall || (Math.hypot(b.x - p.x, b.z - p.z) < 1.0 && b.y < 0.7)
  }

  _writeMask(i, p, tm, op) {
    const mk = this.mask
    const o = i * N_DISC
    mk.fill(0, o, o + N_DISC)
    mk[o] = 1
    const kick = this._canKick(p)
    const gk = p.role === 'kaleci'
    if (kick) {
      for (let j = 0; j < 3; j++) if (tm[j]) mk[o + 1 + j] = 1
      mk[o + 4] = 1
      mk[o + 5] = 1
    }
    const b = world.ball
    if (p.actionLock <= 0 && this._active(p) && game.match.phase === 'play') {
      const holder = op.find((q) => q.hasBall)
      if (!gk) {
        if (holder && Math.hypot(holder.x - p.x, holder.z - p.z) < 3) mk[o + 6] = 1
        if ((holder && Math.hypot(holder.x - p.x, holder.z - p.z) < 4) || (!p.hasBall && Math.hypot(b.x - p.x, b.z - p.z) < 3 && !tm.some((q) => q.hasBall))) mk[o + 7] = 1
        if (holder && Math.hypot(holder.x - p.x, holder.z - p.z) < 5) mk[o + 8] = 1
      } else if (!p.hasBall) {
        const sgn = game.match.attackDir[p.team]
        const toGoal = b.vx * -sgn // kendi kalesine dogru hiz
        if (toGoal > 4) mk[o + 9] = 1
      }
    }
  }

  _writeState(i, p, sgn, phaseIdx, tLeft) {
    const st = this.state
    let k = i * STATE_DIM
    const ball = world.ball
    const put = (v) => {
      st[k++] = v
    }
    put((sgn * ball.x) / HL)
    put((sgn * ball.z) / HW)
    put((sgn * ball.vx) / BVN)
    put((sgn * ball.vz) / BVN)
    put(ball.y / 3)
    put(ball.vy / 15)
    for (const tm of [p.team, 1 - p.team]) {
      for (let r = 0; r < TEAM_SIZE; r++) {
        const q = game.players[tm * TEAM_SIZE + r]
        put((sgn * q.x) / HL)
        put((sgn * q.z) / HW)
        put((sgn * q.vx) / VN)
        put((sgn * q.vz) / VN)
        put(q.hasBall ? 1 : 0)
        put(this._suspLeft(q) > 0 ? 1 : 0)
      }
    }
    for (let j = 0; j < 11; j++) put(j === phaseIdx ? 1 : 0)
    const m = game.match
    put(m.restart && m.restart.team === p.team ? 1 : 0)
    put(tLeft)
    put(clamp((m.score[p.team] - m.score[1 - p.team]) / 3, -1, 1))
    put(m.score[p.team] / 5)
    put(m.score[1 - p.team] / 5)
  }

  _writeInfo() {
    const m = game.match
    this.info[0] = m.score[0]
    this.info[1] = m.score[1]
    this.info[2] = this.t
    this.info[3] = Math.max(0, PHASES.indexOf(m.phase))
    this.info[4] = this.nDec
    this.info[5] = this.episode
  }

  _capturePotentials() {
    const b = world.ball
    for (let tm = 0; tm < 2; tm++) {
      let best = null
      let bd = 1e9
      for (let r = 0; r < TEAM_SIZE; r++) {
        const q = game.players[tm * TEAM_SIZE + r]
        if (!this._active(q)) continue
        const d = Math.hypot(b.x - q.x, b.z - q.z)
        if (d < bd) {
          bd = d
          best = q.id
        }
      }
      this.near[tm] = { id: best, d: bd }
      this.prevBx[tm] = game.match.attackDir[tm] * b.x
    }
  }

  // ------------------------------------------------------------ adim
  step(actions) {
    if (this.done) throw new Error('bolum bitti: reset() cagir')
    const acts = this.nAg ? this._decodeActions(actions) : null
    this.rt.fill(0)
    this.goalThisDec = false
    for (let f = 0; f < this.skip; f++) {
      this._frame(false, acts, f)
      if (this.cfg.onGoal === 'end' && this.goalThisDec) break
    }
    this.nDec++
    // sekillendirme terimleri
    const b = world.ball
    if (game.match.phase === 'play') {
      for (let i = 0; i < this.nAg; i++) {
        const id = this.agents[i]
        const p = game.players[id]
        const nr = this.near[p.team]
        if (nr && nr.id === id) {
          const d1 = Math.hypot(b.x - p.x, b.z - p.z)
          this.rt[i * N_TERMS + 1] += clamp((nr.d - d1) / DN, -0.5, 0.5)
        }
        const dx = (game.match.attackDir[p.team] * b.x - this.prevBx[p.team]) / PITCH_L
        this.rt[i * N_TERMS + 2] += clamp(dx, -0.5, 0.5)
      }
    }
    this._capturePotentials()
    const w = this.weights
    const wv = [w.goal, w.ball_approach, w.ball_progress, w.pass_ok, w.steal, w.foul, w.card]
    for (let i = 0; i < this.nAg; i++) {
      let r = 0
      for (let j = 0; j < N_TERMS; j++) {
        const v = this.rt[i * N_TERMS + j]
        this.terms[i * N_TERMS + j] = v
        r += wv[j] * v
      }
      this.reward[i] = r
    }
    const timeUp = this.t >= this.cfg.episodeSec - 1e-9
    this.truncated = timeUp && !(this.cfg.onGoal === 'end' && this.goalThisDec)
    this.done = timeUp || (this.cfg.onGoal === 'end' && this.goalThisDec) || game.match.phase === 'fulltime'
    this._writeObs()
    this._writeInfo()
    // determinizm ozeti
    this._hashBytes(this.obs)
    this._hashBytes(this.reward)
    this._hashBytes(this.info.subarray(0, 5)) // bolum sayaci (info[5]) ozete girmez
    return this
  }

  _hashBytes(f32) {
    const u = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)
    let h = this.hash
    for (let i = 0; i < u.length; i++) {
      h ^= u[i]
      h = Math.imul(h, 16777619) >>> 0
    }
    this.hash = h
  }

  hashHex() {
    return this.hash.toString(16).padStart(8, '0')
  }
}
