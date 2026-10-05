import * as THREE from 'three'

// Onceden pisirilmis dikissiz gurultu: shader'daki fbm hesaplarinin yerine tek doku okumasi.
// Karo basina 8 hucre. R,G = 4 oktav fbm (farkli tohum), B = 2 oktav, A = tek oktav deger gurultusu.
const SIZE = 256
const CELLS = 8

function lattice(seed: number, period: number): Float32Array {
  const a = new Float32Array(period * period)
  let s = seed >>> 0
  for (let i = 0; i < a.length; i++) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0
    s ^= s >>> 12
    a[i] = (s >>> 0) / 4294967296
  }
  return a
}

// periyodik deger gurultusu, p hucre biriminde
function valueNoise(lat: Float32Array, period: number, x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const m = (v: number) => ((v % period) + period) % period
  const x0 = m(xi)
  const x1 = m(xi + 1)
  const y0 = m(yi)
  const y1 = m(yi + 1)
  const a = lat[y0 * period + x0]
  const b = lat[y0 * period + x1]
  const c = lat[y1 * period + x0]
  const d = lat[y1 * period + x1]
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

export const GRASS_NOISE_SIZE = SIZE

function makeNoiseTexture(data: Uint8Array): THREE.DataTexture {
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.colorSpace = THREE.NoColorSpace
  t.needsUpdate = true
  return t
}

let cached: THREE.DataTexture | null = null
// onceden pisirilmis baytlari (public/textures/grass/noise.bin) kaydeder
export function setBakedGrassNoise(data: Uint8Array) {
  cached = makeNoiseTexture(data)
}

export function grassNoiseTexture(): THREE.DataTexture {
  if (cached) return cached
  cached = makeNoiseTexture(paintNoiseBytes())
  return cached
}

// RGBA baytlari (uretici betik ve yedek yol)
export function paintNoiseBytes(): Uint8Array {
  const data = new Uint8Array(SIZE * SIZE * 4)
  // kafes dizilerini her pikselde yeniden uretmemek icin onbellekle
  const lats = new Map<string, Float32Array>()
  const getLat = (seed: number, cells: number) => {
    const k = seed + ':' + cells
    let l = lats.get(k)
    if (!l) lats.set(k, (l = lattice(seed, cells)))
    return l
  }
  const fb = (seed: number, octaves: number, u: number, v: number) => {
    let sum = 0
    let amp = 0.5
    let norm = 0
    let cells = CELLS
    for (let o = 0; o < octaves; o++) {
      sum += amp * valueNoise(getLat(seed + o * 101, cells), cells, u * cells, v * cells)
      norm += amp
      amp *= 0.5
      cells *= 2
    }
    return sum / norm
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE
      const v = y / SIZE
      const i = (y * SIZE + x) * 4
      data[i] = Math.round(fb(11, 4, u, v) * 255)
      data[i + 1] = Math.round(fb(37, 4, u, v) * 255)
      data[i + 2] = Math.round(fb(73, 2, u, v) * 255)
      data[i + 3] = Math.round(fb(97, 1, u, v) * 255)
    }
  }
  return data
}
