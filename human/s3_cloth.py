# Aşama 3: şort ve forma kumaş simülasyonu (gövdeye oturt, kıvrımlar), sonucu uygula -> stage3.blend
# Çalıştır: blender -b stage2.blend -P s3_cloth.py
import bpy, sys, time

HERE = __import__("os").environ.get("HUMAN_DIR", "/home/ege/Blender-MCP/footballer/human")
sc = bpy.context.scene
body = bpy.data.objects["Human"]


def activate(o):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def collider(o, outer=0.004):
    m = o.modifiers.new("Carpisma", "COLLISION")
    o.collision.thickness_outer = outer
    o.collision.thickness_inner = 0.02
    o.collision.cloth_friction = 6.0
    o.collision.damping = 0.4
    return m


def pin_group(o, attr, limit, name="pin"):
    a = o.data.attributes[attr].data
    g = o.vertex_groups.new(name=name)
    for i, d in enumerate(a):
        if d.value < limit:
            g.add([i], 1.0 - d.value / limit * 0.6, "REPLACE")
    return g


def simulate(o, frames, mass, stiff, bend, pin=None, self_col=False, shrink=0.0):
    activate(o)
    m = o.modifiers.new("Kumas", "CLOTH")
    s = m.settings
    s.quality = 10
    s.mass = mass
    s.air_damping = 2.0
    s.tension_stiffness = s.compression_stiffness = stiff
    s.shear_stiffness = stiff * 0.5
    s.bending_stiffness = bend
    s.tension_damping = s.compression_damping = 5
    s.bending_damping = 0.5
    s.shrink_min = shrink
    if pin:
        s.vertex_group_mass = pin
        s.pin_stiffness = 1.0
    c = m.collision_settings
    c.collision_quality = 4
    c.distance_min = 0.003
    c.use_self_collision = self_col
    c.self_distance_min = 0.002
    c.self_friction = 5
    m.point_cache.frame_start = 1
    m.point_cache.frame_end = frames
    t = time.time()
    for f in range(1, frames + 1):
        sc.frame_set(f)
    print(o.name, "sim", frames, "kare", round(time.time() - t, 1), "s")
    bpy.ops.object.modifier_apply(modifier="Kumas")
    sc.frame_set(1)


sc.frame_start, sc.frame_end = 1, 80
sort = bpy.data.objects["Sort"]
forma = bpy.data.objects["Forma"]

# sim öncesi dinlenme konumu/normali ve kol bölgesi: desen kumaşı izlesin diye
for o in (
    bpy.data.objects["Forma"],
    bpy.data.objects["Sort"],
    bpy.data.objects["Tozluk"],
):
    me = o.data
    me.update()
    for nm, tp in (("rest", "FLOAT_VECTOR"), ("rnorm", "FLOAT_VECTOR"), ("part", "FLOAT")):
        if nm not in me.attributes:
            me.attributes.new(nm, tp, "POINT")
    # öznitelik eklemek belleği yeniden ayırır: referansları ancak hepsi eklendikten sonra al
    gi = {g.name: g.index for g in o.vertex_groups}
    ua = {gi[n] for n in ("upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r") if n in gi}
    co = [c for v in me.vertices for c in v.co]
    no = [c for v in me.vertices for c in v.normal]
    pt = [sum(g.weight for g in v.groups if g.group in ua) for v in me.vertices]
    me.attributes["rest"].data.foreach_set("vector", co)
    me.attributes["rnorm"].data.foreach_set("vector", no)
    me.attributes["part"].data.foreach_set("value", pt)

collider(body)
# şort: bel lastiği iğneli, paçalar serbest düşer
simulate(
    sort, 45, 0.12, 10, 0.4, pin=pin_group(sort, "d_bel", 0.03).name, self_col=False
)
# forma: omuzlardan asılı serbest dökülme; yaka hafif iğneli
simulate(
    forma, 55, 0.15, 12, 0.35, pin=pin_group(forma, "d_yaka", 0.02).name, self_col=False
)

# forma eteği şortun içine girmesin: statik düzeltme (itme + yerel yumuşatma)
import bmesh
from mathutils.bvhtree import BVHTree

sb = BVHTree.FromObject(sort, bpy.context.evaluated_depsgraph_get())
bm = bmesh.new()
bm.from_mesh(forma.data)
moved = set()
for it in range(6):
    for v in bm.verts:
        if v.co.z > 1.06:
            continue
        loc, nrm, i, d = sb.find_nearest(v.co)
        if loc is None or d > 0.05:
            continue
        sd = (v.co - loc).dot(nrm)
        if sd < 0.013:
            v.co += nrm * (0.013 - sd)
            moved.add(v)
    ring = {o for v in moved for e in v.link_edges for o in (e.other_vert(v),)} | moved
    bmesh.ops.smooth_vert(bm, verts=[v for v in ring if not v.is_boundary], factor=0.4, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.to_mesh(forma.data)
bm.free()
print("şorttan dışarı itilen forma tepesi", len(moved))

for o in (body,):
    for m in list(o.modifiers):
        if m.type == "COLLISION":
            o.modifiers.remove(m)
bpy.ops.wm.save_as_mainfile(filepath=f"{HERE}/stage3.blend")
print("TAMAM")
