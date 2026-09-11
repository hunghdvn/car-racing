import type { AIProfile } from '../simulation/AIController';

export type { AIProfile } from '../simulation/AIController';

export const aiProfiles: AIProfile[] = [
  { id: 'cadet', targetSpeed: 34, aggression: 0.35, laneBias: -0.4, reactionTime: 0.35 },
  { id: 'rider', targetSpeed: 37, aggression: 0.5, laneBias: 0, reactionTime: 0.28 },
  { id: 'veteran', targetSpeed: 40, aggression: 0.65, laneBias: 0.3, reactionTime: 0.22 },
  { id: 'ace', targetSpeed: 43, aggression: 0.8, laneBias: -0.2, reactionTime: 0.16 },
  { id: 'phantom', targetSpeed: 46, aggression: 0.95, laneBias: 0.1, reactionTime: 0.12 },
];
