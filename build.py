"""Basit futbolcu + cloth simulasyonlu forma. Calistir: blender -b -P build.py"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Vector

OUT = "/home/ege/Blender-MCP/footballer"
SEG = 48
END_FRAME = 90

for _o in list(bpy.data.objects):
    bpy.data.objects.remove(_o, do_unlink=True)
for _m in list(bpy.data.meshes):
    bpy.data.meshes.remove(_m)
scene = bpy.context.scene
OUT = "/home/ege/Blender-MCP/footballer"
scene.frame_start, scene.frame_end = 1, END_FRAME


def mat(name, color, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    return m


def resample(rings, n):
    arr = np.array(rings, dtype=float)
    z = arr[:, 0]
    zz = np.linspace(z.min(), z.max(), n)
    order = np.argsort(z)
    cols = [np.interp(zz, z[order], arr[order, i]) for i in range(arr.shape[1])]
    return list(zip(*cols))[::-1]  # yukaridan asagiya


def loft(name, rings, cap=True, n=None, center=(0.0, 0.0)):
    """rings: (z, rx, ry[, cx, cy]) listesi. Eliptik halkalardan tup mesh."""
    if n:
        rings = resample([(r + (0, 0))[:5] if len(r) == 3 else r for r in rings], n)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    rows = []
    for r in rings:
        z, rx, ry = r[0], r[1], r[2]
        cx = (r[3] if len(r) > 3 else 0.0) + center[0]
        cy = (r[4] if len(r) > 4 else 0.0) + center[1]
        rows.append(
            [
                bm.verts.new(
                    (
                        cx + rx * math.cos(2 * math.pi * k / SEG),
                        cy + ry * math.sin(2 * math.pi * k / SEG),
                        z,
                    )
                )
                for k in range(SEG)
            ]
        )
    nr = len(rows)
    for i in range(nr - 1):
        for k in range(SEG):
            k2 = (k + 1) % SEG
            f = bm.faces.new((rows[i][k], rows[i + 1][k], rows[i + 1][k2], rows[i][k2]))
            for loop, (u, v) in zip(
                f.loops,
                [(k, i), (k, i + 1), (k + 1, i + 1), (k + 1, i)],
            ):
                loop[uv].uv = (u / SEG, 1 - v / (nr - 1))
    if cap:
        bm.faces.new(rows[0])
        bm.faces.new(rows[-1][::-1])
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def smooth(ob, levels=2):
    m = ob.modifiers.new("Sub", "SUBSURF")
    m.levels = m.render_levels = levels


def sphere(name, loc, scale, material, r=1.0):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=r, location=loc, segments=32, ring_count=16
    )
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    ob.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return ob


SKIN = mat("skin", (0.80, 0.55, 0.42), 0.55)
HAIR = mat("hair", (0.05, 0.035, 0.03), 0.7)
SHORTS = mat("shorts", (0.92, 0.92, 0.92), 0.7)
SOCK = mat("sock", (0.75, 0.05, 0.06), 0.8)
BOOT = mat("boot", (0.03, 0.03, 0.03), 0.35)
GRASS = mat("grass", (0.08, 0.30, 0.08), 0.95)

# ---------- govde ----------
torso_rings = [
    (0.95, 0.18, 0.11),
    (1.10, 0.17, 0.10),
    (1.25, 0.19, 0.115),
    (1.38, 0.21, 0.12),
    (1.44, 0.17, 0.10),
    (1.48, 0.09, 0.075),
    (1.52, 0.055, 0.055),
]
torso = loft("torso", torso_rings, n=40)
torso.data.materials.append(SKIN)
smooth(torso)

pelvis = loft("pelvis", [(0.86, 0.19, 0.115), (1.0, 0.185, 0.115)], n=6)
pelvis.data.materials.append(SHORTS)
smooth(pelvis, 1)

neck = loft("neck", [(1.50, 0.05, 0.05), (1.60, 0.045, 0.045)], n=4)
neck.data.materials.append(SKIN)
smooth(neck, 1)
head = sphere("head", (0, 0.005, 1.68), (0.98, 1.05, 1.12), SKIN, 0.11)
hair = sphere("hair", (0, -0.012, 1.705), (1.0, 1.04, 1.05), HAIR, 0.113)
hair.scale.z = 0.9
nose = sphere("nose", (0, 0.108, 1.675), (0.5, 0.6, 0.9), SKIN, 0.02)

for s in (-1, 1):
    x = 0.095 * s
    leg = loft(
        f"leg{s}",
        [
            (0.95, 0.095, 0.095),
            (0.72, 0.082, 0.082),
            (0.50, 0.056, 0.058),
            (0.30, 0.05, 0.05),
            (0.10, 0.038, 0.04),
        ],
        n=24,
        center=(x, 0),
    )
    leg.data.materials.append(SKIN)
    smooth(leg)
    short = loft(
        f"short{s}",
        [(1.0, 0.105, 0.105), (0.60, 0.115, 0.115)],
        n=10,
        center=(x, 0),
        cap=False,
    )
    short.data.materials.append(SHORTS)
    smooth(short, 1)
    sock = loft(
        f"sock{s}",
        [(0.46, 0.060, 0.062), (0.30, 0.056, 0.056), (0.08, 0.044, 0.046)],
        n=12,
        center=(x, 0),
    )
    sock.data.materials.append(SOCK)
    smooth(sock, 1)
    boot = sphere(f"boot{s}", (x, 0.04, 0.045), (0.5, 1.45, 0.62), BOOT, 0.09)
    arm = loft(
        f"arm{s}",
        [
            (1.42, 0.058, 0.058),
            (1.20, 0.05, 0.05),
            (1.00, 0.042, 0.042),
            (0.82, 0.034, 0.034),
        ],
        n=20,
        center=(0.31 * s, 0),
    )
    arm.data.materials.append(SKIN)
    smooth(arm)
    hand = sphere(f"hand{s}", (0.31 * s, 0, 0.78), (0.8, 1.0, 1.25), SKIN, 0.04)
    arm.parent = None

# ---------- forma (cloth) ----------
jersey_mat = bpy.data.materials.new("jersey")
jersey_mat.use_nodes = True
nt = jersey_mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.85
uvn = nt.nodes.new("ShaderNodeTexCoord")
wave = nt.nodes.new("ShaderNodeTexWave")
wave.wave_type, wave.bands_direction = "BANDS", "X"
wave.inputs["Scale"].default_value = 8.0
wave.inputs["Distortion"].default_value = 0
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.interpolation = "CONSTANT"
ramp.color_ramp.elements[0].color = (0.70, 0.04, 0.05, 1)
ramp.color_ramp.elements[1].position = 0.5
ramp.color_ramp.elements[1].color = (0.95, 0.68, 0.05, 1)
nt.links.new(uvn.outputs["UV"], wave.inputs["Vector"])
nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])


def make_cloth(name, rings, center, pin_top, n):
    ob = loft(name, rings, cap=False, n=n, center=center)
    ob.data.materials.append(jersey_mat)
    vg = ob.vertex_groups.new(name="pin")
    zmax = max(v.co.z for v in ob.data.vertices)
    dz = (zmax - min(v.co.z for v in ob.data.vertices)) / (n - 1)
    vg.add(
        [v.index for v in ob.data.vertices if v.co.z > zmax - pin_top * dz - 1e-6],
        1.0,
        "REPLACE",
    )
    cl = ob.modifiers.new("Cloth", "CLOTH")
    s = cl.settings
    s.quality = 10
    s.mass = 0.25
    s.tension_stiffness = s.compression_stiffness = 15
    s.shear_stiffness = 6
    s.bending_stiffness = 0.6
    s.air_damping = 1.2
    s.vertex_group_mass = "pin"
    c = cl.collision_settings
    c.use_collision = True
    c.distance_min = 0.004
    c.collision_quality = 4
    c.use_self_collision = True
    c.self_distance_min = 0.003
    sol = ob.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.003
    smooth(ob, 1)
    return ob


# gevsek, hafif genisleyen govde formasi
d = 0.012
jersey_rings = [
    (0.80, 0.245, 0.175),
    (0.95, 0.225, 0.155),
    (1.10, 0.215, 0.135),
    (1.25, 0.225, 0.14),
    (1.38, 0.225, 0.135),
    (1.44, 0.185, 0.115),
    (1.48, 0.105, 0.09),
    (1.515, 0.07, 0.07),
]
jersey = make_cloth("jersey", jersey_rings, (0, 0), pin_top=3, n=44)
sleeves = []
for s_ in (-1, 1):
    sl = make_cloth(
        f"sleeve{s_}",
        [
            (1.45, 0.075, 0.075),
            (1.36, 0.075, 0.075),
            (1.26, 0.075, 0.075),
            (1.17, 0.075, 0.075),
        ],
        (0.31 * s_, 0),
        pin_top=2,
        n=14,
    )
    sleeves.append(sl)

for ob in [
    torso,
    pelvis,
    *[o for o in bpy.data.objects if o.name.startswith(("arm", "short"))],
]:
    ob.modifiers.new("Col", "COLLISION")
    ob.collision.thickness_outer = 0.002

# ruzgar: forma hafifce dalgalansin
bpy.ops.object.effector_add(
    type="WIND", location=(0, -2, 1.2), rotation=(math.radians(-90), 0, 0)
)
wind = bpy.context.object
wind.field.strength = 0
wind.field.noise = 0.6
wind.keyframe_insert("field.strength", frame=1)
wind.field.strength = 120
wind.keyframe_insert("field.strength", frame=END_FRAME - 30)
wind.field.strength = 0
wind.keyframe_insert("field.strength", frame=END_FRAME)
wind.field.apply_to_location = False

# ---------- zemin, isik, kamera ----------
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
bpy.context.object.data.materials.append(GRASS)
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.65, 0.8, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
bpy.ops.object.light_add(
    type="SUN", location=(3, -3, 5), rotation=(math.radians(50), 0, math.radians(35))
)
bpy.context.object.data.energy = 4
bpy.ops.object.light_add(type="AREA", location=(-3, -3, 2.5))
bpy.context.object.data.energy = 250
bpy.context.object.data.size = 3
bpy.context.object.rotation_euler = (math.radians(70), 0, math.radians(-40))


def add_cam(name, loc, target):
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.object
    cam.name = name
    cam.data.lens = 60
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return cam


cam_front = add_cam("cam_front", (1.9, -3.9, 1.35), (0, 0, 0.88))
cam_back = add_cam("cam_back", (-1.9, 3.9, 1.35), (0, 0, 0.88))

scene.render.engine = "CYCLES"
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1080, 1350

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "futbolcu.blend"))
print("BUILT")
