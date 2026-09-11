import type { ObstacleConfig, Vec3 } from '../types';
import { VEHICLE_MAX_DELTA, type ControlInput, type VehicleState } from './Vehicle';

export interface AIProfile {
  id: string;
  targetSpeed: number;
  aggression: number;
  laneBias: number;
  reactionTime: number;
}

export interface RivalProbe {
  position: Vec3;
  heading: number;
  speed: number;
}

export interface AITrackProbe {
  config: { width: number };
  length: number;
  project(position: Vec3, hint?: number): {
    distance: number;
    lateral: number;
    sample: { point: Vec3 };
  };
  sampleAt(distance: number): {
    point: Vec3;
    tangent: Vec3;
    left: Vec3;
    distance: number;
    curvature: number;
  };
}

const BASE_LOOKAHEAD = 8;
const STEER_GAIN = 1.6;
const MAX_STEER_ANGLE = 0.9;
const CURVE_SPEED_FACTOR = 2.5;
const MIN_CURVE_SPEED = 0.45;
const RIVAL_RANGE = 34;
const RIVAL_LATERAL = 5;
const OBSTACLE_RANGE = 42;
const OBSTACLE_LINE = 3.2;
const OBSTACLE_URGENCY_RANGE = 16;
const OBSTACLE_URGENCY_FACTOR = 0.85;
const BRAKE_MARGIN = 1.06;
const NITRO_MIN = 15;
const NITRO_AGGRESSION = 0.65;
const NITRO_MAX_CURVATURE = 0.045;
const NITRO_MAX_ERROR = 0.25;
const NITRO_MIN_SPEED = 15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clampSign(value: number): number {
  const result = clamp(value, -1, 1);
  return result === 0 ? 0 : result;
}

function wrapAngle(angle: number): number {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function skillFactor(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash % 1000) / 1000;
}

function aheadBy(track: AITrackProbe, from: number, to: number): number {
  const delta = (((to - from) % track.length) + track.length) % track.length;
  return delta > track.length / 2 ? delta - track.length : delta;
}

function curveSpeedFactor(curvature: number): number {
  return clamp(1 - curvature * CURVE_SPEED_FACTOR, MIN_CURVE_SPEED, 1);
}

function avoidance(
  track: AITrackProbe,
  vehicle: VehicleState,
  carDistance: number,
  carLateral: number,
  rivals: RivalProbe[],
  obstacles: ObstacleConfig[],
  profile: AIProfile,
): { offset: number; urgent: boolean } {
  const halfWidth = track.config.width / 2;
  let offset = profile.laneBias * halfWidth * 0.7;
  let urgent = false;
  for (const rival of rivals) {
    const rivalProjection = track.project(rival.position);
    const delta = aheadBy(track, carDistance, rivalProjection.distance);
    if (delta <= 0 || delta > RIVAL_RANGE) continue;
    if (Math.abs(rivalProjection.lateral - carLateral) >= RIVAL_LATERAL) continue;
    if (rival.speed >= vehicle.speed) continue;
    offset += rivalProjection.lateral > carLateral ? -halfWidth * 0.5 : halfWidth * 0.5;
  }
  for (const obstacle of obstacles) {
    const obstacleProjection = track.project(obstacle.position);
    const delta = aheadBy(track, carDistance, obstacleProjection.distance);
    if (delta <= 0 || delta > OBSTACLE_RANGE) continue;
    if (delta <= OBSTACLE_URGENCY_RANGE) urgent = true;
    const clearance = OBSTACLE_LINE + obstacle.radius;
    if (Math.abs(obstacleProjection.lateral - carLateral) < clearance) {
      offset += obstacleProjection.lateral > carLateral ? -clearance : clearance;
    }
  }
  return { offset: clamp(offset, -halfWidth * 0.9, halfWidth * 0.9), urgent };
}

export function createAIControl(
  vehicle: VehicleState,
  track: AITrackProbe | null,
  rivals: RivalProbe[],
  obstacles: ObstacleConfig[],
  profile: AIProfile,
  delta: number,
): ControlInput {
  const step = clamp(delta, 0, VEHICLE_MAX_DELTA);
  const skill = skillFactor(profile.id);
  const steerGain = STEER_GAIN * (0.92 + 0.16 * skill);
  const target = profile.targetSpeed * (0.97 + 0.06 * skill);

  let steer = 0;
  let speedTarget = target;
  let nitro = false;

  if (track) {
    const projection = track.project(vehicle.position);
    const lookahead = BASE_LOOKAHEAD + vehicle.speed * (profile.reactionTime + step);
    const ahead = track.sampleAt(projection.distance + lookahead);
    const { offset, urgent } = avoidance(track, vehicle, projection.distance, projection.lateral, rivals, obstacles, profile);
    const targetPoint = {
      x: ahead.point.x + ahead.left.x * offset,
      y: ahead.point.y,
      z: ahead.point.z + ahead.left.z * offset,
    };
    const desired = Math.atan2(targetPoint.x - vehicle.position.x, targetPoint.z - vehicle.position.z);
    const error = wrapAngle(desired - vehicle.heading);
    steer = clampSign((-error / MAX_STEER_ANGLE) * steerGain);
    speedTarget = target * curveSpeedFactor(ahead.curvature);
    if (urgent) speedTarget *= OBSTACLE_URGENCY_FACTOR;
    nitro =
      profile.aggression >= NITRO_AGGRESSION &&
      ahead.curvature < NITRO_MAX_CURVATURE &&
      Math.abs(error) < NITRO_MAX_ERROR &&
      vehicle.speed > NITRO_MIN_SPEED &&
      vehicle.nitro >= NITRO_MIN;
  }

  const throttle =
    vehicle.speed < speedTarget ? clamp01(1 - (vehicle.speed / speedTarget) * 0.6) : 0;
  const brake =
    vehicle.speed > speedTarget * BRAKE_MARGIN
      ? clamp01((vehicle.speed - speedTarget * BRAKE_MARGIN) / Math.max(speedTarget * 0.5, 1))
      : 0;

  return { throttle, brake, steer, drift: false, nitro };
}
