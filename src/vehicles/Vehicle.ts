import type * as THREE from 'three'
import type { CarModel } from '../assets/CarModel'
import { VEHICLE, WHEEL_SINK } from '../config'
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
  /* per-wheel spin accumulators — real-car rigs (real-car-models spec) give
   * each corner its own radius, so spin integrates dist/R per wheel; with the
   * procedural builder's uniform radius this is the shipped single-R formula
   * term-for-term (same operation order, so shots stay bit-identical). */
  private spin: number[] = []
  private brakeAfter = 0

  constructor(private car: CarModel) {
    car.setHeadlights(false)
    this.spin = new Array<number>(car.wheels.length).fill(0)
  }

  /** live binding from physics (drive mode) */
  bind(dt: number, v: VehiclePhysics, cmd: DriveCommand, nitroLevel: number): void {
    const steerA = v.steerVis
    for (let i = 0; i < this.car.wheels.length; i++) {
      const w = this.car.wheels[i]
      const root: THREE.Object3D = w.steer ?? w.spin.parent ?? w.spin
      root.rotation.y = w.front ? steerA : 0
      // hub height rides on THIS wheel: real rigs carry the measured hub
      // (radius is max(dy,dz)/2 — a tread-dominant corner would otherwise
      // sink the hub 20-40 mm the moment the sim takes over, PR #21 r3);
      // procedural wheels have no hubY and keep R − WHEEL_SINK term-for-term,
      // so their shots stay bit-identical.
      const R = w.radius > 0 ? w.radius : VEHICLE.wheelRadius
      root.position.y = (w.hubY ?? R - WHEEL_SINK) + clampSym(v.susp[i], TRAVEL)
      this.spin[i] = (this.spin[i] ?? 0) + (v.forwardSpeed / R) * dt
      if (!Number.isFinite(this.spin[i])) this.spin[i] = 0
      w.spin.rotation.x = -this.spin[i]
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
      const R = w.radius > 0 ? w.radius : VEHICLE.wheelRadius // per-corner, see bind()
      root.position.y = (w.hubY ?? R - WHEEL_SINK) + susp
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

/**
 * Live-frame binding of the whole AI field, gated on the race director:
 * before a race starts no field binds at all, so a car group keeps its
 * deterministic constructor park pose instead of being overwritten with a
 * stale off-grid physics position. Same gate as stepAIField — the live loop
 * and the parked field can never disagree.
 */
export function bindAIFieldVisuals(
  dt: number, gate: { fieldActive(): boolean },
  ai: readonly { phys: VehiclePhysics; cmd: DriveCommand; nitroLevel: number }[],
  visuals: readonly VehicleVisual[],
): void {
  if (!gate.fieldActive()) return
  for (let i = 0; i < ai.length; i++) visuals[i].bind(dt, ai[i].phys, ai[i].cmd, ai[i].nitroLevel)
}
