# Aşama 6 (web, 9 kopya): 3 draw call — Govde (deri+göz, 2k atlas), Kiyafet (forma+şort+tozluk+krampon+çivi,
# 2k atlas, varyantlar public/kits/), Sac (saç+kaş+kirpik, alfa). LOD0 ≤35k, LOD1 ≤10k üçgen.
# Önce: python3 kit_make.py ; Çalıştır: blender -b stage4.blend -P s6_web.py
import bpy, bmesh, os, json, math
import numpy as np

HAIR = __import__("os").environ.get("HAIR", "short02")
BROW = __import__("os").environ.get("BROW", "eyebrow001")
CARDS = __import__("os").environ.get("HAIR_CARDS", "1") == "1"  # prosedürel saç kartları (hair_cards.py)
HAIR_STYLE = __import__("os").environ.get("HAIR_STYLE", "fringe")
HERE = __import__("os").environ.get("HUMAN_DIR", "/home/ege/Blender-MCP/footballer/human")
T = f"{HERE}/tex"
DATA = os.path.expanduser("~/.config/blender/4.0/mpfb/data")
PUB = os.environ.get("PUB_OUT", "/home/ege/Blender-MCP/footballer/viewer/public")
O = bpy.data.objects
rig = O["Futbolcu"]
KL = json.load(open(f"{HERE}/kit_layout.json"))
LAY = {k: tuple(v) for k, v in KL["layout"].items()}
EYE_TEX = f"{DATA}/eyes/materials/brownlight_eye.png"


def activate(o):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimate(o, ratio, protect=None):
    activate(o)
    m = o.modifiers.new("Seyrelt", "DECIMATE")
    m.ratio = ratio
    if protect:
        m.vertex_group = protect
        m.invert_vertex_group = True
        m.vertex_group_factor = 1.0
    while o.modifiers[0].name != "Seyrelt":
        bpy.ops.object.modifier_move_up(modifier="Seyrelt")
    bpy.ops.object.modifier_apply(modifier="Seyrelt")


def load_px(src, w, h):
    if isinstance(src, str) and not os.path.exists(src):  # eksik normal haritası: düz
        a = np.empty((h, w, 4), np.float32)
        a[...] = (0.5, 0.5, 1.0, 1.0)
        return a
    im = (
        src
        if isinstance(src, bpy.types.Image)
        else bpy.data.images.load(src, check_existing=False)
    )
    im = im.copy()
    im.scale(w, h)
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)


def save_img(arr, name, fmt, colorspace="sRGB", quality=88):
    h, w = arr.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=fmt == "PNG")
    im.pixels.foreach_set(arr.astype(np.float32).ravel())
    im.filepath_raw = f"{T}/{name}"
    im.file_format = fmt
    bpy.context.scene.render.image_settings.quality = quality
    im.save()
    bpy.data.images.remove(im)
    im2 = bpy.data.images.load(f"{T}/{name}", check_existing=False)
    im2.colorspace_settings.name = colorspace
    return im2


def uv_get(o):
    uv = o.data.uv_layers.active
    a = np.empty(len(uv.data) * 2, np.float32)
    uv.data.foreach_get("uv", a)
    return a.reshape(-1, 2)


def uv_set(o, a):
    me = o.data
    uv = me.uv_layers.active
    uv.name = "UVMap"
    uv.data.foreach_set("uv", a.astype(np.float32).ravel())
    for l in list(me.uv_layers):
        if l.name != "UVMap":
            me.uv_layers.remove(l)


def remap(o, reg, a=None):
    a = np.clip(uv_get(o) if a is None else a, 0, 1)
    x0, y0, w, h = reg
    a[:, 0] = x0 + a[:, 0] * w
    a[:, 1] = y0 + a[:, 1] * h
    uv_set(o, a)


def material(
    name,
    base,
    normal=None,
    mr=None,
    nstr=1.0,
    blend="OPAQUE",
    backface=True,
    rough=0.6,
    tile=None,
):
    if name in bpy.data.materials:
        bpy.data.materials[name].name = name + "_eski"
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bs.outputs[0], out.inputs[0])
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = base
    nt.links.new(t.outputs["Color"], bs.inputs["Base Color"])
    if blend != "OPAQUE":
        nt.links.new(t.outputs["Alpha"], bs.inputs["Alpha"])
    bs.inputs["Roughness"].default_value = rough
    if normal:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = normal
        if tile:
            tc = nt.nodes.new("ShaderNodeTexCoord")
            mp = nt.nodes.new("ShaderNodeMapping")
            mp.inputs["Scale"].default_value = (tile, tile, 1)
            nt.links.new(tc.outputs["UV"], mp.inputs[0])
            nt.links.new(mp.outputs[0], tn.inputs[0])
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nstr
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs[0], bs.inputs["Normal"])
    if mr:
        tm = nt.nodes.new("ShaderNodeTexImage")
        tm.image = mr
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tm.outputs["Color"], sep.inputs[0])
        nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    m.blend_method = blend
    if blend == "CLIP":
        m.alpha_threshold = 0.3
        m.shadow_method = "CLIP"
    m.use_backface_culling = backface
    return m


def join(objs, name):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = o.data.name = name
    o.data.materials.clear()
    return o


def drop_transparent(o, img_path):
    im = bpy.data.images.load(img_path, check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    alpha = a.reshape(h, w, 4)[..., 3]
    bm = bmesh.new()
    bm.from_mesh(o.data)
    uvl = bm.loops.layers.uv.active
    kill = []
    for f in bm.faces:
        u = sum(l[uvl].uv.x for l in f.loops) / len(f.loops)
        v = sum(l[uvl].uv.y for l in f.loops) / len(f.loops)
        if alpha[min(h - 1, max(0, int(v * h))), min(w - 1, max(0, int(u * w)))] < 0.5:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(o.data)
    bm.free()


# ---- 0) ağız kapalı: diş ve dili sil; göz korneasını sil ----
for n in ("Human.teeth_base", "Human.tongue01"):
    bpy.data.objects.remove(O[n])
drop_transparent(O["Human.high-poly"], EYE_TEX)

# ---- 1) kıyafet UV'leri atlasa; formada sırt numarası adası ----
forma = O["Forma"]
me = forma.data
nv = len(me.vertices)
rest = np.empty(nv * 3, np.float32)
me.attributes["rest"].data.foreach_get("vector", rest)
rest = rest.reshape(-1, 3)
rn = np.empty(nv * 3, np.float32)
me.attributes["rnorm"].data.foreach_get("vector", rn)
rn = rn.reshape(-1, 3)
B, Z1 = KL["num_box_m"], KL["num_z1"]


def in_box(i):
    x, y, z = rest[i]
    return rn[i][1] > 0.25 and abs(x) <= B / 2 and Z1 - B <= z <= Z1


uv = uv_get(forma)
x0, y0, w, h = LAY["Forma"]
uv = np.clip(uv, 0, 1)
uv[:, 0] = x0 + uv[:, 0] * w
uv[:, 1] = y0 + uv[:, 1] * h
nx0, ny0, nw, nh = LAY["Numara"]
n_isl = 0
for p in me.polygons:
    if all(in_box(i) for i in p.vertices):
        n_isl += 1
        for li in p.loop_indices:
            x, y, z = rest[me.loops[li].vertex_index]
            uu = 0.5 - x / B
            vv = (z - (Z1 - B)) / B  # v yukarı
            uv[li] = (nx0 + uu * nw, ny0 + vv * nh)
uv_set(forma, uv)
print("ÖZET numara adası yüz", n_isl)

remap(O["Sort"], LAY["Sort"])
remap(O["Tozluk"], LAY["Tozluk"])
remap(O["Human.shoes05"], LAY["Krampon"])
remap(O["Civiler"], LAY["Civi"], np.full((len(O["Civiler"].data.loops), 2), 0.5))

# ---- 2) seyreltme (LOD0) ----
body = O["Human"]
g = body.vertex_groups.new(name="koru")
keep_bones = {"head", "neck_01"} | {
    b.name
    for b in rig.data.bones
    if b.name.startswith(("hand_", "thumb_", "index_", "middle_", "ring_", "pinky_"))
}
gi = {vg.index: vg.name for vg in body.vertex_groups}
for v in body.data.vertices:
    wsum = sum(x.weight for x in v.groups if gi[x.group] in keep_bones)
    if wsum > 0.05:
        g.add([v.index], min(1.0, wsum * 1.5), "REPLACE")
decimate(body, 0.62)  # grup korumalı seyreltme bacakları çökertti; düz oran
body.vertex_groups.remove(body.vertex_groups["koru"])
decimate(O["Human.shoes05"], 0.6)
decimate(O[f"Human.{HAIR}"], 0.7 if HAIR == "short02" else 0.95)  # tel dokulu saçlarda seyreltme delik açıyor

# ---- 3) Govde atlası: deri 2k + göz derinin boş köşesine ----
S = 2048
occ = np.zeros((64, 64), bool)
bu = uv_get(body)
for p in body.data.polygons:
    pts = bu[list(p.loop_indices)]
    a0 = np.clip((pts.min(0) * 64).astype(int), 0, 63)
    a1 = np.clip((pts.max(0) * 64).astype(int), 0, 63)
    occ[a0[1] : a1[1] + 1, a0[0] : a1[0] + 1] = True
cell = 9  # 9/64 ≈ 0.14 UV
best = None
for yy in range(64 - cell, -1, -1):
    for xx in range(64 - cell, -1, -1):
        if not occ[yy : yy + cell, xx : xx + cell].any():
            best = (xx / 64, yy / 64)
            break
    if best:
        break
assert best, "derinin UV'sinde göz için boş alan yok"
EYE = (best[0] + 0.005, best[1] + 0.005, cell / 64 - 0.01, cell / 64 - 0.01)
print("ÖZET göz bölgesi", EYE)
base = load_px(f"{T}/deri_albedo.jpg", S, S)
nrm = load_px(f"{T}/deri_normal.jpg", S, S)
r = load_px(f"{T}/deri_rough.jpg", S, S)[..., 0]
mr = np.stack([np.ones_like(r), r, np.zeros_like(r), np.ones_like(r)], -1)
ex, ey, ew, eh = (int(EYE[0] * S), int(EYE[1] * S), int(EYE[2] * S), int(EYE[3] * S))
base[ey : ey + eh, ex : ex + ew] = load_px(EYE_TEX, ew, eh)
base[..., 3] = 1
nrm[ey : ey + eh, ex : ex + ew] = (0.5, 0.5, 1.0, 1.0)
mr[ey : ey + eh, ex : ex + ew] = (1.0, 0.08, 0.0, 1.0)


def paint_scalp(base):
    """Saç kartlarının altında kalan kafa derisini saç dibi rengine boya (kart aralarından açık ten görünmesin).
    Kabuğun hemen altında kalan gövde tepeleri (dışa doğru ışın kabuğu keser) maske olur, UV'de rasterlanır."""
    from mathutils.bvhtree import BVHTree

    lm_ = json.load(open(f"{HERE}/bake/landmarks.json"))
    ez_ = (lm_["eye_l"][2] + lm_["eye_r"][2]) / 2
    hull = O[f"Human.{HAIR}"]
    hv = [v.co.copy() for v in hull.data.vertices]
    ht = []
    for p_ in hull.data.polygons:
        ix = list(p_.vertices)
        for k in range(1, len(ix) - 1):
            ht.append((ix[0], ix[k], ix[k + 1]))
    bv = BVHTree.FromPolygons(hv, ht)
    me = body.data
    m = np.zeros(len(me.vertices), np.float32)
    for v in me.vertices:
        if v.co.z < ez_ - 0.08:
            continue
        if v.co.y < -0.04 and v.co.z < ez_ + 0.075:  # alın ve şakak ön yüzü: boyama
            continue
        hit = bv.ray_cast(v.co + v.normal * 0.001, v.normal, 0.04)
        if hit[0] is not None:
            m[v.index] = 1.0
    uv = me.uv_layers.active.data
    mask = np.zeros(base.shape[:2], np.float32)
    H_, W_ = mask.shape
    for p_ in me.polygons:
        li = list(p_.loop_indices)
        vi = list(p_.vertices)
        if not any(m[i] > 0 for i in vi):
            continue
        for k in range(1, len(li) - 1):
            idx = (0, k, k + 1)
            P = np.array([[uv[li[i]].uv[0] * W_, uv[li[i]].uv[1] * H_] for i in idx])
            mv = np.array([m[vi[i]] for i in idx])
            x0, x1 = int(P[:, 0].min()), int(P[:, 0].max()) + 1
            y0, y1 = int(P[:, 1].min()), int(P[:, 1].max()) + 1
            if x1 - x0 > 200 or y1 - y0 > 200:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
            d = (P[1, 1] - P[2, 1]) * (P[0, 0] - P[2, 0]) + (P[2, 0] - P[1, 0]) * (P[0, 1] - P[2, 1])
            if abs(d) < 1e-9:
                continue
            l0 = ((P[1, 1] - P[2, 1]) * (gx - P[2, 0]) + (P[2, 0] - P[1, 0]) * (gy - P[2, 1])) / d
            l1 = ((P[2, 1] - P[0, 1]) * (gx - P[2, 0]) + (P[0, 0] - P[2, 0]) * (gy - P[2, 1])) / d
            l2 = 1 - l0 - l1
            ins = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
            val = np.where(ins, l0 * mv[0] + l1 * mv[1] + l2 * mv[2], 0)
            ys, xs = slice(max(y0, 0), min(y1, H_)), slice(max(x0, 0), min(x1, W_))
            sub = val[: ys.stop - ys.start, : xs.stop - xs.start]
            mask[ys, xs] = np.maximum(mask[ys, xs], sub)
    # yumuşat (yalnız maskenin kapladığı kutu)
    yy, xx = np.nonzero(mask > 0)
    if len(yy):
        r_ = 5
        ya, yb = max(yy.min() - 3 * r_, 0), min(yy.max() + 3 * r_, H_)
        xa, xb = max(xx.min() - 3 * r_, 0), min(xx.max() + 3 * r_, W_)
        sm = mask[ya:yb, xa:xb]
        k_ = np.ones(2 * r_ + 1, np.float32) / (2 * r_ + 1)
        for _ in range(2):
            sm = np.apply_along_axis(lambda x: np.convolve(x, k_, "same"), 0, sm)
            sm = np.apply_along_axis(lambda x: np.convolve(x, k_, "same"), 1, sm)
        mask[ya:yb, xa:xb] = sm
    hm = np.array([float(x) for x in os.environ.get("HAIR_MUL", "0.42,0.30,0.22").split(",")], np.float32)
    col = hm * 0.10
    base[..., :3] = base[..., :3] * (1 - mask[..., None] * 0.92) + col * mask[..., None] * 0.92
    print("ÖZET kafa derisi boyanan tepe", int((m > 0).sum()))


paint_scalp(base)
gb = save_img(base, "w_govde_albedo.jpg", "JPEG")
gn = save_img(nrm, "w_govde_normal.jpg", "JPEG", "Non-Color", 85)
gm = save_img(mr, "w_govde_mr.jpg", "JPEG", "Non-Color", 85)
remap(O["Human.high-poly"], EYE)
uv_set(body, uv_get(body))
govde = join([body, O["Human.high-poly"]], "Govde")
govde.data.materials.append(material("Govde", gb, gn, gm, nstr=0.45))

# ---- 4) Kiyafet ----
kit_img = bpy.data.images.load(f"{T}/kit_home.jpg")
knit = bpy.data.images.load(f"{T}/kumas_normal.png")
knit.colorspace_settings.name = "Non-Color"
kit = join([O["Tozluk"], O["Human.shoes05"], O["Civiler"]], "Kiyafet")
sort = O["Sort"]


def smooth_weights(o, it, fac, limit=4):
    """kenar komşuluğunda ağırlık laplas yumuşatma + 4 etki + normalize (operatör nesne kipinde çalışmıyor)"""
    me = o.data
    n = len(me.vertices)
    G = len(o.vertex_groups)
    Wm = np.zeros((n, G), np.float32)
    for v in me.vertices:
        for g in v.groups:
            Wm[v.index, g.group] = g.weight
    e = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    deg = np.bincount(e.ravel(), minlength=n).astype(np.float32)
    for _ in range(it):
        acc = np.zeros_like(Wm)
        np.add.at(acc, e[:, 0], Wm[e[:, 1]])
        np.add.at(acc, e[:, 1], Wm[e[:, 0]])
        nb = acc / np.maximum(deg, 1)[:, None]
        Wm = np.where(deg[:, None] > 0, Wm * (1 - fac) + nb * fac, Wm)
    # en büyük 4 etki
    idx = np.argsort(-Wm, 1)[:, limit:]
    np.put_along_axis(Wm, idx, 0.0, 1)
    Wm /= np.maximum(Wm.sum(1, keepdims=True), 1e-6)
    for gi_, vg in enumerate(o.vertex_groups):
        vg.remove(list(range(n)))
        col = Wm[:, gi_]
        nzv = np.nonzero(col > 1e-4)[0]
        for vi in nzv:
            vg.add([int(vi)], float(col[vi]), "REPLACE")


def split_sides(o):
    """hiçbir tepe hem sol hem sağ bacak kemiğine bağlı olmasın: karşı tarafın payı pelvise"""
    gi = {g.name: g for g in o.vertex_groups}
    n_fix = 0
    for v in o.data.vertices:
        ws = {o.vertex_groups[g.group].name: g.weight for g in v.groups}
        for a, b in (("thigh_l", "thigh_r"), ("calf_l", "calf_r"), ("foot_l", "foot_r")):
            if ws.get(a, 0) > 0 and ws.get(b, 0) > 0:
                drop = b if v.co.x > 0 else a
                w = ws[drop]
                gi[drop].remove([v.index])
                gi["pelvis"].add([v.index], w, "ADD")
                n_fix += 1
    print("ÖZET", o.name, "sol/sağ karışması düzeltilen", n_fix)


def fix_kit(o, iters=12):
    """yaka iç kenarını düzle; kasık ve koltuk altında ağırlık sıçramalarını yumuşat"""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    # yaka: sınır halkasını yalnız halka komşularıyla düzle (1B laplas)
    ring = [v for v in bm.verts if v.is_boundary and v.co.z > 1.42 and abs(v.co.x) < 0.13]
    rs = set(ring)
    for _ in range(25):
        new = {}
        for v in ring:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary and e.other_vert(v) in rs]
            if len(nb) == 2:
                new[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
        for v, c in new.items():
            v.co = c
    bm.to_mesh(me)
    bm.free()
    gi = {g.name: g.index for g in o.vertex_groups}
    pel = o.vertex_groups["pelvis"]
    # şort ağının kasık ortası pelvise bağlı olsun (bacaklar açılınca iki uyluk arası yırtılmasın)
    for v in me.vertices:
        if 0.70 < v.co.z < 0.98 and abs(v.co.x) < 0.07:
            f = max(0.0, 1 - abs(v.co.x) / 0.07) * 0.85
            for g in v.groups:
                g.weight *= 1 - f
            pel.add([v.index], f, "ADD")
    smooth_weights(o, iters, 0.5)
    split_sides(o)
    print("ÖZET yaka halkası tepe", len(ring))


def thigh_to_pelvis(o, k=0.75):
    """forma eteği uyluğa sıkı bağlanmasın (kumaş çözecek): uyluk payının k'sı pelvise"""
    gi = {g.index: g.name for g in o.vertex_groups}
    pel = o.vertex_groups["pelvis"]
    for v in o.data.vertices:
        mv = 0.0
        for g in v.groups:
            if gi[g.group] in ("thigh_l", "thigh_r"):
                mv += g.weight * k
                g.weight *= 1 - k
        if mv > 0:
            pel.add([v.index], mv, "ADD")


def attr(o, name):
    me = o.data
    a = me.attributes[name]
    if a.data_type == "FLOAT_VECTOR":
        r = np.empty(len(a.data) * 3, np.float32)
        a.data.foreach_get("vector", r)
        return r.reshape(-1, 3)
    r = np.empty(len(a.data), np.float32)
    a.data.foreach_get("value", r)
    return r


def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def set_pin(o, pin):
    """pin ağırlığı -> COLOR_0.R (float renk: sRGB dönüşümü yok)"""
    me = o.data
    for c in list(me.color_attributes):
        me.color_attributes.remove(c)
    ca = me.color_attributes.new("pin", "FLOAT_COLOR", "POINT")
    col = np.zeros((len(me.vertices), 4), np.float32)
    col[:, 0] = np.clip(pin, 0, 1)
    col[:, 3] = 1
    ca.data.foreach_set("color", col.ravel())
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = 0
    print("ÖZET pin", o.name, "köşe", len(pin), "min/ort/max", round(float(pin.min()), 2), round(float(pin.mean()), 2), round(float(pin.max()), 2))


def pins_forma(o):
    z = attr(o, "rest")[:, 2]
    rnz = attr(o, "rnorm")[:, 2]
    dy, dk, de, part = attr(o, "d_yaka"), attr(o, "d_kol"), attr(o, "d_etek"), attr(o, "part")
    torso = np.interp(z, [0.90, 1.02, 1.25, 1.40, 2.0], [0.3, 0.3, 0.65, 1.0, 1.0])
    torso = np.maximum(torso, (1 - ss(0.02, 0.05, dy)))  # yaka
    torso = np.maximum(torso, (rnz > 0.5) * (z > 1.35) * 1.0)  # omuz üstü
    torso *= ss(0.0, 0.07, de)  # etek kenarı ve son 7 cm -> 0
    sleeve = 0.7 * ss(0.0, 0.12, dk)
    return torso * (1 - ss(0.3, 0.7, part)) + sleeve * ss(0.3, 0.7, part)


def pins_sort(o):
    db = attr(o, "d_bel")
    rest = attr(o, "rest")
    # belde 1, bel kenarından 8 cm aşağıda 0,1; paça ve uyluk yanı 0,1; ön üst kalça 0,2 (kumaş uyluğu serbestçe takip etsin)
    front_upper = ss(0.0, 0.07, -rest[:, 1]) * ss(0.88, 0.98, rest[:, 2])
    return np.clip(0.1 + 0.1 * front_upper + 0.9 * (1 - ss(0.02, 0.10, db)), 0, 1)


def drop_attrs(o):
    for an in ("rest", "rnorm", "part", "d_yaka", "d_kol", "d_etek", "d_bel", "d_paca", "d_ust"):
        if an in o.data.attributes:
            o.data.attributes.remove(o.data.attributes[an])


set_pin(forma, pins_forma(forma))
set_pin(sort, pins_sort(sort))
fix_kit(forma, 4)
thigh_to_pelvis(forma)
smooth_weights(forma, 1, 0.3)
split_sides(forma)
fix_kit(sort, 4)


def sharpen_thigh(o):
    """şort paçası uyluğa tam bağlansın: kasık altı ve yan yüzde pelvis payı sıfırlanır (uyluk şortu delip çıkmasın)"""
    names = {g.index: g.name for g in o.vertex_groups}
    gi = {g.name: g for g in o.vertex_groups}
    n_ch = 0
    for v in o.data.vertices:
        w = {names[g.group]: g.weight for g in v.groups}
        side = "thigh_l" if v.co.x > 0 else "thigh_r"
        t = w.get(side, 0.0)
        s_ = ss(0.97, 0.86, v.co.z) * ss(0.06, 0.13, abs(v.co.x))
        t2 = t + (1 - t) * s_
        if t2 - t < 0.01:
            continue
        rest = 1 - t
        for nm, wt in w.items():
            if nm == side:
                continue
            gi[nm].add([v.index], wt * (1 - t2) / max(rest, 1e-6), "REPLACE")
        gi[side].add([v.index], t2, "REPLACE")
        n_ch += 1
    print("ÖZET şort uyluğa bağlanan tepe", n_ch)


if os.environ.get("SORT_STICK", "1") == "1":
    sharpen_thigh(sort)


def fill_small_holes(o, max_edges=5):
    """küçük açık halkaları (dikiş boşluğu) üçgenle kapat"""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    be = [e for e in bm.edges if e.is_boundary]
    seen, loops = set(), []
    for e in be:
        if e in seen:
            continue
        stack, comp = [e], []
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            comp.append(x)
            for vv in x.verts:
                for ee in vv.link_edges:
                    if ee.is_boundary and ee not in seen:
                        stack.append(ee)
        loops.append(comp)
    small = [e for c in loops if len(c) <= max_edges for e in c]
    if small:
        bmesh.ops.holes_fill(bm, edges=small, sides=max_edges)
        bm.to_mesh(o.data)
    bm.free()
    print("ÖZET", o.name, "kapatılan küçük delik halkası", sum(1 for c in loops if len(c) <= max_edges))


for _o in (sort, forma):
    fill_small_holes(_o)
split_sides(kit)
for o in (forma, sort, kit):
    drop_attrs(o)


def uv_scale(o):
    me = o.data
    uvd = me.uv_layers.active.data
    a3 = auv = 0.0
    for p in me.polygons:
        a3 += p.area
        cs = [uvd[i].uv for i in p.loop_indices]
        for i in range(1, len(cs) - 1):
            auv += abs((cs[i] - cs[0]).cross(cs[i + 1] - cs[0])) / 2
    return math.sqrt(a3 / max(auv, 1e-9))


split_sides(govde)
for o, nm in ((forma, "Kiyafet_Forma"), (sort, "Kiyafet_Sort")):
    o.data.materials.clear()
    o.data.materials.append(material(nm, kit_img, knit, None, nstr=float(os.environ.get("KNIT_NSTR", "0.22")), backface=False, rough=0.64, tile=uv_scale(forma) / 0.022))
kit.data.materials.append(
    material(
        "Kiyafet",
        kit_img,
        knit,
        None,
        nstr=float(os.environ.get("KNIT_NSTR", "0.22")),
        backface=False,
        rough=0.64,
        tile=uv_scale(kit) / 0.022,
    )
)

# ---- 5) Sac atlası 1k ----
S2 = 1024
SA = {
    f"Human.{HAIR}": (0.0, 0.25, 1.0, 0.75),
    f"Human.{BROW}": (0.0, 0.0, 0.5, 0.25),
    "Human.eyelashes01": (0.5, 0.0, 0.5, 0.25),
}
sb = np.zeros((S2, S2, 4), np.float32)
sn = np.zeros((S2, S2, 4), np.float32)
sn[...] = (0.5, 0.5, 1.0, 1.0)


def put(arr, reg, data):
    x0, y0, w, h = reg
    arr[
        int(y0 * S2) : int(y0 * S2) + int(h * S2),
        int(x0 * S2) : int(x0 * S2) + int(w * S2),
    ] = data


reg = SA[f"Human.{HAIR}"]
hp = load_px(f"{T}/sac_albedo.png", int(reg[2] * S2), int(reg[3] * S2))
# MASK (alfa testi) altında tırtıklı kenar vermemek için iç bölge tam opak,
# yalnız kenar bandında ince tel dokusu; kenar geçişi yumuşak ve kontrastlı
rng = np.random.default_rng(11)
nz = rng.random(hp.shape[:2]).astype(np.float32)
k9 = np.ones(9, np.float32) / 9
nz = np.apply_along_axis(lambda r: np.convolve(r, k9, "same"), 0, nz)
nz = (nz - nz.min()) / (nz.max() - nz.min())
hp_orig = hp.copy()
a0 = hp[..., 3].copy()


def blur(a, r, n=2):
    k = np.ones(2 * r + 1, np.float32) / (2 * r + 1)
    for _ in range(n):
        a = np.apply_along_axis(lambda x: np.convolve(x, k, "same"), 0, a)
        a = np.apply_along_axis(lambda x: np.convolve(x, k, "same"), 1, a)
    return a


solid = (a0 > 0.98).astype(np.float32)
core = (blur(solid, 7, 1) > 0.999).astype(np.float32)  # kenardan ≥7 px içerisi
core = blur(core, 2)
edge = np.clip(a0 * (0.75 + 0.5 * nz), 0, 1)
edge = np.clip((blur(edge, 1) - 0.18) / 0.5, 0, 1)
hp[..., 3] = np.clip(np.maximum(core, edge * (1 - core)), 0, 1)
# kart kenarındaki ~9 px'lik bant (kenar çizgisi dokusu) iç bölge rengiyle doldurulur, alfa korunur
inner = (blur(solid, 9, 1) > 0.999).astype(np.float32)
wgt = inner.copy()
band = (solid > 0) & (inner == 0)
for _ in range(4):
    den = np.maximum(blur(wgt, 9, 1), 1e-4)
    for c in range(3):
        hp[..., c] = np.where(wgt > 0, hp[..., c], blur(hp[..., c] * wgt, 9, 1) / den)
    wgt = np.maximum(wgt, (den > 0.02).astype(np.float32))
hair_band = band | (a0 < 0.98)
if HAIR != "short02":  # tel dokulu diğer saçlarda alfa olduğu gibi (kenar işleme yalnız short02 kartlarına göre ayarlı)
    hp = hp_orig
    m_ = (a0 > 0.3).astype(np.float32)
    closed = (blur((blur(m_, 7, 1) > 0.01).astype(np.float32), 7, 1) > 0.995).astype(np.float32)
    hp[..., 3] = np.maximum(np.clip(a0 * 1.3, 0, 1), closed * 0.0 + np.minimum(closed, 1.0) * (blur(m_, 7, 1) > 0.5))
    hair_band = np.zeros_like(a0, bool)
if CARDS:
    import sys

    sys.path.insert(0, HERE)
    import hair_cards

    _hm = [float(x) for x in os.environ.get("HAIR_MUL", "0.42,0.30,0.22").split(",")]
    hp = hair_cards.make_texture(
        int(reg[2] * S2), int(reg[3] * S2), np.array(_hm, np.float32) * 0.30
    )
put(sb, reg, hp)
hn = load_px(
    f"{DATA}/hair/{HAIR}/{HAIR}_normal.png", int(reg[2] * S2), int(reg[3] * S2)
)
bm_ = blur(hair_band.astype(np.float32), 3, 1)[..., None]
hn[..., :3] = hn[..., :3] * (1 - bm_) + np.array([0.5, 0.5, 1.0], np.float32) * bm_
if CARDS:
    hn[...] = (0.5, 0.5, 1.0, 1.0)
put(sn, reg, hn)
for n in (f"Human.{BROW}", "Human.eyelashes01"):
    reg = SA[n]
    im = [
        nd.image
        for s in O[n].material_slots
        for nd in s.material.node_tree.nodes
        if nd.type == "TEX_IMAGE" and nd.image
    ][-1]
    px = load_px(im, int(reg[2] * S2), int(reg[3] * S2))
    px[..., :3] = (0.035, 0.024, 0.018)
    put(sb, reg, px)
si = save_img(sb, "w_sac.png", "PNG")
sni = save_img(sn, "w_sac_normal.jpg", "JPEG", "Non-Color", 85)
from mathutils.bvhtree import BVHTree

HAIR_ALL = float(os.environ.get("HAIR_CLOSE", "0.55"))  # tüm saçı kafaya yaklaştır (kısa kesim, kask hissini azaltır)
lm = json.load(open(f"{HERE}/bake/landmarks.json"))
ez = (lm["eye_l"][2] + lm["eye_r"][2]) / 2
gb_bvh = BVHTree.FromObject(govde, bpy.context.evaluated_depsgraph_get())
hair_o = O[f"Human.{HAIR}"]
n_thin = 0
for v in hair_o.data.vertices:
    side = min(1.0, max(0.0, (abs(v.co.x) - 0.045) / 0.03))
    low = min(1.0, max(0.0, (ez + 0.10 - v.co.z) / 0.06))
    f = max(side * low, HAIR_ALL)
    if f <= 0:
        continue
    loc, nn, i, d = gb_bvh.find_nearest(v.co)
    if loc is not None and d < 0.04:
        v.co = v.co.lerp(loc + nn * 0.0015, 0.7 * f)
        n_thin += 1
print("ÖZET şakakta inceltilen saç tepe", n_thin)

HULL = None
if CARDS:
    HULL = bpy.data.objects.new("HullTut", hair_o.data.copy())


def UC_KEEP(c):  # taban yalnız tepe ve arkada; şakak ve favori kenarı kartlarla kapanır
    return c.z > ez + 0.015 or (c.y > -0.02 and c.z > ez - 0.05)


def card_mesh(n, nseg, scale, seed, uc_ratio=0.12):
    v, f, uv = hair_cards.build_cards(HULL, n, nseg, HAIR_STYLE, seed, scale)
    uv0 = hair_cards.undercoat(HULL, uc_ratio, (0.953, 0.9375), UC_KEEP)
    off = len(v)
    v = v + uv0[0]
    f = f + [tuple(i + off for i in t) for t in uv0[1]]
    uv = uv + uv0[2]
    me = bpy.data.meshes.new("SacKart")
    me.from_pydata(v, [], f)
    me.update()
    layer = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            layer.data[li].uv = uv[vi]
    return me


if CARDS:
    mats = list(hair_o.data.materials)
    me = card_mesh(int(os.environ.get("HAIR_N", "780")), int(os.environ.get("HAIR_SEG", "2")), 1.0, 3)
    hair_o.data = me
    for m_ in mats:
        me.materials.append(m_)
    print("ÖZET saç eski grup", [g.name for g in hair_o.vertex_groups])
    hg = hair_o.vertex_groups.get("head") or hair_o.vertex_groups.new(name="head")
    hg.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    kg = hair_o.vertex_groups.new(name="kart")
    kg.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    print("ÖZET saç yüz", len(me.polygons))

for n, reg in SA.items():
    remap(O[n], reg)
sac = join([O[n] for n in SA], "Sac")
sac.data.materials.append(
    material("Sac", si, sni, None, nstr=0.3, blend="CLIP", backface=False, rough=0.85)
)

for o in (govde, kit, sac, forma, sort):
    for p in o.data.polygons:
        p.material_index = 0


def export(path):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    rig.select_set(True)
    for o in (govde, kit, forma, sort, sac):
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=path,
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
        export_colors=True,
    )
    tot = sum(tris(o) for o in (govde, kit, forma, sort, sac))
    print(
        "ÖZET",
        os.path.basename(path),
        round(os.path.getsize(path) / 1e6, 2),
        "MB",
        tot,
        "üçgen",
        {o.name: (tris(o), len(o.data.vertices)) for o in (govde, kit, forma, sort, sac)},
    )


export(f"{PUB}/futbolcu.glb")
# ---- forma eteği: bayrak gibi açılmasın; ucu şortun hemen üstünde, gövdeye yakın dursun ----
HEM_GAP = float(os.environ.get("HEM_GAP", "0.0065"))  # etek ile şort yüzeyi arası (m)
_dg = bpy.context.evaluated_depsgraph_get()
_bs = BVHTree.FromObject(sort, _dg)
_bg = BVHTree.FromObject(govde, _dg)
_hz = min(v.co.z for v in forma.data.vertices)
_n_hem = 0
for v in forma.data.vertices:
    t = (v.co.z - _hz) / 0.16
    if t >= 1.0:
        continue
    w = 1.0 - t * t * (3 - 2 * t)  # hemde 1, 16 cm yukarıda 0
    ls, ns, _i, ds = _bs.find_nearest(v.co)
    if ls is not None and ds < 0.04 and ds > HEM_GAP:
        v.co = v.co + (ls - v.co).normalized() * (ds - HEM_GAP) * w
        _n_hem += 1
    else:
        lb, nb, _j, db = _bg.find_nearest(v.co)
        if lb is not None and db > 0.016:
            v.co = v.co + (lb - v.co).normalized() * (db - 0.016) * w * 0.6
            _n_hem += 1
print("ÖZET forma etek daraltılan tepe", _n_hem)

# etek kenarı: tepe başına itme çentik bırakmasın; halkayı ve altındaki 16 cm'yi yumuşat
_bm = bmesh.new()
_bm.from_mesh(forma.data)
_bm.verts.ensure_lookup_table()
_ring = [v for v in _bm.verts if v.is_boundary and v.co.z < 1.05]
_rs = set(_ring)
for _ in range(12):
    _new = {}
    for v in _ring:
        nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary and e.other_vert(v) in _rs]
        if len(nb) == 2:
            _new[v] = v.co * 0.4 + (nb[0].co + nb[1].co) * 0.3
    for v, c in _new.items():
        v.co = c
_band = [v for v in _bm.verts if v.co.z < _hz + 0.16]
for _ in range(3):
    _new = {}
    for v in _band:
        if v.is_boundary:
            continue
        nb = [e.other_vert(v) for e in v.link_edges]
        if nb:
            _new[v] = v.co * 0.6 + sum((x.co for x in nb), v.co * 0) / len(nb) * 0.4
    for v, c in _new.items():
        v.co = c
_bm.to_mesh(forma.data)
_bm.free()
forma.data.update()
bpy.ops.wm.save_as_mainfile(filepath=f"{HERE}/stage6.blend")

# ---- 6) LOD1 (≤10k üçgen, 1k dokular) ----
decimate(govde, 0.29)
decimate(kit, 0.30)
decimate(forma, 0.42)
decimate(sort, 0.6)
if CARDS:  # LOD1: kartları sil, daha az ve geniş kartla yeniden üret
    bm = bmesh.new()
    bm.from_mesh(sac.data)
    dl = bm.verts.layers.deform.verify()
    gk = sac.vertex_groups["kart"].index
    gh = sac.vertex_groups["head"].index
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if gk in v[dl]], context="VERTS")
    bm.to_mesh(sac.data)
    bm.free()
    v, f, uv = hair_cards.build_cards(HULL, 230, 2, HAIR_STYLE, 4, 1.4)
    u1_ = hair_cards.undercoat(HULL, 0.05, (0.953, 0.9375), UC_KEEP)
    o1_ = len(v)
    v = v + u1_[0]
    f = f + [tuple(i + o1_ for i in t) for t in u1_[1]]
    uv = uv + u1_[2]
    rg = SA[f"Human.{HAIR}"]
    bm = bmesh.new()
    bm.from_mesh(sac.data)
    dl = bm.verts.layers.deform.verify()
    uvl = bm.loops.layers.uv.active
    nv = [bm.verts.new(c) for c in v]
    for k, vv in enumerate(nv):
        vv[dl][gh] = 1.0
        vv[dl][gk] = 1.0
    for q in f:
        fc = bm.faces.new([nv[i] for i in q])
        for lp in fc.loops:
            u_, v_ = uv[nv.index(lp.vert)]
            lp[uvl].uv = (rg[0] + u_ * rg[2], rg[1] + v_ * rg[3])
    bm.to_mesh(sac.data)
    bm.free()
else:
    decimate(sac, 0.45)
for im in list(bpy.data.images):
    if (
        im.filepath
        and any(k in im.filepath for k in ("w_govde_", "kit_home", "w_sac"))
        and im.size[0] > 1024
    ):
        im.scale(im.size[0] // 2, im.size[1] // 2)
export(f"{PUB}/futbolcu_lod1.glb")
print("TAMAM")
