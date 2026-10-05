# Gameplay Football / Google Research Football (Unlicense, kamu mali) .anim pas / kafa / ilk dokunus klipleri (bake_pass.py kopyasi) -> futbolcu.glb iskeleti;
# calisma-zamani JSON (viewer/public/anim_pass.json).
# Kaynak: github.com/google-research/football third_party/gfootball_engine/data/media/animations (LICENSE: Unlicense).
# Kaynak iskelet (data/media/objects/players/player.object): z yukari, ileri -y, sol +x (Blender ile ayni eksenler);
# .anim satiri: kemik, (kare, qx,qy,qz,qw)*  ['player' satiri: (kare, x,y,z)*], 100 kare/s; kuaterniyon kemigin
# EBEVEYNE GORE TAM yerel yonelimi (dinlenme = birim; player.object'teki kucuk dinlenme donusleri animasyonda ezilir).
# Kullanim: cd anim_src && blender -b -P bake_pass.py
import bpy, json, math, os
from mathutils import Matrix, Vector, Quaternion

A = "gfootball/third_party/gfootball_engine/data/media/animations/"
# ad: (dosya, ayna, cikti fps)   ayna=True: sol/sag degisir (kaynak sag bacakla kayiyorsa sol varyant)
CLIPS = {
    "pass_idle": ("pass/idle/000.anim", False),
    "pass_walk": ("pass/walk/000.anim", False),
    "pass_short": ("pass/walk/000_short.anim", False),
    "pass_sprint": ("pass/sprint/000.anim", False),
    "header": ("pass/idle/nonbase/000_header.anim", False),
    "header_jump": ("pass/idle/nonbase/000_header_jump_forwards.anim", False),
    "trap_foot": ("trap/idle/000_IB000.anim", False),
    "trap_foot_walk": ("trap/walk/000_D000_IB000_short.anim", False),
    "trap_thigh": ("trap/idle/highballs/000_knee.anim", False),
    "trap_chest": ("trap/idle/highballs/000_chest.anim", False),
}
FPS = 50
DST = "../viewer/public/futbolcu.glb"

# kaynak iskelet (player.object): ebeveyn, ofset
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
ORDER = [
    "body",
    "middle",
    "neck",
    "left_shoulder",
    "left_elbow",
    "right_shoulder",
    "right_elbow",
    "left_thigh",
    "left_knee",
    "left_ankle",
    "right_thigh",
    "right_knee",
    "right_ankle",
]
# kaynak kemik yonu (dinlenmede, dunya): cocuk ofseti
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
SRC_HIP = 0.96 - 0.01
TOE_MIN = 0.015
GROUND_MIN = 0.03  # el / parmak eklemi en az yerden yukseklik (m)  # parmak ucu en az yerden yukseklik (m)


def parse(path, mirror):
    tracks, ext, xml = {}, None, ""
    for line in open(path):
        t = line.strip().split(",")
        if not t[0]:
            continue
        if t[0] == "extension":
            if t[1] == "football":
                ext = (int(t[2]), float(t[3]), float(t[4]), float(t[5]))
            continue
        if t[0].startswith("<") or t[0] not in SK and t[0] != "player":
            xml += line
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
    if (
        mirror
    ):  # x=0 duzlemine gore ayna: konum x -> -x; kuaterniyon (w,x,y,z) -> (w,x,-y,-z); sol/sag adlari degisir
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
        if ext:
            ext = (ext[0], -ext[1], ext[2], ext[3])
    return tracks, ext, xml


def sample(keys, f):
    if f <= keys[0][0]:
        return keys[0][1].copy()
    for (f0, v0), (f1, v1) in zip(keys, keys[1:]):
        if f <= f1:
            a = (f - f0) / max(1e-9, f1 - f0)
            # motor: dogrusal ara deger + egri yumusatma; burada smoothstep yerine dogrusal (kaynak anahtarlari 5-8 kare aralikli)
            return v0.slerp(v1, a) if isinstance(v0, Quaternion) else v0.lerp(v1, a)
    return keys[-1][1].copy()


def src_pose(tracks, f):
    """kaynak FK: her dugum icin dunya yonelimi (Matrix3) ve konumu (Vector), kok yatay hareketi DAHIL"""
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
    for a in ("clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot", "ball")
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
HIP0 = (DB["thigh_l"].head_local.z + DB["thigh_r"].head_local.z) / 2
side = {"l": "left", "r": "right"}


def absdir(dn, sdir):
    """dinlenme yon hizalamasi: hedef kemigin dinlenme yonunu kaynak dinlenme yonune ceviren q (hedef asimetrisi tasinmaz)"""
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
    # el: on kolla ayni hizalama (kaynakta bilek yok)
    qla = ALIGN[f"lowerarm_{s}"] @ DB[f"lowerarm_{s}"].matrix_local.to_3x3().inverted()
    ALIGN[f"hand_{s}"] = qla @ DB[f"hand_{s}"].matrix_local.to_3x3()

g = lambda v: [v[0], v[2], -v[1]]
gq = lambda q: [q.x, q.z, -q.y, q.w]
out = {"bones": dnames, "fps": FPS, "clips": {}}
report = {}
for name, (fn, mirror) in CLIPS.items():
    tracks, ext, xml = parse(A + fn, mirror)
    last = max(k[-1][0] for k in tracks.values())
    n = int(last / 100 * FPS) + 1
    frames = []
    # bas yonu (yaw) duzeltmesi: kalca sag-sol ekseninin yatay yonu; klip basinda ve sonunda karakter ileri bakar
    # (oyunda yonu simulasyon verir; kaynaktaki kalkis ~90 derece doner, bitiste kosuya pop olurdu). Arada dogrusal.
    def yaw_of(f):
        ax = src_pose(tracks, f)[0]["body"] @ Vector((1, 0, 0))
        return math.atan2(ax.y, ax.x)

    y0, y1 = yaw_of(0), yaw_of(last)
    dy = math.atan2(math.sin(y1 - y0), math.cos(y1 - y0))
    for i in range(n):
        f = i * 100 / FPS
        W, P, root = src_pose(tracks, f)
        Cz = Matrix.Rotation(-(y0 + dy * min(1.0, f / last)), 3, "Z")
        W = {k: Cz @ v for k, v in W.items()}
        P = {k: Cz @ v for k, v in P.items()}
        root = Cz @ root
        R = {}
        for s in "lr":
            S = side[s]
            R[f"thigh_{s}"] = W[f"{S}_thigh"] @ ALIGN[f"thigh_{s}"]
            R[f"calf_{s}"] = W[f"{S}_knee"] @ ALIGN[f"calf_{s}"]
            R[f"foot_{s}"] = W[f"{S}_ankle"] @ DB[f"foot_{s}"].matrix_local.to_3x3()
            R[f"upperarm_{s}"] = W[f"{S}_shoulder"] @ ALIGN[f"upperarm_{s}"]
            R[f"lowerarm_{s}"] = W[f"{S}_elbow"] @ ALIGN[f"lowerarm_{s}"]
            R[f"hand_{s}"] = W[f"{S}_elbow"] @ ALIGN[f"hand_{s}"]
            R[f"clavicle_{s}"] = W["middle"] @ DB[f"clavicle_{s}"].matrix_local.to_3x3()
        qb, qm, qn = (W[k].to_quaternion() for k in ("body", "middle", "neck"))
        R["pelvis"] = W["body"] @ DB["pelvis"].matrix_local.to_3x3()
        for dn, a in (("spine_01", 0.35), ("spine_02", 0.7), ("spine_03", 1.0)):
            R[dn] = qb.slerp(qm, a).to_matrix() @ DB[dn].matrix_local.to_3x3()
        R["neck_01"] = (
            qm.slerp(qn, 0.5).to_matrix() @ DB["neck_01"].matrix_local.to_3x3()
        )
        R["head"] = W["neck"] @ DB["head"].matrix_local.to_3x3()
        # pelvis: yerinde (yatay kok hareketi simulasyonda); dikey, kaynak kalca yuksekligi bacak oraninda
        srcHipZ = P["body"].z - 0.01
        pel = Vector((0, 0, (srcHipZ - SRC_HIP) * RATIO))  # pelvis dinlenmeden sapma (m)
        for dn in dnames:
            pb = dst.pose.bones[dn]
            if dn.startswith("ball_"):
                # parmak eklemi: kaynakta yok; ayak ile birlikte doner, ama parmak ucu yere girerse (topuk kalkik) yukari bukulur
                pb.matrix = Matrix.Translation(pb.head.copy()) @ (
                    dst.pose.bones["foot_" + dn[-1]].matrix.to_3x3()
                    @ DB["foot_" + dn[-1]].matrix_local.to_3x3().inverted()
                    @ DB[dn].matrix_local.to_3x3()
                ).to_4x4()
                bpy.context.view_layer.update()
                h, tl = pb.head.copy(), pb.tail.copy()
                d = tl - h
                L = d.length
                if tl.z < TOE_MIN and h.z > TOE_MIN - L:
                    hz = Vector((d.x, d.y, 0))
                    hz = hz.normalized() if hz.length > 1e-6 else Vector((0, -1, 0))
                    sz = max(-1.0, min(1.0, (TOE_MIN - h.z) / L))
                    nd = hz * math.sqrt(1 - sz * sz) + Vector((0, 0, sz))
                    rq = d.normalized().rotation_difference(nd)
                    pb.matrix = Matrix.Translation(h) @ (rq.to_matrix() @ pb.matrix.to_3x3()).to_4x4()
                    bpy.context.view_layer.update()
                continue
            t = (PEL0 + pel) if dn == "pelvis" else pb.head.copy()
            pb.matrix = Matrix.Translation(t) @ R[dn].to_4x4()
            bpy.context.view_layer.update()
        # zemin duzeltmesi: el (hand) ya da ayak parmak eklemi (ball) yere girerse zinciri kok ekleminden (omuz / kalca)
        # yukari dondur (ekseni: kol/bacak yonu x yukari); bicim korunur, yalniz yer altina inen uc kalkar
        for root_b, tip_b in (("upperarm_l", "hand_l"), ("upperarm_r", "hand_r"), ("thigh_l", "ball_l"), ("thigh_r", "ball_r")):
            for _ in range(3):
                pr, pt = dst.pose.bones[root_b], dst.pose.bones[tip_b]
                h, tp = pr.head.copy(), pt.head.copy()
                if tp.z >= GROUND_MIN:
                    break
                v = tp - h
                ax = v.cross(Vector((0, 0, 1)))
                if ax.length < 1e-6 or v.length < 1e-6:
                    break
                # gereken aci: uc yuksekligi GROUND_MIN olacak kadar (kucuk aci yaklasimi, 3 yinelemede yakinsar)
                ang = math.asin(max(-1.0, min(1.0, (GROUND_MIN - tp.z) / v.length)))
                rq = Quaternion(ax.normalized(), ang)
                pr.matrix = Matrix.Translation(h) @ (rq.to_matrix() @ pr.matrix.to_3x3()).to_4x4()
                bpy.context.view_layer.update()
        q = [
            gq(
                (
                    dst.pose.bones[dn].matrix.to_3x3()
                    @ DB[dn].matrix_local.to_3x3().inverted()
                ).to_quaternion()
            )
            for dn in dnames
        ]
        pts = {
            k: dst.pose.bones[k].head.copy()
            for k in (
                "pelvis",
                "foot_l",
                "foot_r",
                "ball_l",
                "ball_r",
                "hand_l",
                "hand_r",
                "head",
            )
        }
        pts["toe_l"] = dst.pose.bones["ball_l"].tail.copy()
        pts["toe_r"] = dst.pose.bones["ball_r"].tail.copy()
        frames.append(
            {
                "q": q,
                "pel": pel.copy(),
                "pts": pts,
                "root": root.copy(),
                "src_ank": (P["left_ankle"].z, P["right_ankle"].z),
            }
        )
    c = ext[0] * FPS / 100 if ext else None
    clip = {
        "n": n,
        "contact": round(c, 2) if c is not None else None,
        "q": None,
        "pel": [[round(x, 4) for x in g(fr["pel"])] for fr in frames],
    }
    clip["q"] = [[round(x, 5) for qq in fr["q"] for x in qq] for fr in frames]
    # kok (kaynak 'player') yatay hareketi: m, karakter uzayi (x sol, z ileri) -> katman zaman egriltmesinde hiz eslemesi icin
    clip["root"] = [
        [round(fr["root"].x * RATIO, 3), round(-fr["root"].y * RATIO, 3)]
        for fr in frames
    ]
    if ext:
        ci = int(round(c))
        fr = frames[min(ci, n - 1)]
        # temas aninda top (kaynak) kok-goreli, olcekli, karakter uzayi
        clip["ball"] = [
            round(ext[1] * RATIO - fr["root"].x * RATIO, 3),
            round(ext[3] * RATIO, 3),  # top yuksekligi (kafa / gogus icin)
            round(-(ext[2] - fr["root"].y) * RATIO, 3),
        ]
        # temas aninda ayak uclari (pelvis yerinde): karakter uzayi
        clip["toes"] = [
            [round(v, 3) for v in g(fr["pts"]["toe_l"])],
            [round(v, 3) for v in g(fr["pts"]["toe_r"])],
        ]
    out["clips"][name] = clip
    mins = [min(fr["pts"][k].z for k in fr["pts"]) for fr in frames]
    report[name] = {"yaw0_son_derece": [round(math.degrees(y0), 1), round(math.degrees(y1), 1)],
        "n": n,
        "sure_s": round(n / FPS, 2),
        "temas_s": round(c / FPS, 3) if c is not None else None,
        "top@temas": clip.get("ball"),
        "parmak@temas": clip.get("toes"),
        "pelvis_z_min": round(min(PEL0.z + fr["pel"].z for fr in frames), 3),
        "en_alcak_nokta_min": round(min(mins), 3),
        "kok_yatay_toplam_m": [
            round(frames[-1]["root"].x - frames[0]["root"].x, 2),
            round(frames[-1]["root"].y - frames[0]["root"].y, 2),
        ],
    }
os.makedirs("../viewer/public", exist_ok=True)
import itertools
def qdiff(fa, fb):
    t = 0.0
    for bi in range(len(dnames)):
        a = Quaternion((fa[bi * 4 + 3], *fa[bi * 4 : bi * 4 + 3]))
        b_ = Quaternion((fb[bi * 4 + 3], *fb[bi * 4 : bi * 4 + 3]))
        t += math.degrees(a.rotation_difference(b_).angle)
    return t / len(dnames)


json.dump(out, open("../viewer/public/anim_pass.json", "w"), separators=(",", ":"))
for k, v in report.items():
    print("PASSBAKE", k, json.dumps(v))
print(
    "PASSBAKE ratio",
    round(RATIO, 3),
    "boyut",
    os.path.getsize("../viewer/public/anim_pass.json"),
)
