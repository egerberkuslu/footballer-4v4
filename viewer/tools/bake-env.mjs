// Cevre zemin dokularini pisirir: public/textures/env/{concrete,outer,gravel}.png.
// Kaynak uretici src/env/textures.ts icindedir (yedek yol); bu betik onu bir kez calistirir.
// Gereksinim: dev sunucusu (:5173). Kullanim: scripts/run-browser.sh node tools/bake-env.mjs [port]
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const port = process.argv[2] || '5173'
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'textures', 'env')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage()
page.setDefaultTimeout(300000)
await page.goto(`http://127.0.0.1:${port}/?grass=0&blades=1`)
const r = await page.evaluate(async () => {
  const m = await import('/src/env/textures.ts')
  const o = {}
  for (const [k, c] of Object.entries(m.bakeSources())) o[k] = c.toDataURL('image/png').split(',')[1]
  return o
})
for (const [k, b] of Object.entries(r)) writeFileSync(join(out, k + '.png'), Buffer.from(b, 'base64'))
console.log('yazildi:', out, Object.keys(r).join(','))
await browser.close()
