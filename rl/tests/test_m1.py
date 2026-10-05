"""M1 birim testleri: maske, set encoder permutasyon degismezligi, GAE, auto-reset siniri.
python3 rl/tests/test_m1.py"""
import os
import sys

import torch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "py"))
import models  # noqa: E402
from mappo import compute_gae  # noqa: E402

torch.manual_seed(0)


def rand_obs(n=6):
    o = torch.rand(n, 113) * 0.5
    o[:, 8:12] = torch.eye(4)[torch.randint(0, 4, (n,))]
    return o


def test_mask():
    m = models.ActorCritic("deepsets", 64)
    o = rand_obs(64)
    mask = torch.zeros(64, 10, dtype=torch.bool)
    mask[:, 0] = True
    mask[:, 4] = True
    mask[::2, 7] = True
    mu, spr, dl = m.policy(o, mask)
    p = torch.softmax(dl, -1)
    assert torch.all(p[~mask] == 0), "maskeli eylem olasiligi 0 olmali"
    for _ in range(20):
        _, _, d, lp = m.act(o, mask)
        assert mask.gather(1, d.unsqueeze(1)).all(), "ornek gecersiz eylem secti"
        assert torch.isfinite(lp).all()
    print("GECTI maske")


def test_perm_invariance():
    for kind in ["deepsets", "attn", "gnn"]:
        enc = models.Encoder(kind, 64).eval()
        o = rand_obs(5)
        o[:, 27 + 20 : 27 + 30] = 0  # 3. takim arkadasi yok (sifir dolgu)
        o2 = o.clone()
        mp = torch.tensor([1, 0, 2])  # takim arkadaslarini karistir (dolgu satiri sonda kalsin)
        mates = o[:, 27:57].reshape(5, 3, 10)[:, mp]
        opps = o[:, 57:97].reshape(5, 4, 10)[:, torch.tensor([3, 1, 0, 2])]
        o2[:, 27:57] = mates.reshape(5, 30)
        o2[:, 57:97] = opps.reshape(5, 40)
        with torch.no_grad():
            d = (enc(o) - enc(o2)).abs().max().item()
        assert d < 1e-4, f"{kind} permutasyon degismez degil: {d}"
    enc = models.Encoder("mlp", 64).eval()
    o = rand_obs(5)
    o2 = o.clone()
    o2[:, 27:57] = o[:, 27:57].reshape(5, 3, 10)[:, torch.tensor([1, 0, 2])].reshape(5, 30)
    with torch.no_grad():
        assert (enc(o) - enc(o2)).abs().max() > 1e-4, "mlp'nin permutasyona duyarli olmasi beklenir (taban)"
    print("GECTI permutasyon degismezligi (deepsets, attn, gnn) ve mlp duyarli")


def test_gae():
    # T=3, tek ajan, gamma=0.5, lam=1: A_t = sum gamma^k r_{t+k} + gamma^T V_last - V_t (done yok)
    r = torch.tensor([[1.0], [2.0], [3.0]])
    v = torch.tensor([[0.5], [1.0], [1.5]])
    z = torch.zeros(3, 1, dtype=torch.bool)
    adv, ret = compute_gae(r, v, z, z, torch.tensor([2.0]), gamma=0.5, lam=1.0)
    g = 0.5
    exp0 = 1 + g * 2 + g**2 * 3 + g**3 * 2.0 - 0.5
    exp2 = 3 + g * 2.0 - 1.5
    assert abs(adv[0].item() - exp0) < 1e-6 and abs(adv[2].item() - exp2) < 1e-6, (adv.flatten(), exp0, exp2)
    assert torch.allclose(ret, adv + v)
    print("GECTI GAE elle hesap")


def test_autoreset_boundary():
    # t=1'de terminated: zincir kesilir, t=2'nin (yeni bolum) degeri t<=1 avantajina GIRMEZ
    r = torch.tensor([[1.0], [1.0], [5.0]])
    v = torch.tensor([[0.0], [0.0], [100.0]])
    done = torch.tensor([[False], [True], [False]])
    tr = torch.zeros(3, 1, dtype=torch.bool)
    adv, _ = compute_gae(r, v, done, tr, torch.tensor([0.0]), gamma=0.9, lam=0.95)
    assert abs(adv[1].item() - 1.0) < 1e-6, adv  # terminated: bootstrap yok
    assert abs(adv[0].item() - (1 + 0.9 * 0 - 0 + 0.9 * 0.95 * 1.0)) < 1e-6, adv
    # truncated: V(s_t) ile bootstrap
    trunc = torch.tensor([[False], [True], [False]])
    v2 = torch.tensor([[0.0], [2.0], [100.0]])
    adv2, _ = compute_gae(r, v2, done, trunc, torch.tensor([0.0]), gamma=0.9, lam=0.95)
    assert abs(adv2[1].item() - (1 + 0.9 * 2.0 - 2.0)) < 1e-6, adv2
    print("GECTI auto-reset siniri (terminated/truncated)")


if __name__ == "__main__":
    test_mask(); test_perm_invariance(); test_gae(); test_autoreset_boundary()
    print("hepsi gecti")
