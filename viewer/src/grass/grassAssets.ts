import { asset } from '../assetUrl'
import { trackAsync } from '../ui/loadTracker'
import { setBakedGrassNoise } from './grassNoise'
import { GRASS_TILE_SIZE, setBakedGrassTile } from './grassTexture'
import { setBakedPitchMask } from './grassGlsl'

// Cim dokulari onceden pisirilmistir (tools/bake-grass.mjs → public/textures/grass/*).
// Yuklenemezse ilk kullanimda calisma aninda uretilir (yedek yol, eski davranis).
async function getBytes(name: string, expect: number): Promise<Uint8Array | null> {
  try {
    const r = await fetch(asset(`textures/grass/${name}`))
    if (!r.ok) return null
    const b = new Uint8Array(await r.arrayBuffer())
    return b.length === expect ? b : null
  } catch {
    return null
  }
}

let promise: Promise<void> | null = null
export function loadGrassAssets(): Promise<void> {
  if (!promise) {
    promise = trackAsync('cim-doku', 'Çim dokuları', async () => {
      const [tile, noise, pitch] = await Promise.all([
        getBytes('tile.bin', GRASS_TILE_SIZE * GRASS_TILE_SIZE * 4),
        getBytes('noise.bin', 256 * 256 * 4),
        fetch(asset('textures/grass/pitch.png'))
          .then((r) => (r.ok ? r.blob() : null))
          .then((b) => (b ? createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : null))
          .catch(() => null),
      ])
      if (tile) setBakedGrassTile(tile)
      if (noise) setBakedGrassNoise(noise)
      if (pitch) setBakedPitchMask(pitch)
    }, 1).catch(() => undefined)
  }
  return promise
}
