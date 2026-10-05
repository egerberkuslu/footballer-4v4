# Prosedürel saç kartları: eski kask gibi saç kabuğunun yerine, kafa yüzeyine yatan
# katmanlı, rastgele yönlü ince şerit kartlar ve tel dokulu yumuşak alfa atlası.
# s6_web.py içinden çağrılır (bpy, numpy, mathutils gerekir).
import math
import random

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

NCOL = 4  # atlas sütunları: 0-2 normal tel demeti, 3 seyrek ince tel


def _smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def make_texture(w, h, color, seed=5):
    """(h, w, 4) float32; satır 0 = alt (kök), v arttıkça uca gider. Kök opak, uç tel tel erir."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w, 4), np.float32)
    cw = w // NCOL
    v = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    u = np.linspace(0, 1, cw, dtype=np.float32)[None, :]
    base = np.array(color, np.float32)
    for c in range(NCOL):
        thin = c == NCOL - 1
        ns = 9 if thin else 64
        alpha = np.zeros((h, cw), np.float32)
        col = np.zeros((h, cw, 3), np.float32)
        for _ in range(ns):
            uk = rng.random()
            wk = rng.uniform(0.010, 0.018) if thin else rng.uniform(0.016, 0.040)
            lk = rng.uniform(0.35, 0.8) if thin else rng.uniform(0.45, 0.95)
            wob = rng.uniform(-0.03, 0.03) * v  # tel hafif eğilir
            prof = np.exp(-(((u - uk - wob) / (wk * (1.0 - 0.55 * v))) ** 2))
            fade = _smooth(lk, lk - 0.45, v)  # uca doğru erir
            a = prof * fade
            shade = rng.uniform(0.65, 1.35) * (0.85 + 0.3 * v)
            m = a > alpha
            alpha = np.where(m, a, alpha)
            col = np.where(m[..., None], base * shade[..., None], col)
        if not thin:
            # kök yarısı yoğun yatak: mip seviyelerinde alfa kapsama kaybolmasın (alfa testi uzakta deliyordu)
            sn_ = rng.random(cw).astype(np.float32)
            sn_ = np.convolve(sn_, np.ones(5, np.float32) / 5, "same")
            streak = 0.6 + 0.7 * (sn_ - sn_.min()) / max(sn_.max() - sn_.min(), 1e-6)
            bed = _smooth(0.78, 0.38, v) * 0.95 * np.ones_like(u)
            bedm = bed > alpha
            alpha = np.maximum(alpha, bed)
            col = np.where(bedm[..., None], base[None, None, :] * streak[None, :, None] * (0.8 + 0.4 * v[..., None]), col)
        edge = _smooth(0.0, 0.05, u) * _smooth(1.0, 0.95, u)
        alpha = np.clip(alpha * (0.35 + 0.65 * edge) * 1.25, 0, 1)
        # renk her yerde dolu (kenarda koyu sızıntı olmasın)
        filled = np.where(alpha[..., None] > 0.02, col, base * 0.9)
        out[:, c * cw : (c + 1) * cw, :3] = filled
        out[:, c * cw : (c + 1) * cw, 3] = alpha
    # taban (undercoat) için sağ üst köşede dolu opak blok: mip'te komşu texel'lerle karışıp alfa testinde kaybolmasın
    out[-96:, -96:, :3] = base * 0.8
    out[-96:, -96:, 3] = 1.0
    out[..., :3] = np.clip(out[..., :3], 0, 1)
    return out


def _hull_data(hull_obj):
    me = hull_obj.data
    verts = [v.co.copy() for v in me.vertices]
    tris = []
    for p in me.polygons:
        idx = list(p.vertices)
        for k in range(1, len(idx) - 1):
            tris.append((idx[0], idx[k], idx[k + 1]))
    bvh = BVHTree.FromPolygons(verts, tris)
    return verts, tris, bvh


def build_cards(hull_obj, n_cards, nseg, style="fringe", seed=3, scale=1.0):
    """Döner: verts, faces (dörtgen), uv (köşe başına, 0..1 atlas uzayı), kök ağırlığı yok.
    hull_obj: saç kabuğu (örnekleme alanı ve yüzey). style: fringe | back."""
    rnd = random.Random(seed)
    verts, tris, bvh = _hull_data(hull_obj)
    co = np.array([tuple(v) for v in verts])
    ctr = Vector(
        ((co[:, 0].min() + co[:, 0].max()) / 2, co[:, 1].mean(), co[:, 2].mean())
    )
    zmax = co[:, 2].max()
    # alan ağırlıklı örnekleme
    areas = []
    for a, b, c in tris:
        areas.append(((verts[b] - verts[a]).cross(verts[c] - verts[a])).length / 2)
    cum = np.cumsum(areas)
    out_v, out_f, out_uv = [], [], []

    def tri_pt():
        r = rnd.random() * cum[-1]
        i = int(np.searchsorted(cum, r))
        a, b, c = (verts[k] for k in tris[i])
        s, t = rnd.random(), rnd.random()
        if s + t > 1:
            s, t = 1 - s, 1 - t
        return a + (b - a) * s + (c - a) * t

    def flow(p, n):
        g = Vector((0, 0, -1))
        r = Vector((p.x - ctr.x, p.y - ctr.y, 0))
        if r.length > 1e-6:
            r.normalize()
        d = g * 0.7 + r * 0.45
        top = max(0.0, (p.z - (zmax - 0.07)) / 0.07)  # tepe
        front = p.y < ctr.y - 0.03
        if style == "back":
            d += Vector((0, 1, 0)) * (0.9 + 0.5 * top)
        elif front:
            d += Vector((0, -1, 0)) * (0.30 + 0.35 * top)  # alın perçemi öne ve aşağı
        else:
            d += Vector((0, 1, 0)) * 0.15 * top
        d = d - n * d.dot(n)  # yüzeye teğet
        if d.length < 1e-6:
            d = Vector((0, 0, -1)) - n * (-n.z)
        d.normalize()
        ang = (card_ang[0] + rnd.uniform(-0.9, 0.9)) if style == "curly" else rnd.uniform(-0.55, 0.55)  # rastgele yön sapması (kıvırcıkta her adımda)
        q = n.copy()
        from mathutils import Quaternion

        return Quaternion(q, ang) @ d

    card_ang = [0.0]
    made = 0
    tries = 0
    while made < n_cards and tries < n_cards * 6:
        tries += 1
        p = tri_pt()
        if made < n_cards // 9:  # tepe noktası boş kalmasın: ilk kartlar tepeye
            for _try in range(40):
                if p.z > zmax - 0.03:
                    break
                p = tri_pt()
        loc, n, _, dist = bvh.find_nearest(p)
        if loc is None:
            continue
        curly = style == "curly"
        card_ang[0] = rnd.uniform(-math.pi, math.pi)
        thin = (rnd.random() < 0.22) and not curly
        layer = rnd.choice((0.003, 0.007, 0.012, 0.018) if curly else (0.0015, 0.003, 0.005, 0.008)) * scale
        length = (
            ((rnd.uniform(0.030, 0.050) if curly else rnd.uniform(0.022, 0.045)) if not thin else rnd.uniform(0.018, 0.032))
            * (1.0 - 3.0 * layer)
            * scale
        )
        step = length / nseg
        width = (
            (rnd.uniform(0.007, 0.013) if curly else rnd.uniform(0.010, 0.019)) if not thin else rnd.uniform(0.005, 0.008)
        ) * scale
        lift = (rnd.uniform(0.004, 0.014) if curly else rnd.uniform(0.0005, 0.005)) * scale
        pts = [(loc.copy(), n.copy())]
        cur = loc.copy()
        cn = n.copy()
        for k in range(nseg):
            d = flow(cur, cn)
            nxt = cur + d * step
            l2, n2, _, _ = bvh.find_nearest(nxt)
            if l2 is None or (l2 - cur).length < 0.45 * step:
                break  # kabuğun sınırına geldi
            pts.append((l2.copy(), n2.copy()))
            cur, cn = l2, n2
        if len(pts) < 3:
            continue
        m = len(pts)
        col = rnd.randrange(NCOL - 1) if not thin else NCOL - 1
        u0 = col / NCOL + 0.004
        u1 = (col + 1) / NCOL - 0.004
        roll = rnd.uniform(-0.6, 0.6)
        base_i = len(out_v)
        for i, (pp, nn) in enumerate(pts):
            t = i / (m - 1)
            # yön: bir sonraki/önceki noktadan
            j0, j1 = max(0, i - 1), min(m - 1, i + 1)
            tan = pts[j1][0] - pts[j0][0]
            side = tan.cross(nn)
            if side.length < 1e-9:
                side = Vector((1, 0, 0))
            side.normalize()
            if abs(roll) > 1e-6 and tan.length > 1e-9:
                from mathutils import Quaternion as _Q

                side = _Q(tan.normalized(), roll) @ side
            h = layer + lift * t * t
            c = pp + nn * h
            wd = width * (1.0 - 0.45 * t) / 2
            out_v.append(tuple(c - side * wd))
            out_v.append(tuple(c + side * wd))
            out_uv.append((u0, t))
            out_uv.append((u1, t))
        for i in range(m - 1):
            a = base_i + 2 * i
            out_f.append((a, a + 1, a + 3, a + 2))
        made += 1
    return out_v, out_f, out_uv


def undercoat(hull_obj, ratio, uv_pt, keep=None):
    """Saç kabuğunun seyreltilmiş kopyası: kartların altında opak koyu taban (kafa derisi görünmesin).
    Döner: verts, tris, uv (hepsi atlasta dolu bir noktaya)."""
    import bpy

    ob = bpy.data.objects.new("UC_tmp", hull_obj.data.copy())
    bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new("d", "DECIMATE")
    md.ratio = ratio
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    v = [tuple(x.co) for x in me.vertices]
    f = []
    for p in me.polygons:
        if keep is not None and not keep(p.center):
            continue
        idx = list(p.vertices)
        for k in range(1, len(idx) - 1):
            f.append((idx[0], idx[k], idx[k + 1]))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return v, f, [uv_pt] * len(v)
