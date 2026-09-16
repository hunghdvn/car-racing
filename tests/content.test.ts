import { describe, expect, it } from 'vitest';
import { tracks } from '../src/config/tracks';
import { vehicles, upgradeDefinitions } from '../src/config/vehicles';
import { aiProfiles } from '../src/config/ai';
import { careerCups } from '../src/config/career';
import { EVENT_TYPES } from '../src/types';

describe('game content', () => {
  it('ships the exact MVP content counts', () => {
    expect(tracks.map((track) => track.id)).toEqual(['city', 'coast', 'mountain']);
    expect(vehicles.map((vehicle) => vehicle.id)).toEqual(['starter', 'swift', 'vector', 'tempest', 'phantom', 'apex']);
    expect(vehicles).toHaveLength(6);
    expect(aiProfiles).toHaveLength(5);
    expect(careerCups).toHaveLength(3);
    expect(careerCups.every((cup) => cup.events.length === 5)).toBe(true);
    expect(tracks.every((track) => track.lapCount === 3)).toBe(true);
  });

  it('keeps every track closed and every event typed', () => {
    const trackIds = new Set(tracks.map((track) => track.id));
    const events = careerCups.flatMap((cup) => cup.events);
    expect(tracks.every((track) => track.closed)).toBe(true);
    expect(events.every((event) => trackIds.has(event.trackId))).toBe(true);
    expect(events.every((event) => EVENT_TYPES.includes(event.type))).toBe(true);
  });

  it('unlocks only real vehicles with intact reward data', () => {
    const vehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
    const events = careerCups.flatMap((cup) => cup.events);
    const unlocks = events
      .map((event) => event.reward.unlock)
      .filter((unlock): unlock is string => unlock !== undefined);
    expect(unlocks.length).toBeGreaterThan(0);
    expect(unlocks.every((unlock) => vehicleIds.has(unlock))).toBe(true);
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    expect(events.every((event) => event.reward.currency > 0 && event.reward.xp > 0)).toBe(true);
    expect(events.every((event) => event.requiredLaps > 0 && event.targetTime > 0)).toBe(true);
  });

  it('gives every car distinct stats and supported upgrade slots', () => {
    expect(new Set(vehicles.map((vehicle) => vehicle.baseSpeed)).size).toBe(6);
    expect(new Set(vehicles.map((vehicle) => vehicle.acceleration)).size).toBe(6);
    const slots = new Set(Object.keys(upgradeDefinitions));
    expect(vehicles.every((vehicle) => vehicle.upgradeSlots.length > 0)).toBe(true);
    expect(vehicles.every((vehicle) => vehicle.upgradeSlots.every((slot) => slots.has(slot)))).toBe(true);
    expect(vehicles.every((vehicle) => vehicle.cosmeticOptions.length > 0)).toBe(true);
    expect(vehicles.every((vehicle) => vehicle.nitroCapacity > 0 && vehicle.nitroPower > 0)).toBe(true);
  });

  it('names a valid five-car AI field for every career event that ramps across cups', () => {
    const profileIds = new Set(aiProfiles.map((profile) => profile.id));
    const targetSpeed = (id: string): number => aiProfiles.find((profile) => profile.id === id)!.targetSpeed;
    const events = careerCups.flatMap((cup) => cup.events);
    expect(events.every((event) => event.aiLoadout !== undefined)).toBe(true);
    expect(events.every((event) => event.aiLoadout!.length === 5)).toBe(true);
    expect(events.every((event) => event.aiLoadout!.every((id) => profileIds.has(id)))).toBe(true);
    const averageSpeed = (cupId: string): number => {
      const cup = careerCups.find((candidate) => candidate.id === cupId)!;
      const ids = cup.events.flatMap((event) => [...event.aiLoadout!]);
      return ids.reduce((sum, id) => sum + targetSpeed(id), 0) / ids.length;
    };
    expect(averageSpeed('cup-2')).toBeGreaterThan(averageSpeed('cup-1'));
    expect(averageSpeed('cup-3')).toBeGreaterThan(averageSpeed('cup-2'));
  });
});
