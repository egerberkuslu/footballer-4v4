# Doku üretimi (sistem python'u): forma/şort/tozluk deseni, kumaş normal karosu, deri, saç, krampon -> tex/
# Çalıştır: python3 tex_make.py
import os, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy import ndimage

HAIR = os.environ.get("HAIR", "short02")
SKIN_MUL = [float(x) for x in os.environ.get("SKIN_MUL", "0.93,0.83,0.74").split(",")]
HAIR_MUL = [float(x) for x in os.environ.get("HAIR_MUL", "0.42,0.30,0.22").split(",")]
HERE = __import__("os").environ.get("HUMAN_DIR", "/home/ege/Blender-MCP/footballer/human")
B = f"{HERE}/bake"
T = f"{HERE}/tex"
os.makedirs(T, exist_ok=True)
DATA = os.path.expanduser("~/.config/blender/4.0/mpfb/data")


def srgb(c):
    return np.array(c, np.float32) / 255.0


YEL = srgb((250, 182, 20))
RED = srgb((168, 18, 40))
DRED = srgb((120, 10, 28))
WHITE = srgb((236, 236, 232))


def smooth_step(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a * (1 - t) + b * t


MASK = {"on": False, "ao": None}


def apply_ao(col, f):
    """maske kipinde AO ayrı kanala (A) yazılır, renge çarpılmaz"""
    if MASK["on"]:
        MASK["ao"] = f
        return col
    return col * f[..., None]


def save(arr, name, q=92):
    if MASK["on"] and name.endswith("_albedo.jpg"):
        a = MASK["ao"] if MASK["ao"] is not None else np.ones(arr.shape[:2], np.float32)
        a = flipv(a) if arr.shape[:2] == a.shape and MASK.get("flip") else a
        rgba = np.concatenate([np.clip(arr, 0, 1), a[..., None]], -1)
        suf = "_maske0.png" if os.environ.get("NUMARASIZ") else "_maske.png"
        p = f"{T}/" + name.replace("_albedo.jpg", suf)
        Image.fromarray((rgba * 255 + 0.5).astype(np.uint8)).save(p)
        print("yazıldı", p)
        return
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    p = f"{T}/{name}"
    if name.endswith(".jpg"):
        im.save(p, quality=q)
    else:
        im.save(p)
    print("yazıldı", p, im.size)


def texel_size(field):
    """piksel başına metre (kenar yumuşatma genişliği)"""
    gy, gx = np.gradient(field)
    return np.clip(np.hypot(gx, gy), 1e-4, 0.01)


def flipv(a):
    # Blender piksel dizisi alttan başlar; resim dosyası üstten
    return a[::-1]


# ---------- sayı ve arma görüntüleri ----------
def text_img(
    txt, size=1024, font="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
):
    im = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(font, int(size * 0.95))
    bb = d.textbbox((0, 0), txt, font=f)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    d.text(((size - w) / 2 - bb[0], (size - h) / 2 - bb[1]), txt, fill=255, font=f)
    return np.asarray(im, np.float32) / 255.0


def sample(img, u, v):
    """img[0..1] üzerinde (u,v) ∈ [0,1] çift doğrusal örnekleme; dışarısı 0"""
    h, w = img.shape
    ok = (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)
    out = ndimage.map_coordinates(
        img, [np.clip(v, 0, 1) * (h - 1), np.clip(u, 0, 1) * (w - 1)], order=1
    )
    return np.where(ok, out, 0.0)


# ---------- forma ----------
def jersey():
    z = np.load(f"{B}/Forma.npz")
    rest, rn, at, part, ao = z["rest"], z["rnorm"], z["attr"], z["part"], z["ao"]
    x, y, zz = rest[..., 0], rest[..., 1], rest[..., 2]
    d_yaka, d_kol = at[..., 0], at[..., 1]
    px = texel_size(x) * 1.5
    W = 0.088  # şerit genişliği (m)
    s = (x + W / 2) / W
    fr = s - np.floor(s)
    # şerit kenarına uzaklık (m) ve tek/çift
    edge = np.minimum(fr, 1 - fr) * W
    odd = (np.floor(s).astype(int) % 2) == 1
    t_red = np.where(odd, smooth_step(-px, px, edge), 1 - smooth_step(-px, px, edge))
    # kenar geçişi: tek şeritte kırmızı, kenarda karışım
    torso = mix(
        YEL,
        RED,
        np.where(
            odd,
            0.5 + 0.5 * smooth_step(0, px, edge),
            0.5 - 0.5 * smooth_step(0, px, edge),
        ),
    )
    sleeve = smooth_step(0.47, 0.53, part)
    col = mix(torso, RED, sleeve)
    # kol ağzı: sarı bant + ince koyu kırmızı çizgi
    pk = texel_size(d_kol) * 1.5
    cuff = 1 - smooth_step(0.020 - pk, 0.020 + pk, d_kol)
    col = mix(col, YEL, cuff * sleeve)
    line = smooth_step(0.004 - pk, 0.004 + pk, d_kol) * (
        1 - smooth_step(0.008 - pk, 0.008 + pk, d_kol)
    )
    col = mix(col, DRED, line * sleeve)
    # yaka: kırmızı ribana + sarı ince çizgi
    pyk = texel_size(d_yaka) * 1.5
    collar = 1 - smooth_step(0.016 - pyk, 0.016 + pyk, d_yaka)
    col = mix(col, RED, collar)
    cl = smooth_step(0.016 - pyk, 0.016 + pyk, d_yaka) * (
        1 - smooth_step(0.021 - pyk, 0.021 + pyk, d_yaka)
    )
    col = mix(col, YEL, cl)
    # riba dokusu: yakada kenara paralel ince çizgiler
    rib = 0.5 + 0.5 * np.cos(d_yaka / 0.0022 * 2 * np.pi)
    col = col * (1 - 0.12 * (collar * rib)[..., None])
    # sırt numarası
    num = text_img("10")
    back = smooth_step(0.15, 0.4, rn[..., 1])
    nu = 0.5 - x / 0.24
    nv = (1.37 - zz) / 0.24
    n_in = sample(num, nu, nv)
    n_out = sample(ndimage.grey_dilation(num, size=(25, 25)), nu, nv)
    if not os.environ.get("NUMARASIZ"):
        col = mix(col, DRED, n_out * back * (1 - sleeve))
        col = mix(col, WHITE, n_in * back * (1 - sleeve))
    # göğüste genel arma (marka değil): yuvarlak rozet + yıldız
    front = smooth_step(0.15, 0.4, -rn[..., 1])
    cx, cz, R = 0.095, 1.385, 0.036
    r = np.hypot(x - cx, zz - cz)
    pr = px
    disk = 1 - smooth_step(R - pr, R + pr, r)
    ring = smooth_step(R * 0.78 - pr, R * 0.78 + pr, r) * disk
    star = star_mask(x - cx, zz - cz, R * 0.55, pr)
    badge = mix(
        mix(RED[None, None] * np.ones_like(col), YEL, ring), YEL, star * (1 - ring)
    )
    col = mix(col, badge, disk * front * (1 - sleeve))
    # AO: kıvrım diplerini koyulaştır (hafif)
    col = apply_ao(col, 0.62 + 0.38 * np.clip(ao, 0, 1))
    save(flipv(col), "forma_albedo.jpg")


def star_mask(dx, dz, R, pr):
    ang = np.arctan2(dz, dx) - np.pi / 2
    rr = np.hypot(dx, dz)
    k = 5
    a = np.mod(ang, 2 * np.pi / k) - np.pi / k
    # beş köşeli yıldız: iç yarıçap 0.42R
    ri = 0.42 * R
    # kutupsal kenar: köşe ile iç nokta arası doğrusal
    edge_r = ri + (R - ri) * (1 - np.abs(a) / (np.pi / k))
    return 1 - smooth_step(edge_r - pr, edge_r + pr, rr)


# ---------- şort ----------
def shorts():
    z = np.load(f"{B}/Sort.npz")
    rest, rn, at, ao = z["rest"], z["rnorm"], z["attr"], z["ao"]
    x = rest[..., 0]
    d_bel, d_paca = at[..., 0], at[..., 1]
    col = np.ones(rest.shape, np.float32) * WHITE
    # dış yan şerit: normal dışa bakan bölge
    side = rn[..., 0] * np.sign(x)
    st = smooth_step(0.965, 0.985, side)
    col = mix(col, RED, st)
    pb = texel_size(d_bel) * 1.5
    band = 1 - smooth_step(0.035 - pb, 0.035 + pb, d_bel)
    col = col * (1 - 0.06 * band[..., None])
    pp = texel_size(d_paca) * 1.5
    hem = 1 - smooth_step(0.016 - pp, 0.016 + pp, d_paca)
    col = mix(col, RED, hem)
    col = apply_ao(col, 0.58 + 0.42 * np.clip(ao, 0, 1))
    save(flipv(col), "sort_albedo.jpg")


# ---------- tozluk ----------
def socks():
    z = np.load(f"{B}/Tozluk.npz")
    at, ao = z["attr"], z["ao"]
    d = at[..., 0]
    p = texel_size(d) * 1.5
    col = np.ones(at.shape, np.float32) * RED

    def band(a, b):
        return smooth_step(a - p, a + p, d) * (1 - smooth_step(b - p, b + p, d))

    col = mix(col, YEL, band(0.014, 0.024) + band(0.032, 0.042))
    # üst lastikte enine riba
    rib = 0.5 + 0.5 * np.cos(d / 0.003 * 2 * np.pi)
    col = col * (1 - 0.10 * ((d < 0.05) * rib)[..., None])
    col = apply_ao(col, 0.7 + 0.3 * np.clip(ao, 0, 1))
    save(flipv(col), "tozluk_albedo.jpg")


# ---------- kumaş normal karosu (polyester örgü: küçük delikli file) ----------
def knit_normal(n=512, cells=16, strength=2.2):
    u, v = np.meshgrid(np.arange(n) / n, np.arange(n) / n)
    a = 2 * np.pi * cells
    # şaşırtmalı sıra: altıgen hissi
    h = np.cos(a * u + np.pi * (np.floor(v * cells) % 2)) * np.cos(a * v / 2) ** 2
    h += 0.6 * np.cos(a * 2 * v)
    rng = np.random.default_rng(3)
    h += ndimage.gaussian_filter(rng.standard_normal((n, n)), 1.2, mode="wrap") * 0.5
    h = (h - h.min()) / (h.max() - h.min())
    gy, gx = np.gradient(h)
    nx, ny = -gx * strength * cells / 4, gy * strength * cells / 4
    nz = np.ones_like(nx)
    l = np.sqrt(nx**2 + ny**2 + nz**2)
    nm = np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5
    save(nm, "kumas_normal.png")


# ---------- deri ----------
def skin():
    src = f"{DATA}/skins/young_caucasian_male2/young_lightskinned_male_diffuse2.png"
    a = np.asarray(Image.open(src).convert("RGB"), np.float32) / 255.0
    H, W = a.shape[:2]
    # hafif bronz ton ve kontrast
    a = np.clip(a * np.array(SKIN_MUL), 0, 1)
    a = np.clip((a - 0.5) * 1.06 + 0.5, 0, 1)
    zp = np.load(f"{B}/Human.npz")
    P = flipv(zp["pos"])
    N = flipv(zp["nrm"])
    if P.shape[0] != H:
        zoom = H / P.shape[0]
        P = ndimage.zoom(P, (zoom, zoom, 1), order=1)
        N = ndimage.zoom(N, (zoom, zoom, 1), order=1)
    lm = json.load(open(f"{B}/landmarks.json"))
    ez = (lm["eye_l"][2] + lm["eye_r"][2]) / 2
    ey = (lm["eye_l"][1] + lm["eye_r"][1]) / 2
    x, y, zz = P[..., 0], P[..., 1], P[..., 2]
    # sakal gölgesi: çene, yanak alt, üst dudak; ön/yan yüzey
    mouth_z = ez - 0.072
    beard = smooth_step(ez - 0.035, ez - 0.055, zz) * smooth_step(
        ez - 0.16, ez - 0.13, zz
    )
    beard *= (
        smooth_step(0.075, 0.055, np.abs(x))
        + smooth_step(ey + 0.07, ey + 0.03, y) * 0.0
    )
    beard *= smooth_step(ey + 0.085, ey + 0.05, y)  # kulak önüne kadar
    # dudakları koru
    lips = np.exp(-(((zz - mouth_z) / 0.009) ** 2) - ((x / 0.026) ** 2)) * smooth_step(
        ey - 0.06, ey - 0.09, y
    )
    beard *= 1 - np.clip(lips * 1.6, 0, 1)
    rng = np.random.default_rng(7)
    grain = ndimage.gaussian_filter(rng.random((H, W)), 0.7)
    grain = (grain - grain.min()) / (grain.max() - grain.min())
    stub = np.clip(beard, 0, 1) * (0.55 + 0.45 * grain)
    stub_col = np.array([0.16, 0.11, 0.08])
    a = mix(a, stub_col * np.ones_like(a), np.clip(stub * 0.42, 0, 1))
    # kafa: kısa kesim saç gölgesi (saç modelinin kenarını derideki saçla kaynaştırır)
    head_top = lm["head"][1][2]
    scalp = smooth_step(ez + 0.025, ez + 0.06, zz) * smooth_step(
        ey - 0.04, ey + 0.02, y + 0.0
    )
    scalp = np.maximum(scalp, smooth_step(ez + 0.065, ez + 0.09, zz))
    # yan/arka: kulak üstü ve ense
    nape = smooth_step(ez - 0.02, ez + 0.02, zz) * smooth_step(ey + 0.07, ey + 0.10, y)
    hair_m = np.clip(np.maximum(scalp, nape) * (0.6 + 0.4 * grain), 0, 1)
    hair_m *= (zz > ez - 0.06) & (zz < head_top + 0.2)
    a = mix(a, np.array([0.05, 0.035, 0.025]) * np.ones_like(a), hair_m * 0.85)
    save(a, "deri_albedo.jpg", q=93)
    # deri normali: parlaklığın yüksek-geçirgen hali + ince gözenek
    L = a.mean(-1)
    hp = L - ndimage.gaussian_filter(L, 4)
    pore = ndimage.gaussian_filter(rng.standard_normal((H, W)), 0.8) * 0.02
    h = hp * 0.6 + pore
    gy, gx = np.gradient(h)
    k = 9.0
    nx, ny, nz = -gx * k, gy * k, np.ones_like(gx)
    l = np.sqrt(nx**2 + ny**2 + nz**2)
    save(np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5, "deri_normal.jpg", q=95)
    # pürüzlülük: alın/burun daha parlak, genel 0.55
    rough = np.full((H, W), 0.56, np.float32)
    tz = (
        np.exp(-((x / 0.03) ** 2))
        * smooth_step(ez - 0.06, ez - 0.02, zz)
        * smooth_step(ez + 0.09, ez + 0.05, zz)
    )
    rough -= 0.12 * tz * smooth_step(ey + 0.02, ey - 0.02, y)
    rough += 0.06 * (grain - 0.5)
    save(np.repeat(rough[..., None], 3, -1), "deri_rough.jpg")


# ---------- saç ----------
def hair():
    im = Image.open(f"{DATA}/hair/{HAIR}/{HAIR}_diffuse.png").convert("RGBA")
    a = np.asarray(im, np.float32) / 255.0
    rgb = a[..., :3]
    L = rgb.mean(-1, keepdims=True)
    rgb = np.clip(L * np.array(HAIR_MUL) * 1.15, 0, 1)
    out = np.concatenate([rgb, a[..., 3:]], -1)
    Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(f"{T}/sac_albedo.png")
    print("yazıldı sac_albedo.png")


# ---------- krampon ----------
def boots():
    im = Image.open(f"{DATA}/clothes/shoes05/shoes05_diffuse.png").convert("RGB")
    a = np.asarray(im, np.float32) / 255.0
    H, W = a.shape[:2]
    L = a.mean(-1)
    v, u = np.mgrid[0:H, 0:W] / np.array([H, W])[:, None, None]
    # üst yüz: siyah, perforasyon detayı hafif
    col = (0.025 + 0.07 * L)[..., None] * np.array([1.0, 1.0, 1.05])
    # taban (dokunun üst şeridi): yeşili sarıya çevir, gövde koyu kırmızı
    sole = v < 0.27
    g = np.clip(a[..., 1] - np.maximum(a[..., 0], a[..., 2]), 0, 1)
    sole_col = (
        mix(np.ones_like(a) * DRED * 0.6, YEL, np.clip(g * 4, 0, 1))
        * (0.4 + 0.8 * L)[..., None]
    )
    col = np.where(sole[..., None], sole_col, col)
    # çorap parçası (sağ alt kare): tozluk kırmızısı
    sock = (u > 0.755) & (v > 0.84)
    col = np.where(sock[..., None], RED * (0.75 + 0.35 * L)[..., None], col)
    # yan şerit yerine sarı tek kıvrım vurgusu (marka yok)
    save(col, "krampon_albedo.jpg")


if __name__ == "__main__":
    import sys

    if "maske" in sys.argv:
        # renk değiştirilebilir giysiler: R=birincil, G=ikincil, B=beyaz numara, A=AO
        g = globals()
        E = lambda *v: np.array(v, np.float32)
        MASK["on"] = MASK["flip"] = True
        for fn, pal in (
            (jersey, dict(YEL=E(1, 0, 0), RED=E(0, 1, 0), DRED=E(0, 0.7, 0), WHITE=E(0, 0, 1))),
            (shorts, dict(WHITE=E(1, 0, 0), RED=E(0, 1, 0), YEL=E(0, 0, 0), DRED=E(0, 0.7, 0))),
            (socks, dict(RED=E(1, 0, 0), YEL=E(0, 1, 0), WHITE=E(0, 0, 0), DRED=E(0, 0.7, 0))),
        ):
            keep = {k: g[k] for k in pal}
            g.update(pal)
            fn()
            g.update(keep)
        sys.exit(0)
    which = sys.argv[1:] or [
        "jersey",
        "shorts",
        "socks",
        "knit",
        "skin",
        "hair",
        "boots",
    ]
    for w in which:
        {
            "jersey": jersey,
            "shorts": shorts,
            "socks": socks,
            "knit": knit_normal,
            "skin": skin,
            "hair": hair,
            "boots": boots,
        }[w]()
