# CMU sut klipleri (cgspeed iskeleti) -> futbolcu.glb iskeleti; calisma-zamani JSON (anim_kick.json).
# Kullanim: blender -b -P bake_kick.py
# v3: temas = ayak tepe hizindan 1 kare sonra (ayak en alt noktada, hiz top carpmasiyla yariya duser);
#     kemik deltalari + pelvis yuksekligi (ham, yere basan bilekten) + pelvisin YATAY yolu (h, temasa gore) +
#     hedef iskelette bilek konumlari (fr/fl, yerinde pelvise gore) + klipteki topun yeri (ball, temasta pelvise gore).
import bpy, json, math
from mathutils import Matrix, Vector, Quaternion

CLIPS = ["10_01", "10_02", "10_03", "10_05", "10_06", "11_01"]
DST = "../viewer/public/futbolcu.glb"
MAP = {
    "pelvis": "hip",
    "spine_01": "abdomen",
    "spine_03": "chest",
    "neck_01": "neck",
    "head": "head",
}
for s, c in (("l", "l"), ("r", "r")):
    MAP.update(
        {
            f"clavicle_{s}": f"{c}Collar",
            f"upperarm_{s}": f"{c}Shldr",
            f"lowerarm_{s}": f"{c}ForeArm",
            f"hand_{s}": f"{c}Hand",
            f"thigh_{s}": f"{c}Thigh",
            f"calf_{s}": f"{c}Shin",
            f"foot_{s}": f"{c}Foot",
        }
    )
ABS = {"thigh", "calf", "foot"}
ARM = {"upperarm", "lowerarm", "hand"}
g = lambda v: [v[0], v[2], -v[1]]
gq = lambda q: [q.x, q.z, -q.y, q.w]
FPS = 30
PRE, POST = 16, 20  # kare: temastan once / sonra
BALL_R = 0.11
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=DST)
dst = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
dnames = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head"] + [
    f"{a}_{s}"
    for s in "lr"
    for a in ("clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot")
]
depth = lambda n: len(dst.data.bones[n].parent_recursive)
dnames.sort(key=lambda n: (depth(n), n))
for pb in dst.pose.bones:
    pb.rotation_mode = "QUATERNION"
out = {"bones": dnames, "clips": {}}
restFootZ = (
    dst.data.bones["foot_l"].head_local.z + dst.data.bones["foot_r"].head_local.z
) / 2
restPel = dst.data.bones["pelvis"].head_local.copy()
out["restPelvisH"] = round(restPel.z, 4)
for name in CLIPS:
    for o in [o for o in bpy.data.objects if o.name.startswith(name)]:
        bpy.data.objects.remove(o)
    bpy.ops.import_scene.fbx(filepath=f"cmu_pick/{name}.fbx")
    src = [
        o for o in bpy.data.objects if o.type == "ARMATURE" and o.name.startswith(name)
    ][0]
    act = src.animation_data.action
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    P = {}
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        P[f] = src.pose.bones["rFoot"].head.copy()
    sp = {f: (P[f + 1] - P[f]).length for f in range(f0 + 15, f1 - 25)}
    fm = max(sp, key=sp.get)
    tc = fm + 1  # top carpmasi: tepe hiz araligindan hemen sonra, ayak en alt noktada
    v = P[fm + 3] - P[fm - 2]
    fwd = Vector((v.x, v.y, 0)).normalized()
    Qfix = fwd.rotation_difference(Vector((0, -1, 0))).to_matrix()
    sR = {n: src.data.bones[n].matrix_local.to_3x3() for n in MAP.values()}

    def rd(n):
        b = src.data.bones[n]
        w = Qfix @ (b.tail_local - b.head_local)
        return Vector((w.x, 0, w.z)).normalized()

    def drd(n):
        b = dst.data.bones[n]
        w = b.tail_local - b.head_local
        return Vector((w.x, 0, w.z)).normalized()

    KARM = {
        s: drd(f"upperarm_{s}").rotation_difference(rd(MAP[f"upperarm_{s}"]))
        for s in "lr"
    }
    hip0 = src.data.bones["hip"].head_local
    ratio = dst.data.bones["pelvis"].head_local.z / hip0.z
    a, b_ = tc - PRE, tc + POST
    assert a >= f0 and b_ <= f1, (name, a, b_, f0, f1)
    frames = []
    srcRest = (
        src.data.bones["lFoot"].head_local.z + src.data.bones["rFoot"].head_local.z
    ) / 2
    for f in range(a, b_ + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        qs = {}
        for dn in dnames:
            if dn == "spine_02":
                continue
            sn = MAP[dn]
            db = dst.data.bones[dn]
            Rs = Qfix @ sR[sn]
            Rd = db.matrix_local.to_3x3()
            Ps = Qfix @ src.pose.bones[sn].matrix.to_3x3()
            base = dn.split("_")[0]
            if base in ABS:
                q = Rd.col[1].rotation_difference(Rs.col[1])
                Rd2 = q.to_matrix() @ Rd
                R = Ps @ (Rs.inverted() @ Rd2)
            elif base in ARM and dn.endswith(("_l", "_r")):
                R = (Ps @ Rs.inverted()) @ (KARM[dn[-1]].to_matrix() @ Rd)
            else:
                R = (Ps @ Rs.inverted()) @ Rd
            qs[dn] = R
        qs["spine_02"] = (
            qs["spine_01"]
            .to_quaternion()
            .slerp(qs["spine_03"].to_quaternion(), 0.5)
            .to_matrix()
        )
        hipw = Qfix @ (src.pose.bones["hip"].head - hip0)
        # hedef iskelet: pelvis YERINDE (yatay 0), yukseklik once dinlenme; sonra yere basan bilekten duzeltilir
        for dn in dnames:
            pb = dst.pose.bones[dn]
            db = dst.data.bones[dn]
            t = (
                (db.head_local + Vector((0, 0, hipw.z * ratio)))
                if dn == "pelvis"
                else pb.head.copy()
            )
            pb.matrix = Matrix.Translation(t) @ qs[dn].to_4x4()
            bpy.context.view_layer.update()
        srcmin = min(src.pose.bones["lFoot"].head.z, src.pose.bones["rFoot"].head.z)
        fr_ = dst.pose.bones["foot_r"].head.copy()
        fl_ = dst.pose.bones["foot_l"].head.copy()
        br_ = dst.pose.bones["ball_r"].head.copy()
        target = restFootZ + (srcmin - srcRest) * ratio
        dz = target - min(fr_.z, fl_.z)
        frames.append(
            {
                "q": [
                    gq(
                        (
                            dst.pose.bones[dn].matrix.to_3x3()
                            @ dst.data.bones[dn].matrix_local.to_3x3().inverted()
                        ).to_quaternion()
                    )
                    for dn in dnames
                ],
                "pz": hipw.z * ratio
                + dz,  # pelvis yukseklik sapmasi (m, dinlenmeye gore)
                "h": Vector((hipw.x, hipw.y, 0))
                * ratio,  # yatay pelvis yolu (Blender, m)
                "fr": fr_ - restPel + Vector((0, 0, dz)),
                "fl": fl_ - restPel + Vector((0, 0, dz)),
                "br": br_ - restPel + Vector((0, 0, dz)),
            }
        )
    ci = PRE
    hc = frames[ci]["h"].copy()
    G = lambda v: g(Vector((v.x, v.y, v.z + restPel.z)))  # zeminden yukseklik
    ank = frames[ci]["fr"]
    # top: temas karesinde bilegin onunde (ayak ustu topun arkasina deger), merkez yerden BALL_R
    ball = Vector((ank.x, ank.y - 0.13, BALL_R - restPel.z))
    hz = [fr["pz"] for fr in frames]
    clip = {
        "fps": FPS,
        "n": len(frames),
        "contact": ci,
        "q": [[round(x, 5) for q in fr["q"] for x in q] for fr in frames],
        "py": [round(x, 4) for x in hz],
        "h": [
            [round(x, 4) for x in g(fr["h"] - hc)][0::2] for fr in frames
        ],  # [x, z] three
        "fr": [[round(x, 3) for x in G(fr["fr"])] for fr in frames],
        "fl": [[round(x, 3) for x in G(fr["fl"])] for fr in frames],
        "ball": [round(x, 3) for x in G(ball)],
        "peakV": round(sp[fm] * FPS * (0.01 if P[fm].length > 50 else 1), 2),
    }
    out["clips"][name] = clip
    print(
        "KICK",
        name,
        "kare",
        len(frames),
        "temas",
        ci,
        "pelvis dy min %.3f max %.3f" % (min(hz), max(hz)),
        "top",
        clip["ball"],
        "h[0]",
        clip["h"][0],
        "h[-1]",
        clip["h"][-1],
        "fl@c",
        clip["fl"][ci],
        "fr@c",
        clip["fr"][ci],
    )
import os

tmp = "../viewer/public/anim_kick3.json.tmp"
json.dump(out, open(tmp, "w"), separators=(",", ":"))
os.replace(tmp, "../viewer/public/anim_kick3.json")
print("restPelvisH", out["restPelvisH"])
