// Cim dokularini onceden pisirir: public/textures/grass/{tile.bin,noise.bin,pitch.png}.
// Kaynak uretici kod src/grass/* ve src/pitch.ts icindedir (calisma aninda yedek yol olarak durur);
// bu betik onu basiz tarayicida bir kez calistirip ciktiyi dosyaya yazar.
// Gereksinim: dev sunucusu (npm run dev, :5173). Kullanim: scripts/run-browser.sh node tools/bake-grass.mjs [port]
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const port = process.argv[2] || '5173'
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'textures', 'grass')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/home/ege/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage()
page.setDefaultTimeout(300000)
await page.goto(`http://127.0.0.1:${port}/?grass=0&blades=1`)
const r = await page.evaluate(async () => {
  const b64 = (u8) => {
    let s = ''
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
    return btoa(s)
  }
  const gt = await import('/src/grass/grassTexture.ts')
  const gn = await import('/src/grass/grassNoise.ts')
  const pt = await import('/src/pitch.ts')
  return {
    tile: b64(new Uint8Array(gt.paintTileBytes().buffer)),
    noise: b64(gn.paintNoiseBytes()),
    pitch: pt.paintPitch().toDataURL('image/png').split(',')[1],
  }
})
writeFileSync(join(out, 'tile.bin'), Buffer.from(r.tile, 'base64'))
writeFileSync(join(out, 'noise.bin'), Buffer.from(r.noise, 'base64'))
writeFileSync(join(out, 'pitch.png'), Buffer.from(r.pitch, 'base64'))
console.log('yazildi:', out)
await browser.close()
