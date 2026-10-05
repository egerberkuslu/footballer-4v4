# Kaleci klipleri: GameplayFootball (google-research/football third_party/gfootball_engine, Unlicense) el-anahtarli
# kaleci animasyonlari (.anim: 100 kare/s, dugum basina yerel kuaterniyon) -> futbolcu.glb iskeleti -> anim_keeper.json.
# Kullanim (anim_src icinde): blender -b -P bake_keeper.py
# Kaynak iskelet: player(kok, konum) > body > middle > neck; middle > *_shoulder > *_elbow; body > *_thigh > *_knee > *_ankle.
# Kimlik pozu = dik durus, kollar ve bacaklar dik asagi. Eksenler Blender ile ayni: x sol, -y ileri, z yukari.
import bpy, json, math, re, os
from mathutils import Matrix, Vector, Quaternion

GF = "gfootball/third_party/gfootball_engine/data/media/animations/"
# ad -> (dosya, ayna?) ; ayna: kaynak sag tarafa (x<0) ise sol (-l) surum icin aynalanir
SRC = {
    "dive-mid": (
        "deflect/idle/090_midheight_deflect_far.anim",
        "r",
    ),  # top x=-1.94 (sag), y=0.94, temas 31
    "dive-trunk": (
        "deflect/idle/090_trunk_deflect_far.anim",
        "r",
    ),  # top x=-1.54, y=1.64, temas 31
    "dive-high": (
        "deflect/idle/090_high_deflect_far.anim",
        "r",
    ),  # top x=-1.26, y=2.09, temas 31
    "dive-low": (
        "deflect/idle/090_ground_deflect_far.anim",
        "l",
    ),  # top x=+2.53 (sol), y=0.11, temas 36
    "dive-lowc": (
        "deflect/idle/090_ground_holdball_close.anim",
        "l",
    ),  # top x=+1.70, y=0.11, temas 36 (tutma)
    "collect": (
        "deflect/idle/000_ground_holdball.anim",
        None,
    ),  # top 0.74 m onde yerde, temas 14
    "catch": ("deflect/idle/000_trunk_holdball.anim", None),  # gogus hizasi, temas 10
    "catch-high": ("deflect/idle/000_high_holdball.anim", None),  # 2.06 m, temas 12
    "getup-front": ("movement_special/idle/special/000_stand_up_from_front.anim", None),
    "getup-front-hold": ("movement_special/idle/special/000_stand_up_from_front_holdball.anim", None),
    "getup-back": ("movement_special/idle/special/000_stand_up_from_back.anim", None),
}
NODES = [
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
PAR = {
    "middle": "body",
    "neck": "middle",
    "left_shoulder": "middle",
    "right_shoulder": "middle",
    "left_elbow": "left_shoulder",
    "right_elbow": "right_shoulder",
    "left_thigh": "body",
    "right_thigh": "body",
    "left_knee": "left_thigh",
    "right_knee": "right_thigh",
    "left_ankle": "left_knee",
    "right_ankle": "right_knee",
}
OFF = {
    "body": (0, 0, 0.96),
    "middle": (0, 0, 0.15),
    "neck": (0, -0.03, 0.5),
    "left_shoulder": (0.16, -0.01, 0.48),
    "right_shoulder": (-0.16, -0.01, 0.48),
    "left_elbow": (-0.01, 0, -0.33),
    "right_elbow": (0.01, 0, -0.33),
    "left_thigh": (0.087, 0, -0.01),
    "right_thigh": (-0.087, 0, -0.01),
    "left_knee": (0, 0, -0.42),
    "right_knee": (0, 0, -0.42),
    "left_ankle": (0, -0.04, -0.44),
    "right_ankle": (0, -0.04, -0.44),
}
FPS = 50  # cikti ornekleme
g = lambda v: [v[0], v[2], -v[1]]
gq = lambda q: [q.x, q.z, -q.y, q.w]


def parse(path):
    keys, ball = {}, None
    for line in open(path):
        t = line.strip().split(",")
        if t[0] == "extension":
            if t[1] == "football":
                ball = (int(t[2]), float(t[3]), float(t[4]), float(t[5]))
            break
        if t[0].startswith("<"):
            break
        name = t[0]
        k = []
        i = 1
        if name == "player":
            while i + 3 < len(t):
                k.append(
                    (
                        int(t[i]),
                        Vector((float(t[i + 1]), float(t[i + 2]), float(t[i + 3]))),
                    )
                )
                i += 4
        else:
            while i + 4 < len(t):
                k.append(
                    (
                        int(t[i]),
                        Quaternion(
                            (
                                float(t[i + 4]),
                                float(t[i + 1]),
                                float(t[i + 2]),
                                float(t[i + 3]),
                            )
                        ),
                    )
                )
                i += 5
        keys[name] = k
    return keys, ball


def mirror(keys, ball):
    sw = (
        lambda n: n.replace("left_", "X_")
        .replace("right_", "left_")
        .replace("X_", "right_")
    )
    out = {}
    for n, k in keys.items():
        if n == "player":
            out[n] = [(f, Vector((-p.x, p.y, p.z))) for f, p in k]
        else:
            out[sw(n)] = [(f, Quaternion((q.w, q.x, -q.y, -q.z))) for f, q in k]
    return out, (ball[0], -ball[1], ball[2], ball[3]) if ball else None


def sample(k, f, quat):
    if f <= k[0][0]:
        return k[0][1].copy()
    for (f0, v0), (f1, v1) in zip(k, k[1:]):
        if f <= f1:
            a = (f - f0) / max(1e-6, f1 - f0)
            return v0.slerp(v1, a) if quat else v0.lerp(v1, a)
    return k[-1][1].copy()


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="../viewer/public/futbolcu.glb")
dst = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
dnames = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head"] + [
    f"{a}_{s}"
    for s in "lr"
    for a in ("clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot")
]
depth = lambda n: len(dst.data.bones[n].parent_recursive)
dnames.sort(key=lambda n: (depth(n), n))
Rd = {n: dst.data.bones[n].matrix_local.to_3x3() for n in dnames}
ratio = dst.data.bones["pelvis"].head_local.z / 0.96
DOWN = Vector((0, 0, -1))
ALIGN = {}
for n in dnames:
    base = n.split("_")[0]
    if base in ("upperarm", "lowerarm", "hand", "thigh", "calf"):
        ALIGN[n] = Rd[n].col[1].rotation_difference(DOWN).to_matrix()
    elif base == "foot":
        d = Rd[n].col[1]
        v = Vector((0, -math.hypot(d.x, d.y), d.z)).normalized()
        ALIGN[n] = d.rotation_difference(v).to_matrix()
    else:
        ALIGN[n] = Matrix.Identity(3)
SRCN = {"pelvis": "body", "spine_03": "middle", "head": "neck"}
for s, side in (("l", "left"), ("r", "right")):
    SRCN.update(
        {
            f"clavicle_{s}": "middle",
            f"upperarm_{s}": f"{side}_shoulder",
            f"lowerarm_{s}": f"{side}_elbow",
            f"hand_{s}": f"{side}_elbow",
            f"thigh_{s}": f"{side}_thigh",
            f"calf_{s}": f"{side}_knee",
            f"foot_{s}": f"{side}_ankle",
        }
    )


def bake(keys, ball):
    last = max(k[-1][0] for k in keys.values())
    n = int(last / 100 * FPS) + 1
    frames = []
    for i in range(n):
        f = i * 100 / FPS
        L = {
            nd: sample(keys[nd], f, True) if nd in keys else Quaternion()
            for nd in NODES
        }
        W, P = {}, {}
        root = sample(keys["player"], f, False)
        for nd in NODES:
            if nd == "body":
                W[nd] = L[nd]
                P[nd] = root + Vector(OFF[nd])
            else:
                W[nd] = W[PAR[nd]] @ L[nd]
                P[nd] = P[PAR[nd]] + W[PAR[nd]] @ Vector(OFF[nd])
        W["spine_01"] = W["body"].slerp(W["middle"], 1 / 3)
        W["spine_02"] = W["body"].slerp(W["middle"], 2 / 3)
        W["neck_01"] = W["middle"].slerp(W["neck"], 0.5)
        q = []
        for dn in dnames:
            src = W[dn] if dn in ("spine_01", "spine_02", "neck_01") else W[SRCN[dn]]
            delta = (src.to_matrix() @ ALIGN[dn]).to_quaternion()
            q += [round(x, 4) for x in gq(delta)]
        # el (bilek) konumu: dirsek + onkol 0.27 m
        hl = P["left_elbow"] + W["left_elbow"] @ Vector((0, 0, -0.27))
        hr = P["right_elbow"] + W["right_elbow"] @ Vector((0, 0, -0.27))
        frames.append(
            {
                "q": q,
                "pel": [round(x * ratio, 4) for x in g(root)],
                "ank": min(P["left_ankle"].z, P["right_ankle"].z),
                "bz": P["body"].z,
                "hl": hl,
                "hr": hr,
                "root": root.copy(),
            }
        )
    return frames


out = {
    "bones": dnames,
    "src": "GameplayFootball (google-research/football third_party/gfootball_engine, Unlicense)",
    "clips": {},
}
for name, (path, side) in SRC.items():
    keys, ball = parse(GF + path)
    variants = (
        {"": (keys, ball)}
        if side is None
        else {
            f"-{side}": (keys, ball),
            f'-{"l" if side == "r" else "r"}': mirror(keys, ball),
        }
    )
    for suf, (k, b) in variants.items():
        fr = bake(k, b)
        ci = int(round(b[0] / 100 * FPS)) if b else 0
        a0 = fr[0]["ank"]
        # kalkis: temastan once ayaklarin yerden kesildigi son kare; inis: temastan sonra govde en alcak seviyeye ilk yaklastigi kare
        to = 0
        for i in range(min(ci, len(fr) - 1), -1, -1):
            if fr[i]["ank"] < a0 + 0.06:
                to = i
                break
        zmin = min(x["bz"] for x in fr[ci:]) if ci < len(fr) else fr[-1]["bz"]
        land = next(
            (i for i in range(ci, len(fr)) if fr[i]["bz"] < zmin + 0.06), len(fr) - 1
        )
        hand = None
        if b:
            h = (fr[ci]["hl"] + fr[ci]["hr"]) / 2 - fr[ci][
                "root"
            ] * 0  # dunya (kok dahil)
            hand = [round(x, 3) for x in g(h)]
        out["clips"][name + suf] = {
            "fps": FPS,
            "n": len(fr),
            "contact": ci,
            "takeoff": to,
            "land": land,
            "ball": [round(x, 3) for x in g(Vector(b[1:]))] if b else None,
            "hand": hand,
            "q": [x["q"] for x in fr],
            "pel": [x["pel"] for x in fr],
        }
        print(
            "KEEPER",
            name + suf,
            "kare",
            len(fr),
            "temas",
            ci,
            "kalkis",
            to,
            "inis",
            land,
            "top",
            b,
            "el@temas",
            hand,
            "kok son",
            [round(x, 2) for x in fr[-1]["root"]],
            "govde z min %.2f" % zmin,
        )
json.dump(out, open("../viewer/public/anim_keeper.json", "w"), separators=(",", ":"))
print("yazildi", os.path.getsize("../viewer/public/anim_keeper.json"))
