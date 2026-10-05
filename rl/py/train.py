"""MAPPO egitim CLI. Ornek: python3 rl/py/train.py --encoder deepsets --opponent heuristic:kolay --steps 5000000 --envs 8 --out rl/runs/m1a
Kontrol noktasi + devam (--resume), CSV (+ istege bagli wandb, varsayilan offline), tohum kaydi, adim/s ve GPU kullanimi."""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import time

import numpy as np
import torch

from mappo import PPO, DEFAULT_W, TERMS, PPOCfg
from models import ActorCritic
from vec_env import VecEnv


def gpu_util():
    try:
        out = subprocess.check_output(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits"], text=True, timeout=5)
        u, m = out.strip().split(",")
        return float(u), float(m)
    except Exception:
        return float("nan"), float("nan")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--encoder", default="deepsets", choices=["mlp", "deepsets", "attn", "gnn"])
    p.add_argument("--comm-radius", type=float, default=10.0)
    p.add_argument("--rounds", type=int, default=2)
    p.add_argument("--role-mode", default="embed", choices=["embed", "per-role-head", "none"])
    p.add_argument("--critic", default="mappo", choices=["mappo", "ippo"])
    p.add_argument("--opponent", default="heuristic:kolay")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--steps", type=int, default=5_000_000)
    p.add_argument("--envs", type=int, default=8)
    p.add_argument("--hid", type=int, default=128)
    p.add_argument("--rollout", type=int, default=128)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--episode-sec", type=float, default=120)
    p.add_argument("--out", required=True)
    p.add_argument("--resume", action="store_true")
    p.add_argument("--ckpt-every", type=int, default=50)
    p.add_argument("--wandb", default="offline", choices=["off", "offline", "online"])
    a = p.parse_args()
    os.makedirs(a.out, exist_ok=True)
    torch.manual_seed(a.seed)
    np.random.seed(a.seed)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    env = VecEnv(a.envs, episodeSec=a.episode_sec, opponent=a.opponent, seed=a.seed * 1000)
    model = ActorCritic(a.encoder, a.hid, a.role_mode, a.critic, a.comm_radius, a.rounds)
    cfg = PPOCfg(rollout=a.rollout, lr=a.lr)
    ppo = PPO(env, model, cfg, dev)
    ck = os.path.join(a.out, "ckpt.pt")
    if a.resume and os.path.exists(ck):
        ppo.load_state(torch.load(ck, map_location=dev, weights_only=False))
        print("devam: adim", ppo.total_steps)
    meta = {"args": vars(a), "weights": cfg.weights, "obs_version": env.obs_version, "torch": torch.__version__, "device": dev}
    json.dump(meta, open(os.path.join(a.out, "config.json"), "w"), indent=1)
    wb = None
    if a.wandb != "off":
        try:
            import wandb
            os.environ.setdefault("WANDB_MODE", a.wandb)
            wb = wandb.init(project="footballer-rl", config=meta, dir=a.out, mode=a.wandb)
        except Exception as e:
            print("wandb yok:", e)
    cols = ["iter", "steps", "sps", "ep_n", "ep_ret", "goal_diff", "ep_len", *[f"term_{t}" for t in TERMS], "pg", "vf", "ent_c", "ent_s", "ent_d", "kl", "clipfrac", "lr", "gpu_util", "gpu_mem_mb", "wall_s"]
    csv_path = os.path.join(a.out, "log.csv")
    new = not os.path.exists(csv_path) or not a.resume
    f = open(csv_path, "w" if new else "a", newline="")
    w = csv.writer(f)
    if new:
        w.writerow(cols)
    t0 = time.time()
    steps0 = ppo.total_steps
    last_t, last_s = t0, ppo.total_steps
    while ppo.total_steps < a.steps:
        ppo.set_lr(1 - ppo.total_steps / a.steps)
        B = ppo.collect()
        st = ppo.update(B)
        ppo.iteration += 1
        now = time.time()
        sps = (ppo.total_steps - last_s) / max(1e-9, now - last_t)
        last_t, last_s = now, ppo.total_steps
        ds, ppo.done_stats = ppo.done_stats, []
        if ds:
            ret = float(np.mean([x[0] for x in ds])); gd = float(np.mean([x[1] for x in ds])); ln = float(np.mean([x[2] for x in ds]))
            tm = np.mean([x[3] for x in ds], 0)
        else:
            ret = gd = ln = float("nan"); tm = np.full(len(TERMS), np.nan)
        gu, gm = gpu_util() if ppo.iteration % 10 == 1 else (float("nan"), float("nan"))
        row = [ppo.iteration, ppo.total_steps, round(sps, 1), len(ds), ret, gd, ln, *tm.tolist(), st["pg"], st["vf"], st["ent_c"], st["ent_s"], st["ent_d"], st["kl"], st["clipfrac"], ppo.opt.param_groups[0]["lr"], gu, gm, round(now - t0, 1)]
        w.writerow(row)
        f.flush()
        if wb:
            wb.log(dict(zip(cols, row)))
        if ppo.iteration % 10 == 0:
            print(f"it {ppo.iteration} steps {ppo.total_steps} sps {sps:.0f} eps {len(ds)} ret {ret:.3f} gd {gd:.2f} ent_d {st['ent_d']:.2f} gpu {gu}%", flush=True)
        if ppo.iteration % a.ckpt_every == 0:
            torch.save({**ppo.state_dict(), "meta": meta}, ck)
    torch.save({**ppo.state_dict(), "meta": meta}, ck)
    print(f"bitti: {ppo.total_steps - steps0} adim, {time.time() - t0:.0f} s, ortalama {(ppo.total_steps - steps0) / (time.time() - t0):.0f} adim/s")
    env.close()


if __name__ == "__main__":
    main()
