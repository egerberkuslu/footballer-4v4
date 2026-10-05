// Toplu RL sunucusu: W is parcacigi x 1 ortam, Unix soketi uzerinden ikili protokol (bkz. rl/SPEC.md S6).
// Kullanim: npx -y tsx rl/node/server.mjs --sock /tmp/fb.sock [--parent-pid PID]
import net from 'node:net'
import fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import { OBS_DIM, STATE_DIM, ACT_DIM, N_DISC, N_TERMS, INFO_DIM, OBS_VERSION, TEAM_SIZE } from './env.mjs'

const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : d
}
const sock = arg('--sock', '/tmp/footballer-rl.sock')
const ld = process.execArgv.find((a) => a.endsWith('loader.mjs'))
if (!ld) throw new Error('server.mjs tsx ile calistirilmali (npx -y tsx rl/node/server.mjs)')
const tsxDist = new URL('.', ld).href

let workers = []
let W = 0
let nAg = 0
let bufs = []

function init(cfg, nW) {
  const t0 = cfg.team0 ?? 'external'
  const t1 = cfg.opponent ?? 'heuristic:orta'
  nAg = ((t0 === 'external' ? 1 : 0) + (t1 === 'external' ? 1 : 0)) * TEAM_SIZE
  W = nW
  bufs = []
  return Promise.all(
    Array.from({ length: W }, (_, i) => {
      const mk = (n) => new SharedArrayBuffer(Math.max(4, n * 4))
      const sab = {
        ctrl: new SharedArrayBuffer(16),
        act: mk(nAg * ACT_DIM),
        obs: mk(nAg * OBS_DIM),
        state: mk(nAg * STATE_DIM),
        reward: mk(nAg),
        terms: mk(nAg * N_TERMS),
        info: mk(INFO_DIM),
        mask: new SharedArrayBuffer(Math.max(4, nAg * N_DISC)),
        flags: new SharedArrayBuffer(4),
      }
      bufs.push({
        ctrl: new Int32Array(sab.ctrl),
        act: new Float32Array(sab.act),
        obs: new Float32Array(sab.obs),
        state: new Float32Array(sab.state),
        reward: new Float32Array(sab.reward),
        terms: new Float32Array(sab.terms),
        info: new Float32Array(sab.info),
        mask: new Uint8Array(sab.mask),
        flags: new Uint8Array(sab.flags),
      })
      return new Promise((res, rej) => {
        const w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { tsxDist, cfg, index: i, sab } })
        workers[i] = w
        w.on('message', (m) => {
          if (m.ready) res()
          else if (m.error) console.error('[isci', i, ']', m.error)
        })
        w.on('error', rej)
      })
    }),
  )
}

function run(cmd, seeds) {
  for (let i = 0; i < W; i++) {
    const c = bufs[i].ctrl
    Atomics.store(c, 1, 0)
    if (seeds) Atomics.store(c, 2, seeds[i])
    Atomics.store(c, 0, cmd)
    Atomics.notify(c, 0)
  }
  for (let i = 0; i < W; i++) {
    const c = bufs[i].ctrl
    while (Atomics.load(c, 1) === 0) Atomics.wait(c, 1, 0, 1000)
    if (Atomics.load(c, 3)) throw new Error('isci hata verdi: ' + i)
  }
}

function packResponse() {
  const parts = []
  const cat = (key, bytes) => {
    const out = Buffer.allocUnsafe(W * bytes)
    for (let i = 0; i < W; i++) {
      const v = bufs[i][key]
      Buffer.from(v.buffer, v.byteOffset, bytes).copy(out, i * bytes)
    }
    parts.push(out)
  }
  cat('obs', nAg * OBS_DIM * 4)
  cat('state', nAg * STATE_DIM * 4)
  cat('mask', nAg * N_DISC)
  cat('reward', nAg * 4)
  cat('terms', nAg * N_TERMS * 4)
  cat('info', INFO_DIM * 4)
  const fl = Buffer.alloc(W * 2)
  for (let i = 0; i < W; i++) {
    fl[i] = bufs[i].flags[0]
    fl[W + i] = bufs[i].flags[1]
  }
  parts.push(fl)
  return Buffer.concat(parts)
}

// Istek formati: u8 cmd (1=INIT: u32 len + json, 2=RESET: i32[W] tohumlar (-1 otomatik), 3=STEP: f32[W*nAg*ACT_DIM], 4=CLOSE)
// Yanit: u8 durum (0 tamam, 1 hata) + u32 uzunluk + govde
try { fs.unlinkSync(sock) } catch {}
const server = net.createServer((c) => {
  c.setNoDelay(true)
  let buf = Buffer.alloc(0)
  let busy = false
  const reply = (status, payload = Buffer.alloc(0)) => {
    const h = Buffer.alloc(5)
    h.writeUInt8(status, 0)
    h.writeUInt32LE(payload.length, 1)
    c.write(Buffer.concat([h, payload]))
  }
  const need = () => {
    if (buf.length < 1) return 0
    const cmd = buf[0]
    if (cmd === 1) return buf.length >= 5 ? 5 + buf.readUInt32LE(1) : 0
    if (cmd === 2) return 1 + 4 * W
    if (cmd === 3) return 1 + 4 * W * nAg * ACT_DIM
    return 1
  }
  const drain = async () => {
    if (busy) return
    busy = true
    try {
      for (;;) {
        const n = need()
        if (!n || buf.length < n) break
        const msg = buf.subarray(0, n)
        buf = buf.subarray(n)
        const cmd = msg[0]
        if (cmd === 1) {
          const req = JSON.parse(msg.subarray(5).toString('utf8'))
          await init(req.cfg ?? {}, req.workers)
          reply(0, Buffer.from(JSON.stringify({ obs_version: OBS_VERSION, workers: W, n_agents: nAg, obs_dim: OBS_DIM, state_dim: STATE_DIM, act_dim: ACT_DIM, n_disc: N_DISC, n_terms: N_TERMS, info_dim: INFO_DIM })))
        } else if (cmd === 2) {
          const seeds = new Int32Array(W)
          for (let i = 0; i < W; i++) seeds[i] = msg.readInt32LE(1 + 4 * i)
          run(1, seeds)
          reply(0, packResponse())
        } else if (cmd === 3) {
          const per = nAg * ACT_DIM * 4
          for (let i = 0; i < W; i++) {
            const dst = Buffer.from(bufs[i].act.buffer, bufs[i].act.byteOffset, per)
            msg.copy(dst, 0, 1 + i * per, 1 + (i + 1) * per)
          }
          run(2)
          reply(0, packResponse())
        } else if (cmd === 4) {
          try { run(3) } catch {}
          reply(0)
          setTimeout(() => process.exit(0), 50)
        }
      }
    } catch (e) {
      console.error('sunucu hatasi', e)
      reply(1, Buffer.from(String(e)))
    }
    busy = false
  }
  c.on('data', (d) => {
    buf = Buffer.concat([buf, d])
    drain()
  })
  c.on('close', () => process.exit(0))
})
server.listen(sock, () => console.error('rl sunucu hazir', sock))
const pp = Number(arg('--parent-pid', 0))
if (pp) setInterval(() => { try { process.kill(pp, 0) } catch { process.exit(0) } }, 2000).unref()
