"""Egitim rollout yolu ile eval.py yolu ayni ckpt/tohum/rakip/normalizasyonla: gol farki + gozlem istatistigi.
python3 rl/tests/train_eval_parity.py --ckpt rl/runs/m1a/ckpt.pt --episodes 100 [--opponent heuristic:kolay]"""
import argparse, os, sys
import numpy as np
import torch
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "py"))
from eval import Policy, evaluate  # noqa: E402
from mappo import PPO, PPOCfg, NORM_DIMS  # noqa: E402
from models import ActorCritic  # noqa: E402
from vec_env import VecEnv  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument("--ckpt", required=True)
p.add_argument("--episodes", type=int, default=100)
p.add_argument("--opponent", default="heuristic:kolay")
p.add_argument("--workers", type=int, default=10)
p.add_argument("--seed", type=int, default=555000)
a = p.parse_args()
dev = "cuda" if torch.cuda.is_available() else "cpu"
s = torch.load(a.ckpt, map_location=dev, weights_only=False)
ar = s["meta"]["args"]
# (i) egitim kodunun kendi rollout fonksiyonu, istatistikler DONUK
env = VecEnv(a.workers, episodeSec=120, opponent=a.opponent, seed=a.seed)
m = ActorCritic(ar["encoder"], ar["hid"], ar["role_mode"], ar["critic"], ar["comm_radius"], ar["rounds"])
ppo = PPO(env, m, PPOCfg(rollout=128), dev)
ppo.load_state(s)
ppo.onorm.update = lambda x: None
obs_norm = []
orig_norm = ppo.norm
def spy(o):
    x = orig_norm(o)
    obs_norm.append(x[..., NORM_DIMS].reshape(-1, len(NORM_DIMS)).cpu())
    return x
ppo.norm = spy
gd_tr, n = [], 0
while len(gd_tr) < a.episodes:
    ppo.collect()
    gd_tr += [x[1] for x in ppo.done_stats]
    ppo.done_stats = []
env.close()
gd_tr = np.array(gd_tr[: a.episodes])
on = torch.cat(obs_norm)
# (ii) eval.py yolu (ayni ckpt, ayni normalizasyon, stokastik)
pol = Policy("ckpt", a.ckpt, dev, stochastic=True)
r = evaluate(pol, a.opponent, a.episodes, a.workers, a.seed)
print(f"egitim rollout yolu : gd {gd_tr.mean():+.3f} (n={len(gd_tr)})  norm-gozlem ort {on.mean():+.3f} std {on.std():.3f}")
print(f"eval.py yolu        : gd {r['goal_diff_mean']:+.3f} CI95 {r['goal_diff_ci95']} gf {r['gf_mean']:.2f} ga {r['ga_mean']:.2f}")
import json
json.dump({'ckpt': a.ckpt, 'opponent': a.opponent, 'episodes': a.episodes, 'train_path_gd': float(gd_tr.mean()), 'train_path_obs_norm_mean': float(on.mean()), 'train_path_obs_norm_std': float(on.std()), 'eval_path': {k: r[k] for k in ['goal_diff_mean', 'goal_diff_ci95', 'gf_mean', 'ga_mean']}}, open(os.path.join(os.path.dirname(a.ckpt), 'parity.json'), 'w'), indent=1)
