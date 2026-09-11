import type { Vec3, VehicleConfig } from '../types';

export interface VehicleState {
  position: Vec3;
  heading: number;
  velocity: Vec3;
  speed: number;
  nitro: number;
  driftScore: number;
  offroad: boolean;
  finished: boolean;
}

export interface ControlInput {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
  nitro: boolean;
}

export interface TrackProbe {
  config: { width: number };
  project(position: Vec3, hint?: number): {
    distance: number;
    lateral: number;
    sample: { point: Vec3 };
  };
}

export const VEHICLE_MAX_DELTA = 0.05;

const STEER_RATE = 2.4;
const STEER_MIN_SPEED = 8;
const DRAG_COEF = 0.0018;
const OFFROAD_EXTRA_DRAG = 0.02;
const OFFROAD_GRIP_FACTOR = 0.6;
const BRAKE_DECEL = 28;
const GRIP_RATE = 10;
const DRIFT_GRIP_FACTOR = 0.3;
const DRIFT_MIN_SPEED = 6;
const DRIFT_SCORE_RATE = 1.5;
const NITRO_DRAIN = 12;
const NITRO_SPEED_FACTOR = 1.3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function headingForward(heading: number): Vec3 {
  return { x: Math.sin(heading), y: 0, z: Math.cos(heading) };
}

function headingLeft(heading: number): Vec3 {
  return { x: Math.cos(heading), y: 0, z: -Math.sin(heading) };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function integrateVehicle(
  state: VehicleState,
  config: VehicleConfig,
  input: ControlInput,
  track: TrackProbe | null,
  delta: number,
): VehicleState {
  const d = clamp(delta, 0, VEHICLE_MAX_DELTA);

  let offroad = false;
  let groundY = state.position.y;
  if (track) {
    const projection = track.project(state.position);
    offroad = Math.abs(projection.lateral) > track.config.width / 2;
    groundY = projection.sample.point.y;
  }

  const forward = headingForward(state.heading);
  const vLength = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
  const velocity: Vec3 =
    vLength < state.speed * 0.5 && state.speed > 0
      ? { x: forward.x * state.speed, y: 0, z: forward.z * state.speed }
      : { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z };

  const nitroActive = input.nitro && state.nitro > 0 && input.throttle > 0;
  const maxSpeed = config.baseSpeed * (nitroActive ? NITRO_SPEED_FACTOR : 1);

  const thrust =
    (config.acceleration * input.throttle + (nitroActive ? config.nitroPower : 0)) /
    config.mass;
  const steerFactor = clamp(Math.abs(dot(velocity, forward)) / STEER_MIN_SPEED, 0, 1);
  const heading = state.heading + input.steer * STEER_RATE * steerFactor * d;
  const nextForward = headingForward(heading);
  const nextLeft = headingLeft(heading);

  let speed = dot(velocity, nextForward);
  const dragCoef = offroad ? DRAG_COEF + OFFROAD_EXTRA_DRAG : DRAG_COEF;
  speed += (thrust - BRAKE_DECEL * input.brake - dragCoef * speed * Math.abs(speed)) * d;
  speed = clamp(speed, 0, maxSpeed);

  const grip =
    config.grip * (input.drift ? DRIFT_GRIP_FACTOR : 1) * (offroad ? OFFROAD_GRIP_FACTOR : 1);
  const lateral = dot(velocity, nextLeft) * Math.max(0, 1 - grip * GRIP_RATE * d);

  let driftScore = state.driftScore;
  if (input.drift && speed > DRIFT_MIN_SPEED) {
    driftScore += DRIFT_SCORE_RATE * Math.abs(lateral) * d;
  }

  const nitro = clamp(
    nitroActive ? state.nitro - NITRO_DRAIN * d : state.nitro,
    0,
    config.nitroCapacity,
  );

  const outVelocity: Vec3 = {
    x: nextForward.x * speed + nextLeft.x * lateral,
    y: 0,
    z: nextForward.z * speed + nextLeft.z * lateral,
  };
  const outSpeed = Math.hypot(outVelocity.x, outVelocity.z);
  if (outSpeed > maxSpeed) {
    const scale = maxSpeed / outSpeed;
    outVelocity.x *= scale;
    outVelocity.z *= scale;
  }

  return {
    position: {
      x: state.position.x + outVelocity.x * d,
      y: groundY,
      z: state.position.z + outVelocity.z * d,
    },
    heading,
    velocity: outVelocity,
    speed: Math.min(outSpeed, maxSpeed),
    nitro,
    driftScore,
    offroad,
    finished: state.finished,
  };
}
