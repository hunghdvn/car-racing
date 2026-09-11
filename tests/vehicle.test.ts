import { describe, expect, it } from 'vitest';
import { VEHICLE_MAX_DELTA, integrateVehicle } from '../src/simulation/Vehicle';
import type { VehicleState } from '../src/simulation/Vehicle';
import type { VehicleConfig } from '../src/types';

const config: VehicleConfig = {
  id: 'test',
  displayName: 'Test Car',
  baseSpeed: 60,
  acceleration: 22,
  grip: 1,
  nitroPower: 18,
  nitroCapacity: 100,
  mass: 1,
  upgradeSlots: [],
  cosmeticOptions: [],
};

it('accelerates toward the configured top speed', () => {
  const state = { position: {x:0,y:0,z:0}, heading:0, velocity:{x:0,y:0,z:0}, speed:0, nitro:100, driftScore:0, offroad:false, finished:false };
  const next = integrateVehicle(state, config, { throttle:1, brake:0, steer:0, drift:false, nitro:false }, null as never, 1);
  expect(next.speed).toBeGreaterThan(0);
  expect(next.speed).toBeLessThanOrEqual(config.baseSpeed);
});

it('consumes nitro and rewards drift', () => {
  const state = { position: {x:0,y:0,z:0}, heading:0, velocity:{x:0,y:0,z:0}, speed:30, nitro:100, driftScore:0, offroad:false, finished:false };
  const next = integrateVehicle(state, config, { throttle:1, brake:0, steer:1, drift:true, nitro:true }, null as never, 1);
  expect(next.nitro).toBeLessThan(100);
  expect(next.driftScore).toBeGreaterThan(0);
});

describe('integrateVehicle', () => {
  const moving = (speed: number): VehicleState => ({
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
    velocity: { x: 0, y: 0, z: speed },
    speed,
    nitro: 100,
    driftScore: 0,
    offroad: false,
    finished: false,
  });

  it('clamps the integration delta to the maximum step', () => {
    const state = moving(30);
    const input = { throttle: 1, brake: 0, steer: 0, drift: false, nitro: false };
    const big = integrateVehicle(state, config, input, null, 10);
    const clamped = integrateVehicle(state, config, input, null, VEHICLE_MAX_DELTA);
    expect(big).toEqual(clamped);
  });

  it('is deterministic and does not mutate the input state', () => {
    const state = moving(30);
    const input = { throttle: 1, brake: 0, steer: 1, drift: true, nitro: true };
    const before = JSON.parse(JSON.stringify(state));
    const first = integrateVehicle(state, config, input, null, 1 / 120);
    const second = integrateVehicle(state, config, input, null, 1 / 120);
    expect(first).toEqual(second);
    expect(state).toEqual(before);
  });

  it('respects the configured top speed without nitro', () => {
    const state = moving(config.baseSpeed);
    const next = integrateVehicle(state, config, { throttle: 1, brake: 0, steer: 0, drift: false, nitro: false }, null, 1 / 120);
    expect(next.speed).toBeLessThanOrEqual(config.baseSpeed);
  });

  it('can exceed the top speed while nitro is active and capped above it', () => {
    const state = moving(config.baseSpeed);
    const next = integrateVehicle(state, config, { throttle: 1, brake: 0, steer: 0, drift: false, nitro: true }, null, 1 / 120);
    expect(next.speed).toBeGreaterThan(config.baseSpeed);
    expect(next.speed).toBeLessThanOrEqual(config.baseSpeed * 1.3 + 1e-9);
  });

  it('brakes faster than the quadratic drag alone', () => {
    const state = moving(30);
    const braked = integrateVehicle(state, config, { throttle: 0, brake: 1, steer: 0, drift: false, nitro: false }, null, 1 / 120);
    const coasting = integrateVehicle(state, config, { throttle: 0, brake: 0, steer: 0, drift: false, nitro: false }, null, 1 / 120);
    expect(braked.speed).toBeLessThan(30);
    expect(braked.speed).toBeLessThan(coasting.speed);
  });

  it('steers proportionally to the input sign and not while stopped', () => {
    const turning = integrateVehicle(moving(20), config, { throttle: 0, brake: 0, steer: 1, drift: false, nitro: false }, null, 1 / 120);
    expect(turning.heading).toBeGreaterThan(0);
    const turningBack = integrateVehicle(moving(20), config, { throttle: 0, brake: 0, steer: -1, drift: false, nitro: false }, null, 1 / 120);
    expect(turningBack.heading).toBeLessThan(0);
    const stopped = integrateVehicle(moving(0), config, { throttle: 0, brake: 0, steer: 1, drift: false, nitro: false }, null, 1 / 120);
    expect(stopped.heading).toBe(0);
  });

  it('detects offroad from the track projection and slows the car down', () => {
    const track = {
      config: { width: 12 },
      project: (position: { x: number; y: number; z: number }) => ({
        distance: 0,
        lateral: position.x,
        sample: { point: position },
      }),
    };
    const offroadState = moving(30);
    offroadState.position = { x: 10, y: 0, z: 0 };
    const offroad = integrateVehicle(offroadState, config, { throttle: 1, brake: 0, steer: 0, drift: false, nitro: false }, track, 1 / 120);
    const onroad = integrateVehicle(moving(30), config, { throttle: 1, brake: 0, steer: 0, drift: false, nitro: false }, track, 1 / 120);
    expect(offroad.offroad).toBe(true);
    expect(onroad.offroad).toBe(false);
    expect(offroad.speed).toBeLessThan(onroad.speed);
  });

  it('never lets speed or nitro leave their valid ranges', () => {
    const state = { ...moving(10), nitro: 1 };
    const next = integrateVehicle(state, config, { throttle: 0, brake: 1, steer: 0, drift: false, nitro: true }, null, 1 / 120);
    expect(next.speed).toBeGreaterThanOrEqual(0);
    expect(next.nitro).toBeGreaterThanOrEqual(0);
    expect(next.nitro).toBeLessThanOrEqual(config.nitroCapacity);
  });
});
