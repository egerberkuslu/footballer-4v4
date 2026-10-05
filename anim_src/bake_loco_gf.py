# Lokomosyon ajani: Gameplay Football / Google Research Football (Unlicense) tek-adim kosu klipleri -> tam devir dongu
# (adim + aynasi), futbolcu.glb iskeleti; public/anim_loco_gf.json (anim_loco_cmu.json ile ayni bicim).
# Kaynak: github.com/google-research/football third_party/gfootball_engine/data/media/animations (LICENSE: Unlicense).
# Donusturme bake_tackle.py'den kopyalandi (parse/sample/src_pose/ALIGN); ek olarak: iki yarim devir (adim, aynali adim),
# yatay kok yerinde, pelvis yuksekligi devir boyu en alcak bilek = dinlenme bilek yuksekligi, faz 0 = sol ayak basar.
# Kullanim: cd anim_src && blender -b -P bake_loco_gf.py
import bpy, json, math
from mathutils import Matrix, Vector, Quaternion

A = "gfootball/third_party/gfootball_engine/data/media/animations/"
CLIPS = {
    "gf_sprint": "movement/sprint/000_idlelevel1.anim",
    "gf_dribble": "movement_special/dribble/special/000_holdball.anim",
}
M = 32
DST = "../viewer/public/futbolcu.glb"
SK = {
    "body": (None, (0, 0, 0.96)),
    "middle": ("body", (0, 0, 0.15)),
    "neck": ("middle", (0, -0.03, 0.5)),
    "left_shoulder": ("middle", (0.16, -0.01, 0.48)),
    "left_elbow": ("left_shoulder", (-0.01, 0, -0.33)),
    "right_shoulder": ("middle", (-0.16, -0.01, 0.48)),
    "right_elbow": ("right_shoulder", (0.01, 0, -0.33)),
    "left_thigh": ("body", (0.087, 0, -0.01)),
    "left_knee": ("left_thigh", (0, 0, -0.42)),
    "left_ankle": ("left_knee", (0, -0.04, -0.44)),
    "right_thigh": ("body", (-0.087, 0, -0.01)),
    "right_knee": ("right_thigh", (0, 0, -0.42)),
    "right_ankle": ("right_knee", (0, -0.04, -0.44)),
}
ORDER = list(SK.keys())
SDIR = {
    "left_shoulder": (-0.01, 0, -0.33),
    "right_shoulder": (0.01, 0, -0.33),
    "left_elbow": (0, 0, -1),
    "right_elbow": (0, 0, -1),
    "left_thigh": (0, 0, -0.42),
    "right_thigh": (0, 0, -0.42),
    "left_knee": (0, -0.04, -0.44),
    "right_knee": (0, -0.04, -0.44),
}
SRC_LEG = 0.42 + math.hypot(0.04, 0.44)


def parse(path, mirror):
    tracks = {}
    for line in open(path):
        t = line.strip().split(",")
        if (
            len(t) < 3
            or not t[0]
            or t[0] == "extension"
            or t[0].startswith("<")
            or (t[0] not in SK and t[0] != "player")
        ):
            continue
        keys = []
        if t[0] == "player":
            for i in range(1, len(t), 4):
                keys.append(
                    (
                        int(t[i]),
                        Vector((float(t[i + 1]), float(t[i + 2]), float(t[i + 3]))),
                    )
                )
        else:
            for i in range(1, len(t), 5):
                x, y, z, w = (float(v) for v in t[i + 1 : i + 5])
                keys.append((int(t[i]), Quaternion((w, x, y, z)).normalized()))
        tracks[t[0]] = keys
    if mirror:
        m = {}
        for n, keys in tracks.items():
            nn = (
                n.replace("left_", "TMP_")
                .replace("right_", "left_")
                .replace("TMP_", "right_")
            )
            if n == "player":
                m[nn] = [(f, Vector((-p.x, p.y, p.z))) for f, p in keys]
            else:
                m[nn] = [(f, Quaternion((q.w, q.x, -q.y, -q.z))) for f, q in keys]
        tracks = m
    return tracks


def sample(keys, f):
    if f <= keys[0][0]:
        return keys[0][1].copy()
    for (f0, v0), (f1, v1) in zip(keys, keys[1:]):
        if f <= f1:
            a = (f - f0) / max(1e-9, f1 - f0)
            return v0.slerp(v1, a) if isinstance(v0, Quaternion) else v0.lerp(v1, a)
    return keys[-1][1].copy()


def src_pose(tracks, f):
    root = sample(tracks["player"], f) if "player" in tracks else Vector((0, 0, 0))
    W, P = {}, {}
    for n in ORDER:
        par, off = SK[n]
        q = sample(tracks[n], f).to_matrix() if n in tracks else Matrix.Identity(3)
        if par is None:
            W[n] = q
            P[n] = root + Vector(off)
        else:
            W[n] = W[par] @ q
            P[n] = P[par] + W[par] @ Vector(off)
    return W, P, root


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=DST)
dst = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
dnames = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head"] + [
    f"{a}_{s}"
    for s in "lr"
    for a in (
        "clavicle",
        "upperarm",
        "lowerarm",
        "hand",
        "thigh",
        "calf",
        "foot",
        "ball",
    )
]
depth = lambda n: len(dst.data.bones[n].parent_recursive)
dnames.sort(key=lambda n: (depth(n), n))
for pb in dst.pose.bones:
    pb.rotation_mode = "QUATERNION"
DB = dst.data.bones
DLEG = (DB["thigh_l"].tail_local - DB["thigh_l"].head_local).length + (
    DB["calf_l"].tail_local - DB["calf_l"].head_local
).length
RATIO = DLEG / SRC_LEG
PEL0 = DB["pelvis"].head_local.copy()
restFootZ = (DB["foot_l"].head_local.z + DB["foot_r"].head_local.z) / 2
side = {"l": "left", "r": "right"}


def absdir(dn, sdir):
    Rd = DB[dn].matrix_local.to_3x3()
    q = Rd.col[1].rotation_difference(Vector(sdir).normalized())
    return q.to_matrix() @ Rd


ALIGN = {}
for s in "lr":
    S = side[s]
    ALIGN[f"thigh_{s}"] = absdir(f"thigh_{s}", SDIR[f"{S}_thigh"])
    ALIGN[f"calf_{s}"] = absdir(f"calf_{s}", SDIR[f"{S}_knee"])
    ALIGN[f"upperarm_{s}"] = absdir(f"upperarm_{s}", SDIR[f"{S}_shoulder"])
    ALIGN[f"lowerarm_{s}"] = absdir(f"lowerarm_{s}", SDIR[f"{S}_elbow"])
    qla = ALIGN[f"lowerarm_{s}"] @ DB[f"lowerarm_{s}"].matrix_local.to_3x3().inverted()
    ALIGN[f"hand_{s}"] = qla @ DB[f"hand_{s}"].matrix_local.to_3x3()

g = lambda v: [v[0], v[2], -v[1]]
gq = lambda q: [q.x, q.z, -q.y, q.w]
out = {"bones": dnames, "m": M, "clips": {}}
for key, fn in CLIPS.items():
    tr = [parse(A + fn, False), parse(A + fn, True)]
    last = max(k[-1][0] for k in tr[0].values())  # kare (100/s)
    T = 2 * last / 100.0
    step = sample(tr[0]["player"], last) - sample(tr[0]["player"], 0)
    dz = 0.0
    for PASS in (0, 1):
        frames = []
        for k in range(M):
            u = k / M * 2
            h = int(u)  # 0: adim, 1: aynali adim
            f = (u - h) * last
            W, P, root = src_pose(tr[h], f)
            # yatay kok yerinde: dogrusal yol cikar (yarim devir boyunca adim vektoru)
            lin = sample(tr[h]["player"], 0) + (
                Vector((-step.x, step.y, step.z)) if h else step
            ) * (f / last)
            sh = Vector((root.x - lin.x, root.y - lin.y, 0)) - Vector((root.x, root.y, 0))
            R = {}
            for s in "lr":
                S = side[s]
                R[f"thigh_{s}"] = W[f"{S}_thigh"] @ ALIGN[f"thigh_{s}"]
                R[f"calf_{s}"] = W[f"{S}_knee"] @ ALIGN[f"calf_{s}"]
                R[f"foot_{s}"] = W[f"{S}_ankle"] @ DB[f"foot_{s}"].matrix_local.to_3x3()
                R[f"ball_{s}"] = W[f"{S}_ankle"] @ DB[f"ball_{s}"].matrix_local.to_3x3()
                R[f"upperarm_{s}"] = W[f"{S}_shoulder"] @ ALIGN[f"upperarm_{s}"]
                R[f"lowerarm_{s}"] = W[f"{S}_elbow"] @ ALIGN[f"lowerarm_{s}"]
                R[f"hand_{s}"] = W[f"{S}_elbow"] @ ALIGN[f"hand_{s}"]
                R[f"clavicle_{s}"] = W["middle"] @ DB[f"clavicle_{s}"].matrix_local.to_3x3()
            qb, qm, qn = (W[x].to_quaternion() for x in ("body", "middle", "neck"))
            R["pelvis"] = W["body"] @ DB["pelvis"].matrix_local.to_3x3()
            for dn, a in (("spine_01", 0.35), ("spine_02", 0.7), ("spine_03", 1.0)):
                R[dn] = qb.slerp(qm, a).to_matrix() @ DB[dn].matrix_local.to_3x3()
            R["neck_01"] = (
                qm.slerp(qn, 0.5).to_matrix() @ DB["neck_01"].matrix_local.to_3x3()
            )
            R["head"] = W["neck"] @ DB["head"].matrix_local.to_3x3()
            pel = (
                Vector(((P["body"].x - lin.x), (P["body"].y - lin.y), P["body"].z - 0.96))
                * RATIO
            )
            pel.z += dz
            for dn in dnames:
                pb = dst.pose.bones[dn]
                t = (PEL0 + pel) if dn == "pelvis" else pb.head.copy()
                pb.matrix = Matrix.Translation(t) @ R[dn].to_4x4()
                bpy.context.view_layer.update()
            if PASS:  # parmak ucu yere girerse parmak eklemi yukari bukulur (bake_tackle.py ile ayni)
                for s in "lr":
                    pb = dst.pose.bones["ball_" + s]
                    h, tl = pb.head.copy(), pb.tail.copy()
                    d = tl - h
                    Lb = d.length
                    if tl.z < 0.015 and h.z > 0.015 - Lb:
                        hz = Vector((d.x, d.y, 0))
                        hz = hz.normalized() if hz.length > 1e-6 else Vector((0, -1, 0))
                        sz = max(-1.0, min(1.0, (0.015 - h.z) / Lb))
                        nd = hz * math.sqrt(1 - sz * sz) + Vector((0, 0, sz))
                        rq = d.normalized().rotation_difference(nd)
                        pb.matrix = Matrix.Translation(h) @ (rq.to_matrix() @ pb.matrix.to_3x3()).to_4x4()
                        bpy.context.view_layer.update()
            frames.append(
                {
                    "q": [
                        (
                            dst.pose.bones[dn].matrix.to_3x3()
                            @ DB[dn].matrix_local.to_3x3().inverted()
                        ).to_quaternion()
                        for dn in dnames
                    ],
                    "pel": pel.copy(),
                    "fl": dst.pose.bones["foot_l"].head.copy(),
                    "fr": dst.pose.bones["foot_r"].head.copy(),
                    "tl": dst.pose.bones["ball_l"].tail.copy(),
                    "tr": dst.pose.bones["ball_r"].tail.copy(),
                }
            )
        if PASS == 0:
            dz = restFootZ - min(min(fr["fl"].z, fr["fr"].z) for fr in frames)

    def stance(f):
        # basma: bilek yere yakin (en alcak + 4 cm) VE yerinde klipte geri kayiyor (kok hizinin yarisindan fazla);
        # devir basina tek (en uzun dairesel) parca
        zmin = min(fr[f].z for fr in frames)
        n_ = len(frames)
        vr = (2 * step.length * RATIO / T)
        ok = []
        for k_ in range(n_):
            vy = (frames[(k_ + 1) % n_][f].y - frames[k_ - 1][f].y) / (2 * T / n_)
            ok.append(frames[k_][f].z < zmin + 0.04 and vy > 0.5 * vr)
        best, bs = 0, 0
        for s0 in range(n_):
            if ok[s0] and not ok[s0 - 1]:
                L_ = 0
                while L_ < n_ and ok[(s0 + L_) % n_]:
                    L_ += 1
                if L_ > best:
                    best, bs = L_, s0
        return [best > 0 and ((k_ - bs) % n_) < best for k_ in range(n_)]

    lowL, lowR = stance("fl"), stance("fr")
    cl = [k for k in range(M) if lowL[k] and not lowL[k - 1]]
    k0 = cl[0] if cl else 0
    rot = lambda a: a[k0:] + a[:k0]
    frames, lowL, lowR = rot(frames), rot(lowL), rot(lowR)
    cl = [k for k in range(M) if lowL[k] and not lowL[k - 1]]
    cr = [k for k in range(M) if lowR[k] and not lowR[k - 1]]
    dt = T / M
    sp = []
    for f, low in (("fl", lowL), ("fr", lowR)):
        for k in range(M):
            if low[k] and low[(k + 1) % M]:
                sp.append((frames[(k + 1) % M][f].y - frames[k][f].y) / dt)
    sp.sort()
    vroot = 2 * step.length * RATIO / T
    vref = sp[len(sp) // 2] if sp else vroot
    seam = max(
        math.degrees(frames[-1]["q"][i].rotation_difference(frames[0]["q"][i]).angle)
        for i in range(len(dnames))
    )
    out["clips"][key] = {
        "src": "gf:" + fn,
        "dur": T,
        "vref": round(vref, 3),
        "vhip": round(vroot, 3),
        "cl": [k / M for k in cl],
        "cr": [k / M for k in cr],
        "stL": [1 if x else 0 for x in lowL],
        "stR": [1 if x else 0 for x in lowR],
        "q": [[round(x, 5) for q in fr["q"] for x in gq(q)] for fr in frames],
        "pel": [[round(x, 4) for x in g(fr["pel"])] for fr in frames],
        "ft": [[round(x, 4) for f in ("fl", "fr") for x in g(fr[f])] for fr in frames],
    }
    print(
        "GFLOCO",
        key,
        "devir %.3f s" % T,
        "kok %.2f m/s" % vroot,
        "vref %.2f" % vref,
        "basma",
        [round(x, 1) for x in sp],
        "solT",
        [round(k / M, 2) for k in cl],
        "sagT",
        [round(k / M, 2) for k in cr],
        "basma L %.2f R %.2f" % (sum(lowL) / M, sum(lowR) / M),
        "parmak ucu min %.3f" % min(min(fr["tl"].z, fr["tr"].z) for fr in frames),
        "son->ilk en buyuk fark %.1f" % seam,
        "ratio %.3f" % RATIO,
    )
json.dump(out, open("../viewer/public/anim_loco_gf.json", "w"), separators=(",", ":"))
