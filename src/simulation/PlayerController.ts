import type { ControlMode } from '../types';
import type { ControlInput } from './Vehicle';

export interface KeyboardInput {
  keys: Readonly<Record<string, boolean>>;
}

export interface TouchInput {
  gas: boolean;
  brake: boolean;
  steerLeft: boolean;
  steerRight: boolean;
  drift: boolean;
  nitro: boolean;
}

export interface TiltInput {
  beta: number;
  gamma: number;
}

export type InputSource = KeyboardInput | TouchInput | TiltInput;

export interface PlayerController {
  readonly mode: ControlMode;
  setInput(source: KeyboardInput): void;
  setInput(source: TouchInput): void;
  setInput(source: TiltInput): void;
  setMode(mode: ControlMode): void;
  calibrate(): void;
  reset(): void;
  sample(now?: number): ControlInput;
}

const TILT_DEAD_ZONE = 8;
const TILT_STEER_RANGE = 45;
const TILT_SMOOTHING = 8;
const TILT_FIRST_RESPONSE_MS = 50;
const BETA_PEDAL_RANGE = 45;
const BETA_NEUTRAL = 90;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampSign(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function anyKey(keys: Record<string, boolean>, names: string[]): boolean {
  return names.some((name) => Boolean(keys[name]));
}

export function createPlayerController(mode: ControlMode): PlayerController {
  let active = mode;
  const keys: Record<string, boolean> = {};
  const touch: TouchInput = { ...zeroTouch() };
  let tilt: TiltInput = { beta: BETA_NEUTRAL, gamma: 0 };
  let gammaOffset = 0;
  let betaOffset = 0;
  let smoothedSteer = 0;
  let lastSampleAt: number | null = null;

  function zeroTouch(): TouchInput {
    return { gas: false, brake: false, steerLeft: false, steerRight: false, drift: false, nitro: false };
  }

  function keyboardInput(): ControlInput {
    const up = anyKey(keys, ['KeyW', 'ArrowUp']);
    const down = anyKey(keys, ['KeyS', 'ArrowDown']);
    const left = anyKey(keys, ['KeyA', 'ArrowLeft']);
    const right = anyKey(keys, ['KeyD', 'ArrowRight']);
    return {
      throttle: up ? 1 : 0,
      brake: down ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      drift: Boolean(keys['Space']),
      nitro: anyKey(keys, ['ShiftLeft', 'ShiftRight']),
    };
  }

  function touchInput(): ControlInput {
    return {
      throttle: touch.gas ? 1 : 0,
      brake: touch.brake ? 1 : 0,
      steer: (touch.steerRight ? 1 : 0) - (touch.steerLeft ? 1 : 0),
      drift: touch.drift,
      nitro: touch.nitro,
    };
  }

  function tiltSteerTarget(): number {
    const raw = tilt.gamma - gammaOffset;
    if (raw > TILT_DEAD_ZONE) {
      return clampSign((raw - TILT_DEAD_ZONE) / (TILT_STEER_RANGE - TILT_DEAD_ZONE));
    }
    if (raw < -TILT_DEAD_ZONE) {
      return clampSign((raw + TILT_DEAD_ZONE) / (TILT_STEER_RANGE - TILT_DEAD_ZONE));
    }
    return 0;
  }

  function tiltInput(now: number): ControlInput {
    const dt = lastSampleAt === null ? TILT_FIRST_RESPONSE_MS / 1000 : (now - lastSampleAt) / 1000;
    lastSampleAt = now;
    const target = tiltSteerTarget();
    if (dt > 0) {
      const response = 1 - Math.exp(-TILT_SMOOTHING * dt);
      smoothedSteer += (target - smoothedSteer) * response;
    } else {
      smoothedSteer = target;
    }
    const pitch = tilt.beta - BETA_NEUTRAL - betaOffset;
    return {
      throttle: pitch < -TILT_DEAD_ZONE ? clamp01((-pitch - TILT_DEAD_ZONE) / BETA_PEDAL_RANGE) : 0,
      brake: pitch > TILT_DEAD_ZONE ? clamp01((pitch - TILT_DEAD_ZONE) / BETA_PEDAL_RANGE) : 0,
      steer: smoothedSteer,
      drift: false,
      nitro: false,
    };
  }

  return {
    get mode() {
      return active;
    },
    setInput(source: InputSource) {
      if ('keys' in source) {
        for (const [name, down] of Object.entries(source.keys)) {
          keys[name] = down;
        }
      } else if ('beta' in source) {
        tilt = { beta: source.beta, gamma: source.gamma };
      } else {
        Object.assign(touch, source);
      }
    },
    setMode(next: ControlMode) {
      if (next === active) return;
      active = next;
      lastSampleAt = null;
    },
    calibrate() {
      gammaOffset = tilt.gamma;
      betaOffset = tilt.beta - BETA_NEUTRAL;
    },
    reset() {
      for (const name of Object.keys(keys)) delete keys[name];
      Object.assign(touch, zeroTouch());
      tilt = { beta: BETA_NEUTRAL, gamma: 0 };
      gammaOffset = 0;
      betaOffset = 0;
      smoothedSteer = 0;
      lastSampleAt = null;
    },
    sample(now: number = typeof performance !== 'undefined' ? performance.now() : 0): ControlInput {
      if (active === 'keyboard') return keyboardInput();
      if (active === 'touch') return touchInput();
      return tiltInput(now);
    },
  };
}
