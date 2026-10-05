# footballer/rl (M0: basiz RL ortami)

- `SPEC.md`: gozlem/eylem/odul sozlesmesi (OBS_VERSION 1). `BENCH.md`: hiz ve determinizm sonuclari.
- `node/env.mjs` FootballEnv, `node/server.mjs` toplu sunucu, `node/worker.mjs`, `node/bench.mjs`, `node/smoke.mjs`.
- `py/vec_env.py` Python VecEnv, `py/requirements.txt`.
- Testler: `npx -y tsx rl/tests/determinism.mjs heuristic:orta 90`, `npx -y tsx rl/tests/rules_smoke.mjs 600`, `python3 rl/tests/py_smoke.py 2 200`, `python3 rl/tests/py_bench.py 8 300`.
Hepsi `footballer/` kokunden calisir; `viewer/` UI'ya dokunulmaz.
