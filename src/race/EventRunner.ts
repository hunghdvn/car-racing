import type { EventConfig, EventInstance } from '../types';

export type EventLike = EventConfig | EventInstance;

export interface EventState {
  position?: number;
  finishTime?: number;
  driftScore?: number;
  nitroUsed?: number;
  topSpeedRatio?: number;
}

export interface EventResult {
  passed: boolean;
  score: number;
  reward: EventConfig['reward'];
  bestMetric: 'time' | 'score';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class EventRunner {
  static evaluate(event: EventLike, state: EventState): EventResult {
    switch (event.type) {
      case 'race': {
        const position = state.position ?? 0;
        const score = position > 0 ? Math.max(0, 100 - (position - 1) * 25) : 0;
        return EventRunner.result(position === 1, score, event, 'time');
      }
      case 'timeAttack': {
        const time = state.finishTime;
        if (time === undefined || time <= 0 || event.targetTime <= 0) {
          return EventRunner.result(false, 0, event, 'time');
        }
        const score = Math.round((event.targetTime / time) * 100);
        return EventRunner.result(time <= event.targetTime, score, event, 'time');
      }
      case 'drift': {
        const score = Math.max(0, state.driftScore ?? 0);
        return EventRunner.result(score >= event.targetScore, score, event, 'score');
      }
      case 'nitro': {
        const used = clamp01(state.nitroUsed ?? 0);
        const speed = clamp01(state.topSpeedRatio ?? 0);
        const score = Math.round(used * 60 + speed * 40);
        return EventRunner.result(score >= event.targetScore, score, event, 'score');
      }
    }
  }

  private static result(
    passed: boolean,
    score: number,
    event: EventLike,
    bestMetric: 'time' | 'score',
  ): EventResult {
    return {
      passed,
      score,
      reward: passed ? event.reward : { currency: 0, xp: 0 },
      bestMetric,
    };
  }
}
