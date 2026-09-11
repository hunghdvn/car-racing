import { describe, expect, it } from 'vitest';
import {
  createAIControl,
  type AITrackProbe,
  type AIProfile,
  type RivalProbe,
} from '../src/simulation/AIController';
import { aiProfiles } from '../src/config/ai';
import type { ObstacleConfig, Vec3 } from '../src/types';
import type { VehicleState } from '../src/simulation/Vehicle';

it('steers toward the lookahead racing line', () => {
  const control = createAIControl(
    { position: {x:0,y:0,z:0}, heading:0, velocity:{x:0,y:0,z:0}, speed:20, nitro:100, driftScore:0, offroad:false, finished:false },
    null as never, [], [], { id:'ai-1', targetSpeed:35, aggression:0.5, laneBias:0, reactionTime:0.2 }, 1
  );
  expect(control.steer).toBeTypeOf('number');
  expect(control.throttle).toBeGreaterThanOrEqual(0);
});

function carAt(speed: number, overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
    velocity: { x: 0, y: 0, z: speed },
    speed,
    nitro: 100,
    driftScore: 0,
    offroad: false,
    finished: false,
    ...overrides,
  };
}

function straightTrack(curvature = 0, width = 12, length = 1000): AITrackProbe {
  return {
    config: { width },
    length,
    project: (position: Vec3) => ({
      distance: ((position.z % length) + length) % length,
      lateral: position.x,
      sample: { point: { x: 0, y: 0, z: position.z } },
    }),
    sampleAt: (distance: number) => ({
      point: { x: 0, y: 0, z: distance },
      tangent: { x: 0, y: 0, z: 1 },
      left: { x: 1, y: 0, z: 0 },
      distance,
      curvature,
    }),
  };
}

const profile: AIProfile = { id: 'ai-1', targetSpeed: 35, aggression: 0.5, laneBias: 0, reactionTime: 0.2 };

describe('createAIControl', () => {
  it('exports exactly five deterministic AI profiles', () => {
    expect(aiProfiles).toHaveLength(5);
    const ids = new Set(aiProfiles.map((p) => p.id));
    expect(ids.size).toBe(5);
    for (const p of aiProfiles) {
      expect(p.id).toBeTypeOf('string');
      expect(p.targetSpeed).toBeGreaterThan(0);
      expect(p.aggression).toBeGreaterThanOrEqual(0);
      expect(p.aggression).toBeLessThanOrEqual(1);
      expect(p.laneBias).toBeGreaterThanOrEqual(-1);
      expect(p.laneBias).toBeLessThanOrEqual(1);
      expect(p.reactionTime).toBeGreaterThan(0);
      expect(createAIControl(carAt(20), null as never, [], [], p, 1 / 60)).toEqual(
        createAIControl(carAt(20), null as never, [], [], p, 1 / 60),
      );
    }
  });

  it('is deterministic and never reads UI state', () => {
    const track = straightTrack();
    const first = createAIControl(carAt(25), track, [], [], profile, 1 / 60);
    const second = createAIControl(carAt(25), track, [], [], profile, 1 / 60);
    expect(first).toEqual(second);
  });

  it('bounds every input to the ranges integrateVehicle accepts', () => {
    const extreme: AITrackProbe = {
      config: { width: 12 },
      length: 1000,
      project: () => ({ distance: 0, lateral: 0, sample: { point: { x: 0, y: 0, z: 0 } } }),
      sampleAt: () => ({
        point: { x: 100, y: 0, z: 1 },
        tangent: { x: 1, y: 0, z: 0 },
        left: { x: 0, y: 0, z: -1 },
        distance: 0,
        curvature: 0.5,
      }),
    };
    const control = createAIControl(carAt(1), extreme, [], [], { ...profile, targetSpeed: 5 }, 1);
    expect(control.throttle).toBeGreaterThanOrEqual(0);
    expect(control.throttle).toBeLessThanOrEqual(1);
    expect(control.brake).toBeGreaterThanOrEqual(0);
    expect(control.brake).toBeLessThanOrEqual(1);
    expect(control.steer).toBeGreaterThanOrEqual(-1);
    expect(control.steer).toBeLessThanOrEqual(1);
    expect(control.drift).toBe(false);
    expect(control.nitro).toBeTypeOf('boolean');
  });

  it('throttles toward the profile target speed and brakes above it', () => {
    const track = straightTrack();
    const accelerating = createAIControl(carAt(15), track, [], [], profile, 1 / 60);
    expect(accelerating.throttle).toBeGreaterThan(0);
    expect(accelerating.brake).toBe(0);
    const over = createAIControl(carAt(50), track, [], [], profile, 1 / 60);
    expect(over.throttle).toBe(0);
    expect(over.brake).toBeGreaterThan(0);
  });

  it('brakes harder for tighter curvature at the same speed', () => {
    const open = createAIControl(carAt(40), straightTrack(0.005), [], [], profile, 1 / 60);
    const hairpin = createAIControl(carAt(40), straightTrack(0.3), [], [], profile, 1 / 60);
    expect(open.throttle).toBe(0);
    expect(hairpin.throttle).toBe(0);
    expect(hairpin.brake).toBeGreaterThan(open.brake);
  });

  it('shifts its lane away from a slower rival ahead', () => {
    const track = straightTrack();
    const alone = createAIControl(carAt(30), track, [], [], profile, 1 / 60);
    expect(alone.steer).toBe(0);
    const rival: RivalProbe = { position: { x: 2, y: 0, z: 25 }, heading: 0, speed: 15 };
    const dodging = createAIControl(carAt(30), track, [rival], [], profile, 1 / 60);
    expect(dodging.steer).toBeGreaterThan(0.05);
    const fasterRival: RivalProbe = { position: { x: 2, y: 0, z: 25 }, heading: 0, speed: 45 };
    const ignoring = createAIControl(carAt(30), track, [fasterRival], [], profile, 1 / 60);
    expect(ignoring.steer).toBe(0);
  });

  it('steers around an obstacle blocking the racing line', () => {
    const track = straightTrack();
    const clear = createAIControl(carAt(30), track, [], [], profile, 1 / 60);
    const cone: ObstacleConfig = { position: { x: 0, y: 0, z: 30 }, radius: 1.2, type: 'cone' };
    const dodging = createAIControl(carAt(30), track, [], [cone], profile, 1 / 60);
    expect(clear.steer).toBe(0);
    expect(dodging.steer).not.toBe(0);
    expect(dodging.steer).toBeLessThan(0);
  });

  it('reduces the target speed when an obstacle is close ahead', () => {
    const cone: ObstacleConfig = { position: { x: 0, y: 0, z: 10 }, radius: 1.2, type: 'cone' };
    const open = createAIControl(carAt(40), straightTrack(), [], [], profile, 1 / 60);
    const blocked = createAIControl(carAt(40), straightTrack(), [], [cone], profile, 1 / 60);
    expect(blocked.brake).toBeGreaterThan(open.brake);
  });

  it('applies a small deterministic skill variation per profile id', () => {
    const track = straightTrack();
    const rival: RivalProbe = { position: { x: 2, y: 0, z: 25 }, heading: 0, speed: 15 };
    const a = { id: 'skill-a', targetSpeed: 35, aggression: 0.5, laneBias: 0, reactionTime: 0.2 };
    const b = { id: 'skill-b', targetSpeed: 35, aggression: 0.5, laneBias: 0, reactionTime: 0.2 };
    const steerA = createAIControl(carAt(30), track, [rival], [], a, 1 / 60).steer;
    const steerB = createAIControl(carAt(30), track, [rival], [], b, 1 / 60).steer;
    expect(steerA).not.toBe(steerB);
  });

  it('uses the lane bias to hold a side of the track', () => {
    const track = straightTrack();
    const leftBias = { ...profile, laneBias: 1 };
    const rightBias = { ...profile, laneBias: -1 };
    expect(createAIControl(carAt(30), track, [], [], leftBias, 1 / 60).steer).toBeLessThan(0);
    expect(createAIControl(carAt(30), track, [], [], rightBias, 1 / 60).steer).toBeGreaterThan(0);
  });

  it('only spends nitro on straights for aggressive profiles', () => {
    const track = straightTrack();
    const aggressive: AIProfile = { id: 'nitro-ai', targetSpeed: 40, aggression: 0.9, laneBias: 0, reactionTime: 0.15 };
    const cautious: AIProfile = { id: 'calm-ai', targetSpeed: 40, aggression: 0.4, laneBias: 0, reactionTime: 0.15 };
    expect(createAIControl(carAt(30), track, [], [], aggressive, 1 / 60).nitro).toBe(true);
    expect(createAIControl(carAt(30), track, [], [], cautious, 1 / 60).nitro).toBe(false);
    expect(createAIControl(carAt(30), straightTrack(0.2), [], [], aggressive, 1 / 60).nitro).toBe(false);
  });
});
