"""Python uctan uca hiz: VecEnv + rastgele politika (vektorlu). Kullanim: python3 rl/tests/py_bench.py [W=8] [adim=300] [opponent]"""
import os, sys, time
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "py"))
from vec_env import VecEnv

W = int(sys.argv[1]) if len(sys.argv) > 1 else 8
steps = int(sys.argv[2]) if len(sys.argv) > 2 else 300
opp = sys.argv[3] if len(sys.argv) > 3 else "heuristic:orta"
env = VecEnv(W, episodeSec=120, opponent=opp, seed=1)
env.reset()
rng = np.random.default_rng(0)
A = env.n_agents
t0 = time.time()
for i in range(steps):
    a = rng.uniform(-1, 1, (W, A, env.act_dim)).astype(np.float32)
    a[..., 7] = rng.integers(0, 10, (W, A))
    env.step(a)
dt = time.time() - t0
print(f"W={W} opp={opp} ajan={A}: {steps * W / dt:.0f} ortam-adimi/s, {steps * W * A / dt:.0f} ajan-karari/s, adim basina {1000 * dt / steps:.1f} ms")
env.close()
