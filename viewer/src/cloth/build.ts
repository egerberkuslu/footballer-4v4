// Kumas vekili: gorsel forma/sort mesh'inden dusuk cozunurluklu parcacik agi cikarir (CPU, bir kez).
// Yontem: kaynak kenarlari boyunca jeodezik Poisson ornekleme -> tohumlar parcacik olur, jeodezik
// Voronoi komsulugu mesafe kisitlari, ikinci halka bukulme kisitlari, ucgenleri normal yelpazesi verir.
// Gorsel kose en yakin 4 parcacigin yer degistirmesini agirlikla alir.
import * as THREE from 'three'

export const MAX_NBR = 8
export const MAX_BEND = 4
export const MAX_FAN = 6

export type PieceKind = 'forma' | 'sort'

/** serbest (pin=0) parcacigin deriden en fazla uzaklasmasi, m */
export const REACH = { torso: 0.1, arm: 0.045, sort: 0.045 }

export interface Proxy {
  n: number
  rest: Float32Array // n*3, bind uzayi
  restN: Float32Array // n*3
  skinI: Float32Array // n*4, mesh eklem indeksi
  skinW: Float32Array // n*4
  pin: Float32Array // n
  kind: Float32Array // n: 0 forma, 1 sort
  reach: Float32Array // n: serbest ucun deriden en buyuk uzakligi (bind birimi degil, m)
  nbr: Int32Array // n*MAX_NBR (-1 bos)
  nbrL: Float32Array // bind birimi
  bend: Int32Array // n*MAX_BEND
  bendL: Float32Array
  fan: Int32Array // n*MAX_FAN*2
  vIdx: Float32Array // kose*4 yerel parcacik indeksi
  vW: Float32Array // kose*4 (0 = kumas degil)
}

/** her kose icin parca ve pin; -1 parca disi */
export interface Selection {
  piece: Int8Array
  pin: Float32Array
}

const BONE_ARM = /^(upperarm|lowerarm|hand)_/
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Kosenin hangi kumas parcasina ait oldugu ve pin agirligi.
 * Ad "Forma"/"Sort" ise tum mesh; aksi halde Kiyafet atlasinin UV adalari (glTF v: forma < 0.6).
 * COLOR_0.r varsa pin oradan, yoksa sezgisel (yaka/omuz sert, etek/kol agzi serbest).
 */
export function selectCloth(mesh: THREE.SkinnedMesh): Selection | null {
  const g = mesh.geometry
  const pos = g.attributes.position
  const uv = g.attributes.uv
  const col = g.attributes.color
  const si = g.attributes.skinIndex
  const sw = g.attributes.skinWeight
  if (!pos || !si || !sw) return null
  const n = pos.count
  const piece = new Int8Array(n).fill(-1)
  const name = mesh.name.toLowerCase()
  if (/^forma/.test(name)) piece.fill(0)
  else if (/^sort/.test(name)) piece.fill(1)
  else if (/kiyafet/.test(name) && uv) {
    for (let i = 0; i < n; i++) {
      const u = uv.getX(i)
      const v = uv.getY(i)
      if (v < 0.6) piece[i] = 0
      else if (u < 0.45) piece[i] = 1
    }
  } else return null

  const bones = mesh.skeleton.bones
  const bind = mesh.bindMatrix
  const p = new THREE.Vector3()
  // parca basina dikey kapsam (sezgisel pin icin)
  const lo = [Infinity, Infinity]
  const hi = [-Infinity, -Infinity]
  for (let i = 0; i < n; i++) {
    const k = piece[i]
    if (k < 0) continue
    p.fromBufferAttribute(pos, i).applyMatrix4(bind)
    lo[k] = Math.min(lo[k], p.y)
    hi[k] = Math.max(hi[k], p.y)
  }
  // kol eklemleri (bind uzayi): omuz ve bilek
  const jointPos = (nm: string) => {
    const b = bones.findIndex((x) => x.name === nm)
    if (b < 0) return null
    return new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[b].clone().invert())
  }
  const arm = ['l', 'r'].map((s) => ({ a: jointPos(`upperarm_${s}`), b: jointPos(`lowerarm_${s}`) }))

  const pin = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const k = piece[i]
    if (k < 0) continue
    if (col) {
      pin[i] = col.getX(i)
      continue
    }
    p.fromBufferAttribute(pos, i).applyMatrix4(bind)
    const h = (p.y - lo[k]) / Math.max(1e-6, hi[k] - lo[k])
    if (k === 1) {
      pin[i] = 0.3 + 0.7 * smooth(0.35, 0.9, h)
      continue
    }
    // baskin kemik kol mu?
    let best = 0
    let bw = -1
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c)
      if (w > bw) {
        bw = w
        best = si.getComponent(i, c)
      }
    }
    const bn = bones[best]?.name ?? ''
    if (BONE_ARM.test(bn)) {
      const A = arm[bn.endsWith('_l') ? 0 : 1]
      if (A.a && A.b) {
        const d = A.b.clone().sub(A.a)
        const L = d.length()
        const t = p.clone().sub(A.a).dot(d) / (L * L) // omuzdan dirsege 0..1
        pin[i] = 0.75 - 0.6 * smooth(0.0, 0.45, t)
        continue
      }
    }
    pin[i] = 0.12 + 0.88 * smooth(0.06, 0.72, h)
  }
  return { piece, pin }
}

// --- kucuk ikili yigin (Dijkstra) ---
class Heap {
  k: number[] = []
  d: number[] = []
  push(k: number, d: number) {
    const K = this.k
    const D = this.d
    let i = K.length
    K.push(k)
    D.push(d)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (D[p] <= d) break
      K[i] = K[p]
      D[i] = D[p]
      i = p
    }
    K[i] = k
    D[i] = d
  }
  pop(): [number, number] {
    const K = this.k
    const D = this.d
    const rk = K[0]
    const rd = D[0]
    const lk = K.pop()!
    const ld = D.pop()!
    const n = K.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && D[c + 1] < D[c]) c++
        if (D[c] >= ld) break
        K[i] = K[c]
        D[i] = D[c]
        i = c
      }
      K[i] = lk
      D[i] = ld
    }
    return [rk, rd]
  }
  get size() {
    return this.k.length
  }
}

/** vekil ag; spacing bind biriminde parcacik araligi */
export function buildProxy(mesh: THREE.SkinnedMesh, sel: Selection, spacing: number): Proxy | null {
  const g = mesh.geometry
  const pos = g.attributes.position
  const nor = g.attributes.normal
  const si = g.attributes.skinIndex
  const sw = g.attributes.skinWeight
  const nV = pos.count
  const bind = mesh.bindMatrix
  const nmat = new THREE.Matrix3().getNormalMatrix(bind)
  const P = new Float32Array(nV * 3)
  const N = new Float32Array(nV * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < nV; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(bind)
    P[i * 3] = v.x
    P[i * 3 + 1] = v.y
    P[i * 3 + 2] = v.z
    if (nor) v.fromBufferAttribute(nor, i).applyMatrix3(nmat).normalize()
    else v.set(0, 0, 1)
    N[i * 3] = v.x
    N[i * 3 + 1] = v.y
    N[i * 3 + 2] = v.z
  }
  // dikis kaynagi: ayni konum + ayni parca -> tek dugum
  const weld = new Int32Array(nV).fill(-1)
  const key = new Map<string, number>()
  const rep: number[] = [] // dugum -> temsilci kose
  const q = 1e4
  for (let i = 0; i < nV; i++) {
    if (sel.piece[i] < 0) continue
    const k = `${sel.piece[i]}|${Math.round(P[i * 3] * q)}|${Math.round(P[i * 3 + 1] * q)}|${Math.round(P[i * 3 + 2] * q)}`
    let w = key.get(k)
    if (w === undefined) {
      w = rep.length
      rep.push(i)
      key.set(k, w)
    }
    weld[i] = w
  }
  const nW = rep.length
  if (nW < 8) return null
  const dist = (a: number, b: number) => {
    const ia = rep[a] * 3
    const ib = rep[b] * 3
    return Math.hypot(P[ia] - P[ib], P[ia + 1] - P[ib + 1], P[ia + 2] - P[ib + 2])
  }
  // dugum komsulugu (ucgenlerden)
  const index = g.index
  const triCount = index ? index.count / 3 : nV / 3
  const tri = (t: number, c: number) => (index ? index.getX(t * 3 + c) : t * 3 + c)
  const adj: Set<number>[] = Array.from({ length: nW }, () => new Set<number>())
  const tris: [number, number, number][] = []
  for (let t = 0; t < triCount; t++) {
    const a = weld[tri(t, 0)]
    const b = weld[tri(t, 1)]
    const c = weld[tri(t, 2)]
    if (a < 0 || b < 0 || c < 0) continue
    adj[a].add(b).add(c)
    adj[b].add(a).add(c)
    adj[c].add(a).add(b)
    tris.push([a, b, c])
  }
  const adjL = adj.map((s) => [...s])
  const adjD = adjL.map((l, a) => l.map((b) => dist(a, b)))

  // jeodezik Poisson ornekleme: ust dugumlerden baslar (yaka/omuz once tohum olur)
  const order = [...Array(nW).keys()].sort((a, b) => P[rep[b] * 3 + 1] - P[rep[a] * 3 + 1])
  const cover = new Float32Array(nW).fill(Infinity)
  const seeds: number[] = []
  const r = spacing
  for (const s of order) {
    if (cover[s] < r * 0.8) continue
    seeds.push(s)
    // yerel Dijkstra: yaricap r icinde kapsami guncelle
    const h = new Heap()
    cover[s] = 0
    h.push(s, 0)
    const seen = new Map<number, number>([[s, 0]])
    while (h.size) {
      const [a, d] = h.pop()
      if (d > (seen.get(a) ?? Infinity)) continue
      const L = adjL[a]
      const D = adjD[a]
      for (let i = 0; i < L.length; i++) {
        const b = L[i]
        const nd = d + D[i]
        if (nd > r) continue
        if (nd < (seen.get(b) ?? Infinity)) {
          seen.set(b, nd)
          if (nd < cover[b]) cover[b] = nd
          h.push(b, nd)
        }
      }
    }
  }
  // jeodezik Voronoi: her dugum en yakin tohuma
  const owner = new Int32Array(nW).fill(-1)
  const od = new Float32Array(nW).fill(Infinity)
  {
    const h = new Heap()
    seeds.forEach((s, i) => {
      owner[s] = i
      od[s] = 0
      h.push(s, 0)
    })
    while (h.size) {
      const [a, d] = h.pop()
      if (d > od[a]) continue
      const L = adjL[a]
      const D = adjD[a]
      for (let i = 0; i < L.length; i++) {
        const b = L[i]
        const nd = d + D[i]
        if (nd < od[b]) {
          od[b] = nd
          owner[b] = owner[a]
          h.push(b, nd)
        }
      }
    }
  }
  const n = seeds.length
  const rest = new Float32Array(n * 3)
  const restN = new Float32Array(n * 3)
  const pin = new Float32Array(n)
  const cnt = new Float32Array(n)
  const skinAcc: Map<number, number>[] = Array.from({ length: n }, () => new Map())
  for (let i = 0; i < n; i++) {
    const vi = rep[seeds[i]]
    rest.set(P.subarray(vi * 3, vi * 3 + 3), i * 3)
  }
  for (let vi = 0; vi < nV; vi++) {
    const w = weld[vi]
    if (w < 0) continue
    const o = owner[w]
    if (o < 0) continue
    pin[o] += sel.pin[vi]
    cnt[o]++
    restN[o * 3] += N[vi * 3]
    restN[o * 3 + 1] += N[vi * 3 + 1]
    restN[o * 3 + 2] += N[vi * 3 + 2]
    const acc = skinAcc[o]
    for (let c = 0; c < 4; c++) {
      const ww = sw.getComponent(vi, c)
      if (ww <= 0) continue
      const j = si.getComponent(vi, c)
      acc.set(j, (acc.get(j) ?? 0) + ww)
    }
  }
  const skinI = new Float32Array(n * 4)
  const skinW = new Float32Array(n * 4)
  const reach = new Float32Array(n)
  const kind = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    pin[i] /= Math.max(1, cnt[i])
    v.fromArray(restN, i * 3).normalize()
    if (v.lengthSq() < 0.5) v.set(0, 0, 1)
    v.toArray(restN, i * 3)
    const top = [...skinAcc[i].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    const s = top.reduce((a, e) => a + e[1], 0) || 1
    top.forEach(([j, w], c) => {
      skinI[i * 4 + c] = j
      skinW[i * 4 + c] = w / s
    })
    // kol ve sort paçasi kisa, forma etegi uzun savrulur
    const arm = BONE_ARM.test(mesh.skeleton.bones[top[0]?.[0] ?? 0]?.name ?? '')
    kind[i] = sel.piece[rep[seeds[i]]]
    reach[i] = kind[i] === 1 ? REACH.sort : arm ? REACH.arm : REACH.torso
  }
  // vekil kenarlari: farkli sahipli dugum komsulugu
  const pAdj: Set<number>[] = Array.from({ length: n }, () => new Set<number>())
  for (let a = 0; a < nW; a++) {
    const oa = owner[a]
    if (oa < 0) continue
    for (const b of adjL[a]) {
      const ob = owner[b]
      if (ob >= 0 && ob !== oa) {
        pAdj[oa].add(ob)
        pAdj[ob].add(oa)
      }
    }
  }
  const pd = (a: number, b: number) =>
    Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2])
  const nbr = new Int32Array(n * MAX_NBR).fill(-1)
  const nbrL = new Float32Array(n * MAX_NBR)
  const bend = new Int32Array(n * MAX_BEND).fill(-1)
  const bendL = new Float32Array(n * MAX_BEND)
  for (let i = 0; i < n; i++) {
    const near = [...pAdj[i]].sort((a, b) => pd(i, a) - pd(i, b)).slice(0, MAX_NBR)
    near.forEach((j, c) => {
      nbr[i * MAX_NBR + c] = j
      nbrL[i * MAX_NBR + c] = pd(i, j)
    })
    // ikinci halka: uzak olanlar bukulmeye en cok direnir
    const ring = new Set<number>()
    for (const j of pAdj[i]) for (const k of pAdj[j]) if (k !== i && !pAdj[i].has(k)) ring.add(k)
    const far = [...ring].filter((k) => pd(i, k) < spacing * 3).sort((a, b) => pd(i, b) - pd(i, a))
    // yon cesitliligi: birbirine yakin secimleri atla
    const pick: number[] = []
    for (const k of far) {
      if (pick.length >= MAX_BEND) break
      if (pick.every((m) => pd(m, k) > spacing * 1.2)) pick.push(k)
    }
    pick.forEach((k, c) => {
      bend[i * MAX_BEND + c] = k
      bendL[i * MAX_BEND + c] = pd(i, k)
    })
  }
  // normal yelpazesi: uc farkli sahipli ucgenler (sarim korunur)
  const fan = new Int32Array(n * MAX_FAN * 2).fill(-1)
  const fanN = new Int32Array(n)
  const seenT = new Set<string>()
  for (const [a, b, c] of tris) {
    const A = owner[a]
    const B = owner[b]
    const C = owner[c]
    if (A < 0 || B < 0 || C < 0 || A === B || B === C || A === C) continue
    const k = [A, B, C].sort((x, y) => x - y).join(',')
    if (seenT.has(k)) continue
    seenT.add(k)
    const add = (i: number, j: number, l: number) => {
      if (fanN[i] >= MAX_FAN) return
      fan[(i * MAX_FAN + fanN[i]) * 2] = j
      fan[(i * MAX_FAN + fanN[i]) * 2 + 1] = l
      fanN[i]++
    }
    add(A, B, C)
    add(B, C, A)
    add(C, A, B)
  }
  // yelpaze normali dinlenme normaline ters ise cevir
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const acc = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    acc.set(0, 0, 0)
    for (let f = 0; f < fanN[i]; f++) {
      const j = fan[(i * MAX_FAN + f) * 2]
      const l = fan[(i * MAX_FAN + f) * 2 + 1]
      e1.fromArray(rest, j * 3).sub(v.fromArray(rest, i * 3))
      e2.fromArray(rest, l * 3).sub(v)
      acc.add(e1.cross(e2))
    }
    if (acc.dot(v.fromArray(restN, i * 3)) < 0) {
      for (let f = 0; f < fanN[i]; f++) {
        const o = (i * MAX_FAN + f) * 2
        const t = fan[o]
        fan[o] = fan[o + 1]
        fan[o + 1] = t
      }
    }
  }
  // gorsel baglama: sahip + komsulari arasindan en yakin 3 (w bileseni 0 kalir: bkz. material.ts)
  const vIdx = new Float32Array(nV * 4)
  const vW = new Float32Array(nV * 4)
  for (let vi = 0; vi < nV; vi++) {
    const w = weld[vi]
    if (w < 0 || owner[w] < 0) continue
    const o = owner[w]
    bindVertex([o, ...pAdj[o]], rest, P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2], spacing, vIdx, vW, vi)
  }
  return { n, rest, restN, skinI, skinW, pin, kind, reach, nbr, nbrL, bend, bendL, fan, vIdx, vW }
}

function bindVertex(
  cand: number[], rest: Float32Array, px: number, py: number, pz: number, spacing: number,
  vIdx: Float32Array, vW: Float32Array, vi: number,
) {
  const eps = spacing * 0.3
  const sc = cand
    .map((j) => ({ j, d: Math.hypot(rest[j * 3] - px, rest[j * 3 + 1] - py, rest[j * 3 + 2] - pz) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
  let s = 0
  const ws = sc.map((e) => {
    const x = 1 / ((e.d + eps) * (e.d + eps))
    s += x
    return x
  })
  sc.forEach((e, c) => {
    vIdx[vi * 4 + c] = e.j
    vW[vi * 4 + c] = ws[c] / s
  })
}

/** baska bir gorsel mesh'i (LOD1) mevcut vekile bagla: en yakin parcacik + komsulari */
export function bindToProxy(mesh: THREE.SkinnedMesh, proxy: Proxy, spacing: number) {
  const pos = mesh.geometry.attributes.position
  const nV = pos.count
  const vIdx = new Float32Array(nV * 4)
  const vW = new Float32Array(nV * 4)
  const v = new THREE.Vector3()
  const R = proxy.rest
  for (let vi = 0; vi < nV; vi++) {
    v.fromBufferAttribute(pos, vi).applyMatrix4(mesh.bindMatrix)
    let best = 0
    let bd = Infinity
    for (let j = 0; j < proxy.n; j++) {
      const d = (R[j * 3] - v.x) ** 2 + (R[j * 3 + 1] - v.y) ** 2 + (R[j * 3 + 2] - v.z) ** 2
      if (d < bd) {
        bd = d
        best = j
      }
    }
    const cand = [best]
    for (let c = 0; c < MAX_NBR; c++) {
      const j = proxy.nbr[best * MAX_NBR + c]
      if (j >= 0) cand.push(j)
    }
    bindVertex(cand, R, v.x, v.y, v.z, spacing, vIdx, vW, vi)
  }
  return { vIdx, vW }
}
