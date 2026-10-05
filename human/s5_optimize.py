# Aşama 5: web bütçesi — 5 draw call (Govde atlas, Sac atlas, Forma, Sort, Tozluk), ≤60k üçgen,
# formaya sırt numarası UV'si (uv1), giysi maskelerini public/'e kopyala, GLB dışa aktar
# Çalıştır: blender -b stage4.blend -P s5_optimize.py
import bpy, os, shutil
import numpy as np

HERE = "/home/ege/Blender-MCP/footballer/human"
T = f"{HERE}/tex"
DATA = os.path.expanduser("~/.config/blender/4.0/mpfb/data")
PUB = "/home/ege/Blender-MCP/footballer/viewer/public"
GLB = f"{PUB}/futbolcu.glb"
O = bpy.data.objects
rig = O["Futbolcu"]


def activate(o):
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimate(o, ratio):
    activate(o)
    m = o.modifiers.new("Seyrelt", "DECIMATE")
    m.ratio = ratio
    m.use_collapse_triangulate = False
    while o.modifiers[0].name != "Seyrelt":
        bpy.ops.object.modifier_move_up(modifier="Seyrelt")
    bpy.ops.object.modifier_apply(modifier="Seyrelt")


# ---- 1) seyreltme ----
decimate(O["Human.teeth_base"], 0.2)
decimate(O["Forma"], 0.7)


# ---- 1b) göz: saydam kornea katmanını sil (tek opak atlas malzemesinde iris'i örtüyordu) ----
def drop_transparent(o, img_path):
    import bmesh

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
    print("ÖZET göz kornea yüzü silindi", len(kill))


drop_transparent(O["Human.high-poly"], f"{DATA}/eyes/materials/brownlight_eye.png")

# ---- 2) forma: sırt numarası UV'si (uv1; glTF'te (0,0) numara kutusunun sol üstü) ----
def number_uv(o):
    me = o.data
    rest = np.empty(len(me.vertices) * 3, np.float32)
    me.attributes["rest"].data.foreach_get("vector", rest)
    rest = rest.reshape(-1, 3)
    rn = np.empty(len(me.vertices) * 3, np.float32)
    me.attributes["rnorm"].data.foreach_get("vector", rn)
    rn = rn.reshape(-1, 3)
    uv = me.uv_layers.new(name="NumaraUV")
    for l in me.loops:
        x, y, z = rest[l.vertex_index]
        if rn[l.vertex_index][1] < 0.1:  # ön yüz: geçersiz
            uv.data[l.index].uv = (-1.0, -1.0)
        else:
            u = 0.5 - x / 0.24
            v_img = (1.37 - z) / 0.24
            uv.data[l.index].uv = (u, 1.0 - v_img)


number_uv(O["Forma"])
for n in ("Forma", "Sort", "Tozluk"):
    me = O[n].data
    for an in ("rest", "rnorm"):
        if an in me.attributes:
            me.attributes.remove(me.attributes[an])


# ---- 3) atlas yardımcıları (Blender görüntü dizileri alttan başlar) ----
def load_px(path_or_img, w, h):
    im = (
        path_or_img
        if isinstance(path_or_img, bpy.types.Image)
        else bpy.data.images.load(path_or_img, check_existing=False)
    )
    im = im.copy()
    im.scale(w, h)
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)


def tex_of(o):
    for s in o.material_slots:
        for n in s.material.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image and n.outputs["Color"].is_linked:
                if any(
                    l.to_socket.name == "Base Color" for l in n.outputs["Color"].links
                ):
                    return n.image
    return None


def remap_uv(o, x0, y0, w, h):
    me = o.data
    uv = me.uv_layers.active
    uv.name = "UVMap"
    a = np.empty(len(uv.data) * 2, np.float32)
    uv.data.foreach_get("uv", a)
    a = np.clip(a.reshape(-1, 2), 0.0, 1.0)
    a[:, 0] = x0 + a[:, 0] * w
    a[:, 1] = y0 + a[:, 1] * h
    uv.data.foreach_set("uv", a.ravel())
    for l in list(me.uv_layers):
        if l.name != "UVMap":
            me.uv_layers.remove(l)


def save_img(arr, name, fmt, colorspace="sRGB"):
    h, w = arr.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=fmt == "PNG")
    im.pixels.foreach_set(arr.astype(np.float32).ravel())
    im.filepath_raw = f"{T}/{name}"
    im.file_format = fmt
    sc = bpy.context.scene
    sc.render.image_settings.quality = 92
    im.save()
    im2 = bpy.data.images.load(f"{T}/{name}", check_existing=False)
    im2.colorspace_settings.name = colorspace
    bpy.data.images.remove(im)
    return im2


def fill(arr, region, W, H, data):
    x0, y0, w, h = region
    px, py, pw, ph = int(x0 * W), int(y0 * H), int(w * W), int(h * H)
    arr[py : py + ph, px : px + pw] = data if np.ndim(data) else data
    return pw, ph


def material(name, base, normal=None, mr=None, nstr=1.0, blend="OPAQUE", backface=True):
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
    if normal:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = normal
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
    bs.inputs["Subsurface Weight"].default_value = 0.0
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
    return o


# ---- 4) Govde atlası: deri | krampon | göz | diş | dil | çivi ----
W, H = 4096, 2048
G = {
    "Human": (0.0, 0.0, 0.5, 1.0),
    "Human.shoes05": (0.5, 0.0, 0.25, 0.5),
    "Human.high-poly": (0.75, 0.0, 0.25, 0.5),
    "Human.teeth_base": (0.5, 0.5, 0.125, 0.25),
    "Human.tongue01": (0.625, 0.5, 0.125, 0.25),
    "Civiler": (0.75, 0.5, 0.03, 0.06),
}
src = {
    "Human": f"{T}/deri_albedo.jpg",
    "Human.shoes05": f"{T}/krampon_albedo.jpg",
    "Human.high-poly": f"{DATA}/eyes/materials/brownlight_eye.png",
    "Human.teeth_base": tex_of(O["Human.teeth_base"]),
    "Human.tongue01": tex_of(O["Human.tongue01"]),
}
# (pürüzlülük, metallik)
RM = {
    "Human.shoes05": (0.42, 0),
    "Human.high-poly": (0.08, 0),
    "Human.teeth_base": (0.25, 0),
    "Human.tongue01": (0.4, 0),
    "Civiler": (0.35, 0.6),
}
base = np.zeros((H, W, 4), np.float32)
base[..., 3] = 1
nrm = np.zeros((H, W, 4), np.float32)
nrm[...] = (0.5, 0.5, 1.0, 1.0)
mr = np.zeros((H, W, 4), np.float32)
mr[...] = (1.0, 0.55, 0.0, 1.0)
for n, reg in G.items():
    x0, y0, w, h = reg
    pw, ph = int(w * W), int(h * H)
    if n in src and src[n] is not None:
        fill(base, reg, W, H, load_px(src[n], pw, ph))
    elif n == "Civiler":
        fill(base, reg, W, H, np.array([0.75, 0.6, 0.12, 1.0], np.float32))
    if n == "Human":
        fill(nrm, reg, W, H, load_px(f"{T}/deri_normal.jpg", pw, ph))
        r = load_px(f"{T}/deri_rough.jpg", pw, ph)
        fill(
            mr,
            reg,
            W,
            H,
            np.stack(
                [
                    np.ones_like(r[..., 0]),
                    r[..., 0],
                    np.zeros_like(r[..., 0]),
                    np.ones_like(r[..., 0]),
                ],
                -1,
            ),
        )
    else:
        rr, mm = RM[n]
        fill(mr, reg, W, H, np.array([1.0, rr, mm, 1.0], np.float32))
# sRGB görüntülerin pixels'i doğrusal değil: foreach_get dosyadaki değeri verir (sRGB kodlu) -> olduğu gibi yaz
b_img = save_img(base, "govde_albedo.jpg", "JPEG")
n_img = save_img(nrm, "govde_normal.jpg", "JPEG", "Non-Color")
m_img = save_img(mr, "govde_mr.jpg", "JPEG", "Non-Color")
for n, reg in G.items():
    remap_uv(O[n], *reg)
govde = join([O[n] for n in G], "Govde")
govde.data.materials.clear()
govde.data.materials.append(material("Govde", b_img, n_img, m_img, nstr=0.45))
for p in govde.data.polygons:
    p.material_index = 0

# ---- 5) Sac atlası: saç | kaş | kirpik ----
W2 = H2 = 2048
S = {
    "Human.short02": (0.0, 0.25, 1.0, 0.75),
    "Human.eyebrow001": (0.0, 0.0, 0.5, 0.25),
    "Human.eyelashes01": (0.5, 0.0, 0.5, 0.25),
}
sb = np.zeros((H2, W2, 4), np.float32)
sn = np.zeros((H2, W2, 4), np.float32)
sn[...] = (0.5, 0.5, 1.0, 1.0)
reg = S["Human.short02"]
fill(
    sb, reg, W2, H2, load_px(f"{T}/sac_albedo.png", int(reg[2] * W2), int(reg[3] * H2))
)
fill(
    sn,
    reg,
    W2,
    H2,
    load_px(
        f"{DATA}/hair/short02/short02_normal.png", int(reg[2] * W2), int(reg[3] * H2)
    ),
)
for n in ("Human.eyebrow001", "Human.eyelashes01"):
    reg = S[n]
    im = None
    for s in O[n].material_slots:
        for nd in s.material.node_tree.nodes:
            if nd.type == "TEX_IMAGE" and nd.image:
                im = nd.image
    px = load_px(im, int(reg[2] * W2), int(reg[3] * H2))
    px[..., :3] = (0.035, 0.024, 0.018)  # koyu kahve; şekil alfadan
    fill(sb, reg, W2, H2, px)
s_img = save_img(sb, "sac_atlas.png", "PNG")
sn_img = save_img(sn, "sac_normal.jpg", "JPEG", "Non-Color")
for n, reg in S.items():
    remap_uv(O[n], *reg)
sac = join([O[n] for n in S], "Sac")
sac.data.materials.clear()
sm = material("Sac", s_img, sn_img, None, nstr=0.3, blend="CLIP", backface=False)
sm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.62
sac.data.materials.append(sm)
for p in sac.data.polygons:
    p.material_index = 0

# ---- 6) giysiler: çift yüzlü (kalınlık yok) ----
for n in ("Forma", "Sort", "Tozluk"):
    for s in O[n].material_slots:
        s.material.use_backface_culling = False

# ---- 7) özet ve dışa aktarım ----
meshes = [o for o in O if o.type == "MESH"]
tot = 0
for o in meshes:
    t = tris(o)
    tot += t
    print(
        "ÖZET",
        o.name,
        t,
        "üçgen",
        [s.material.name for s in o.material_slots],
        [l.name for l in o.data.uv_layers],
    )
print("ÖZET toplam üçgen", tot, "mesh", len(meshes))
bpy.ops.wm.save_as_mainfile(filepath=f"{HERE}/stage5.blend")

for x in bpy.context.selected_objects:
    x.select_set(False)
rig.select_set(True)
for o in meshes:
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
for n in ("forma", "sort", "tozluk"):
    shutil.copy(f"{T}/{n}_maske.png", f"{PUB}/futbolcu_maske_{n}.png")
print("GLB", GLB, round(os.path.getsize(GLB) / 1e6, 2), "MB")
print("TAMAM")
