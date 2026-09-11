export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface TrackSample {
  point: Vec3;
  tangent: Vec3;
  left: Vec3;
  distance: number;
  curvature: number;
}
export type Weather = 'clear' | 'rain' | 'fog';
export interface EnvironmentVariant {
  nightFactor: number;
  weather: Weather;
}
export interface TrackConfig {
  id: string;
  displayName: string;
  environment: 'city' | 'coast' | 'mountain';
  controlPoints: Vec3[];
  width: number;
  lapCount: number;
  closed: boolean;
  variants: EnvironmentVariant[];
  startTransform: { position: Vec3; heading: number };
  checkpointDistances: number[];
  obstacleDistances: number[];
  minimapBounds: { minX: number; minY: number; maxX: number; maxY: number };
}
export interface ObstacleConfig {
  position: Vec3;
  radius: number;
  type: 'cone' | 'barrier';
}
export type EventType = 'race' | 'timeAttack' | 'drift' | 'nitro';
export interface EventConfig {
  id: string;
  type: EventType;
  trackId: string;
  requiredLaps: number;
  targetTime: number;
  targetScore: number;
  reward: { currency: number; xp: number; unlock?: string };
}
export interface EventInstance {
  id: string;
  type: EventType;
  trackId: string;
  seed: number;
  variant: EnvironmentVariant;
  targetTime: number;
  targetScore: number;
  reward: { currency: number; xp: number; unlock?: string };
}
export interface VehicleConfig {
  id: string;
  displayName: string;
  baseSpeed: number;
  acceleration: number;
  grip: number;
  nitroPower: number;
  nitroCapacity: number;
  mass: number;
  upgradeSlots: string[];
  cosmeticOptions: string[];
}
export interface VehicleUpgrade {
  id: string;
  slot: string;
  name: string;
  cost: number;
  level: number;
  maxLevel: number;
}
export type ControlMode = 'keyboard' | 'touch' | 'tilt';
export type CameraMode = 'chase' | 'hood' | 'cinematic';
export type GamePhase = 'menu' | 'countdown' | 'racing' | 'paused' | 'results';
export type QualityPreset = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export interface QualitySettings {
  preset: QualityPreset;
  adaptiveEnabled: boolean;
  resolutionScale: number;
  pixelRatio: number;
  shadows: boolean;
  antiAliasing: boolean;
  textureQuality: 'low' | 'medium' | 'high';
  particleBudget: number;
  propDensity: number;
  postProcessing: boolean;
}
export interface SaveData {
  schemaVersion: number;
  careerProgress: Record<string, number>;
  completedEvents: string[];
  currency: number;
  xp: number;
  ownedVehicles: string[];
  selectedVehicle: string;
  upgradeLevels: Record<string, number>;
  cosmetics: Record<string, string>;
  bestTimes: Record<string, number>;
  bestScores: Record<string, number>;
  settings: QualitySettings;
}

export const GAME_PHASES = ['menu', 'countdown', 'racing', 'paused', 'results'] as const;
export const QUALITY_PRESETS = ['auto', 'low', 'medium', 'high', 'ultra'] as const;
export const CONTROL_MODES = ['keyboard', 'touch', 'tilt'] as const;
export const CAMERA_MODES = ['chase', 'hood', 'cinematic'] as const;
export const EVENT_TYPES = ['race', 'timeAttack', 'drift', 'nitro'] as const;
