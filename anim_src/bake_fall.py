# Faul dusmesi ve yerden kalkis klipleri (CMU, cgspeed iskeleti) -> futbolcu.glb iskeleti; calisma-zamani JSON (anim_fall.json).
# Kullanim: blender -b -P bake_fall.py
# Yontem (bake_kick.py ile ayni aktarim) + ek olarak:
#  - Yer: her karede DERILI MESH degerlendirilir, pelvis yuksekligi en alt vertex zemine (dinlenme pozundaki taban) degecek sekilde
#    cozulur (dusme/kalkis boyunca vucudun bir yeri hep yerdedir). Kaynak 139/140 kok yuksekligi tutarsiz oldugu icin kaynaktan alinmaz.
#  - Yatay pelvis: yere degen vertexler kaymasin diye kareden kareye "temas capasi" ile cozulur (kaynak kok yatayi kullanilmaz).
#  - Ayna: kaynak dunya donusleri X'e gore yansitilir, sol/sag kemikler yer degistirir (ek varyant).
#  - Zaman: kaynak segmenti, yarisi duzgun yarisi hareket-yay uzunluguna gore yeniden zamanlanip N kareye orneklenir.
import bpy, json, math
import numpy as np
from mathutils import Matrix, Vector, Quaternion

DST = "../viewer/public/futbolcu.glb"
OUT = "anim_fall_cmu.json"  # ara cikti; bake_fall_gf.py CMU dusmelerini birlesik anim_fall.json icine katar
# ad: (kaynak, ilk kare, son kare, tur, yatis, ters, N)  kare = FBX karesi (1 tabanli)
#  fall: ilk kare ayakta (yuz ileri hizalanir), son kare yerde yatis.  getup: ilk kare yatis, son kare ayakta (yuz ileri hizalanir)
SPECS = {
    "fall_back": ("90_18", 14, 50, "fall", "back", False, 36),
    "fall_face": (
        "139_16",
        118,
        34,
        "fall",
        "face",
        True,
        36,
    ),  # yerden kalkisin tersi (CMU'da dogal one dusme yok; 90_16 akrobatik)
    "getup_face": ("139_16", 34, 118, "getup", "face", False, 56),
    "getup_face2": ("139_17", 22, 118, "getup", "face", False, 56),
    "getup_back": ("140_08", 34, 150, "getup", "back", False, 56),
    "getup_back2": ("140_09", 12, 126, "getup", "back", False, 56),
}
MIRROR = True
MAP = {
    "pelvis": "hip",
    "spine_01": "abdomen",
    "spine_03": "chest",
    "neck_01": "neck",
    "head": "head",
}
for s in "lr":
    MAP.update(
        {
            f"clavicle_{s}": f"{s}Collar",
            f"upperarm_{s}": f"{s}Shldr",
            f"lowerarm_{s}": f"{s}ForeArm",
            f"hand_{s}": f"{s}Hand",
            f"thigh_{s}": f"{s}Thigh",
            f"calf_{s}": f"{s}Shin",
            f"foot_{s}": f"{s}Foot",
        }
    )
ABS = {"thigh", "calf", "foot"}
ARM = {"upperarm", "lowerarm", "hand"}
g = lambda v: [v[0], v[2], -v[1]]
gq = lambda q: [q.x, q.z, -q.y, q.w]
MX = Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, 1)))
opp = (
    lambda n: ("r" + n[1:])
    if n[0] == "l" and n[1:2].isupper()
    else (("l" + n[1:]) if n[0] == "r" and n[1:2].isupper() else n)
)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=DST)
dst = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
meshes = [
    o
    for o in bpy.data.objects
    if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)
]
dnames = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head"] + [
    f"{a}_{s}"
    for s in "lr"
    for a in ("clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot")
]
depth = lambda n: len(dst.data.bones[n].parent_recursive)
dnames.sort(key=lambda n: (depth(n), n))
for pb in dst.pose.bones:
    pb.rotation_mode = "QUATERNION"
DW = dst.matrix_world.copy()
DWi = DW.inverted()


def mesh_verts():
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in meshes:
        e = o.evaluated_get(dg)
        m = e.to_mesh()
        n = len(m.vertices)
        a = np.empty(n * 3)
        m.vertices.foreach_get("co", a)
        W = np.array(e.matrix_world)
        out.append(a.reshape(-1, 3) @ W[:3, :3].T + W[:3, 3])
        e.to_mesh_clear()
    return np.concatenate(out)  # dunya (armatur ~ dunya, kayma 1.2 cm z)


V0 = mesh_verts()
GROUND = V0[
    :, 2
].min()  # dinlenme pozunda taban (oyunda zemin = sahnenin en alt noktasi)
print("zemin (dinlenme taban) z=%.4f, vertex %d" % (GROUND, len(V0)))
HIPH = (DW @ dst.data.bones['pelvis'].head_local).z - GROUND  # dinlenme kalca yuksekligi (oyunda rig.dims.hipH ile olceklenir)
out = {'bones': dnames, 'hipH': round(HIPH, 4), 'clips': {}}

for key, (src_name, fa, fb, kind, lie, rev, N) in SPECS.items():
    for o in [o for o in bpy.data.objects if o.name.startswith(src_name)]:
        bpy.data.objects.remove(o)
    bpy.ops.import_scene.fbx(filepath=f"cmu_pick/{src_name}.fbx")
    src = [
        o
        for o in bpy.data.objects
        if o.type == "ARMATURE" and o.name.startswith(src_name)
    ][0]
    SW = src.matrix_world.to_3x3()
    step = -1 if rev else 1
    frames_src = list(range(fa, fb + step, step))
    for mir in [False, True] if MIRROR else [False]:
        name = key + ("_m" if mir else "")
        Mm = MX if mir else Matrix.Identity(3)
        sn_of = (lambda n: opp(n)) if mir else (lambda n: n)

        # kaynak dunya yonelimleri / konumlari (aynali ise yansitilmis, sol-sag degismis)
        def Srest(n):
            return Mm @ (SW @ src.data.bones[sn_of(n)].matrix_local.to_3x3()) @ Mm

        def Spose(n):
            return Mm @ (SW @ src.pose.bones[sn_of(n)].matrix.to_3x3()) @ Mm

        def Spos(n):
            return Mm @ (src.matrix_world @ src.pose.bones[sn_of(n)].head)

        def facing():  # yatay bakis: kalca sol-sag vektorunun diki (CMU ayakta -Y bakar)
            sd = Spos("lThigh") - Spos("rThigh")
            return Vector((sd.y, -sd.x, 0)).normalized()

        ref = frames_src[0] if kind == "fall" else frames_src[-1]
        acc = Vector()
        for f in (
            [ref + k * step for k in range(0, 4)]
            if kind == "fall"
            else [ref - k * step for k in range(0, 4)]
        ):
            bpy.context.scene.frame_set(f)
            bpy.context.view_layer.update()
            acc += facing()
        fwd = Vector((acc.x, acc.y, 0)).normalized()
        Qfix = fwd.rotation_difference(Vector((0, -1, 0))).to_matrix()

        def rd(n):
            b = src.data.bones[sn_of(n)]
            w = Qfix @ Mm @ SW @ (b.tail_local - b.head_local)
            return Vector((w.x, 0, w.z)).normalized()

        def drd(n):
            b = dst.data.bones[n]
            w = b.tail_local - b.head_local
            return Vector((w.x, 0, w.z)).normalized()

        KARM = {
            s: drd(f"upperarm_{s}").rotation_difference(rd(MAP[f"upperarm_{s}"]))
            for s in "lr"
        }
        sR = {n: Qfix @ Srest(n) for n in MAP.values()}
        ratio = dst.data.bones['pelvis'].head_local.z / (SW @ src.data.bones['hip'].head_local).z
        rec = []
        for f in frames_src:
            bpy.context.scene.frame_set(f)
            bpy.context.view_layer.update()
            qs = {}
            for dn in dnames:
                if dn == "spine_02":
                    continue
                sn = MAP[dn]
                db = dst.data.bones[dn]
                Rs = sR[sn]
                Rd = db.matrix_local.to_3x3()
                Ps = Qfix @ Spose(sn)
                base = dn.split("_")[0]
                if base in ABS:
                    q = Rd.col[1].rotation_difference(Rs.col[1])
                    Rd2 = q.to_matrix() @ Rd
                    R = Ps @ (Rs.inverted() @ Rd2)
                elif base in ARM:
                    R = (Ps @ Rs.inverted()) @ (KARM[dn[-1]].to_matrix() @ Rd)
                else:
                    R = (Ps @ Rs.inverted()) @ Rd
                qs[dn] = R
            qs["spine_02"] = (
                qs["spine_01"]
                .to_quaternion()
                .slerp(qs["spine_03"].to_quaternion(), 0.5)
                .to_matrix()
            )
            srch = Qfix @ Spos("hip")
            for dn in dnames:
                pb = dst.pose.bones[dn]
                db = dst.data.bones[dn]
                t = (
                    db.head_local.copy() if dn == "pelvis" else pb.head.copy()
                )  # pelvis dinlenme yerinde; yer/yatay asagida cozulur
                pb.matrix = Matrix.Translation(t) @ qs[dn].to_4x4()
                bpy.context.view_layer.update()
            V = mesh_verts()
            rec.append(
                {
                    "q": [
                        gq(
                            (
                                dst.pose.bones[dn].matrix.to_3x3()
                                @ dst.data.bones[dn].matrix_local.to_3x3().inverted()
                            ).to_quaternion()
                        )
                        for dn in dnames
                    ],
                    "V": V,
                    "srch": srch.copy(),
                    "rel": np.array(
                        [
                            list(dst.pose.bones[n].head - dst.pose.bones["pelvis"].head)
                            for n in (
                                "head",
                                "hand_l",
                                "hand_r",
                                "foot_l",
                                "foot_r",
                                "calf_l",
                                "calf_r",
                                "spine_03",
                            )
                        ]
                    ),
                }
            )
        # yer: en alt vertex zemine
        for r in rec:
            r["dz"] = GROUND - r["V"][:, 2].min()
            r["V"] = r["V"] + np.array([0, 0, r["dz"]])
        # yatay: temas capasi (iki karede de yere < 2.5 cm degen vertexlerin yatay kaymasi geri alinir)
        off = np.zeros(2)
        nc_min = 1e9
        offs = [off.copy()]
        for i in range(1, len(rec)):
            a, b = rec[i - 1]["V"], rec[i]["V"]
            c = (a[:, 2] < GROUND + 0.025) & (b[:, 2] < GROUND + 0.025)
            if c.sum() >= 3:
                d = np.median(b[c, :2] - a[c, :2], axis=0)
                off = off - d
                nc_min = min(nc_min, c.sum())
            else:  # havada: kaynak kalca yatay hizi (olcekli)
                dv = rec[i]["srch"] - rec[i - 1]["srch"]
                off = off + np.array([dv.x, dv.y]) * ratio
            offs.append(off.copy())
        offs = np.array(offs)
        offs -= (
            offs[0] if kind == "fall" else offs[-1]
        )  # dusme: baslangic kok altinda; kalkis: bitis kok altinda
        # temas kaymasi kontrolu (cozulmus yatayla): yerde kalan vertexlerin kare-arasi yatay kaymasi
        slide = []
        for i in range(1, len(rec)):
            a = rec[i - 1]["V"][:, :2] + offs[i - 1]
            b = rec[i]["V"][:, :2] + offs[i]
            c = (rec[i - 1]["V"][:, 2] < GROUND + 0.01) & (
                rec[i]["V"][:, 2] < GROUND + 0.01
            )
            if c.sum():
                slide.append(np.median(np.linalg.norm(b[c] - a[c], axis=1)))
        # yeniden zamanlama: yarisi duzgun, yarisi hareket yayi (pelvise gore uzuv yer degisimi + pelvis)
        K = len(rec)
        mv = [0.0] + [
            float(
                np.linalg.norm(rec[i]["rel"] - rec[i - 1]["rel"], axis=1).mean()
                + abs(rec[i]["dz"] - rec[i - 1]["dz"])
                + np.linalg.norm(offs[i] - offs[i - 1])
            )
            for i in range(1, K)
        ]
        A = np.cumsum(mv)
        A /= A[-1]
        tau = 0.5 * np.linspace(0, 1, K) + 0.5 * A
        us = np.linspace(0, 1, N)
        fi = np.interp(us, tau, np.arange(K))
        Q = []
        PEL = []
        for x in fi:
            i = min(int(x), K - 2)
            w = x - i
            qa = [rec[i]["q"][k] for k in range(len(dnames))]
            qb = [rec[i + 1]["q"][k] for k in range(len(dnames))]
            row = []
            for k in range(len(dnames)):

                A_ = Quaternion((qa[k][3], qa[k][0], qa[k][1], qa[k][2]))
                B_ = Quaternion((qb[k][3], qb[k][0], qb[k][1], qb[k][2]))
                C_ = A_.slerp(B_, w)
                row += [C_.x, C_.y, C_.z, C_.w]
            Q.append(row)
            ox = offs[i][0] * (1 - w) + offs[i + 1][0] * w
            oy = offs[i][1] * (1 - w) + offs[i + 1][1] * w
            dz = rec[i]["dz"] * (1 - w) + rec[i + 1]["dz"] * w
            PEL.append(g(Vector((ox, oy, dz))))
        # yatis meta: pelvis->bas yatay yonu (oyun uzayi, x,z) ve pelvis ofseti
        li = -1 if kind == "fall" else 0
        hr = rec[li]["rel"][0]
        hx, hz = hr[0], -hr[1]
        lieYaw = math.atan2(hx, hz)
        # hareket araliklari (normalize u): kalkista yuksekligin yarisini gectigi an, dusmede yere ilk degdigi an
        hgt = np.array([rec[int(round(x))]["dz"] for x in fi])
        print(
            f"{name}: {src_name} {fa}->{fb} ({K} kare, {K / 30:.2f} s) N={N} lieYaw={math.degrees(lieYaw):.0f} lieOff=({PEL[li][0]:.2f},{PEL[li][2]:.2f}) "
            f'pelvis dz [{min(r["dz"] for r in rec):.2f},{max(r["dz"] for r in rec):.2f}] kayma medyan {np.median(slide) * 1000 if slide else -1:.1f} mm/kare, '
            f"en kotu {max(slide) * 1000 if slide else -1:.1f} mm, min temas vertex {nc_min}"
        )
        out["clips"][name] = {
            "kind": kind,
            "lie": lie,
            "src": src_name,
            "dur": round(K / 30, 3),
            "n": N,
            "lieYaw": round(lieYaw, 4),
            "q": [[round(x, 4) for x in row] for row in Q],
            "pel": [[round(x, 4) for x in p] for p in PEL],
        }
    for o in [o for o in bpy.data.objects if o.name.startswith(src_name)]:
        bpy.data.objects.remove(o)
    for pb in dst.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)

json.dump(out, open(OUT, "w"), separators=(",", ":"))
print("YAZILDI", OUT, len(out["clips"]), "klip")
