# CMU sut kliplerini incele (pisirmez): temas karesi, ayak tepe hizi, yaklasma hizi, pelvis yuksekligi egrisi, destek ayagi.
# Kullanim: blender -b -P bake_kick_probe.py
import bpy, math
from mathutils import Vector

import sys
CL = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else ["10_01", "10_02", "10_03", "10_05", "10_06", "11_01"]
FPS = 30
bpy.ops.wm.read_factory_settings(use_empty=True)
for name in CL:
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
        pb = src.pose.bones
        P[f] = {
            k: (src.matrix_world @ pb[k].head).copy()
            for k in (
                "rFoot",
                "lFoot",
                "hip",
                "rToe" if "rToe" in pb else "rFoot",
                "chest",
                "head",
            )
        }
    sc = 0.01 if P[f0]["hip"].z > 20 else 1.0  # cm -> m
    sp = {
        f: (P[f + 1]["rFoot"] - P[f]["rFoot"]).length * sc * FPS for f in range(f0 + 15, f1 - 25)
    }
    fm = max(sp, key=sp.get)
    tc = fm + 2
    v = P[tc + 1]["rFoot"] - P[tc - 3]["rFoot"]
    fwd = Vector((v.x, v.y, 0)).normalized()
    side = Vector((-fwd.y, fwd.x, 0))
    hip_v = (P[tc - 3]["hip"] - P[tc - 12]["hip"]) * sc * FPS / 9
    stand = max(P[f]["hip"].z for f in P) * sc
    print(
        f"== {name} kare {f0}-{f1} ({(f1 - f0) / FPS:.1f}s) tepeHiz {sp[fm]:.1f} m/s @ {fm}, temas {tc}, yaklasma hizi {Vector((hip_v.x, hip_v.y)).length:.2f} m/s, en yuksek kalca {stand:.2f}"
    )
    for f in range(max(f0, tc - 18), min(f1, tc + 20) + 1, 2):
        h = P[f]["hip"]
        r = P[f]["rFoot"]
        l = P[f]["lFoot"]
        c = P[f]["chest"]
        hd = P[f]["head"]
        rel = lambda x: ((x - P[tc]["hip"]) * sc)
        print(
            f"  {f - tc:+3d} kalcaZ {h.z * sc:.3f} sagF z{rel(r).dot(fwd):+.2f} y{r.z * sc:.2f} x{rel(r).dot(side):+.2f} | solF z{rel(l).dot(fwd):+.2f} y{l.z * sc:.2f} x{rel(l).dot(side):+.2f} | gogus-kalca ileri {((c - h) * sc).dot(fwd):+.2f} bas z{hd.z * sc:.2f} | v {(P[f + 1]["rFoot"] - P[f]["rFoot"]).length * sc * FPS if f + 1 in P else 0:.1f}"
        )
    for o in [o for o in bpy.data.objects]:
        bpy.data.objects.remove(o)
