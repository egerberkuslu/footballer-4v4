// On isitma (M): oyun baslamadan dokulari GPU'ya yukler, tum malzemelerin shader'larini derler
// ve gizli karelerde gizli/kadraj disi her seyi (golge ve son isleme varyantlari dahil) bir kez cizer.
// Canvas ICINE takilir: <Warmup />. Gecis perdesi de rewarm() ile ayni yolu kullanir.
import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { asset } from '../assetUrl'
import { FX } from '../env/Effects'
import { devStats } from '../dev/devStore'
import { world } from '../sim'
import { BOOT, WARM, boot, bootError, bumpBoot, setPhase } from './boot'
import { fileCounts, finishStep, ioPending, lastIo, sealFiles, setProgress } from './loadTracker'

let R: { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera } | null = null
let frameNo = 0
let waiters: { at: number; res: () => void }[] = []
let lastFrameT = 0
let frameDtMs = 0

/** n kare bekle (kare basinda cozulur) */
export function frames(n = 1): Promise<void> {
  return new Promise((res) => waiters.push({ at: frameNo + n, res }))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------ gizli kare
let restore: [THREE.Object3D, boolean, boolean][] | null = null
let origBefore: THREE.Scene['onBeforeRender'] | null = null

function undoForce() {
  if (!restore) return
  for (const [o, v, fc] of restore) {
    o.visible = v
    o.frustumCulled = fc
  }
  restore = null
}

/** sonraki karede sahnedeki her nesne gorunur ve kirpmasiz cizilir (perde/yukleme ekrani arkasinda) */
function forceFrame(scene: THREE.Scene) {
  if (origBefore) return
  origBefore = scene.onBeforeRender
  const before = origBefore
  // render'in en basinda (kirpma ve golge cizimi oncesi) uygulanir; oncelik-0 isleri de bitmis olur
  scene.onBeforeRender = function (...a) {
    scene.onBeforeRender = before
    origBefore = null
    restore = []
    scene.traverse((o) => {
      if (!o.visible || o.frustumCulled) {
        restore!.push([o, o.visible, o.frustumCulled])
        o.visible = true
        o.frustumCulled = false
      }
    })
    if (R) R.gl.shadowMap.needsUpdate = true
    before.apply(this, a)
  }
}

// ------------------------------------------------------------ doku ve shader
function texturesOf(scene: THREE.Scene): Set<THREE.Texture> {
  const out = new Set<THREE.Texture>()
  const add = (v: unknown) => {
    if (v && (v as THREE.Texture).isTexture) out.add(v as THREE.Texture)
    else if (Array.isArray(v)) v.forEach(add)
  }
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material
    if (!m) return
    for (const mat of Array.isArray(m) ? m : [m]) {
      for (const k in mat) add((mat as unknown as Record<string, unknown>)[k])
      const u = (mat as THREE.ShaderMaterial).uniforms
      if (u) for (const k in u) add(u[k]?.value)
    }
  })
  add(scene.background)
  add(scene.environment)
  return out
}

const uploaded = new WeakSet<THREE.Texture>()

async function uploadTextures(step: string | null) {
  if (!R) return 0
  const { gl, scene } = R
  const list = [...texturesOf(scene)].filter((t) => {
    if (uploaded.has(t) || (t as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) return false
    const img = t.image as { width?: number; complete?: boolean; data?: unknown } | undefined
    // goruntusu henuz gelmemis dokular ilk kullanimda yuklenir
    return t.version > 0 && !!img && (img.width ?? 0) > 0
  })
  let t0 = performance.now()
  for (let i = 0; i < list.length; i++) {
    gl.initTexture(list[i])
    uploaded.add(list[i])
    if (step) setProgress(step, (i + 1) / list.length, `${i + 1}/${list.length}`)
    // ilerleme ekrani akici kalsin: ~12 ms'de bir kareye birak
    if (performance.now() - t0 > 12) {
      await frames(1)
      t0 = performance.now()
    }
  }
  return list.length
}

// son isleme acikken sahne bir render hedefine cizilir: program anahtari (cikis renk uzayi) ayni olsun
let rt: THREE.WebGLRenderTarget | null = null

async function compileAll(step: string | null) {
  if (!R) return
  const { gl, scene, camera } = R
  if (FX && !rt) rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType })
  const one = (o: THREE.Object3D, target: THREE.Scene | null) => {
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(FX ? rt : null)
    try {
      return gl.compileAsync(o, camera, target)
    } finally {
      gl.setRenderTarget(prev)
    }
  }
  // isik iceren parcalar ayri derlenirse isik iki kez sayilir (yanlis program anahtari): onlar sondaki tam turda
  const parts = scene.children.filter((c) => {
    let light = false
    c.traverse((o) => {
      if ((o as THREE.Light).isLight) light = true
    })
    return !light
  })
  for (let i = 0; i < parts.length; i++) {
    await one(parts[i], scene)
    if (step) setProgress(step, (i + 1) / (parts.length + 1), `${i + 1}/${parts.length + 1}`)
  }
  await one(scene, null)
}

// ana sahnede olmayan ozel hazirliklar (ör. kumas cozucusunun kendi sahnesindeki shader'lar, render hedefleri):
//   const off = registerWarm('kumas', (gl) => solver.warm(gl))   // kurulunca; yok edilirken off()
// Kayit sonrasi ilk on isitma turunda (yukleme ekrani ya da perde) bir kez calisir.
const warmHooks = new Map<string, { fn: (gl: THREE.WebGLRenderer) => void | Promise<void>; done: boolean }>()
export function registerWarm(id: string, fn: (gl: THREE.WebGLRenderer) => void | Promise<void>) {
  warmHooks.set(id, { fn, done: false })
  return () => {
    warmHooks.delete(id)
  }
}
async function runWarmHooks() {
  if (!R) return
  for (const h of [...warmHooks.values()]) {
    if (h.done) continue
    h.done = true
    try {
      await h.fn(R.gl)
    } catch {
      /* isitma hatasi oyunu kilitlemez */
    }
  }
}

/** sahnede yeni ne varsa: doku yukle, derle, bir gizli kare ciz, kareler oturana dek bekle */
export async function rewarm(maxMs = 2500) {
  if (!R) return
  const t0 = performance.now()
  await frames(2)
  await uploadTextures(null)
  await compileAll(null)
  await runWarmHooks()
  forceFrame(R.scene)
  await frames(2)
  // kareler oturana dek (3 ardisik kare < 40 ms) ya da sure dolana dek
  let calm = 0
  while (performance.now() - t0 < maxMs && calm < 3) {
    await frames(1)
    calm = frameDtMs < 40 ? calm + 1 : 0
  }
}

// ------------------------------------------------------------ acilis akisi
async function waitIdle() {
  const t0 = performance.now()
  let since = 0
  // dosyalar bitti + sahne en az birkac kare cizdi + 400 ms sessizlik (Suspense cozulunce yeni yukleme baslar)
  for (;;) {
    await sleep(100)
    const now = performance.now()
    let quiet = ioPending() === 0 && now - lastIo() > 400 && frameNo > 3
    // model geldiyse forma dokulari da (karakterler kurulunca) baslamali; gelmezse 8 s sonra vazgec
    const files = fileCounts()
    if (quiet && files.model > 0 && files.kits === 0 && now - lastIo() < 8000) quiet = false
    since = quiet ? since + 1 : 0
    if (since >= 3) return
    // 30 s'den sonra yalniz bekleyen dosya YOKSA devam (yavas aga yari yuklu oyun verilmez; kullanici 'Yine de oyna' diyebilir)
    if (performance.now() - t0 > 30000 && ioPending() === 0) return
  }
}

let started = false
let pausedByBoot = false
async function run() {
  if (started) return
  started = true
  const t0 = performance.now()
  // uzak cekim modeli: ilk kullanimda beklenmesin
  try {
    useGLTF.preload(asset('futbolcu_lod1.glb'))
  } catch {
    /* yok */
  }
  await frames(1)
  finishStep('scene')
  await waitIdle()
  sealFiles()
  setPhase('warm')
  if (WARM) {
    await frames(2)
    const n = await uploadTextures('gpu')
    finishStep('gpu', `${n} doku`)
    await compileAll('shader')
    await runWarmHooks()
    finishStep('shader', '')
    // iki gizli kare: biri her sey gorunur, biri normal (son isleme tamponlari otursun)
    setProgress('frames', 0.2)
    forceFrame(R!.scene)
    await frames(3)
    setProgress('frames', 0.6)
    // yeni olusan (ör. ilk karede uretilen) malzemeler icin son bir tur
    await compileAll(null)
    await frames(3)
    finishStep('frames')
  } else {
    finishStep('gpu', 'atlandı')
    finishStep('shader', 'atlandı')
    finishStep('frames', 'atlandı')
  }
  boot.stats.loadMs = Math.round(performance.now() - t0)
  setPhase('ready')
}

// ------------------------------------------------------------ olcum (Oyna'dan sonraki 20 s)
function measure(dtMs: number) {
  const s = boot.stats
  if (!s.t0) return
  const t = performance.now() - s.t0
  if (t > 20000) return
  s.frames++
  if (dtMs > s.worst) {
    s.worst = Math.round(dtMs * 10) / 10
    s.worstAt = Math.round(t)
  }
  if (dtMs > 33) s.over33++
  if (dtMs > 50) s.over50++
  if (s.frames > 30) {
    s.logicMax = Math.max(s.logicMax, Math.round(devStats.logicMs * 100) / 100)
    s.worstP1Max = Math.max(s.worstP1Max, Math.round(devStats.worstMs * 10) / 10)
  }
}

/** kare basi: bekleyenleri coz, gizli kareyi geri al, kare suresini olc */
export function warmTick() {
  undoForce()
  const now = performance.now()
  if (lastFrameT) {
    frameDtMs = now - lastFrameT
    measure(frameDtMs)
  }
  lastFrameT = now
  frameNo++
  if (waiters.length) {
    const due = waiters.filter((w) => w.at <= frameNo)
    waiters = waiters.filter((w) => w.at > frameNo)
    due.forEach((w) => w.res())
  }
}

/** renderer'i bagla ve (yukleme ekrani aciksa) acilis akisini baslat */
export function attachWarmup(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  R = { gl, scene, camera }
  if (!BOOT || started) return
  // yukleme ekrani arkasinda oyun zamani durur (Oyna'da geri gelir)
  if (world.timeScale === 1) {
    world.timeScale = 0
    pausedByBoot = true
  }
  run().catch((e) => {
    // isitma hatasi oyunu kilitlemez
    bootError(`Ön ısıtma hatası: ${(e as Error)?.message ?? e}`)
    setPhase('ready')
  })
}

export function Warmup() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => attachWarmup(gl, scene, camera), [gl, scene, camera])
  useFrame(warmTick, -1001)
  return null
}

/** Oyna: oyun zamanini geri ac, olcumu baslat */
export function startPlay() {
  if (pausedByBoot && world.timeScale === 0) world.timeScale = 1
  pausedByBoot = false
  boot.stats.t0 = performance.now()
  lastFrameT = 0
  setPhase('play')
  bumpBoot()
}
