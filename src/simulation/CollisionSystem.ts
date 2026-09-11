import type { ObstacleConfig, Vec3 } from '../types';

export interface CollisionBody {
  id: string;
  position: Vec3;
  radius: number;
  velocity: Vec3;
  speed: number;
}

export interface CollisionEvent {
  a: string;
  b: string;
  magnitude: number;
}

export interface CollisionReport {
  impacts: number;
  events: CollisionEvent[];
}

export const COOLDOWN_FRAMES = 30;

const SPEED_LOSS = 0.08;
const OBSTACLE_PENALTY = 0.4;
const OBSTACLE_PUSH = 0.5;

let frame = 0;
const cooldownUntil = new Map<string, number>();

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function obstacleKey(index: number, id: string): string {
  return `o${index}|${id}`;
}

export function resolveCollisions(
  vehicles: CollisionBody[],
  obstacles: ObstacleConfig[],
): CollisionReport {
  frame += 1;
  const events: CollisionEvent[] = [];

  for (let i = 0; i < vehicles.length; i++) {
    const a = vehicles[i]!;
    for (let j = i + 1; j < vehicles.length; j++) {
      const b = vehicles[j]!;
      const dist = Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z);
      const overlap = a.radius + b.radius - dist;
      if (overlap <= 0) continue;
      const nx = dist > 1e-6 ? (b.position.x - a.position.x) / dist : 1;
      const nz = dist > 1e-6 ? (b.position.z - a.position.z) / dist : 0;
      const push = overlap / 2;
      a.position.x -= nx * push;
      a.position.z -= nz * push;
      b.position.x += nx * push;
      b.position.z += nz * push;
      const key = pairKey(a.id, b.id);
      const until = cooldownUntil.get(key);
      if (until !== undefined && until >= frame) continue;
      const avn = a.velocity.x * nx + a.velocity.z * nz;
      const bvn = b.velocity.x * nx + b.velocity.z * nz;
      const exchange = bvn - avn;
      a.velocity.x += exchange * nx;
      a.velocity.z += exchange * nz;
      b.velocity.x -= exchange * nx;
      b.velocity.z -= exchange * nz;
      const keep = 1 - SPEED_LOSS;
      a.velocity.x *= keep;
      a.velocity.z *= keep;
      b.velocity.x *= keep;
      b.velocity.z *= keep;
      a.speed = Math.hypot(a.velocity.x, a.velocity.z);
      b.speed = Math.hypot(b.velocity.x, b.velocity.z);
      cooldownUntil.set(key, frame + COOLDOWN_FRAMES);
      events.push({ a: a.id, b: b.id, magnitude: Math.abs(exchange) + overlap });
    }
  }

  for (let i = 0; i < vehicles.length; i++) {
    const car = vehicles[i]!;
    for (let o = 0; o < obstacles.length; o++) {
      const obstacle = obstacles[o]!;
      const dx = car.position.x - obstacle.position.x;
      const dz = car.position.z - obstacle.position.z;
      const dist = Math.hypot(dx, dz);
      const overlap = car.radius + obstacle.radius - dist;
      if (overlap <= 0) continue;
      const nx = dist > 1e-6 ? dx / dist : 1;
      const nz = dist > 1e-6 ? dz / dist : 0;
      car.position.x += nx * overlap;
      car.position.z += nz * overlap;
      const key = obstacleKey(o, car.id);
      const until = cooldownUntil.get(key);
      if (until !== undefined && until >= frame) continue;
      const speed = Math.hypot(car.velocity.x, car.velocity.z);
      let magnitude = overlap;
      if (speed > 1e-6) {
        const vx = car.velocity.x / speed;
        const vz = car.velocity.z / speed;
        const facing = Math.min(1, Math.max(0, -(vx * nx + vz * nz)));
        const penalty = OBSTACLE_PENALTY * facing;
        car.velocity.x *= 1 - penalty;
        car.velocity.z *= 1 - penalty;
        const leftX = vz;
        const leftZ = -vx;
        const side = nx * leftX + nz * leftZ;
        car.position.x += leftX * side * OBSTACLE_PUSH;
        car.position.z += leftZ * side * OBSTACLE_PUSH;
        car.speed = Math.hypot(car.velocity.x, car.velocity.z);
        magnitude += speed * facing;
      }
      cooldownUntil.set(key, frame + COOLDOWN_FRAMES);
      events.push({ a: car.id, b: `obstacle:${o}`, magnitude });
    }
  }

  return { impacts: events.length, events };
}
