"""MAPPO/IPPO: parametre paylasimli PPO, GAE, deger normalizasyonu, calisan gozlem normalizasyonu.
Otomatik reset anlami: done adiminda donen obs YENI bolumun ilk gozlemi, reward/terms terminal adima aittir.
terminated -> bootstrap yok; truncated (sure doldu) -> V(s_t) ile bootstrap (terminal gozlem donmedigi icin yaklasik)."""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np
import torch
import torch.nn.functional as F

from models import CORE_IDX, N_DISC, ActorCritic, to_env_action

TERMS = ["goal", "ball_approach", "ball_progress", "pass_ok", "steal", "foul", "card"]
DEFAULT_W = {"goal": 1.0, "ball_approach": 0.02, "ball_progress": 0.2, "pass_ok": 0.05, "steal": 0.05, "foul": 0.1, "card": 0.2}
# normalize edilecek (surekli) gozlem boyutlari: one-hot ve faz bayraklari haric
NORM_DIMS = [i for i in CORE_IDX if not (8 <= i < 12 or 97 <= i < 108)]


class RunningMS:
    def __init__(self, shape, device):
        self.mean = torch.zeros(shape, device=device)
        self.var = torch.ones(shape, device=device)
        self.count = 1e-4

    def update(self, x: torch.Tensor):
        x = x.reshape(-1, *self.mean.shape)
        bm, bv, bc = x.mean(0), x.var(0, unbiased=False), x.shape[0]
        d = bm - self.mean
        tot = self.count + bc
        self.mean = self.mean + d * bc / tot
        m2 = self.var * self.count + bv * bc + d.pow(2) * self.count * bc / tot
        self.var, self.count = m2 / tot, tot

    def state(self):
        return {"mean": self.mean, "var": self.var, "count": self.count}

    def load(self, s):
        self.mean, self.var, self.count = s["mean"], s["var"], s["count"]


def compute_gae(rew, val, done, trunc, last_val, gamma=0.99, lam=0.95):
    """rew, val: [T,...]; done, trunc: [T,...] (done=terminated veya truncated, trunc ayri); last_val: [...].
    done adiminda zincir kesilir; terminated -> sonraki deger 0; truncated -> V(s_t) ile bootstrap."""
    T = rew.shape[0]
    adv = torch.zeros_like(rew)
    last = torch.zeros_like(last_val)
    nxt_v = last_val
    for t in reversed(range(T)):
        d = done[t].float()
        tr = trunc[t].float()
        boot = (1 - d) * nxt_v + tr * val[t]
        delta = rew[t] + gamma * boot - val[t]
        last = delta + gamma * lam * (1 - d) * last
        adv[t] = last
        nxt_v = val[t]
    return adv, adv + val


@dataclass
class PPOCfg:
    gamma: float = 0.99
    lam: float = 0.95
    clip: float = 0.2
    vclip: float = 0.2
    lr: float = 3e-4
    ent_c: float = 0.003
    vf_c: float = 0.5
    epochs: int = 4
    minibatches: int = 4
    rollout: int = 128
    max_grad: float = 0.5
    weights: dict = field(default_factory=lambda: dict(DEFAULT_W))


class PPO:
    def __init__(self, env, model: ActorCritic, cfg: PPOCfg, device="cuda"):
        self.env, self.m, self.cfg, self.dev = env, model.to(device), cfg, device
        self.opt = torch.optim.Adam(self.m.parameters(), lr=cfg.lr, eps=1e-5)
        self.onorm = RunningMS((len(NORM_DIMS),), device)
        self.vnorm = RunningMS((), device)
        self.wvec = torch.tensor([cfg.weights[k] for k in TERMS], device=device)
        W, A = env.num_envs, env.n_agents
        self.W, self.A = W, A
        obs, info = env.reset()
        self.obs, self.info = obs, info
        self.ep_ret = np.zeros((W, A), np.float32)
        self.ep_terms = np.zeros((W, A, len(TERMS)), np.float32)
        self.ep_len = np.zeros(W, np.int64)
        self.done_stats = []  # (ret_mean, goal_diff, len, terms[7])
        self.total_steps = 0
        self.iteration = 0

    def norm(self, obs: torch.Tensor) -> torch.Tensor:
        x = obs.clone()
        c = x[..., NORM_DIMS]
        x[..., NORM_DIMS] = ((c - self.onorm.mean) / (self.onorm.var.sqrt() + 1e-6)).clamp(-10, 10)
        return x

    def _t(self, a, dtype=torch.float32):
        return torch.as_tensor(a, dtype=dtype, device=self.dev)

    def collect(self):
        T, W, A, dev = self.cfg.rollout, self.W, self.A, self.dev
        S = {k: [] for k in ["obs", "state", "mask", "u", "sp", "d", "lp", "rew", "val", "done", "trunc"]}
        for _ in range(T):
            o = self._t(self.obs)
            st = self._t(self.info["state"])
            mk = self._t(self.info["action_mask"], torch.bool)
            self.onorm.update(o[..., NORM_DIMS])
            on = self.norm(o)
            with torch.no_grad():
                u, sp, d, lp = self.m.act(on, mk)
                v = self.m.value(on, st) * (self.vnorm.var.sqrt() + 1e-6) + self.vnorm.mean
            act = to_env_action(u, sp, d).cpu().numpy()
            nobs, _, term, trunc, info = self.env.step(act)
            terms = info["reward_terms"]
            r = (self._t(terms) * self.wvec).sum(-1)
            done = term | trunc
            for k, val in [("obs", on), ("state", st), ("mask", mk), ("u", u), ("sp", sp), ("d", d), ("lp", lp), ("rew", r), ("val", v), ("done", self._t(done, torch.bool)), ("trunc", self._t(trunc, torch.bool))]:
                S[k].append(val)
            # bolum istatistigi
            self.ep_ret += r.cpu().numpy()
            self.ep_terms += terms
            self.ep_len += 1
            for e in np.flatnonzero(done):
                iv = info["info_vec"][e]
                self.done_stats.append((float(self.ep_ret[e].mean()), float(iv[0] - iv[1]), int(self.ep_len[e]), self.ep_terms[e].mean(0).copy()))
                self.ep_ret[e] = 0
                self.ep_terms[e] = 0
                self.ep_len[e] = 0
            self.obs, self.info = nobs, info
            self.total_steps += W
        with torch.no_grad():
            on = self.norm(self._t(self.obs))
            lastv = self.m.value(on, self._t(self.info["state"])) * (self.vnorm.var.sqrt() + 1e-6) + self.vnorm.mean
        B = {k: torch.stack(v) for k, v in S.items()}
        done = B["done"].unsqueeze(-1).expand_as(B["rew"])
        trunc = B["trunc"].unsqueeze(-1).expand_as(B["rew"])
        adv, ret = compute_gae(B["rew"], B["val"], done, trunc, lastv, self.cfg.gamma, self.cfg.lam)
        B["adv"], B["ret"] = adv, ret
        return B

    def update(self, B):
        c = self.cfg
        n = B["rew"].numel()
        flat = {k: v.reshape(n, *v.shape[3:]) if v.dim() > 3 else v.reshape(n) for k, v in B.items() if k not in ("done", "trunc")}
        self.vnorm.update(flat["ret"])
        vstd, vmean = (self.vnorm.var.sqrt() + 1e-6), self.vnorm.mean
        ret_n = (flat["ret"] - vmean) / vstd
        val_old_n = (flat["val"] - vmean) / vstd
        adv = flat["adv"]
        adv = (adv - adv.mean()) / (adv.std() + 1e-8)
        stats = {"pg": 0.0, "vf": 0.0, "ent_c": 0.0, "ent_s": 0.0, "ent_d": 0.0, "kl": 0.0, "clipfrac": 0.0}
        mb = n // c.minibatches
        k = 0
        for _ in range(c.epochs):
            perm = torch.randperm(n, device=self.dev)
            for i in range(c.minibatches):
                idx = perm[i * mb : (i + 1) * mb]
                mu, spr, dl, ls = self.m.dist_stats(flat["obs"][idx], flat["mask"][idx])
                lp = self.m.logp(mu, spr, dl, ls, flat["u"][idx], flat["sp"][idx], flat["d"][idx])
                ratio = (lp - flat["lp"][idx]).exp()
                a = adv[idx]
                pg = -torch.min(ratio * a, ratio.clamp(1 - c.clip, 1 + c.clip) * a).mean()
                v = self.m.value(flat["obs"][idx], flat["state"][idx])
                vc = val_old_n[idx] + (v - val_old_n[idx]).clamp(-c.vclip, c.vclip)
                vf = 0.5 * torch.max((v - ret_n[idx]) ** 2, (vc - ret_n[idx]) ** 2).mean()
                ec, es, ed = self.m.entropy(mu, spr, dl, ls)
                ent = (ec.mean() + es.mean() + ed.mean())
                loss = pg + c.vf_c * vf - c.ent_c * ent
                self.opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.m.parameters(), c.max_grad)
                self.opt.step()
                with torch.no_grad():
                    stats["pg"] += pg.item(); stats["vf"] += vf.item()
                    stats["ent_c"] += ec.mean().item(); stats["ent_s"] += es.mean().item(); stats["ent_d"] += ed.mean().item()
                    stats["kl"] += ((flat["lp"][idx] - lp).mean()).item()
                    stats["clipfrac"] += ((ratio - 1).abs() > c.clip).float().mean().item()
                k += 1
        return {kk: vv / k for kk, vv in stats.items()}

    def set_lr(self, frac):
        for g in self.opt.param_groups:
            g["lr"] = self.cfg.lr * max(0.05, frac)

    def state_dict(self):
        return {"model": self.m.state_dict(), "opt": self.opt.state_dict(), "onorm": self.onorm.state(), "vnorm": self.vnorm.state(), "steps": self.total_steps, "iter": self.iteration}

    def load_state(self, s):
        self.m.load_state_dict(s["model"])
        self.opt.load_state_dict(s["opt"])
        self.onorm.load(s["onorm"])
        self.vnorm.load(s["vnorm"])
        self.total_steps, self.iteration = s["steps"], s["iter"]
