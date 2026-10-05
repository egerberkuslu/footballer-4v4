// WebAudio ses sentezi: hakem duduğu (kisa, uzun, devre: iki uzun, mac sonu: uc uzun),
// topa vurus, ag, seyirci ugultusu. Ses baglami ilk kullanici etkilesiminde acilir.

type Listener = () => void

const KEY = 'k-ses'

class Sfx {
  ctx: AudioContext | null = null
  private master: GainNode | null = null
  private crowd: GainNode | null = null
  private noise: AudioBuffer | null = null
  volume = 0.7
  muted = false
  private subs = new Set<Listener>()
  private armed = false

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { v?: number; m?: boolean } | null
      if (s && typeof s.v === 'number') this.volume = s.v
      if (s && typeof s.m === 'boolean') this.muted = s.m
    } catch {
      /* depolama yok */
    }
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running'
  }

  subscribe(f: Listener) {
    this.subs.add(f)
    return () => {
      this.subs.delete(f)
    }
  }

  /** Ilk tiklama/tus ile baglami ac (tarayici kurali). */
  arm() {
    if (this.armed || typeof window === 'undefined') return
    this.armed = true
    const go = () => {
      this.init()
      if (this.ready) {
        window.removeEventListener('pointerdown', go, true)
        window.removeEventListener('keydown', go, true)
      }
    }
    window.addEventListener('pointerdown', go, true)
    window.addEventListener('keydown', go, true)
  }

  init() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AC()
        this.ctx = ctx
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.value = -14
        comp.ratio.value = 4
        comp.connect(ctx.destination)
        this.master = ctx.createGain()
        this.master.connect(comp)
        this.applyVolume()
        // 2 s beyaz gurultu tamponu (dongulu)
        const n = ctx.sampleRate * 2
        this.noise = ctx.createBuffer(1, n, ctx.sampleRate)
        const d = this.noise.getChannelData(0)
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
        this.startCrowd()
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.notify())
      this.notify()
    } catch {
      /* ses yok */
    }
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v))
    this.applyVolume()
    this.save()
  }

  toggleMute() {
    this.muted = !this.muted
    this.applyVolume()
    this.save()
  }

  private applyVolume() {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.03)
    this.notify()
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: this.volume, m: this.muted }))
    } catch {
      /* depolama yok */
    }
  }

  private notify() {
    this.subs.forEach((f) => f())
  }

  // ---------------------------------------------------------------- duduk
  /** Bezelyeli duduk: ~2.8 kHz tasiyici, 28 Hz titrek frekans/genlik + nefes gurultusu. */
  private blow(t0: number, dur: number, level = 0.5) {
    const ctx = this.ctx!
    const out = ctx.createGain()
    out.gain.value = 0
    out.connect(this.master!)
    const a = 0.012
    out.gain.setValueAtTime(0, t0)
    out.gain.linearRampToValueAtTime(level, t0 + a)
    out.gain.setValueAtTime(level, t0 + dur - 0.05)
    out.gain.linearRampToValueAtTime(0, t0 + dur)

    const f0 = 2750 + Math.random() * 120
    for (const [mul, g, type] of [
      [1, 0.55, 'triangle'],
      [2.004, 0.08, 'sine'],
    ] as const) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f0 * mul
      // bezelye titremesi
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 26 + Math.random() * 6
      const lg = ctx.createGain()
      lg.gain.value = 140 * mul
      lfo.connect(lg)
      lg.connect(o.frequency)
      const og = ctx.createGain()
      og.gain.value = g
      // genlik titremesi
      const am = ctx.createGain()
      am.gain.value = 0.75
      const amg = ctx.createGain()
      amg.gain.value = 0.25
      lfo.connect(amg)
      amg.connect(am.gain)
      o.connect(og)
      og.connect(am)
      am.connect(out)
      // ilk 40 ms'de perde hafif yukselir
      o.frequency.setValueAtTime(f0 * mul * 0.93, t0)
      o.frequency.linearRampToValueAtTime(f0 * mul, t0 + 0.04)
      o.start(t0)
      lfo.start(t0)
      o.stop(t0 + dur + 0.02)
      lfo.stop(t0 + dur + 0.02)
    }
    // nefes
    const n = ctx.createBufferSource()
    n.buffer = this.noise
    n.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = f0
    bp.Q.value = 3
    const ng = ctx.createGain()
    ng.gain.value = 0.12
    n.connect(bp)
    bp.connect(ng)
    ng.connect(out)
    n.start(t0, Math.random())
    n.stop(t0 + dur + 0.02)
  }

  whistle(reason: string) {
    if (!this.ready) return
    const t = this.ctx!.currentTime + 0.01
    switch (reason) {
      case 'end': // uc uzun
        this.blow(t, 0.7, 0.55)
        this.blow(t + 0.95, 0.7, 0.55)
        this.blow(t + 1.9, 1.5, 0.6)
        break
      case 'half': // iki uzun
        this.blow(t, 0.8, 0.55)
        this.blow(t + 1.05, 1.2, 0.55)
        break
      case 'goal':
      case 'kickoff':
      case 'start':
        this.blow(t, 0.75, 0.5)
        break
      case 'foul':
      case 'offside':
      case 'keeper-hold':
      case 'penalty':
      case 'var':
        this.blow(t, 0.42, 0.6) // sert, kesik
        break
      case 'advantage':
        break // avantajda duduk yok (kol isareti)
      case 'penalty-go':
        this.blow(t, 0.3, 0.45)
        break
      default: // out
        this.blow(t, 0.26, 0.42)
    }
  }

  // ---------------------------------------------------------------- top / ag / seyirci
  kick(power: number) {
    if (!this.ready) return
    const ctx = this.ctx!
    const t = ctx.currentTime + 0.005
    const p = Math.max(0.15, Math.min(1, power))
    const out = ctx.createGain()
    out.connect(this.master!)
    out.gain.setValueAtTime(0.9 * p, t)
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(170, t)
    o.frequency.exponentialRampToValueAtTime(55, t + 0.1)
    o.connect(out)
    o.start(t)
    o.stop(t + 0.17)
    const n = ctx.createBufferSource()
    n.buffer = this.noise
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1400 + 1600 * p
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.5 * p, t)
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.045)
    n.connect(lp)
    lp.connect(ng)
    ng.connect(this.master!)
    n.start(t, Math.random())
    n.stop(t + 0.05)
  }

  net() {
    if (!this.ready) return
    const ctx = this.ctx!
    const t = ctx.currentTime + 0.005
    const n = ctx.createBufferSource()
    n.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(2600, t)
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.5)
    bp.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.03)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6)
    n.connect(bp)
    bp.connect(g)
    g.connect(this.master!)
    n.start(t, Math.random())
    n.stop(t + 0.62)
  }

  /** Sabit hafif ugultu; gol aninda kabarir. */
  private startCrowd() {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 650
    bp.Q.value = 0.6
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2200
    // yavas dalgalanma
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.13
    const lg = ctx.createGain()
    lg.gain.value = 0.012
    this.crowd = ctx.createGain()
    this.crowd.gain.value = 0.035
    lfo.connect(lg)
    lg.connect(this.crowd.gain)
    src.connect(bp)
    bp.connect(lp)
    lp.connect(this.crowd)
    this.crowd.connect(this.master!)
    src.start()
    lfo.start()
  }

  roar(level = 1) {
    if (!this.ready || !this.crowd) return
    const g = this.crowd.gain
    const t = this.ctx!.currentTime
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(0.38 * level, t + 0.45)
    g.setTargetAtTime(0.035, t + 2.2, 1.6)
  }

  /** kisa heyecan (faul, korner) */
  murmur() {
    if (!this.ready || !this.crowd) return
    const g = this.crowd.gain
    const t = this.ctx!.currentTime
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(0.09, t + 0.3)
    g.setTargetAtTime(0.035, t + 0.9, 0.8)
  }
}

export const sfx = new Sfx()
