// Sut kontrol durumu: kucuk degisebilir depo. Kare basina degisen alanlar (sarj, nisan)
// abonelere bildirilmez; HUD bunlari kendi rAF dongusunde okur.
import { GOAL_H, PITCH_L, SPOT_DIST } from '../pitch'

export type ShotType = 'normal' | 'asirtma' | 'yerden'
export type CamMode = 'sutcu' | 'serbest' | 'yayin'
/** antrenman: serbest sut calismasi (AI/kurallar durur); mac: 4'e 4 */
export type PlayMode = 'antrenman' | 'mac'
export type ShotEvent = 'gol' | 'direk' | 'ust-direk' | 'ag' | 'aut' | 'durdu'

export const CHARGE_T = 1.1 // bar dolma suresi (s)
export const CHARGE_MAX = 1.3 // dolu barda basili tutmaya devam: sapma buyur
export const V_MIN = 8
export const V_MAX = 34
export const CURL_STEPS = 3

const URL_MAC = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mode') === 'mac'

export const ctl = {
  // nisan (kale duzleminde top merkezi), kale ortasina gore
  aimY: 1.0,
  aimZ: 0,
  aimNdc: [0, -0.1] as [number, number], // son fare konumu (kamera dondukce nisan yeniden hesaplanir)
  aimValid: false,
  // sarj: 0..CHARGE_MAX, <0 bos
  charge: -1,
  curl: 0, // -3 sola .. +3 saga
  curlAnalog: 0, // gamepad: -1..+1 (setCurlAnalog yazar; curl = round(analog * CURL_STEPS))
  shift: false,
  ctrl: false,
  // topun yerlestirildigi nokta (sut sonu top buraya doner)
  spotX: PITCH_L / 2 - SPOT_DIST,
  spotZ: 0,
  // kosu: kick zamani (s, performance.now/1000), <0 yok
  runT: -1,
  inFlight: false,
  flightT: 0,
  // ?mode=mac ile macta baslar (Node testlerinde location yok)
  mode: (URL_MAC ? 'mac' : 'antrenman') as PlayMode,
  cam: (URL_MAC ? 'yayin' : 'sutcu') as CamMode,
  dragging: false, // top fareyle suruklenuyor
  follow: true,
  preview: true,
  passHints: true, // macta pas halkalari (H); I2 cizer, veri ai/brain passHints
  setup: false, // macta duran top kurulurken insan nisan/guc hazirligi acik
  help: false,
  lastKmh: 0,
  hint: '', // macta girdi kilidi/sira ipucu (HUD)
  msg: '' as string,
  msgId: 0,
}

export const playMode = (): PlayMode => ctl.mode

export const shotType = (): ShotType => (ctl.shift ? 'asirtma' : ctl.ctrl ? 'yerden' : 'normal')

// sut turune gore nisan yuksekligi siniri
export function aimYRange(): [number, number] {
  return shotType() === 'yerden' ? [0.11, 0.6] : [0.11, GOAL_H + 1.2]
}

const subs = new Set<() => void>()
let ver = 0
export const subscribeCtl = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
export const ctlVersion = () => ver
/** falso adimini ayarla (-CURL_STEPS..+CURL_STEPS), degisirse HUD'a bildir */
export function setCurl(c: number) {
  const v = Math.max(-CURL_STEPS, Math.min(CURL_STEPS, Math.round(c)))
  if (v === ctl.curl) return
  ctl.curl = v
  bumpCtl()
}

/** gamepad cubugu: -1..+1; curl'e yuvarlanir */
export function setCurlAnalog(a: number) {
  ctl.curlAnalog = Math.max(-1, Math.min(1, a))
  setCurl(ctl.curlAnalog * CURL_STEPS)
}

export function bumpCtl() {
  ver++
  subs.forEach((f) => f())
}

export function flash(msg: string) {
  ctl.msg = msg
  ctl.msgId++
  bumpCtl()
}
