import * as THREE from 'three'
import { asset } from '../assetUrl'
import { trackAsync } from '../ui/loadTracker'

// Saha cevresi icin yordamsal (canvas) dokular; hepsi doseme yapilabilir ve onbellekli.

const cache = new Map<string, THREE.Texture>()

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function canvas(w: number, h = w) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

// kenardan tasan lekeyi karsi kenara da ciz (dikissiz doseme)
function wrapBlob(ctx: CanvasRenderingContext2D, W: number, H: number, x: number, y: number, r: number, color: string) {
  for (const dx of [-W, 0, W])
    for (const dy of [-H, 0, H]) {
      const cx = x + dx
      const cy = y + dy
      if (cx + r < 0 || cx - r > W || cy + r < 0 || cy - r > H) continue
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      g.addColorStop(0, color)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    }
}

// Onceden pisirilmis agir dokular (tools/bake-env.mjs -> public/textures/env/*.png).
// Yuklenmediyse ilk kullanimda canvas'ta uretilir (yedek yol).
const BAKED_KEYS = ['concrete', 'outer', 'gravel'] as const
const baked = new Map<string, ImageBitmap>()
let bakedPromise: Promise<void> | null = null
export function loadBakedEnvTextures(): Promise<void> {
  if (!bakedPromise)
    bakedPromise = trackAsync('cevre-doku', 'Çevre dokuları', async () => {
      await Promise.all(
        BAKED_KEYS.map(async (k) => {
          try {
            const r = await fetch(asset(`textures/env/${k}.png`))
            if (r.ok) baked.set(k, await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'flipY' }))
          } catch {
            /* yedek yol */
          }
        }),
      )
    }, 0.5).catch(() => undefined)
  return bakedPromise
}
function fromBaked(key: string): THREE.Texture | null {
  const b = baked.get(key)
  if (!b) return null
  const t = new THREE.Texture(b)
  t.flipY = false
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  t.needsUpdate = true
  cache.set(key, t)
  return t
}

// ham uretici: canvas'i dondurur, onbellege yazmaz (bake betigi kullanir)
export const bakeSources = () => {
  const out: Record<string, HTMLCanvasElement> = {}
  for (const k of BAKED_KEYS) {
    cache.delete(k)
    baked.delete(k)
    const t = k === 'concrete' ? concreteMap() : k === 'outer' ? outerGroundMap() : gravelMap()
    out[k] = t.image as HTMLCanvasElement
  }
  return out
}

function finish(c: HTMLCanvasElement, key: string, color = true, repeat = true) {
  const t = new THREE.CanvasTexture(c)
  if (color) t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  cache.set(key, t)
  return t
}

// Tel orgu (50 mm baklava), alfa haritasi: beyaz = tel. Doku 0.5 m x 0.5 m'yi kaplar.
// Mip seviyeleri elle kurulur: hucre birkac pikselin altina inince desen yerine
// esdeger ortalama ortu (duz gri) kullanilir; uzakta hare (moire) olusmaz.
export function chainLinkAlpha(): THREE.Texture {
  const k = 'chain'
  if (cache.has(k)) return cache.get(k)!
  const cells = 10
  const wire = 3.2 / 512 // tel kalinligi / doku boyu
  const cover = Math.min(1, 2 * wire * cells * Math.SQRT2) // iki capraz aile
  const levels: HTMLCanvasElement[] = []
  for (let N = 512; N >= 1; N >>= 1) {
    const [c, ctx] = canvas(N)
    const s = N / cells
    if (s >= 10) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, N, N)
      ctx.strokeStyle = '#d0d0d0'
      ctx.lineWidth = Math.max(1, wire * N)
      ctx.beginPath()
      for (let i = -1; i <= cells + 1; i++) {
        ctx.moveTo(i * s - N, 0)
        ctx.lineTo(i * s, N)
        ctx.moveTo(i * s + N, 0)
        ctx.lineTo(i * s, N)
      }
      ctx.stroke()
    } else {
      const v = Math.round(208 * cover)
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fillRect(0, 0, N, N)
    }
    levels.push(c)
  }
  const t = new THREE.CanvasTexture(levels[0])
  t.mipmaps = levels
  t.generateMipmaps = false
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  cache.set(k, t)
  return t
}

// Beton plak: 2 m derzli, lekeli. Doku 4 m x 4 m.
export function concreteMap(): THREE.Texture {
  const k = 'concrete'
  if (cache.has(k)) return cache.get(k)!
  const pre = fromBaked(k)
  if (pre) return pre
  const N = 1024
  const [c, ctx] = canvas(N)
  const r = rng(7)
  ctx.fillStyle = '#9a9890'
  ctx.fillRect(0, 0, N, N)
  for (let i = 0; i < 260; i++) {
    const dark = r() < 0.55
    wrapBlob(ctx, N, N, r() * N, r() * N, 20 + r() * 120, dark ? 'rgba(60,58,50,0.10)' : 'rgba(205,200,190,0.10)')
  }
  const img = ctx.getImageData(0, 0, N, N)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 26
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
  // derzler
  ctx.strokeStyle = 'rgba(45,43,38,0.75)'
  ctx.lineWidth = 3
  for (const p of [0, N / 2]) {
    ctx.beginPath()
    ctx.moveTo(p + 1, 0)
    ctx.lineTo(p + 1, N)
    ctx.moveTo(0, p + 1)
    ctx.lineTo(N, p + 1)
    ctx.stroke()
  }
  return finish(c, k)
}

// Saha disi zemin: yipranmis cim, kuru yamalar ve toprak. Doku 16 m x 16 m.
export function outerGroundMap(): THREE.Texture {
  const k = 'outer'
  if (cache.has(k)) return cache.get(k)!
  const pre = fromBaked(k)
  if (pre) return pre
  const N = 1024
  const [c, ctx] = canvas(N)
  const r = rng(11)
  ctx.fillStyle = '#5b6b34'
  ctx.fillRect(0, 0, N, N)
  for (let i = 0; i < 180; i++) {
    const t = r()
    const col =
      t < 0.35
        ? 'rgba(138,120,80,0.30)' // kuru toprak
        : t < 0.7
          ? 'rgba(150,150,80,0.22)' // sararmis ot
          : 'rgba(40,70,25,0.30)' // gur ot
    wrapBlob(ctx, N, N, r() * N, r() * N, 30 + r() * 160, col)
  }
  // ot telleri
  for (let i = 0; i < 90000; i++) {
    const x = r() * N
    const y = r() * N
    ctx.fillStyle = r() < 0.5 ? `rgba(30,50,15,${0.25 + r() * 0.3})` : `rgba(170,170,100,${0.15 + r() * 0.25})`
    ctx.fillRect(x, y, 1, 2 + r() * 3)
  }
  return finish(c, k)
}

// Cakil/toprak yol. Doku 4 m x 4 m.
export function gravelMap(): THREE.Texture {
  const k = 'gravel'
  if (cache.has(k)) return cache.get(k)!
  const pre = fromBaked(k)
  if (pre) return pre
  const N = 1024
  const [c, ctx] = canvas(N)
  const r = rng(23)
  ctx.fillStyle = '#8d7d64'
  ctx.fillRect(0, 0, N, N)
  for (let i = 0; i < 120; i++) wrapBlob(ctx, N, N, r() * N, r() * N, 40 + r() * 140, r() < 0.5 ? 'rgba(70,60,45,0.18)' : 'rgba(180,170,150,0.15)')
  for (let i = 0; i < 26000; i++) {
    const v = 90 + r() * 120
    ctx.fillStyle = `rgba(${v},${v * 0.93},${v * 0.82},${0.5 + r() * 0.5})`
    const s = 1.5 + r() * 3.5
    ctx.beginPath()
    ctx.ellipse(r() * N, r() * N, s, s * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  return finish(c, k)
}

// Bina cephesi: bir doku = bir kat x bir aks (3 m x 3 m), pencere + soveler.
export function facadeMap(kind: 'plaster' | 'brick'): THREE.Texture {
  const k = 'facade-' + kind
  if (cache.has(k)) return cache.get(k)!
  const N = 256
  const [c, ctx] = canvas(N)
  const r = rng(kind === 'brick' ? 5 : 3)
  ctx.fillStyle = kind === 'brick' ? '#a65a40' : '#e9e2d2'
  ctx.fillRect(0, 0, N, N)
  if (kind === 'brick') {
    for (let y = 0; y < N; y += 8)
      for (let x = (y / 8) % 2 ? -8 : 0; x < N; x += 16) {
        const v = 0.85 + r() * 0.3
        ctx.fillStyle = `rgb(${166 * v},${88 * v},${62 * v})`
        ctx.fillRect(x + 1, y + 1, 14, 6)
      }
  } else {
    for (let i = 0; i < 40; i++) wrapBlob(ctx, N, N, r() * N, r() * N, 10 + r() * 50, 'rgba(120,110,90,0.08)')
  }
  // pencere (koyu cam + ince cerceve + denizlik)
  const wx = 64
  const wy = 56
  const ww = 128
  const wh = 120
  ctx.fillStyle = '#f2f0ea'
  ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12)
  const g = ctx.createLinearGradient(0, wy, 0, wy + wh)
  g.addColorStop(0, '#5f7183')
  g.addColorStop(0.5, '#2b3540')
  g.addColorStop(1, '#1d242c')
  ctx.fillStyle = g
  ctx.fillRect(wx, wy, ww, wh)
  ctx.fillStyle = '#e8e6e0'
  ctx.fillRect(wx + ww / 2 - 3, wy, 6, wh)
  ctx.fillRect(wx, wy + 40, ww, 5)
  ctx.fillStyle = '#c9c4b8'
  ctx.fillRect(wx - 10, wy + wh + 6, ww + 20, 8)
  // perde/isik farki
  if (r() < 0.6) {
    ctx.fillStyle = 'rgba(220,210,190,0.35)'
    ctx.fillRect(wx + 4, wy + 46, ww / 2 - 8, wh - 50)
  }
  // kat silmesi
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fillRect(0, N - 6, N, 6)
  return finish(c, k)
}
