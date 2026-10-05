# Kıyafet atlası ve takım varyantları (sistem python'u): maskeler + palet -> tex/kit_*.png, public/kits/*.png
# Atlas düzeni kit_layout.json'a yazılır (s6_web.py UV'leri buna göre taşır). UV: Blender kuralı, v yukarı.
# Çalıştır: python3 kit_make.py
import os, json
import numpy as np
from PIL import Image

HERE = __import__("os").environ.get("HUMAN_DIR", "/home/ege/Blender-MCP/footballer/human")
T = f"{HERE}/tex"
KITS = __import__("os").environ.get("KITS_OUT", "/home/ege/Blender-MCP/footballer/viewer/public/kits")
os.makedirs(KITS, exist_ok=True)
S = 2048

# (x0, y0, w, h) UV biriminde
LAYOUT = {
    "Forma": (0.0, 0.40, 1.0, 0.60),
    "Sort": (0.0, 0.0, 0.45, 0.40),
    "Tozluk": (0.45, 0.0, 0.22, 0.40),
    "Krampon": (0.67, 0.0, 0.33, 0.20),
    "Numara": (0.70, 0.205, 0.19, 0.19),
    "Civi": (0.93, 0.21, 0.03, 0.03),
}
# sırt numarası kutusu (dinlenme konumunda, metre): x ∈ [-BOX/2, BOX/2], z ∈ [Z1-BOX, Z1]
NUM_BOX = 0.26
NUM_Z1 = 1.375


def c(*v):
    return np.array(v, np.float32) / 255.0


WHITE = c(236, 236, 232)
# kit: forma (birincil, ikincil), şort, tozluk
PALETTES = {
    "home": dict(
        forma=(c(250, 182, 20), c(168, 18, 40)),
        sort=(WHITE, c(168, 18, 40)),
        tozluk=(c(168, 18, 40), c(250, 182, 20)),
    ),
    "away": dict(
        forma=(c(24, 38, 82), c(15, 25, 58)),
        sort=(c(20, 32, 70), WHITE),
        tozluk=(WHITE, c(20, 32, 70)),
    ),
    "gk_home": dict(
        forma=(c(36, 160, 76), c(20, 108, 50)),
        sort=(c(20, 108, 50), c(36, 160, 76)),
        tozluk=(c(36, 160, 76), c(20, 108, 50)),
    ),
    "gk_away": dict(
        forma=(c(246, 124, 22), c(205, 84, 12)),
        sort=(c(205, 84, 12), c(246, 124, 22)),
        tozluk=(c(246, 124, 22), c(205, 84, 12)),
    ),
    "ref": dict(
        forma=(c(34, 34, 38), c(30, 30, 34)),
        sort=(c(26, 26, 30), c(48, 48, 54)),
        tozluk=(c(26, 26, 30), c(52, 52, 58)),
    ),
}


def px_rect(reg):
    x0, y0, w, h = reg
    # PIL üstten başlar
    return (
        int(round(x0 * S)),
        int(round((1 - y0 - h) * S)),
        int(round(w * S)),
        int(round(h * S)),
    )


def load(path):
    return np.asarray(Image.open(path).convert("RGBA"), np.float32) / 255.0


def resize(a, w, h):
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    return np.asarray(im.resize((w, h), Image.LANCZOS), np.float32) / 255.0


masks = {n: load(f"{T}/{n.lower()}_maske0.png") for n in ("Forma", "Sort", "Tozluk")}
boot = (
    np.asarray(Image.open(f"{T}/krampon_albedo.jpg").convert("RGB"), np.float32) / 255.0
)


def colorize(m, p1, p2):
    rgb = m[..., 0:1] * p1 + m[..., 1:2] * p2 + m[..., 2:3] * WHITE
    return rgb * m[..., 3:4]


def number_patch(p1, p2, w, h):
    """numara kutusundaki forma deseni (şeritler, rest x'e göre), numarasız"""
    u = (np.arange(w) + 0.5) / w
    x = (0.5 - u) * NUM_BOX
    W = 0.088
    s = (x + W / 2) / W
    odd = (np.floor(s).astype(int) % 2) == 1
    fr = s - np.floor(s)
    edge = np.minimum(fr, 1 - fr) * W
    px = NUM_BOX / w * 1.5
    t = np.clip(edge / px, 0, 1)
    wa = np.where(odd, 0.5 - 0.5 * t, 0.5 + 0.5 * t)  # birincil payı
    row = wa[:, None] * p1 + (1 - wa)[:, None] * p2
    return np.repeat(row[None], h, 0) * 0.93


def weave(h, w, seed, light):
    """kumaş: düşük frekanslı leke (±%2) ve ince gren (±%1); açık kitlerde ek çok ince çapraz örgü (≤0.02).
    Çapraz bant/uzun periyotlu desen yok (koyu formada balık sırtı gibi görünüyordu)."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    lo = rng.random((h // 16 + 2, w // 16 + 2)).astype(np.float32)
    lo = np.asarray(Image.fromarray((lo * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255.0 - 0.5
    grain = rng.random((h, w)).astype(np.float32) - 0.5
    fine = 0.5 * np.sin(2 * np.pi * x / 4.0) * np.sin(2 * np.pi * y / 4.0) if light else 0.0
    return 0.02 * lo * 2 + 0.01 * grain * 2 + (0.02 * fine if light else 0.0)


def build(name, pal):
    atlas = np.zeros((S, S, 3), np.float32)
    for g in ("Forma", "Sort", "Tozluk"):
        x, y, w, h = px_rect(LAYOUT[g])
        p1, p2 = pal[g.lower()]
        atlas[y : y + h, x : x + w] = resize(colorize(masks[g], p1, p2), w, h)
    light = name in ("home", "gk_home")
    for g in ("Forma", "Sort", "Tozluk"):
        x, y, w, h = px_rect(LAYOUT[g])
        mod = weave(h, w, 3, light)
        reg = atlas[y : y + h, x : x + w]
        covered = (reg.mean(-1, keepdims=True) > 0.004).astype(np.float32)
        atlas[y : y + h, x : x + w] = reg * (1 + mod[..., None]) * covered + reg * (1 - covered)
    x, y, w, h = px_rect(LAYOUT["Krampon"])
    b = boot.copy()
    H, W = b.shape[:2]
    vv, uu = np.mgrid[0:H, 0:W] / np.array([H, W])[:, None, None]
    sock = (uu > 0.755) & (vv > 0.84)  # ayakkabının çorap parçası tozluk rengini alsın
    L = boot.mean(-1, keepdims=True)
    b = np.where(sock[..., None], pal["tozluk"][0] * np.clip(0.75 + 1.2 * (L - L[sock].mean()), 0.5, 1.2), b)
    atlas[y : y + h, x : x + w] = resize(b, w, h)
    x, y, w, h = px_rect(LAYOUT["Numara"])
    atlas[y : y + h, x : x + w] = number_patch(*pal["forma"], w, h)
    x, y, w, h = px_rect(LAYOUT["Civi"])
    atlas[y : y + h, x : x + w] = c(190, 152, 30)
    im = Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8))
    im.save(f"{KITS}/{name}.png", optimize=True)
    if name == "home":
        im.save(f"{T}/kit_home.jpg", quality=90)
    print("kit", name, os.path.getsize(f"{KITS}/{name}.png") // 1024, "KB")


for k, p in PALETTES.items():
    build(k, p)

x0, y0, w, h = LAYOUT["Numara"]
info = {
    "layout": LAYOUT,
    "num_box_m": NUM_BOX,
    "num_z1": NUM_Z1,
    # glTF/three UV kuralı (v aşağı, flipY=false): sol üst (u0,v0), sağ alt (u1,v1)
    "numara_uv_gltf": [x0, 1 - (y0 + h), x0 + w, 1 - y0],
}
json.dump(info, open(f"{HERE}/kit_layout.json", "w"), indent=1)
print("numara_uv_gltf", info["numara_uv_gltf"])
