// Kol Ayarlari ekraninin acik/kapali durumu (M2). Oyun girdisi (kol ve klavye) acikken yutulur:
// F2'nin kol okuyucusu `gamepadSettingsOpen()` true iken eylem girdisini sifirlamali (ogrenme sihirbazi haric).
// Durum globalThis'te tutulur: sicak modul degisimi (HMR) iki kopya olusturursa da tek durum kalir.
interface Shared {
  open: boolean
  menu: boolean
  ver: number
  subs: Set<() => void>
}
const g = globalThis as unknown as { __gpsUi?: Shared }
const S: Shared = (g.__gpsUi ??= { open: false, menu: false, ver: 0, subs: new Set() })

/** Kol Ayarlari paneli acik mi (yalniz panel) */
export const settingsPanelOpen = () => S.open
/** panel ya da tam ekran menu acik: F2 bu sirada oyun girdisini (kol/klavye eylemleri) sifirlamali */
export const gamepadSettingsOpen = () => S.open || S.menu
export function setMenuOpen(v: boolean) {
  if (S.menu === v) return
  S.menu = v
  S.ver++
  S.subs.forEach((f) => f())
}
export const gamepadUiVersion = () => S.ver
export const subscribeGamepadUi = (f: () => void) => {
  S.subs.add(f)
  return () => {
    S.subs.delete(f)
  }
}
function set(v: boolean) {
  if (S.open === v) return
  S.open = v
  S.ver++
  S.subs.forEach((f) => f())
}
/** ekrani ac (ilk acista kendi React koku tembel yuklenir; menudeki dugme bunu cagirir) */
export function openGamepadSettings() {
  void import('./mountGamepad').then((m) => {
    m.ensureGamepadSettingsMounted()
    set(true)
  })
}
export const closeGamepadSettings = () => set(false)
