import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BALL_R } from './pitch'
import type { World } from './sim'

// Mac topu: 32 panel (12 besgen + 20 altigen) termal yapistirma dikisi, soyut kanat grafigi,
// parlak ust kaplama. Desen ve dikis oluklari nesne uzayinda, parcacik basina hesaplanir.

function panelCenters(): THREE.Vector3[] {
  const p = (1 + Math.sqrt(5)) / 2
  const ico: [number, number, number][] = [
    [0, 1, p], [0, -1, p], [0, 1, -p], [0, -1, -p],
    [1, p, 0], [-1, p, 0], [1, -p, 0], [-1, -p, 0],
    [p, 0, 1], [p, 0, -1], [-p, 0, 1], [-p, 0, -1],
  ]
  const v = ico.map((a) => new THREE.Vector3(...a).normalize())
  // ikosahedron yuzey merkezleri (altigenler): komsu uclu
  const faces: THREE.Vector3[] = []
  const edge = v[0].distanceTo(v[1]) + 1e-3
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++)
      for (let k = j + 1; k < 12; k++)
        if (v[i].distanceTo(v[j]) < edge && v[j].distanceTo(v[k]) < edge && v[i].distanceTo(v[k]) < edge)
          faces.push(v[i].clone().add(v[j]).add(v[k]).normalize())
  return [...v, ...faces]
}

const BALL_HEAD = /* glsl */ `
uniform vec3 uC[32];
uniform mat3 uNM;
varying vec3 vObjN;
float gSeam;
vec3 gBent;

vec3 ballPattern(vec3 n) {
  // en yakin iki panel merkezi (Voronoi)
  float b1 = -2.0, b2 = -2.0;
  vec3 c1 = vec3(0.0), c2 = vec3(0.0);
  int i1 = 0;
  // tek dongu: ilk 12 eleman besgen merkezleri, en yakin besgen de burada bulunur
  float pb = -2.0; vec3 pc = vec3(0.0); int pi = 0;
  for (int i = 0; i < 32; i++) {
    float d = dot(n, uC[i]);
    if (i < 12 && d > pb) { pb = d; pc = uC[i]; pi = i; }
    if (d > b1) { b2 = b1; c2 = c1; b1 = d; c1 = uC[i]; i1 = i; }
    else if (d > b2) { b2 = d; c2 = uC[i]; }
  }
  vec3 gd = c1 - c2;
  float glen = length(gd);
  float ed = (b1 - b2) / glen; // dikise acisal uzaklik (rad)
  vec3 gt = normalize(gd - n * dot(gd, n));
  // oluk: 2 mm taban + 2.2 mm egimli yanak
  float w = fwidth(ed) + 1e-5;
  float floorM = 1.0 - smoothstep(0.009 - w, 0.009 + w, ed);
  float wall = smoothstep(0.009, 0.013, ed) * (1.0 - smoothstep(0.013, 0.03, ed));
  gSeam = floorM;
  // yastik etkisi: panel kenarina yakin yuzey dikise dogru egilir
  gBent = normalize(n - gt * (wall * 0.55 + (1.0 - smoothstep(0.009, 0.06, ed)) * 0.12) * (1.0 - floorM));

  // en yakin besgen merkezi etrafinda kivrik kanatlar
  float r = acos(clamp(pb, -1.0, 1.0));
  vec3 ref = abs(pc.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(pc, ref));
  vec3 t2 = cross(pc, t1);
  float ph = atan(dot(n, t2), dot(n, t1));
  float s0 = ph * 5.0 / 6.2831853 + r * 2.4 + float(pi) * 0.13;
  float sw = fract(s0);
  float wd = 0.46 * (1.0 - smoothstep(0.1, 0.43, r));
  // turev, fract/atan sicramasindan etkilenmesin diye surekli fazdan ve analitik
  vec2 gph = vec2(length(dFdx(n)), length(dFdy(n)));
  float aw = clamp(length(gph) * (5.0 / 6.2831853 / max(sin(r), 0.02) + 2.4) * 0.75, 0.004, 0.08);
  float on = smoothstep(0.0, 0.02, wd);
  float blade = (1.0 - smoothstep(wd - aw, wd + aw, sw)) * smoothstep(0.035, 0.05, r) * on;
  float edgeL = ((1.0 - smoothstep(wd + 0.035 - aw, wd + 0.035 + aw, sw)) * smoothstep(0.03, 0.05, r) * on - blade);
  edgeL *= smoothstep(0.02, 0.06, wd);
  float core = 1.0 - smoothstep(0.03, 0.036, r);
  float coreRing = (1.0 - smoothstep(0.044, 0.05, r)) - core;

  vec3 white = vec3(0.92, 0.92, 0.9);
  vec3 navy = vec3(0.035, 0.06, 0.16);
  vec3 coral = vec3(0.86, 0.22, 0.09);
  vec3 col = white;
  col = mix(col, coral, clamp(edgeL, 0.0, 1.0));
  col = mix(col, navy, blade);
  col = mix(col, coral, clamp(coreRing, 0.0, 1.0));
  col = mix(col, navy, core);
  // altigen panellerde ince ton farki (gercek toplarda baski farki)
  col *= i1 >= 12 ? 1.0 : 0.985;
  col *= mix(1.0, 0.55, floorM);
  return col;
}
`

function patchBall(mesh: { current: THREE.Mesh | null }, centers: THREE.Vector3[]) {
  return (s: THREE.WebGLProgramParametersWithUniforms) => {
    s.uniforms.uC = { value: centers }
    // normalMatrix her karede nesneye yazilir; ayni referans uniform olarak gider
    const I = new THREE.Matrix3()
    s.uniforms.uNM = {
      get value() {
        return mesh.current ? mesh.current.normalMatrix : I
      },
    }
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjN = normal;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + BALL_HEAD)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = ballPattern(normalize(vObjN));',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.75, gSeam);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = normalize(uNM * gBent);',
      )
      .replace(
        '#include <clearcoat_normal_fragment_maps>',
        '#include <clearcoat_normal_fragment_maps>\nclearcoatNormal = normal;',
      )
  }
}

export function BallMesh({ world }: { world: World }) {
  const ref = useRef<THREE.Mesh>(null)
  const last = useRef(new THREE.Vector3(NaN, 0, 0))
  const geometry = useMemo(() => new THREE.SphereGeometry(BALL_R, 96, 64), [])
  const material = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.75,
      clearcoatRoughness: 0.16,
      sheen: 0.15,
      sheenRoughness: 0.6,
    })
    m.onBeforeCompile = patchBall(ref, panelCenters())
    m.customProgramCacheKey = () => 'match-ball'
    return m
  }, [])
  // test kancasi: bassiz ekran goruntusunde kamerayi topa yaklastirir
  const camera = useThree((st) => st.camera)
  const controls = useThree((st) => st.controls) as unknown as { target: THREE.Vector3; update: () => void; minDistance: number } | null
  useEffect(() => {
    const w = window as unknown as { __lookAt?: (p: number[], t: number[]) => void }
    w.__lookAt = (p, t) => {
      if (controls) controls.minDistance = 0.05
      camera.position.set(p[0], p[1], p[2])
      controls?.target.set(t[0], t[1], t[2])
      controls?.update()
    }
  }, [camera, controls])
  const axis = useMemo(() => new THREE.Vector3(), [])
  const dp = useMemo(() => new THREE.Vector3(), [])
  const q = useMemo(() => new THREE.Quaternion(), [])

  useFrame(() => {
    const m = ref.current
    if (!m) return
    const b = world.ball as World['ball'] & { q?: { x: number; y: number; z: number; w: number } }
    if (b.q) {
      // fizikten gelen yonelim
      m.quaternion.set(b.q.x, b.q.y, b.q.z, b.q.w)
    } else {
      // yedek: yuvarlanmadan tahmin
      if (Number.isNaN(last.current.x)) last.current.set(b.x, b.y, b.z)
      dp.set(b.x - last.current.x, b.y - last.current.y, b.z - last.current.z)
      const dist = dp.length()
      if (dist > 1e-5 && dist < 5) {
        axis.set(dp.z, 0, -dp.x).normalize()
        q.setFromAxisAngle(axis, dist / BALL_R)
        m.quaternion.premultiply(q)
      }
    }
    last.current.set(b.x, b.y, b.z)
    m.position.set(b.x, b.y, b.z)
  })

  return <mesh ref={ref} geometry={geometry} material={material} castShadow receiveShadow />
}
