import type { AIProfile } from '../simulation/AIController';

export type { AIProfile } from '../simulation/AIController';

export const aiProfiles: AIProfile[] = [
  { id: 'cadet', targetSpeed: 42, aggression: 0.35, laneBias: -0.4, reactionTime: 0.35 },
  { id: 'rider', targetSpeed: 44, aggression: 0.5, laneBias: 0, reactionTime: 0.28 },
  { id: 'veteran', targetSpeed: 46, aggression: 0.65, laneBias: 0.3, reactionTime: 0.22 },
  { id: 'ace', targetSpeed: 48, aggression: 0.8, laneBias: -0.2, reactionTime: 0.16 },
  { id: 'phantom', targetSpeed: 50, aggression: 0.95, laneBias: 0.1, reactionTime: 0.12 },
];

export const aiProfileIds: readonly string[] = aiProfiles.map((profile) => profile.id);

export function resolveAiField(loadout: readonly string[] | undefined): AIProfile[] {
  if (!loadout || loadout.length !== aiProfiles.length) return [...aiProfiles];
  const field = loadout.map((id) => aiProfiles.find((profile) => profile.id === id));
  return field.every((profile): profile is AIProfile => profile !== undefined) ? field : [...aiProfiles];
}
