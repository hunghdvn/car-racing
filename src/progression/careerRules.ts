import { upgradeCost, upgradeDefinitions } from '../config/vehicles';
import type { SaveData, VehicleConfig, VehicleUpgrade } from '../types';

export const upgradeKey = (vehicleId: string, slot: string): string => `${vehicleId}:${slot}`;

export function clampUpgradeLevel(level: number, maxLevel: number): number {
  return Number.isFinite(level) ? Math.min(maxLevel, Math.max(0, Math.floor(level))) : 0;
}

export function resolveVehicleUpgrades(vehicle: VehicleConfig, save: SaveData): VehicleUpgrade[] {
  return vehicle.upgradeSlots.flatMap((slot) => {
    const definition = upgradeDefinitions[slot];
    if (!definition) return [];
    const level = clampUpgradeLevel(save.upgradeLevels[upgradeKey(vehicle.id, slot)] ?? 0, definition.maxLevel);
    return [
      {
        id: upgradeKey(vehicle.id, slot),
        slot,
        name: definition.name,
        cost: upgradeCost(slot, level),
        level,
        maxLevel: definition.maxLevel,
      },
    ];
  });
}