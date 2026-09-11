import { describe, expect, it } from 'vitest';
import {
  COOLDOWN_FRAMES,
  createCollisionState,
  resolveCollisions,
  type CollisionBody,
} from '../src/simulation/CollisionSystem';
import type { ObstacleConfig } from '../src/types';

it('separates overlapping cars without damage state', () => {
  const cars = [
    { id:'a', position:{x:0,y:0,z:0}, radius:1, velocity:{x:0,y:0,z:0}, speed:10 },
    { id:'b', position:{x:1,y:0,z:0}, radius:1, velocity:{x:0,y:0,z:0}, speed:10 }
  ];
  const report = resolveCollisions(cars, []);
  expect(report.impacts).toBeGreaterThan(0);
  expect(cars[0]!.position.x).toBeLessThan(cars[1]!.position.x);
});

function car(id: string, x: number, z: number, vx: number, vz: number, radius = 1): CollisionBody {
  return { id, position: { x, y: 0, z }, radius, velocity: { x: vx, y: 0, z: vz }, speed: Math.hypot(vx, vz) };
}

describe('resolveCollisions', () => {
  it('exchanges velocity along the contact normal and loses speed', () => {
    const cars = [car('vx-a', 0, 0, 10, 0), car('vx-b', 1, 0, -10, 0)];
    const before = cars.reduce((sum, c) => sum + c.speed, 0);
    const report = resolveCollisions(cars, []);
    const after = cars.reduce((sum, c) => sum + c.speed, 0);
    expect(report.impacts).toBe(1);
    expect(cars[0]!.velocity.x).toBeLessThan(0);
    expect(cars[1]!.velocity.x).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    expect(cars[0]!.speed).toBeCloseTo(Math.hypot(cars[0]!.velocity.x, cars[0]!.velocity.z), 6);
    expect(report.events[0]!.magnitude).toBeGreaterThan(0);
  });

  it('leaves separated cars untouched', () => {
    const cars = [car('sep-a', 0, 0, 5, 0), car('sep-b', 10, 0, 0, 5)];
    const snapshot = JSON.parse(JSON.stringify(cars));
    const report = resolveCollisions(cars, []);
    expect(report.impacts).toBe(0);
    expect(report.events).toHaveLength(0);
    expect(cars).toEqual(snapshot);
  });

  it('re-impacts the same pair only after the pair cooldown', () => {
    const state = createCollisionState();
    const overlapping = () => [car('cd-a', 0, 0, 0, 0), car('cd-b', 1, 0, 0, 0)];
    expect(resolveCollisions(overlapping(), [], state).impacts).toBe(1);
    expect(resolveCollisions(overlapping(), [], state).impacts).toBe(0);
    let reimpactedAt = -1;
    for (let i = 0; i < COOLDOWN_FRAMES + 4; i++) {
      if (resolveCollisions(overlapping(), [], state).impacts > 0) {
        reimpactedAt = i;
        break;
      }
    }
    expect(reimpactedAt).toBeGreaterThanOrEqual(0);
    expect(reimpactedAt).toBeLessThanOrEqual(COOLDOWN_FRAMES);
  });

  it('keeps cooldowns per state so separate two-argument calls do not share them', () => {
    const overlapping = () => [car('two-a', 0, 0, 0, 0), car('two-b', 1, 0, 0, 0)];
    expect(resolveCollisions(overlapping(), []).impacts).toBe(1);
    expect(resolveCollisions(overlapping(), []).impacts).toBe(1);
    const state = createCollisionState();
    expect(resolveCollisions(overlapping(), [], state).impacts).toBe(1);
    expect(resolveCollisions(overlapping(), [], state).impacts).toBe(0);
  });

  it('applies a directional speed penalty and lateral push for obstacles', () => {
    const carBody = car('ob-a', 0, 1, 10, 0);
    const obstacle: ObstacleConfig = { position: { x: 1.5, y: 0, z: 0 }, radius: 1, type: 'barrier' };
    const report = resolveCollisions([carBody], [obstacle]);
    expect(report.impacts).toBeGreaterThan(0);
    expect(carBody.speed).toBeLessThan(10);
    expect(carBody.position.z).toBeGreaterThan(1);
  });

  it('penalizes a head-on hit harder than a glancing contact', () => {
    const headOn = car('ob-b', 0, 0, 10, 0);
    const glancing = car('ob-c', 0, 1.3, 10, 0);
    const obstacle: ObstacleConfig = { position: { x: 1.5, y: 0, z: 0 }, radius: 1, type: 'cone' };
    const reach = glancing.radius + obstacle.radius;
    const contact = Math.hypot(glancing.position.x - obstacle.position.x, glancing.position.z - obstacle.position.z);
    expect(contact).toBeLessThan(reach);
    resolveCollisions([headOn, glancing], [obstacle]);
    expect(headOn.speed).toBeLessThan(10);
    expect(glancing.speed).toBeLessThan(10);
    expect(headOn.speed).toBeLessThan(glancing.speed);
  });

  it('never overlaps the obstacle after separation', () => {
    const carBody = car('ob-d', 0.5, 0, 10, 0);
    const obstacle: ObstacleConfig = { position: { x: 1.5, y: 0, z: 0 }, radius: 1, type: 'cone' };
    resolveCollisions([carBody], [obstacle]);
    const dist = Math.hypot(carBody.position.x - obstacle.position.x, carBody.position.z - obstacle.position.z);
    expect(dist).toBeGreaterThanOrEqual(carBody.radius + obstacle.radius - 1e-9);
  });

  it('is deterministic for identical fresh inputs', () => {
    const run = (suffix: string) => {
      const cars = [car(`det-${suffix}-a`, 0, 0, 6, 0), car(`det-${suffix}-b`, 1.2, 0, 0, 4)];
      const report = resolveCollisions(cars, []);
      return {
        report: { impacts: report.impacts, magnitudes: report.events.map((e) => e.magnitude) },
        cars: (JSON.parse(JSON.stringify(cars)) as CollisionBody[]).map(
          (body: CollisionBody) => ({ position: body.position, radius: body.radius, velocity: body.velocity, speed: body.speed }),
        ),
      };
    };
    const first = run('1');
    const second = run('2');
    expect(first.report).toEqual(second.report);
    expect(first.cars).toEqual(second.cars);
  });

  it('carries no health or damage fields anywhere', () => {
    const cars = [car('det-a', 0, 0, 6, 0), car('det-b', 1.2, 0, 0, 4)];
    const report = resolveCollisions(cars, []);
    expect('health' in report).toBe(false);
    expect('damage' in report).toBe(false);
    for (const event of report.events) {
      expect(Object.keys(event)).toEqual(['a', 'b', 'magnitude']);
    }
    for (const body of cars) {
      expect('health' in body).toBe(false);
      expect('damage' in body).toBe(false);
    }
  });
});
