import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { World } from '../sim'

// Ag ipi: ~3.5 mm polyester. Her kenar bir ornek (instance), uclari GPU'da tupe acilir.
// Uzakta ip bir pikselden inceye dusunce yaricap piksele sabitlenir, opaklik kapsamaya gore azalir.
const ROPE_R = 0.00175
const KNOT_R = 0.0034
const KNOT_L = 0.005 // dugumden ipe gecis boyu
const MIN_PX = 1.15 // cihaz pikseli cinsinden en kucuk ip genisligi
const SHADOW_SCALE = 2.6 // golge haritasi texeli ~8 mm; ip golgesi kaybolmasin

type Shared = { uPx: { value: number } }

// Ornek basina cerceve: T ip yonu, N1/N2 dik eksenler
const ROPE_COMMON = /* glsl */ `
uniform float uPx;
uniform float uR;
attribute vec3 aA;
attribute vec3 aB;
varying float vCover;
varying float vTw;
varying float vTint;
vec3 ropeOff(vec3 p) {
  vec3 d = aB - aA;
  vec3 T = d / max(length(d), 1e-6);
  vec3 up = abs(T.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 N1 = normalize(cross(T, up));
  vec3 N2 = cross(T, N1);
  return normalize(p.x * N1 + p.z * N2);
}
float ropeHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
`

function radiusGLSL(center: string): string {
  return /* glsl */ `
  float rr = uR;
  #ifdef NET_DEPTH
    rr = uR * ${SHADOW_SCALE.toFixed(2)};
    vCover = 1.0;
  #else
    float vz = max(-(modelViewMatrix * vec4(${center}, 1.0)).z, 0.0);
    float pr = vz * uPx * ${(MIN_PX * 0.5).toFixed(3)};
    rr = max(uR, pr);
    vCover = uR / rr;
  #endif
  `
}

function patchRope(shader: THREE.WebGLProgramParametersWithUniforms, sh: Shared, depth: boolean) {
  shader.uniforms.uPx = sh.uPx
  shader.uniforms.uR = { value: ROPE_R }
  if (depth) shader.vertexShader = '#define NET_DEPTH\n' + shader.vertexShader
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + ROPE_COMMON)
    .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = ropeOff(position);')
    .replace(
      '#include <begin_vertex>',
      /* glsl */ `
      // halka 0 ve 3: dugum yarisi (her kenar iki ucunda yarim dugum tasir), 1-2: ip
      float ring = floor(position.y * 3.0 + 0.5);
      float elen = length(aB - aA);
      float kt = min(${KNOT_L.toFixed(4)} / max(elen, 1e-4), 0.3);
      float ty = ring < 0.5 ? 0.0 : ring < 1.5 ? kt : ring < 2.5 ? 1.0 - kt : 1.0;
      vec3 rc = mix(aA, aB, ty);
      ${radiusGLSL('rc')}
      float kn = (ring < 0.5 || ring > 2.5) ? ${(KNOT_R / ROPE_R).toFixed(3)} : 1.0;
      vec3 transformed = rc + ropeOff(position) * rr * mix(1.0, kn, vCover);
      // uc bukumlu orgu: cevre boyunca 3 iplik, ~7 mm adim
      vTw = uv.x * 3.0 + ty * elen / 0.007;
      vTint = ropeHash(float(gl_InstanceID));
      `,
    )
}

const FRAG_COMMON = /* glsl */ `
varying float vCover;
varying float vTw;
varying float vTint;
`
const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
float strand = abs(fract(vTw) - 0.5) * 2.0;
float tw = mix(0.78, 1.0, smoothstep(0.0, 0.7, strand));
// uzakta orgu ortalanir
tw = mix(0.92, tw, vCover);
diffuseColor.rgb *= tw * mix(0.9, 1.02, vTint);
diffuseColor.a *= clamp(vCover * 1.15, 0.0, 1.0);
`

function makeMaterials(sh: Shared, kind: 'rope') {
  const patch = patchRope
  const mat = new THREE.MeshStandardMaterial({
    color: '#efeee6',
    roughness: 0.82,
    metalness: 0,
    transparent: true,
    depthWrite: true,
  })
  mat.onBeforeCompile = (s) => {
    patch(s, sh, false)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_COMMON)
      .replace('#include <color_fragment>', FRAG_COLOR)
  }
  mat.customProgramCacheKey = () => 'net-' + kind
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  depth.onBeforeCompile = (s) => {
    patch(s, sh, true)
  }
  depth.customProgramCacheKey = () => 'net-depth-' + kind
  return { mat, depth }
}

// Ag: tek instanced cizim; dugumler ip uclarinda kalinlasma olarak. Dizi kimligi sabit, cozunurluk world'den okunur.
export function Net({ world }: { world: World }) {
  const gl = useThree((s) => s.gl)
  const shared = useMemo<Shared>(() => ({ uPx: { value: 0.001 } }), [])

  const rope = useMemo(() => {
    const base = new THREE.CylinderGeometry(1, 1, 1, 4, 3, true)
    base.translate(0, 0.5, 0)
    const g = new THREE.InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.attributes.position)
    g.setAttribute('normal', base.attributes.normal)
    g.setAttribute('uv', base.attributes.uv)
    const ne = world.renderEdges.length / 2
    const aA = new THREE.InstancedBufferAttribute(new Float32Array(ne * 3), 3)
    const aB = new THREE.InstancedBufferAttribute(new Float32Array(ne * 3), 3)
    aA.setUsage(THREE.DynamicDrawUsage)
    aB.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('aA', aA)
    g.setAttribute('aB', aB)
    g.instanceCount = ne
    return { g, aA, aB, ...makeMaterials(shared, 'rope') }
  }, [world, shared])

  useEffect(
    () => () => {
      rope.g.dispose()
      rope.mat.dispose()
    },
    [rope],
  )

  const buf = useMemo(() => new THREE.Vector2(), [])
  useFrame(({ camera }) => {
    const P = world.pos
    const E = world.renderEdges
    const A = rope.aA.array as Float32Array
    const B = rope.aB.array as Float32Array
    for (let e = 0, n = E.length / 2; e < n; e++) {
      const a = E[2 * e] * 3
      const b = E[2 * e + 1] * 3
      const o = e * 3
      A[o] = P[a]
      A[o + 1] = P[a + 1]
      A[o + 2] = P[a + 2]
      B[o] = P[b]
      B[o + 1] = P[b + 1]
      B[o + 2] = P[b + 2]
    }
    rope.aA.needsUpdate = true
    rope.aB.needsUpdate = true
    const cam = camera as THREE.PerspectiveCamera
    gl.getDrawingBufferSize(buf)
    shared.uPx.value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov ?? 45) / 2)) / Math.max(buf.y, 1)
  })

  return (
    <>
      <mesh
        geometry={rope.g}
        material={rope.mat}
        customDepthMaterial={rope.depth}
        frustumCulled={false}
      />
    </>
  )
}
