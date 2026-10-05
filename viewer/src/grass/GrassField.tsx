import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PLATE_L, PLATE_W } from '../pitch'
import { attachGpuTimer } from './gpuTimer'
import { QUALITY } from '../env/quality'
import { GRASS_COMMON, MID, NEAR, grassUniforms, initGrassUniforms, patchBladeLighting } from './grassGlsl'

const params = new URLSearchParams(location.search)
// ?blades=N kalite olcegi (eski toplam tutam sayisi karsiligi); ?grass=0 yapraklari kapatir
// dusuk kalitede yaprak sayisi ~1/3.5 (alcak kamerada yaprak genisligi telafi eder)
const BLADES = Number(params.get('blades') ?? (QUALITY === 'low' ? 35_000 : 120_000))
export const GRASS_ON = params.get('grass') !== '0'
// Yaprak katmanlari parcalara (chunk) bolunur; CPU her karede kamera konisindeki parcalari secer,
// GPU tutam konumlarini (parca, sira) ozetinden uretir: ornek ozniteligi yok, konumlar dunyaya sabit.
const NEAR_CHUNK = 2 // m
const MID_CHUNK = 4
const NEAR_PER = Math.max(1, Math.round(BLADES / 60)) // tutam / parca (~500 / m2)
// uzak-yakin ara katman (near2): yakin katmanin yarisi yogunluk, daha az ucgen (mesafe LOD)
const NEAR2_PER = Math.max(1, Math.round(BLADES / 120))
const NEAR_SPLIT = new THREE.Vector2(3.5, 5.0) // yakin -> near2 gecis mesafesi
const MID_PER = Math.max(1, Math.round(BLADES / 150)) // ~50 / m2
const MAX_CHUNKS = 256

// ayiklama: ?gcam=x,y,z,tx,ty,tz kamerayi sabitler; ?gdbg=1 yapraklari kirmizi boyar
const GCAM = params.get('gcam')?.split(',').map(Number)
const GDBG = params.get('gdbg') === '1'

// Zemin: yalniz saha plakasi (disarisini cevre ajaninin zemin halkalari kapatir)
export function GrassGround() {
  const material = useMemo(() => {
    const u = initGrassUniforms()
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 })
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGW;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xz;',
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vGW;
          ${GRASS_COMMON}
          vec3 gPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
            vec3 sx = dFdx(surf_pos); vec3 sy = dFdy(surf_pos);
            vec3 r1 = cross(sy, surf_norm); vec3 r2 = cross(surf_norm, sx);
            float det = dot(sx, r1) * faceDir;
            vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
            return normalize(abs(det) * surf_norm - grad);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          vec4 gT = gTile(vGW);
          float gPaint;
          vec3 gCol = gAlbedo(vGW, gT, cameraPosition, length(fwidth(vGW)), 1.0, gPaint);
          // yaprak katmaninin altinda kalan zemin = cim dibi: koyu (ortam kapatma)
          float gCov = ${GRASS_ON ? 'gCover(length(cameraPosition - vec3(vGW.x, 0.0, vGW.y)))' : '0.0'};
          gCol *= mix(1.0, 0.5, gCov * (1.0 - gPaint * 0.5));
          diffuseColor.rgb = gCol;
          float gH = gT.a;
          `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          'float roughnessFactor = mix(0.95, 0.72, gH) - gPaint * 0.1;',
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          vec2 gDH = vec2(dFdx(gH), dFdy(gH)) * 0.012;
          normal = gPerturb(-vViewPosition, normal, gDH, faceDirection);
          `,
        )
    }
    return m
  }, [])

  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow material={material} ref={(m) => m && attachGpuTimer(m, 'zemin')}>
      <planeGeometry args={[PLATE_L, PLATE_W]} />
    </mesh>
  )
}

// Tutam sablonu: `blades` yaprak; yakin yaprak 2 dortgen + uc ucgeni (5 ucgen), orta katman
// 1 dortgen + uc (3 ucgen). Tek yuz cizilir (DoubleSide).
// Normal ozniteligi BILEREK var: yoksa three FLAT_SHADED acar ve yaprak normalleri yuz normaline
// doner (eski "siyah yaprak" hatasinin koku buydu).
function tuftGeometry(seed: number, blades: number, quads: number): THREE.InstancedBufferGeometry {
  let s = seed
  const rand = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  const pos: number[] = []
  const nrm: number[] = []
  const blade: number[] = []
  const idx: number[] = []
  const nv = quads * 2 + 3
  for (let b = 0; b < blades; b++) {
    const r = Math.sqrt(rand()) * 0.022
    const a = rand() * Math.PI * 2
    const bl = [Math.cos(a) * r, Math.sin(a) * r, rand() * Math.PI * 2, rand()]
    const v0 = pos.length / 3
    for (let i = 0; i <= quads; i++) pos.push(-0.5, i / (quads + 1), 0, 0.5, i / (quads + 1), 0)
    pos.push(0, 1, 0)
    for (let i = 0; i < nv; i++) {
      nrm.push(0, 1, 0)
      blade.push(...bl)
    }
    for (let i = 0; i < quads; i++) {
      const q = v0 + i * 2
      idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2)
    }
    const t = v0 + quads * 2
    idx.push(t, t + 1, t + 2)
  }
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 4))
  g.setIndex(idx)
  g.instanceCount = 0
  return g
}

type Layer = 'near' | 'near2' | 'mid'

function bladeMaterial(layer: Layer, chunks: { value: Float32Array }): THREE.MeshStandardMaterial {
  const u = initGrassUniforms()
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0, side: THREE.DoubleSide })
  const near = layer !== 'mid' // near ve near2: yakin ring, mid: uzak
  const size = near ? NEAR_CHUNK : MID_CHUNK
  const per = layer === 'near' ? NEAR_PER : layer === 'near2' ? NEAR2_PER : MID_PER
  const sp = `vec2(${NEAR_SPLIT.x.toFixed(2)}, ${NEAR_SPLIT.y.toFixed(2)})`
  const fade =
    layer === 'near'
      ? `1.0 - smoothstep(${sp}.x, ${sp}.y, gD3)`
      : layer === 'near2'
        ? `smoothstep(${sp}.x, ${sp}.y, gD3) * (1.0 - smoothstep(uNearF.x, uNearF.y, gD3))`
        : 'smoothstep(uNearF.x, uNearF.y, gD3) * (1.0 - smoothstep(uMidF.x, uMidF.y, gD3))'
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, { uChunks: chunks })
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${GRASS_COMMON}
        uniform vec4 uChunks[${MAX_CHUNKS / 2}];
        attribute vec4 aBlade;  // (dx, dz, yaprak yonu, rastgele)
        varying vec3 vGCol;
        varying float vGT;
        varying float vGPaint;
        uint gHashU(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
        float gU(inout uint s) { s = gHashU(s); return float(s >> 8) / 16777216.0; }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        int gCi = gl_InstanceID / ${per};
        int gLi = gl_InstanceID - gCi * ${per};
        vec4 gPk = uChunks[gCi >> 1];
        vec2 gCell = (gCi & 1) == 0 ? gPk.xy : gPk.zw;
        uint gSeed = gHashU(uint(int(gCell.x) + 4096) * 73856093u ^ uint(int(gCell.y) + 4096) * 19349663u
          ^ uint(gLi) * 83492791u ^ ${layer === 'near' ? '17u' : layer === 'near2' ? '53u' : '91u'});
        vec2 gLoc = vec2(gU(gSeed), gU(gSeed));
        float gIYaw = gU(gSeed) * 6.2831853;
        float gIR = gU(gSeed);
        vec2 gRoot = (gCell + gLoc) * ${size.toFixed(1)} + gRot(aBlade.xy, gIYaw);
        float gD3 = length(cameraPosition - vec3(gRoot.x, 0.0, gRoot.y));
        float gFade = ${fade};
        // yalniz zemin plakasinda (disarisi cevre ajaninin yuruyus yolu/bordur alani)
        vec2 gEdge = 0.5 * uPlate - abs(gRoot);
        gFade *= smoothstep(0.0, 0.25, min(gEdge.x, gEdge.y));
        float gR1 = fract(gIR * 17.31 + aBlade.w * 5.17);
        float gR2 = fract(gIR * 7.77 + aBlade.w * 13.9);
        // alcak kamerada (< 3 m) yapraklar genis ve uzun: tutamlar arasi cıplak zemin kapanir
        float gLow = 1.0 - smoothstep(1.2, 3.0, cameraPosition.y);
        float gH = mix(0.032, 0.068, gR1) * (gR2 > 0.93 ? 1.45 : 1.0) * gFade * (1.0 + 0.25 * gLow);
        // cizgi uzerinde ve yaninda yapraklar kisa: ince cizgiyi (ozellikle sig aciyla) kapatmasin
        float gLineZone = textureLod(uPitchMask, (gRoot + 0.5 * uPlate) / uPlate, 3.0).r;
        gH *= mix(1.0, 0.4, smoothstep(0.08, 0.5, gLineZone));
        float gW = mix(0.0026, 0.0046, gR2) * ${layer === 'near2' ? '1.45' : near ? '1.0' : '2.2'} * (1.0 + ${near ? '1.1' : '0.3'} * gLow);
        float gYaw = aBlade.z + gIYaw;
        float gS = gBandSign(gRoot.x) * gInPlate(gRoot);
        // egilme: bicme yonunde (0, s) + rastgele + ruzgar
        vec2 gLean = vec2(0.0, gS) * 0.55 + vec2(cos(gYaw * 1.7), sin(gYaw * 1.7)) * 0.4 * gR1;
        float gWind = sin(dot(gRoot, vec2(0.55, 0.32)) - uTime * 1.9) * 0.6 + sin(gRoot.x * 2.3 + uTime * 3.3) * 0.2;
        gWind *= 0.5 + gN(gRoot * 0.25 - uTime * 0.35).a;
        gLean += vec2(0.8, 0.45) * gWind * 0.35;
        float gt = position.y;
        vec2 gAcross = vec2(cos(gYaw), sin(gYaw));
        vec2 gOff = gAcross * position.x * gW * (1.0 - 0.6 * gt) + gLean * gH * gt * gt;
        float gY = gH * gt * (1.0 - 0.18 * dot(gLean, gLean) * gt);
        if (gFade < 0.002) gY = -1.0; // gorunmeyen yapraklar zeminin altina
        vec3 gP = vec3(gRoot.x + gOff.x, gY, gRoot.y + gOff.y);
        // normal: cogunlukla yukari + kameraya bakan yuz normali (yassi yaprak hissi)
        vec3 gFaceN = vec3(-gAcross.y, 0.0, gAcross.x);
        gFaceN *= sign(dot(gFaceN, cameraPosition - gP) + 1e-4);
        vec3 objectNormal = normalize(vec3(0.0, 0.8, 0.0) + gFaceN * 0.45 - vec3(gLean.x, 0.0, gLean.y) * 0.25);
        // renk: kok noktasindaki zemin albedosu (bulanik) + yaprak tonu
        float gPaint;
        vec3 gC = gAlbedo(gRoot, gTileLod(gRoot, 4.0), cameraPosition, 0.0, 0.0, gPaint);
        float gTone = fract(aBlade.w * 3.1 + gIR * 1.3);
        gC *= mix(vec3(0.8, 0.95, 0.85), vec3(1.15, 1.08, 0.82), gTone);
        vGCol = gC;
        vGT = gt;
        vGPaint = gPaint;
        `,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = gP;')
    shader.fragmentShader = patchBladeLighting(
      shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vGCol;
          varying float vGT;
          varying float vGPaint;`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          // MSAA orneklerinde degiskenler ucgen disina tasabilir: kirp (pow(negatif) = NaN -> siyah nokta)
          float gT01 = clamp(vGT, 0.0, 1.0);
          // dipte ortam kapatma, uca dogru acilma (boyali yaprakta daha az)
          float gAo = mix(0.2, 1.0, pow(gT01, 0.7));
          vec3 gTip = mix(vec3(1.0), vec3(1.25, 1.18, 0.88), smoothstep(0.55, 1.0, gT01) * (1.0 - vGPaint));
          diffuseColor.rgb = vGCol * gAo * gTip;
          ${GDBG ? (near ? 'diffuseColor.rgb = vec3(1.0, 0.0, 0.0);' : 'diffuseColor.rgb = vec3(0.0, 0.2, 1.0);') : ''}
          `,
        )
        // tek tek yapraklarin parlak noktalari bloom'da kivilcima donmesin (ozellikle gece projektor altinda)
        .replace('#include <opaque_fragment>', 'outgoingLight = min(outgoingLight, vec3(1.0));\n#include <opaque_fragment>')
        // tek yuzlu cizilen yaprakta arka yuzde normal ters cevrilmesin (normal zaten kameraya donuk)
        .replace(
          '#include <normal_fragment_begin>',
          `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
          vec3 normal = normalize( vNormal );
          vec3 nonPerturbedNormal = normal;`,
        ),
    )
  }
  return m
}

// Kamera konisinde, [dMin, dMax] 3B uzaklik halkasina dusen parcalari secer
const _box = new THREE.Box3()
const _frustum = new THREE.Frustum()
const _pv = new THREE.Matrix4()
function collectChunks(cam: THREE.Camera, size: number, dMin: number, dMax: number, out: Float32Array): number {
  const { x: cx, y: cy, z: cz } = cam.position
  const h2 = cy * cy
  if (h2 > dMax * dMax) return 0
  const r = Math.sqrt(dMax * dMax - h2)
  const i0 = Math.floor(Math.max(cx - r, -PLATE_L / 2) / size)
  const i1 = Math.floor(Math.min(cx + r, PLATE_L / 2) / size)
  const j0 = Math.floor(Math.max(cz - r, -PLATE_W / 2) / size)
  const j1 = Math.floor(Math.min(cz + r, PLATE_W / 2) / size)
  let n = 0
  for (let i = i0; i <= i1; i++) {
    const x0 = i * size
    const x1 = x0 + size
    const dxn = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0
    const dxf = Math.max(Math.abs(cx - x0), Math.abs(cx - x1))
    for (let j = j0; j <= j1; j++) {
      const z0 = j * size
      const z1 = z0 + size
      const dzn = cz < z0 ? z0 - cz : cz > z1 ? cz - z1 : 0
      if (dxn * dxn + dzn * dzn + h2 > dMax * dMax) continue
      const dzf = Math.max(Math.abs(cz - z0), Math.abs(cz - z1))
      if (dxf * dxf + dzf * dzf + h2 < dMin * dMin) continue
      _box.min.set(x0 - 0.12, 0, z0 - 0.12)
      _box.max.set(x1 + 0.12, 0.12, z1 + 0.12)
      if (!_frustum.intersectsBox(_box)) continue
      out[n * 2] = i
      out[n * 2 + 1] = j
      if (++n >= MAX_CHUNKS) return n
    }
  }
  return n
}

function useLayer(layer: Layer) {
  return useMemo(() => {
    const chunks = { value: new Float32Array(MAX_CHUNKS * 2) }
    return { geometry: layer === 'near' ? tuftGeometry(7, 4, 2) : layer === 'near2' ? tuftGeometry(13, 3, 1) : tuftGeometry(11, 3, 1), material: bladeMaterial(layer, chunks), chunks }
  }, [layer])
}

export function GrassBlades() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update(): void } | null
  const near = useLayer('near')
  const near2 = useLayer('near2')
  const mid = useLayer('mid')
  const near2Mesh = useRef<THREE.Mesh>(null)
  const nearMesh = useRef<THREE.Mesh>(null)
  const midMesh = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    if (GCAM && GCAM.length === 6 && controls) {
      camera.position.set(GCAM[0], GCAM[1], GCAM[2])
      controls.target.set(GCAM[3], GCAM[4], GCAM[5])
      controls.update()
    }
    grassUniforms.uTime.value = clock.elapsedTime
    camera.updateMatrixWorld()
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_pv)
    const nn = collectChunks(camera, NEAR_CHUNK, 0, NEAR_SPLIT.y, near.chunks.value)
    const n2 = collectChunks(camera, NEAR_CHUNK, NEAR_SPLIT.x, NEAR.y, near2.chunks.value)
    const nm = collectChunks(camera, MID_CHUNK, NEAR.x, MID.y, mid.chunks.value)
    near.geometry.instanceCount = nn * NEAR_PER
    near2.geometry.instanceCount = n2 * NEAR2_PER
    mid.geometry.instanceCount = nm * MID_PER
    if (GDBG) (window as unknown as { __grassChunks: number[] }).__grassChunks = [nn, nm, camera.position.y]
    if (nearMesh.current) nearMesh.current.visible = nn > 0
    if (near2Mesh.current) near2Mesh.current.visible = n2 > 0
    if (midMesh.current) midMesh.current.visible = nm > 0
  })

  if (!GRASS_ON) return null
  return (
    <>
      <mesh
        ref={(m) => {
          nearMesh.current = m
          if (m) attachGpuTimer(m, 'yakin')
        }}
        geometry={near.geometry} material={near.material} frustumCulled={false} receiveShadow />
      <mesh
        ref={(m) => {
          near2Mesh.current = m
          if (m) attachGpuTimer(m, 'yakin2')
        }}
        geometry={near2.geometry} material={near2.material} frustumCulled={false} receiveShadow />
      <mesh
        ref={(m) => {
          midMesh.current = m
          if (m) attachGpuTimer(m, 'orta')
        }}
        geometry={mid.geometry} material={mid.material} frustumCulled={false} receiveShadow />
    </>
  )
}
