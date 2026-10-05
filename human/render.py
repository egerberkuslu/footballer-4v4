# Önizleme render'ı: blender -b <blend> -P render.py -- <çıktı_öneki> [örnek] [görünümler]
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
out = argv[0] if argv else "/home/ege/Blender-MCP/footballer/human/preview"
samples = int(argv[1]) if len(argv) > 1 else 64
views = argv[2].split(",") if len(argv) > 2 else ["on", "uc_ceyrek", "yuz"]
res = int(argv[3]) if len(argv) > 3 else 900

sc = bpy.context.scene
sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
for t in ("OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = t
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type != "CPU"
        break
    except Exception:
        pass
sc.cycles.device = "GPU"
sc.cycles.samples = samples
sc.cycles.use_denoising = False
sc.cycles.use_adaptive_sampling = True
sc.render.film_transparent = False
sc.view_settings.view_transform = (
    "AgX" if hasattr(sc.view_settings, "view_transform") else "Filmic"
)
sc.view_settings.view_transform = "Filmic"
sc.view_settings.look = "Medium High Contrast"
sc.view_settings.exposure = -0.35

# önceki önizleme nesnelerini temizle
for o in list(bpy.data.objects):
    if o.name.startswith("PV_"):
        bpy.data.objects.remove(o)

# dünya: gökyüzü + yumuşak ışık
w = bpy.data.worlds.new("PV_world")
sc.world = w
w.use_nodes = True
nt = w.node_tree
nt.nodes.clear()
sky = nt.nodes.new("ShaderNodeTexSky")
sky.sky_type = "NISHITA"
sky.sun_elevation = math.radians(35)
sky.sun_rotation = math.radians(200)
sky.sun_intensity = 0.25
bg = nt.nodes.new("ShaderNodeBackground")
bg.inputs[1].default_value = 0.22
o_ = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(sky.outputs[0], bg.inputs[0])
nt.links.new(bg.outputs[0], o_.inputs[0])


def light(name, typ, loc, energy, size=1.0, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, typ)
    ld.energy = energy
    ld.color = color
    if typ == "AREA":
        ld.size = size
    ob = bpy.data.objects.new(name, ld)
    sc.collection.objects.link(ob)
    ob.location = loc
    d = Vector((0, 0, 1.2)) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


light("PV_key", "AREA", (-2.2, -3.0, 2.8), 420, 2.0, (1, 0.96, 0.9))
light("PV_fill", "AREA", (3.0, -2.5, 1.6), 110, 3.0, (0.85, 0.9, 1))
light("PV_rim", "AREA", (0.5, 3.0, 2.6), 350, 1.5)

# zemin
me = bpy.data.meshes.new("PV_floor")
import bmesh

bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6)
bm.to_mesh(me)
fl = bpy.data.objects.new("PV_floor", me)
sc.collection.objects.link(fl)
mat = bpy.data.materials.new("PV_floor")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
    0.12,
    0.16,
    0.1,
    1,
)
mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
me.materials.append(mat)

cams = {
    "on": ((0, -4.6, 1.0), (0, 0, 0.92), 50),
    "uc_ceyrek": ((2.8, -3.6, 1.35), (0, 0, 0.95), 50),
    "yuz": ((0.35, -0.95, 1.70), (0.0, 0, 1.64), 85),
    "goz": ((0.12, -0.55, 1.69), (-0.005, -0.1, 1.682), 140),
    "ense": ((-0.45, 0.95, 1.72), (0.0, 0, 1.64), 85),
    "ense_yan": ((0.95, 0.45, 1.70), (0.0, 0, 1.64), 85),
    "kalca": ((0.9, -1.8, 1.05), (0.05, -0.1, 0.92), 55),
    "kalca_yan": ((2.0, 0.0, 1.0), (0, -0.05, 0.92), 55),
    "tepe": ((0.0, -0.45, 2.45), (0, -0.05, 1.8), 70),
    "arka": ((0, 4.6, 1.0), (0, 0, 0.92), 50),
    "yan": ((4.6, 0, 1.0), (0, 0, 0.92), 50),
    "el": ((0.75, -0.75, 0.95), (0.28, -0.05, 0.86), 85),
    "govde": ((0.9, -2.2, 1.3), (0, 0, 1.15), 60),
}
for v in views:
    loc, tgt, lens = cams[v]
    cd = bpy.data.cameras.new("PV_cam")
    cd.lens = lens
    cam = bpy.data.objects.new("PV_cam_" + v, cd)
    sc.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    portrait = v not in ("yuz", "goz", "ense", "ense_yan", "kalca", "kalca_yan", "tepe")
    sc.render.resolution_x = int(res * (0.62 if portrait else 1.0))
    sc.render.resolution_y = res
    sc.render.filepath = f"{out}_{v}.png"
    bpy.ops.render.render(write_still=True)
    print("YAZILDI", sc.render.filepath)
