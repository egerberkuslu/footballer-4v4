# Kaleci elle atis: Quaternius Universal Animation Library 2 (CC0) 'OverhandThrow' -> futbolcu.glb -> anim_keeper_throw.json.
# Kemik adlari ayni (UE mankeni). Yontem bake_loco.py ile ayni (dunya-uzayi delta, bacak mutlak yon, kol T-poz duzeltmesi).
# Birakma kare = sag el (hand_r) hizinin tepe yaptigi kare. Kullanim (anim_src icinde): blender -b -P bake_keeper_throw.py
import bpy, json, math
from mathutils import Matrix, Vector

UAL = "ual2/Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb"
DST = "../viewer/public/futbolcu.glb"
CLIP = "OverhandThrow"
FPS = 50
ABS = {"thigh", "calf", "foot", "ball"}
ARM = {"upperarm", "lowerarm", "hand"}
KEEP = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head"] + [
    f"{a}_{s}"
    for s in "lr"
    for a in ("clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot")
]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=UAL)
src = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
bpy.ops.import_scene.gltf(filepath=DST)
dst = [o for o in bpy.data.objects if o.type == "ARMATURE" and o != src][0]
sn_of = lambda dn: "Head" if dn == "head" and "Head" in src.data.bones else dn
ratio = dst.data.bones["pelvis"].head_local.z / src.data.bones["pelvis"].head_local.z


def rdir(arm, n):
    b = arm.data.bones[n]
    v = b.tail_local - b.head_local
    return Vector((v.x, 0.0, v.z)).normalized()


KARM = {
    s: rdir(dst, f"upperarm_{s}").rotation_difference(rdir(src, f"upperarm_{s}"))
    for s in "lr"
}
depth = lambda n: len(dst.data.bones[n].parent_recursive)
names = sorted(
    [d for d in KEEP if sn_of(d) in src.data.bones], key=lambda n: (depth(n), n)
)
for pb in dst.pose.bones:
    pb.rotation_mode = "QUATERNION"
g = lambda v: [v[0], v[2], -v[1]]
gq = lambda q: [q.x, q.z, -q.y, q.w]
act = next(a for a in bpy.data.actions if a.name.startswith(CLIP))
src.animation_data_create().action = act
f0, f1 = act.frame_range
SRC_FPS = bpy.context.scene.render.fps
n = int((f1 - f0) / SRC_FPS * FPS) + 1
restFootZ = min(
    dst.data.bones["foot_l"].head_local.z, dst.data.bones["foot_r"].head_local.z
)
frames = []
for k in range(n):
    ft = f0 + k * SRC_FPS / FPS
    fi = int(math.floor(ft))
    bpy.context.scene.frame_set(fi, subframe=ft - fi)
    bpy.context.view_layer.update()
    rest_p = src.data.bones["pelvis"].head_local
    pel_src = src.pose.bones["pelvis"].head.copy()
    qs = []
    for dn in names:
        sb, db = src.data.bones[sn_of(dn)], dst.data.bones[dn]
        Rs, Rd, Ps = (
            sb.matrix_local.to_3x3(),
            db.matrix_local.to_3x3(),
            src.pose.bones[sn_of(dn)].matrix.to_3x3(),
        )
        base = dn.split("_")[0]
        if base in ABS:
            q = Rd.col[1].rotation_difference(Rs.col[1])
            R = Ps @ (Rs.inverted() @ (q.to_matrix() @ Rd))
        elif base in ARM:
            R = (Ps @ Rs.inverted()) @ (KARM[dn[-1]].to_matrix() @ Rd)
        else:
            R = (Ps @ Rs.inverted()) @ Rd
        pb = dst.pose.bones[dn]
        t = (
            (db.head_local + (pel_src - rest_p) * ratio)
            if dn == "pelvis"
            else pb.head.copy()
        )
        pb.matrix = Matrix.Translation(t) @ R.to_4x4()
        bpy.context.view_layer.update()
        qs += [
            round(x, 4)
            for x in gq(
                (
                    pb.matrix.to_3x3() @ db.matrix_local.to_3x3().inverted()
                ).to_quaternion()
            )
        ]
    pel = dst.pose.bones["pelvis"].head - dst.data.bones["pelvis"].head_local
    foot = min(dst.pose.bones["foot_l"].head.z, dst.pose.bones["foot_r"].head.z)
    frames.append(
        {
            "q": qs,
            "pel": pel.copy(),
            "foot": foot,
            "hand": dst.pose.bones["hand_r"].head.copy(),
        }
    )
# zemin: her karede en alcak bilek dinlenme yuksekliginde; yatay pelvis yerinde
for f in frames:
    f["pel"].z += restFootZ - f["foot"]
    f["pel"].x = 0
    f["pel"].y = 0
sp = [(frames[i + 1]["hand"] - frames[i]["hand"]).length for i in range(n - 1)]
rel = max(range(n - 1), key=lambda i: sp[i]) + 1
out = {
    "bones": names,
    "src": "Quaternius Universal Animation Library 2 Standard (CC0)",
    "clips": {
        "throw": {
            "fps": FPS,
            "n": n,
            "contact": rel,
            "q": [f["q"] for f in frames],
            "pel": [[round(x, 4) for x in g(f["pel"])] for f in frames],
        }
    },
}
json.dump(
    out, open("../viewer/public/anim_keeper_throw.json", "w"), separators=(",", ":")
)
print(
    "THROW kare",
    n,
    "birakma",
    rel,
    "(%.2f s)" % (rel / FPS),
    "el tepe hizi m/kare %.3f" % sp[rel - 1],
    "src fps",
    SRC_FPS,
    "aralik",
    f0,
    f1,
    "el@birakma",
    [round(x, 2) for x in g(frames[rel]["hand"])],
)
