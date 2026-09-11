import * as THREE from 'three';
import type { CameraMode } from '../types';

export interface CameraRigTarget {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly heading: number;
  readonly speed?: number;
}

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 2600);

  private mode: CameraMode = 'chase';
  private readonly position = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly desiredFocus = new THREE.Vector3();
  private fov = 62;
  private fovTarget = 62;
  private shake = 0;
  private orbit = 0;
  private time = 0;
  private initialized = false;

  setMode(mode: CameraMode): void {
    this.mode = mode;
  }

  addShake(strength: number): void {
    this.shake = Math.min(1, this.shake + strength);
  }

  snap(target: CameraRigTarget): void {
    this.time = 0;
    this.orbit = 0;
    this.shake = 0;
    this.compute(target);
    this.position.copy(this.desired);
    this.lookAt.copy(this.desiredFocus);
    this.fov = this.fovTarget;
    this.place();
    this.initialized = true;
  }

  update(target: CameraRigTarget, delta: number): void {
    if (delta <= 0) return;
    this.time += delta;
    this.orbit += delta * 0.4;
    this.compute(target);
    if (!this.initialized) {
      this.position.copy(this.desired);
      this.lookAt.copy(this.desiredFocus);
      this.fov = this.fovTarget;
      this.initialized = true;
    }
    const k = 1 - Math.exp(-delta * this.smoothRate);
    this.position.lerp(this.desired, k);
    this.lookAt.lerp(this.desiredFocus, k);
    this.fov += (this.fovTarget - this.fov) * k;
    this.shake *= Math.exp(-delta * 4.5);
    const s = this.shake * 0.45;
    this.camera.position.set(
      this.position.x + Math.sin(this.time * 31.7) * Math.sin(this.time * 17.3 + 1.3) * s,
      this.position.y + Math.sin(this.time * 23.9 + 0.7) * Math.sin(this.time * 13.1 + 2.1) * s,
      this.position.z,
    );
    this.camera.lookAt(this.lookAt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  private get smoothRate(): number {
    if (this.mode === 'hood') return 14;
    if (this.mode === 'cinematic') return 2.5;
    return 6;
  }

  private compute(target: CameraRigTarget): void {
    this.point.set(target.position.x, target.position.y, target.position.z);
    this.forward.set(Math.sin(target.heading), 0, Math.cos(target.heading));
    const boost = THREE.MathUtils.clamp((target.speed ?? 0) / 80, 0, 1);
    if (this.mode === 'hood') {
      this.desired.copy(this.point).addScaledVector(this.forward, 1.15);
      this.desired.y += 1.38;
      this.desiredFocus.copy(this.point).addScaledVector(this.forward, 26);
      this.desiredFocus.y += 1.0;
      this.fovTarget = 72 + boost * 10;
    } else if (this.mode === 'cinematic') {
      this.desired.set(
        this.point.x + Math.sin(this.orbit) * 11,
        this.point.y + 4.4,
        this.point.z + Math.cos(this.orbit) * 11,
      );
      this.desiredFocus.copy(this.point);
      this.desiredFocus.y += 1.1;
      this.fovTarget = 55 + boost * 6;
    } else {
      this.desired.copy(this.point).addScaledVector(this.forward, -8.4);
      this.desired.y += 3.4;
      this.desiredFocus.copy(this.point).addScaledVector(this.forward, 7);
      this.desiredFocus.y += 1.2;
      this.fovTarget = 62 + boost * 16;
    }
  }

  private place(): void {
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }
}
