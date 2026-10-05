// Kale agi topolojisi: tek parca ag (arka + ust + iki yan + zemine yatan etek).
// Paneller dikiste ortak dugum paylasir; ag cerceveye ~22 cm aralikli kelepcelerle baglidir.
import { GOAL_H, GOAL_W, NET_D_BOTTOM, NET_D_TOP, PITCH_L } from '../pitch'

export const ROPE_R = 0.004 // ip yaricapi (m)
export const MESH = 0.12 // hedef goz araligi
const SLACK_BACK = 1.1 // arka ag bol: derin torbalanir
const SLACK_TOP = 1.05 // ust ag hafif sarkik
const SLACK_SIDE = 1.06
// ag kenarlari boru eksenlerine kelepceli
export const NET_Y_BOTTOM = 0.017 // zemin borusu ekseni
export const NET_Y_TOP = GOAL_H - 0.026 // ust boru ekseni
const BEND_MIN = 0.55 // atlamali (i,i+2) baglar bu oranin altina katlanmaz: buruşma yerine kivrim
const DIAG_MIN = 0.45 // goz kosegeni (kesme zayif): goz cizgiye cokmesin

export interface NetBuild {
  pos: number[]
  inv: number[]
  ropeA: number[]
  ropeB: number[]
  ropeR: number[]
  softA: number[]
  softB: number[]
  softR: number[]
  render: number[]
  nrm: number[] // dugum basina dinlenme dis normali (tunelleme yon referansi)
  // her dugum icin en fazla 2 baglanti noktasi (uzun menzilli baglar)
  tethA: number[]
  tethN: number[]
  tethL: number[]
}

export interface GoalRange {
  side: 1 | -1
  n0: number
  n1: number
  r0: number
  r1: number
  s0: number
  s1: number
  t0: number
  t1: number
}

const GROUPS = 11

export function buildGoalNet(B: NetBuild, side: 1 | -1, nodeMass: number): GoalRange {
  const hw = GOAL_W / 2
  const H = GOAL_H
  const Db = NET_D_BOTTOM
  const Dt = NET_D_TOP
  const n0 = B.pos.length / 3
  const r0 = B.ropeA.length
  const s0 = B.softA.length
  const t0 = B.tethA.length

  const keyMap = new Map<string, number>()
  const node = (d: number, y: number, w: number) => {
    const key = `${Math.round(d * 1e4)},${Math.round(y * 1e4)},${Math.round(w * 1e4)}`
    let id = keyMap.get(key)
    if (id === undefined) {
      id = B.pos.length / 3
      keyMap.set(key, id)
      B.pos.push(side * (PITCH_L / 2 + d), y, w)
      B.inv.push(1 / nodeMass)
      B.nrm.push(0, 0, 0)
    }
    return id
  }
  const addN = (ids: number[], d: number, y: number, w: number) => {
    for (const id of ids) {
      B.nrm[id * 3] += side * d
      B.nrm[id * 3 + 1] += y
      B.nrm[id * 3 + 2] += w
    }
  }
  // kelepce: cerceve boyunca her ikinci dugum (+ uc dugumler) sabit
  const clipGroups: number[][] = []
  const frame = (ids: number[], g: number, every = 2) => {
    const last = ids.length - 1
    ids.forEach((id, i) => {
      if (i % every !== 0 && i !== last) return
      B.inv[id] = 0
      ;(clipGroups[id - n0] ??= []).push(g)
    })
  }
  const P = (i: number) => [B.pos[i * 3], B.pos[i * 3 + 1], B.pos[i * 3 + 2]]
  const dist = (a: number, b: number) => {
    const p = P(a)
    const q = P(b)
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
  }

  const ropeSet = new Set<number>()
  const adj: number[][] = []
  const rope = (a: number, b: number, slack: number) => {
    if (a === b) return
    const k = Math.min(a, b) * 1e6 + Math.max(a, b)
    if (ropeSet.has(k)) return
    ropeSet.add(k)
    B.render.push(a, b)
    const r = dist(a, b) * slack
    ;(adj[a - n0] ??= []).push(b, r)
    ;(adj[b - n0] ??= []).push(a, r)
    if (B.inv[a] === 0 && B.inv[b] === 0) return
    B.ropeA.push(a)
    B.ropeB.push(b)
    B.ropeR.push(r)
  }
  const softSet = new Set<number>()
  const soft = (a: number, b: number, ratio: number) => {
    if (a === b) return
    const k = Math.min(a, b) * 1e6 + Math.max(a, b)
    if (softSet.has(k)) return
    softSet.add(k)
    if (B.inv[a] === 0 && B.inv[b] === 0) return
    B.softA.push(a)
    B.softB.push(b)
    B.softR.push(dist(a, b) * ratio)
  }
  const line = (ids: number[], slack: number) => {
    for (let i = 0; i + 1 < ids.length; i++) rope(ids[i], ids[i + 1], slack)
    for (let i = 0; i + 2 < ids.length; i++) soft(ids[i], ids[i + 2], BEND_MIN)
  }

  const NC = Math.round(GOAL_W / MESH) // 42 goz
  const NR = Math.round(Math.hypot(Db - Dt, H) / MESH) // 18 goz
  const NT = Math.round(Dt / MESH) // 7 goz
  const dS = Dt / NT // yan panel sutun araligi (ust panelle ortak)
  const wOf = (c: number) => -hw + (c * GOAL_W) / NC
  const slantD = (r: number) => Db + ((Dt - Db) * r) / NR
  const Yb = NET_Y_BOTTOM
  const Yt = NET_Y_TOP
  const yOf = (r: number) => Yb + ((Yt - Yb) * r) / NR
  const col = (m: number[][], c: number) => m.map((row) => row[c])

  // arka panel: satir 0 zeminde, satir NR arka ust boruda
  const back: number[][] = []
  for (let r = 0; r <= NR; r++) {
    back[r] = []
    for (let c = 0; c <= NC; c++) back[r][c] = node(slantD(r), yOf(r), wOf(c))
  }
  // ust panel: satir 0 ust direk, satir NT = arka panelin son satiri
  const top: number[][] = []
  for (let k = 0; k <= NT; k++) {
    top[k] = []
    for (let c = 0; c <= NC; c++) top[k][c] = node((k * Dt) / NT, Yt, wOf(c))
  }
  // yan paneller: kare goz, egik kenarda kesilmis; egik kenar dugumleri arka panelle ortak
  const sides: number[][][] = []
  for (const sgn of [-1, 1]) {
    const w = sgn * hw
    const rows: number[][] = []
    for (let j = 0; j <= NR; j++) {
      const ds = slantD(j)
      const row: number[] = []
      for (let i = 0; i * dS < ds - 0.03; i++) row.push(node(i * dS, yOf(j), w))
      row.push(node(ds, yOf(j), w))
      rows.push(row)
    }
    sides.push(rows)
  }

  {
    const l = Math.hypot(H, Db - Dt)
    for (const row of back) addN(row, H / l, (Db - Dt) / l, 0)
    for (const row of top) addN(row, 0, 1, 0)
    sides.forEach((rows, si) => rows.forEach((row) => addN(row, 0, 0, si === 0 ? -1 : 1)))
  }

  // gruplar: 0 ust direk, 1/2 direkler, 3 arka ust boru, 4 arka zemin borusu,
  // 5/6 arka dikmeler, 7/8 yan ust borular, 9/10 yan zemin borulari
  frame(top[0], 0)
  frame(col(sides[0], 0), 1)
  frame(col(sides[1], 0), 2)
  frame(back[NR], 3)
  frame(back[0], 4, 1) // alt kenar zemin borusuna boydan kelepceli: etek disari tasmaz
  frame(col(back, 0), 5)
  frame(col(back, NC), 6)
  frame(col(top, 0), 7)
  frame(col(top, NC), 8)
  frame(sides[0][0], 9, 1)
  frame(sides[1][0], 10, 1)

  for (const rows of sides) {
    for (const row of rows) line(row, SLACK_SIDE)
    // dikey ipler: sutun bittigi yerde egik kenara baglanir
    for (let i = 0; i < rows[0].length - 1; i++) {
      const c: number[] = []
      for (let j = 0; j <= NR; j++) {
        if (i < rows[j].length - 1) c.push(rows[j][i])
        else {
          c.push(rows[j][rows[j].length - 1])
          break
        }
      }
      line(c, SLACK_SIDE)
    }
    for (let j = 0; j < NR; j++) {
      const a = rows[j]
      const b = rows[j + 1]
      for (let i = 0; i + 1 < b.length - 1; i++) {
        soft(a[i], b[i + 1], DIAG_MIN)
        soft(a[i + 1], b[i], DIAG_MIN)
      }
    }
  }
  for (let r = 0; r <= NR; r++) line(back[r], SLACK_BACK)
  for (let c = 0; c <= NC; c++) line(col(back, c), SLACK_BACK)
  for (let k = 0; k <= NT; k++) line(top[k], SLACK_TOP)
  for (let c = 0; c <= NC; c++) line(col(top, c), SLACK_TOP)
  for (let r = 0; r < NR; r++)
    for (let c = 0; c < NC; c++) {
      soft(back[r][c], back[r + 1][c + 1], DIAG_MIN)
      soft(back[r][c + 1], back[r + 1][c], DIAG_MIN)
    }
  for (let k = 0; k < NT; k++)
    for (let c = 0; c < NC; c++) {
      soft(top[k][c], top[k + 1][c + 1], DIAG_MIN)
      soft(top[k][c + 1], top[k + 1][c], DIAG_MIN)
    }

  for (let i = n0; i < B.pos.length / 3; i++) {
    const k = i * 3
    let l = Math.hypot(B.nrm[k], B.nrm[k + 1], B.nrm[k + 2])
    if (l < 1e-6) {
      B.nrm[k + 1] = 1
      l = 1
    }
    B.nrm[k] /= l
    B.nrm[k + 1] /= l
    B.nrm[k + 2] /= l
  }

  // uzun menzilli baglar: her gruptan Dijkstra, dugum basina en yakin 2 grup
  const n = B.pos.length / 3 - n0
  const best = Array.from({ length: n }, () => [] as { d: number; a: number }[])
  for (let g = 0; g < GROUPS; g++) {
    const D = new Float64Array(n).fill(Infinity)
    const A = new Int32Array(n).fill(-1)
    const heap: [number, number][] = []
    const push = (d: number, i: number) => {
      heap.push([d, i])
      let k = heap.length - 1
      while (k > 0) {
        const p = (k - 1) >> 1
        if (heap[p][0] <= heap[k][0]) break
        ;[heap[p], heap[k]] = [heap[k], heap[p]]
        k = p
      }
    }
    const pop = () => {
      const top = heap[0]
      const last = heap.pop()!
      if (heap.length) {
        heap[0] = last
        let k = 0
        for (;;) {
          const l = 2 * k + 1
          const r = l + 1
          let m = k
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r
          if (m === k) break
          ;[heap[m], heap[k]] = [heap[k], heap[m]]
          k = m
        }
      }
      return top
    }
    for (let l = 0; l < n; l++) {
      if (clipGroups[l]?.includes(g)) {
        D[l] = 0
        A[l] = l
        push(0, l)
      }
    }
    while (heap.length) {
      const [d, l] = pop()
      if (d > D[l]) continue
      if (B.inv[l + n0] === 0 && A[l] !== l) continue // baska kelepceden gecilmez
      const nb = adj[l] ?? []
      for (let k = 0; k < nb.length; k += 2) {
        const m = nb[k] - n0
        const nd = d + nb[k + 1]
        if (nd < D[m]) {
          D[m] = nd
          A[m] = A[l]
          push(nd, m)
        }
      }
    }
    for (let l = 0; l < n; l++) if (A[l] >= 0 && D[l] > 0) best[l].push({ d: D[l], a: A[l] + n0 })
  }
  for (let l = 0; l < n; l++) {
    if (B.inv[l + n0] === 0) continue
    best[l].sort((p, q) => p.d - q.d)
    for (const t of best[l].slice(0, 2)) {
      B.tethN.push(l + n0)
      B.tethA.push(t.a)
      B.tethL.push(t.d)
    }
  }

  return {
    side,
    n0,
    n1: B.pos.length / 3,
    r0,
    r1: B.ropeA.length,
    s0,
    s1: B.softA.length,
    t0,
    t1: B.tethA.length,
  }
}
