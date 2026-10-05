# Aşama 1: MPFB (MakeHuman, CC0) ile atletik erkek, rig, göz/kaş/saç, doğal duruş -> stage1.blend
# Çalıştır: blender -b --factory-startup -P s1_human.py
import bpy, addon_utils, os, math
from mathutils import Vector, Matrix, Quaternion

addon_utils.enable("mpfb", default_set=True, persistent=False)
from mpfb.services.humanservice import HumanService
from mpfb.services.targetservice import TargetService
from mpfb.services.rigservice import RigService

HERE = __import__("os").environ.get("HUMAN_DIR", "/home/ege/Blender-MCP/footballer/human")
DATA = os.path.expanduser("~/.config/blender/4.0/mpfb/data")
HEIGHT = 1.80
# varyant ayarları (ortam değişkeni; varsayılan = ana model)
E = os.environ.get
HAIR = E("HAIR", "short02")
BROW = E("BROW", "eyebrow001")
V_MUSCLE = float(E("V_MUSCLE", "0.78"))
V_WEIGHT = float(E("V_WEIGHT", "0.42"))
V_AGE = float(E("V_AGE", "0.5"))
V_RACE = [float(x) for x in E("V_RACE", "0.85,0.05,0.10").split(",")]
V_TGT = [t.split("=") for t in E("V_TGT", "").split(";") if t]

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)

macro = TargetService.get_default_macro_info_dict()
macro.update(
    gender=1.0, age=V_AGE, muscle=V_MUSCLE, weight=V_WEIGHT, proportions=1.0, height=0.62
)
macro["race"] = {"caucasian": V_RACE[0], "asian": V_RACE[1], "african": V_RACE[2]}
h = HumanService.create_human(macro_detail_dict=macro)
h.name = "Human"


# ek ince ayar hedefleri (yüz ve gövde) — yoksa sessizce atla
def tgt(rel, w):
    from mpfb.services.locationservice import LocationService

    full = os.path.join(LocationService.get_mpfb_data("targets"), rel)
    if os.path.exists(full):
        TargetService.load_target(h, full, weight=w)
    else:
        print("HEDEF YOK", rel)


for rel, w in [
    ("stomach/stomach-pregnant-decr.target.gz", 0.6),
    ("torso/measure-shoulder-dist-incr.target.gz", 0.4),
    ("neck/neck-scale-horiz-incr.target.gz", 0.35),
    ("chin/chin-prominent-incr.target.gz", 0.3),
    ("chin/chin-width-incr.target.gz", 0.25),
    ("torso/measure-hips-circ-decr.target.gz", 0.2),
] + [(r, float(w)) for r, w in V_TGT]:
    tgt(rel, w)

TargetService.bake_targets(h)
bpy.context.view_layer.update()

# boyu 1.80 m'ye ölçekle (yardımcı geometri hariç gövde yüksekliği)
vg = h.vertex_groups["body"].index
zs = [
    (h.matrix_world @ v.co).z
    for v in h.data.vertices
    if any(g.group == vg for g in v.groups)
]
cur = max(zs) - min(zs)
s = HEIGHT / cur
print("ham boy", cur, "ölçek", s)
h.scale = (s, s, s)
bpy.ops.object.select_all(action="DESELECT")
h.select_set(True)
bpy.context.view_layer.objects.active = h
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
zs = [v.co.z for v in h.data.vertices if any(g.group == vg for g in v.groups)]
h.location.z -= min(zs)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

rig = HumanService.add_builtin_rig(h, "game_engine")


def add(sub, name, typ):
    f = os.path.join(DATA, sub, name, name + ".mhclo")
    o = HumanService.add_mhclo_asset(
        f, h, asset_type=typ, subdiv_levels=0, material_type="MAKESKIN"
    )
    return o


add("eyes", "high-poly", "Eyes")
add("eyebrows", BROW, "Eyebrows")
add("eyelashes", "eyelashes01", "Eyelashes")
add("teeth", "teeth_base", "Teeth")
add("tongue", "tongue01", "Tongue")
add("hair", HAIR, "Hair")
add("clothes", "shoes05", "Clothes")

HumanService.set_character_skin(
    os.path.join(DATA, "skins/young_caucasian_male2/young_caucasian_male2.mhmat"),
    h,
    skin_type="MAKESKIN",
)

# ---- doğal duruş: kemikleri dünya uzayında hedef yönlere çevir ----
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"


def aim(name, d, roll_keep=True):
    pb = rig.pose.bones[name]
    bpy.context.view_layer.update()
    m = pb.matrix.copy()
    cur = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
    q = cur.rotation_difference(Vector(d).normalized())
    head = m.translation.copy()
    R = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head)
    pb.matrix = R @ m
    bpy.context.view_layer.update()


def rot(name, axis, deg):
    """dünya ekseni etrafında kemiği (ve çocuklarını) döndür"""
    pb = rig.pose.bones[name]
    bpy.context.view_layer.update()
    m = pb.matrix.copy()
    head = m.translation.copy()
    q = Quaternion(Vector(axis).normalized(), math.radians(deg))
    pb.matrix = (
        Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head)
    ) @ m
    bpy.context.view_layer.update()


HAND_OUT = 0.05
PALM_BACK = 0.35
CURL = {
    "index": (10, 18, 12),
    "middle": (14, 24, 16),
    "ring": (18, 28, 18),
    "pinky": (22, 30, 20),
    "thumb": (6, 12, 10),
}
# karakter -Y'ye bakar; sol = +X
side = {"l": 1, "r": -1}
for sfx, sg in side.items():
    aim(f"upperarm_{sfx}", (sg * 0.27, 0.02, -1))
    aim(f"lowerarm_{sfx}", (sg * 0.16, -0.30, -1))
    # el: tam yönelim; Y = el doğrultusu, avuç normali = sg*X (uyluğa bakar, hafif geriye)
    hb = rig.pose.bones[f"hand_{sfx}"]
    bpy.context.view_layer.update()
    Y = Vector((sg * HAND_OUT, -0.10, -1)).normalized()
    P = Vector((-sg, PALM_BACK, 0.0))
    P = (P - Y * P.dot(Y)).normalized()
    X = P * sg
    Z = X.cross(Y)
    M = Matrix((X, Y, Z)).transposed().to_4x4()
    M.translation = hb.matrix.translation
    hb.matrix = M
    bpy.context.view_layer.update()
    # parmak kıvrımı: eksen = parmak yönü x avuç normali (+açı ucu avuca götürür)
    for f, (a1, a2, a3) in CURL.items():
        for k, ang in zip(["01", "02", "03"], (a1, a2, a3)):
            pb = rig.pose.bones[f"{f}_{k}_{sfx}"]
            bpy.context.view_layer.update()
            fy = (pb.matrix.to_3x3() @ Vector((0, 1, 0))).normalized()
            pn = (hb.matrix.to_3x3() @ Vector((1, 0, 0))).normalized() * sg
            rot(pb.name, fy.cross(pn), ang)

# bacaklar: hafif açık duruş, ağırlık sağ bacakta (kontrapost)
aim("thigh_l", (0.10, -0.03, -1))
aim("thigh_r", (-0.05, 0.0, -1))
aim("calf_l", (0.06, 0.06, -1))
aim("calf_r", (-0.05, 0.0, -1))
rot("pelvis", (0, 1, 0), -2.0)
rot("spine_02", (0, 1, 0), 2.5)
rot("neck_01", (1, 0, 0), 3)
rot("head", (0, 0, 1), -4)
bpy.context.view_layer.update()

bpy.ops.object.mode_set(mode="OBJECT")

print("BONES", [b.name for b in rig.data.bones])
print(
    "OBJS",
    [
        (o.name, o.type, len(o.data.vertices) if o.type == "MESH" else 0)
        for o in bpy.data.objects
    ],
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "stage1.blend"))
