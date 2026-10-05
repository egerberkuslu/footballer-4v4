"""Analiz iskeleti: ogrenme egrisi PNG (CSV'den) ve eval JSON ozeti (IQM + bootstrap GA).
python3 rl/py/analyze.py curve --csv rl/runs/m1a/log.csv --out rl/runs/m1a/curve.png
python3 rl/py/analyze.py iqm --json rl/runs/*/eval.json"""
from __future__ import annotations

import argparse
import json

import numpy as np


def iqm(x):
    x = np.sort(np.asarray(x, float))
    n = len(x)
    return float(x[int(0.25 * n) : int(np.ceil(0.75 * n))].mean())


def curve(csv_path, out, smooth=20):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import pandas as pd
    df = pd.read_csv(csv_path)
    fig, ax = plt.subplots(2, 3, figsize=(15, 8))
    cols = [("ep_ret", "ortalama bolum odulu"), ("goal_diff", "gol farki (biz - rakip)"), ("ent_d", "ayrik entropi"), ("term_goal", "terim: gol"), ("term_ball_progress", "terim: top ilerlemesi"), ("sps", "adim/s")]
    for a, (c, t) in zip(ax.flat, cols):
        y = df[c].astype(float)
        a.plot(df["steps"], y, alpha=0.25)
        a.plot(df["steps"], y.rolling(smooth, min_periods=1).mean())
        a.set_title(t); a.set_xlabel("ortam adimi"); a.grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(out, dpi=110)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["curve", "iqm"])
    p.add_argument("--csv"); p.add_argument("--out"); p.add_argument("--json", nargs="*")
    a = p.parse_args()
    if a.cmd == "curve":
        curve(a.csv, a.out)
    else:
        for f in a.json or []:
            d = json.load(open(f))
            for r in d["results"]:
                print(f, r["opponent"], "gd", round(r["goal_diff_mean"], 3), "CI95", [round(v, 2) for v in r["goal_diff_ci95"]])


if __name__ == "__main__":
    main()
