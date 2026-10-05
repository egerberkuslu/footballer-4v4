// O (QA): Firefox saglik kontrolu (kullanici Firefox'ta oynuyor). Antrenman + mac acilisi, pageerror ve kare sayisi.
// Kullanim: scripts/run-browser.sh node scripts/qa-ff.mjs <cikti-klasoru>
import fs from 'node:fs'
import { BASE, launch, save } from './qa-lib.mjs'
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const res = []
for (const [name, q, wait] of [['antrenman', '', 20000], ['mac', 'mode=mac', 30000]]) {
  const { b, p, logs } = await launch({ ff: true, w: 1280, h: 800 })
  await p.addInitScript(() => document.addEventListener('webglcontextlost', () => console.error('CONTEXT LOST'), true))
  await p.goto(BASE + (q ? '?' + q : ''))
  await p.waitForTimeout(wait)
  const info = await p
    .evaluate(() => {
      const s = window.__r3f
      if (!s) return { err: 'r3f yok' }
      const g = window.__game
      return { frame: s.gl.info.render.frame, lost: s.gl.getContext().isContextLost(), phase: g?.match.phase, clock: g?.match.clock, score: g?.match.score }
    })
    .catch((e) => ({ err: e.message }))
  await p.screenshot({ path: `${out}/ff-${name}.png`, timeout: 90000 }).catch((e) => logs.push({ kind: 'shot', msg: e.message }))
  res.push({ name, info, logs })
  console.log(name, JSON.stringify(info), 'hata:', logs.length, logs.slice(0, 5).map((l) => l.kind + ' ' + l.msg).join(' || '))
  await b.close()
}
save(`${out}/ff.json`, res)
