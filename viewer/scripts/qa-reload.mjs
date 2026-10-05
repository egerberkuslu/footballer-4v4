// O (QA): acilista sayfa kac kez yukleniyor (Vite dep-optimize ya da HMR tam yenileme)?
import { launch, BASE } from './qa-lib.mjs'
const { b, p } = await launch({ ff: process.argv.includes('--ff'), w: 1280, h: 800 })
const t0 = Date.now()
p.on('framenavigated', (f) => { if (f === p.mainFrame()) console.log('nav', ((Date.now() - t0) / 1000).toFixed(1), f.url()) })
p.on('console', (m) => { const t = m.text(); if (/vite|reload|optimiz/i.test(t)) console.log('console', ((Date.now() - t0) / 1000).toFixed(1), t.slice(0, 160)) })
await p.goto(BASE + '?mode=mac')
await p.waitForTimeout(15000)
await b.close()
