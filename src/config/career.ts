import type { EventConfig } from '../types';

export interface CareerCup {
  id: string;
  displayName: string;
  unlockAfterCupId: string | null;
  events: EventConfig[];
}

export const careerCups: CareerCup[] = [
  {
    id: 'cup-1',
    displayName: 'Rookie Cup',
    unlockAfterCupId: null,
    events: [
      {
        id: 'cup-1-event-1',
        type: 'race',
        trackId: 'city',
        requiredLaps: 3,
        targetTime: 75,
        targetScore: 75,
        reward: { currency: 100, xp: 10 },
      },
      {
        id: 'cup-1-event-2',
        type: 'timeAttack',
        trackId: 'city',
        requiredLaps: 1,
        targetTime: 30,
        targetScore: 100,
        reward: { currency: 100, xp: 10 },
      },
      {
        id: 'cup-1-event-3',
        type: 'drift',
        trackId: 'coast',
        requiredLaps: 1,
        targetTime: 45,
        targetScore: 200,
        reward: { currency: 120, xp: 12, unlock: 'swift' },
      },
      {
        id: 'cup-1-event-4',
        type: 'nitro',
        trackId: 'coast',
        requiredLaps: 1,
        targetTime: 40,
        targetScore: 70,
        reward: { currency: 120, xp: 12 },
      },
      {
        id: 'cup-1-event-5',
        type: 'race',
        trackId: 'city',
        requiredLaps: 3,
        targetTime: 70,
        targetScore: 75,
        reward: { currency: 150, xp: 15, unlock: 'vector' },
      },
    ],
  },
  {
    id: 'cup-2',
    displayName: 'Street Cup',
    unlockAfterCupId: 'cup-1',
    events: [
      {
        id: 'cup-2-event-1',
        type: 'timeAttack',
        trackId: 'coast',
        requiredLaps: 1,
        targetTime: 40,
        targetScore: 100,
        reward: { currency: 150, xp: 15 },
      },
      {
        id: 'cup-2-event-2',
        type: 'race',
        trackId: 'mountain',
        requiredLaps: 3,
        targetTime: 110,
        targetScore: 75,
        reward: { currency: 150, xp: 15 },
      },
      {
        id: 'cup-2-event-3',
        type: 'drift',
        trackId: 'city',
        requiredLaps: 1,
        targetTime: 45,
        targetScore: 220,
        reward: { currency: 180, xp: 18, unlock: 'tempest' },
      },
      {
        id: 'cup-2-event-4',
        type: 'nitro',
        trackId: 'mountain',
        requiredLaps: 1,
        targetTime: 60,
        targetScore: 75,
        reward: { currency: 180, xp: 18 },
      },
      {
        id: 'cup-2-event-5',
        type: 'race',
        trackId: 'coast',
        requiredLaps: 3,
        targetTime: 95,
        targetScore: 75,
        reward: { currency: 200, xp: 20, unlock: 'phantom' },
      },
    ],
  },
  {
    id: 'cup-3',
    displayName: 'Neon Cup',
    unlockAfterCupId: 'cup-2',
    events: [
      {
        id: 'cup-3-event-1',
        type: 'race',
        trackId: 'mountain',
        requiredLaps: 3,
        targetTime: 110,
        targetScore: 75,
        reward: { currency: 200, xp: 20 },
      },
      {
        id: 'cup-3-event-2',
        type: 'timeAttack',
        trackId: 'city',
        requiredLaps: 1,
        targetTime: 28,
        targetScore: 100,
        reward: { currency: 220, xp: 22 },
      },
      {
        id: 'cup-3-event-3',
        type: 'drift',
        trackId: 'mountain',
        requiredLaps: 1,
        targetTime: 60,
        targetScore: 320,
        reward: { currency: 250, xp: 25 },
      },
      {
        id: 'cup-3-event-4',
        type: 'nitro',
        trackId: 'city',
        requiredLaps: 1,
        targetTime: 40,
        targetScore: 80,
        reward: { currency: 250, xp: 25, unlock: 'apex' },
      },
      {
        id: 'cup-3-event-5',
        type: 'race',
        trackId: 'mountain',
        requiredLaps: 3,
        targetTime: 100,
        targetScore: 75,
        reward: { currency: 300, xp: 30 },
      },
    ],
  },
];

export function cupById(id: string): CareerCup | undefined {
  return careerCups.find((cup) => cup.id === id);
}

export function eventLocation(eventId: string): { cup: CareerCup; event: EventConfig } | undefined {
  for (const cup of careerCups) {
    const event = cup.events.find((candidate) => candidate.id === eventId);
    if (event) return { cup, event };
  }
  return undefined;
}

export function isCupUnlockedFor(cups: readonly CareerCup[], completedEventIds: readonly string[], cupId: string): boolean {
  const cup = cups.find((candidate) => candidate.id === cupId);
  if (!cup) return false;
  if (cup.unlockAfterCupId === null) return true;
  const gate = cups.find((candidate) => candidate.id === cup.unlockAfterCupId);
  if (!gate) return false;
  return gate.events.every((event) => completedEventIds.includes(event.id));
}

export function isEventUnlockedFor(
  cups: readonly CareerCup[],
  completedEventIds: readonly string[],
  cupId: string,
  eventId: string,
): boolean {
  if (!isCupUnlockedFor(cups, completedEventIds, cupId)) return false;
  const cup = cups.find((candidate) => candidate.id === cupId);
  if (!cup) return false;
  let open = true;
  for (const event of cup.events) {
    if (event.id === eventId) return open;
    if (!completedEventIds.includes(event.id)) open = false;
  }
  return false;
}
