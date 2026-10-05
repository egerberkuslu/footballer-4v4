// Gecici yedek: E'nin rigli modeli gelene kadar ayni kemik adlariyla (MPFB game_engine) kurulmus
// tek SkinnedMesh manken. Parcalar kemige kati bagli; 5 malzeme grubu = 5 draw call.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

type V = [number, number, number]
// [ad, ebeveyn, bas (m; +z ileri, +x sol)]
const BONES: [string, string | null, V][] = [
  ['Root', null, [0, 0, 0]],
  ['pelvis', 'Root', [0, 0.99, 0]],
  ['spine_01', 'pelvis', [0, 1.075, -0.02]],
  ['spine_02', 'spine_01', [0, 1.14, -0.02]],
  ['spine_03', 'spine_02', [0, 1.205, -0.025]],
  ['neck_01', 'spine_03', [0, 1.55, -0.005]],
  ['head', 'neck_01', [0, 1.645, 0.02]],
  ['clavicle_l', 'spine_03', [0.022, 1.475, 0.015]],
  ['upperarm_l', 'clavicle_l', [0.195, 1.445, -0.02]],
  ['lowerarm_l', 'upperarm_l', [0.255, 1.165, -0.03]],
  ['hand_l', 'lowerarm_l', [0.29, 0.915, 0.0]],
  ['thigh_l', 'pelvis', [0.1, 0.975, 0]],
  ['calf_l', 'thigh_l', [0.115, 0.525, 0.01]],
  ['foot_l', 'calf_l', [0.125, 0.085, -0.025]],
  ['ball_l', 'foot_l', [0.13, 0.018, 0.115]],
]
for (const [n, p, h] of BONES.slice(7)) {
  // sag taraf: x aynasi
  BONES.push([n.replace(/_l$/, '_r'), p === 'spine_03' ? p : p!.replace(/_l$/, '_r'), [-h[0], h[1], h[2]]])
}

const G = { skin: 0, jersey: 1, shorts: 2, socks: 3, dark: 4 } as const
type Grp = keyof typeof G

const up = new THREE.Vector3(0, 1, 0)

/** a'dan b'ye uzanan, profili r(t) olan, elips kesitli govde parcasi */
function limb(a: V, b: V, prof: [number, number][], sx = 1, sz = 1, seg = 14): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a)
  const B = new THREE.Vector3(...b)
  const len = A.distanceTo(B)
  const pts = prof.map(([t, r]) => new THREE.Vector2(Math.max(r, 1e-4), t * len))
  // uclari kapat
  pts.unshift(new THREE.Vector2(1e-4, prof[0][0] * len - prof[0][1] * 0.6))
  pts.push(new THREE.Vector2(1e-4, prof[prof.length - 1][0] * len + prof[prof.length - 1][1] * 0.6))
  const g = new THREE.LatheGeometry(pts, seg)
  g.scale(sx, 1, sz)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, B.clone().sub(A).normalize()))
  g.translate(A.x, A.y, A.z)
  return g
}

function blob(c: V, r: V, seg = 16): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75))
  g.scale(...r)
  g.translate(...c)
  return g
}

interface Part {
  g: THREE.BufferGeometry
  bone: string
  grp: Grp
}

function parts(): Part[] {
  const P: Part[] = []
  const add = (g: THREE.BufferGeometry, bone: string, grp: Grp) => P.push({ g, bone, grp })
  // govde
  add(limb([0, 1.17, -0.025], [0, 1.53, -0.03], [[0, 0.135], [0.25, 0.155], [0.6, 0.168], [0.85, 0.155], [1, 0.1]], 1.18, 0.7, 20), 'spine_03', 'jersey')
  add(limb([0, 1.0, -0.02], [0, 1.22, -0.022], [[0, 0.135], [0.5, 0.128], [1, 0.135]], 1.12, 0.74, 20), 'spine_02', 'jersey')
  add(limb([0, 0.86, -0.015], [0, 1.06, -0.02], [[0, 0.12], [0.35, 0.155], [1, 0.14]], 1.12, 0.8, 20), 'pelvis', 'shorts')
  // boyun, bas, sac
  add(limb([0, 1.48, -0.01], [0, 1.68, 0.01], [[0, 0.058], [1, 0.05]], 1, 1, 12), 'neck_01', 'skin')
  add(blob([0, 1.715, 0.025], [0.083, 0.112, 0.1]), 'head', 'skin')
  add(blob([0, 1.705, 0.075], [0.022, 0.03, 0.03], 8), 'head', 'skin') // burun/cene hacmi
  const hair = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42)
  hair.rotateX(-0.35)
  hair.scale(0.089, 0.12, 0.106)
  hair.translate(0, 1.72, 0.012)
  add(hair, 'head', 'dark')
  for (const s of [1, -1]) {
    const sf = s > 0 ? 'l' : 'r'
    const x = (v: V): V => [v[0] * s, v[1], v[2]]
    // omuz + kol
    add(blob(x([0.175, 1.43, -0.025]), [0.072, 0.07, 0.068]), `upperarm_${sf}`, 'jersey')
    add(limb(x([0.195, 1.445, -0.02]), x([0.226, 1.3, -0.025]), [[0, 0.064], [1, 0.056]], 1, 1, 12), `upperarm_${sf}`, 'jersey')
    add(limb(x([0.195, 1.445, -0.02]), x([0.255, 1.165, -0.03]), [[0, 0.052], [0.4, 0.05], [1, 0.039]], 1, 1, 12), `upperarm_${sf}`, 'skin')
    add(limb(x([0.255, 1.165, -0.03]), x([0.29, 0.915, 0.0]), [[0, 0.04], [0.3, 0.042], [1, 0.028]], 1.1, 0.9, 12), `lowerarm_${sf}`, 'skin')
    add(blob(x([0.298, 0.865, 0.006]), [0.026, 0.06, 0.042], 10), `hand_${sf}`, 'skin')
    // bacak: uyluk (sort paca), diz, baldir (tozluk), krampon
    add(limb(x([0.1, 0.985, 0]), x([0.112, 0.7, 0.004]), [[0, 0.098], [1, 0.084]], 1, 1, 14), `thigh_${sf}`, 'shorts')
    add(limb(x([0.1, 0.975, 0]), x([0.115, 0.525, 0.01]), [[0, 0.09], [0.45, 0.078], [1, 0.054]], 1, 1, 14), `thigh_${sf}`, 'skin')
    add(blob(x([0.115, 0.525, 0.018]), [0.054, 0.06, 0.056], 10), `calf_${sf}`, 'socks')
    add(limb(x([0.115, 0.525, 0.01]), x([0.125, 0.085, -0.025]), [[0, 0.052], [0.3, 0.06], [0.75, 0.038], [1, 0.034]], 1, 1, 14), `calf_${sf}`, 'socks')
    add(limb(x([0.125, 0.06, -0.07]), x([0.13, 0.04, 0.12]), [[0, 0.042], [0.5, 0.048], [1, 0.042]], 0.95, 0.78, 12), `foot_${sf}`, 'dark')
    add(limb(x([0.13, 0.035, 0.1]), x([0.132, 0.03, 0.2]), [[0, 0.042], [0.7, 0.036], [1, 0.022]], 1.0, 0.7, 12), `ball_${sf}`, 'dark')
  }
  return P
}

let geomCache: { geo: THREE.BufferGeometry; names: string[] } | null = null

function geometry() {
  if (geomCache) return geomCache
  const names = BONES.map((b) => b[0])
  const byGrp: THREE.BufferGeometry[][] = [[], [], [], [], []]
  for (const p of parts()) {
    const g = p.g.toNonIndexed()
    g.deleteAttribute('uv')
    const n = g.attributes.position.count
    const bi = names.indexOf(p.bone)
    const idx = new Uint16Array(n * 4)
    const w = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      idx[i * 4] = bi
      w[i * 4] = 1
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4))
    byGrp[G[p.grp]].push(g)
  }
  const merged = byGrp.map((list) => mergeGeometries(list, false)!)
  const geo = mergeGeometries(merged, true)!
  geomCache = { geo, names }
  return geomCache
}

/** yeni manken sahnesi (ayaklar y=0, ileri +z, metre) */
export function buildMannequin(): THREE.Group {
  const { geo, names } = geometry()
  const bones: THREE.Bone[] = []
  const byName: Record<string, THREE.Bone> = {}
  for (const [n, p, h] of BONES) {
    const b = new THREE.Bone()
    b.name = n
    const ph = p ? BONES.find((x) => x[0] === p)![2] : [0, 0, 0]
    b.position.set(h[0] - ph[0], h[1] - ph[1], h[2] - ph[2])
    if (p) byName[p].add(b)
    byName[n] = b
    bones.push(b)
  }
  const ordered = names.map((n) => byName[n])
  const mats = [
    new THREE.MeshStandardMaterial({ name: 'skin', color: '#c58c68', roughness: 0.62 }),
    new THREE.MeshStandardMaterial({ name: 'forma', color: '#ffffff', roughness: 0.78 }),
    new THREE.MeshStandardMaterial({ name: 'sort', color: '#ffffff', roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ name: 'tozluk', color: '#ffffff', roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ name: 'dark', color: '#151312', roughness: 0.55 }),
  ]
  const mesh = new THREE.SkinnedMesh(geo, mats)
  mesh.name = 'manken'
  mesh.add(byName.Root)
  mesh.bind(new THREE.Skeleton(ordered))
  const g = new THREE.Group()
  g.add(mesh)
  return g
}

/** mankende sirt numarasi yeri (model uzayi) */
export const MANNEQUIN_BACK = { y: 1.31, z: -0.148 }
