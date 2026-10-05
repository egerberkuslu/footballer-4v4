import * as THREE from 'three'

// Yukaridan bakilan bicilmis cimin dikissiz (tile) prosedurel dokusu.
// RGB = renk (sRGB), A = yukseklik (normal/kabartma icin). Bir karo GRASS_TILE_M metreyi kaplar.
export const GRASS_TILE_M = 1.6

// tohumlu rastgele: her acilista ayni doku
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function paintTile(size: number): { color: HTMLCanvasElement; height: HTMLCanvasElement } {
  const r = rng(1337)
  const pxPerM = size / GRASS_TILE_M
  const color = document.createElement('canvas')
  const height = document.createElement('canvas')
  color.width = color.height = height.width = height.height = size
  const c = color.getContext('2d')!
  const h = height.getContext('2d')!

  // dip: golgede kalan toprak/kuru yaprak karisimi
  c.fillStyle = '#1d3410'
  c.fillRect(0, 0, size, size)
  h.fillStyle = '#000'
  h.fillRect(0, 0, size, size)

  // katmanlar: alttan uste dogru yaprak hem acilir hem yukselir
  const layers = [
    { n: 26000, len: [0.012, 0.03], w: [0.0035, 0.006], col: [[30, 62, 16], [44, 78, 20], [52, 70, 22]], hv: 50 },
    { n: 30000, len: [0.012, 0.028], w: [0.003, 0.0055], col: [[52, 102, 28], [62, 112, 30], [70, 104, 34]], hv: 120 },
    { n: 26000, len: [0.01, 0.024], w: [0.0028, 0.005], col: [[78, 132, 40], [92, 140, 44], [86, 124, 46]], hv: 190 },
    { n: 9000, len: [0.006, 0.016], w: [0.0025, 0.0042], col: [[116, 160, 62], [128, 156, 70], [104, 150, 52]], hv: 250 },
  ]
  for (const L of layers) {
    for (let i = 0; i < L.n; i++) {
      const x = r() * size
      const y = r() * size
      // yon: hafif yatik ama genel olarak rastgele; kisa gorunur cunku yukaridan bakiliyor
      const a = r() * Math.PI * 2
      const len = (L.len[0] + r() * (L.len[1] - L.len[0])) * pxPerM
      const w = (L.w[0] + r() * (L.w[1] - L.w[0])) * pxPerM
      const base = L.col[Math.floor(r() * L.col.length)]
      const j = 0.82 + r() * 0.3
      const rgb = `rgb(${(base[0] * j) | 0},${(base[1] * j) | 0},${(base[2] * j) | 0})`
      const dx = Math.cos(a) * len
      const dy = Math.sin(a) * len
      const hv = Math.min(255, L.hv * (0.85 + r() * 0.25)) | 0
      // kenarlara tasan yapraklar karsi kenara da cizilir: dikissiz karo
      for (const ox of [0, -size, size]) {
        if ((ox < 0 && x < size - len) || (ox > 0 && x > len)) continue
        for (const oy of [0, -size, size]) {
          if ((oy < 0 && y < size - len) || (oy > 0 && y > len)) continue
          const x0 = x + ox
          const y0 = y + oy
          c.strokeStyle = rgb
          c.lineWidth = w
          c.lineCap = 'round'
          c.beginPath()
          c.moveTo(x0, y0)
          c.lineTo(x0 + dx, y0 + dy)
          c.stroke()
          // parlak orta damar: yapraga hacim hissi
          c.strokeStyle = `rgba(200,230,150,${0.08 + r() * 0.1})`
          c.lineWidth = w * 0.35
          c.beginPath()
          c.moveTo(x0 + dx * 0.2, y0 + dy * 0.2)
          c.lineTo(x0 + dx * 0.9, y0 + dy * 0.9)
          c.stroke()
          h.strokeStyle = `rgb(${hv},${hv},${hv})`
          h.lineWidth = w
          h.lineCap = 'round'
          h.beginPath()
          h.moveTo(x0, y0)
          h.lineTo(x0 + dx, y0 + dy)
          h.stroke()
        }
      }
    }
  }
  return { color, height }
}

// RGBA baytlari: RGB renk, A yukseklik. Uretici (tools/bake-grass.mjs) ve yedek yol bunu kullanir.
export const GRASS_TILE_SIZE = 1024
export function paintTileBytes(size = GRASS_TILE_SIZE): Uint8ClampedArray {
  const { color, height } = paintTile(size)
  const ci = color.getContext('2d')!.getImageData(0, 0, size, size)
  const hi = height.getContext('2d')!.getImageData(0, 0, size, size)
  for (let i = 0; i < ci.data.length; i += 4) ci.data[i + 3] = hi.data[i]
  return ci.data
}

let cached: THREE.Texture | null = null
// onceden pisirilmis baytlari (public/textures/grass/tile.bin) kaydeder; yoksa calisma aninda uretilir
export function setBakedGrassTile(data: Uint8Array) {
  cached = makeTileTexture(data, GRASS_TILE_SIZE)
}

function makeTileTexture(data: Uint8Array | Uint8ClampedArray, size: number): THREE.Texture {
  const tex = new THREE.DataTexture(data as Uint8Array, size, size, THREE.RGBAFormat)
  tex.colorSpace = THREE.NoColorSpace // renk donusumu shader'da (A kanali dogrusal kalmali)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 16
  tex.flipY = false
  tex.needsUpdate = true
  return tex
}

export function grassTileTexture(): THREE.Texture {
  if (cached) return cached
  cached = makeTileTexture(paintTileBytes(), GRASS_TILE_SIZE)
  return cached
}
