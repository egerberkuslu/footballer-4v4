"""Degerlendirme: egitilmis politikayi (ya da 'random'/'idle' tabani) N macta heuristic:kolay|orta|zor'a karsi oynatir.
Cikti JSON: gol farki (ortalama + bootstrap %95 GA), G/B/M, odul terimleri. Her mac farkli tohum.
Ornek: python3 rl/py/eval.py --ckpt rl/runs/m1a/ckpt.pt --matches 100 --out rl/runs/m1a/eval.json"""
from __future__ import annotations

import argparse
import json

import numpy as np
import torch

from mappo import DEFAULT_W, NORM_DIMS, TERMS, RunningMS
from models import ActorCritic, to_env_action
from vec_env import VecEnv


def boot_ci(x, n=2000, seed=0):
    x = np.asarray(x, float)
    rng = np.random.default_rng(seed)
    m = [x[rng.integers(0, len(x), len(x))].mean() for _ in range(n)]
    return float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))


class Policy:
    def __init__(self, kind, ckpt=None, dev="cuda", stochastic=False):
        self.kind, self.dev, self.stoch = kind, dev, stochastic
        self.rng = np.random.default_rng(0)
        if kind == "ckpt":
            s = torch.load(ckpt, map_location=dev, weights_only=False)
            a = s["meta"]["args"]
            self.m = ActorCritic(a["encoder"], a["hid"], a["role_mode"], a["critic"], a["comm_radius"], a["rounds"]).to(dev)
            self.m.load_state_dict(s["model"])
            self.m.eval()
            self.on = RunningMS((len(NORM_DIMS),), dev)
            self.on.load(s["onorm"])

    def act(self, obs, mask):
        W, A, _ = obs.shape
        if self.kind == "idle":
            a = np.zeros((W, A, 8), np.float32)
            return a
        if self.kind == "random":
            a = self.rng.uniform(-1, 1, (W, A, 8)).astype(np.float32)
            for e in range(W):
                for g in range(A):
                    a[e, g, 7] = self.rng.choice(np.flatnonzero(mask[e, g]))
            return a
        o = torch.as_tensor(obs, device=self.dev)
        x = o.clone()
        x[..., NORM_DIMS] = ((o[..., NORM_DIMS] - self.on.mean) / (self.on.var.sqrt() + 1e-6)).clamp(-10, 10)
        mk = torch.as_tensor(mask, device=self.dev)
        u, sp, d, _ = self.m.act(x, mk, deterministic=not self.stoch)
        return to_env_action(u, sp, d).cpu().numpy()


def evaluate(policy: Policy, opponent: str, n_matches=100, workers=8, seed=100000, episode_sec=120):
    env = VecEnv(workers, episodeSec=episode_sec, opponent=opponent, seed=seed)
    obs, info = env.reset(seeds=[seed + i for i in range(workers)])
    started = workers
    res = []
    run_terms = np.zeros((workers, len(TERMS)), np.float32)
    # ilk workers bolum + yeni bolumler otomatik; tamamlanan ilk n_matches bolum sayilir
    while len(res) < n_matches:
        a = policy.act(obs, info["action_mask"])
        obs, rew, term, trunc, info = env.step(a)
        run_terms += info["reward_terms"][:, :, :].mean(1)
        for e in np.flatnonzero(term | trunc):
            if len(res) < n_matches:
                iv = info["info_vec"][e]
                res.append({"gf": float(iv[0]), "ga": float(iv[1]), "terms": run_terms[e].tolist()})
            run_terms[e] = 0
    env.close()
    gd = np.array([r["gf"] - r["ga"] for r in res])
    lo, hi = boot_ci(gd)
    gf = np.array([r["gf"] for r in res]); ga = np.array([r["ga"] for r in res])
    return {"opponent": opponent, "n": len(res), "goal_diff_mean": float(gd.mean()), "goal_diff_ci95": [lo, hi], "gf_mean": float(gf.mean()), "ga_mean": float(ga.mean()),
            "win": int((gd > 0).sum()), "draw": int((gd == 0).sum()), "loss": int((gd < 0).sum()),
            "terms_mean": {k: float(np.mean([r["terms"][i] for r in res])) for i, k in enumerate(TERMS)}}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ckpt")
    p.add_argument("--policy", default="ckpt", choices=["ckpt", "random", "idle"])
    p.add_argument("--matches", type=int, default=100)
    p.add_argument("--opponents", default="heuristic:kolay,heuristic:orta,heuristic:zor")
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--stochastic", action="store_true")
    p.add_argument("--seed", type=int, default=100000)
    p.add_argument("--out", required=True)
    a = p.parse_args()
    pol = Policy(a.policy, a.ckpt, "cuda" if torch.cuda.is_available() else "cpu", a.stochastic)
    out = {"policy": a.policy, "ckpt": a.ckpt, "stochastic": a.stochastic, "results": [evaluate(pol, o, a.matches, a.workers, a.seed) for o in a.opponents.split(",")]}
    json.dump(out, open(a.out, "w"), indent=1)
    for r in out["results"]:
        print(f"{r['opponent']}: n={r['n']} gd={r['goal_diff_mean']:+.2f} CI95=[{r['goal_diff_ci95'][0]:+.2f},{r['goal_diff_ci95'][1]:+.2f}] G/B/M={r['win']}/{r['draw']}/{r['loss']} gf={r['gf_mean']:.2f} ga={r['ga_mean']:.2f}")


if __name__ == "__main__":
    main()
