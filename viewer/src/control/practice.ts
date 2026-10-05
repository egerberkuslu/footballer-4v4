// Serbest antrenman (ctl.practice): mac modu kontrolleri (tam hareket, sprint, pas, sut, mudahale), kurallar KAPALI.
// Sahada tek insan oyuncu + rakip kalecinin kalesinde YZ kaleci; digerleri kenarda bekler. Top disari/kaleye gidince
// kisa sure sonra oyuncunun ayagina doner; R tusu topu hemen getirir; Y kaleciyi/oyuncuyu yeniden dizer.
// (T KULLANILMAZ: Hud.tsx'te T yavas cekimi (timeScale 0.2) acar/kapar; eskiden T her dizmede oyunu 5x yavaslatiyordu.)
import { game } from '../game/store'
import type { Player } from '../game/types'
import { PITCH_L, PITCH_W } from '../pitch'
import { world } from '../sim'
import { setControlled } from './locomotion'
import { placeBall } from './worldApi'

const BENCH_Z = -(PITCH_W / 2 + 1.8)
const st = { resetAt: -1, goals: 0, saves: 0, shots: 0, hint: null as HTMLElement | null, keys: false, lastOwner: -1 }

const attackX = () => (world.side || 1) * (PITCH_L / 2) // hucum edilen kale cizgisi
const humanP = (): Player => game.players.find((p) => p.team === 0 && p.role === 'forvet') ?? game.players[3]
const keeperP = (): Player => game.players.find((p) => p.team === 1 && p.role === 'kaleci') ?? game.players[4]

function placeUser() {
  const P = humanP()
  const dir = Math.sign(attackX()) || 1
  P.x = attackX() - dir * 14
  P.z = 0
  P.vx = P.vz = 0
  P.facing = dir > 0 ? Math.PI / 2 : -Math.PI / 2
  P.hasBall = false
  setControlled(P.id)
  placeBall(P.x + dir * 0.6, P.z)
}

function placeKeeper() {
  const K = keeperP()
  const dir = Math.sign(attackX()) || 1
  K.x = attackX() - dir * 1.0
  K.z = 0
  K.vx = K.vz = 0
  K.facing = dir > 0 ? -Math.PI / 2 : Math.PI / 2
}

/** antrenmani bastan kur (menuden girerken ve Y ile) */
export function resetPractice() {
  st.resetAt = -1
  st.goals = st.saves = st.shots = 0
  placeUser()
  placeKeeper()
}

function ensureUi() {
  if (!st.keys) {
    st.keys = true
    addEventListener('keydown', (e) => {
      if (!window.__practiceOn) return
      const k = e.key.toLowerCase()
      if (k === 'r') ballToFeet()
      else if (k === 'y') resetPractice()
    })
  }
  if (!st.hint && typeof document !== 'undefined' && document.body) {
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:9000;background:#000a;color:#fff;font:13px system-ui;padding:6px 12px;border-radius:8px;pointer-events:none;white-space:pre'
    document.body.appendChild(el)
    st.hint = el
  }
}

function ballToFeet() {
  const P = humanP()
  const dir = Math.sign(attackX()) || 1
  placeBall(P.x + Math.sin(P.facing) * 0.6, P.z + Math.cos(P.facing) * 0.6)
  st.resetAt = -1
  void dir
}

declare global {
  interface Window {
    __practiceOn?: boolean
  }
}

/** her karede (Rules.tsx, mac sonrasi sira): digerlerini park et, topu izle, ipucu yaz */
export function practiceFrame(dt: number) {
  window.__practiceOn = true
  ensureUi()
  const P = humanP()
  const K = keeperP()
  // kurallar kapali: oyun mantigi (hareket, mudahale, top) evre 'play' ister
  if (game.match.phase !== 'play') game.match.phase = 'play'
  game.match.restart = null
  // park: sahaya girmeyen herkes kenarda, hareketsiz
  let i = 0
  for (const p of game.players) {
    if (p === P || p === K) continue
    p.x = -9 + i * 2.6
    p.z = BENCH_Z
    p.vx = p.vz = 0
    p.facing = 0
    p.hasBall = false
    p.anim = 'idle'
    const inp = game.inputs[p.id]
    if (inp) {
      inp.move = { x: 0, z: 0 }
      inp.action = null
    }
    i++
  }
  const r = game.referee
  r.x = 12
  r.z = BENCH_Z
  r.vx = r.vz = 0
  // top: saha disi / kale agi / durgun -> kisa beklemeden sonra oyuncunun ayagina
  const b = world.ball
  const out = Math.abs(b.x) > PITCH_L / 2 + 0.3 || Math.abs(b.z) > PITCH_W / 2 + 0.3
  const inNet = Math.abs(b.x) > PITCH_L / 2 && Math.abs(b.z) < 2.5
  const slow = Math.hypot(b.vx, b.vz) < 0.15 && Math.hypot(b.x - P.x, b.z - P.z) > 8
  if ((out || inNet || slow) && st.resetAt < 0) {
    st.resetAt = performance.now() / 1000 + (inNet ? 1.6 : 1.1)
    if (inNet) st.goals++
  }
  if (st.resetAt >= 0 && performance.now() / 1000 >= st.resetAt) ballToFeet()
  if (st.hint) st.hint.textContent = `SERBEST ANTRENMAN · gol: ${st.goals}   (R: topu getir · Y: yeniden diz · M: menü)`
  void dt
}

export function practiceOff() {
  window.__practiceOn = false
  if (st.hint) st.hint.textContent = ''
}
