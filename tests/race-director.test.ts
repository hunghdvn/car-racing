import { describe, expect, it } from 'vitest';
import { EventRunner } from '../src/race/EventRunner';
import { RaceDirector } from '../src/race/RaceDirector';
import type { EventConfig } from '../src/types';

it('advances from countdown to racing', () => {
  const director = new RaceDirector({ laps:3, event: { type:'race' } } as never);
  director.start([], null as never, null as never);
  director.update(4, []);
  expect(director.phase).toBe('racing');
});

it('ranks finished cars before active cars', () => {
  const director = new RaceDirector({ laps:3, event: { type:'race' } } as never);
  const ranks = director.rankVehicles([
    { id:'a', progress:2, finished:true, finishTime:20 },
    { id:'b', progress:3, finished:false }
  ] as never);
  expect(ranks[0].id).toBe('a');
});

const track = { length: 400, checkpointDistances: [100, 200, 300] };

function racingDirector(): RaceDirector {
  const director = new RaceDirector({ laps: 3, event: { type: 'race' } });
  director.start([{ id: 'a', distance: 0 }], track, null);
  director.update(4, []);
  return director;
}

function drive(director: RaceDirector, distance: number) {
  return director.update(1, [{ id: 'a', distance }]);
}

describe('RaceDirector countdown and laps', () => {
  it('stays in countdown until the full countdown has elapsed', () => {
    const director = new RaceDirector({ laps: 3, event: { type: 'race' } });
    director.start([], null, null);
    expect(director.update(1, []).phase).toBe('countdown');
    expect(director.update(1.5, []).phase).toBe('countdown');
    expect(director.update(1, []).phase).toBe('racing');
  });

  it('counts a lap only after crossing the start line forward through every checkpoint', () => {
    const director = racingDirector();
    expect(drive(director, 100.1).notifications).toHaveLength(0);
    expect(drive(director, 200.1).notifications).toHaveLength(0);
    expect(drive(director, 300.1).notifications).toHaveLength(0);
    expect(drive(director, 0.5).notifications).toContainEqual({ type: 'lap', id: 'a', lap: 1 });
    expect(drive(director, 399.5).notifications).toHaveLength(0);
    expect(drive(director, 0.5).notifications).toHaveLength(0);
    expect(drive(director, 100.1).notifications).toHaveLength(0);
    expect(drive(director, 200.1).notifications).toHaveLength(0);
    expect(drive(director, 300.1).notifications).toHaveLength(0);
    expect(drive(director, 0.5).notifications).toContainEqual({ type: 'lap', id: 'a', lap: 2 });
  });

  it('does not count a lap crossed without passing the checkpoints', () => {
    const director = racingDirector();
    expect(drive(director, 399.9).notifications).toHaveLength(0);
    const update = drive(director, 0.05);
    expect(update.notifications).toHaveLength(0);
    expect(update.standings[0]?.progress).toBeLessThan(1);
  });

  it('finishes the car and the race when the required laps are completed', () => {
    const director = new RaceDirector({ event: { type: 'race', requiredLaps: 1 } });
    director.start([{ id: 'a', distance: 0 }], track, null);
    director.update(4, []);
    drive(director, 100.1);
    drive(director, 200.1);
    drive(director, 300.1);
    const update = drive(director, 0.5);
    expect(update.phase).toBe('results');
    expect(update.notifications).toContainEqual({ type: 'finish', id: 'a', position: 1, time: 5 });
    expect(update.standings[0]?.finished).toBe(true);
    expect(update.standings[0]?.finishTime).toBe(5);
  });

  it('marks a vehicle finished at the current race time via finish', () => {
    const director = racingDirector();
    expect(director.time).toBe(1);
    director.finish('a');
    const update = director.update(1, [{ id: 'a', distance: 0 }]);
    expect(update.standings[0]?.finished).toBe(true);
    expect(update.standings[0]?.finishTime).toBe(1);
  });

  it('restarts without retaining stale state', () => {
    const director = new RaceDirector({ event: { type: 'race', requiredLaps: 1 } });
    director.start([{ id: 'a', distance: 0 }], track, null);
    director.update(4, []);
    drive(director, 100.1);
    drive(director, 200.1);
    drive(director, 300.1);
    drive(director, 0.5);
    expect(director.phase).toBe('results');
    director.start([{ id: 'a', distance: 0 }], track, null);
    expect(director.phase).toBe('countdown');
    expect(director.time).toBe(0);
    director.update(4, []);
    const update = drive(director, 100.1);
    expect(update.standings[0]?.finished).toBe(false);
    expect(update.notifications).toHaveLength(0);
  });

  it('ranks active cars by progress and finished cars by time', () => {
    const director = new RaceDirector({ laps: 3, event: { type: 'race' } });
    const ranks = director.rankVehicles([
      { id: 'a', progress: 1.2, finished: false },
      { id: 'b', progress: 1.9, finished: false },
      { id: 'c', progress: 0.4, finished: true, finishTime: 40 },
      { id: 'd', progress: 0.4, finished: true, finishTime: 30 },
    ]);
    expect(ranks.map((rank) => rank.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(ranks[0]?.position).toBe(1);
    expect(ranks[3]?.position).toBe(4);
  });
});

describe('EventRunner', () => {
  const base: EventConfig = {
    id: 'event-1',
    type: 'race',
    trackId: 'track-1',
    requiredLaps: 3,
    targetTime: 90,
    targetScore: 5000,
    reward: { currency: 100, xp: 50, unlock: 'vehicle-2' },
  };

  it('rewards first place in a race and penalizes other placements', () => {
    const first = EventRunner.evaluate({ ...base, type: 'race' }, { position: 1, finishTime: 120 });
    expect(first.passed).toBe(true);
    expect(first.reward).toEqual({ currency: 100, xp: 50, unlock: 'vehicle-2' });
    expect(first.bestMetric).toBe('time');
    const second = EventRunner.evaluate(base, { position: 2, finishTime: 125 });
    expect(second.passed).toBe(false);
    expect(second.score).toBe(75);
    expect(second.reward).toEqual({ currency: 0, xp: 0 });
  });

  it('passes a time attack only at or under the target time', () => {
    const attack = { ...base, type: 'timeAttack' as const, targetTime: 60 };
    expect(EventRunner.evaluate(attack, { finishTime: 55 }).passed).toBe(true);
    expect(EventRunner.evaluate(attack, { finishTime: 65 }).passed).toBe(false);
    expect(EventRunner.evaluate(attack, {}).passed).toBe(false);
  });

  it('passes a drift challenge when the drift score reaches the target', () => {
    const drift = { ...base, type: 'drift' as const, targetScore: 5000 };
    const passed = EventRunner.evaluate(drift, { driftScore: 5200 });
    expect(passed.passed).toBe(true);
    expect(passed.score).toBe(5200);
    expect(passed.bestMetric).toBe('score');
    expect(EventRunner.evaluate(drift, { driftScore: 4900 }).passed).toBe(false);
  });

  it('scores a nitro challenge from nitro use and top speed', () => {
    const nitro = { ...base, type: 'nitro' as const, targetScore: 80 };
    const full = EventRunner.evaluate(nitro, { nitroUsed: 1, topSpeedRatio: 1 });
    expect(full.score).toBe(100);
    expect(full.passed).toBe(true);
    const half = EventRunner.evaluate(nitro, { nitroUsed: 0.5, topSpeedRatio: 0.5 });
    expect(half.score).toBe(50);
    expect(half.passed).toBe(false);
  });
});
