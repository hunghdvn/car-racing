import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SAVE_SCHEMA_VERSION,
  SAVE_STORAGE_KEY,
  SaveService,
  createDefaultSave,
  normalizeSave,
} from '../src/progression/SaveService';
import type { SaveData } from '../src/types';

class MemoryStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  get length(): number {
    return this.entries.size;
  }
}

class BrokenStorage {
  getItem(): string | null {
    throw new Error('storage unavailable');
  }

  setItem(): void {
    throw new Error('storage unavailable');
  }

  removeItem(): void {
    throw new Error('storage unavailable');
  }
}

function storedJson(storage: MemoryStorage): Record<string, unknown> | null {
  const text = storage.getItem(SAVE_STORAGE_KEY);
  if (text === null) return null;
  return JSON.parse(text) as Record<string, unknown>;
}

describe('SaveService', () => {
  it('returns the deep default for empty storage', () => {
    const service = new SaveService(new MemoryStorage());
    const save = service.load();
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(save.currency).toBe(0);
    expect(save.xp).toBe(0);
    expect(save.completedEvents).toEqual([]);
    expect(save.ownedVehicles).toEqual(['starter']);
    expect(save.selectedVehicle).toBe('starter');
    expect(save.upgradeLevels).toEqual({});
    expect(save.cosmetics).toEqual({});
    expect(save.bestTimes).toEqual({});
    expect(save.bestScores).toEqual({});
    expect(save.careerProgress.eventSeeds).toEqual({});
    expect(save.settings).toMatchObject({
      quality: expect.objectContaining({ preset: 'medium' }),
      controlMode: 'keyboard',
      cameraMode: 'chase',
      audioVolume: 0.7,
      muted: false,
    });
  });

  it('returns the default for corrupt storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_STORAGE_KEY, '{not-json');
    expect(new SaveService(storage).load()).toEqual(createDefaultSave());
    storage.setItem(SAVE_STORAGE_KEY, 'null');
    expect(new SaveService(storage).load()).toEqual(createDefaultSave());
    storage.setItem(SAVE_STORAGE_KEY, '"a string"');
    expect(new SaveService(storage).load()).toEqual(createDefaultSave());
  });

  it('returns the default for an unknown schema version', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify({ schemaVersion: 99, currency: 500 }));
    expect(new SaveService(storage).load()).toEqual(createDefaultSave());
  });

  it('merges a partial save over the deep defaults', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SAVE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SAVE_SCHEMA_VERSION,
        currency: 500,
        xp: 40,
        completedEvents: ['cup-1-event-1'],
        settings: { controlMode: 'touch', cameraMode: 'hood', audioVolume: 0.2 },
      }),
    );
    const save = new SaveService(storage).load();
    expect(save.currency).toBe(500);
    expect(save.xp).toBe(40);
    expect(save.completedEvents).toEqual(['cup-1-event-1']);
    expect(save.ownedVehicles).toEqual(['starter']);
    expect(save.settings.controlMode).toBe('touch');
    expect(save.settings.cameraMode).toBe('hood');
    expect(save.settings.audioVolume).toBe(0.2);
    expect(save.settings.muted).toBe(false);
    expect(save.settings.quality.preset).toBe('medium');
  });

  it('rejects malformed field types and clamps numeric settings', () => {
    const save = normalizeSave({
      schemaVersion: SAVE_SCHEMA_VERSION,
      currency: 'rich',
      xp: 5,
      completedEvents: [1, 2],
      ownedVehicles: ['starter', 7],
      upgradeLevels: { 'starter:engine': 'first' },
      bestTimes: { 'cup-1-event-1': 'fast' },
      settings: { controlMode: 'hologram', audioVolume: 9, muted: 'yes' },
    });
    expect(save.currency).toBe(0);
    expect(save.xp).toBe(5);
    expect(save.completedEvents).toEqual([]);
    expect(save.ownedVehicles).toEqual(['starter']);
    expect(save.upgradeLevels).toEqual({});
    expect(save.bestTimes).toEqual({});
    expect(save.settings.controlMode).toBe('keyboard');
    expect(save.settings.audioVolume).toBe(1);
    expect(save.settings.muted).toBe(false);
  });

  it('keeps the selected vehicle inside the owned set', () => {
    const save = normalizeSave({
      schemaVersion: SAVE_SCHEMA_VERSION,
      ownedVehicles: ['swift', 'vector'],
      selectedVehicle: 'apex',
    });
    expect(save.selectedVehicle).toBe('swift');
    const valid = normalizeSave({
      schemaVersion: SAVE_SCHEMA_VERSION,
      ownedVehicles: ['swift', 'vector'],
      selectedVehicle: 'vector',
    });
    expect(valid.selectedVehicle).toBe('vector');
  });

  it('serializes only known fields on save', () => {
    const storage = new MemoryStorage();
    const service = new SaveService(storage);
    service.save({ ...createDefaultSave(), hacked: true } as SaveData);
    const payload = storedJson(storage);
    expect(payload).not.toHaveProperty('hacked');
    expect(payload).toHaveProperty('schemaVersion', SAVE_SCHEMA_VERSION);
    expect(payload).toHaveProperty('settings');
    expect(payload).toHaveProperty('careerProgress');
  });

  it('round-trips a complete save', () => {
    const storage = new MemoryStorage();
    const service = new SaveService(storage);
    const save: SaveData = {
      ...createDefaultSave(),
      careerProgress: { eventSeeds: { 'cup-1-event-1': 7 } },
      completedEvents: ['cup-1-event-1'],
      currency: 250,
      xp: 50,
      ownedVehicles: ['starter', 'swift'],
      selectedVehicle: 'swift',
      upgradeLevels: { 'starter:engine': 2 },
      cosmetics: { starter: 'paint-starter-red' },
      bestTimes: { 'cup-1-event-2': 78.5 },
      bestScores: { 'cup-1-event-3': 300 },
      settings: { ...DEFAULT_SETTINGS, controlMode: 'tilt', audioVolume: 0.3, muted: true },
    };
    service.save(save);
    expect(service.load()).toEqual(save);
  });

  it('applies a new save atomically over the previous one', () => {
    const storage = new MemoryStorage();
    const service = new SaveService(storage);
    service.save({ ...createDefaultSave(), currency: 100 });
    const first = storedJson(storage);
    expect(first).toHaveProperty('currency', 100);
    expect(first).toHaveProperty('schemaVersion', SAVE_SCHEMA_VERSION);
    service.save({ ...createDefaultSave(), currency: 200 });
    const second = storedJson(storage);
    expect(second).toHaveProperty('currency', 200);
    expect(service.load().currency).toBe(200);
  });

  it('reset clears the save back to the default', () => {
    const storage = new MemoryStorage();
    const service = new SaveService(storage);
    service.save({ ...createDefaultSave(), currency: 999 });
    service.reset();
    expect(storage.getItem(SAVE_STORAGE_KEY)).toBe(null);
    expect(service.load()).toEqual(createDefaultSave());
  });

  it('survives a throwing storage', () => {
    const service = new SaveService(new BrokenStorage());
    expect(service.load()).toEqual(createDefaultSave());
    expect(() => service.save(createDefaultSave())).not.toThrow();
    expect(() => service.reset()).not.toThrow();
  });
});

describe('normalizeSave', () => {
  it('returns the default for non-object input', () => {
    expect(normalizeSave(null)).toEqual(createDefaultSave());
    expect(normalizeSave(undefined)).toEqual(createDefaultSave());
    expect(normalizeSave('save')).toEqual(createDefaultSave());
    expect(normalizeSave(42)).toEqual(createDefaultSave());
    expect(normalizeSave(['array'])).toEqual(createDefaultSave());
  });
});
