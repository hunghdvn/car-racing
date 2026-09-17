import { AUDIO, UI } from '../config'
import { clamp01, damp, Rand } from '../util'
import { SEED } from '../config'

/* ------------------------------------------------------------------------- *
 * Original WebAudio synthesis (spec §15): a layered engine (rpm+load pitch
 * with the gear-curve feel), nitro whoosh + burn loop, tyre slip chirp,
 * impact thuds, landing, countdown beeps + GO, UI clicks and a speed wind.
 * Nothing is sampled — everything is oscillator/noise-buffer synthesis.
 * The context is created only after a user gesture and the whole surface is
 * fire-and-forget: when WebAudio is unavailable every call is a silent
 * no-op, never a throw.
 * ------------------------------------------------------------------------- */

/** Pure engine-pitch map (tests): rpm 0..1 -> Hz. */
export function engineFreqFor(rpm01: number): number {
  return AUDIO.engineBase + clamp01(rpm01) * AUDIO.engineRange
}

/** Pure wind level (tests): 0 below the gate, 1 at full speed. */
export function windLevelFor(speed: number): number {
  return clamp01((speed - UI.windInSpeed) / (UI.windFullSpeed - UI.windInSpeed))
}

/** Live drive telemetry the engine/tire/wind loops follow. */
export interface AudioDrive {
  /** 0..1 tach position of the current gear */
  rpm01: number
  /** 0..1 throttle/brake load */
  load: number
  nitro: boolean
  /** 0..1 drift-smoke-equivalent slip intensity (grounded only) */
  slip01: number
  /** m/s world speed */
  speed: number
  active: boolean
}

type Ctx = AudioContext

const damp0 = (cur: number, target: number, lambda: number, dt: number): number => damp(cur, target, lambda, dt)

export class Audio {
  private ctx: Ctx | null = null
  private master: GainNode | null = null
  private engineGain: GainNode | null = null
  private engineFilter: BiquadFilterNode | null = null
  private oscA: OscillatorNode | null = null
  private oscB: OscillatorNode | null = null
  private oscSub: OscillatorNode | null = null
  private tireGain: GainNode | null = null
  private nitroGain: GainNode | null = null
  private windGain: GainNode | null = null
  private noise: AudioBuffer | null = null
  /** false until a gesture successfully created the context */
  available = false
  private muted = false

  /** Call from a user gesture (keydown/pointerdown). Idempotent, never throws. */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume?.().catch?.(() => undefined); return }
    try {
      const w = globalThis as unknown as Record<string, (new () => Ctx) | undefined>
      const Factory = w.AudioContext ?? w.webkitAudioContext
      if (!Factory) return
      const ctx = new Factory()
      const master = ctx.createGain()
      master.gain.value = AUDIO.master
      master.connect(ctx.destination)
      const noise = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate)
      const rnd = new Rand(SEED ^ 0xa11ce)
      for (let ch = 0; ch < 2; ch++) {
        const d = noise.getChannelData(ch)
        for (let i = 0; i < d.length; i++) d[i] = rnd.next() * 2 - 1
      }
      this.ctx = ctx
      this.master = master
      this.noise = noise
      this.buildEngine(ctx, master)
      this.buildLoops(ctx, master)
      this.available = true
      void ctx.resume?.().catch?.(() => undefined)
    } catch {
      this.available = false
      this.ctx = null
    }
  }

  /* ------------------------------------------------------------- graph */

  private buildEngine(ctx: Ctx, master: GainNode): void {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 420
    filter.Q.value = 0.9
    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.connect(master)
    filter.connect(gain)
    const mk = (type: OscillatorType, detune: number, mul: number): OscillatorNode => {
      const o = ctx.createOscillator()
      o.type = type
      o.detune.value = detune
      const g = ctx.createGain()
      g.gain.value = mul
      o.connect(g)
      g.connect(filter)
      o.frequency.value = AUDIO.engineBase
      o.start()
      return o
    }
    this.oscA = mk('sawtooth', 4, 0.5)
    this.oscB = mk('square', -7, 0.3)
    this.oscSub = mk('square', 0, 0.35)
    this.engineGain = gain
    this.engineFilter = filter
  }

  private loopNoise(ctx: Ctx, master: GainNode, type: BiquadFilterType, freq: number, q: number): { gain: GainNode; filter: BiquadFilterNode } | null {
    if (!this.noise) return null
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    filter.Q.value = q
    const gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    src.start(0)
    return { gain, filter }
  }

  private buildLoops(ctx: Ctx, master: GainNode): void {
    const tire = this.loopNoise(ctx, master, 'bandpass', 1750, 1.4)
    const nitro = this.loopNoise(ctx, master, 'bandpass', 850, 0.7)
    const wind = this.loopNoise(ctx, master, 'highpass', 480, 0.5)
    this.tireGain = tire?.gain ?? null
    this.nitroGain = nitro?.gain ?? null
    this.windGain = wind?.gain ?? null
  }

  /* ------------------------------------------------------------- live */

  /** follow the drive state (rpm pitch, load, tyres, nitro loop, wind) */
  update(dt: number, d: AudioDrive): void {
    if (!this.ctx || !this.available) return
    try {
      const on = d.active && !this.muted
      if (this.oscA && this.oscB && this.oscSub) {
        const f = engineFreqFor(d.rpm01)
        const subMul = d.rpm01 > 0.5 ? 0.5 : 1
        this.oscA.frequency.value = f
        this.oscB.frequency.value = f
        this.oscSub.frequency.value = f * 0.5 * subMul
      }
      if (this.engineFilter) this.engineFilter.frequency.value = 320 + d.rpm01 * 2350 + d.load * 500
      if (this.engineGain) this.engineGain.gain.value = damp0(this.engineGain.gain.value, on ? 0.05 + 0.085 * Math.max(d.load, d.rpm01 * 0.6) : 0, 9, dt)
      if (this.tireGain) this.tireGain.gain.value = damp0(this.tireGain.gain.value, on ? clamp01(d.slip01) * 0.16 : 0, 7, dt)
      if (this.nitroGain) this.nitroGain.gain.value = damp0(this.nitroGain.gain.value, on && d.nitro ? 0.09 : 0, 8, dt)
      if (this.windGain) this.windGain.gain.value = damp0(this.windGain.gain.value, on ? windLevelFor(d.speed) * 0.05 : 0, 4, dt)
    } catch { /* the audio surface is advisory — never breaks the frame */ }
  }

  /** kill every bus while the UI holds the screen */
  setMuted(m: boolean): void { this.muted = m }

  /* -------------------------------------------------------- one-shots */

  private noiseBurst(dur: number, peak: number, type: BiquadFilterType, f0: number, f1: number, q: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.noise) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.playbackRate.value = 1
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.Q.value = q
    const t = ctx.currentTime
    filter.frequency.setValueAtTime(f0, t)
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(peak, t)
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur)
    src.connect(filter); filter.connect(g); g.connect(this.master)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  private thud(f0: number, f1: number, dur: number, peak: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const o = ctx.createOscillator()
    o.type = 'sine'
    const g = ctx.createGain()
    const t = ctx.currentTime
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    g.gain.setValueAtTime(peak, t)
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur)
    o.connect(g); g.connect(this.master)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private blip(freq: number, dur: number, peak: number, type: OscillatorType = 'square'): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(peak, t)
    g.gain.setValueAtTime(peak * 0.6, t + dur * 0.5)
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur)
    o.connect(g); g.connect(this.master)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  /** barrier/obstacle hit — low thud + scrape transient, scaled by severity */
  impact(severity: number): void {
    if (!this.available) return
    const s = clamp01(severity / 8)
    this.thud(150 + s * 90, 38, 0.24, 0.16 + 0.3 * s)
    this.noiseBurst(0.16 + 0.14 * s, 0.1 + 0.18 * s, 'bandpass', 1400, 260, 0.8)
  }

  /** touchdown after a jump */
  land(severity: number): void {
    if (!this.available) return
    const s = clamp01(severity / 9)
    this.thud(92, 26, 0.34, 0.2 + 0.26 * s)
    this.noiseBurst(0.22, 0.08 + 0.14 * s, 'lowpass', 900, 220, 0.7)
  }

  /** ramp launch whoosh */
  launch(): void {
    if (!this.available) return
    this.noiseBurst(0.3, 0.12, 'bandpass', 320, 2200, 1.2)
  }

  /** nitro ignition rush (the loop itself rides on update) */
  nitroActivate(): void {
    if (!this.available) return
    this.noiseBurst(0.55, 0.3, 'bandpass', 240, 3200, 1.1)
    this.thud(220, 880, 0.18, 0.1)
  }

  countdownCue(cue: '3' | '2' | '1' | 'go'): void {
    if (!this.available) return
    if (cue === 'go') this.blip(1046, 0.42, 0.22, 'sawtooth')
    else if (cue === '1') this.blip(880, 0.09, 0.17)
    else this.blip(660, 0.09, 0.15)
  }

  click(): void {
    if (!this.available) return
    this.blip(1250, 0.045, 0.12, 'triangle')
  }

  /** shortcut / chain reward ping */
  reward(): void {
    if (!this.available) return
    this.blip(880, 0.09, 0.14, 'triangle')
    this.blip(1320, 0.12, 0.12, 'triangle')
  }
}
