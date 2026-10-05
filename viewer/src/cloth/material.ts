// Gorsel forma: deri sonrasi kose, bagli 4 parcacigin (simule - deri hedefi) farki kadar kaydirilir.
// Normal de ayni farkla dondurulur. Mevcut malzemenin onBeforeCompile'i (takim dokusu, numara) korunur.
import * as THREE from 'three'
import { TW } from './solver'

export const clothUniforms = {
  clothPos: { value: null as THREE.Texture | null },
  clothTgt: { value: null as THREE.Texture | null },
  clothNS: { value: null as THREE.Texture | null },
  clothNT: { value: null as THREE.Texture | null },
}

const HEAD = /* glsl */ `
attribute vec4 clothIdx;
attribute vec4 clothW;
uniform highp sampler2D clothPos, clothTgt, clothNS, clothNT;
void clothSample(out vec3 d, out vec3 nn) {
  d = vec3(0.0);
  nn = vec3(0.0);
  // w != 0: kumas ozniteligi yok (varsayilan (0,0,0,1)) -> kaydirma yok
  if (clothW.w != 0.0) return;
  for (int k = 0; k < 3; k++) {
    float w = clothW[k];
    if (w <= 0.0) continue;
    int i = int(clothIdx[k] + 0.5);
    ivec2 c = ivec2(i % ${TW}, i / ${TW});
    d += w * (texelFetch(clothPos, c, 0).xyz - texelFetch(clothTgt, c, 0).xyz);
    nn += w * (texelFetch(clothNS, c, 0).xyz - texelFetch(clothNT, c, 0).xyz);
  }
}
`

function patchShader(sh: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(sh.uniforms, clothUniforms)
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\n${HEAD}`)
    .replace(
      '#include <skinnormal_vertex>',
      /* glsl */ `#include <skinnormal_vertex>
#ifdef USE_SKINNING
  {
    vec3 cd, cn;
    clothSample(cd, cn);
    // dunya farki -> mesh yerel (attached: bindMatrixInverse = model tersi)
    mat3 cl = mat3(bindMatrixInverse);
    objectNormal = normalize(objectNormal) + (cl * cn) / max(length(cl[0]), 1e-6);
  }
#endif`,
    )
    .replace(
      '#include <skinning_vertex>',
      /* glsl */ `#include <skinning_vertex>
#ifdef USE_SKINNING
  {
    vec3 cd, cn;
    clothSample(cd, cn);
    transformed += mat3(bindMatrixInverse) * cd;
  }
#endif`,
    )
}

/** malzemeye kumas kaydirmasini ekle (bir kez) */
export function patchClothMaterial(m: THREE.Material) {
  if (m.userData.cloth) return
  m.userData.cloth = true
  const prev = m.onBeforeCompile.bind(m)
  const prevKey = m.customProgramCacheKey.bind(m)
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r)
    patchShader(sh)
  }
  m.customProgramCacheKey = () => prevKey() + '|cloth'
  m.needsUpdate = true
}

let depth: THREE.MeshDepthMaterial | null = null
/** golge: ayni kaydirma ile derinlik */
export function clothDepthMaterial() {
  if (!depth) {
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    patchClothMaterial(depth)
  }
  return depth
}
