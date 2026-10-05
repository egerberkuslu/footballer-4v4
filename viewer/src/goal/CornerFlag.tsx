import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PITCH_L, PITCH_W } from '../pitch'

const POLE_H = 1.5
const FLAG_W = 0.45
const FLAG_H = 0.34

// Kumas: dama desenli polyester, ince dokuma izi
function flagTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 192
  const g = c.getContext('2d')!
  const n = 4
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      g.fillStyle = (i + j) % 2 ? '#f2c318' : '#d8231b'
      g.fillRect((i * 256) / n, j * 64, 256 / n, 64)
    }
  }
  for (let y = 0; y < 192; y += 2) {
    g.fillStyle = 'rgba(0,0,0,0.06)'
    g.fillRect(0, y, 256, 1)
  }
  for (let x = 0; x < 256; x += 2) {
    g.fillStyle = 'rgba(255,255,255,0.04)'
    g.fillRect(x, 0, 1, 192)
  }
  // dikis payi (direk tarafi kilif)
  g.fillStyle = 'rgba(0,0,0,0.18)'
  g.fillRect(0, 0, 10, 192)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

// Dalga: direkten uzaklastikca genlik artar; normal analitik turevden
const WAVE = /* glsl */ `
uniform float uTime;
uniform float uPhase;
float wv(vec2 q) {
  float a = q.x;
  return a * (0.055 * sin(q.x * 9.0 - uTime * 6.5 + uPhase + q.y * 2.0)
            + 0.02 * sin(q.x * 17.0 - uTime * 11.0 + uPhase * 1.7));
}
`

function patchFlag(s: THREE.WebGLProgramParametersWithUniforms, u: { uTime: { value: number }; uPhase: { value: number } }) {
  s.uniforms.uTime = u.uTime
  s.uniforms.uPhase = u.uPhase
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\n' + WAVE)
    .replace(
      '#include <begin_vertex>',
      /* glsl */ `
      vec2 fq = vec2(position.x / ${FLAG_W.toFixed(3)} + 0.5, position.y / ${FLAG_H.toFixed(3)} + 0.5);
      vec3 transformed = position;
      transformed.z += wv(fq);
      transformed.y -= fq.x * fq.x * 0.025;
      transformed.x -= fq.x * 0.03 * (0.5 + 0.5 * sin(uTime * 3.0 + uPhase));
      `,
    )
  if (s.vertexShader.includes('#include <beginnormal_vertex>'))
    s.vertexShader = s.vertexShader.replace(
      '#include <beginnormal_vertex>',
      /* glsl */ `
      vec2 nq = vec2(position.x / ${FLAG_W.toFixed(3)} + 0.5, position.y / ${FLAG_H.toFixed(3)} + 0.5);
      float e = 0.01;
      float dzx = (wv(nq + vec2(e, 0.0)) - wv(nq - vec2(e, 0.0))) / (2.0 * e * ${FLAG_W.toFixed(3)});
      float dzy = (wv(nq + vec2(0.0, e)) - wv(nq - vec2(0.0, e))) / (2.0 * e * ${FLAG_H.toFixed(3)});
      vec3 objectNormal = normalize(vec3(-dzx, -dzy, 1.0));
      `,
    )
}

function CornerFlag({ x, z, phase, tex, poleGeo, poleMat }: { x: number; z: number; phase: number; tex: THREE.Texture; poleGeo: THREE.BufferGeometry; poleMat: THREE.Material }) {
  const pole = useRef<THREE.Group>(null)
  const u = useMemo(() => ({ uTime: { value: 0 }, uPhase: { value: phase } }), [phase])
  const mats = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide })
    m.onBeforeCompile = (s) => patchFlag(s, u)
    m.customProgramCacheKey = () => 'flag'
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    d.onBeforeCompile = (s) => patchFlag(s, u)
    d.customProgramCacheKey = () => 'flag-depth'
    return { m, d }
  }, [tex, u])
  const flagGeo = useMemo(() => new THREE.PlaneGeometry(FLAG_W, FLAG_H, 24, 12), [])
  // esnek direk: tabandaki yay etrafinda hafif salinim
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    u.uTime.value = t
    const g = pole.current
    if (g) {
      g.rotation.z = 0.035 * Math.sin(t * 1.3 + phase) + 0.012 * Math.sin(t * 3.1 + phase * 2)
      g.rotation.x = 0.02 * Math.sin(t * 1.1 + phase * 0.7)
    }
  })
  // tum bayraklar ayni ruzgar yonunde
  const yaw = 0.55
  return (
    <group position={[x, 0, z]}>
      <group ref={pole} position-y={0.08}>
        <mesh geometry={poleGeo} material={poleMat} castShadow />
        <group position-y={POLE_H - 0.08 - FLAG_H / 2} rotation-y={yaw}>
          <mesh
            geometry={flagGeo}
            material={mats.m}
            customDepthMaterial={mats.d}
            position-x={FLAG_W / 2 + 0.012}
            castShadow
          />
        </group>
      </group>
    </group>
  )
}

// Renkli parca: geometriye sabit vertex rengi
function tinted(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex)
  const n = g.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}

export function CornerFlags() {
  const tex = useMemo(flagTexture, [])
  const hl = PITCH_L / 2
  const hw = PITCH_W / 2
  const spots: [number, number, number][] = [
    [-hl, -hw, 0],
    [-hl, hw, 1.7],
    [hl, -hw, 3.1],
    [hl, hw, 4.4],
  ]
  // direk + tepe topuzu tek geometri; dort yayli taban tek cizim
  const pole = useMemo(() => {
    const body = tinted(new THREE.CylinderGeometry(0.0125, 0.0125, POLE_H - 0.08, 14).translate(0, (POLE_H - 0.08) / 2, 0), '#f1f1ec')
    const knob = tinted(new THREE.SphereGeometry(0.016, 12, 8).translate(0, POLE_H - 0.07, 0), '#d8231b')
    return {
      geo: mergeGeometries([body, knob])!,
      mat: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    }
  }, [])
  const bases = useMemo(
    () => mergeGeometries(spots.map(([x, z]) => new THREE.CylinderGeometry(0.022, 0.026, 0.08, 16).translate(x, 0.04, z)))!,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hl, hw],
  )
  return (
    <>
      <mesh geometry={bases}>
        <meshStandardMaterial color="#1a1a1a" roughness={0.6} />
      </mesh>
      {spots.map(([x, z, ph]) => (
        <CornerFlag key={ph} x={x} z={z} phase={ph} tex={tex} poleGeo={pole.geo} poleMat={pole.mat} />
      ))}
    </>
  )
}
