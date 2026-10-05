// M: mac basindaki uzun kareyi CDP Profiler ile teshis eder.
// Kullanim: scripts/run-browser.sh node scripts/ui-prof.mjs [--q "blades=8000&mode=mac&fx=0"] [--total 30000]
import { chromium } from 'playwright'
import fs from 'node:fs'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const q = opt('--q', 'blades=8000&mode=mac&fx=0')
const total = Number(opt('--total', '30000'))
const b = args.includes('--gpu')
  ? await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] })
  : await chromium.launch({
      executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.addInitScript(() => {
  // kare araliklari ve faz degisimleri (performance.now zamaniyla)
  window.__gaps = []
  window.__phases = []
  let last = 0
  let ph = null
  const f = (t) => {
    if (last && t - last > 100) window.__gaps.push([Math.round(last), Math.round(t - last)])
    last = t
    const cur = window.__game?.match?.phase
    if (cur !== ph) {
      window.__phases.push([Math.round(t), cur])
      ph = cur
    }
    requestAnimationFrame(f)
  }
  requestAnimationFrame(f)
})
const cdp = await p.context().newCDPSession(p)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 2000 })
// profil gezinmeden ONCE baslar: acilistaki uzun kareler de yakalanir
await cdp.send('Profiler.start')
const epoch0 = Date.now()
await p.goto(`http://127.0.0.1:5173/?${q}`, { timeout: 180000 })
const pnow0 = epoch0 - (await p.evaluate(() => performance.timeOrigin))
await p.waitForTimeout(9000)
await p.mouse.click(640, 400)
await p.keyboard.down('KeyW')
await p.waitForTimeout(2500)
await p.keyboard.up('KeyW')
await p.waitForTimeout(Math.max(0, total - 11500))
const { profile } = await cdp.send('Profiler.stop')
const info = await p.evaluate(() => ({ gaps: window.__gaps, phases: window.__phases }))
fs.writeFileSync('shots/M-prof.cpuprofile', JSON.stringify(profile))
console.log('fazlar', JSON.stringify(info.phases))
// --after-play: yalniz 'play' fazindan sonraki kareler
const playT = info.phases.find((x) => x[1] === 'play')?.[0] ?? 0
const gaps = info.gaps.filter((g) => !args.includes('--after-play') || g[0] >= playT - 200).sort((a, b) => b[1] - a[1]).slice(0, 6)
console.log('en uzun kareler [baslangic ms, sure ms]', JSON.stringify(gaps))

// ornekleri zaman eksenine yerlestir (profil baslangici ~ pnow0)
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const parent = new Map()
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
const times = []
let t = 0
for (const d of profile.timeDeltas) {
  t += d
  times.push(pnow0 + t / 1000)
}
const name = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${n.callFrame.lineNumber + 1}`
for (const [g0, dur] of gaps.slice(0, 2)) {
  const self = new Map()
  const incl = new Map()
  let cnt = 0
  profile.samples.forEach((id, i) => {
    if (times[i] < g0 || times[i] > g0 + dur) return
    cnt++
    const n = byId.get(id)
    self.set(name(n), (self.get(name(n)) ?? 0) + 1)
    const seen = new Set()
    for (let cur = id; cur != null; cur = parent.get(cur)) {
      const k = name(byId.get(cur))
      if (seen.has(k)) continue
      seen.add(k)
      incl.set(k, (incl.get(k) ?? 0) + 1)
    }
  })
  console.log(`\n== kare @${g0} ms, ${dur} ms, ${cnt} ornek`)
  console.log('-- oz sure:')
  ;[...self].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(`${((v / cnt) * 100).toFixed(1)}%  ${k}`))
  console.log('-- kapsayici (src/ ve three):')
  ;[...incl]
    .filter(([k]) => /src\/|three|postprocessing|fiber/.test(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 28)
    .forEach(([k, v]) => console.log(`${((v / cnt) * 100).toFixed(1)}%  ${k}`))
}
await b.close()
