// VAR durumu: kucuk degisebilir depo (ctl ile ayni desen). Kare basina degisen alanlar
// (ilerleme) abonelere bildirilmez; arayuz bunlari kendi rAF dongusunde okur.
import type { TeamId } from '../game/types'
import type { Verdict } from './judge'

export type AutoMode = 'acik' | 'kapali'
/** walk: hakem monitore gidiyor (canli); monitor: omuz ustu monitor goruntusu; play/freeze: tam ekran tekrar */
export type Phase = 'off' | 'walk' | 'intro' | 'monitor' | 'play' | 'freeze' | 'signal' | 'verdict' | 'outro'

/** incelenen pozisyon (cok oyunculuda host'tan misafire aynen gider; duz JSON) */
export type VarCase =
  | { kind: 'line'; reason: 'line' | 'manual'; v: Verdict }
  | {
      kind: 'offside'
      reason: 'offside' | 'manual'
      team: TeamId // hucum eden takim
      dir: 1 | -1 // hucum yonu (x isareti)
      passer: number
      receiver: number
      /** K'nin olcumu (m, + = ofsayt) */
      margin: number
      /** pas anindaki alici konumu (misafirde kritik kareyi bulmak icin) */
      rx: number
      rz: number
    }

export interface Display {
  title: string
  tag: string
  sub: string
  cm: number
  cls: string // karar karti renk sinifi
  ok: boolean // yesil (gecerli / tamami gecti) mi
  measure: string // olcum panelinin basligi
  okText: string
  noText: string
}

const AUTO_KEY = 'var.auto2'
const loadAuto = (): AutoMode => {
  try {
    const v = localStorage.getItem(AUTO_KEY)
    if (v === 'acik' || v === 'kapali') return v
  } catch {
    /* depolama yok */
  }
  return 'acik'
}

export const varState = {
  active: false,
  phase: 'off' as Phase,
  auto: loadAuto(),
  reason: '',
  cam: '',
  speed: 0.25,
  /** cizgi incelemesinde karar (geri uyumluluk); ofsaytta null */
  verdict: null as Verdict | null,
  case: null as VarCase | null,
  display: null as Display | null,
  // zaman cubugu (sim saniyesi): pencere, kritik an, simdiki oynatma ani
  t0: 0,
  t1: 1,
  tc: 0.5,
  tNow: 0,
  /** son kayit maliyeti (ms, kayan ortalama) */
  recMs: 0,
  recBytes: 0,
  /** test icin tekrar hizlandirma (bassiz tarayicida kare hizi dusuk) */
  warp: 1,
  /** kisa bilgi notu ("Incelenecek pozisyon yok" gibi) */
  toast: '',
  toastId: 0,
}

/** kamera devralma bayragi: CameraRig/ShotController bunu gorunce kamerayi birakir */
export const cameraLock = () => varState.active
export const isVarActive = () => varState.active

const subs = new Set<() => void>()
let ver = 0
export const subscribeVar = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
export const varVersion = () => ver
export function bumpVar() {
  ver++
  subs.forEach((f) => f())
}

export function toast(msg: string) {
  varState.toast = msg
  varState.toastId++
  bumpVar()
}

export function setAuto(m: AutoMode) {
  varState.auto = m
  try {
    localStorage.setItem(AUTO_KEY, m)
  } catch {
    /* depolama yok */
  }
  bumpVar()
}

// sahne (VarScene) bu istekleri isler
export const varReq = { manual: false, skip: false, remote: null as VarCase | null, remoteEnd: false }
export function requestVar() {
  if (!varState.active) varReq.manual = true
}
export function skipVar() {
  if (varState.active) varReq.skip = true
}

/** cok oyunculu (L): misafirde host'un baslattigi incelemeyi kendi tamponundan oynat; karar host'unki */
export function startRemoteReview(c: VarCase) {
  varReq.remote = c
}
/** host incelemeyi bitirdi: misafirde hemen kapat */
export function endRemoteReview() {
  varReq.remoteEnd = true
}
