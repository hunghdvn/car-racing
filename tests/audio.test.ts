import { expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  setTargetAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
}

class FakeOscillator {
  type = 'sine';
  frequency = new FakeParam();
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
  connect(): void {}
  disconnect(): void {}
}

let fakeInstance: FakeAudioContext | null = null;

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  destination: unknown = {};
  oscillators: FakeOscillator[] = [];
  constructor() {
    fakeInstance = this;
  }
  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain(): { gain: FakeParam; connect: () => void; disconnect: () => void } {
    return { gain: new FakeParam(), connect: () => undefined, disconnect: () => undefined };
  }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(length) };
  }
  resume(): Promise<unknown> {
    return Promise.resolve(this);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

it('stops the music scheduler on mute and rebases on unmute', async () => {
  const scope = globalThis as Record<string, unknown>;
  scope.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  const audio = new AudioEngine();
  try {
    audio.start();
    const fake = fakeInstance;
    if (!fake) throw new Error('fake audio context was not created');
    audio.setMusicPhase('racing');
    fake.currentTime += 0.3;
    await sleep(80);
    const baseline = fake.oscillators.length;
    expect(baseline).toBeGreaterThan(0);
    audio.setMuted(true);
    fake.currentTime += 2;
    await sleep(100);
    expect(fake.oscillators.length).toBe(baseline);
    audio.setMuted(false);
    await sleep(100);
    expect(fake.oscillators.length - baseline).toBeLessThanOrEqual(4);
  } finally {
    audio.dispose();
    delete scope.AudioContext;
    fakeInstance = null;
  }
});

it('exposes mute and volume state', () => {
  const audio = new AudioEngine();
  audio.setMuted(true);
  audio.setVolume(0.4);
  expect(audio.muted).toBe(true);
  expect(audio.volume).toBe(0.4);
  audio.dispose();
});

it('replays the cached phase when unmuted before the first phase change', async () => {
  const scope = globalThis as Record<string, unknown>;
  scope.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  const audio = new AudioEngine();
  try {
    audio.setMuted(true);
    audio.start();
    audio.setMusicPhase('menu');
    expect(fakeInstance).toBe(null);
    audio.setMuted(false);
    const fake = fakeInstance;
    if (!fake) throw new Error('unmute should create the audio context');
    fake.currentTime += 0.3;
    await sleep(100);
    expect(fake.oscillators.length).toBeGreaterThan(0);
  } finally {
    audio.dispose();
    delete scope.AudioContext;
    fakeInstance = null;
  }
});

it('keeps public methods safe when audio is unavailable', () => {
  const audio = new AudioEngine();
  expect(() => {
    audio.start();
    audio.setMusicPhase('menu');
    audio.setEngineState(0.5, 0.2, 0.1);
    audio.playCountdown(3);
    audio.playCountdown(0);
    audio.playCollision(0.8);
    audio.playFinish();
    audio.playUi();
    audio.dispose();
    audio.dispose();
  }).not.toThrow();
});

it('starts unmuted at full volume and clamps setters', () => {
  const audio = new AudioEngine();
  expect(audio.muted).toBe(false);
  expect(audio.volume).toBe(1);
  audio.setVolume(2);
  expect(audio.volume).toBe(1);
  audio.setVolume(-1);
  expect(audio.volume).toBe(0);
  audio.setMuted(false);
  expect(audio.muted).toBe(false);
  audio.dispose();
});

it('accepts muted state before start and dispose', () => {
  const audio = new AudioEngine();
  audio.setMuted(true);
  expect(audio.muted).toBe(true);
  audio.dispose();
});
