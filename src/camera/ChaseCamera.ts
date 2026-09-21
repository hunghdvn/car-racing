import * as THREE from 'three'
import { CAMERA, VEHICLE } from '../config'
import { clamp, clamp01, dampAngle, dampVec, Rand } from '../util'

export interface CarView {
  pos: THREE.Vector3
  yaw: number
  speed: number
  nitro: boolean
  drift: number
  airborne: boolean
  airHeight: number
}

/**
 * Spec §13 framing contract chase rig: hero-car framing (~30-40% of frame
 * height at rest), speed FOV, nitro pull-in, drift yaw-lag, trauma shake,
 * jump framing, pre-race orbit.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera
  mode: 'chase' | 'orbit' = 'chase'
  private curPos = new THREE.Vector3(0, 2, CAMERA.distBase)
  private curLook = new THREE.Vector3()
  private camYaw = 0
  private trauma = 0
  private orbitT = 0
  private orbitFocus = new THREE.Vector3()
  private rnd = new Rand(1337)
  orbitRadius = 7.4
  orbitHeight = 1.75

  constructor(aspect: number, existing?: THREE.PerspectiveCamera) {
    this.camera = existing ?? new THREE.PerspectiveCamera(CAMERA.fovBase, aspect, CAMERA.near, CAMERA.far)
    this.camera.rotation.order = 'YXZ'
    this.camera.near = CAMERA.near
    this.camera.far = CAMERA.far
  }

  snapTo(car: CarView): void {
    this.camYaw = car.yaw
    this.curPos.set(car.pos.x + Math.sin(car.yaw) * CAMERA.distBase, car.pos.y + CAMERA.heightBase, car.pos.z + Math.cos(car.yaw) * CAMERA.distBase)
    this.curLook.copy(car.pos)
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, Math.max(this.trauma, amount))
  }

  setOrbitFocus(p: THREE.Vector3): void { this.orbitFocus.copy(p) }

  update(dt: number, car: CarView, aspect: number): void {
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect
      this.camera.updateProjectionMatrix()
    }
    this.trauma = Math.max(0, this.trauma - this.trauma * this.trauma * CAMERA.shakeDecay * dt)
    const sp = clamp01(car.speed / VEHICLE.topSpeed)

    if (this.mode === 'orbit') {
      this.orbitT += dt * 0.22
      const r = this.orbitRadius
      const target = this.orbitFocus.clone().add(new THREE.Vector3(Math.cos(this.orbitT) * r, this.orbitHeight + Math.sin(this.orbitT * 0.6) * 0.25, Math.sin(this.orbitT) * r))
      dampVec(this.curPos, target, 3.4, dt)
      const look = this.orbitFocus.clone().add(new THREE.Vector3(0, 0.55, 0))
      dampVec(this.curLook, look, 4, dt)
      this.camera.position.copy(this.curPos)
      this.camera.lookAt(this.curLook)
      this.camera.fov = damp(this.camera.fov, 44, 4, dt)
      this.camera.updateProjectionMatrix()
      return
    }

    // drift-aware heading the camera trails behind
    const drift = clamp(car.drift, -1, 1)
    this.camYaw = dampAngle(this.camYaw, car.yaw - drift * CAMERA.maxDriftYawLag, CAMERA.yawLag, dt)
    const sinY = Math.sin(this.camYaw), cosY = Math.cos(this.camYaw)

    const dist = CAMERA.distBase + sp * CAMERA.distSpeedAdd - (car.nitro ? CAMERA.nitroPullIn : 0)
    const height = CAMERA.heightBase + sp * CAMERA.heightSpeedAdd + (car.airborne ? CAMERA.jumpHeightAdd * clamp01(car.airHeight) : 0)
    const lookAhead = CAMERA.lookAheadBase + sp * CAMERA.lookAheadSpeed

    const desired = new THREE.Vector3(
      car.pos.x + sinY * dist,
      car.pos.y + height,
      car.pos.z + cosY * dist,
    )
    // never let the camera sink under the car mid-jump
    if (car.airborne) desired.y = Math.max(desired.y, car.pos.y + 0.6)

    dampVec(this.curPos, desired, CAMERA.posLag, dt)
    const lookTarget = new THREE.Vector3(
      car.pos.x - sinY * lookAhead,
      car.pos.y + 0.45,
      car.pos.z - cosY * lookAhead,
    )
    dampVec(this.curLook, lookTarget, CAMERA.posLag * 1.35, dt)

    const t2 = this.trauma * this.trauma
    const shakeX = (this.rnd.next() - 0.5) * CAMERA.maxShake * t2
    const shakeY = (this.rnd.next() - 0.5) * CAMERA.maxShake * t2
    this.camera.position.set(this.curPos.x + shakeX, this.curPos.y + shakeY, this.curPos.z)
    this.camera.up.set(Math.sin(this.camera.position.x * 3.1 + this.rnd.next()) * 0.03 * t2, 1, 0)
    this.camera.lookAt(this.curLook)

    const fov = CAMERA.fovBase + sp * CAMERA.fovSpeedAdd + (car.nitro ? CAMERA.fovNitroAdd : 0) + Math.abs(drift) * 3
    this.camera.fov = damp(this.camera.fov, fov, 5.5, dt)
    this.camera.updateProjectionMatrix()
  }
}

const damp = (a: number, b: number, l: number, dt: number): number => a + (b - a) * (1 - Math.exp(-l * dt))
