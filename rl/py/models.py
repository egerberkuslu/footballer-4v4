"""Modüler aktör-kritik (bkz. rl/SPEC.md gözlem düzeni, OBS_VERSION 1).

Gözlem (113): kendi 0:14, top 14:23, kale 23:27, takım arkadaşı seti 27:57 (3x10), rakip seti 57:97 (4x10), maç 97:113.
Rol one-hot kendi bloğunda 8:12. Eylem vektörü env formatı: [mx, mz, sprint, aim_z, aim_y, power, curl, discrete].
"""
from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

OBS_DIM, STATE_DIM, N_DISC = 113, 70, 10
SELF = slice(0, 14)
BALL = slice(14, 23)
GOAL = slice(23, 27)
MATE = slice(27, 57)
OPP = slice(57, 97)
MATCH = slice(97, 113)
CORE_IDX = list(range(0, 27)) + list(range(97, 113))  # 43 öznitelik: kendi+top+kale+maç
N_CORE = len(CORE_IDX)
N_CONT = 6  # move_x, move_z, aim_z, aim_y, power, curl


def split_obs(obs: torch.Tensor):
    core = obs[..., CORE_IDX]
    mates = obs[..., MATE].reshape(*obs.shape[:-1], 3, 10)
    opps = obs[..., OPP].reshape(*obs.shape[:-1], 4, 10)
    role = obs[..., 8:12].argmax(-1)
    return core, mates, opps, role


def mlp(i, h, o, n=2):
    layers, d = [], i
    for _ in range(n - 1):
        layers += [nn.Linear(d, h), nn.LayerNorm(h), nn.GELU()]
        d = h
    layers.append(nn.Linear(d, o))
    return nn.Sequential(*layers)


class Encoder(nn.Module):
    """Gözlem -> gömme [B, H]. kind: mlp | deepsets | attn | gnn."""

    def __init__(
        self,
        kind: str,
        hid: int = 128,
        comm_radius: float = 10.0,
        rounds: int = 2,
        heads: int = 4,
    ):
        super().__init__()
        self.kind, self.hid, self.rounds = kind, hid, rounds
        self.radius = comm_radius / 20.0  # goreli konum olcegi /20 m (SPEC)
        self.core = mlp(N_CORE, hid, hid, 2)
        if kind == "mlp":
            self.flat = mlp(hid + 70, hid, hid, 2)
        elif kind == "deepsets":
            self.phi_m, self.phi_o = mlp(10, hid, hid, 2), mlp(10, hid, hid, 2)
            self.rho = mlp(3 * hid, hid, hid, 2)
        elif kind == "attn":
            self.tok = mlp(10, hid, hid, 2)
            self.type_emb = nn.Embedding(2, hid)
            self.layers = nn.ModuleList(
                [
                    nn.MultiheadAttention(hid, heads, batch_first=True)
                    for _ in range(rounds)
                ]
            )
            self.norms = nn.ModuleList([nn.LayerNorm(hid) for _ in range(rounds)])
            self.out = mlp(hid, hid, hid, 2)
        elif kind == "gnn":
            self.tok = mlp(10, hid, hid, 2)
            self.type_emb = nn.Embedding(2, hid)
            self.msg = nn.ModuleList(
                [mlp(2 * hid + 3, hid, hid, 2) for _ in range(rounds)]
            )
            self.upd = nn.ModuleList([mlp(2 * hid, hid, hid, 2) for _ in range(rounds)])
            self.out = mlp(hid, hid, hid, 2)
        else:
            raise ValueError(kind)

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        core, mates, opps, _ = split_obs(obs)
        hc = F.gelu(self.core(core))
        if self.kind == "mlp":
            return F.gelu(self.flat(torch.cat([hc, obs[..., MATE], obs[..., OPP]], -1)))
        mm = (mates.abs().sum(-1) > 0).float()
        om = (opps.abs().sum(-1) > 0).float()
        if self.kind == "deepsets":
            sm = (F.gelu(self.phi_m(mates)) * mm.unsqueeze(-1)).sum(-2)
            so = (F.gelu(self.phi_o(opps)) * om.unsqueeze(-1)).sum(-2)
            return F.gelu(self.rho(torch.cat([hc, sm, so], -1)))
        # attn / gnn: dugumler = [kendi, takim arkadaslari, rakipler]
        sets = torch.cat([mates, opps], -2)  # [B,7,10]
        valid = torch.cat([mm, om], -1) > 0
        types = torch.tensor([0, 0, 0, 1, 1, 1, 1], device=obs.device)
        hs = F.gelu(self.tok(sets)) + self.type_emb(types)
        h = torch.cat([hc.unsqueeze(-2), hs], -2)  # [B,8,H]
        valid8 = torch.cat([torch.ones_like(valid[..., :1]), valid], -1)
        if self.kind == "attn":
            pad = ~valid8
            for att, nrm in zip(self.layers, self.norms):
                o, _ = att(h, h, h, key_padding_mask=pad, need_weights=False)
                h = nrm(h + o)
            return F.gelu(self.out(h[..., 0, :]))
        # gnn: kenar = konum mesafesi <= yaricap (kendi dugumu konum 0)
        pos = torch.cat(
            [torch.zeros_like(sets[..., :1, :2]), sets[..., :2]], -2
        )  # [B,8,2]
        rel = pos.unsqueeze(-2) - pos.unsqueeze(-3)  # [B,8,8,2] (j - i) -> i'ye gore
        dist = rel.norm(dim=-1, keepdim=True)
        adj = (
            (dist.squeeze(-1) <= self.radius)
            & valid8.unsqueeze(-2)
            & valid8.unsqueeze(-1)
        )
        eye = torch.eye(8, dtype=torch.bool, device=obs.device)
        adj = adj & ~eye
        e = torch.cat([rel, dist], -1)
        for msg, upd in zip(self.msg, self.upd):
            hi = h.unsqueeze(-2).expand(-1, -1, 8, -1)
            hj = h.unsqueeze(-3).expand(-1, 8, -1, -1)
            m = F.gelu(msg(torch.cat([hi, hj, e], -1))) * adj.unsqueeze(-1)
            agg = m.sum(-2) / adj.sum(-1, keepdim=True).clamp(min=1)
            h = h + F.gelu(upd(torch.cat([h, agg], -1)))
        return F.gelu(self.out(h[..., 0, :]))


class ActorCritic(nn.Module):
    def __init__(
        self,
        encoder="deepsets",
        hid=128,
        role_mode="embed",
        critic="mappo",
        comm_radius=10.0,
        rounds=2,
    ):
        super().__init__()
        self.role_mode, self.critic_kind, self.hid = role_mode, critic, hid
        self.enc = Encoder(encoder, hid, comm_radius, rounds)
        self.role_emb = nn.Embedding(4, hid) if role_mode == "embed" else None
        n_heads = 4 if role_mode == "per-role-head" else 1
        self.trunk = nn.ModuleList([mlp(hid, hid, hid, 2) for _ in range(n_heads)])
        self.mu = nn.ModuleList([nn.Linear(hid, N_CONT) for _ in range(n_heads)])
        self.spr = nn.ModuleList([nn.Linear(hid, 1) for _ in range(n_heads)])
        self.disc = nn.ModuleList([nn.Linear(hid, N_DISC) for _ in range(n_heads)])
        self.log_std = nn.Parameter(torch.full((N_CONT,), -0.5))
        cin = (STATE_DIM + 4) if critic == "mappo" else OBS_DIM
        self.vnet = mlp(cin, 256, 1, 3)

    def _heads(self, h, role):
        if self.role_mode != "per-role-head":
            t = F.gelu(self.trunk[0](h))
            return self.mu[0](t), self.spr[0](t).squeeze(-1), self.disc[0](t)
        ts = [F.gelu(self.trunk[r](h)) for r in range(4)]
        mu = torch.stack([self.mu[r](ts[r]) for r in range(4)], -2)
        spr = torch.stack([self.spr[r](ts[r]).squeeze(-1) for r in range(4)], -1)
        dl = torch.stack([self.disc[r](ts[r]) for r in range(4)], -2)
        mu = mu.gather(-2, role[..., None, None].expand(*role.shape, 1, N_CONT)).squeeze(-2)
        spr = spr.gather(-1, role[..., None]).squeeze(-1)
        dl = dl.gather(-2, role[..., None, None].expand(*role.shape, 1, N_DISC)).squeeze(-2)
        return mu, spr, dl

    def policy(self, obs: torch.Tensor, mask: torch.Tensor):
        """-> (mu[...,6], spr_logit[...], disc_logits[...,10]) ; maske: geçersiz ayrık eylem logit = -inf."""
        role = obs[..., 8:12].argmax(-1)
        h = self.enc(obs)
        if self.role_emb is not None:
            h = h + self.role_emb(role)
        mu, spr, dl = self._heads(h, role)
        dl = dl.masked_fill(~mask, float("-inf"))
        return mu, spr, dl

    def value(self, obs: torch.Tensor, state: torch.Tensor) -> torch.Tensor:
        if self.critic_kind == "mappo":
            x = torch.cat([state, obs[..., 8:12]], -1)
        else:
            x = obs
        return self.vnet(x).squeeze(-1)

    def dist_stats(self, obs, mask):
        mu, spr, dl = self.policy(obs, mask)
        return mu, spr, dl, self.log_std.clamp(-5, 1)

    @torch.no_grad()
    def act(self, obs, mask, deterministic=False):
        mu, spr, dl, ls = self.dist_stats(obs, mask)
        std = ls.exp()
        u = mu if deterministic else mu + std * torch.randn_like(mu)
        a = torch.tanh(u)
        sp = (spr > 0).float() if deterministic else torch.bernoulli(torch.sigmoid(spr))
        d = (
            dl.argmax(-1)
            if deterministic
            else torch.distributions.Categorical(logits=dl).sample()
        )
        return u, sp, d, self.logp(mu, spr, dl, ls, u, sp, d)

    def logp(self, mu, spr, dl, ls, u, sp, d):
        std = ls.exp()
        a = torch.tanh(u)
        lp_c = (
            -0.5 * ((u - mu) / std) ** 2
            - ls
            - 0.5 * math.log(2 * math.pi)
            - torch.log(1 - a * a + 1e-6)
        ).sum(-1)
        lp_s = -F.binary_cross_entropy_with_logits(spr, sp, reduction="none")
        lp_d = torch.log_softmax(dl, -1).gather(-1, d.long().unsqueeze(-1)).squeeze(-1)
        return lp_c + lp_s + lp_d

    def entropy(self, mu, spr, dl, ls):
        e_c = (ls + 0.5 * math.log(2 * math.pi * math.e)).sum(-1).expand(mu.shape[:-1])
        p = torch.sigmoid(spr)
        e_s = -(p * torch.log(p + 1e-8) + (1 - p) * torch.log(1 - p + 1e-8))
        pd = torch.softmax(dl, -1)
        e_d = -(pd * torch.log(pd.clamp(min=1e-8))).sum(-1)
        return e_c, e_s, e_d


def to_env_action(u: torch.Tensor, sp: torch.Tensor, d: torch.Tensor) -> torch.Tensor:
    """(u[...,6] ham, sprint 0/1, ayrik idx) -> env eylem vektoru [...,8]."""
    a = torch.tanh(u)
    out = torch.stack(
        [
            a[..., 0],
            a[..., 1],
            sp * 2 - 1,
            a[..., 2],
            a[..., 3],
            a[..., 4],
            a[..., 5],
            d.float(),
        ],
        -1,
    )
    return out
