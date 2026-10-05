# Lokomosyon ajani: CMU kosu/yurume kliplerini olc (hiz, kadans, dongu, duzluk) -> hangi klip hangi hiz bandina.
# Kullanim: blender -b -P bake_loco_probe.py -- 16_35 35_17 ...
import bpy, sys, math, json
from mathutils import Vector

DST = "../viewer/public/futbolcu.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=DST)
dst = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
dpel = dst.data.bones["pelvis"].head_local.z
res = {}
for name in sys.argv[sys.argv.index("--") + 1 :]:
    bpy.ops.import_scene.fbx(filepath=f"cmu_pick/{name}.fbx")
    src = [
        o for o in bpy.data.objects if o.type == "ARMATURE" and o.name.startswith(name)
    ][0]
    act = src.animation_data.action
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    SB = src.data.bones
    ratio = 0.918 / ((SB["lShin"].head_local - SB["lThigh"].head_local).length + (SB["lFoot"].head_local - SB["lShin"].head_local).length)
    H, L, R = [], [], []
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        H.append(src.pose.bones["hip"].head * ratio)
        L.append(src.pose.bones["lFoot"].head * ratio)
        R.append(src.pose.bones["rFoot"].head * ratio)
    n = len(H)
    FPS = 30

    def contacts(P):
        zmin = sorted(p.z for p in P)[max(0, n // 20)]
        out = []
        on = False
        for i in range(1, n - 1):
            vh = (
                Vector(((P[i + 1] - P[i - 1]).x, (P[i + 1] - P[i - 1]).y)).length
                * FPS
                / 2
            )
            low = P[i].z < zmin + 0.05 and vh < 1.2
            if low and not on:
                out.append(i)
            on = low
        return out

    cl, cr = contacts(L), contacts(R)
    cyc = []
    for a, b in zip(cl, cl[1:]):
        if b - a < 8 or b - a > 60:
            continue
        d = H[b] - H[a]
        dist = Vector((d.x, d.y)).length
        # duzluk: dongu boyunca kalca yatay hiz yonu degisimi (derece)
        v0 = H[a + 2] - H[a]
        v1 = H[b] - H[b - 2]
        ang = (
            math.degrees(Vector((v0.x, v0.y)).angle(Vector((v1.x, v1.y)), 0))
            if v0.length > 1e-4 and v1.length > 1e-4
            else 0
        )
        cyc.append(
            {
                "a": f0 + a,
                "b": f0 + b,
                "T": round((b - a) / FPS, 3),
                "v": round(dist / ((b - a) / FPS), 2),
                "turn": round(ang, 1),
            }
        )
    sp = [
        Vector(((H[i + 1] - H[i]).x, (H[i + 1] - H[i]).y)).length * FPS
        for i in range(n - 1)
    ]
    res[name] = {
        "frames": n,
        "ratio": round(ratio, 3),
        "vmean": round(sum(sp) / len(sp), 2),
        "vmax": round(max(sp), 2),
        "cycles": cyc,
    }
    print(
        "PROBE",
        name,
        "kare",
        n,
        "ort hiz %.2f maks %.2f" % (res[name]["vmean"], res[name]["vmax"]),
        "sol temas",
        [f0 + c for c in cl],
        "sag temas",
        [f0 + c for c in cr],
    )
    for c in cyc:
        print("   dongu", c)
    for o in [
        o
        for o in bpy.data.objects
        if o.name.startswith(name)
        or (o.type != "ARMATURE" and o.parent and o.parent.name.startswith(name))
    ]:
        bpy.data.objects.remove(o)
json.dump(res, open("/tmp/asci/loco/probe.json", "w"), indent=1)
