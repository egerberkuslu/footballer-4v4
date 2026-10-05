"""FootballVecEnv istemcisi: Node RL sunucusuna Unix soketi uzerinden baglanir (bkz. rl/SPEC.md).

VecEnv(num_envs, workers=None, **cfg): her is parcacigi TEK ortam calistirir (modul tekilleri), bu yuzden
workers == num_envs. reset()/step() numpy dondurur. Otomatik reset: done=True olan ortamin gozlemi yeni
bolumun ilk gozlemidir; odul/terimler/info terminal adima aittir.
"""
from __future__ import annotations

import json
import os
import socket
import struct
import subprocess
import tempfile
import time
from typing import Any

import numpy as np

try:  # gym benzeri uzaylar (isteye bagli)
    from gymnasium import spaces
except Exception:  # pragma: no cover
    spaces = None

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "..", "node", "server.mjs")


def _recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = bytearray(n)
    view = memoryview(buf)
    got = 0
    while got < n:
        r = sock.recv_into(view[got:], n - got)
        if r == 0:
            raise ConnectionError("sunucu baglantiyi kapatti")
        got += r
    return bytes(buf)


class VecEnv:
    def __init__(self, num_envs: int, workers: int | None = None, **cfg: Any):
        if workers is not None and workers != num_envs:
            raise ValueError("her is parcacigi tek ortam calistirir: workers == num_envs olmali (modul tekilleri)")
        self.num_envs = num_envs
        self.cfg = cfg
        self._sock_path = os.path.join(tempfile.mkdtemp(prefix="fbrl-"), "s.sock")
        cmd = os.environ.get("FB_TSX", "npx -y tsx").split() + [SERVER, "--sock", self._sock_path, "--parent-pid", str(os.getpid())]
        self._proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE if os.environ.get("FB_QUIET") else None)
        t0 = time.time()
        while not os.path.exists(self._sock_path):
            if self._proc.poll() is not None:
                raise RuntimeError("RL sunucusu basarisiz basladi")
            if time.time() - t0 > 120:
                raise TimeoutError("RL sunucusu soketi acmadi")
            time.sleep(0.05)
        self._s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._s.connect(self._sock_path)
        body = json.dumps({"cfg": cfg, "workers": num_envs}).encode()
        meta = self._call(b"\x01" + struct.pack("<I", len(body)) + body)
        m = json.loads(meta.decode())
        self.meta = m
        self.obs_version = m["obs_version"]
        self.n_agents = m["n_agents"]
        self.obs_dim, self.state_dim, self.act_dim = m["obs_dim"], m["state_dim"], m["act_dim"]
        self.n_disc, self.n_terms, self.info_dim = m["n_disc"], m["n_terms"], m["info_dim"]
        if spaces is not None:
            self.observation_space = spaces.Box(-np.inf, np.inf, (self.n_agents, self.obs_dim), np.float32)
            self.action_space = spaces.Box(-1.0, 1.0, (self.n_agents, self.act_dim), np.float32)  # son sutun: ayrik eylem indeksi (0..n_disc-1)

    def _call(self, payload: bytes) -> bytes:
        self._s.sendall(payload)
        head = _recv_exact(self._s, 5)
        status, n = struct.unpack("<BI", head)
        body = _recv_exact(self._s, n) if n else b""
        if status != 0:
            raise RuntimeError("sunucu hatasi: " + body.decode(errors="replace"))
        return body

    def _parse(self, body: bytes):
        W, A = self.num_envs, self.n_agents
        o = 0

        def take(count, dtype, shape):
            nonlocal o
            nb = count * np.dtype(dtype).itemsize
            arr = np.frombuffer(body, dtype=dtype, count=count, offset=o).reshape(shape).copy()
            o += nb
            return arr

        obs = take(W * A * self.obs_dim, np.float32, (W, A, self.obs_dim))
        state = take(W * A * self.state_dim, np.float32, (W, A, self.state_dim))
        mask = take(W * A * self.n_disc, np.uint8, (W, A, self.n_disc)).astype(bool)
        reward = take(W * A, np.float32, (W, A))
        terms = take(W * A * self.n_terms, np.float32, (W, A, self.n_terms))
        info = take(W * self.info_dim, np.float32, (W, self.info_dim))
        done = take(W, np.uint8, (W,)).astype(bool)
        trunc = take(W, np.uint8, (W,)).astype(bool)
        return obs, state, mask, reward, terms, info, done, trunc

    def reset(self, seeds: list[int] | None = None):
        s = np.full(self.num_envs, -1, np.int32) if seeds is None else np.asarray(seeds, np.int32)
        body = self._call(b"\x02" + s.tobytes())
        obs, state, mask, _, _, info, _, _ = self._parse(body)
        return obs, {"state": state, "action_mask": mask, "info_vec": info}

    def step(self, actions: np.ndarray):
        a = np.ascontiguousarray(actions, np.float32)
        assert a.shape == (self.num_envs, self.n_agents, self.act_dim), a.shape
        body = self._call(b"\x03" + a.tobytes())
        obs, state, mask, reward, terms, info, done, trunc = self._parse(body)
        infos = {"state": state, "action_mask": mask, "reward_terms": terms, "info_vec": info}
        return obs, reward, done & ~trunc, trunc, infos

    def close(self):
        try:
            self._call(b"\x04")
        except Exception:
            pass
        try:
            self._s.close()
        except Exception:
            pass
        try:
            self._proc.terminate()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()
