import { NITRO, VEHICLE } from '../config'
import { clamp01 } from '../util'
import type { InputState } from '../core/Input'
import { REST_CMD, VehiclePhysics, type CarEvents, type DriveCommand } from './VehiclePhysics'
import type { TrackProbe } from './TrackProbe'

/* ------------------------------------------------------------------------- *
 * The player drive layer: input -> drive command, the nitro economy
 * (activate/drain; charge from drift, clean running and airtime; drift-chain
 * bonus; shortcut bonus hook for the Race Director), and the respawn policy
 * (sink/out-of-corridor/stuck -> blackout -> snap to nearest centreline with
 * heading). Pure sim: no scene objects, fully headless-testable.
 * ------------------------------------------------------------------------- */

export class PlayerVehicle {
  readonly phys: VehiclePhysics
  /** live drive command of the last update (visual binding reads it) */
  readonly cmd: DriveCommand = { ...REST_CMD }
  nitroVal: number = NITRO.startValue
  nitroActive = false
  /** > 0 while blackout; car frozen, camera may dim */
  respawnT = 0
  /** events of the last update (Game consumes once per frame) */
  events: CarEvents = { impact: 0, landed: 0, launched: 0 }
  private stuckT = 0
  private driftT = 0
  private driftCool = 0
  private chainAwarded = false
  private nitroCool = 0
  private respawnFromS = 0

  constructor(private probe: TrackProbe) {
    this.phys = new VehiclePhysics(probe)
  }

  /** immediate placement on the centreline (grid, tests, harness spawn) */
  resetTo(s: number, speed = 0): void {
    const c = this.probe.centerPose(s)
    this.phys.resetAt(c.x, c.z, c.yaw, speed)
    this.respawnT = 0
    this.stuckT = 0
    this.driftT = 0
    this.chainAwarded = false
    this.cmd.throttle = this.cmd.brake = this.cmd.steer = 0
    this.cmd.handbrake = this.cmd.nitro = false
  }

  requestRespawn(): void {
    if (this.respawnT > 0) return
    this.respawnT = VEHICLE.respawnTime
    this.respawnFromS = this.phys.s
    this.nitroActive = false
    this.cmd.throttle = this.cmd.brake = this.cmd.steer = 0
    this.cmd.handbrake = false
  }

  /** true while the blackout holds (camera may blank the car) */
  get respawning(): boolean { return this.respawnT > 0 }

  addShortcutBonus(): void { this.nitroVal = Math.min(NITRO.max, this.nitroVal + NITRO.bonusShortcut) }

  update(dt: number, input: InputState): void {
    const V = VEHICLE
    const p = this.phys

    if (this.respawnT > 0) {
      this.respawnT -= dt
      if (this.respawnT <= 0) {
        const c = this.probe.centerPose(this.respawnFromS)
        p.resetAt(c.x, c.z, c.yaw, 0)
        this.stuckT = 0
      }
      // blackout: nothing drives, nothing integrates
      this.events = { impact: 0, landed: 0, launched: 0 }
      return
    }
    if (p.sunk || p.outside) this.requestRespawn()

    const speed = p.speed

    /* stuck on a barrier/kerb with throttle pinned -> auto respawn */
    if (speed < V.stuckSpeed && input.throttle > 0.6) {
      this.stuckT += dt
      if (this.stuckT > V.stuckTime) this.requestRespawn()
    } else this.stuckT = 0

    /* --- nitro state machine --- */
    if (this.nitroActive) {
      this.nitroVal -= NITRO.drainPerSec * dt
      if (this.nitroVal <= 0 || !input.nitro) {
        this.nitroActive = false
        this.nitroCool = V.nitroOffCool
        this.nitroVal = Math.max(0, this.nitroVal)
      }
    } else {
      this.nitroCool = Math.max(0, this.nitroCool - dt)
      if (input.nitro && this.nitroCool <= 0 && this.nitroVal >= NITRO.minToActivate) this.nitroActive = true
    }

    /* --- charge economy --- */
    const slipAbs = Math.abs(p.slip)
    const driftingEff = p.grounded && speed > V.driftTriggerSpeed && slipAbs > V.driftMinSlip
    if (driftingEff) {
      this.nitroVal += NITRO.chargeDriftPerSec * dt
      this.driftT += dt
      this.driftCool = V.driftEndGrace
      if (!this.chainAwarded && this.driftT >= V.driftChainHold) {
        this.nitroVal += NITRO.bonusPerDriftChain
        this.chainAwarded = true
      }
    } else {
      this.driftCool -= dt
      if (this.driftCool <= 0) { this.driftT = 0; this.chainAwarded = false }
      if (p.grounded && p.onRoad && !this.nitroActive && speed > 20) this.nitroVal += NITRO.chargeCleanPerSec * dt
    }
    if (!p.grounded && p.airTime > 0.25) this.nitroVal += NITRO.bonusRampAirPerSec * dt
    this.nitroVal = Math.min(NITRO.max, Math.max(0, this.nitroVal))

    /* --- drive --- */
    this.cmd.throttle = this.nitroActive ? Math.max(input.throttle, 0.75) : input.throttle
    this.cmd.brake = input.brake * (p.forwardSpeed > 0.5 || input.throttle < 0.05 ? 1 : 0)
    this.cmd.steer = input.steer
    this.cmd.handbrake = input.handbrake
    this.cmd.nitro = this.nitroActive

    p.step(dt, this.cmd)
    this.events = p.consumeEvents()
  }

  /** normalised 0..1 nitro for HUD/flames */
  get nitroLevel(): number { return clamp01(this.nitroVal / NITRO.max) }
}
