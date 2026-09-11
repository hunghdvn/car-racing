import { describe, expect, it } from 'vitest';
import { createEventVariant } from '../src/progression/EventVariantService';
import type { EventConfig } from '../src/types';
import { tracks } from '../src/config/tracks';

const base: EventConfig = {
  id: 'event-1',
  type: 'timeAttack',
  trackId: 'coast',
  requiredLaps: 1,
  targetTime: 90,
  targetScore: 1000,
  reward: { currency: 100, xp: 10 },
};

describe('event variants', () => {
  it('produces deterministic bounded variation for a seed', () => {
    const first = createEventVariant(base, 7);
    const second = createEventVariant(base, 7);
    expect(first).toEqual(second);
    expect(first.targetTime).toBeGreaterThanOrEqual(81);
    expect(first.targetTime).toBeLessThanOrEqual(99);
    expect(first.reward.currency).toBeGreaterThanOrEqual(80);
    expect(first.reward.currency).toBeLessThanOrEqual(120);
  });

  it('stays bounded across a wide seed range', () => {
    for (let seed = 0; seed < 400; seed += 1) {
      const variant = createEventVariant(base, seed);
      expect(variant.seed).toBe(seed);
      expect(variant.targetTime).toBeGreaterThanOrEqual(81);
      expect(variant.targetTime).toBeLessThanOrEqual(99);
      expect(variant.targetScore).toBeGreaterThanOrEqual(900);
      expect(variant.targetScore).toBeLessThanOrEqual(1100);
      expect(variant.reward.currency).toBeGreaterThanOrEqual(80);
      expect(variant.reward.currency).toBeLessThanOrEqual(120);
      expect(variant.reward.xp).toBeGreaterThanOrEqual(8);
      expect(variant.reward.xp).toBeLessThanOrEqual(12);
    }
  });

  it('only selects variants from the event track', () => {
    const track = tracks.find((candidate) => candidate.id === base.trackId);
    if (!track) throw new Error('missing coast track');
    const allowed = new Set(track.variants.map((entry) => JSON.stringify(entry)));
    for (let seed = 0; seed < 100; seed += 1) {
      const variant = createEventVariant(base, seed);
      expect(allowed.has(JSON.stringify(variant.variant))).toBe(true);
      expect(variant.trackId).toBe(base.trackId);
      expect(variant.type).toBe(base.type);
    }
  });

  it('produces different variants for different seeds', () => {
    const first = createEventVariant(base, 1);
    const differs = Array.from({ length: 200 }, (_, index) => createEventVariant(base, index + 2)).some(
      (variant) =>
        variant.targetTime !== first.targetTime ||
        JSON.stringify(variant.variant) !== JSON.stringify(first.variant) ||
        variant.reward.currency !== first.reward.currency,
    );
    expect(differs).toBe(true);
  });

  it('carries the configured unlock through unchanged', () => {
    const event: EventConfig = { ...base, reward: { currency: 100, xp: 10, unlock: 'swift' } };
    expect(createEventVariant(event, 3).reward.unlock).toBe('swift');
    const withoutUnlock = createEventVariant(base, 3);
    expect(withoutUnlock.reward.unlock).toBeUndefined();
  });
});
