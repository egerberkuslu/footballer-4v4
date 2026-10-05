"""Python istemci dumani: VecEnv reset/step, rastgele politika, sekil ve NaN kontrolu.
Kullanim: python3 rl/tests/py_smoke.py [num_envs=2] [adim=200]"""
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "py"))
from vec_env import VecEnv  # noqa: E402

n = int(sys.argv[1]) if len(sys.argv) > 1 else 2
steps = int(sys.argv[2]) if len(sys.argv) > 2 else 200
env = VecEnv(n, episodeSec=20, opponent="heuristic:orta", seed=5)
obs, info = env.reset()
print("meta", env.meta)
assert obs.shape == (n, env.n_agents, env.obs_dim), obs.shape
rng = np.random.default_rng(0)
t0 = time.time()
eps = 0
for i in range(steps):
    a = rng.uniform(-1, 1, (n, env.n_agents, env.act_dim)).astype(np.float32)
    mask = info["action_mask"]
    for e in range(n):
        for g in range(env.n_agents):
            ok = np.flatnonzero(mask[e, g])
            a[e, g, 7] = rng.choice(ok)
    obs, rew, term, trunc, info = env.step(a)
    eps += int((term | trunc).sum())
    assert np.isfinite(obs).all() and np.isfinite(rew).all(), "NaN"
dt = time.time() - t0
print(f"{steps} adim x {n} ortam: {steps * n / dt:.0f} karar/s toplam, bitis {eps}, odul terimi sekli {info['reward_terms'].shape}, GECTI")
env.close()
