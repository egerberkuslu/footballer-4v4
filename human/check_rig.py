# Otomatik deri bağı denetimi: ağırlık toplamı, sol/sağ uyluk karışması, aşırı pozlarda gerilen kenarlar,
# şort-tozluk arası deri varlığı. İsteğe bağlı poz render'ı.
# Çalıştır: blender -b stage6.blend -P check_rig.py [-- render]
import bpy, sys, math
import numpy as np

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
O = bpy.data.objects
rig = O["Futbolcu"]
MESH = [O[n] for n in ("Govde", "Kiyafet", "Forma", "Sort", "Sac") if n in O]
fail = []


def report(ok, msg):
    print(("TAMAM  " if ok else "HATA   ") + msg)
    if not ok:
        fail.append(msg)


# ---- 1) ağırlık denetimi ----
for o in MESH:
    gi = {g.index: g.name for g in o.vertex_groups}
    bones = {b.name for b in rig.data.bones}
    bad_sum = mixed = unbound = 0
    for v in o.data.vertices:
        ws = {
            gi[g.group]: g.weight
            for g in v.groups
            if gi[g.group] in bones and g.weight > 1e-4
        }
        s = sum(ws.values())
        if not ws:
            unbound += 1
        elif abs(s - 1) > 0.02:
            bad_sum += 1
        if ws.get("thigh_l", 0) > 0.02 and ws.get("thigh_r", 0) > 0.02:
            mixed += 1
        if ws.get("calf_l", 0) > 0.02 and ws.get("calf_r", 0) > 0.02:
            mixed += 1
    report(
        bad_sum == 0 and unbound == 0,
        f"{o.name}: ağırlık toplamı≠1 tepe {bad_sum}, bağsız tepe {unbound}",
    )
    report(mixed == 0, f"{o.name}: hem sol hem sağ bacak kemiğine bağlı tepe {mixed}")

# ---- 2) şort paçası ile tozluk arası deri var mı (her bacakta z bantlarını tara) ----
g = O["Govde"]
zs = np.array([v.co.z for v in g.data.vertices])
xs = np.array([v.co.x for v in g.data.vertices])
for side, sg in (("sol", 1), ("sağ", -1)):
    on = xs * sg > 0.03
    gaps = [
        z
        for z in np.arange(0.48, 0.72, 0.02)
        if not np.any(on & (np.abs(zs - z) < 0.012))
    ]
    report(
        not gaps,
        f"{side} bacak diz/uyluk derisi (z 0.48–0.72) eksik bant: {[round(z, 2) for z in gaps]}",
    )

# ---- 2b) kapalı gövde: Govde'nin deri kısmında yalnız izinli açıklıklar (göz, ağız, ayakkabı içi) ----
import bmesh, json

lm = json.load(open("/home/ege/Blender-MCP/footballer/human/bake/landmarks.json"))
bm = bmesh.new()
bm.from_mesh(g.data)
bnd = [e for e in bm.edges if e.is_boundary]
seen, loops = set(), []
for e in bnd:
    if e in seen:
        continue
    st, comp = [e], []
    seen.add(e)
    while st:
        x = st.pop()
        comp.append(x)
        for v in x.verts:
            for y in v.link_edges:
                if y.is_boundary and y not in seen:
                    seen.add(y)
                    st.append(y)
    from mathutils import Vector
    c = sum((v.co for x in comp for v in x.verts), Vector()) / (2 * len(comp))
    loops.append((len(comp), c))
ez = (lm["eye_l"][2] + lm["eye_r"][2]) / 2
bad = []
for n, c in loops:
    allowed = c.z < 0.25 or abs(c.z - ez) < 0.03 or (abs(c.x) < 0.03 and ez - 0.10 < c.z < ez - 0.04)
    if not allowed:
        bad.append((n, tuple(round(v, 2) for v in c)))
bm.free()
report(not bad, f"Govde kapalı gövde: {len(loops)} açık halka, izinsiz {len(bad)} {bad[:5]}")

# ---- 3) aşırı pozlarda gerilme ----
P = rig.pose.bones


def reset():
    for b in P:
        b.rotation_mode = "XYZ"
        b.rotation_euler = (0, 0, 0)
        b.location = (0, 0, 0)


def deg(b, x=0, y=0, z=0):
    P[b].rotation_euler = (math.radians(x), math.radians(y), math.radians(z))


POSES = {
    "genis_kosu": lambda: (
        deg("thigh_l", -85),
        deg("calf_l", 0),
        deg("thigh_r", 55),
        deg("calf_r", -100),
        deg("upperarm_l", 60),
        deg("upperarm_r", -60),
        deg("spine_02", -10),
    ),
    "kayarak_mudahale": lambda: (
        deg("thigh_l", -95),
        deg("thigh_r", -15, 0, -25),
        deg("calf_r", -120),
        deg("spine_01", 25),
        deg("upperarm_r", 0, 0, -70),
        deg("upperarm_l", 30),
    ),
    "kaleci_ucus": lambda: (
        deg("upperarm_l", 0, 0, 150),
        deg("upperarm_r", 0, 0, -150),
        deg("thigh_l", -20, 0, 35),
        deg("thigh_r", 10, 0, -20),
        deg("calf_l", -40),
        deg("spine_02", 0, 15, 0),
    ),
}
dg = bpy.context.evaluated_depsgraph_get()
for name, fn in POSES.items():
    reset()
    fn()
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    for o in MESH:
        me = o.data
        ev = o.evaluated_get(dg).data
        R = np.array([v.co for v in me.vertices])
        E = np.array([v.co for v in ev.vertices])
        e = np.array([ed.vertices[:] for ed in me.edges])
        l0 = np.linalg.norm(R[e[:, 0]] - R[e[:, 1]], axis=1)
        l1 = np.linalg.norm(E[e[:, 0]] - E[e[:, 1]], axis=1)
        bad = np.nonzero((l1 > 0.05) & (l1 > 3 * l0))[0]
        msg = f"{name}/{o.name}: 3x+ gerilen kenar {len(bad)}"
        if len(bad):
            i = bad[np.argmax(l1[bad])]
            msg += f" (en kötü {l1[i]:.2f} m @ {tuple(np.round(R[e[i, 0]], 2))})"
        report(len(bad) == 0, msg)
    if "render" in args:
        sys.argv = [
            sys.argv[0],
            "--",
            f"/home/ege/Blender-MCP/footballer/human/wip/poz_{name}",
            "24",
            "on,yan",
            "520",
        ]
        exec(
            compile(
                open("/home/ege/Blender-MCP/footballer/human/render.py").read(),
                "render.py",
                "exec",
            )
        )
reset()
print("SONUÇ", "GEÇTİ" if not fail else f"{len(fail)} HATA")
