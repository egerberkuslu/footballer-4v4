import * as THREE from 'three'
import { PITCH_L, PITCH_W, PLATE_L, PLATE_W, paintPitch } from '../pitch'
import { grassNoiseTexture } from './grassNoise'
import { GRASS_TILE_M, grassTileTexture } from './grassTexture'

// Zemin ve yapraklarin ORTAK uniform'lari: ayni nesneler iki materyale de baglanir.
export const BAND = PITCH_L / 10 // bicme bandi genisligi (m)
// yaprak LOD mesafeleri (kameradan 3B uzaklik, m): yakin katman NEAR.y'de, orta MID.y'de biter
export const NEAR = new THREE.Vector2(8.0, 11.0)
export const MID = new THREE.Vector2(17.0, 24.0)

let maskTex: THREE.Texture | null = null
function pitchMask(): THREE.Texture {
  if (!maskTex) {
    const t = new THREE.CanvasTexture(paintPitch())
    t.colorSpace = THREE.NoColorSpace
    t.flipY = false
    t.anisotropy = 16
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    maskTex = t
  }
  return maskTex
}

// onceden pisirilmis saha maskesini (public/textures/grass/pitch.png) kaydeder
export function setBakedPitchMask(img: ImageBitmap) {
  const t = new THREE.Texture(img)
  t.colorSpace = THREE.NoColorSpace
  t.flipY = false
  t.anisotropy = 16
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.needsUpdate = true
  maskTex = t
}

export const grassUniforms = {
  uGrassTile: { value: null as THREE.Texture | null },
  uPitchMask: { value: null as THREE.Texture | null },
  uNoise: { value: null as THREE.Texture | null },
  uPlate: { value: new THREE.Vector2(PLATE_L, PLATE_W) },
  uPitch: { value: new THREE.Vector2(PITCH_L, PITCH_W) },
  uBand: { value: BAND },
  uTime: { value: 0 },
  uNearF: { value: NEAR },
  uMidF: { value: MID },
}

export function initGrassUniforms() {
  const u = grassUniforms
  if (!u.uGrassTile.value) u.uGrassTile.value = grassTileTexture()
  if (!u.uPitchMask.value) u.uPitchMask.value = pitchMask()
  if (!u.uNoise.value) u.uNoise.value = grassNoiseTexture()
  return u
}

// Ortak GLSL. Gurultuler pisirilmis dokudan okunur (fbm hesabi yok).
export const GRASS_COMMON = /* glsl */ `
uniform sampler2D uGrassTile;
uniform sampler2D uPitchMask;
uniform sampler2D uNoise;
uniform vec2 uPlate;
uniform vec2 uPitch;
uniform float uBand;
uniform float uTime;
uniform vec2 uNearF;
uniform vec2 uMidF;
#define GRASS_TILE_M ${GRASS_TILE_M.toFixed(3)}

// p: hucre biriminde (karo = 8 hucre). Vertex'te de calissin diye Lod 0
vec4 gN(vec2 p) { return textureLod(uNoise, p * 0.125, 0.0); }
vec2 gRot(vec2 p, float a) { float c = cos(a); float s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

// iki olcek + uzamsal karisim: karo tekrari gorunmez
vec4 gTile(vec2 w) {
  vec4 a = texture(uGrassTile, w / GRASS_TILE_M);
  vec4 b = texture(uGrassTile, gRot(w, 1.13) / (GRASS_TILE_M * 2.63) + 0.37);
  return mix(a, b, 0.3 + 0.4 * gN(w * 0.31).a);
}
vec4 gTileLod(vec2 w, float lod) {
  vec4 a = textureLod(uGrassTile, w / GRASS_TILE_M, lod);
  vec4 b = textureLod(uGrassTile, gRot(w, 1.13) / (GRASS_TILE_M * 2.63) + 0.37, lod);
  return mix(a, b, 0.3 + 0.4 * gN(w * 0.31).a);
}

// bicme bandi isareti (+1/-1, kenarlar yumusak); yaprak egilme yonu (0, s)
float gBandSign(float x) {
  float f = fract((x + 0.5 * uPitch.x) / (2.0 * uBand) + 0.25);
  float tri = abs(f * 2.0 - 1.0);
  return clamp((tri - 0.5) * uBand / 0.03, -1.0, 1.0);
}
float gInPlate(vec2 w) {
  vec2 d = abs(w) - 0.5 * uPitch - 1.5;
  return 1.0 - smoothstep(0.0, 2.0, max(d.x, d.y));
}

// yaprak ortusu (kameraya 3B uzakliga gore): zemin, yapraklarin altinda kalan dip gibi koyulur
float gCover(float d3) {
  float n = 1.0 - smoothstep(uNearF.x, uNearF.y, d3);
  float m = 1.0 - smoothstep(uMidF.x, uMidF.y, d3);
  return max(n * n, 0.3 * m * m);
}

// macro renk + asinma + boya. tex: gTile sonucu (rgb sRGB, a yukseklik).
// aa: piksel basina metre (uzakta yuksek frekansli gurultu ve yirtik kenarlar kapanir)
// k: gurultu/doku ile boya sapmasi (zemin 1.0; yapraklarda 0: boya yalniz kok noktasindaki maske, cizgi disina beyaz benek saçilmaz)
vec3 gAlbedo(vec2 w, vec4 tex, vec3 camPos, float aa, float k, out float paint) {
  vec3 col = pow(tex.rgb, vec3(2.2));
  float h = tex.a;
  vec4 nA = gN(w * 0.09);
  vec4 nB = gN(w * 0.37 + 7.3);
  col *= mix(0.78, 1.16, nA.r);
  col = mix(col, col * vec3(1.35, 1.12, 0.62), smoothstep(0.58, 0.9, nB.g) * 0.45);

  // bicme bantlari: yapragin yatis yonune gore acik/koyu (bakis yonune bagli)
  float s = gBandSign(w.x);
  vec2 d = normalize(w - camPos.xz + 1e-4);
  col *= 1.0 + (0.06 * s + 0.24 * s * d.y) * gInPlate(w);

  vec2 pu = (w + 0.5 * uPlate) / uPlate;
  vec4 mk = texture(uPitchMask, pu);
  // asinma: once alcak yaprak bolgeleri kurur, yer yer topraga doner
  float wn = gN(w * 2.3 + 1.7).g;
  float dry = smoothstep(0.1, 0.6, mk.g + (wn - 0.5) * 0.35);
  float soil = smoothstep(0.45, 0.95, mk.g * 1.25 - h * 0.45 + (wn - 0.5) * 0.5);
  float wn2 = gN(w * 13.0).a * 0.6 + gN(w * 3.7).b * 0.4;
  soil *= smoothstep(0.35, 0.7, wn2 + (1.0 - h) * 0.35);
  col = mix(col, col * vec3(1.6, 1.15, 0.5) + vec3(0.03, 0.02, 0.0), dry * 0.6 * mix(0.6, 1.0, k));
  col = mix(col, vec3(0.19, 0.125, 0.065) * mix(0.75, 1.25, h), soil * 0.75);

  // cizgi boyasi: yapraklara puskurtulmus, kenarlari cim dokusuyla yirtik, yer yer silik
  float sharp = 1.0 - smoothstep(0.015, 0.06, aa);
  float raw = mk.r + ((h - 0.5) * 0.5 + (gN(w * 11.0).a - 0.5) * 0.3) * sharp * k;
  paint = mix(mk.r, smoothstep(0.3, 0.72, raw), sharp);
  paint *= mix(0.6, 1.0, smoothstep(0.25, 0.7, gN(w * 0.8 + 11.0).r)) * (1.0 - soil * 0.6);
  vec3 paintCol = vec3(0.70, 0.72, 0.66) * mix(0.72, 1.05, h);

  // AgX ton eslemesi doygunlugu dusurur: albedoyu hafif doygunlastir, sari-yesile cek
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(lum), col, 1.18) * vec3(1.04, 1.0, 0.88), 0.0);
  return mix(col, paintCol, paint);
}
`

// Yonlu isikta yari saydamlik + sarmalanmis diffuz (yalniz yapraklar). Golge directLight.color'da hazir.
export function patchBladeLighting(frag: string): string {
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
    'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
    /* glsl */ `float dotNL = saturate( (dot( geometryNormal, directLight.direction ) + 0.35) / 1.35 );
    float gBack = pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 3.0 );
    reflectedLight.directDiffuse += directLight.color * material.diffuseColor * vec3( 0.85, 1.15, 0.45 )
      * ( 0.08 + 0.55 * gBack ) * clamp( vGT, 0.0, 1.0 ) * ( 1.0 - 0.85 * vGPaint );`,
  )
  return frag.replace('#include <lights_physical_pars_fragment>', chunk)
}
