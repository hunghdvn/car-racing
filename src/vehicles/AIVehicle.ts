import * as THREE from 'three'
import { AI, NITRO, SEED, TRACK, VEHICLE } from '../config'
import { clamp, clamp01, damp, Rand, wrapPi } from '../util'
import type { CarView } from '../camera/ChaseCamera'
import type { PlanarFrame, TrackSpline } from '../world/TrackSpline'
import { REST_CMD, VehiclePhysics, type CarEvents, type DriveCommand } from './VehiclePhysics'
import type { TrackProbe } from './TrackProbe'

/* ------------------------------------------------------------------------- *
 * The spline AI brain (spec §24A): one allocation-free look-ahead frame of
 * the shared deterministic spline feeds the whole controller — the heading +
 * lateral error against a curvature-cut racing line produce the steer law
 * (steerK/headingK with fixed unit scales), and the peak curvature across the
 * braking window (brakeLookaheadTime / minLookaheadDist) produces the
 * curvature-aware speed target through cornerLatAccel. On top of the line:
 * seeded per-car pace + lane bias, rubber-band around the leader, spacing
 * avoidance with hysteresis against close rivals, draft when boxed in, and a
 * stuck/off-corridor recovery that re-joins the circuit inside the configured
 * stuck timeout. Pure sim (no scene objects, no wall-clock): every decision
 * derives from the seeded Rand + spline state, so the same seed replays the
 * same race bit-for-bit. Mirrors the PlayerVehicle surface (phys/cmd/nitro/
 * events/resetTo/update) so Game and RaceDirector treat six cars uniformly.
 * ------------------------------------------------------------------------- */

/** what an AI peer needs to know about another competitor */
export interface RivalView {
  phys: VehiclePhysics
  /** current commanded racing lane of the rival (targetLat), if driven by an AI */
  targetLat?: number
}

/** per-step race context the director feeds every AI car */
export interface AIContext {
  /** true until the countdown reaches GO — command path held at rest */
  locked: boolean
  /** 0..1 race completion of the field leader (rubber-band reference) */
  leaderProgress: number
  /** 0..1 completion of this car (rubber-band subject) */
  progress: number
}

/** deterministic per-slot seed stream rooted at the master SEED */
export function aiSlotSeed(slot: number): number {
  return (SEED ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0
}

const HW = TRACK.halfWidth
const CURV_EPS = 1e-4
/** commanded lane may not aim past the barrier clamp envelope */
const LANE_CAP = HW - 1.2

/** deterministic frozen state of one AI car (shot + replay verification) */
export interface AIStaticSnapshot {
  slot: number
  pace: number
  bias: number
  x: number; y: number; z: number; yaw: number
  vx: number; vy: number; vz: number
  speed: number; slip: number; drift: number
  s: number; lat: number; time: number
  nitroVal: number; nitroActive: boolean
  recoveries: number
  targetLat: number; targetSpeed: number
}

export class AIVehicle {
  readonly phys: VehiclePhysics
  /** live drive command of the last update (visual binding reads it) */
  readonly cmd: DriveCommand = { ...REST_CMD }
  /** ChaseCamera/HUD view — one instance per car, reused every step */
  readonly view: CarView = { pos: new THREE.Vector3(), yaw: 0, speed: 0, nitro: false, drift: 0, airborne: false, airHeight: 0 }
  nitroVal: number = NITRO.startValue
  nitroActive = false
  /** events of the last update (Game consumes once per frame) */
  events: CarEvents = { impact: 0, landed: 0, launched: 0 }
  /** recovery bookkeeping (tests + HUD) */
  recoveries = 0
  /** > 0 while the recovery hold parks the car on the lane */
  recoverHold = 0
  /** telemetry of the last update */
  targetSpeed = 0
  targetLat = 0
  blocked = false
  drafting = false

  private readonly pace: number
  private readonly bias: number
  private readonly rnd: Rand
  private readonly pf: PlanarFrame = { x: 0, z: 0, yaw: 0, sideX: 0, sideZ: 0, curv: 0 }
  private laneOffset = 0
  private laneHold = 0
  private stuckT = 0
  private nitroCool = 0
  private recoverCooldown = 0
  /** time the car has spent below stuckSpeed since it last moved (tests) */
  stuckClock = 0

  constructor(readonly slot: number, private spline: TrackSpline, private probe: TrackProbe) {
    this.rnd = new Rand(aiSlotSeed(slot))
    this.pace = clamp(AI.paceBase + this.rnd.range(-1, 1) * AI.paceSpread, 0.5, 1.2)
    this.bias = this.rnd.range(-1, 1) * AI.laneBias
    this.phys = new VehiclePhysics(probe, aiSlotSeed(slot + 64))
  }

  /** normalised 0..1 nitro for flames/HUD */
  get nitroLevel(): number { return clamp01(this.nitroVal / AI.nitroMax) }

  /** place the car on the racing lane (grid slots, tests, recovery) */
  resetTo(s: number, lat: number, speed = 0): void {
    const c = this.probe.lanePose(s, lat)
    this.phys.resetAt(c.x, c.z, c.yaw, speed)
    this.phys.reseed(aiSlotSeed(this.slot + 64))
    this.cmd.throttle = this.cmd.brake = this.cmd.steer = 0
    this.cmd.handbrake = this.cmd.nitro = false
    this.nitroActive = false
    this.nitroVal = NITRO.startValue
    this.stuckT = 0
    this.stuckClock = 0
    this.laneOffset = 0
    this.laneHold = 0
    this.targetLat = lat
    this.targetSpeed = 0
    this.recoveries = 0
    this.recoverHold = 0
    this.recoverCooldown = 0
    this.events = { impact: 0, landed: 0, launched: 0 }
    this.refreshView()
  }

  /** advance the brain one fixed step (Game drives all cars at SIM_HZ) */
  update(dt: number, ctx: AIContext, rivals: readonly RivalView[]): void {
    const p = this.phys
    if (ctx.locked) {
      // countdown: command path held at rest, nothing integrates
      this.cmd.throttle = this.cmd.brake = this.cmd.steer = 0
      this.cmd.handbrake = this.cmd.nitro = false
      this.events = { impact: 0, landed: 0, launched: 0 }
      return
    }
    if (p.sunk || p.outside) this.recover()

    /* recovery hold: the car sits parked on the lane for a beat, then the
       controller flies it again */
    if (this.recoverHold > 0) {
      this.recoverHold -= dt
      this.events = { impact: 0, landed: 0, launched: 0 }
      this.refreshView()
      return
    }

    /* --- one allocation-free look-ahead frame drives the controller --- */
    const look = Math.max(AI.steerLookBase + p.speed * AI.steerLookTime, AI.minLookaheadDist)
    const f = this.spline.planarAt(p.s + look, this.pf)
    const lat = (p.x - f.x) * f.sideX + (p.z - f.z) * f.sideZ

    /* --- spacing / avoidance: lane-offset decision with hysteresis --- */
    let blockDist = Infinity
    let avoidSide = 0, avoidStrength = 0
    let conflictBrake = 0
    this.drafting = false
    for (const r of rivals) {
      const rp = r.phys
      if (rp === p) continue
      const ds = wrapS(rp.s - p.s, this.spline.length)
      const dl = (r.targetLat ?? rp.lat) - p.lat
      if (ds > 0.6 && ds <= AI.avoidRadius) {
        // car in our slot ahead: gap-brake, then commit to a pass side
        if (Math.abs(rp.lat - p.lat) > AI.avoidBand) continue
        const near = 1 - clamp01(ds / AI.avoidRadius)
        if (ds < blockDist) blockDist = ds
        if (near > avoidStrength) {
          avoidStrength = near
          // pass on the side the slot already leaves open; a dead-even slot
          // splits on car parity so a pair can never commit to the same lane
          avoidSide = Math.abs(dl) > 0.4 ? -Math.sign(dl) : (this.slot % 2 === 0 ? -1 : 1)
        }
        // closing on a side-by-side neighbour at wheel distance -> yield gap
        if (ds < 3.0 && Math.abs(rp.lat - p.lat) < VEHICLE.width * 1.25 && p.speed > rp.speed) {
          conflictBrake = Math.max(conflictBrake, clamp01((3.0 - ds) / 2.2) * (p.speed - rp.speed) * 0.09)
        }
      } else if (ds > -3.2 && ds <= 0.6 && Math.abs(rp.lat - p.lat) < AI.avoidBand) {
        // overlapping alongside: bear away from the neighbour, full strength
        if (1.0 > avoidStrength) { avoidStrength = 1.0; avoidSide = p.lat >= rp.lat ? 1 : -1 }
      }
      if (ds > 1.5 && ds <= AI.slipstreamDist && Math.abs(rp.lat - p.lat) < 2) this.drafting = true
    }
    if (avoidStrength > 0.3) {
      if (this.laneHold <= 0) {
        // commit toward the open lane at avoidForce metres per decision
        const commit = avoidSide * AI.lineMax
        const step = clamp(commit - this.laneOffset, -AI.avoidForce * 3, AI.avoidForce * 3)
        this.laneOffset = clamp(this.laneOffset + step, -AI.lineMax, AI.lineMax)
        this.laneHold = 1.1
      }
    } else if (this.laneHold <= 0) {
      this.laneOffset = damp(this.laneOffset, 0, 1.35, dt)
    }
    this.laneHold = Math.max(0, this.laneHold - dt)

    /* --- curvature scan over the braking window (allocation-free) --- */
    const w = Math.max(AI.minLookaheadDist, p.speed * AI.brakeLookaheadTime)
    let kAbs = 0, kSigned = 0
    for (const k of [0, 0.34, 0.67, 1]) {
      const c = this.spline.curvAt(p.s + k * w)
      const a = Math.abs(c)
      if (a > kAbs) { kAbs = a; kSigned = c }
    }
    // steering-window peak (signed) drives the apex cut
    let sAbs = Math.abs(f.curv), sSigned = f.curv
    for (const k of [0, 0.5]) {
      const c = this.spline.curvAt(p.s + k * look)
      const a = Math.abs(c)
      if (a > sAbs) { sAbs = a; sSigned = c }
    }

    /* --- racing-line target + avoidance nudge --- */
    let want = clamp(sSigned * AI.lineGain, -AI.lineMax, AI.lineMax) + this.bias + this.laneOffset
    if (avoidStrength > 0.15) want += Math.sign(avoidSide) * avoidStrength * AI.avoidReach
    this.targetLat = clamp(want, -LANE_CAP, LANE_CAP)

    /* --- curvature-aware speed target, pace/rubber-band/draft scaled --- */
    const vCorner = Math.sqrt(AI.cornerLatAccel / Math.max(CURV_EPS, kAbs))
    const cap = this.nitroActive ? VEHICLE.nitroTopSpeed : VEHICLE.topSpeed
    const band = rubberBand(ctx) * (this.drafting ? 1 + AI.slipstreamGain : 1)
    const vT = clamp(this.pace * band * Math.min(vCorner, VEHICLE.topSpeed), 5, cap * 0.985)
    this.targetSpeed = vT

    /* --- nitro policy: straight, clear slot ahead, tank gate --- */
    this.recoverCooldown = Math.max(0, this.recoverCooldown - dt)
    if (this.nitroActive) {
      this.nitroVal -= AI.nitroDrainPerSec * dt
      if (this.nitroVal <= 0 || kAbs > AI.nitroCurvGate * 1.7) {
        this.nitroActive = false
        this.nitroVal = Math.max(0, this.nitroVal)
        this.nitroCool = VEHICLE.nitroOffCool
      }
    } else {
      if (p.grounded && p.onRoad && p.speed > 12) this.nitroVal = Math.min(AI.nitroMax, this.nitroVal + AI.nitroChargePerSec * dt)
      this.nitroCool = Math.max(0, this.nitroCool - dt)
      if (AI.nitroOnStraight && this.nitroCool <= 0 && this.recoverCooldown <= 0 &&
        this.nitroVal >= AI.nitroMinToActivate && kAbs <= AI.nitroCurvGate && blockDist > AI.nitroClearGap) {
        this.nitroActive = true
      }
    }

    /* --- longitudinal command from the speed target --- */
    const err = vT - p.speed
    let thr = err > 0 ? clamp01(0.35 + err / 9) : 0
    let brk = err < -1.4 ? clamp01(-err / 9.5) : 0
    if (blockDist < AI.avoidRadius) {
      brk = Math.max(brk, clamp01((AI.avoidRadius - blockDist) / (AI.avoidRadius * 0.62)) * AI.blockBrake)
      thr *= 0.35
    }
    if (conflictBrake > 0) {
      brk = Math.max(brk, conflictBrake)
      thr *= 1 - 0.7 * clamp01(conflictBrake)
    }
    this.blocked = blockDist < AI.avoidRadius
    if (this.nitroActive) thr = Math.max(thr, 0.85)
    this.cmd.throttle = thr
    this.cmd.brake = brk
    this.cmd.handbrake = false
    this.cmd.nitro = this.nitroActive

    /* --- steering law on the look-ahead frame (rig-calibrated signs) --- */
    this.cmd.steer = clamp(
      wrapPi(f.yaw - p.yaw) * -AI.headingK * AI.headingScale + (this.targetLat - lat) * (AI.steerK / HW) + p.yawRate * AI.yawDamp,
      -1, 1,
    )

    /* --- stuck watchdog: no progress for stuckTime -> lane re-join --- */
    if (p.speed < AI.stuckSpeed) {
      this.stuckT += dt
      this.stuckClock += dt
      if (this.stuckT > AI.stuckTime && this.recoverCooldown <= 0) this.recover()
    } else {
      this.stuckT = 0
      this.stuckClock = 0
    }

    p.step(dt, this.cmd)
    this.events = p.consumeEvents()
    this.refreshView()
  }

  /** snap back onto the racing lane at the current station, heading aligned */
  private recover(): void {
    if (this.recoverHold > 0) return
    const f = this.spline.planarAt(this.phys.s, this.pf)
    const c = this.probe.lanePose(this.phys.s, clamp(this.targetLat, -AI.lineMax, AI.lineMax))
    this.phys.resetAt(c.x, c.z, f.yaw, Math.min(this.phys.speed, 4))
    this.recoveries++
    this.recoverHold = 0.55
    this.recoverCooldown = 2.2
    this.stuckT = 0
    this.laneOffset = 0
    this.laneHold = 0
    this.nitroActive = false
    this.cmd.throttle = this.cmd.brake = this.cmd.steer = 0
    this.cmd.handbrake = this.cmd.nitro = false
  }

  /** copy live physics telemetry into the per-car ChaseCamera view */
  refreshView(): void {
    const p = this.phys
    const v = this.view
    v.pos.set(p.x, p.y, p.z)
    v.yaw = p.yaw
    v.speed = p.speed
    v.nitro = this.nitroActive
    v.drift = p.drift
    v.airborne = !p.grounded
    const g = this.probe.surface(p.s, p.lat, p.x, p.z)
    v.airHeight = clamp01((p.y - g.y) / 4)
  }

  /** deterministic pose/state snapshot: derived from seed + spline state only */
  snapshot(): AIStaticSnapshot {
    const p = this.phys
    return {
      slot: this.slot,
      pace: this.pace,
      bias: this.bias,
      x: p.x, y: p.y, z: p.z, yaw: p.yaw,
      vx: p.vx, vy: p.vy, vz: p.vz,
      speed: p.speed, slip: p.slip, drift: p.drift,
      s: p.s, lat: p.lat, time: p.time,
      nitroVal: this.nitroVal, nitroActive: this.nitroActive,
      recoveries: this.recoveries,
      targetLat: this.targetLat, targetSpeed: this.targetSpeed,
    }
  }
}

/* ------------------------------------------------------------------ helpers */

/** shortest signed station delta on the closed circuit */
const wrapS = (d: number, L: number): number => (d > L / 2 ? d - L : d < -L / 2 ? d + L : d)

/** rubber-band multiplier around the leader, clamped to the config bounds */
const rubberBand = (ctx: AIContext): number =>
  clamp(1 + clamp01(ctx.leaderProgress - ctx.progress) * AI.rubberK, AI.rubberBandMin, AI.rubberBandMax)
