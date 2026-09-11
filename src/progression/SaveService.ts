import {
  CAMERA_MODES,
  CONTROL_MODES,
  QUALITY_PRESETS,
  type GameSettings,
  type QualitySettings,
  type SaveData,
} from '../types';

export const SAVE_SCHEMA_VERSION = 1;
export const SAVE_STORAGE_KEY = 'neon-rush-3d:save';

const TEXTURE_QUALITIES = ['low', 'medium', 'high'] as const;

export const DEFAULT_SETTINGS: GameSettings = {
  quality: {
    preset: 'medium',
    adaptiveEnabled: false,
    resolutionScale: 1,
    pixelRatio: 1.5,
    shadows: true,
    antiAliasing: true,
    textureQuality: 'medium',
    particleBudget: 500,
    propDensity: 1,
    postProcessing: false,
  },
  controlMode: 'keyboard',
  cameraMode: 'chase',
  audioVolume: 0.7,
  muted: false,
};

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const entries = value as unknown[];
  if (!entries.every(isString)) return null;
  return entries as string[];
}

function numberRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isNumber(entry)) return null;
    result[key] = entry;
  }
  return result;
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isString(entry)) return null;
    result[key] = entry;
  }
  return result;
}

function qualitySettings(raw: unknown, fallback: QualitySettings): QualitySettings {
  if (!isRecord(raw)) return { ...fallback };
  const quality: QualitySettings = { ...fallback };
  if (QUALITY_PRESETS.includes(raw.preset as QualitySettings['preset'])) {
    quality.preset = raw.preset as QualitySettings['preset'];
  }
  if (isBoolean(raw.adaptiveEnabled)) quality.adaptiveEnabled = raw.adaptiveEnabled;
  if (isNumber(raw.resolutionScale)) {
    quality.resolutionScale = Math.min(1, Math.max(0.5, raw.resolutionScale));
  }
  if (isNumber(raw.pixelRatio)) {
    quality.pixelRatio = Math.min(3, Math.max(0.5, raw.pixelRatio));
  }
  if (isBoolean(raw.shadows)) quality.shadows = raw.shadows;
  if (isBoolean(raw.antiAliasing)) quality.antiAliasing = raw.antiAliasing;
  if (TEXTURE_QUALITIES.includes(raw.textureQuality as QualitySettings['textureQuality'])) {
    quality.textureQuality = raw.textureQuality as QualitySettings['textureQuality'];
  }
  if (isNumber(raw.particleBudget)) {
    quality.particleBudget = Math.max(0, Math.floor(raw.particleBudget));
  }
  if (isNumber(raw.propDensity)) {
    quality.propDensity = Math.min(1, Math.max(0, raw.propDensity));
  }
  if (isBoolean(raw.postProcessing)) quality.postProcessing = raw.postProcessing;
  return quality;
}

function gameSettings(raw: unknown, fallback: GameSettings): GameSettings {
  if (!isRecord(raw)) {
    return { ...fallback, quality: { ...fallback.quality } };
  }
  const settings: GameSettings = {
    ...fallback,
    quality: qualitySettings(raw.quality, fallback.quality),
  };
  if (CONTROL_MODES.includes(raw.controlMode as GameSettings['controlMode'])) {
    settings.controlMode = raw.controlMode as GameSettings['controlMode'];
  }
  if (CAMERA_MODES.includes(raw.cameraMode as GameSettings['cameraMode'])) {
    settings.cameraMode = raw.cameraMode as GameSettings['cameraMode'];
  }
  if (isNumber(raw.audioVolume)) {
    settings.audioVolume = Math.min(1, Math.max(0, raw.audioVolume));
  }
  if (isBoolean(raw.muted)) settings.muted = raw.muted;
  return settings;
}

export function createDefaultSave(): SaveData {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    careerProgress: { eventSeeds: {} },
    completedEvents: [],
    currency: 0,
    xp: 0,
    ownedVehicles: ['starter'],
    selectedVehicle: 'starter',
    upgradeLevels: {},
    cosmetics: {},
    bestTimes: {},
    bestScores: {},
    settings: { ...DEFAULT_SETTINGS, quality: { ...DEFAULT_SETTINGS.quality } },
  };
}

export function normalizeSave(raw: unknown): SaveData {
  const base = createDefaultSave();
  if (!isRecord(raw)) return base;
  if ('schemaVersion' in raw && raw.schemaVersion !== SAVE_SCHEMA_VERSION) return base;
  const save: SaveData = { ...base };
  const completed = stringArray(raw.completedEvents);
  if (completed) save.completedEvents = completed;
  if (isNumber(raw.currency)) save.currency = Math.max(0, Math.floor(raw.currency));
  if (isNumber(raw.xp)) save.xp = Math.max(0, Math.floor(raw.xp));
  const owned = stringArray(raw.ownedVehicles);
  if (owned && owned.length > 0) {
    save.ownedVehicles = [...new Set(owned)];
  }
  if (isString(raw.selectedVehicle) && save.ownedVehicles.includes(raw.selectedVehicle)) {
    save.selectedVehicle = raw.selectedVehicle;
  } else {
    save.selectedVehicle = save.ownedVehicles[0] ?? 'starter';
  }
  const upgradeLevels = numberRecord(raw.upgradeLevels);
  if (upgradeLevels) save.upgradeLevels = upgradeLevels;
  const cosmetics = stringRecord(raw.cosmetics);
  if (cosmetics) save.cosmetics = cosmetics;
  const bestTimes = numberRecord(raw.bestTimes);
  if (bestTimes) save.bestTimes = bestTimes;
  const bestScores = numberRecord(raw.bestScores);
  if (bestScores) save.bestScores = bestScores;
  const career = isRecord(raw.careerProgress) ? raw.careerProgress : {};
  const eventSeeds = numberRecord(career.eventSeeds);
  if (eventSeeds) save.careerProgress = { eventSeeds };
  save.settings = gameSettings(raw.settings, base.settings);
  return save;
}

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class SaveService {
  private readonly storage: SaveStorage;

  constructor(storage: SaveStorage = globalThis.localStorage) {
    this.storage = storage;
  }

  load(): SaveData {
    const text = this.readText();
    if (text === null) return createDefaultSave();
    try {
      return normalizeSave(JSON.parse(text));
    } catch {
      return createDefaultSave();
    }
  }

  save(data: SaveData): void {
    const payload = JSON.stringify(normalizeSave({ ...data, schemaVersion: SAVE_SCHEMA_VERSION }));
    try {
      this.storage.setItem(SAVE_STORAGE_KEY, payload);
    } catch {
      return;
    }
  }

  reset(): void {
    try {
      this.storage.removeItem(SAVE_STORAGE_KEY);
    } catch {
      return;
    }
  }

  private readText(): string | null {
    try {
      return this.storage.getItem(SAVE_STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
