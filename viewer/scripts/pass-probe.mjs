// Sayisal kare profili (test sayfasi): her oyuncu ayni animin farkli aninda; kemik konumlari karakter uzayinda (m; x sol, z ileri).
// Kullanim: scripts/run-browser.sh node scripts/pass-probe.mjs <anim> <at-listesi(<=8)> [clips=1]
// Env: PASSVAR PASSS PASSTURN HDRVAR HDRBALLY TRAPVAR (window.__* test anahtarlari)
import { chromium } from 'playwright'
const anim = process.argv[2] || 'pass'
const ats = (process.argv[3] || '0.05,0.12,0.18,0.22,0.27,0.34,0.42,0.52').split(',')
const clips = process.argv[4] ?? '1'
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 300, height: 200 } })
const env = {}
for (const [k, e] of [['__passVar', 'PASSVAR'], ['__passS', 'PASSS'], ['__passTurn', 'PASSTURN'], ['__hdrVar', 'HDRVAR'], ['__hdrBallY', 'HDRBALLY'], ['__trapVar', 'TRAPVAR']]) if (process.env[e] !== undefined) env[k] = Number(process.env[e])
await p.addInitScript((c) => { if (c) window.__passClip = c }, process.env.PASSCLIP || '')
await p.addInitScript((e) => Object.assign(window, e), env)
let r = null
for (let k = 0; k < 3 && !r; k++) {
  try {
    await p.goto(`http://127.0.0.1:5173/src/characters/test/index.html?t=pose&anims=${anim}&at=${ats.join(',')}&clips=${clips}`, { timeout: 180000 })
    await p.waitForTimeout(7000)
    r = await p.evaluate((n) => {
      const out = []
      const ch = window.__chars.chars
      for (let i = 0; i < n; i++) {
        const rig = ch[i].rig
        const V = rig.origin.constructor
        const g = (nm) => { const v = rig.bonePos(nm, new V()); return [(v.x - rig.origin.x) / rig.u, (v.y - rig.origin.y) / rig.u, (v.z - rig.origin.z) / rig.u].map((x) => +x.toFixed(3)) }
        const fr = g('foot_r'), tr = g('ball_r'), kr = g('calf_r'), hr = g('thigh_r'), fl = g('foot_l'), tl = g('ball_l'), hd = g('head'), pel = g('pelvis')
        const yaw = (+(Math.atan2(tr[0] - fr[0], tr[2] - fr[2]) * 57.3).toFixed(0))
        out.push({ foot_r: fr, toeYaw_r: yaw, knee_r: kr, hip_r: hr, foot_l: fl, toe_l: tl, head: hd, pelvis: pel })
      }
      return { out, layers: window.__layers }
    }, ats.length)
  } catch (e) { console.log('tekrar:', e.message.slice(0, 80)) }
}
if (r) {
  r.out.forEach((o, i) => console.log(ats[i], JSON.stringify(o)))
  console.log(JSON.stringify(r.layers))
}
await b.close()
