import { expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';

it('exposes mute and volume state', () => {
  const audio = new AudioEngine();
  audio.setMuted(true);
  audio.setVolume(0.4);
  expect(audio.muted).toBe(true);
  expect(audio.volume).toBe(0.4);
  audio.dispose();
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
