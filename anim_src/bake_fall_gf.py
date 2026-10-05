# Faul dusmeleri + yerden kalkislar: Gameplay Football / Google Research Football (.anim, Unlicense, kamu mali) ->
# futbolcu.glb iskeleti; CMU dusmeleri (bake_fall.py -> anim_fall_cmu.json) ile birlestirilip viewer/public/anim_fall.json yazilir.
# Kaynak: github.com/google-research/football third_party/gfootball_engine/data/media/animations (LICENSE: Unlicense).
# .anim bicimi ve kaynak iskelet aktarimi bake_tackle.py'den kopyalandi (o dosya tackle ajaninindir, degistirilmedi).
# Ek olarak (bake_fall.py ile ayni):
#  - Yer: her kare DERILI MESH degerlendirilir; kol disi vertexlerin en alti zemine (dinlenme tabani) oturtulur, ustune kaynagin
#    kendi yerden yuksekligi (ucus/dusus) eklenir. Yere giren el / ayak parmagi zinciri omuz / kalcadan yukari dondurulur.
#  - Yatay: dusmeler yerinde (kaynak kok hareketi atilir; oyuncuyu simulasyon tasir), kalkislarda yere degen vertexler
#    kaymayacak sekilde temas capasiyla cozulur, bitis kok altinda.
#  - Yaw: dusmede baslangic, kalkista bitis ileri bakar.
# Kullanim: cd anim_src && blender -b -P bake_fall.py (CMU, istege bagli) && blender -b -P bake_fall_gf.py
import bpy, json, math, os
import numpy as np
from mathutils import Matrix, Vector, Quaternion

A = "gfootball/third_party/gfootball_engine/data/media/animations/"
# ad: (dosya, tur, hiz sinifi, ayna)
CLIPS = {
    "gf_sprint_000": ("trip/trip_t3/sprint/000.anim", "fall", "sprint"),
    "gf_sprint_045": ("trip/trip_t3/sprint/045.anim", "fall", "sprint"),
    "gf_walk_000": ("trip/trip_t3/walk/000_000.anim", "fall", "walk"),
    "gf_side_behind": ("trip/trip_t2/sprint/side_behind.anim", "fall", "sprint"),
    "gf_drib_180": ("trip/trip_t2/dribble/D135_180bump.anim", "fall", "walk"),
    "gf_idle_180": ("trip/trip_t2/idle/000_180.anim", "fall", "idle"),
    "gf_idle_090": ("trip/trip_t2/idle/000_090.anim", "fall", "idle"),
    "gf_up_front": (
        "movement_special/idle/special/000_stand_up_from_front.anim",
        "getup",
        "",
    ),
    "gf_up_back": (
        "movement_special/idle/special/000_stand_up_from_back.anim",
        "getup",
        "",
    ),
}
MIRROR = True
FPS = 50
DST = "../viewer/public/futbolcu.glb"
CMU = "anim_fall_cmu.json"
CMU_KEEP = (
    "fall_back",
    "fall_back_m",
)  # CMU 90_18 sirt ustu kayma-dusmesi (gercek mocap); CMU kalkislari 3-4 s, atildi

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
# kaynak eklem -> yaklasik yuzey yaricapi (m): eklem yuksekligi - yaricap = o noktanin yerden acikligi
SRC_R = {
    "body": 0.12,
    "middle": 0.12,
    "neck": 0.10,
    "left_thigh": 0.10,
    "right_thigh": 0.10,
    "left_knee": 0.06,
    "right_knee": 0.06,
    "left_ankle": 0.07,
    "right_ankle": 0.07,
}
TOE_MIN = 0.015
GROUND_MIN = 0.03


def parse(path, mirror):
    tracks = {}
    for line in open(path):
        t = line.strip().split(",")
        if (
            not t[0]
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
            m[nn] = (
                [(f, Vector((-p.x, p.y, p.z))) for f, p in keys]
                if n == "player"
                else [(f, Quaternion((q.w, q.x, -q.y, -q.z))) for f, q in keys]
            )
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
meshes = [
    o
    for o in bpy.data.objects
    if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)
]
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
DW = dst.matrix_world.copy()
side = {"l": "left", "r": "right"}

# kol vertexleri (yer cozumunden haric): baskin agirlik kol/el/parmak kemiginde olanlar
ARMB = (
    "clavicle",
    "upperarm",
    "lowerarm",
    "hand",
    "thumb",
    "index",
    "middle_0",
    "ring",
    "pinky",
)
masks = []
for o in meshes:
    names = [gr.name for gr in o.vertex_groups]
    mk = np.zeros(len(o.data.vertices), bool)
    for v in o.data.vertices:
        if v.groups:
            gmax = max(v.groups, key=lambda g_: g_.weight)
            mk[v.index] = names[gmax.group].startswith(ARMB)
    masks.append(mk)
ARM_MASK = np.concatenate(masks)
# el/parmak vertexleri: oyunda parmaklar yumruk (rig.curlFingers), Blender'da duz -> kaldirma hesabindan haric
HANDB = ("hand", "thumb", "index", "middle_0", "ring", "pinky")
hm = []
for o in meshes:
    names = [gr.name for gr in o.vertex_groups]
    mk = np.zeros(len(o.data.vertices), bool)
    for v in o.data.vertices:
        if v.groups:
            mk[v.index] = names[max(v.groups, key=lambda g_: g_.weight).group].startswith(HANDB)
    hm.append(mk)
HAND_MASK = np.concatenate(hm)


def mesh_verts():
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in meshes:
        e = o.evaluated_get(dg)
        m = e.to_mesh()
        n = len(m.vertices)
        a = np.empty(n * 3)
        m.vertices.foreach_get("co", a)
        W = np.array(e.matrix_world)
        out.append(a.reshape(-1, 3) @ W[:3, :3].T + W[:3, 3])
        e.to_mesh_clear()
    return np.concatenate(out)


GROUND = mesh_verts()[:, 2].min()
HIPH = (DW @ PEL0).z - GROUND


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
GZ = GROUND - DW.translation.z  # zemin, armatur uzayinda


def pose_all(R, pelz):
    for dn in dnames:
        pb = dst.pose.bones[dn]
        if dn.startswith("ball_"):
            pb.matrix = (
                Matrix.Translation(pb.head.copy())
                @ (
                    dst.pose.bones["foot_" + dn[-1]].matrix.to_3x3()
                    @ DB["foot_" + dn[-1]].matrix_local.to_3x3().inverted()
                    @ DB[dn].matrix_local.to_3x3()
                ).to_4x4()
            )
            bpy.context.view_layer.update()
            h, tl = pb.head.copy(), pb.tail.copy()
            d = tl - h
            L = d.length
            if (
                tl.z < GZ + TOE_MIN and h.z > GZ + TOE_MIN - L
            ):  # parmak ucu yere girerse yukari buk
                hz = Vector((d.x, d.y, 0))
                hz = hz.normalized() if hz.length > 1e-6 else Vector((0, -1, 0))
                sz = max(-1.0, min(1.0, (GZ + TOE_MIN - h.z) / L))
                nd = hz * math.sqrt(1 - sz * sz) + Vector((0, 0, sz))
                pb.matrix = (
                    Matrix.Translation(h)
                    @ (
                        d.normalized().rotation_difference(nd).to_matrix()
                        @ pb.matrix.to_3x3()
                    ).to_4x4()
                )
                bpy.context.view_layer.update()
            continue
        t = (PEL0 + Vector((0, 0, pelz))) if dn == "pelvis" else pb.head.copy()
        pb.matrix = Matrix.Translation(t) @ R[dn].to_4x4()
        bpy.context.view_layer.update()


def fix_chains():
    for root_b, tip_b in (
        ("upperarm_l", "hand_l"),
        ("upperarm_r", "hand_r"),
        ("thigh_l", "ball_l"),
        ("thigh_r", "ball_r"),
    ):
        for _ in range(3):
            pr, pt = dst.pose.bones[root_b], dst.pose.bones[tip_b]
            h, tp = pr.head.copy(), pt.head.copy()
            if tp.z >= GZ + GROUND_MIN:
                break
            v = tp - h
            ax = v.cross(Vector((0, 0, 1)))
            if ax.length < 1e-6 or v.length < 1e-6:
                break
            ang = math.asin(max(-1.0, min(1.0, (GZ + GROUND_MIN - tp.z) / v.length)))
            pr.matrix = (
                Matrix.Translation(h)
                @ (
                    Quaternion(ax.normalized(), ang).to_matrix() @ pr.matrix.to_3x3()
                ).to_4x4()
            )
            bpy.context.view_layer.update()
            # zincirin cocuklari (yeniden kur: dunya yonelimleri ebeveynle doner)


out = {"bones": dnames, "hipH": round(HIPH, 4), "clips": {}}
for key, (fn, kind, spd) in CLIPS.items():
    for mir in [False, True] if MIRROR else [False]:
        name = key + ("_m" if mir else "")
        tracks = parse(A + fn, mir)
        last = max(k[-1][0] for k in tracks.values())
        n = int(last / 100 * FPS) + 1
        yaw_of = lambda f: (lambda ax: math.atan2(ax.y, ax.x))(
            src_pose(tracks, f)[0]["body"] @ Vector((1, 0, 0))
        )
        yref = yaw_of(0) if kind == "fall" else yaw_of(last)
        Cz = Matrix.Rotation(-yref, 3, "Z")
        rec = []
        for i in range(n):
            f = min(last, i * 100 / FPS)
            W, P, root = src_pose(tracks, f)
            W = {k: Cz @ v for k, v in W.items()}
            R = {}
            for s in "lr":
                S = side[s]
                R[f"thigh_{s}"] = W[f"{S}_thigh"] @ ALIGN[f"thigh_{s}"]
                R[f"calf_{s}"] = W[f"{S}_knee"] @ ALIGN[f"calf_{s}"]
                R[f"foot_{s}"] = W[f"{S}_ankle"] @ DB[f"foot_{s}"].matrix_local.to_3x3()
                R[f"upperarm_{s}"] = W[f"{S}_shoulder"] @ ALIGN[f"upperarm_{s}"]
                R[f"lowerarm_{s}"] = W[f"{S}_elbow"] @ ALIGN[f"lowerarm_{s}"]
                R[f"hand_{s}"] = W[f"{S}_elbow"] @ ALIGN[f"hand_{s}"]
                R[f"clavicle_{s}"] = (
                    W["middle"] @ DB[f"clavicle_{s}"].matrix_local.to_3x3()
                )
            qb, qm, qn = (W[k].to_quaternion() for k in ("body", "middle", "neck"))
            R["pelvis"] = W["body"] @ DB["pelvis"].matrix_local.to_3x3()
            for dn, a in (("spine_01", 0.35), ("spine_02", 0.7), ("spine_03", 1.0)):
                R[dn] = qb.slerp(qm, a).to_matrix() @ DB[dn].matrix_local.to_3x3()
            R["neck_01"] = (
                qm.slerp(qn, 0.5).to_matrix() @ DB["neck_01"].matrix_local.to_3x3()
            )
            R["head"] = W["neck"] @ DB["head"].matrix_local.to_3x3()
            # kaynak yerden aciklik (kol disi eklemler): ucus/dusus sirasinda govde yerden kalkik kalir
            clear = max(0.0, min(P[j].z - r for j, r in SRC_R.items()) - 0.02) * RATIO
            pose_all(R, 0.0)
            V = mesh_verts()
            dz = GROUND - V[~ARM_MASK, 2].min() + clear
            pose_all(R, dz)
            fix_chains()
            V = mesh_verts()
            # kalan penetrasyon (orn. govde altinda kalan kol): tum govdeyi kaldir (yatan govde kolun ustunde durur)
            lift = GROUND - V[~HAND_MASK, 2].min()
            if lift > 0.002:
                dz += lift
                V = V + np.array([0, 0, lift])
                pel = dst.pose.bones["pelvis"]
                pel.matrix = Matrix.Translation(pel.head + Vector((0, 0, lift))) @ pel.matrix.to_3x3().to_4x4()
                bpy.context.view_layer.update()
            pf = (
                dst.pose.bones["pelvis"].matrix.to_3x3()
                @ DB["pelvis"].matrix_local.to_3x3().inverted()
            ) @ Vector(
                (0, -1, 0)
            )  # govde onu
            rec.append(
                {
                    "q": [
                        gq(
                            (
                                dst.pose.bones[dn].matrix.to_3x3()
                                @ DB[dn].matrix_local.to_3x3().inverted()
                            ).to_quaternion()
                        )
                        for dn in dnames
                    ],
                    "dz": dz,
                    "V": V,
                    "front_z": pf.z,
                    "pen": GROUND - V[~HAND_MASK, 2].min(),
                    "head": dst.pose.bones["head"].head - dst.pose.bones["pelvis"].head,
                }
            )
        offs = np.zeros((n, 2))
        if kind == "getup":  # temas capasi
            off = np.zeros(2)
            for i in range(1, n):
                a, b = rec[i - 1]["V"], rec[i]["V"]
                c = (a[:, 2] < GROUND + 0.025) & (b[:, 2] < GROUND + 0.025)
                if c.sum() >= 3:
                    off = off - np.median(b[c, :2] - a[c, :2], axis=0)
                offs[i] = off
            offs -= offs[-1]
        li = -1 if kind == "fall" else 0
        fz = rec[li]["front_z"]
        lie = "face" if fz < 0 else "back"
        hr = rec[li]["head"]
        lieYaw = math.atan2(hr.x, -hr.y)
        slide = []
        for i in range(1, n):
            a = rec[i - 1]["V"][:, :2] + offs[i - 1]
            b = rec[i]["V"][:, :2] + offs[i]
            c = (rec[i - 1]["V"][:, 2] < GROUND + 0.01) & (
                rec[i]["V"][:, 2] < GROUND + 0.01
            )
            if c.sum():
                slide.append(float(np.median(np.linalg.norm(b[c] - a[c], axis=1))))
        out["clips"][name] = {
            "kind": kind,
            "lie": lie,
            "spd": spd,
            "src": "gf:" + fn,
            "dur": round((n - 1) / FPS, 3),
            "n": n,
            "lieYaw": round(lieYaw, 4),
            "q": [[round(x, 4) for qq in r["q"] for x in qq] for r in rec],
            "pel": [
                [round(x, 4) for x in g(Vector((offs[i][0], offs[i][1], rec[i]["dz"])))]
                for i, r in enumerate(rec)
            ],
        }
        print(
            f"FALLGF {name}: {kind} {lie} (on z={fz:.2f}) {n} kare {(n - 1) / FPS:.2f} s lieYaw={math.degrees(lieYaw):.0f} "
            f"pelvis dz min {min(r['dz'] for r in rec):.2f} max penetrasyon {max(r['pen'] for r in rec) * 100:.1f} cm "
            f"temas kaymasi medyan {np.median(slide) * 1000 if slide else 0:.1f} mm/kare (yerinde dusmede beklenir)"
        )

# CMU dusmeleri: kemik listesi farkli (ball_* yok) -> ball = foot deltasi (ayak parmagi ayakla doner)
if os.path.exists(CMU):
    cm = json.load(open(CMU))
    for k in CMU_KEEP:
        c = cm["clips"].get(k)
        if not c:
            continue
        idx = {b: i for i, b in enumerate(cm["bones"])}
        q2 = []
        for row in c["q"]:
            r2 = []
            for dn in dnames:
                src_b = dn if dn in idx else "foot_" + dn[-1]
                j = idx[src_b] * 4
                r2 += row[j : j + 4]
            q2.append(r2)
        c2 = dict(
            c, q=q2, spd="", dur=0.8
        )  # CMU 90_18 1.23 s -> 0.8 s (yay uzunlugu yeniden zamanlanmis)
        out["clips"][k] = c2
        print("FALLGF CMU eklendi", k, c["lie"])
json.dump(out, open("../viewer/public/anim_fall.json", "w"), separators=(",", ":"))
print(
    "FALLGF yazildi",
    len(out["clips"]),
    "klip",
    os.path.getsize("../viewer/public/anim_fall.json"),
    "bayt, RATIO",
    round(RATIO, 3),
)
