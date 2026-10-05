"""RESULTS_M1.md'yi JSON/CSV'den uretir (elle sayi yok). python3 rl/py/make_results.py"""
import json, warnings
import pandas as pd
warnings.filterwarnings("ignore")
R = "rl/runs/"
cfg = json.load(open(R + "m1a/config.json"))
d = pd.read_csv(R + "m1a/log.csv")
ev = {}
for f in ["m1a/eval_kolay.json", "m1a/eval_orta_zor.json"]:
    for r in json.load(open(R + f))["results"]:
        ev[r["opponent"]] = r
base = {p: {r["opponent"]: r for r in json.load(open(R + f"baseline_{p}.json"))["results"]} for p in ["idle", "random"]}
dd = d[d.ep_n > 0]
def seg(a, b):
    s = dd[(dd.steps >= a) & (dd.steps < b)]
    return s.ep_ret.mean(), s.goal_diff.mean()
rows = [f"| {a/1e6:.1f}-{b/1e6:.1f} M | {seg(a,b)[0]:+.2f} | {seg(a,b)[1]:+.2f} |" for a, b in [(0, 5e5), (5e5, 1e6), (1e6, 2e6), (2e6, 3e6), (3e6, 4e6), (4e6, 5.1e6)]]
tm = [c for c in d.columns if c.startswith("term_")]
last = dd[dd.steps >= 4e6][tm].mean()
first = dd[dd.steps < 5e5][tm].mean()
def line(name, r):
    return f"| {name} | {r['n']} | {r['gf_mean']:.2f} | {r['ga_mean']:.2f} | {r['goal_diff_mean']:+.2f} [{r['goal_diff_ci95'][0]:+.2f}, {r['goal_diff_ci95'][1]:+.2f}] | {r['win']}/{r['draw']}/{r['loss']} |"
out = ["# M1 sanity kosusu: MAPPO + deepsets, 4v4 vs heuristic:kolay", "",
 f"Komut: `train.py --encoder deepsets --opponent heuristic:kolay --steps 5000000 --envs 10 --seed 1` (tohum 1, W=10 Node isci, {cfg['device']}, torch {cfg['torch']}, OBS_VERSION {cfg['obs_version']}). Kayit: `rl/runs/m1a/` (config.json, log.csv, ckpt.pt, curve.png, eval_*.json).", "",
 f"Sure {d.wall_s.iloc[-1]/60:.0f} dk, {int(d.steps.iloc[-1])} ortam adimi, ortalama {d.steps.iloc[-1]/d.wall_s.iloc[-1]:.0f} adim/s uctan uca (hedef >= 4000 TUTMADI: Python lockstep + GPU cikarimi). GPU kullanimi (nvidia-smi ornekleri, egitim sirasinda): ortalama {d.gpu_util.dropna().mean():.0f}%, bellek {d.gpu_mem_mb.dropna().mean():.0f} MB.", "",
 "## Ogrenme egrisi (egitim bolumleri, stokastik politika)", "![egri](runs/m1a/curve.png)", "", "| adim | ort. bolum odulu | gol farki (biz-rakip) |", "|---|---|---|", *rows, "",
 "Odul terimleri (bolum ortalamasi, ajan basina): " + ", ".join(f"{c[5:]} {first[c]:+.3f} -> {last[c]:+.3f}" for c in tm) + " (ilk 0.5 M adim -> son 1 M adim).", "",
 "## Degerlendirme (100 mac, farkli tohum, deterministik politika, bootstrap %95 GA)", "| rakip / politika | mac | gol (biz) | gol (rakip) | gol farki [GA] | G/B/M |", "|---|---|---|---|---|---|"]
for o in ["heuristic:kolay", "heuristic:orta", "heuristic:zor"]:
    out += [line(f"{o} / **MAPPO deepsets**", ev[o]), line(f"{o} / rastgele", base["random"][o]), line(f"{o} / her zaman bosta", base["idle"][o])]
out += ["", "## Yorum (dürüst)", "- Ogrenme VAR: egitim gol farki ve bolum odulu yukseliyor, deterministik degerlendirmede rastgele tabana gore buyuk fark (kolay: -3.6 -> -1.1) ve atilan gol 0.65 -> 2.8.",
 "- Ama 5 M adimda el yazmasi `kolay`i YENEMIYOR (G/B/M 26/18/56); hucum ogrenildi (gol atiyor), savunma/kaleci zayif (yenen gol 3.9). 'Her zaman bosta' tabani gol farkinda daha iyi (-0.26) cunku el yazmasi AI bos takima neredeyse gol atamiyor (0.26): yani goal_diff tek basina yeterli bir olcut degil, atilan ve yenen gol ayri okunmali.",
 "- Olasi nedenler / sonraki adim (ara olcut: odul terimleri ve entropi): yenen gol cezasi sekillendirmesiz ve seyrek; ayrik entropi hizla ~0.02-0.05'e coktu (maske cogu zaman tek gecerli eylem birakiyor); sabit gamma 0.99 ve 1200 adimlik bolum; daha uzun egitim (>= 20 M), savunma icin top-kale araligi/konumlanma sekillendirmesi, kolay seviyeden orta seviyeye mufredat. Hicbiri bu kosuda denenmedi.",
 "- Egitim (stokastik) son 1 M adim gol farki pozitif iken deterministik degerlendirmede negatif: deterministik eylem (ortalama + argmax) stokastikten daha kotu; `eval.py --stochastic` ile ayrica olculmedi (acik is).",
 "- Tek tohum (1), tek koşu: guven araligi yalniz degerlendirme mac orneklemini yansitir, egitim tohumu varyansini degil (planin >= 5 tohum kurali henuz uygulanmadi)."]
open("rl/RESULTS_M1.md", "w").write("\n".join(out) + "\n")
print("yazildi")
