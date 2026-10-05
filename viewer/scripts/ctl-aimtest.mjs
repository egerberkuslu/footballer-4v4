import { chromium } from 'playwright'
const browser = await chromium.launch({ executablePath: '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto('http://127.0.0.1:5173/?blades=2000', { timeout: 180000 })
await page.waitForTimeout(4000)
const r = await page.evaluate(async () => {
  const api = window.__shot
  const { world, solveShot } = api
  const L = 20
  const cases = [
    // [bx,bz,ty,tz,V,type,curl]
    [13,0,1.0,0,25,'normal',0],[13,0,0.3,-2.0,30,'normal',0],[13,0,1.7,2.0,28,'normal',0],[13,0,0.2,1.8,32,'yerden',0],
    [13,0,0.3,-1.9,22,'yerden',0],[8,3,1.5,-1.5,20,'normal',0],[5,-4,1.2,1.0,26,'normal',0],[10,0,1.6,0.5,16,'asirtma',0],
    [6,0,1.7,-1.0,18,'asirtma',0],[13,0,1.0,0,12,'normal',0],[13,0,1.2,-2.0,24,'normal',-3],[13,0,1.2,2.0,24,'normal',3],
    [8,5,1.3,-2.0,22,'normal',-2],[8,-5,1.3,2.0,22,'normal',2],[13,0,0.5,1.5,30,'yerden',1],[10,2,1.7,-2.2,18,'asirtma',-1],
    [13,0,2.5,0,28,'normal',0],[13,0,1.0,3.3,28,'normal',0],[13,0,1.95,2.3,26,'normal',0],[4,0,1.0,0,9,'normal',0],
  ]
  world.timeScale = 0
  const out = []
  for (const [bx,bz,ty,tz,V,type,curl] of cases) {
    api.placeBall(bx, bz)
    const g0 = world.goals
    const sh = solveShot(bx, bz, 1, ty, tz, V, type, curl)
    api.kick(sh.v, sh.w)
    let hit = null
    for (let i = 0; i < 4*60 && true; i++) {
      world.timeScale = 1
      // kucuk adimlarla, kesisimi yakala
      for (let k = 0; k < 4; k++) {
        const b = world.ball
        const x0 = b.x, y0 = b.y, z0 = b.z
        world.step(1/240)
        if (!hit && x0 < L && b.x >= L) { const f = (L-x0)/(b.x-x0); hit = [y0+(b.y-y0)*f, z0+(b.z-z0)*f] }
      }
      world.timeScale = 0
    }
    const e = hit ? Math.hypot(hit[0]-ty, hit[1]-tz) : null
    out.push({ c: [bx,bz,ty,tz,V,type,curl].join(','), reach: sh.reach, hit: hit && hit.map(v=>+v.toFixed(3)), err: e && +e.toFixed(3), gol: world.goals - g0 })
  }
  world.timeScale = 1
  return out
})
for (const o of r) console.log(JSON.stringify(o))
const nc = r.filter((o,i)=>o.c.endsWith(',0') && o.reach && o.err!=null)
console.log('curl=0 ulasilabilir ort hata', (nc.reduce((a,o)=>a+o.err,0)/nc.length).toFixed(3), 'max', Math.max(...nc.map(o=>o.err)).toFixed(3))
const cc = r.filter(o=>!o.c.endsWith(',0'))
console.log('falsolu ort hata', (cc.reduce((a,o)=>a+(o.err??0),0)/cc.length).toFixed(3))
console.log('gol', r.reduce((a,o)=>a+o.gol,0), '/', r.length)
console.log(errs.join('\n') || 'pageerror yok')
await browser.close()
