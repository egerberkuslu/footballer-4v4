// Formalar: takim basina paylasilan malzemeler (draw call), dikey cizgiler golgelendiricide
// bagli (bind) uzay x'ine gore cizilir -> UV duzeninden bagimsiz. Sirt numarasi: ortak atlas dokusu.
import { asset } from '../assetUrl'
import * as THREE from 'three'

export type KitId = 'home' | 'homeGK' | 'away' | 'awayGK' | 'ref'

interface KitDef {
  a: string // forma ana renk
  b: string // cizgi rengi (a ile ayniysa cizgi yok)
  stripeW: number // cizgi periyodu (model birimi, m)
  shorts: string
  socks: string
}

export const KITS: Record<KitId, KitDef> = {
  home: { a: '#b80f22', b: '#f2b705', stripeW: 0.17, shorts: '#f1f1ee', socks: '#b80f22' },
  homeGK: { a: '#1d8a3c', b: '#1d8a3c', stripeW: 0, shorts: '#16301f', socks: '#1d8a3c' },
  away: { a: '#16224a', b: '#16224a', stripeW: 0, shorts: '#141d3d', socks: '#16224a' },
  awayGK: { a: '#ee7414', b: '#ee7414', stripeW: 0, shorts: '#1b1b1b', socks: '#ee7414' },
  ref: { a: '#121212', b: '#121212', stripeW: 0, shorts: '#0e0e0e', socks: '#111111' },
}

export type Slot = 'jersey' | 'shorts' | 'socks' | null

/** E'nin tek malzemeli kiyafet atlasi (forma+sort+tozluk+krampon): takim varyanti doku degisimiyle */
export const isKitAtlas = (name: string) => /kiyafet|kit_atlas/i.test(name)
const KIT_FILE: Record<KitId, string> = { home: 'home', homeGK: 'gk_home', away: 'away', awayGK: 'gk_away', ref: 'ref' }
// sirt numarasi adasi, glTF UV (human/kit_layout.json numara_uv_gltf): sol ust (u0,v0) sag alt (u1,v1)
const KIT_BIAS = Number(new URLSearchParams(location.search).get('kitbias') ?? 0)
const NUM_RECT = new THREE.Vector4(0.7, 0.605, 0.89, 0.795)

/** malzeme adindan forma parcasi */
export function slotOf(name: string): Slot {
  if (/forma|jersey|shirt|sleeve/i.test(name)) return 'jersey'
  if (/sort|short/i.test(name)) return 'shorts'
  if (/tozluk|sock/i.test(name)) return 'socks'
  return null
}

// dokunun ortalama parlakligi (detay katsayisi normalize edilir)
function meanLum(tex: THREE.Texture | null | undefined): number {
  const img = tex?.image as CanvasImageSource | undefined
  if (!img) return 0.5
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 16
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0, 16, 16)
    const d = g.getImageData(0, 0, 16, 16).data
    let s = 0
    for (let i = 0; i < d.length; i += 4) s += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
    // sRGB -> yaklasik dogrusal
    return Math.max(0.05, Math.pow(s / (d.length / 4), 2.2))
  } catch {
    return 0.5
  }
}

/** kaynak malzemeyi forma rengine cevirir (doku varsa yalniz parlaklik detayi kalir) */
function kitMaterial(base: THREE.Material, a: string, b: string, w: number): THREE.Material {
  const m = base.clone() as THREE.MeshStandardMaterial
  m.color = new THREE.Color(1, 1, 1)
  const uA = { value: new THREE.Color(a) }
  const uB = { value: new THREE.Color(b) }
  const uW = { value: w }
  const uMean = { value: meanLum(m.map) }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uKitA = uA
    sh.uniforms.uKitB = uB
    sh.uniforms.uKitW = uW
    sh.uniforms.uKitMean = uMean
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKitPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKitPos = position;')
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vKitPos;\nuniform vec3 uKitA;\nuniform vec3 uKitB;\nuniform float uKitW;\nuniform float uKitMean;',
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
#ifdef USE_MAP
  vec4 kitTex = texture2D(map, vMapUv);
  float kitD = clamp(dot(kitTex.rgb, vec3(0.299, 0.587, 0.114)) / uKitMean, 0.55, 1.3);
#else
  float kitD = 1.0;
#endif
  float kitS = 0.0;
  if (uKitW > 0.0) {
    // dikey cizgi: ucgen dalga + kenar yumusatma
    float q = vKitPos.x / uKitW;
    float tri = abs(fract(q) - 0.5) * 2.0;
    float aa = max(fwidth(q) * 2.0, 0.02);
    kitS = smoothstep(0.5 - aa, 0.5 + aa, tri);
  }
  diffuseColor.rgb *= mix(uKitA, uKitB, kitS) * kitD;
`,
      )
  }
  m.customProgramCacheKey = () => 'kit'
  return m
}

/** kaynak malzeme + kit -> paylasilan malzeme onbellegi */
export class KitMaterials {
  private cache = new Map<string, THREE.Material>()

  get(base: THREE.Material, kit: KitId, slot: Exclude<Slot, null>): THREE.Material {
    const key = `${base.uuid}|${kit}|${slot}`
    let m = this.cache.get(key)
    if (!m) {
      const k = KITS[kit]
      m =
        slot === 'jersey' ? kitMaterial(base, k.a, k.b, k.stripeW)
        : slot === 'shorts' ? kitMaterial(base, k.shorts, k.shorts, 0)
        : kitMaterial(base, k.socks, k.socks, 0)
      this.cache.set(key, m)
    }
    return m
  }

  private tex = new Map<string, THREE.Texture>()

  /** ten / sac tonu: renk carpani, varyant basina paylasilan malzeme */
  tint(base: THREE.Material, tone: string): THREE.Material {
    if (tone === '#ffffff') return base
    const key = `${base.uuid}|tint|${tone}`
    let m = this.cache.get(key)
    if (!m) {
      const c = (base as THREE.MeshStandardMaterial).clone()
      c.color.multiply(new THREE.Color(tone))
      this.cache.set(key, (m = c))
    }
    return m
  }

  /** kaleci eldiveni: govde malzemesinde el/parmak kemigine bagli koseler renklenir (aGlove niteligi) */
  glove(base: THREE.Material, kit: KitId, tone = '#ffffff'): THREE.Material {
    const key = `${base.uuid}|${kit}|glove|${tone}`
    let m = this.cache.get(key)
    if (m) return m
    const g = (base as THREE.MeshStandardMaterial).clone()
    g.color.set(tone)
    const uGlove = { value: new THREE.Color(kit === 'homeGK' ? '#e9ece4' : '#1c1c1e') }
    const uAccent = { value: new THREE.Color(KITS[kit].a) }
    g.onBeforeCompile = (sh) => {
      sh.uniforms.uGlove = uGlove
      sh.uniforms.uGloveAccent = uAccent
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlove;\nvarying float vGlove;\nvarying vec3 vGlovePos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlove = aGlove;\nvGlovePos = position;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlove;\nvarying vec3 vGlovePos;\nuniform vec3 uGlove;\nuniform vec3 uGloveAccent;')
        .replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
  {
    float gw = smoothstep(0.45, 0.7, vGlove);
    // bilekte takim renginde manset
    float cuff = smoothstep(0.45, 0.55, vGlove) * (1.0 - smoothstep(0.62, 0.75, vGlove));
    vec3 gc = mix(uGlove, uGloveAccent, cuff);
    diffuseColor.rgb = mix(diffuseColor.rgb, gc * (0.8 + 0.2 * dot(diffuseColor.rgb, vec3(0.33))), gw);
  }
`,
        )
    }
    g.customProgramCacheKey = () => 'kit-glove'
    this.cache.set(key, g)
    return g
  }

  private waiting = new Map<string, THREE.MeshStandardMaterial[]>()

  /** atlas dokusu: public/kits/<varyant>.png; yuklenene kadar malzeme GLB'deki dokuyla kalir */
  private kitTexture(kit: KitId, variant: number, like: THREE.Texture | null, m: THREE.MeshStandardMaterial) {
    const key = `${variant}|${kit}`
    const t = this.tex.get(key)
    if (t) {
      if (t.image) m.map = t
      else this.waiting.get(key)!.push(m)
      return
    }
    const list = [m]
    this.waiting.set(key, list)
    const nt = new THREE.TextureLoader().load(asset(`kits/${variant === 0 ? '' : `v${variant + 1}/`}${KIT_FILE[kit]}.png`), () => {
      for (const x of list) x.map = nt
      list.length = 0
    })
    nt.flipY = false
    nt.colorSpace = THREE.SRGBColorSpace
    nt.generateMipmaps = true
    nt.minFilter = THREE.LinearMipmapLinearFilter
    nt.anisotropy = 8
    if (like) {
      nt.wrapS = like.wrapS
      nt.wrapT = like.wrapT
      nt.anisotropy = Math.max(8, like.anisotropy)
    }
    this.tex.set(key, nt)
  }

  /** oyuncu basina atlas malzemesi: ayni program, takim dokusu + sirt numarasi golgelendiricide */
  atlas(base: THREE.Material, kit: KitId, number: number | null, variant = 0): THREE.Material {
    const b = base as THREE.MeshStandardMaterial
    const m = b.clone()
    // COLOR_0 kumas pin agirligi (N); renge karismasin
    m.vertexColors = false
    this.kitTexture(kit, variant, b.map, m)
    const uNum = { value: number === null ? -1 : Math.max(0, Math.min(CELLS * CELLS - 1, number)) }
    const uRect = { value: NUM_RECT }
    const uTex = { value: numberAtlas() }
    const uBias = { value: KIT_BIAS }
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNum = uNum
      sh.uniforms.uNumRect = uRect
      sh.uniforms.uNumTex = uTex
      sh.uniforms.uKitBias = uBias
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNum;\nuniform vec4 uNumRect;\nuniform sampler2D uNumTex;\nuniform float uKitBias;')
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
#ifdef USE_MAP
  // mip yanlilik: ince kumas (balik sirti) dokusu yumusar, cizgi ve arma korunur
  diffuseColor *= texture2D(map, vMapUv, uKitBias);
  if (uNum >= 0.0) {
    vec2 nr = (vMapUv - uNumRect.xy) / (uNumRect.zw - uNumRect.xy);
    if (nr.x >= 0.0 && nr.x <= 1.0 && nr.y >= 0.0 && nr.y <= 1.0) {
      float ncx = mod(uNum, ${CELLS}.0);
      float ncy = floor(uNum / ${CELLS}.0);
      vec4 nt = texture2D(uNumTex, vec2((ncx + nr.x) / ${CELLS}.0, 1.0 - (ncy + nr.y) / ${CELLS}.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, nt.rgb, nt.a);
    }
  }
#endif
`,
        )
    }
    m.customProgramCacheKey = () => 'kit-atlas'
    this.cache.set(`${m.uuid}|atlas`, m)
    return m
  }

  dispose() {
    this.cache.forEach((m) => m.dispose())
    this.cache.clear()
    this.tex.forEach((t) => t.dispose())
    this.tex.clear()
  }
}

// --- sirt numarasi atlasi: 8x8 hucre, 0..63 ---
const CELLS = 8
let atlas: THREE.CanvasTexture | null = null

function numberAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas
  const S = 1024
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const cs = S / CELLS
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `bold ${cs * 0.78}px "Arial Narrow", Arial, sans-serif`
  g.lineJoin = 'round'
  for (let n = 0; n < CELLS * CELLS; n++) {
    const x = (n % CELLS) * cs + cs / 2
    const y = Math.floor(n / CELLS) * cs + cs / 2 + cs * 0.04
    g.lineWidth = cs * 0.07
    g.strokeStyle = 'rgba(10,10,14,0.9)'
    g.strokeText(String(n), x, y)
    g.fillStyle = '#f7f7f2'
    g.fillText(String(n), x, y)
  }
  atlas = new THREE.CanvasTexture(c)
  atlas.colorSpace = THREE.SRGBColorSpace
  atlas.anisotropy = 4
  return atlas
}

let numMat: THREE.MeshStandardMaterial | null = null
export function numberMaterial() {
  if (!numMat) {
    numMat = new THREE.MeshStandardMaterial({
      map: numberAtlas(),
      transparent: true,
      alphaTest: 0.35,
      roughness: 0.75,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      depthWrite: false,
    })
  }
  return numMat
}

/** numara plakasi: hucreye gore UV; +z normalli duzlem (sirta yerlestirirken cevrilir) */
export function numberGeometry(n: number, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h)
  const cell = Math.max(0, Math.min(CELLS * CELLS - 1, n))
  const cx = cell % CELLS
  const cy = Math.floor(cell / CELLS)
  const uv = g.attributes.uv as THREE.BufferAttribute
  // hucrenin ortasindaki genislik kadarini kullan (en/boy orani korunur)
  const aspect = w / h
  for (let i = 0; i < uv.count; i++) {
    const u = (uv.getX(i) - 0.5) * aspect + 0.5
    const v = uv.getY(i)
    uv.setXY(i, (cx + u) / CELLS, 1 - (cy + 1 - v) / CELLS)
  }
  return g
}
