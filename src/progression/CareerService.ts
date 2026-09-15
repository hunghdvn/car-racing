import { careerCups, isCupUnlockedFor, isEventUnlockedFor, type CareerCup } from '../config/career';
import { upgradeCost, upgradeDefinitions, vehicleById } from '../config/vehicles';
import type { EventConfig, EventInstance, SaveData, VehicleUpgrade } from '../types';
import { clampUpgradeLevel, resolveVehicleUpgrades, upgradeKey } from './careerRules';
import { createEventVariant } from './EventVariantService';
import { normalizeSave } from './SaveService';

export interface CareerSaveStorage {
  load(): unknown;
  save(data: SaveData): void;
}

export type StartEventReason = 'unknown-event' | 'event-locked';

export interface StartEventOutcome {
  ok: boolean;
  reason?: StartEventReason;
  event?: EventConfig;
  seed?: number;
  save?: SaveData;
}

export interface CareerEventInput {
  passed: boolean;
  score: number;
  reward: { currency: number; xp: number; unlock?: string };
  bestMetric?: 'time' | 'score';
  time?: number;
}

export interface CompleteEventOutcome {
  passed: boolean;
  currency: number;
  xp: number;
  unlocked: string[];
  save: SaveData;
}

export type UpgradeReason =
  | 'unknown-vehicle'
  | 'vehicle-not-owned'
  | 'unknown-slot'
  | 'max-level'
  | 'insufficient-currency';

export interface UpgradeOutcome {
  ok: boolean;
  reason?: UpgradeReason;
  cost?: number;
  level?: number;
  currency?: number;
}

export type CosmeticReason = 'unknown-vehicle' | 'vehicle-not-owned' | 'unknown-cosmetic';

export interface CosmeticOutcome {
  ok: boolean;
  reason?: CosmeticReason;
  cosmetic?: string;
  save?: SaveData;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function defaultSeedSource(): () => number {
  let state = (Date.now() % 2147483647) + 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) % 2147483647;
    return state;
  };
}

export class CareerService {
  private readonly storage: CareerSaveStorage;
  private readonly cups: readonly CareerCup[];
  private readonly seedSource: () => number;

  constructor(
    storage: CareerSaveStorage,
    cups: readonly CareerCup[] | null = null,
    seedSource: () => number = defaultSeedSource(),
  ) {
    this.storage = storage;
    this.cups = cups ?? careerCups;
    this.seedSource = seedSource;
  }

  state(): SaveData {
    return this.load();
  }

  isCupComplete(cupId: string, save: SaveData = this.state()): boolean {
    const cup = this.cups.find((candidate) => candidate.id === cupId);
    if (!cup) return false;
    return cup.events.every((event) => save.completedEvents.includes(event.id));
  }

  vehicleUpgrades(vehicleId: string, save: SaveData = this.state()): VehicleUpgrade[] {
    const vehicle = vehicleById(vehicleId);
    return vehicle ? resolveVehicleUpgrades(vehicle, save) : [];
  }

  isCupUnlocked(cupId: string, save: SaveData = this.state()): boolean {
    return isCupUnlockedFor(this.cups, save.completedEvents, cupId);
  }

  isEventUnlocked(cupId: string, eventId: string, save: SaveData = this.state()): boolean {
    return isEventUnlockedFor(this.cups, save.completedEvents, cupId, eventId);
  }

  startEvent(cupId: string, eventId: string): StartEventOutcome {
    const save = this.state();
    const cup = this.cups.find((candidate) => candidate.id === cupId);
    const event = cup?.events.find((candidate) => candidate.id === eventId);
    if (!cup || !event) return { ok: false, reason: 'unknown-event' };
    if (!this.isEventUnlocked(cupId, eventId, save)) return { ok: false, reason: 'event-locked' };
    const seed = this.seedSource();
    const next: SaveData = {
      ...save,
      careerProgress: { eventSeeds: { ...save.careerProgress.eventSeeds, [eventId]: seed } },
    };
    return { ok: true, event, seed, save: this.commit(next) };
  }

  eventVariant(event: EventConfig, save: SaveData = this.state()): EventInstance {
    const seed = save.careerProgress.eventSeeds[event.id] ?? 0;
    return createEventVariant(event, seed);
  }

  completeEvent(eventId: string, result: CareerEventInput): CompleteEventOutcome {
    const save = this.state();
    const event = this.cups
      .find((candidate) => candidate.events.some((entry) => entry.id === eventId))
      ?.events.find((candidate) => candidate.id === eventId);
    if (!event) throw new Error(`Unknown career event: ${eventId}`);
    const alreadyComplete = save.completedEvents.includes(eventId);
    const metric = result.bestMetric ?? (event.type === 'drift' || event.type === 'nitro' ? 'score' : 'time');
    const next: SaveData = {
      ...save,
      completedEvents: [...save.completedEvents],
      ownedVehicles: [...save.ownedVehicles],
      bestTimes: { ...save.bestTimes },
      bestScores: { ...save.bestScores },
    };
    if (metric === 'time' && isPositiveNumber(result.time)) {
      next.bestTimes[eventId] = Math.min(next.bestTimes[eventId] ?? Number.POSITIVE_INFINITY, result.time);
    }
    if (metric === 'score' && isPositiveNumber(result.score)) {
      next.bestScores[eventId] = Math.max(next.bestScores[eventId] ?? 0, Math.round(result.score));
    }
    const unlocked: string[] = [];
    if (result.passed && !alreadyComplete) {
      next.currency = save.currency + Math.max(0, Math.round(result.reward.currency));
      next.xp = save.xp + Math.max(0, Math.round(result.reward.xp));
      next.completedEvents.push(eventId);
      const unlock = result.reward.unlock;
      if (unlock && !next.ownedVehicles.includes(unlock)) {
        next.ownedVehicles.push(unlock);
        unlocked.push(unlock);
      }
    }
    this.commit(next);
    return { passed: result.passed, currency: next.currency, xp: next.xp, unlocked, save: next };
  }

  purchaseUpgrade(vehicleId: string, slot: string): UpgradeOutcome {
    const save = this.state();
    const vehicle = vehicleById(vehicleId);
    if (!vehicle) return { ok: false, reason: 'unknown-vehicle' };
    if (!save.ownedVehicles.includes(vehicleId)) return { ok: false, reason: 'vehicle-not-owned' };
    if (!vehicle.upgradeSlots.includes(slot)) return { ok: false, reason: 'unknown-slot' };
    const definition = upgradeDefinitions[slot];
    if (!definition) return { ok: false, reason: 'unknown-slot' };
    const key = upgradeKey(vehicleId, slot);
    const current = clampUpgradeLevel(save.upgradeLevels[key] ?? 0, definition.maxLevel);
    if (current >= definition.maxLevel) return { ok: false, reason: 'max-level' };
    const cost = upgradeCost(slot, current);
    if (save.currency < cost) return { ok: false, reason: 'insufficient-currency', cost };
    const next: SaveData = {
      ...save,
      currency: save.currency - cost,
      upgradeLevels: { ...save.upgradeLevels, [key]: current + 1 },
    };
    this.commit(next);
    return { ok: true, cost, level: current + 1, currency: next.currency };
  }

  equipCosmetic(vehicleId: string, cosmetic: string): CosmeticOutcome {
    const save = this.state();
    const vehicle = vehicleById(vehicleId);
    if (!vehicle) return { ok: false, reason: 'unknown-vehicle' };
    if (!save.ownedVehicles.includes(vehicleId)) return { ok: false, reason: 'vehicle-not-owned' };
    if (!vehicle.cosmeticOptions.includes(cosmetic)) return { ok: false, reason: 'unknown-cosmetic' };
    const next: SaveData = {
      ...save,
      cosmetics: { ...save.cosmetics, [vehicleId]: cosmetic },
    };
    return { ok: true, cosmetic, save: this.commit(next) };
  }

  private load(): SaveData {
    return normalizeSave(this.storage.load());
  }

  private commit(next: SaveData): SaveData {
    const normalized = normalizeSave(next);
    this.storage.save(normalized);
    return normalized;
  }
}
