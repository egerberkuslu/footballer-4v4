# Aşama 2: duruşu dinlenme pozu yap, yardımcıları sil, giysi kabuklarını gövdeden üret -> stage2.blend
# Çalıştır: blender -b stage1.blend -P s2_shells.py
import bpy, bmesh, math, heapq
from mathutils import Vector

HERE = __import__("os").environ.get("HUMAN_DIR", "/home/ege/Blender-MCP/footballer/human")
body = bpy.data.objects["Human"]
rig = bpy.data.objects["Human.rig"]
meshes = [o for o in bpy.data.objects if o.type == "MESH"]


def activate(o):
    bpy.ops.object.mode_set(
        mode="OBJECT"
    ) if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


# ---- 1) pozu dinlenme pozu yap ----
for o in meshes:
    activate(o)
    for m in list(o.modifiers):
        if m.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=m.name)
activate(rig)
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")

# ---- 2) gövde: yardımcı geometriyi ve ayakkabı altındaki ayağı sil ----
activate(body)
gi_body = body.vertex_groups["body"].index
gi_shoe = (
    body.vertex_groups["Delete.shoes05"].index
    if "Delete.shoes05" in body.vertex_groups
    else -1
)
bm = bmesh.new()
bm.from_mesh(body.data)
dl = bm.verts.layers.deform.active
kill = [
    v
    for v in bm.verts
    if gi_body not in v[dl] or (gi_shoe >= 0 and v[dl].get(gi_shoe, 0) > 0.5)
]
bmesh.ops.delete(bm, geom=kill, context="VERTS")
bm.to_mesh(body.data)
bm.free()
for m in list(body.modifiers):
    if m.type == "MASK":
        body.modifiers.remove(m)
# yardımcı/eklem grupları gereksiz
for vg in list(body.vertex_groups):
    if vg.name.startswith(("helper-", "joint-", "Delete.")) or vg.name in (
        "body",
        "Mid",
        "Left",
        "Right",
    ):
        pass
bpy.ops.object.shade_smooth()

# ---- 3) bölge seçimi ----
bones = {b.name: b for b in rig.data.bones}


def bone_t(co, name):
    b = bones[name]
    h, t = b.head_local, b.tail_local
    d = t - h
    return (co - h).dot(d) / d.length_squared


me = body.data
vg_name = {g.index: g.name for g in body.vertex_groups}


def weights(v):
    return {vg_name[g.group]: g.weight for g in v.groups if vg_name[g.group] in bones}


def w(ws, *names):
    return sum(ws.get(n, 0.0) for n in names)


def region(kind):
    """kaba (cömert) bölge; temiz kenarları sonra düzlem kesimleri verir"""
    sel = set()
    for v in me.vertices:
        ws = weights(v)
        co = v.co
        if kind == "jersey":
            if w(ws, "head") > 0.3 or w(ws, "lowerarm_l", "lowerarm_r", "hand_l", "hand_r") > 0.3:
                continue
            if co.z < HEM_Z - 0.03 or (abs(co.x) < 0.07 and co.z < 0.87):
                continue
            sel.add(v.index)
        elif kind == "shorts":
            if co.z > WAIST_Z + 0.04 or w(ws, "spine_02", "spine_03") > 0.3:
                continue
            if w(ws, "calf_l", "calf_r") > 0.3:
                continue
            if w(ws, "pelvis", "thigh_l", "thigh_r", "spine_01", "calf_l", "calf_r") < 0.9:
                continue  # el/parmak gibi yabancı parçalar
            s = "l" if co.x > 0 else "r"
            if bone_t(co, f"thigh_{s}") > SHORTS_T + 0.12:
                continue
            sel.add(v.index)
        elif kind == "socks":
            if w(ws, "calf_l", "calf_r", "foot_l", "foot_r", "ball_l", "ball_r") < 0.5:
                continue
            s = "l" if co.x > 0 else "r"
            if bone_t(co, f"calf_{s}") < SOCK_T - 0.08:
                continue
            sel.add(v.index)
    return sel


HEM_Z = 0.925  # belin (~1.02) ~10 cm altı; şortun üstüne sarkan etek
SLEEVE_T = 0.50
WAIST_Z = 1.02
SHORTS_T = 0.58
SOCK_T = 0.17


def bone_pt(name, t):
    b = bones[name]
    return b.head_local + (b.tail_local - b.head_local) * t, (b.tail_local - b.head_local).normalized()


def axis_dist(c, name):
    b = bones[name]
    h, d = b.head_local, (b.tail_local - b.head_local).normalized()
    r = c - h
    return (r - d * r.dot(d)).length


def cuts_for(kind):
    """(nokta, normal[+ tarafı silinir], yüz süzgeci)"""
    out = []
    if kind == "jersey":
        out.append((Vector((0, 0, HEM_Z)), Vector((0, 0, -1)), lambda c: True))
        for s in "lr":
            p, d = bone_pt(f"upperarm_{s}", SLEEVE_T)
            nm = f"upperarm_{s}"
            out.append((p, d, lambda c, nm=nm, p=p, d=d: axis_dist(c, nm) < 0.09 and abs(c.x) > abs(p.x) - 0.06 and (c - bones[nm].head_local).dot(d) > 0.05))
        nk = bones["neck_01"].head_local
        out.append((nk + Vector((0, 0, 0.012)), Vector((0, -0.55, 1)).normalized(), lambda c: c.z > 1.38 and abs(c.x) < 0.16))
    elif kind == "shorts":
        out.append((Vector((0, 0, WAIST_Z)), Vector((0, 0, 1)), lambda c: True))
        for s, sg in (("l", 1), ("r", -1)):
            p, d = bone_pt(f"thigh_{s}", SHORTS_T)
            out.append((p, d, lambda c, sg=sg: c.x * sg > 0.015 and c.z < 0.86))
    elif kind == "socks":
        for s, sg in (("l", 1), ("r", -1)):
            p, d = bone_pt(f"calf_{s}", SOCK_T)
            out.append((p, -d, lambda c, sg=sg: c.x * sg > 0 and c.z > 0.25))
    return out


def face_sel(vsel):
    return [p.index for p in me.polygons if all(i in vsel for i in p.vertices)]


def drop_small(bm, min_faces=60):
    bm.faces.ensure_lookup_table()
    left = set(bm.faces)
    kill = []
    while left:
        st = [left.pop()]
        comp = []
        while st:
            f = st.pop()
            comp.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g in left:
                        left.remove(g)
                        st.append(g)
        if len(comp) < min_faces:
            kill += comp
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")


from mathutils.bvhtree import BVHTree

body_bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())


def push_out(bm, off, k=1.0):
    for v in bm.verts:
        o = (off(v.co) if callable(off) else off) * k
        loc, n, i, dd = body_bvh.find_nearest(v.co)
        if loc is None:
            continue
        sd = (v.co - loc).dot(n)
        if sd < o:
            v.co = v.co + n * (o - sd)  # teğetsel aralık korunsun


def make_shell(name, faces, offset, cuts, smooth_rounds=6, subdiv=1):
    ob = body.copy()
    ob.data = body.data.copy()
    ob.name = ob.data.name = name
    ob.modifiers.clear()
    bpy.context.scene.collection.objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    keep = set(faces)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    for co, no, filt in cuts:
        geom = [f for f in bm.faces if filt(f.calc_center_median())]
        es = {e for f in geom for e in f.edges}
        vs = {v for f in geom for v in f.verts}
        bmesh.ops.bisect_plane(bm, geom=list(vs) + list(es) + geom, plane_co=co, plane_no=no, clear_outer=True)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # kesimin bıraktığı çok kısa kenarları kaynakla (kumaş yayları patlamasın)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.006)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.004)
    drop_small(bm)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.materials.clear()
    activate(ob)
    if subdiv:
        m = ob.modifiers.new("sub", "SUBSURF")
        m.subdivision_type = "SIMPLE"
        m.levels = subdiv
        bpy.ops.object.modifier_apply(modifier="sub")
    # şişir, sonra yumuşat+dışarı it döngüsü (meme/göbek gibi detayları siler)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * (offset(v.co) if callable(offset) else offset)
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(smooth_rounds):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        push_out(bm, offset)
    # kenar halkalarını da hafifçe düzle
    bnd = [v for v in bm.verts if v.is_boundary]
    for _ in range(8):
        bmesh.ops.smooth_vert(bm, verts=bnd, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    push_out(bm, offset, 0.8)
    # oyuklarda (kalça çizgisi vb.) üst üste binen tepeleri kaynakla
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0035)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.002)
    bm.to_mesh(ob.data)
    bm.free()
    bpy.ops.object.shade_smooth()
    # UV
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def ring_distance(ob, seed_pred, attr):
    """seed_pred'i sağlayan sınır tepelerine Öklid uzaklığı (çizge uzaklığı zikzak yapıyordu)"""
    from mathutils.kdtree import KDTree

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    seeds = [v.co.copy() for v in bm.verts if v.is_boundary and seed_pred(v.co)]
    bm.free()
    # sınır çizgisini sıklaştır: ardışık tohumlar arası ara noktalar yerine yoğun KD örneği yeterli
    kd = KDTree(max(1, len(seeds)))
    for i, c in enumerate(seeds):
        kd.insert(c, i)
    kd.balance()
    vals = []
    for v in ob.data.vertices:
        if seeds:
            co, i, d = kd.find(v.co)
        else:
            d = 9.0
        vals.append(min(d, 9.0))
    a = ob.data.attributes.new(attr, "FLOAT", "POINT")
    a.data.foreach_set("value", vals)


jersey_v = region("jersey")
shorts_v = region("shorts")
socks_v = region("socks")
jf, sf, kf = face_sel(jersey_v), face_sel(shorts_v), face_sel(socks_v)
print("bölge yüz", len(jf), len(sf), len(kf))

def smooth01(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def jersey_off(c):
    """oyun içi kumaş için bol forma: omuz/yaka dar, göğüs ~1.5 cm, etek ~3 cm, kol ağzı ~2.5 cm"""
    if abs(c.x) > 0.205 and c.z < 1.43:
        return 0.006 + 0.022 * smooth01((1.43 - c.z) / 0.15)
    return 0.004 + 0.011 * smooth01((1.45 - c.z) / 0.08) + 0.017 * smooth01((1.12 - c.z) / 0.15)


# kumaş simülasyonuna uygun düzenli ağ: alt bölme yok (gövde dörtgenleri ~2-3 cm)
jersey = make_shell("Forma", jf, jersey_off, cuts_for("jersey"), subdiv=0)
# şort beli formanın altında kalsın: belde dar, paçada bol
shorts = make_shell("Sort", sf, lambda c: 0.005 + 0.02 * smooth01((0.97 - c.z) / 0.08), cuts_for("shorts"), subdiv=0)
socks = make_shell("Tozluk", kf, 0.003, cuts_for("socks"), smooth_rounds=1)

# sınır mesafeleri (desen ve kenar şeritleri için)
zc = max(v.co.z for v in jersey.data.vertices)
ring_distance(jersey, lambda c: c.z > 1.35 and abs(c.x) < 0.16, "d_yaka")
ring_distance(jersey, lambda c: abs(c.x) > 0.20 and c.z > 1.0, "d_kol")
ring_distance(jersey, lambda c: c.z < HEM_Z + 0.12 and abs(c.x) < 0.25, "d_etek")
ring_distance(shorts, lambda c: c.z > 0.9, "d_bel")
ring_distance(shorts, lambda c: c.z < 0.9, "d_paca")
ring_distance(socks, lambda c: c.z > 0.25, "d_ust")

# gövdenin giysi altında kalan kısmı (sınırdan içeri birkaç halka) silinecek grup
for nm, vs in (("ic_forma", jersey_v), ("ic_sort", shorts_v), ("ic_tozluk", socks_v)):
    g = body.vertex_groups.new(name=nm)
    g.add(list(vs), 1.0, "REPLACE")

bpy.ops.wm.save_as_mainfile(filepath=f"{HERE}/stage2.blend")
print("TAMAM")
