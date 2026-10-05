# Aşama 4a: giysiler için desen girdilerini UV'ye pişir (dinlenme konumu/normali, kenar mesafeleri, AO) -> bake/*.npy
# Çalıştır: blender -b stage3.blend -P s4a_bake.py
import bpy, os
import numpy as np

HERE = __import__("os").environ.get("HUMAN_DIR", "/home/ege/Blender-MCP/footballer/human")
OUT = f"{HERE}/bake"
os.makedirs(OUT, exist_ok=True)
RES = 2048
sc = bpy.context.scene
sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "CUDA"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type != "CPU"
    sc.cycles.device = "GPU"
except Exception:
    pass
sc.cycles.samples = 1
sc.cycles.use_denoising = False
sc.render.bake.margin = 16


def activate(o):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def bake_emit(o, build, name, samples=1, typ="EMIT"):
    """build(nt) -> emisyona bağlanacak renk soketi; sonuç float RGBA numpy"""
    img = bpy.data.images.new(name, RES, RES, float_buffer=True, alpha=True)
    img.generated_color = (0, 0, 0, 0)
    mat = bpy.data.materials.new("bake_" + name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if typ == "EMIT":
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(build(nt), em.inputs[0])
        nt.links.new(em.outputs[0], out.inputs[0])
    else:
        bs = nt.nodes.new("ShaderNodeBsdfDiffuse")
        nt.links.new(bs.outputs[0], out.inputs[0])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    n = max(1, len(o.data.materials))
    o.data.materials.clear()
    for _ in range(n):
        o.data.materials.append(mat)
    activate(o)
    sc.cycles.samples = samples
    bpy.ops.object.bake(type=typ, margin=16, use_clear=True)
    a = np.empty(RES * RES * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(RES, RES, 4)


def attr_vec(nt, name, scale=0.5, off=0.5):
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = name
    vm = nt.nodes.new("ShaderNodeVectorMath")
    vm.operation = "MULTIPLY_ADD"
    vm.inputs[1].default_value = (scale, scale, scale)
    vm.inputs[2].default_value = (off, off, off)
    nt.links.new(at.outputs["Vector"], vm.inputs[0])
    return vm.outputs[0]


def attr_pack(names):
    def b(nt):
        cmb = nt.nodes.new("ShaderNodeCombineXYZ")
        for i, n in enumerate(names):
            if n is None:
                continue
            at = nt.nodes.new("ShaderNodeAttribute")
            at.attribute_name = n
            nt.links.new(at.outputs["Fac"], cmb.inputs[i])
        return cmb.outputs[0]

    return b


jobs = {
    "Forma": ["d_yaka", "d_kol", "d_etek"],
    "Sort": ["d_bel", "d_paca", None],
    "Tozluk": ["d_ust", None, None],
}
for name, attrs in jobs.items():
    o = bpy.data.objects[name]
    rest = bake_emit(o, lambda nt: attr_vec(nt, "rest"), name + "_rest")
    rn = bake_emit(o, lambda nt: attr_vec(nt, "rnorm"), name + "_rnorm")
    at = bake_emit(o, attr_pack(attrs), name + "_attr")
    pt = bake_emit(o, attr_pack(["part", None, None]), name + "_part")
    ao = bake_emit(o, None, name + "_ao", samples=64, typ="AO")
    np.savez_compressed(
        f"{OUT}/{name}.npz",
        rest=rest[..., :3] * 2 - 1,
        rnorm=rn[..., :3] * 2 - 1,
        attr=at[..., :3],
        part=pt[..., 0],
        ao=ao[..., 0],
        mask=rest[..., 3],
    )
    o.data.materials.clear()
    print("PİŞTİ", name)

# gövde: yüz/kafa bölge maskeleri için konum ve normal haritası (+ yer işaretleri)
import json


def geo(sock):
    def b(nt):
        g = nt.nodes.new("ShaderNodeNewGeometry")
        vm = nt.nodes.new("ShaderNodeVectorMath")
        vm.operation = "MULTIPLY_ADD"
        vm.inputs[1].default_value = (0.5, 0.5, 0.5)
        vm.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(g.outputs[sock], vm.inputs[0])
        return vm.outputs[0]

    return b


body = bpy.data.objects["Human"]
saved = [s.material for s in body.material_slots]
pos = bake_emit(body, geo("Position"), "body_pos")
nrm = bake_emit(body, geo("Normal"), "body_nrm")
body.data.materials.clear()
for m in saved:
    body.data.materials.append(m)
np.savez_compressed(f"{OUT}/Human.npz", pos=pos[..., :3] * 2 - 1, nrm=nrm[..., :3] * 2 - 1, mask=pos[..., 3])
eyes = bpy.data.objects["Human.high-poly"]
ev = [eyes.matrix_world @ v.co for v in eyes.data.vertices]
lm = {
    "eye_l": [float(x) for x in np.mean([tuple(v) for v in ev if v.x > 0], 0)],
    "eye_r": [float(x) for x in np.mean([tuple(v) for v in ev if v.x < 0], 0)],
}
rig = bpy.data.objects["Human.rig"]
for b in ("head", "neck_01"):
    lm[b] = [[float(x) for x in rig.data.bones[b].head_local], [float(x) for x in rig.data.bones[b].tail_local]]
json.dump(lm, open(f"{OUT}/landmarks.json", "w"), indent=1)
print("PİŞTİ gövde", lm)
