// Kumas (forma/sort) gercek zamanli fizigi: Characters.tsx'in kancalari icin genel arayuz.
// add(root) karakter basina; update() karakterler pozlandiktan sonra her kare. Durum agdan gitmez,
// her istemci (VAR tekrari ve misafir dahil) yerelde simule eder.
import * as THREE from 'three'
import { bindToProxy, buildProxy, MAX_BEND, MAX_FAN, MAX_NBR, selectCloth, type Proxy } from './build'
import { ClothSolver, MAX_BONES, MAX_CH, N_CAPS, TW, type Packed, type SolverParams } from './solver'
import { devStats } from '../dev/devStore'
import { registerWarm } from '../ui/Warmup'
import { patchClothMaterial, clothUniforms, clothDepthMaterial } from './material'

/** varsayilan acik; ?cloth=0 ile kapanir */
export const clothOn = () => new URLSearchParams(location.search).get('cloth') !== '0'

const SPACING = 0.042 // m, parcacik araligi
const LAYER_R = 0.07 // m: forma-sort katman eslesmesi yaricapi
const SHORTS_GAP = 0.012 // m, uyluk kapsulu forma icin bu kadar kalin
const FAR = 34 // m: daha uzakta deri pozuna oturur (LOD)

export const clothParams: SolverParams = {
  gravity: new THREE.Vector3(0, -9.81, 0),
  wind: new THREE.Vector3(0.9, 0, 0.35),
  damp: 0.8,
  aeroN: 1.4,
  aeroT: 0.6,
  stretch: 1,
  bendK: 0.18,
  omega: 1.45,
  iters: 6,
  back: 0.003,
  thick: 0.006,
}

// kapsuller: [bas kemik, uc kemik]; yaricap govde mesh'inden olculur
const CAPS: [string, string][] = [
  ['pelvis', 'spine_01'],
  ['spine_01', 'spine_02'],
  ['spine_02', 'spine_03'],
  ['spine_03', 'neck_01'],
  ['upperarm_l', 'lowerarm_l'],
  ['lowerarm_l', 'hand_l'],
  ['upperarm_r', 'lowerarm_r'],
  ['lowerarm_r', 'hand_r'],
  ['thigh_l', 'calf_l'],
  ['thigh_r', 'calf_r'],
]

interface Piece {
  mesh: THREE.SkinnedMesh
  proxy: Proxy
  offset: number
  remap: Int32Array // mesh eklemi -> karakter kemik indeksi
}

interface Char {
  root: THREE.Object3D
  skeleton: THREE.Skeleton
  topBone: THREE.Object3D // iskeletin en ust kemigi (yalniz kemik alt agaci guncellenir)
  k: number // metre / bind birimi
  pieces: Piece[]
  caps: { a: THREE.Bone; b: THREE.Bone; r: number; ro: number; roRef: number; t0: number }[]
  last: THREE.Vector3
  reset: number
}

const proxyCache = new Map<string, Proxy | null>()
const lodCache = new Map<string, { vIdx: Float32Array; vW: Float32Array }>()
const IS_LOD = /_lod\d/i

/** gorsel mesh: karakter basina geometri kopyasi (kuresel parcacik indeksi koseye yazilir) + malzeme yamasi */
function bindVisual(mesh: THREE.SkinnedMesh, vIdx: Float32Array, vW: Float32Array, offset: number) {
  const g = mesh.geometry.clone()
  const idx = new Float32Array(vIdx.length)
  for (let i = 0; i < idx.length; i++) idx[i] = vW[i] > 0 ? vIdx[i] + offset : 0
  g.setAttribute('clothIdx', new THREE.BufferAttribute(idx, 4))
  g.setAttribute('clothW', new THREE.BufferAttribute(vW, 4))
  mesh.geometry = g
  mesh.userData.cloth = true
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  mats.forEach(patchClothMaterial)
  mesh.customDepthMaterial = clothDepthMaterial()
}
const radiusCache = new Map<string, { r: number[]; ro: number[]; roRef: number[] }>()

/** govde mesh'inden kapsul yaricaplari (bind birimi): baskin kemigi olan koselerin segmente uzakligi, %10'luk */
function capsuleRadii(body: THREE.SkinnedMesh): { r: number[]; ro: number[]; roRef: number[] } {
  const hit = radiusCache.get(body.geometry.uuid)
  if (hit) return hit
  const g = body.geometry
  const pos = g.attributes.position
  const si = g.attributes.skinIndex
  const sw = g.attributes.skinWeight
  const bones = body.skeleton.bones
  const head = (nm: string) => {
    const i = bones.findIndex((b) => b.name === nm)
    return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(body.skeleton.boneInverses[i].clone().invert())
  }
  const dists: number[][] = CAPS.map(() => [])
  const idx = CAPS.map(([a]) => bones.findIndex((b) => b.name === a))
  const segs = CAPS.map(([a, b]) => [head(a), head(b)] as const)
  const v = new THREE.Vector3()
  const seg = new THREE.Line3()
  const cp = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    let best = -1
    let bw = 0
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c)
      if (w > bw) {
        bw = w
        best = si.getComponent(i, c)
      }
    }
    const q = idx.indexOf(best)
    if (q < 0) continue
    const [A, B] = segs[q]
    if (!A || !B) continue
    v.fromBufferAttribute(pos, i).applyMatrix4(body.bindMatrix)
    seg.set(A, B).closestPointToPoint(v, true, cp)
    dists[q].push(cp.distanceTo(v))
  }
  const pct = (d: number[], f: number) => (d.length < 8 ? 0 : d[Math.floor(d.length * f)])
  dists.forEach((d) => d.sort((a, b) => a - b))
  const r = { r: dists.map((d) => pct(d, 0.1)), ro: dists.map((d, q) => pct(d, /^thigh/.test(CAPS[q][0]) ? 0.7 : 0.6)), roRef: dists.map((d, q) => pct(d, /^thigh/.test(CAPS[q][0]) ? 0.8 : 0.6)) }
  radiusCache.set(body.geometry.uuid, r)
  return r
}

export class ClothSystem {
  readonly chars: Char[] = []
  private n = 0
  private solver: ClothSolver | null = null
  private failed = false
  private frame = 0
  readonly stats = { cpuMs: 0, prepMs: 0, particles: 0, chars: 0, active: 0, steps: 0, gpuMs: 0 }
  private tq: { ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }; pending: WebGLQuery | null } | null | undefined

  private offWarm: (() => void) | null = null

  constructor() {
    // yukleme ekraninda cozucu shader'larini derle (ilk mac karesinde donma olmasin)
    this.offWarm = registerWarm('kumas', (gl) => {
      if (this.failed || !this.chars.length) return
      if (!this.ensure()) return
      // karakterler pasif (reset): gecisler cizilir, durum bozulmaz
      this.solver!.step(gl, 1 / 60)
    })
  }

  private ensure() {
    if (this.solver) return true
    try {
      this.solver = new ClothSolver(this.pack(), clothParams)
      this.stats.particles = this.n
      this.stats.chars = this.chars.length
      return true
    } catch (e) {
      console.warn('kumas cozucu kurulamadi', e)
      this.failed = true
      return false
    }
  }

  /** karakter kokunu kaydet (icindeki Forma/Sort ya da Kiyafet skinned mesh'leri bulunur) */
  add(root: THREE.Object3D) {
    if (this.solver || this.chars.length >= MAX_CH) return
    const skinned: THREE.SkinnedMesh[] = []
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh)
    })
    const base = skinned.filter((m) => !IS_LOD.test(m.name))
    const hasForma = base.some((m) => /^forma/i.test(m.name))
    const cand = base.filter((m) => (hasForma ? /^(forma|sort)/i.test(m.name) : /kiyafet/i.test(m.name)))
    if (!cand.length) return
    root.updateWorldMatrix(true, true)
    const skel = cand[0].skeleton
    skel.update()
    const k = new THREE.Vector3().fromArray(skel.boneMatrices!, 0).length() || 1
    const boneIdx = new Map(skel.bones.map((b, i) => [b, i]))
    const pieces: Piece[] = []
    for (const mesh of cand) {
      const src = mesh.geometry
      let proxy = proxyCache.get(src.uuid)
      if (proxy === undefined) {
        const sel = selectCloth(mesh)
        proxy = sel ? buildProxy(mesh, sel, SPACING / k) : null
        proxyCache.set(src.uuid, proxy)
      }
      if (!proxy) continue
      const offset = this.n
      this.n += proxy.n
      // karakter basina geometri kopyasi: kuresel parcacik indeksi koseye yazilir
      bindVisual(mesh, proxy.vIdx, proxy.vW, offset)
      const remap = new Int32Array(mesh.skeleton.bones.length)
      mesh.skeleton.bones.forEach((b, i) => (remap[i] = boneIdx.get(b) ?? 0))
      pieces.push({ mesh, proxy, offset, remap })
    }
    if (!pieces.length) return
    const body = skinned.find((m) => /govde/i.test(m.name))
    const radii = body ? capsuleRadii(body) : { r: CAPS.map(() => 0), ro: CAPS.map(() => 0), roRef: CAPS.map(() => 0) }
    const byName = new Map(skel.bones.map((b) => [b.name, b]))
    const caps = CAPS.flatMap(([a, b], i) => {
      const A = byName.get(a)
      const B = byName.get(b)
            // uyluk: forma etegi sortun DISINDA kalsin (dis yaricap + sort payi)
      const ro = /^thigh/.test(a) ? radii.ro[i] * k + SHORTS_GAP : radii.r[i] * k
            // uyluk kapsulu kalca ekleminden %25 asagida baslar: durusta etek yanlardan sisirilmez
      const t0 = /^thigh/.test(a) ? 0.25 : 0
      const roRef = /^thigh/.test(a) ? radii.roRef[i] * k + SHORTS_GAP : ro
      return A && B && radii.r[i] > 0 ? [{ a: A, b: B, r: radii.r[i] * k, ro, roRef, t0 }] : []
    })
    let top: THREE.Object3D = skel.bones[0]
    while (top.parent && (top.parent as THREE.Bone).isBone) top = top.parent
    this.chars.push({ root, skeleton: skel, topBone: top, k, pieces, caps, last: new THREE.Vector3(), reset: 2 })
  }

  private bindLods(ch: Char) {
    ch.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (!m.isSkinnedMesh || m.userData.cloth || !IS_LOD.test(m.name)) return
      const baseName = m.name.replace(IS_LOD, '')
      const pc = ch.pieces.find((p) => p.mesh.name === baseName)
      if (!pc) return
      const key = m.geometry.uuid + '|' + pc.mesh.name
      let b = lodCache.get(key)
      if (!b) {
        b = bindToProxy(m, pc.proxy, SPACING / ch.k)
        lodCache.set(key, b)
      }
      bindVisual(m, b.vIdx, b.vW, pc.offset)
    })
  }

  private pack(): Packed {
    const n = this.n
    const rest = new Float32Array(n * 4)
    const restN = new Float32Array(n * 4)
    const skinI = new Float32Array(n * 4)
    const skinW = new Float32Array(n * 4)
    const meta = new Float32Array(n * 4)
    const nbr = Array.from({ length: MAX_NBR / 2 }, () => new Float32Array(n * 4).fill(-1))
    const bend = Array.from({ length: MAX_BEND / 2 }, () => new Float32Array(n * 4).fill(-1))
    const fan = Array.from({ length: MAX_FAN / 2 }, () => new Float32Array(n * 4).fill(-1))
    this.chars.forEach((ch, ci) => {
      for (const pc of ch.pieces) {
        const P = pc.proxy
        const o = pc.offset
        for (let i = 0; i < P.n; i++) {
          const g = o + i
          rest.set([P.rest[i * 3], P.rest[i * 3 + 1], P.rest[i * 3 + 2], ci], g * 4)
          restN.set([P.restN[i * 3], P.restN[i * 3 + 1], P.restN[i * 3 + 2], P.kind[i]], g * 4)
          for (let c = 0; c < 4; c++) {
            skinI[g * 4 + c] = pc.remap[P.skinI[i * 4 + c]] ?? 0
            skinW[g * 4 + c] = P.skinW[i * 4 + c]
          }
          // sort paçası uyluğa sıkı (uyluk kumaştan çıkmasın); hakemde forma da sıkı (etek gibi durmasın)
          const tight = ci === this.chars.length - 1 && this.chars.length > 1
          let pin = P.pin[i]
          if (P.kind[i] !== 1 && tight) pin = 0.55 + 0.45 * pin
          const pinK = pin > 0.97 ? 1 : 0.3 * pin * pin
          const invMass = 1 - 0.9 * pin
          const maxD = 0.006 + P.reach[i] * Math.pow(1 - pin, 1.5)
          meta.set([pin, pinK, invMass, maxD], g * 4)
          for (let c = 0; c < MAX_NBR; c++) {
            const j = P.nbr[i * MAX_NBR + c]
            if (j < 0) continue
            const t = nbr[c >> 1]
            t[g * 4 + (c & 1) * 2] = j + o
            t[g * 4 + (c & 1) * 2 + 1] = P.nbrL[i * MAX_NBR + c] * ch.k
          }
          for (let c = 0; c < MAX_BEND; c++) {
            const j = P.bend[i * MAX_BEND + c]
            if (j < 0) continue
            const t = bend[c >> 1]
            t[g * 4 + (c & 1) * 2] = j + o
            t[g * 4 + (c & 1) * 2 + 1] = P.bendL[i * MAX_BEND + c] * ch.k
          }
          for (let f = 0; f < MAX_FAN; f++) {
            const j = P.fan[(i * MAX_FAN + f) * 2]
            const l = P.fan[(i * MAX_FAN + f) * 2 + 1]
            if (j < 0 || l < 0) continue
            const t = fan[f >> 1]
            t[g * 4 + (f & 1) * 2] = j + o
            t[g * 4 + (f & 1) * 2 + 1] = l + o
          }
        }
      }
    })
    // katman: forma parcacigi en yakin sort parcaciginin DISINDA kalir (etek sortun ustunde)
    const layer = new Float32Array(n * 4).fill(-1)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const nn = new THREE.Vector3()
    for (const ch of this.chars) {
      const F = ch.pieces.filter((p) => p.proxy.kind[0] === 0)
      const S = ch.pieces.filter((p) => p.proxy.kind[0] === 1)
      for (const f of F) {
        for (let i = 0; i < f.proxy.n; i++) {
          a.fromArray(f.proxy.rest, i * 3)
          let best = -1
          let bd = LAYER_R / ch.k
          for (const sp of S) {
            for (let j = 0; j < sp.proxy.n; j++) {
              const d = b.fromArray(sp.proxy.rest, j * 3).distanceTo(a)
              if (d < bd) {
                bd = d
                best = sp.offset + j
              }
            }
          }
          if (best < 0) continue
          const sp = S.find((p) => best >= p.offset && best < p.offset + p.proxy.n)!
          const j = best - sp.offset
          const gap = a.sub(b.fromArray(sp.proxy.rest, j * 3)).dot(nn.fromArray(sp.proxy.restN, j * 3)) * ch.k
          if (gap < 0) continue
          layer[(f.offset + i) * 4] = best
          layer[(f.offset + i) * 4 + 1] = Math.max(0.004, Math.min(gap, 0.02))
        }
      }
    }
    return { n, rest, restN, skinI, skinW, meta, nbr, bend, fan, layer }
  }

  /** karakterler pozlandiktan SONRA, her kare */
  update(gl: THREE.WebGLRenderer, camera: THREE.Camera, dt: number, gdt: number) {
    if (this.failed || !this.chars.length) return
    // aktif ornek (StrictMode'da kullanilmayan ikinci ornek olusabilir)
    if ((window as unknown as { __cloth?: unknown }).__cloth !== this) Object.assign(window, { __cloth: this })
    const t0 = performance.now()
    if (!this.ensure()) return
    const S = this.solver!
    // LOD1 meshleri sonradan (arka planda) eklenir: ayni vekile bagla
    if (this.frame++ % 30 === 0) for (const ch of this.chars) this.bindLods(ch)
    const cam = camera.getWorldPosition(new THREE.Vector3())
    const wp = new THREE.Vector3()
    const pa = new THREE.Vector3()
    const pb = new THREE.Vector3()
    let moved = false
    let active = 0
    this.chars.forEach((ch, ci) => {
      // yalniz ata zinciri + kemik alt agaci (mesh'ler cizimde zaten guncellenir)
      ch.topBone.parent?.updateWorldMatrix(true, false)
      ch.topBone.updateMatrixWorld(true)
      ch.skeleton.update()
      S.bones.set(ch.skeleton.boneMatrices!.subarray(0, MAX_BONES * 16), ci * MAX_BONES * 16)
      for (let q = 0; q < N_CAPS; q++) {
        const c = ch.caps[q]
        const o = (ci * 32 + q * 2) * 4
        if (!c) {
          S.caps[o + 3] = 0
          continue
        }
        pa.setFromMatrixPosition(c.a.matrixWorld)
        pb.setFromMatrixPosition(c.b.matrixWorld)
        if (c.t0 > 0) {
          // uyluk kalçadan öne kalktıkça kapsül kalçaya uzar (üst ön uyluk şortun içinde kalsın)
          const fl = Math.acos(Math.min(1, Math.max(-1, (pa.y - pb.y) / Math.max(1e-4, pa.distanceTo(pb)))))
          const open = Math.min(1, Math.max(0, (fl - 0.25) / 0.45))
          pa.lerp(pb, c.t0 * (1 - open))
        }
        S.caps.set([pa.x, pa.y, pa.z, c.r, pb.x, pb.y, pb.z, ci === this.chars.length - 1 && this.chars.length > 1 ? c.roRef : c.ro], o)
      }
      ch.root.getWorldPosition(wp)
      const jump = wp.distanceTo(ch.last)
      if (jump > 1e-4) moved = true
      if (jump > 1.5) ch.reset = 2
      ch.last.copy(wp)
      const on = ch.root.visible && wp.distanceTo(cam) < FAR
      if (!on) ch.reset = 2
      const st = S.charState[ci]
      st.x = ch.reset > 0 ? 0 : 1
      if (st.x > 0) active++
    })
    const t1 = performance.now()
    this.stats.prepMs += (t1 - t0 - this.stats.prepMs) * 0.05
    // oyun zamani durmussa (VAR tekrari) govde hareket ediyorsa gercek zamanla simule et
    let h = Math.min(gdt, 1 / 30)
    if (h <= 1e-6 && moved) h = Math.min(dt, 1 / 30)
    const sub = h > 1 / 50 ? 2 : 1
    // GPU süresi (EXT_disjoint_timer_query_webgl2 varsa); sonuç bir sonraki karelerde okunur
    const g2 = gl.getContext() as WebGL2RenderingContext
    if (this.tq === undefined) {
      const ext = g2.getExtension('EXT_disjoint_timer_query_webgl2')
      this.tq = ext ? { ext, pending: null } : null
    }
    const tq = this.tq
    if (tq?.pending && g2.getQueryParameter(tq.pending, g2.QUERY_RESULT_AVAILABLE)) {
      if (!g2.getParameter(tq.ext.GPU_DISJOINT_EXT)) this.stats.gpuMs += (g2.getQueryParameter(tq.pending, g2.QUERY_RESULT) / 1e6 - this.stats.gpuMs) * 0.1
      g2.deleteQuery(tq.pending)
      tq.pending = null
    }
    const q = tq && !tq.pending ? g2.createQuery() : null
    if (q && tq) g2.beginQuery(tq.ext.TIME_ELAPSED_EXT, q)
    for (let s = 0; s < sub; s++) S.step(gl, h / sub)
    if (q && tq) {
      g2.endQuery(tq.ext.TIME_ELAPSED_EXT)
      tq.pending = q
    }
    if (h > 0) {
      this.stats.steps += sub
      for (const ch of this.chars) if (ch.reset > 0) ch.reset--
    }
    const U = clothUniforms
    U.clothPos.value = S.posTex
    U.clothTgt.value = S.tgtTex
    U.clothNS.value = S.nsTex
    U.clothNT.value = S.ntTex
    this.stats.active = active
    this.stats.cpuMs += (performance.now() - t0 - this.stats.cpuMs) * 0.05
    devStats.clothMs = this.stats.cpuMs
    devStats.clothN = this.n
  }

  /** test: parcacik/hedef farki istatistigi (NaN, en buyuk sapma) */
  probe(gl: THREE.WebGLRenderer) {
    if (!this.solver) return null
    const { p, t } = this.solver.read(gl)
    let nan = 0
    let max = 0
    let sum = 0
    for (let i = 0; i < this.n; i++) {
      const d = Math.hypot(p[i * 4] - t[i * 4], p[i * 4 + 1] - t[i * 4 + 1], p[i * 4 + 2] - t[i * 4 + 2])
      if (!isFinite(d)) nan++
      else {
        max = Math.max(max, d)
        sum += d
      }
    }
    return { n: this.n, nan, max, mean: sum / this.n, TW }
  }

  dispose() {
    this.offWarm?.()
    this.solver?.dispose()
    this.solver = null
  }
}
