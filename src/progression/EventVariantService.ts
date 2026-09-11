import { tracks } from '../config/tracks';
import type { EnvironmentVariant, EventConfig, EventInstance } from '../types';

export const TARGET_DRIFT = 0.1;
export const REWARD_DRIFT = 0.2;

const FALLBACK_VARIANT: EnvironmentVariant = { nightFactor: 0, weather: 'clear' };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boundedVary(base: number, minFactor: number, maxFactor: number, next: () => number, precision: number): number {
  const factor = minFactor + (maxFactor - minFactor) * next();
  const scaled = Math.round(base * factor * precision);
  const low = Math.round(base * minFactor * precision);
  const high = Math.round(base * maxFactor * precision);
  return Math.max(low, Math.min(high, scaled)) / precision;
}

function pickVariant(event: EventConfig, next: () => number): EnvironmentVariant {
  const track = tracks.find((candidate) => candidate.id === event.trackId);
  const variants = track?.variants.length ? track.variants : [FALLBACK_VARIANT];
  return variants[Math.floor(next() * variants.length)] ?? FALLBACK_VARIANT;
}

export function createEventVariant(event: EventConfig, seed: number): EventInstance {
  const next = mulberry32(seed);
  const currency = Math.round(boundedVary(event.reward.currency, 1 - REWARD_DRIFT, 1 + REWARD_DRIFT, next, 1));
  const xp = Math.round(boundedVary(event.reward.xp, 1 - REWARD_DRIFT, 1 + REWARD_DRIFT, next, 1));
  const reward = event.reward.unlock !== undefined ? { currency, xp, unlock: event.reward.unlock } : { currency, xp };
  return {
    id: `${event.id}:${seed}`,
    type: event.type,
    trackId: event.trackId,
    seed,
    variant: pickVariant(event, next),
    targetTime: boundedVary(event.targetTime, 1 - TARGET_DRIFT, 1 + TARGET_DRIFT, next, 10),
    targetScore: Math.round(boundedVary(event.targetScore, 1 - TARGET_DRIFT, 1 + TARGET_DRIFT, next, 1)),
    reward,
  };
}
