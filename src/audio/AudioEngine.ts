import type { GamePhase } from '../types';

export type MusicPhase = Exclude<GamePhase, 'paused'>;

interface MusicPattern {
  tempo: number;
  wave: OscillatorType;
  baseGain: number;
  bass: (number | null)[];
  lead: (number | null)[];
}

const MUSIC_PATTERNS: Record<MusicPhase, MusicPattern> = {
  menu: {
    tempo: 90,
    wave: 'triangle',
    baseGain: 0.09,
    bass: [48, null, null, null, null, null, null, null, 43, null, null, null, null, null, null, null],
    lead: [60, null, 64, null, 67, null, 72, null, 67, null, 64, null, 60, null, 64, null],
  },
  countdown: {
    tempo: 110,
    wave: 'square',
    baseGain: 0.08,
    bass: [45, null, 45, null, 45, null, 45, null, 45, null, 45, null, 50, null, 50, null],
    lead: [72, null, null, null, 72, null, null, null, 72, null, null, null, 76, null, 76, null],
  },
  racing: {
    tempo: 132,
    wave: 'sawtooth',
    baseGain: 0.07,
    bass: [40, null, 40, null, 43, null, 40, null, 47, null, 47, null, 43, null, 40, null],
    lead: [64, null, 64, 67, null, 64, 71, null, 76, null, 71, null, 74, null, 71, 67],
  },
  results: {
    tempo: 104,
    wave: 'square',
    baseGain: 0.09,
    bass: [48, null, null, null, 48, null, null, null, 50, null, null, null, 50, null, null, null],
    lead: [60, null, 64, null, 67, null, 72, null, 74, null, 76, null, 79, null, 76, null],
  },
};

const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export class AudioEngine {
  private isMuted = false;
  private level = 1;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOscGain: GainNode | null = null;
  private nitroGain: GainNode | null = null;
  private driftGain: GainNode | null = null;
  private musicPhase: MusicPhase | null = null;
  private paused = false;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private engine = { speed: 0, nitro: 0, drift: 0 };
  private sources = new Set<AudioScheduledSourceNode>();
  private closed = false;

  get muted(): boolean {
    return this.isMuted;
  }

  get volume(): number {
    return this.level;
  }

  start(): void {
    if (this.isMuted || this.closed) return;
    this.ensureContext();
    this.ctx?.resume().catch(() => undefined);
  }

  setMuted(value: boolean): void {
    this.isMuted = value;
    if (this.closed) return;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(value ? 0 : this.level, this.ctx.currentTime, 0.02);
    } else if (!value) {
      this.ensureContext();
    }
    if (value) {
      this.stopScheduler();
      return;
    }
    this.ctx?.resume().catch(() => undefined);
    this.restartMusic();
  }

  setVolume(value: number): void {
    this.level = clamp01(value);
    if (this.closed || !this.ctx || !this.master || this.isMuted) return;
    this.master.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.02);
  }

  setEngineState(speed: number, nitro: number, drift: number): void {
    this.engine = { speed: clamp01(speed), nitro: clamp01(nitro), drift: clamp01(drift) };
    if (this.isMuted || this.closed || !this.ctx || !this.engineBus || !this.noise) return;
    this.ensureEngineNodes();
    const time = this.ctx.currentTime;
    this.engineOsc?.frequency.setTargetAtTime(55 + this.engine.speed * 165, time, 0.06);
    this.engineOscGain?.gain.setTargetAtTime(0.1 + this.engine.speed * 0.1, time, 0.08);
    this.nitroGain?.gain.setTargetAtTime(this.engine.nitro * 0.35, time, 0.1);
    this.driftGain?.gain.setTargetAtTime(this.engine.drift * 0.3, time, 0.08);
    this.applyMusicIntensity();
  }

  setMusicPhase(phase: GamePhase): void {
    if (this.isMuted || this.closed || !this.ctx) return;
    if (phase === 'paused') {
      this.paused = true;
      this.stopScheduler();
      return;
    }
    this.paused = false;
    this.musicPhase = phase;
    this.applyMusicIntensity();
    this.startScheduler();
  }

  playCountdown(value: number): void {
    if (this.isMuted || this.closed || !this.ctx || !this.sfxBus) return;
    const time = this.ctx.currentTime + 0.01;
    if (value > 0) this.scheduleVoice(81, time, 0.12, 0.25, 'square', this.sfxBus);
    else this.scheduleVoice(86, time, 0.5, 0.3, 'square', this.sfxBus);
  }

  playCollision(strength: number): void {
    if (this.isMuted || this.closed || !this.ctx || !this.sfxBus || !this.noise) return;
    const s = clamp01(strength);
    const time = this.ctx.currentTime + 0.005;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900 - s * 300;
    const gain = this.ctx.createGain();
    const dur = 0.2 + 0.25 * s;
    gain.gain.setValueAtTime(0.25 + 0.5 * s, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(time);
    src.stop(time + dur);
    this.trackSource(src);
    const thud = this.ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.value = 70;
    const thudGain = this.ctx.createGain();
    thudGain.gain.setValueAtTime(0.15 + 0.35 * s, time);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
    thud.connect(thudGain);
    thudGain.connect(this.sfxBus);
    thud.start(time);
    thud.stop(time + 0.25);
    this.trackSource(thud);
  }

  playFinish(): void {
    if (this.isMuted || this.closed || !this.ctx || !this.sfxBus) return;
    const notes = [72, 76, 79, 84];
    const base = this.ctx.currentTime + 0.01;
    notes.forEach((note, index) => {
      this.scheduleVoice(note, base + index * 0.14, 0.25, 0.2, 'square', this.sfxBus!);
    });
  }

  playUi(): void {
    if (this.isMuted || this.closed || !this.ctx || !this.sfxBus) return;
    this.scheduleVoice(79, this.ctx.currentTime + 0.005, 0.07, 0.12, 'triangle', this.sfxBus);
  }

  dispose(): void {
    this.stopScheduler();
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.sources.clear();
    this.engineOsc = null;
    this.engineOscGain = null;
    this.nitroGain = null;
    this.driftGain = null;
    this.master?.disconnect();
    this.musicBus?.disconnect();
    this.sfxBus?.disconnect();
    this.engineBus?.disconnect();
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.engineBus = null;
    this.noise = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.closed = true;
    ctx?.close().catch(() => undefined);
  }

  private audioConstructor(): typeof AudioContext | undefined {
    if (typeof globalThis === 'undefined') return undefined;
    const scoped = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    return scoped.AudioContext ?? scoped.webkitAudioContext;
  }

  private ensureContext(): void {
    if (this.ctx || this.closed) return;
    const Ctor = this.audioConstructor();
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      const musicBus = ctx.createGain();
      const sfxBus = ctx.createGain();
      const engineBus = ctx.createGain();
      master.gain.value = this.isMuted ? 0 : this.level;
      musicBus.gain.value = 1;
      sfxBus.gain.value = 1;
      engineBus.gain.value = 1;
      musicBus.connect(master);
      sfxBus.connect(master);
      engineBus.connect(master);
      master.connect(ctx.destination);
      const length = Math.floor(ctx.sampleRate);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.musicBus = musicBus;
      this.sfxBus = sfxBus;
      this.engineBus = engineBus;
      this.noise = buffer;
    } catch {
      this.ctx = null;
    }
  }

  private ensureEngineNodes(): void {
    const ctx = this.ctx;
    const bus = this.engineBus;
    const noise = this.noise;
    if (!ctx || !bus || !noise) return;
    if (this.engineOsc) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55 + this.engine.speed * 165;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.1 + this.engine.speed * 0.1;
    osc.connect(oscGain);
    oscGain.connect(bus);
    osc.start();
    this.trackSource(osc);
    this.engineOsc = osc;
    this.engineOscGain = oscGain;
    const nitroSrc = ctx.createBufferSource();
    nitroSrc.buffer = noise;
    nitroSrc.loop = true;
    const nitroFilter = ctx.createBiquadFilter();
    nitroFilter.type = 'bandpass';
    nitroFilter.frequency.value = 1800;
    const nitroGain = ctx.createGain();
    nitroGain.gain.value = this.engine.nitro * 0.35;
    nitroSrc.connect(nitroFilter);
    nitroFilter.connect(nitroGain);
    nitroGain.connect(bus);
    nitroSrc.start();
    this.trackSource(nitroSrc);
    this.nitroGain = nitroGain;
    const driftSrc = ctx.createBufferSource();
    driftSrc.buffer = noise;
    driftSrc.loop = true;
    const driftFilter = ctx.createBiquadFilter();
    driftFilter.type = 'highpass';
    driftFilter.frequency.value = 2500;
    const driftGain = ctx.createGain();
    driftGain.gain.value = this.engine.drift * 0.3;
    driftSrc.connect(driftFilter);
    driftFilter.connect(driftGain);
    driftGain.connect(bus);
    driftSrc.start();
    this.trackSource(driftSrc);
    this.driftGain = driftGain;
  }

  private restartMusic(): void {
    if (this.musicPhase && !this.paused) this.startScheduler();
  }

  private applyMusicIntensity(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const intensity = this.musicPhase === 'racing' ? 0.5 + 0.5 * this.engine.speed : 1;
    bus.gain.setTargetAtTime(intensity, ctx.currentTime, 0.1);
  }

  private startScheduler(): void {
    const ctx = this.ctx;
    if (!ctx || this.timer !== null || this.isMuted) return;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.06;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  private stopScheduler(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicPhase || this.paused || this.isMuted) return;
    const pattern = MUSIC_PATTERNS[this.musicPhase];
    const stepTime = 60 / pattern.tempo / 2;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.scheduleStep(pattern, this.step, this.nextTime);
      this.step = (this.step + 1) % 16;
      this.nextTime += stepTime;
    }
  }

  private scheduleStep(pattern: MusicPattern, step: number, time: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const stepTime = 60 / pattern.tempo / 2;
    const bassNote = pattern.bass[step] ?? null;
    if (bassNote !== null) this.scheduleVoice(bassNote, time, stepTime * 1.8, pattern.baseGain, pattern.wave, bus);
    const leadNote = pattern.lead[step] ?? null;
    if (leadNote !== null) this.scheduleVoice(leadNote, time, stepTime * 1.6, pattern.baseGain * 0.8, pattern.wave, bus);
  }

  private scheduleVoice(
    midi: number,
    time: number,
    dur: number,
    gain: number,
    wave: OscillatorType,
    bus: GainNode,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = midiToHz(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(env);
    env.connect(bus);
    osc.start(time);
    osc.stop(time + dur + 0.02);
    this.trackSource(osc);
  }

  private trackSource(source: AudioScheduledSourceNode): void {
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }
}
