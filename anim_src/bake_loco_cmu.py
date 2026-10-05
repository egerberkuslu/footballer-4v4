# Lokomosyon ajani: CMU yurume/jog/kosu dongu klipleri (cgspeed iskeleti) -> futbolcu.glb; public/anim_loco_cmu.json
# Kullanim: blender -b -P bake_loco_cmu.py
# Yontem (bake_kick.py ile ayni aktarim): dunya-uzayi delta, bacak MUTLAK yon, kol T-poz duzeltmesi.
# - olcek: hedef bacak boyu / kaynak bacak boyu (kalca yuksekligi DEGIL: 127_xx dinlenme pozu kaymis)
# - tek devir: ayni ayagin iki temasi arasi; sinirlar, devir basi/sonu pozu en benzer olacak sekilde (+-3 kare, 0.25 adim) ince ayarlanir
# - M ornek; dikis hatasi devir boyunca dagitilir; faz 0 = sol ayak basar (ornekler dondurulur)
# - pelvis yuksekligi: basan bilek, kaynaktaki (devir minimumuna gore) bilek yuksekligi olcekli olacak sekilde
# - yatay pelvis: devir boyu dogrusal yol cikarilir (yerinde), devir ici salinim kalir
# - vref = basma fazinda yerinde bilegin geri kayma hizi medyani (bu hizda kok ilerlerse basan ayak kaymaz)
# UYARI: CMU 141_xx / 143_xx zaman ekseni ~2.2x sikisik (ziplamada g ~45 m/s2 olculdu): KULLANMA.
import bpy, json, math
from mathutils import Matrix, Vector, Quaternion

CLIPS = {
    "walk": ("35_01", 4, 38),
    "walkf": ("16_21", 11, 41),
    "jog30": ("16_35", 3, 27),
    "jog36": ("35_20", 10, 33),
    "run38": ("09_01", 3, 23),
    "run43": ("104_37", 12, 35),
    "run44": ("16_45", 5, 26),
    "run50": ("104_48", 2, 23),
    "run52": ("102_05", 6, 25),
}
M = 32
DST = "../viewer/public/futbolcu.glb"
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
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=DST)
dst = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
dnames = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head"] + [
    f"{a}_{s}"
    for s in "lr"
    for a in (
        "clavicle",
        "upperarm",
        "lowerarm",
        "hand",
        "thigh",
        "calf",
        "foot",
        "ball",
    )
]
depth = lambda n: len(dst.data.bones[n].parent_recursive)
dnames.sort(key=lambda n: (depth(n), n))
for pb in dst.pose.bones:
    pb.rotation_mode = "QUATERNION"
D = dst.data.bones
dleg = (D["calf_l"].head_local - D["thigh_l"].head_local).length + (
    D["foot_l"].head_local - D["calf_l"].head_local
).length
out = {"bones": dnames, "m": M, "clips": {}}
restFootZ = (D["foot_l"].head_local.z + D["foot_r"].head_local.z) / 2
SIM = [
    "hip",
    "lThigh",
    "rThigh",
    "lShin",
    "rShin",
    "lFoot",
    "rFoot",
    "lShldr",
    "rShldr",
    "lForeArm",
    "rForeArm",
    "abdomen",
    "chest",
]
for key, (name, fa0, fb0) in CLIPS.items():
    for o in [o for o in bpy.data.objects if o.type == "ARMATURE" and o != dst]:
        bpy.data.objects.remove(o)
    bpy.ops.import_scene.fbx(filepath=f"cmu_pick/{name}.fbx")
    src = [
        o for o in bpy.data.objects if o.type == "ARMATURE" and o.name.startswith(name)
    ][0]
    FPS = bpy.context.scene.render.fps
    SB = src.data.bones
    hip0 = SB["hip"].head_local
    ratio = dleg / (
        (SB["lShin"].head_local - SB["lThigh"].head_local).length
        + (SB["lFoot"].head_local - SB["lShin"].head_local).length
    )

    def fset(ft):
        fi = int(math.floor(ft))
        bpy.context.scene.frame_set(fi, subframe=ft - fi)
        bpy.context.view_layer.update()

    # devir sinirlarini ince ayarla: kalcaya gore yerel yonelimler (bas/son) en benzer
    cache = {}

    def rel(ft):
        if ft not in cache:
            fset(ft)
            hq = src.pose.bones["hip"].matrix.to_quaternion()
            cache[ft] = [
                hq.inverted() @ src.pose.bones[n].matrix.to_quaternion()
                for n in SIM[1:]
            ] + [hq]
        return cache[ft]

    def cost(a, b):
        A, B = rel(a), rel(b)
        c = sum(A[i].rotation_difference(B[i]).angle ** 2 for i in range(len(A) - 1))
        # govde egimi (kalcanin yuvarlanma/yunuslamasi) de benzesin; sapma (yaw) serbest
        za = A[-1] @ Vector((0, 0, 1))
        zb = B[-1] @ Vector((0, 0, 1))
        return c + za.angle(zb) ** 2

    best = (1e9, fa0, fb0)
    act = src.animation_data.action
    F0, F1 = act.frame_range
    for da in [x * 0.5 for x in range(-4, 5)]:
        for db in [x * 0.5 for x in range(-6, 7)]:
            a, b = fa0 + da, fb0 + db
            if a < F0 or b > F1 or b - a < 8:
                continue
            c = cost(a, b)
            if c < best[0]:
                best = (c, a, b)
    _, fa, fb = best
    fset(fa)
    ha = src.pose.bones["hip"].head.copy()
    fset(fb)
    hb = src.pose.bones["hip"].head.copy()
    d = hb - ha
    fwd = Vector((d.x, d.y, 0)).normalized()
    Qfix = fwd.rotation_difference(Vector((0, -1, 0))).to_matrix()
    sR = {n: SB[n].matrix_local.to_3x3() for n in MAP.values()}

    def rd(n):
        b = SB[n]
        w = Qfix @ (b.tail_local - b.head_local)
        return Vector((w.x, 0, w.z)).normalized()

    def drd(n):
        b = D[n]
        w = b.tail_local - b.head_local
        return Vector((w.x, 0, w.z)).normalized()

    KARM = {
        s: drd(f"upperarm_{s}").rotation_difference(rd(MAP[f"upperarm_{s}"]))
        for s in "lr"
    }
    frames = []
    for k in range(M + 1):
        fset(fa + (fb - fa) * k / M)
        qs = {}
        for dn in dnames:
            if dn in ("spine_02", "ball_l", "ball_r"):
                continue
            sn = MAP[dn]
            db = D[dn]
            Rs = Qfix @ sR[sn]
            Rd = db.matrix_local.to_3x3()
            Ps = Qfix @ src.pose.bones[sn].matrix.to_3x3()
            base = dn.split("_")[0]
            if base in ABS:
                q = Rd.col[1].rotation_difference(Rs.col[1])
                Rd2 = q.to_matrix() @ Rd
                R = Ps @ (Rs.inverted() @ Rd2)
            elif base in ARM and dn.endswith(("_l", "_r")):
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
        for s in "lr":  # ayak parmagi: ayakla rijit (CMU'da parmak yok)
            qs[f"ball_{s}"] = (
                qs[f"foot_{s}"]
                @ D[f"foot_{s}"].matrix_local.to_3x3().inverted()
                @ D[f"ball_{s}"].matrix_local.to_3x3()
            )
        hipw = Qfix @ (src.pose.bones["hip"].head - hip0)
        for dn in dnames:
            pb = dst.pose.bones[dn]
            db = D[dn]
            t = (db.head_local + hipw * ratio) if dn == "pelvis" else pb.head.copy()
            pb.matrix = Matrix.Translation(t) @ qs[dn].to_4x4()
            bpy.context.view_layer.update()
        srcmin = min(src.pose.bones["lFoot"].head.z, src.pose.bones["rFoot"].head.z)
        frames.append(
            {
                "srcmin": srcmin,
                "q": [
                    (
                        dst.pose.bones[dn].matrix.to_3x3()
                        @ D[dn].matrix_local.to_3x3().inverted()
                    ).to_quaternion()
                    for dn in dnames
                ],
                "pel": hipw * ratio,
                "fl": dst.pose.bones["foot_l"].head.copy(),
                "fr": dst.pose.bones["foot_r"].head.copy(),
                "tl": dst.pose.bones["ball_l"].head.copy(),
                "tr": dst.pose.bones["ball_r"].head.copy(),
            }
        )
    nb = len(dnames)
    seams = []
    for bi in range(nb):
        q0 = frames[0]["q"][bi]
        qM = frames[M]["q"][bi]
        if q0.dot(qM) < 0:
            qM = -qM
        err = q0 @ qM.inverted()
        seams.append((math.degrees(err.angle), dnames[bi]))
        for k in range(M + 1):
            frames[k]["q"][bi] = Quaternion().slerp(err, k / M) @ frames[k]["q"][bi]
    seams.sort(reverse=True)
    p0, pM = frames[0]["pel"].copy(), frames[M]["pel"].copy()
    T = (fb - fa) / FPS
    vmean = Vector((pM.x - p0.x, pM.y - p0.y)).length / T
    for k, fr in enumerate(frames):
        lin = p0 + (pM - p0) * (k / M)
        sh = Vector((lin.x, lin.y, 0))
        fr["pel"] = Vector((fr["pel"].x - lin.x, fr["pel"].y - lin.y, fr["pel"].z))
        for f in ("fl", "fr", "tl", "tr"):
            fr[f] = fr[f] - sh
    # pelvis yuksekligi: kaynak zemini (devir boyu en alcak bilek) hedefte dinlenme bilek yuksekligine
    smin = min(fr["srcmin"] for fr in frames)
    for fr in frames:
        target = restFootZ + (fr["srcmin"] - smin) * ratio
        dz = target - min(fr["fl"].z, fr["fr"].z)
        fr["pel"].z += dz
        for f in ("fl", "fr", "tl", "tr"):
            fr[f].z += dz
    frames = frames[:M]

    # temas: bilek dususte (dz<0 onceki) en alcak +2.5 cm altina ilk inis
    def stance(f):
        # basma: bilek yere yakin (en alcak + 4 cm) VE yerinde klipte geri kayiyor (kok hizinin yarisindan fazla);
        # devir basina tek (en uzun dairesel) parca
        zmin = min(fr[f].z for fr in frames)
        n_ = len(frames)
        vr = vmean
        ok = []
        for k_ in range(n_):
            vy = (frames[(k_ + 1) % n_][f].y - frames[k_ - 1][f].y) / (2 * T / n_)
            ok.append(frames[k_][f].z < zmin + 0.04 and vy > 0.5 * vr)
        best, bs = 0, 0
        for s0 in range(n_):
            if ok[s0] and not ok[s0 - 1]:
                L_ = 0
                while L_ < n_ and ok[(s0 + L_) % n_]:
                    L_ += 1
                if L_ > best:
                    best, bs = L_, s0
        return [best > 0 and ((k_ - bs) % n_) < best for k_ in range(n_)]

    lowL, lowR = stance("fl"), stance("fr")
    cl = [k for k in range(M) if lowL[k] and not lowL[k - 1]]
    k0 = cl[0] if cl else 0
    rot = lambda a: a[k0:] + a[:k0]
    frames, lowL, lowR = rot(frames), rot(lowL), rot(lowR)
    cl = [k for k in range(M) if lowL[k] and not lowL[k - 1]]
    cr = [k for k in range(M) if lowR[k] and not lowR[k - 1]]
    dt = T / M
    sp = []
    for f, low in (("fl", lowL), ("fr", lowR)):
        for k in range(M):
            if low[k] and low[(k + 1) % M]:
                sp.append((frames[(k + 1) % M][f].y - frames[k][f].y) / dt)
    sp.sort()
    vref = sp[len(sp) // 2] if sp else vmean
    toemin = min(min(fr["tl"].z, fr["tr"].z) for fr in frames)
    out["clips"][key] = {
        "src": name,
        "a": fa,
        "b": fb,
        "dur": T,
        "vref": round(vref, 3),
        "vhip": round(vmean, 3),
        "cl": [k / M for k in cl],
        "cr": [k / M for k in cr],
        "stL": [1 if x else 0 for x in lowL],
        "stR": [1 if x else 0 for x in lowR],
        "q": [[round(x, 5) for q in fr["q"] for x in gq(q)] for fr in frames],
        "pel": [[round(x, 4) for x in g(fr["pel"])] for fr in frames],
        "ft": [[round(x, 4) for f in ("fl", "fr") for x in g(fr[f])] for fr in frames],
    }
    print(
        "LOCO",
        key,
        name,
        "devir [%.1f, %.1f] %.3f s" % (fa, fb, T),
        "kalca %.2f" % vmean,
        "vref %.2f" % vref,
        "basma hizlari",
        [round(x, 1) for x in sp],
        "solT",
        [round(k / M, 2) for k in cl],
        "sagT",
        [round(k / M, 2) for k in cr],
        "basma L %.2f R %.2f" % (sum(lowL) / M, sum(lowR) / M),
        "parmak min %.3f" % toemin,
        "dikis",
        ["%s %.0f" % (n, a) for a, n in seams[:4]],
    )
json.dump(out, open("../viewer/public/anim_loco_cmu.json", "w"), separators=(",", ":"))
