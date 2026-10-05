// GPU kumas cozucu (WebGL2, float dokulara cizim). Tum karakterlerin parcaciklari tek doku atlasinda.
// Kare basina: deri (skin) -> ongoru (Verlet + hava) -> N x Jacobi kisit -> normal. Her gecis tam ekran ucgen.
import * as THREE from 'three'

export const TW = 64 // doku genisligi (parcacik)
export const MAX_CH = 16
export const MAX_BONES = 64
export const N_CAPS = 10

/** paketlenmis statik veri (tum karakterler) */
export interface Packed {
  n: number
  rest: Float32Array // n*4: bind xyz, karakter (-1 bos)
  restN: Float32Array // n*4
  skinI: Float32Array // n*4
  skinW: Float32Array // n*4
  meta: Float32Array // n*4: pin, pinK, invMass, maxD(m)
  nbr: Float32Array[] // MAX_NBR/2 doku: (j, L, j, L)
  bend: Float32Array[] // MAX_BEND/2
  fan: Float32Array[] // MAX_FAN/2: (j,k,j,k)
  layer: Float32Array // n*4: alttaki sort parcacigi, en az aralik (m)
}

export interface SolverParams {
  gravity: THREE.Vector3
  wind: THREE.Vector3
  damp: number // 1/s
  aeroN: number // normal yonde karesel hava direnci
  aeroT: number // tegetsel dogrusal
  stretch: number
  bendK: number
  omega: number
  iters: number
  back: number // derinin icine izin (m)
  thick: number // kapsul payi (m)
}

const HEAD = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
const int TW = ${TW};
ivec2 tc(float i) { int k = int(i + 0.5); return ivec2(k % TW, k / TW); }
`
const VS = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const SKIN_FS = /* glsl */ `${HEAD}
uniform sampler2D uRest, uRestN, uSkinI, uSkinW, uBones;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oNor;
mat4 bone(int ch, float j) {
  int b = int(j + 0.5) * 4;
  return mat4(texelFetch(uBones, ivec2(b, ch), 0), texelFetch(uBones, ivec2(b + 1, ch), 0),
              texelFetch(uBones, ivec2(b + 2, ch), 0), texelFetch(uBones, ivec2(b + 3, ch), 0));
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 r = texelFetch(uRest, c, 0);
  if (r.w < -0.5) { oPos = vec4(0.0); oNor = vec4(0.0, 1.0, 0.0, 0.0); return; }
  int ch = int(r.w + 0.5);
  vec4 si = texelFetch(uSkinI, c, 0);
  vec4 sw = texelFetch(uSkinW, c, 0);
  mat4 M = sw.x * bone(ch, si.x) + sw.y * bone(ch, si.y) + sw.z * bone(ch, si.z) + sw.w * bone(ch, si.w);
  oPos = vec4((M * vec4(r.xyz, 1.0)).xyz, 1.0);
  vec3 n = mat3(M) * texelFetch(uRestN, c, 0).xyz;
  oNor = vec4(n / max(length(n), 1e-6), 0.0);
}
`

const PREDICT_FS = /* glsl */ `${HEAD}
uniform sampler2D uRest, uPrev, uCur, uTgt, uNS, uMeta;
uniform vec4 uChar[${MAX_CH}];
uniform float uDt, uDtPrev, uDamp, uAeroN, uAeroT, uTime;
uniform vec3 uGrav, uWind;
out vec4 oPos;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 r = texelFetch(uRest, c, 0);
  if (r.w < -0.5) { oPos = vec4(0.0); return; }
  int ch = int(r.w + 0.5);
  vec3 tgt = texelFetch(uTgt, c, 0).xyz;
  if (uChar[ch].x < 0.5) { oPos = vec4(tgt, 1.0); return; }
  vec3 x = texelFetch(uCur, c, 0).xyz;
  vec3 xp = texelFetch(uPrev, c, 0).xyz;
  vec3 vel = (x - xp) / uDtPrev;
  vel *= exp(-uDamp * uDt);
  // ruzgar + hafif esinti (konuma bagli faz)
  float ph = uTime * 1.7 + dot(x, vec3(0.9, 0.4, 1.3));
  vec3 wind = uWind * (0.75 + 0.25 * sin(ph) + 0.15 * sin(ph * 2.3 + 1.1));
  vec3 vr = vel - wind;
  vec3 n = texelFetch(uNS, c, 0).xyz;
  float vn = dot(vr, n);
  // normal yonde karesel direnc, ortulu (kararli) bicim
  float vn2 = vn / (1.0 + uAeroN * abs(vn) * uDt);
  vel -= n * (vn - vn2);
  vel = wind + (vel - wind) * exp(-uAeroT * uDt);
  vel += uGrav * uDt;
  float sp = length(vel);
  if (sp > 30.0) vel *= 30.0 / sp;
  vec3 o = x + vel * uDt;
  if (any(isnan(o)) || any(isinf(o)) || length(o - tgt) > 1.0) o = tgt;
  oPos = vec4(o, 1.0);
}
`

const ITER_FS = /* glsl */ `${HEAD}
uniform sampler2D uRest, uRestN, uPos, uTgt, uTN, uMeta, uCaps;
uniform sampler2D uNbr0, uNbr1, uNbr2, uNbr3, uBend0, uBend1, uLayer, uNS;
uniform vec4 uChar[${MAX_CH}];
uniform float uStretch, uBendK, uOmega, uBack, uThick;
out vec4 oPos;
vec3 X; float WI; vec3 SUM; float CNT;
void cons(float j, float L, float k) {
  if (j < -0.5) return;
  ivec2 cj = tc(j);
  vec3 xj = texelFetch(uPos, cj, 0).xyz;
  float wj = texelFetch(uMeta, cj, 0).z;
  vec3 d = X - xj;
  float len = length(d);
  float ws = WI + wj;
  if (len < 1e-6 || ws <= 0.0) return;
  SUM -= (WI / ws) * (len - L) * (d / len) * k;
  CNT += 1.0;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 r = texelFetch(uRest, c, 0);
  if (r.w < -0.5) { oPos = vec4(0.0); return; }
  int ch = int(r.w + 0.5);
  vec3 tgt = texelFetch(uTgt, c, 0).xyz;
  if (uChar[ch].x < 0.5) { oPos = vec4(tgt, 1.0); return; }
  vec4 m = texelFetch(uMeta, c, 0);
  X = texelFetch(uPos, c, 0).xyz;
  WI = m.z; SUM = vec3(0.0); CNT = 0.0;
  vec4 a;
  a = texelFetch(uNbr0, c, 0); cons(a.x, a.y, uStretch); cons(a.z, a.w, uStretch);
  a = texelFetch(uNbr1, c, 0); cons(a.x, a.y, uStretch); cons(a.z, a.w, uStretch);
  a = texelFetch(uNbr2, c, 0); cons(a.x, a.y, uStretch); cons(a.z, a.w, uStretch);
  a = texelFetch(uNbr3, c, 0); cons(a.x, a.y, uStretch); cons(a.z, a.w, uStretch);
  a = texelFetch(uBend0, c, 0); cons(a.x, a.y, uBendK); cons(a.z, a.w, uBendK);
  a = texelFetch(uBend1, c, 0); cons(a.x, a.y, uBendK); cons(a.z, a.w, uBendK);
  vec3 x = X + SUM * (uOmega / max(CNT, 1.0));
  // deriye yay (pin)
  x = mix(x, tgt, m.y);
  // arka dayanak: derinin icine girme
  vec3 tn = texelFetch(uTN, c, 0).xyz;
  float dn = dot(x - tgt, tn);
  if (dn < -uBack) x += tn * (-uBack - dn);
  // govde/kol/bacak kapsulleri (forma: B.w dis yaricap, sortun ustunden gecer)
  bool forma = texelFetch(uRestN, c, 0).w < 0.5;
  for (int q = 0; q < ${N_CAPS}; q++) {
    vec4 A = texelFetch(uCaps, ivec2(q * 2, ch), 0);
    if (A.w <= 0.0) continue;
    vec4 Bv = texelFetch(uCaps, ivec2(q * 2 + 1, ch), 0);
    vec3 B = Bv.xyz;
    vec3 ab = B - A.xyz;
    float t = clamp(dot(x - A.xyz, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    vec3 p = A.xyz + ab * t;
    vec3 e = x - p;
    float el = length(e);
    float rr = (forma ? max(A.w, Bv.w) : max(A.w, Bv.w)) + uThick;
    if (el < rr) x = el > 1e-5 ? p + e * (rr / el) : x + tn * (rr - el);
  }
  // katman: forma, alttaki sortun yuzeyinin disinda (sort normali yonunde) kalir
  vec4 ly = texelFetch(uLayer, c, 0);
  if (ly.x > -0.5) {
    ivec2 cs = tc(ly.x);
    vec3 ns = texelFetch(uNS, cs, 0).xyz;
    float dd = dot(x - texelFetch(uPos, cs, 0).xyz, ns);
    if (dd < ly.y) x += ns * min(ly.y - dd, 0.03);
  }
  // bag (tether) siniri en son: pinli bolge (yaka) kapsulle disari itilmez
  // zemin once (hedef zeminin altindaysa kumas hedefle birlikte kalir), sonra bag siniri: sapma <= 0.15 m
  x.y = max(x.y, min(0.008, tgt.y));
  vec3 d = x - tgt;
  float dl = length(d);
  float mx = min(m.w, 0.15);
  if (dl > mx) x = tgt + d * (mx / dl);
  if (any(isnan(x)) || any(isinf(x))) x = tgt;
  oPos = vec4(x, 1.0);
}
`

const NORMAL_FS = /* glsl */ `${HEAD}
uniform sampler2D uRest, uPos, uTgt, uTN, uFan0, uFan1, uFan2;
layout(location = 0) out vec4 oNS;
layout(location = 1) out vec4 oNT;
vec3 P, T, NS, NT;
void tri(float j, float k) {
  if (j < -0.5 || k < -0.5) return;
  ivec2 cj = tc(j); ivec2 ck = tc(k);
  NS += cross(texelFetch(uPos, cj, 0).xyz - P, texelFetch(uPos, ck, 0).xyz - P);
  NT += cross(texelFetch(uTgt, cj, 0).xyz - T, texelFetch(uTgt, ck, 0).xyz - T);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 r = texelFetch(uRest, c, 0);
  if (r.w < -0.5) { oNS = vec4(0.0, 1.0, 0.0, 0.0); oNT = oNS; return; }
  P = texelFetch(uPos, c, 0).xyz; T = texelFetch(uTgt, c, 0).xyz;
  NS = vec3(0.0); NT = vec3(0.0);
  vec4 a;
  a = texelFetch(uFan0, c, 0); tri(a.x, a.y); tri(a.z, a.w);
  a = texelFetch(uFan1, c, 0); tri(a.x, a.y); tri(a.z, a.w);
  a = texelFetch(uFan2, c, 0); tri(a.x, a.y); tri(a.z, a.w);
  vec3 tn = texelFetch(uTN, c, 0).xyz;
  float ls = length(NS), lt = length(NT);
  // yelpaze yoksa ya da cokmusse deri normali
  oNS = vec4(ls > 1e-9 ? NS / ls : tn, 0.0);
  oNT = vec4(lt > 1e-9 ? NT / lt : tn, 0.0);
}
`

function dataTex(data: Float32Array, w: number, h: number) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType)
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

function rt(w: number, h: number, count = 1) {
  return new THREE.WebGLRenderTarget(w, h, {
    count,
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  })
}

const mat = (fs: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false })

export class ClothSolver {
  readonly TH: number
  readonly bones: Float32Array // MAX_CH satir x MAX_BONES*4 texel
  readonly caps: Float32Array // MAX_CH satir x 32 texel
  readonly charState: THREE.Vector4[]
  private bonesTex: THREE.DataTexture
  private capsTex: THREE.DataTexture
  private statics: THREE.DataTexture[] = []
  private tgtRT: THREE.WebGLRenderTarget
  private nRT: THREE.WebGLRenderTarget
  private pos: THREE.WebGLRenderTarget[]
  private scene = new THREE.Scene()
  private quad: THREE.Mesh
  private cam = new THREE.Camera()
  private mSkin: THREE.RawShaderMaterial
  private mPred: THREE.RawShaderMaterial
  private mIter: THREE.RawShaderMaterial
  private mNorm: THREE.RawShaderMaterial
  private dtPrev = 1 / 60
  private time = 0

  readonly prm: SolverParams

  constructor(pk: Packed, prm: SolverParams) {
    this.prm = prm
    const TH = (this.TH = Math.max(1, Math.ceil(pk.n / TW)))
    const S = (a: Float32Array) => {
      const full = new Float32Array(TW * TH * 4)
      full.set(a.subarray(0, Math.min(a.length, full.length)))
      const t = dataTex(full, TW, TH)
      this.statics.push(t)
      return t
    }
    // bos texel'ler: rest.w = -1
    const restFull = new Float32Array(TW * TH * 4)
    for (let i = 0; i < TW * TH; i++) restFull[i * 4 + 3] = -1
    restFull.set(pk.rest)
    const tRest = dataTex(restFull, TW, TH)
    this.statics.push(tRest)
    const tRestN = S(pk.restN)
    const tSkinI = S(pk.skinI)
    const tSkinW = S(pk.skinW)
    const tMeta = S(pk.meta)
    const empty = (a: Float32Array) => {
      // bos komsu = -1
      const full = new Float32Array(TW * TH * 4).fill(-1)
      full.set(a)
      const t = dataTex(full, TW, TH)
      this.statics.push(t)
      return t
    }
    const tNbr = pk.nbr.map(empty)
    const tBend = pk.bend.map(empty)
    const tFan = pk.fan.map(empty)
    const tLayer = empty(pk.layer)

    this.bones = new Float32Array(MAX_CH * MAX_BONES * 4 * 4)
    this.bonesTex = dataTex(this.bones, MAX_BONES * 4, MAX_CH)
    this.caps = new Float32Array(MAX_CH * 32 * 4)
    this.capsTex = dataTex(this.caps, 32, MAX_CH)
    this.charState = Array.from({ length: MAX_CH }, () => new THREE.Vector4())

    this.tgtRT = rt(TW, TH, 2)
    this.nRT = rt(TW, TH, 2)
    this.pos = [rt(TW, TH), rt(TW, TH), rt(TW, TH), rt(TW, TH)]

    this.mSkin = mat(SKIN_FS, {
      uRest: { value: tRest },
      uRestN: { value: tRestN },
      uSkinI: { value: tSkinI },
      uSkinW: { value: tSkinW },
      uBones: { value: this.bonesTex },
    })
    this.mPred = mat(PREDICT_FS, {
      uRest: { value: tRest },
      uPrev: { value: null },
      uCur: { value: null },
      uTgt: { value: this.tgtRT.textures[0] },
      uNS: { value: this.nRT.textures[0] },
      uMeta: { value: tMeta },
      uChar: { value: this.charState },
      uDt: { value: 1 / 60 },
      uDtPrev: { value: 1 / 60 },
      uDamp: { value: prm.damp },
      uAeroN: { value: prm.aeroN },
      uAeroT: { value: prm.aeroT },
      uTime: { value: 0 },
      uGrav: { value: prm.gravity },
      uWind: { value: prm.wind },
    })
    this.mIter = mat(ITER_FS, {
      uRest: { value: tRest },
      uRestN: { value: tRestN },
      uPos: { value: null },
      uTgt: { value: this.tgtRT.textures[0] },
      uTN: { value: this.tgtRT.textures[1] },
      uMeta: { value: tMeta },
      uCaps: { value: this.capsTex },
      uNbr0: { value: tNbr[0] },
      uNbr1: { value: tNbr[1] },
      uNbr2: { value: tNbr[2] },
      uNbr3: { value: tNbr[3] },
      uBend0: { value: tBend[0] },
      uBend1: { value: tBend[1] },
      uLayer: { value: tLayer },
      uNS: { value: this.nRT.textures[0] },
      uChar: { value: this.charState },
      uStretch: { value: prm.stretch },
      uBendK: { value: prm.bendK },
      uOmega: { value: prm.omega },
      uBack: { value: prm.back },
      uThick: { value: prm.thick },
    })
    this.mNorm = mat(NORMAL_FS, {
      uRest: { value: tRest },
      uPos: { value: null },
      uTgt: { value: this.tgtRT.textures[0] },
      uTN: { value: this.tgtRT.textures[1] },
      uFan0: { value: tFan[0] },
      uFan1: { value: tFan[1] },
      uFan2: { value: tFan[2] },
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
    this.quad = new THREE.Mesh(g, this.mSkin)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  /** gorsel golgelendiricinin okudugu dokular */
  get posTex() {
    return this.pos[1].texture
  }
  get tgtTex() {
    return this.tgtRT.textures[0]
  }
  get nsTex() {
    return this.nRT.textures[0]
  }
  get ntTex() {
    return this.nRT.textures[1]
  }

  private pass(gl: THREE.WebGLRenderer, m: THREE.Material, target: THREE.WebGLRenderTarget) {
    this.quad.material = m
    gl.setRenderTarget(target)
    gl.render(this.scene, this.cam)
  }

  /** bir adim; dt=0 ise yalniz deri hedefi ve normaller tazelenir */
  step(gl: THREE.WebGLRenderer, dt: number) {
    this.bonesTex.needsUpdate = true
    this.capsTex.needsUpdate = true
    const prevRT = gl.getRenderTarget()
    const autoClear = gl.autoClear
    gl.autoClear = false
    this.pass(gl, this.mSkin, this.tgtRT)
    if (dt > 0) {
      this.time += dt
      const [prev, cur, a, b] = this.pos
      const u = this.mPred.uniforms
      u.uPrev.value = prev.texture
      u.uCur.value = cur.texture
      u.uDt.value = dt
      u.uDtPrev.value = this.dtPrev
      u.uTime.value = this.time
      this.pass(gl, this.mPred, a)
      let src = a
      let dst = b
      for (let i = 0; i < this.prm.iters; i++) {
        this.mIter.uniforms.uPos.value = src.texture
        this.pass(gl, this.mIter, dst)
        ;[src, dst] = [dst, src]
      }
      // yeni sira: onceki <- simdiki, simdiki <- sonuc
      this.pos = [cur, src, prev, dst]
      this.dtPrev = dt
    }
    this.mNorm.uniforms.uPos.value = this.pos[1].texture
    this.pass(gl, this.mNorm, this.nRT)
    gl.setRenderTarget(prevRT)
    gl.autoClear = autoClear
  }

  /** ayiklama: simdiki konum ve hedef (yavas; yalniz test) */
  read(gl: THREE.WebGLRenderer) {
    const n = TW * this.TH * 4
    const p = new Float32Array(n)
    const t = new Float32Array(n)
    gl.readRenderTargetPixels(this.pos[1], 0, 0, TW, this.TH, p)
    gl.readRenderTargetPixels(this.tgtRT, 0, 0, TW, this.TH, t)
    return { p, t }
  }

  dispose() {
    this.statics.forEach((t) => t.dispose())
    this.bonesTex.dispose()
    this.capsTex.dispose()
    this.tgtRT.dispose()
    this.nRT.dispose()
    this.pos.forEach((r) => r.dispose())
    ;[this.mSkin, this.mPred, this.mIter, this.mNorm].forEach((m) => m.dispose())
    this.quad.geometry.dispose()
  }
}
