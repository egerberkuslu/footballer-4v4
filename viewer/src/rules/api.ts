// Diger ajanlar (G-VAR, HUD) icin dar arayuz.
//   VAR incelemesi: G, match.phase = 'var' yazar (K o surede hicbir sey yapmaz), sonra varDecision cagirir.
//   rulesHistory(sn): son olaylar (dokunus, temas, faul, kart, out, gol) oyun zamaniyla.
import { currentRules, rules } from './instance'
import type { LogEntry, Rules } from './engine'

export type VarDecision = Parameters<Rules['varDecision']>[0]

export function varDecision(d: VarDecision) {
  currentRules().varDecision(d)
}

export function rulesHistory(seconds = 10): LogEntry[] {
  const r = currentRules()
  const t0 = r.time - seconds
  return r.log.filter((l) => l.t >= t0)
}

export { rules }
