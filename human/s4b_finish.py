# Aşama 4b: kalınlık, deri iskelet bağı, gizli gövde silme, krampon çivisi, PBR malzemeler, glTF dışa aktarım
# Çalıştır: blender -b stage3.blend -P s4b_finish.py [-- noexport]
import bpy, bmesh, os, sys, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HAIR = __import__("os").environ.get("HAIR", "short02")
HERE = __import__("os").environ.get("HUMAN_DIR", "/home/ege/Blender-MCP/footballer/human")
T = f"{HERE}/tex"
DATA = os.path.expanduser("~/.config/blender/4.0/mpfb/data")
GLB = "/home/ege/Blender-MCP/footballer/viewer/public/futbolcu.glb"
HAIR_THIN = 0.6
args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

rig = bpy.data.objects["Human.rig"]
body = bpy.data.objects["Human"]
forma, sort, tozluk = (bpy.data.objects[n] for n in ("Forma", "Sort", "Tozluk"))
shoes = bpy.data.objects["Human.shoes05"]
bone_names = {b.name for b in rig.data.bones}


def activate(o):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


# ---- 1) gövdenin giysi altında kalan yüzlerini sil (ışın: normal yönünde giysiye çarpıyor mu) ----
dg = bpy.context.evaluated_depsgraph_get()
# oyun içi kumaş havalanır: giysi altındaki deri artık silinmez (kapalı gövde)
cover = []
body.data.update()
hit = set()
for v in body.data.vertices:
    p, n = v.co, v.normal
    for t in cover:
        loc, nn, i, d = t.ray_cast(p + n * 0.0005, n, 0.06)
        if loc is not None:
            hit.add(v.index)
            break
bm = bmesh.new()
bm.from_mesh(body.data)
bm.verts.ensure_lookup_table()
faces = {f for f in bm.faces if all(v.index in hit for v in f.verts)}
# kenardan içeri 3 halka geri çekil (kol ağzı/yaka/paçadan içeri bakınca boşluk görünmesin)
for _ in range(6):  # bol kumaş oyunda kalkınca delik görünmesin
    edge_v = {
        v for f in faces for v in f.verts if any(g not in faces for g in v.link_faces)
    }
    faces = {f for f in faces if not any(v in edge_v for v in f.verts)}
bmesh.ops.delete(bm, geom=list(faces), context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.to_mesh(body.data)
bm.free()
print("gövdeden silinen yüz", len(faces))

# ---- 1b) saç: kask görünümünü azaltmak için kafaya doğru incelt ----
hair_o = bpy.data.objects[f"Human.{HAIR}"]
bb = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
for v in hair_o.data.vertices:
    loc, n, i, d = bb.find_nearest(v.co)
    if loc is not None and 0.004 < d < 0.025:
        v.co = loc + (v.co - loc) * HAIR_THIN + n * 0.002

# ---- 2) giysi kalınlığı ----
# web bütçesi: kalınlık yerine çift yüzlü malzeme (SOLIDIFY=False)
SOLIDIFY = False
for o, th in ((forma, 0.0022), (sort, 0.0026), (tozluk, 0.0032)) if SOLIDIFY else ():
    activate(o)
    m = o.modifiers.new("Kalinlik", "SOLIDIFY")
    m.thickness = th
    m.offset = -1
    m.use_rim = True
    m.use_even_offset = False  # çift kalınlık sivri uç üretiyordu
    bpy.ops.object.modifier_apply(modifier="Kalinlik")
    bpy.ops.object.shade_smooth()

# ---- 3) krampon çivileri ----
sv = [shoes.matrix_world @ v.co for v in shoes.data.vertices]
studs = []
for sg, sfx in ((1, "l"), (-1, "r")):
    pts = [p for p in sv if p.x * sg > 0 and p.z < 0.012]
    if not pts:
        continue
    ys = [p.y for p in pts]
    y0, y1 = min(ys), max(ys)  # y0 burun (ön, -Y), y1 topuk
    L = y1 - y0
    cx = sum(p.x for p in pts) / len(pts)

    def width_at(y):
        xs = [p.x for p in pts if abs(p.y - y) < 0.01]
        return (min(xs), max(xs)) if xs else (cx - 0.03, cx + 0.03)

    spots = []
    for f, bone in ((0.12, "ball"), (0.30, "ball")):
        a, b = width_at(y0 + L * f)
        spots += [(a + 0.012, y0 + L * f, bone), (b - 0.012, y0 + L * f, bone)]
    spots += [((sum(width_at(y0 + L * 0.2)) / 2), y0 + L * 0.2, "ball")]
    for f in (0.78, 0.9):
        a, b = width_at(y0 + L * f)
        spots += [(a + 0.013, y0 + L * f, "foot"), (b - 0.013, y0 + L * f, "foot")]
    for x, y, bone in spots:
        bpy.ops.mesh.primitive_cone_add(
            vertices=8,
            radius1=0.0068,
            radius2=0.0045,
            depth=0.012,
            location=(x, y, -0.006),
        )
        s = bpy.context.object
        s.rotation_euler = (math.pi, 0, 0)
        g = s.vertex_groups.new(name=f"{bone}_{sfx}")
        g.add(list(range(len(s.data.vertices))), 1.0, "REPLACE")
        studs.append(s)
if studs:
    for x in bpy.context.selected_objects:
        x.select_set(False)
    for s in studs:
        s.select_set(True)
    bpy.context.view_layer.objects.active = studs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    st = bpy.context.object
    st.name = "Civiler"
    bpy.ops.object.shade_smooth()
    st.parent = rig
print("çivi", len(studs))


# ---- 4) malzemeler ----
def img(path, noncolor=False):
    if not os.path.exists(path):  # bazı saç modellerinde normal haritası yok: düz normal
        im = bpy.data.images.new("duz_normal", 4, 4)
        im.pixels = [0.5, 0.5, 1.0, 1.0] * 16
        im.colorspace_settings.name = "Non-Color"
        return im
    im = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    return im


def principled(
    name,
    base=None,
    base_img=None,
    rough=0.5,
    rough_img=None,
    normal_img=None,
    normal_strength=1.0,
    tile=None,
    alpha=False,
    blend="OPAQUE",
    extra=None,
):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bs.outputs[0], out.inputs[0])
    if base is not None:
        bs.inputs["Base Color"].default_value = base
    if base_img:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = base_img
        nt.links.new(t.outputs["Color"], bs.inputs["Base Color"])
        if alpha:
            nt.links.new(t.outputs["Alpha"], bs.inputs["Alpha"])
    bs.inputs["Roughness"].default_value = rough
    if rough_img:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = rough_img
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(t.outputs["Color"], sep.inputs[0])
        nt.links.new(sep.outputs[1], bs.inputs["Roughness"])
    if normal_img:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = normal_img
        if tile:
            tc = nt.nodes.new("ShaderNodeTexCoord")
            mp = nt.nodes.new("ShaderNodeMapping")
            mp.inputs["Scale"].default_value = (tile, tile, 1)
            nt.links.new(tc.outputs["UV"], mp.inputs[0])
            nt.links.new(mp.outputs[0], t.inputs[0])
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs[0], bs.inputs["Normal"])
    for k, v in (extra or {}).items():
        bs.inputs[k].default_value = v
    m.blend_method = blend
    if blend == "CLIP":
        m.alpha_threshold = 0.35
    if blend != "OPAQUE":
        m.shadow_method = "HASHED" if blend == "BLEND" else "CLIP"
    return m


def set_mat(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)
    for p in o.data.polygons:
        p.material_index = 0


def first_image(o, prefer=("diffuse",)):
    for s in o.material_slots:
        if s.material and s.material.node_tree:
            ims = [
                n.image
                for n in s.material.node_tree.nodes
                if n.type == "TEX_IMAGE" and n.image
            ]
            for p in prefer:
                for im in ims:
                    if p in im.name.lower():
                        return im
            if ims:
                return ims[0]
    return None


def uv_scale(o):
    """UV biriminin metre karşılığı"""
    me = o.data
    uv = me.uv_layers.active.data
    a3 = auv = 0.0
    for p in me.polygons:
        a3 += p.area
        cs = [uv[i].uv for i in p.loop_indices]
        s = 0.0
        for i in range(1, len(cs) - 1):
            s += abs((cs[i] - cs[0]).cross(cs[i + 1] - cs[0])) / 2
        auv += s
    return math.sqrt(a3 / max(auv, 1e-9))


skin = principled(
    "Deri",
    base_img=img(f"{T}/deri_albedo.jpg"),
    rough_img=img(f"{T}/deri_rough.jpg", True),
    normal_img=img(f"{T}/deri_normal.jpg", True),
    normal_strength=0.45,
    extra={
        "Subsurface Weight": 0.12,
        "Subsurface Radius": (1.0, 0.4, 0.22),
        "Subsurface Scale": 0.012,
        "Specular IOR Level": 0.45,
    },
)
set_mat(body, skin)

eyes = bpy.data.objects["Human.high-poly"]
eye_img = img(f"{DATA}/eyes/materials/brownlight_eye.png")
set_mat(
    eyes,
    principled(
        "Goz",
        base_img=eye_img,
        rough=0.06,
        extra={"Coat Weight": 1.0, "Coat Roughness": 0.02, "Specular IOR Level": 0.6},
    ),
)

for nm, rough in (("Human.teeth_base", 0.25), ("Human.tongue01", 0.4)):
    o = bpy.data.objects[nm]
    set_mat(o, principled(nm.split(".")[1], base_img=first_image(o), rough=rough))

for nm in (f"Human.{__import__('os').environ.get('BROW', 'eyebrow001')}", "Human.eyelashes01"):
    o = bpy.data.objects[nm]
    im = first_image(o, ("eyebrow", "eyelash", "png"))
    m = principled(
        nm.split(".")[1],
        base=(0.035, 0.024, 0.018, 1),
        base_img=None,
        rough=0.6,
        blend="BLEND",
    )
    # yalnız alfa dokudan; renk sabit koyu kahve
    nt = m.node_tree
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = im
    nt.links.new(t.outputs["Alpha"], nt.nodes["Principled BSDF"].inputs["Alpha"])
    set_mat(o, m)

hair = bpy.data.objects[f"Human.{HAIR}"]
set_mat(
    hair,
    principled(
        "Sac",
        base_img=img(f"{T}/sac_albedo.png"),
        alpha=True,
        rough=0.62,
        normal_img=img(f"{DATA}/hair/{HAIR}/{HAIR}_normal.png", True),
        normal_strength=0.3,
        extra={"Specular IOR Level": 0.3},
        blend="CLIP",
    ),
)

knit = img(f"{T}/kumas_normal.png", True)
TILE = 0.022  # örgü karosunun gerçek boyu (m)
set_mat(
    forma,
    principled(
        "Forma",
        base_img=img(f"{T}/forma_albedo.jpg"),
        rough=0.58,
        normal_img=knit,
        normal_strength=0.55,
        tile=uv_scale(forma) / TILE,
        extra={"Sheen Weight": 0.1, "Sheen Roughness": 0.4},
    ),
)
set_mat(
    sort,
    principled(
        "Sort",
        base_img=img(f"{T}/sort_albedo.jpg"),
        rough=0.66,
        normal_img=knit,
        normal_strength=0.4,
        tile=uv_scale(sort) / TILE,
        extra={"Sheen Weight": 0.2, "Sheen Roughness": 0.45},
    ),
)
set_mat(
    tozluk,
    principled(
        "Tozluk",
        base_img=img(f"{T}/tozluk_albedo.jpg"),
        rough=0.85,
        normal_img=knit,
        normal_strength=0.7,
        tile=uv_scale(tozluk) / 0.03,
    ),
)
set_mat(
    shoes,
    principled(
        "Krampon",
        base_img=img(f"{T}/krampon_albedo.jpg"),
        rough=0.32,
        extra={"Coat Weight": 0.3, "Coat Roughness": 0.15},
    ),
)
if studs:
    set_mat(
        st,
        principled(
            "Civi", base=(0.75, 0.6, 0.12, 1), rough=0.35, extra={"Metallic": 0.6}
        ),
    )

# ---- 5) deri iskelet bağı: giysiler gövde ağırlıklarını taşıyor; temizle, 4 etkiye sınırla ----
# kemik şekli gibi yardımcı nesneleri at
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)
skinned = [
    o
    for o in bpy.data.objects
    if o.type == "MESH" and (o.parent == rig or o in (forma, sort, tozluk))
]
for o in skinned:
    activate(o)
    for g in list(o.vertex_groups):
        if g.name not in bone_names:
            o.vertex_groups.remove(g)
    for m in list(o.modifiers):
        if m.type != "ARMATURE":
            o.modifiers.remove(m)
    if not any(m.type == "ARMATURE" for m in o.modifiers):
        am = o.modifiers.new("Armature", "ARMATURE")
        am.object = rig
    if o.parent != rig:
        mw = o.matrix_world.copy()
        o.parent = rig
        o.matrix_parent_inverse = rig.matrix_world.inverted()
    if o.vertex_groups:
        bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
        bpy.ops.object.vertex_group_normalize_all(
            group_select_mode="ALL", lock_active=False
        )
    for an in ():  # rest/rnorm/part/d_* s6'da numara UV'si ve pin ağırlığı için kalır
        if an in o.data.attributes:
            o.data.attributes.remove(o.data.attributes[an])

for o in (forma, sort, tozluk):
    o.name = o.data.name = {"Forma": "Forma", "Sort": "Sort", "Tozluk": "Tozluk"}[
        o.name
    ]
rig.name = "Futbolcu"
if studs:
    rig.location.z += 0.012  # çiviler zemine bassın
bpy.ops.wm.save_as_mainfile(filepath=f"{HERE}/stage4.blend")

if "noexport" not in args:
    for x in bpy.context.selected_objects:
        x.select_set(False)
    rig.select_set(True)
    for o in skinned:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_skins=True,
        export_animations=False,
        export_yup=True,
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_attributes=False,
    )
    print("GLB", GLB, os.path.getsize(GLB) / 1e6, "MB")
print("TAMAM")
