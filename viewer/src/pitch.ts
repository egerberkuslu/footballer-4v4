// 4'e 4 kucuk saha olculeri (metre). x = saha boyu, z = saha eni, y = yukari.
// Bu dosyadaki sabitler ajanlar arasi ORTAK SOZLESMEDIR: degistirmeden once koordinatore sor.
export const PITCH_L = 40
export const PITCH_W = 25
export const PLATE_L = 48 // cizgi disi pay dahil zemin plakasi
export const PLATE_W = 33
export const GOAL_W = 5
export const GOAL_H = 2
export const NET_D_BOTTOM = 1.5
export const NET_D_TOP = 0.8
export const POST_R = 0.05
export const BALL_R = 0.11
export const SPOT_DIST = 7

const LINE_W = 0.1

// Saha maskesi: R = cizgi boyasi, G = asinma (toprak/kuru cim). Renk shader'da kurulur
// (src/grass/grassGlsl.ts); bicme bantlari analitik olarak shader'da cizilir.
export function paintPitch(): HTMLCanvasElement {
  const W = 4096
  const H = Math.round((W * PLATE_W) / PLATE_L)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const k = W / PLATE_L
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.setTransform(k, 0, 0, k, W / 2, H / 2)
  ctx.globalCompositeOperation = 'lighter'

  // asinma: kale agzi, penalti noktasi, orta nokta (yesil kanal, yumusak)
  const wear = (x: number, z: number, rx: number, rz: number, a: number) => {
    ctx.save()
    ctx.translate(x, z)
    ctx.scale(rx, rz)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    g.addColorStop(0, `rgba(0,255,0,${a})`)
    g.addColorStop(0.55, `rgba(0,255,0,${a * 0.45})`)
    g.addColorStop(1, 'rgba(0,255,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(-1, -1, 2, 2)
    ctx.restore()
  }
  let seed = 4242
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const hl = PITCH_L / 2
  const hw = PITCH_W / 2
  for (const s of [1, -1]) {
    // kale agzi: tek buyuk leke yerine duzensiz kucuk lekeler (tohumlu, her acilista ayni)
    for (let k = 0; k < 9; k++) {
      const t = rnd()
      wear(s * (hl - 0.4 - t * 1.6), (rnd() - 0.5) * 2.4, 0.25 + rnd() * 0.45, 0.2 + rnd() * 0.4, 0.22 + rnd() * 0.22)
    }
    for (let k = 0; k < 3; k++) wear(s * (hl - SPOT_DIST) + (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.4, 0.2 + rnd() * 0.2, 0.18 + rnd() * 0.15, 0.25)
  }
  for (let k = 0; k < 3; k++) wear((rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, 0.2 + rnd() * 0.2, 0.2 + rnd() * 0.2, 0.15)

  // cizgiler (kirmizi kanal). Kirlilik/silikligi shader cim dokusu ve gurultuyle ekler.
  ctx.strokeStyle = 'rgb(255,0,0)'
  ctx.fillStyle = 'rgb(255,0,0)'
  ctx.lineWidth = LINE_W
  ctx.lineCap = 'butt'
  const line = (draw: () => void, fill = false) => {
    ctx.beginPath()
    draw()
    if (fill) ctx.fill()
    else ctx.stroke()
  }

  // nokta: ~22 cm capli, kenari yumusak (shader cim dokusuyla yirtar)
  const spot = (x: number, z: number) => {
    const g = ctx.createRadialGradient(x, z, 0, x, z, 0.12)
    g.addColorStop(0, 'rgba(255,0,0,0.9)')
    g.addColorStop(0.6, 'rgba(255,0,0,0.75)')
    g.addColorStop(1, 'rgba(255,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - 0.12, z - 0.12, 0.24, 0.24)
  }

  // dis cizgi (cizgi saha icine dogru: kenar cizgisi sahanin parcasi)
  const o = LINE_W / 2
  ctx.strokeRect(-hl + o, -hw + o, PITCH_L - LINE_W, PITCH_W - LINE_W)
  line(() => {
    ctx.moveTo(0, -hw + LINE_W)
    ctx.lineTo(0, hw - LINE_W)
  })
  line(() => ctx.arc(0, 0, 3, 0, Math.PI * 2))
  spot(0, 0)

  const boxD = 8 // ceza alani derinligi
  const boxW = 16
  const smallD = 2.5 // kale alani
  const smallW = 9
  for (const s of [1, -1]) {
    const gx = s * (hl - o)
    line(() => {
      ctx.moveTo(gx, -boxW / 2)
      ctx.lineTo(s * (hl - boxD), -boxW / 2)
      ctx.lineTo(s * (hl - boxD), boxW / 2)
      ctx.lineTo(gx, boxW / 2)
    })
    line(() => {
      ctx.moveTo(gx, -smallW / 2)
      ctx.lineTo(s * (hl - smallD), -smallW / 2)
      ctx.lineTo(s * (hl - smallD), smallW / 2)
      ctx.lineTo(gx, smallW / 2)
    })
    const sx = s * (hl - SPOT_DIST)
    spot(sx, 0)
    // ceza yayi: noktadan 3 m, ceza alani disinda kalan kisim
    const r = 3
    const a = Math.acos((boxD - SPOT_DIST) / r)
    line(() => {
      if (s > 0) ctx.arc(sx, 0, r, Math.PI - a, Math.PI + a)
      else ctx.arc(sx, 0, r, -a, a)
    })
  }

  // korner yaylari r = 0.5
  const corners: [number, number, number][] = [
    [-hl, -hw, 0],
    [hl, -hw, Math.PI / 2],
    [hl, hw, Math.PI],
    [-hl, hw, (3 * Math.PI) / 2],
  ]
  for (const [cx, cz, a0] of corners) line(() => ctx.arc(cx, cz, 0.5, a0, a0 + Math.PI / 2))
  return canvas
}
