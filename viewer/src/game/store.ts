// Oyun durumu: tek, degistirilebilir nesne (kare basina React render'i yok).
// Yazma yetkileri (CONTRACT.md "Oynanis mimarisi"):
//   players[].x,z,vx,vz,facing,anim,animT,actionLock,hasBall,stamina -> control/locomotion (F)
//   inputs (insan)                                                -> control (F)
//   inputs (yapay zeka)                                           -> ai (J)
//   match, referee, players[].yellow/sentOff                      -> rules (K)
import { PITCH_L } from '../pitch'
import type { GameEvent, MatchState, Player, PlayerInput, Referee, Role, TeamId } from './types'

const ROLES: Role[] = ['kaleci', 'defans', 'orta', 'forvet']
const NAMES: [string[], string[]] = [
  ['Ege', 'Mert', 'Kaan', 'Arda'],
  ['Deniz', 'Emre', 'Burak', 'Can'],
]

function makePlayers(): Player[] {
  const list: Player[] = []
  for (const team of [0, 1] as TeamId[]) {
    const dir = team === 0 ? 1 : -1 // ev takimi +x kalesine hucum eder, kendi kalesi -x
    ROLES.forEach((role, i) => {
      // baslangic dizilisi: kendi yari sahasinda
      const depth = role === 'kaleci' ? 0.47 : role === 'defans' ? 0.3 : role === 'orta' ? 0.18 : 0.06
      const lateral = role === 'orta' ? -5 : role === 'forvet' ? 3 : 0
      list.push({
        id: team * 4 + i,
        team,
        role,
        number: role === 'kaleci' ? 1 : [0, 4, 8, 9][i],
        name: NAMES[team][i],
        x: -dir * depth * PITCH_L,
        z: lateral * (team === 0 ? 1 : -1),
        vx: 0,
        vz: 0,
        facing: dir > 0 ? Math.PI / 2 : -Math.PI / 2,
        anim: 'idle',
        animT: 0,
        actionLock: 0,
        controlled: team === 0 && role === 'forvet',
        hasBall: false,
        stamina: 1,
        yellow: 0,
        sentOff: false,
      })
    })
  }
  return list
}

const emptyInput = (): PlayerInput => ({ move: { x: 0, z: 0 }, sprint: false, action: null })

class Game {
  players: Player[] = makePlayers()
  inputs: PlayerInput[] = this.players.map(emptyInput)
  referee: Referee = { x: 0, z: -9, vx: 0, vz: 0, facing: 0, anim: 'idle', animT: 0 }
  match: MatchState = {
    phase: 'kickoff',
    clock: 0,
    halfLength: 180,
    half: 1,
    score: [0, 0],
    attackDir: [1, -1],
    restart: null,
    lastTouch: null,
    advantageUntil: 0,
  }
  // insan hangi takimi oynuyor; null = izleme (iki takim da yapay zeka)
  humanTeam: TeamId | null = 0
  // cok oyunculu: girdisi agdan gelen (uzak insan) oyuncu id'leri; AI bunlari atlar (L yazar)
  remote = new Set<number>()
  private listeners = new Set<(e: GameEvent) => void>()

  emit(e: GameEvent) {
    this.listeners.forEach((f) => f(e))
  }

  on(fn: (e: GameEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  controlledPlayer(): Player | undefined {
    return this.players.find((p) => p.controlled)
  }

  resetInputs() {
    for (let i = 0; i < this.inputs.length; i++) this.inputs[i] = emptyInput()
  }
}

export const game = new Game()
