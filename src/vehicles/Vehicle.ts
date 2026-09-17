import type * as THREE from 'three'
import type { CarModel } from '../assets/CarModel'
import { VEHICLE } from '../config'
import type { VehiclePhysics, DriveCommand } from './VehiclePhysics'

/* ------------------------------------------------------------------------- *
 * Mesh-binding layer: drives the CarModel handles from physics telemetry —
 * wheel spin (integrated from true forward speed), front steering (derived
 * from yaw rate, so a drift reads as counter-steer), per-wheel suspension
 * travel (jounce under load, droop in the air — the Phase-2 owed item),
 * body pitch/roll/lean, brake lights and nitro flames. Frozen Debug poses
 * go through applyPoseVisual, which sets every visual explicitly so shots
 * stay deterministic regardless of what the sim did before the capture.
 * ------------------------------------------------------------------------- */

const WHEEL_BASE_Y = VEHICLE.wheelRadius - 0.012
const TRAVEL = VEHICLE.suspTravel + 0.02 // visual clamp envelope

/** explicit static visual state for frozen shots */
export interface PoseVisual {
  pos: [number, number, number]
  yaw: number
  pitch: number
  bank: number
  speed: number
  nitro?: number
  brakeGlow?: number
  wheelSteer?: number
  susp?: number
  lean?: number
  air?: boolean
}

const clampSym = (v: number, lim: number): number => (v < -lim ? -lim : v > lim ? lim : v)

export class VehicleVisual {
  private spin = 0
  private brakeAfter = 0

  constructor(private car: CarModel) {
    car.setHeadlights(false)
  }

  /** live binding from physics (drive mode) */
  bind(dt: number, v: VehiclePhysics, cmd: DriveCommand, nitroLevel: number): void {
    const R = VEHICLE.wheelRadius
    this.spin += (v.forwardSpeed / R) * dt
    if (!Number.isFinite(this.spin)) this.spin = 0
    const steerA = v.steerVis
    for (let i = 0; i < this.car.wheels.length; i++) {
      const w = this.car.wheels[i]
      const root: THREE.Object3D = w.steer ?? w.spin.parent ?? w.spin
      root.rotation.y = w.front ? steerA : 0
      root.position.y = WHEEL_BASE_Y + clampSym(v.susp[i], TRAVEL)
      w.spin.rotation.x = -this.spin
    }
    const g = this.car.group
    g.position.set(v.x, v.y, v.z)
    g.rotation.order = 'YXZ'
    g.rotation.set(v.pitch, v.yaw, v.roll)
    // brake lights with a short release afterglow
    this.brakeAfter = cmd.brake > this.brakeAfter ? cmd.brake : Math.max(0, this.brakeAfter - dt * 2.6)
    this.car.setBrake(this.brakeAfter)
    this.car.setNitro(nitroLevel)
  }

  /** frozen-shot binding: every visual explicit, no physics required */
  applyPoseVisual(p: PoseVisual): void {
    const spinA = -p.speed * 0.09
    const susp = p.susp ?? (p.air ? VEHICLE.suspDroop : 0)
    for (const w of this.car.wheels) {
      const root: THREE.Object3D = w.steer ?? w.spin.parent ?? w.spin
      root.rotation.y = w.front ? p.wheelSteer ?? 0 : 0
      root.position.y = WHEEL_BASE_Y + susp
      w.spin.rotation.x = spinA
    }
    const g = this.car.group
    g.position.set(...p.pos)
    g.rotation.order = 'YXZ'
    g.rotation.set(p.pitch, p.yaw, p.bank + (p.lean ?? 0))
    this.car.setBrake(p.brakeGlow ?? (p.speed > 30 ? Math.min(0.32, p.speed / 160 + 0.08) : 0))
    this.car.setNitro(p.nitro ?? 0)
  }
}

/** derive wheel counter-steer + body lean for a slip-held drift shot */
export function poseFromSlip(slip: number): { wheelSteer: number; lean: number } {
  return {
    wheelSteer: clampSym(-slip * 0.85, VEHICLE.steerMaxRad),
    lean: slip * 0.16,
  }
}
