import { describe, expect, it } from 'vitest';
import { CareerService } from '../src/progression/CareerService';
import { createEventVariant } from '../src/progression/EventVariantService';
import { createDefaultSave } from '../src/progression/SaveService';
import { careerCups } from '../src/config/career';
import type { EventConfig, SaveData } from '../src/types';

it('rewards a completed event and unlocks the next gate', () => {
  const service = new CareerService({ load: () => ({ schemaVersion:1, currency:0, xp:0, completedEvents:[], ownedVehicles:['starter'], upgradeLevels:{}, cosmetics:{} } as never), save: () => {} } as never, null as never);
  const result = service.completeEvent('cup-1-event-1', { passed:true, score:100, reward:{ currency:250, xp:50, unlock:'car-2' } } as never);
  expect(result.currency).toBe(250);
  expect(result.unlocked).toContain('car-2');
});

function makeStorage(initial: SaveData = createDefaultSave()) {
  let data: unknown = initial;
  let saves = 0;
  const storage = {
    load: () => data,
    save: (next: SaveData) => {
      data = next;
      saves += 1;
    },
  };
  return {
    storage,
    saves: () => saves,
    data: () => data as SaveData,
  };
}

describe('CareerService', () => {
  it('stores a stable variant seed for the started event and rotates it on replay', () => {
    const world = makeStorage();
    let seed = 100;
    const service = new CareerService(world.storage, null, () => {
      seed += 1;
      return seed;
    });
    const started = service.startEvent('cup-1', 'cup-1-event-1');
    expect(started.ok).toBe(true);
    expect(started.seed).toBe(101);
    const event = started.event;
    if (!event) throw new Error('startEvent should return the event');
    const storedSeed = world.data().careerProgress.eventSeeds['cup-1-event-1'];
    expect(storedSeed).toBe(101);
    expect(createEventVariant(event, 101)).toEqual(service.eventVariant(event));
    const replay = service.startEvent('cup-1', 'cup-1-event-1');
    expect(replay.ok).toBe(true);
    expect(replay.seed).toBe(102);
    expect(replay.seed).not.toBe(started.seed);
  });

  it('locks events behind cup and sequential completion gates', () => {
    const { storage } = makeStorage();
    const service = new CareerService(storage, null);
    expect(service.startEvent('cup-1', 'cup-1-event-1').ok).toBe(true);
    expect(service.startEvent('cup-1', 'cup-1-event-2')).toEqual({ ok: false, reason: 'event-locked' });
    expect(service.startEvent('cup-2', 'cup-2-event-1')).toEqual({ ok: false, reason: 'event-locked' });
    expect(service.startEvent('cup-9', 'cup-1-event-1')).toEqual({ ok: false, reason: 'unknown-event' });
    expect(service.startEvent('cup-1', 'ghost-event')).toEqual({ ok: false, reason: 'unknown-event' });
  });

  it('unlocks the next cup after every event of the previous cup completes', () => {
    const { storage } = makeStorage();
    const service = new CareerService(storage, null);
    const firstCup = careerCups.find((cup) => cup.id === 'cup-1');
    if (!firstCup) throw new Error('missing cup-1');
    for (const event of firstCup.events) {
      service.completeEvent(event.id, { passed: true, score: 100, reward: { currency: 0, xp: 0 } });
    }
    expect(service.isCupComplete('cup-1')).toBe(true);
    expect(service.isCupComplete('cup-2')).toBe(false);
    expect(service.startEvent('cup-2', 'cup-2-event-1').ok).toBe(true);
  });

  it('awards rewards, records best results and applies unlock gates on pass', () => {
    const { storage } = makeStorage({ ...createDefaultSave(), currency: 1000, xp: 5 });
    const service = new CareerService(storage, null);
    const result = service.completeEvent('cup-1-event-3', {
      passed: true,
      score: 320,
      reward: { currency: 120, xp: 12, unlock: 'swift' },
    });
    expect(result.passed).toBe(true);
    expect(result.currency).toBe(1120);
    expect(result.xp).toBe(17);
    expect(result.unlocked).toEqual(['swift']);
    const save = service.state();
    expect(save.completedEvents).toContain('cup-1-event-3');
    expect(save.ownedVehicles).toEqual(['starter', 'swift']);
    expect(save.bestScores['cup-1-event-3']).toBe(320);
    const repeat = service.completeEvent('cup-1-event-3', {
      passed: true,
      score: 400,
      reward: { currency: 120, xp: 12, unlock: 'swift' },
    });
    expect(repeat.currency).toBe(1120);
    expect(repeat.unlocked).toEqual([]);
    expect(service.state().bestScores['cup-1-event-3']).toBe(400);
  });

  it('does not reward a failed attempt but keeps its best metric', () => {
    const { storage } = makeStorage();
    const service = new CareerService(storage, null);
    const result = service.completeEvent('cup-1-event-3', {
      passed: false,
      score: 120,
      reward: { currency: 120, xp: 12, unlock: 'swift' },
    });
    expect(result.passed).toBe(false);
    expect(result.currency).toBe(0);
    expect(result.xp).toBe(0);
    expect(result.unlocked).toEqual([]);
    const save = service.state();
    expect(save.bestScores['cup-1-event-3']).toBe(120);
    expect(save.ownedVehicles).toEqual(['starter']);
    expect(save.completedEvents).toEqual([]);
  });

  it('keeps the fastest time for time-based events', () => {
    const { storage } = makeStorage();
    const service = new CareerService(storage, null);
    service.completeEvent('cup-1-event-2', { passed: true, score: 100, time: 84, reward: { currency: 100, xp: 10 } });
    service.completeEvent('cup-1-event-2', { passed: false, score: 90, time: 81.5, reward: { currency: 0, xp: 0 } });
    expect(service.state().bestTimes['cup-1-event-2']).toBe(81.5);
    expect(service.state().bestScores['cup-1-event-2']).toBeUndefined();
  });

  it('purchases upgrades level by level until the maximum', () => {
    const { storage } = makeStorage({ ...createDefaultSave(), currency: 10000 });
    const service = new CareerService(storage, null);
    const levels: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const outcome = service.purchaseUpgrade('starter', 'engine');
      if (outcome.ok) levels.push(outcome.level ?? -1);
    }
    expect(levels).toEqual([1, 2, 3]);
    expect(service.purchaseUpgrade('starter', 'engine')).toEqual({ ok: false, reason: 'max-level' });
    expect(service.state().upgradeLevels['starter:engine']).toBe(3);
    expect(service.state().currency).toBe(10000 - 150 - 225 - 300);
  });

  it('rejects invalid upgrade purchases with a reason', () => {
    const { storage } = makeStorage({ ...createDefaultSave(), currency: 10 });
    const service = new CareerService(storage, null);
    expect(service.purchaseUpgrade('ghost', 'engine')).toEqual({ ok: false, reason: 'unknown-vehicle' });
    expect(service.purchaseUpgrade('apex', 'engine')).toEqual({ ok: false, reason: 'vehicle-not-owned' });
    expect(service.purchaseUpgrade('starter', 'wings')).toEqual({ ok: false, reason: 'unknown-slot' });
    expect(service.purchaseUpgrade('starter', 'engine')).toEqual({ ok: false, reason: 'insufficient-currency', cost: 150 });
    expect(service.state().currency).toBe(10);
  });

  it('equips a cosmetic from the vehicle options and rejects the rest', () => {
    const { storage } = makeStorage();
    const service = new CareerService(storage, null);
    const outcome = service.equipCosmetic('starter', 'paint-starter-silver');
    expect(outcome.ok).toBe(true);
    expect(service.state().cosmetics.starter).toBe('paint-starter-silver');
    expect(service.equipCosmetic('starter', 'paint-mystery')).toEqual({ ok: false, reason: 'unknown-cosmetic' });
    expect(service.equipCosmetic('apex', 'paint-starter-silver')).toEqual({ ok: false, reason: 'vehicle-not-owned' });
    expect(service.equipCosmetic('ghost', 'paint-starter-silver')).toEqual({ ok: false, reason: 'unknown-vehicle' });
  });

  it('persists each mutation once and never mutates the previous save', () => {
    const initial = createDefaultSave();
    const { storage, saves } = makeStorage(initial);
    const service = new CareerService(storage, null);
    const before = JSON.parse(JSON.stringify(initial)) as SaveData;
    service.startEvent('cup-1', 'cup-1-event-1');
    expect(saves()).toBe(1);
    service.completeEvent('cup-1-event-1', { passed: true, score: 100, reward: { currency: 50, xp: 5 } });
    expect(saves()).toBe(2);
    expect(initial).toEqual(before);
    expect(service.state().completedEvents).toEqual(['cup-1-event-1']);
  });

  it('derives the event variant from the stored seed', () => {
    const { storage } = makeStorage();
    const service = new CareerService(storage, null, () => 7);
    const started = service.startEvent('cup-1', 'cup-1-event-1');
    expect(started.ok).toBe(true);
    const event = started.event;
    if (!event) throw new Error('startEvent should return the event');
    expect(service.eventVariant(event)).toEqual(createEventVariant(event, 7));
    const notStarted: EventConfig = { ...event, id: 'never-started' };
    expect(service.eventVariant(notStarted).seed).toBe(0);
  });
});
