import type { VehicleConfig } from '../types';

export interface UpgradeDefinition {
  name: string;
  maxLevel: number;
  baseCost: number;
  costStep: number;
}

export const upgradeSlots = ['engine', 'acceleration', 'grip', 'nitro'] as const;

export const upgradeDefinitions: Record<string, UpgradeDefinition> = {
  engine: { name: 'Engine', maxLevel: 3, baseCost: 150, costStep: 75 },
  acceleration: { name: 'Acceleration', maxLevel: 3, baseCost: 120, costStep: 60 },
  grip: { name: 'Grip', maxLevel: 3, baseCost: 100, costStep: 50 },
  nitro: { name: 'Nitro', maxLevel: 3, baseCost: 180, costStep: 90 },
};

export const vehicles: VehicleConfig[] = [
  {
    id: 'starter',
    displayName: 'Neon Starter',
    baseSpeed: 48,
    acceleration: 14,
    grip: 0.8,
    nitroPower: 10,
    nitroCapacity: 100,
    mass: 1,
    upgradeSlots: ['engine', 'acceleration', 'grip', 'nitro'],
    cosmeticOptions: ['paint-starter-silver', 'paint-starter-red', 'wheels-starter-steel'],
  },
  {
    id: 'swift',
    displayName: 'Volt Swift',
    baseSpeed: 54,
    acceleration: 18,
    grip: 0.9,
    nitroPower: 12,
    nitroCapacity: 110,
    mass: 1.05,
    upgradeSlots: ['engine', 'acceleration', 'nitro'],
    cosmeticOptions: ['paint-swift-yellow', 'paint-swift-cyan', 'wheels-swift-sport'],
  },
  {
    id: 'vector',
    displayName: 'Vector GT',
    baseSpeed: 58,
    acceleration: 16,
    grip: 0.95,
    nitroPower: 14,
    nitroCapacity: 120,
    mass: 1.1,
    upgradeSlots: ['engine', 'grip', 'nitro'],
    cosmeticOptions: ['paint-vector-purple', 'paint-vector-lime', 'wheels-vector-turbine'],
  },
  {
    id: 'tempest',
    displayName: 'Tempest RS',
    baseSpeed: 63,
    acceleration: 15,
    grip: 1,
    nitroPower: 16,
    nitroCapacity: 130,
    mass: 1.15,
    upgradeSlots: ['acceleration', 'grip', 'nitro'],
    cosmeticOptions: ['paint-tempest-orange', 'paint-tempest-teal', 'wheels-tempest-carbon'],
  },
  {
    id: 'phantom',
    displayName: 'Night Phantom',
    baseSpeed: 67,
    acceleration: 17,
    grip: 1.05,
    nitroPower: 18,
    nitroCapacity: 140,
    mass: 1.2,
    upgradeSlots: ['engine', 'acceleration', 'grip'],
    cosmeticOptions: ['paint-phantom-black', 'paint-phantom-violet', 'wheels-phantom-ghost'],
  },
  {
    id: 'apex',
    displayName: 'Apexion',
    baseSpeed: 72,
    acceleration: 19,
    grip: 1.1,
    nitroPower: 20,
    nitroCapacity: 150,
    mass: 1.25,
    upgradeSlots: ['engine', 'acceleration', 'grip', 'nitro'],
    cosmeticOptions: ['paint-apex-gold', 'paint-apex-magenta', 'wheels-apex-maglev'],
  },
];

export interface CosmeticValue {
  body?: number;
  rim?: number;
}

export const cosmeticValues: Record<string, CosmeticValue> = {
  'paint-starter-silver': { body: 0xd7e1ec },
  'paint-starter-red': { body: 0xff4d4d },
  'wheels-starter-steel': { rim: 0xc7d3e0 },
  'paint-swift-yellow': { body: 0xffd166 },
  'paint-swift-cyan': { body: 0x22d3ee },
  'wheels-swift-sport': { rim: 0xffd166 },
  'paint-vector-purple': { body: 0x9d4edd },
  'paint-vector-lime': { body: 0xb6ff2e },
  'wheels-vector-turbine': { rim: 0xb6ff2e },
  'paint-tempest-orange': { body: 0xff7847 },
  'paint-tempest-teal': { body: 0x2dd4bf },
  'wheels-tempest-carbon': { rim: 0x39404d },
  'paint-phantom-black': { body: 0x171c26 },
  'paint-phantom-violet': { body: 0xa855f7 },
  'wheels-phantom-ghost': { rim: 0x6fe3ff },
  'paint-apex-gold': { body: 0xffc53d },
  'paint-apex-magenta': { body: 0xff3df2 },
  'wheels-apex-maglev': { rim: 0xffc53d },
};

export function vehicleById(id: string): VehicleConfig | undefined {
  return vehicles.find((vehicle) => vehicle.id === id);
}

export function upgradeCost(slot: string, currentLevel: number): number {
  const definition = upgradeDefinitions[slot];
  if (!definition) return Number.POSITIVE_INFINITY;
  return definition.baseCost + definition.costStep * currentLevel;
}

export function applyUpgrades(config: VehicleConfig, levels: Record<string, number>): VehicleConfig {
  const level = (slot: string): number => Math.max(0, Math.floor(levels[`${config.id}:${slot}`] ?? 0));
  return {
    ...config,
    baseSpeed: config.baseSpeed * (1 + 0.05 * level('engine')),
    acceleration: config.acceleration * (1 + 0.08 * level('acceleration')),
    grip: config.grip * (1 + 0.06 * level('grip')),
    nitroPower: config.nitroPower * (1 + 0.1 * level('nitro')),
  };
}
