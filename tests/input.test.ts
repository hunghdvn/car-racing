import { describe, expect, it } from 'vitest';
import { createPlayerController } from '../src/simulation/PlayerController';

const zeroTouch = { gas: false, brake: false, steerLeft: false, steerRight: false, drift: false, nitro: false };

describe('createPlayerController', () => {
  it('maps keyboard up and left to throttle and steering', () => {
    const controller = createPlayerController('keyboard');
    controller.setInput({ keys: { ArrowUp: true, ArrowLeft: true } });
    expect(controller.sample()).toEqual({ throttle: 1, brake: 0, steer: -1, drift: false, nitro: false });

    controller.setInput({ keys: { KeyW: true, KeyA: true } });
    expect(controller.sample()).toEqual({ throttle: 1, brake: 0, steer: -1, drift: false, nitro: false });

    controller.setInput({ keys: { ArrowUp: false, KeyW: false } });
    const released = controller.sample();
    expect(released.throttle).toBe(0);
    expect(released.steer).toBe(-1);
  });

  it('maps keyboard brake, drift and nitro keys', () => {
    const controller = createPlayerController('keyboard');
    controller.setInput({ keys: { KeyS: true, Space: true, ShiftLeft: true } });
    expect(controller.sample()).toEqual({ throttle: 0, brake: 1, steer: 0, drift: true, nitro: true });
  });

  it('maps touch gas, brake and steer button state', () => {
    const controller = createPlayerController('touch');
    controller.setInput({ ...zeroTouch, gas: true, steerRight: true });
    expect(controller.sample()).toEqual({ throttle: 1, brake: 0, steer: 1, drift: false, nitro: false });

    controller.setInput({ ...zeroTouch, brake: true, drift: true, nitro: true });
    expect(controller.sample()).toEqual({ throttle: 0, brake: 1, steer: 0, drift: true, nitro: true });
  });

  it('ignores tilt inside the dead zone', () => {
    const controller = createPlayerController('tilt');
    controller.setInput({ beta: 90, gamma: 6 });
    expect(controller.sample()).toEqual({ throttle: 0, brake: 0, steer: 0, drift: false, nitro: false });
  });

  it('applies smoothed tilt steering outside the dead zone', () => {
    const controller = createPlayerController('tilt');
    controller.setInput({ beta: 90, gamma: 45 });
    const first = controller.sample(0);
    expect(first.steer).toBeGreaterThan(0);
    expect(first.steer).toBeLessThan(0.5);

    let last = first;
    for (let i = 1; i <= 5; i++) {
      last = controller.sample(i * 100);
    }
    expect(last.steer).toBeGreaterThan(0.9);
    expect(last.steer).toBeLessThan(1);
  });

  it('uses the calibration offset as the tilt center', () => {
    const controller = createPlayerController('tilt');
    controller.setInput({ beta: 90, gamma: 20 });
    controller.calibrate();
    expect(controller.sample(0).steer).toBe(0);

    controller.setInput({ beta: 90, gamma: 65 });
    expect(controller.sample(100).steer).toBeGreaterThan(0);
  });

  it('maps phone tilt forward and back to throttle and brake', () => {
    const controller = createPlayerController('tilt');
    controller.setInput({ beta: 45, gamma: 0 });
    const forward = controller.sample(0);
    expect(forward.throttle).toBeGreaterThan(0.7);
    expect(forward.brake).toBe(0);

    controller.setInput({ beta: 135, gamma: 0 });
    const back = controller.sample(100);
    expect(back.brake).toBeGreaterThan(0.7);
    expect(back.throttle).toBe(0);
  });

  it('switches the active source when the mode changes', () => {
    const controller = createPlayerController('keyboard');
    expect(controller.mode).toBe('keyboard');
    controller.setInput({ keys: { ArrowUp: true } });
    expect(controller.sample(0).throttle).toBe(1);

    controller.setMode('touch');
    expect(controller.mode).toBe('touch');
    expect(controller.sample(100).throttle).toBe(0);

    controller.setInput({ ...zeroTouch, gas: true });
    expect(controller.sample(200).throttle).toBe(1);
  });
});
