import { TRACK, VEHICLE, type ZoneId } from '../config'
import { clamp, clamp01, damp, Rand, wrapPi } from '../util'
import type { TrackProbe, Corridor } from './TrackProbe'

/* ------------------------------------------------------------------------- *
 * Arcade physics core (spec §14): planar slip-based model — heading rotates
 * under steering authority, world velocity is decomposed into the body frame
 * each step and the lateral component is scrubbed by the grip circle, so
 * handbrake grip-loss grows drift angle and counter-steer recovers it.
 * Vertical axis is ballistic with per-wheel spring-damper suspension travel
 * (jounce/droop, landing load); ramp launches are geometric (built-ramp
 * slope at the lip -> launch velocity). Collisions: analytic corridor clamp
 * against the barrier line + OBBs for authored obstacles. Deterministic:
 * fixed dt, no wall-clock, seeded rumble Rand.
 * ------------------------------------------------------------------------- */

export interface DriveCommand {
  /** 0..1 */
  throttle: number
  /** 0..1 */
  brake: number
  /** -1..1 (right +) */
  steer: number
  handbrake: boolean
  /** nitro engaged (raises top speed + accel per config) */
  nitro: boolean
}

export const REST_CMD: DriveCommand = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }

export interface CarEvents {
  /** barrier/obstacle impact severity (m/s of reflected velocity) */
  impact: number
  /** landing severity (m/s of vertical impact speed) */
  landed: number
  /** ramp launch (m/s of vertical launch speed) */
  launched: number
}

export interface Obstacle {
  x: number
  z: number
  /** half extents in the obstacle frame */
  hw: number
  hd: number
  yaw: number
}

/** wheel order matches CarModel.wheels: FL FR RL RR */
const W_FRONT = [true, true, false, false] as const
const W_RIGHT = [false, true, false, true] as const

const RAMP_LAT = TRACK.halfWidth - TRACK.ramp.sideTrim // built kicker half-width

export class VehiclePhysics {
  /* pose / motion (right-handed, y up, yaw: heading = (-sin,0,-cos)) */
  x = 0; y = 0; z = 0
  yaw = 0
  vx = 0; vy = 0; vz = 0
  yawRate = 0
  /* derived attitude (visuals read these; planar model, so these are feel) */
  pitch = 0
  roll = 0
  /** signed slip angle (rad; + = velocity right of nose) */
  slip = 0
  /** -1..1 normalised drift for camera/HUD (+ = nose right of travel) */
  drift = 0
  /** wheel suspension travel (m; - = compressed, + = drooped) */
  susp = [0, 0, 0, 0]
  /* contact + corridor readouts (one center sample per step) */
  grounded = true
  s = 0
  lat = 0
  onRoad = true
  rough = 0
  zone: ZoneId = 'coastal'
  /** steering visual (rad, from yaw rate => counter-steer reads naturally) */
  steerVis = 0
  /* flags for the drive layer (respawn policy lives in PlayerVehicle) */
  sunk = false
  outside = false
  /* air telemetry (tests) */
  airTime = 0
  apexAboveRoad = 0
  time = 0

  private suspV = [0, 0, 0, 0]
  private collideCd = 0
  private ev: CarEvents = { impact: 0, landed: 0, launched: 0 }
  private obstacles: readonly Obstacle[] = []
  private rnd: Rand

  constructor(private probe: TrackProbe, seed = 20260917) {
    this.rnd = new Rand(seed)
  }

  setObstacles(list: readonly Obstacle[]): void { this.obstacles = list }

  get speed(): number { return Math.hypot(this.vx, this.vz) }
  get forwardSpeed(): number { return -Math.sin(this.yaw) * this.vx - Math.cos(this.yaw) * this.vz }

  consumeEvents(): CarEvents {
    const e = this.ev
    this.ev = { impact: 0, landed: 0, launched: 0 }
    return e
  }

  /** place the car standing on the surface at (x,z) with heading yaw */
  resetAt(x: number, z: number, yaw: number, speed = 0): void {
    this.x = x; this.z = z
    this.yaw = wrapPi(yaw)
    this.vx = -Math.sin(yaw) * speed
    this.vz = -Math.cos(yaw) * speed
    this.vy = 0
    this.yawRate = 0
    this.pitch = 0; this.roll = 0
    this.slip = 0; this.drift = 0
    this.grounded = true
    this.airTime = 0; this.apexAboveRoad = 0
    this.sunk = false; this.outside = false
    for (let i = 0; i < 4; i++) { this.susp[i] = -VEHICLE.suspPreload; this.suspV[i] = 0 }
    const c = this.probe.corridor(x, z)
    this.y = c.y
    this.s = c.s; this.lat = c.lat
  }

  /* ------------------------------------------------------------------ step */

  step(dt: number, cmd: DriveCommand): void {
    const V = VEHICLE
    this.time += dt
    const prevS = this.s
    const c = this.probe.corridor(this.x, this.z)
    this.s = c.s; this.lat = c.lat
    this.onRoad = c.onRoad
    this.rough = c.rough
    this.zone = c.zone
    this.collideCd = Math.max(0, this.collideCd - dt)

    /* body-frame decomposition */
    const hx = -Math.sin(this.yaw), hz = -Math.cos(this.yaw)
    const rx = -hz, rz = hx // driver-right
    const f0 = this.vx * hx + this.vz * hz
    let f = f0
    let l = this.vx * rx + this.vz * rz
    const speed = Math.hypot(this.vx, this.vz)

    /* --- longitudinal: engine curve -> brake/reverse -> resistance --- */
    const topEff = cmd.nitro ? V.nitroTopSpeed : V.topSpeed
    const curve = f > 0 ? Math.max(V.engineFloor, 1 - Math.pow(clamp01(f / topEff), 2)) : 1
    const a0 = cmd.throttle * V.engineAccel * (cmd.nitro ? V.nitroAccelMul : 1) * curve
    f += a0 * dt
    if (cmd.throttle > 0 && f > topEff) f = topEff
    if (cmd.brake > 0) f = this.applyBrake(f, cmd.brake, dt)
    const rollR = V.rollResist + (V.grassRollResist - V.rollResist) * this.rough
    const resist = V.drag * f * Math.abs(f)
    if (Math.abs(f) > 0.03) {
      const scr = Math.min(Math.abs(f), (resist + rollR) * dt)
      f -= Math.sign(f) * scr
    } else f = 0
    if (f < -V.reverseMaxSpeed) f = -V.reverseMaxSpeed
    const longAcc = (f - f0) / dt

    /* --- lateral grip circle: the drift model --- */
    const drifting = this.grounded && cmd.handbrake && speed > V.driftTriggerSpeed
    let gripMul: number
    if (!this.grounded) gripMul = V.gripAir
    else if (drifting) gripMul = V.gripDrift
    else gripMul = 1 - (1 - V.gripGrass) * this.rough
    const latMax = V.gripMax * gripMul
    const l0 = l
    const latScrub = Math.min(Math.abs(l), Math.min(Math.abs(l) / dt, latMax) * dt)
    l -= Math.sign(l) * latScrub
    // signed tire force the scrub applies (+ = toward driver-right); a right
    // turn leaves l negative => force bends the car to the right, and the
    // body leans OUT of that force (left side down)
    const latAcc = (latScrub / dt) * (l0 < 0 ? 1 : l0 > 0 ? -1 : 0)

    /* --- yaw: speed-tapered authority, drift boost, air control --- */
    let yawTarget = 0
    if (speed > 0.6 || Math.abs(f) > 0.6) {
      const curve = V.steerLowSpeed + (V.steerHighSpeed - V.steerLowSpeed) * clamp01(speed / V.topSpeed)
      let boost = 1
      if (drifting) boost *= V.driftYawBoost
      if (!this.grounded) boost *= V.airSteerMul
      yawTarget = -cmd.steer * curve * boost
      // tire scrub bends travel toward the nose; this aligns the nose back
      // toward travel (post-impact recovery, counter-steer authority)
      if (this.grounded && speed > V.driftTriggerSpeed) yawTarget += clamp(-l0 * 0.055 * gripMul, -0.9, 0.9)
      // ordinary cornering cannot demand more yaw rate than the grip circle
      // delivers — only the handbrake drift (and air) may over-rotate
      if (this.grounded && !drifting && speed > 8) {
        const wCap = (V.gripMax * 0.92) / speed
        yawTarget = clamp(yawTarget, -wCap, wCap)
      }
    }
    this.yawRate = damp(this.yawRate, yawTarget, V.yawResponse, dt)
    this.yaw = wrapPi(this.yaw + this.yawRate * dt)

    /* write back world velocity in the body frame it was measured in — the
       heading turning and the world travel are deliberately DECOUPLED, so a
       drifting car points somewhere its tyres have not yet taken it */
    this.vx = hx * f + rx * l
    this.vz = hz * f + rz * l
    this.x += this.vx * dt
    this.z += this.vz * dt

    /* slip + drift telemetry (+ = nose right of travel) */
    this.slip = Math.abs(f) > 1.2 ? Math.atan2(l, Math.abs(f)) : 0
    this.drift = clamp(-this.slip / V.driftAngleMax, -1, 1)

    /* --- vertical: ground follow, geometric launches, ballistics --- */
    if (this.grounded) {
      const crossedLip = c.zone !== 'elevated' && prevS < TRACK.ramp.sLip && this.s >= TRACK.ramp.sLip && Math.abs(this.lat) <= RAMP_LAT
      if (crossedLip && speed >= V.launchMinSpeed) {
        const slope = lipSlope()
        if (slope > V.launchMinSlope) {
          this.grounded = false
          this.vy = speed * (Math.max(0, c.grade) + slope * V.launchPop)
          this.ev.launched = this.vy
          this.airTime = 0
          this.apexAboveRoad = 0
        }
      } else if (c.zone === 'elevated' && Math.abs(this.lat) > TRACK.halfWidth + TRACK.bridge.deckEdge + 0.1) {
        // drove over the deck parapet line — fall toward the city floor
        this.grounded = false
        this.vy = 0
        this.airTime = 0
        this.apexAboveRoad = 0
      } else if (c.y < this.y - 0.35 && speed > 3) {
        // surface fell out from under us (washed deck edge / missed apex)
        this.grounded = false
        this.vy = 0
      } else {
        this.y = c.y
        this.vy = 0
      }
    }
    if (!this.grounded) {
      this.airTime += dt
      this.vy -= V.airGravity * dt
      this.y += this.vy * dt
      const above = this.y - c.y
      if (above > this.apexAboveRoad) this.apexAboveRoad = above
      if (this.vy <= 0 && this.y <= c.y + 0.02) {
        const impact = -this.vy
        this.y = c.y
        this.vy = 0
        this.grounded = true
        this.ev.landed = impact
        // suspension load spike + impact-scaled horizontal scrub
        for (let i = 0; i < 4; i++) this.suspV[i] -= impact * 1.15
        const scrub = Math.max(0, 1 - impact * V.landScrubK)
        this.vx *= scrub
        this.vz *= scrub
      }
    }

    /* --- suspension travel (visual + landing settle) --- */
    this.updateSuspension(dt, longAcc, latAcc, speed, c.y)

    /* --- body attitude --- */
    const pitchT = this.grounded
      ? clamp(Math.atan(clamp(c.grade, -0.6, 0.6) * 0.9) + longAcc * V.bodyPitchK, -0.22, 0.22)
      : clamp(Math.atan2(this.vy, Math.max(speed, 8)) * 0.9, -0.5, 0.5)
    const rollT = clamp(c.bank + latAcc * V.bodyRollK + this.drift * V.bodyLeanK, -V.bodyTiltMax, V.bodyTiltMax)
    this.pitch = damp(this.pitch, pitchT, this.grounded ? 9 : V.airPitchK, dt)
    this.roll = damp(this.roll, rollT, this.grounded ? 9 : 3, dt)

    /* steering visual from yaw rate => drift shows counter-steer */
    this.steerVis = clamp(Math.atan2(this.yawRate * V.wheelbase, Math.max(speed, V.steerSpeedGate)), -V.steerMaxRad, V.steerMaxRad)

    /* --- corridor + obstacle collisions --- */
    this.collide(c)

    /* --- sanity flags (PlayerVehicle owns the respawn policy) --- */
    if (!Number.isFinite(this.x + this.y + this.z + this.vx + this.vy + this.vz)) this.sunk = true
    this.outside = Math.abs(this.lat) > V.respawnLat || this.y < this.probe.seaLevel - 2
    if (!this.onRoad && this.zone === 'coastal' && this.grounded && this.y < this.probe.seaLevel + V.respawnSeaPad) this.sunk = true
  }

  /* ------------------------------------------------------------- internals */

  private applyBrake(f: number, brake: number, dt: number): number {
    const V = VEHICLE
    if (f > 0.4) return Math.max(0, f - V.brakeForce * brake * dt)
    return Math.max(-V.reverseMaxSpeed, f - V.reverseAccel * brake * dt)
  }

  private updateSuspension(dt: number, longAcc: number, latSigned: number, speed: number, centerSurfY: number): void {
    const V = VEHICLE
    const omega = V.suspensionRate * Math.PI * 2
    const cDamp = 2 * V.suspensionDamp * omega
    const hx = -Math.sin(this.yaw), hz = -Math.cos(this.yaw)
    const rx = -hz, rz = hx
    const wb2 = V.wheelbase / 2, tr2 = V.trackWidth / 2
    for (let i = 0; i < 4; i++) {
      const lx = W_FRONT[i] ? -wb2 : wb2
      const ly = W_RIGHT[i] ? tr2 : -tr2
      let target: number
      if (!this.grounded) {
        target = V.suspDroop // wheels hang extended in air
      } else {
        const sW = this.s + lx
        const latW = this.lat + ly
        const wx = this.x + hx * lx + rx * ly
        const wz = this.z + hz * lx + rz * ly
        const surf = this.probe.surface(sW, latW, wx, wz)
        let load = V.suspPreload
        // weight transfer: braking/nosing loads the front, cornering the outside
        load += (W_FRONT[i] ? 1 : -1) * clamp(-longAcc * V.loadPitchK, 0, 0.09)
        load += (W_RIGHT[i] ? -1 : 1) * clamp(latSigned * V.loadRollK, 0, 0.07)
        // loose-surface rumble: deterministic washboard + seeded buzz
        if (this.rough > 0.05 && speed > 2) {
          const ph = this.time * 13 + i * 2.1
          load += (Math.sin(ph) * 0.5 + this.rnd.next() * 0.5) * this.rough * 0.05
        }
        // ground rising under this wheel pushes it UP into the arch
        // (compressed = negative in the suspension convention)
        const terrainStep = (surf.y - centerSurfY)
        target = clamp(-terrainStep * 1.12 - load, -V.suspTravel, V.suspDroop)
      }
      const a = omega * omega * (target - this.susp[i]) - cDamp * this.suspV[i]
      this.suspV[i] += a * dt
      this.susp[i] += this.suspV[i] * dt
      if (this.susp[i] < -V.suspTravel) { this.susp[i] = -V.suspTravel; if (this.suspV[i] < 0) this.suspV[i] = 0 }
      if (this.susp[i] > V.suspDroop) { this.susp[i] = V.suspDroop; if (this.suspV[i] > 0) this.suspV[i] = 0 }
    }
  }

  private collide(c: Corridor): void {
    const V = VEHICLE
    const hx = -Math.sin(this.yaw), hz = -Math.cos(this.yaw)
    const rx = -hz, rz = hx
    if (Number.isFinite(c.wall)) {
      const lim = c.wall - V.vehicleHalf
      const sx = c.sideX, sz = c.sideZ
      if (Math.abs(c.lat) > lim) {
        const side = Math.sign(c.lat)
        const over = Math.abs(c.lat) - lim
        this.x -= sx * side * over
        this.z -= sz * side * over
        const latV = (this.vx * sx + this.vz * sz) * side
        if (latV > 0.5) {
          this.ev.impact = Math.max(this.ev.impact, latV)
          const f = this.vx * hx + this.vz * hz
          const nl = -latV * V.collisionBounce
          this.vx = hx * f * V.collideScrub + sx * nl
          this.vz = hz * f * V.collideScrub + sz * nl
          this.yawRate *= 0.55
        }
        this.collideCd = V.collideCd
      }
    }
    // authored OBB obstacles (AABB-lite in the obstacle frame)
    for (const o of this.obstacles) {
      if (!Number.isFinite(this.x) || !Number.isFinite(this.z)) break
      const dx = this.x - o.x, dz = this.z - o.z
      if (Math.abs(dx) > 60 || Math.abs(dz) > 60) continue
      const co = Math.cos(o.yaw), si = Math.sin(o.yaw)
      const u = dx * co + dz * si
      const w = -dx * si + dz * co
      const hu = o.hw + V.vehicleHalf
      const hw2 = o.hd + V.vehicleHalf
      if (Math.abs(u) >= hu || Math.abs(w) >= hw2) continue
      const pu = hu - Math.abs(u)
      const pw = hw2 - Math.abs(w)
      let nx: number, nz: number, pen: number
      if (pu < pw) {
        const lu = Math.sign(u)
        nx = lu * co; nz = lu * si; pen = pu
      } else {
        const lw = Math.sign(w)
        nx = -lw * si; nz = lw * co; pen = pw
      }
      this.x += nx * pen
      this.z += nz * pen
      const vn = this.vx * nx + this.vz * nz
      if (vn < -0.5) {
        this.ev.impact = Math.max(this.ev.impact, -vn)
        this.vx -= (1 + V.collisionBounce) * vn * nx
        this.vz -= (1 + V.collisionBounce) * vn * nz
        this.vx *= V.collideScrub; this.vz *= V.collideScrub
        this.collideCd = V.collideCd
      }
    }
  }
}

/** d(lift)/ds over the loaded section of the kicker — the face the car
 *  leaves the ground from (the smoothstep crest flattens into the lip) */
let _lipSlope = Number.NaN
function lipSlope(): number {
  if (!Number.isFinite(_lipSlope)) {
    const r = TRACK.ramp
    const u = (r.sLip - 1.2 - r.sStart) / (r.sLip - r.sStart)
    _lipSlope = (1.5 * r.height * 4 * u * (1 - u)) / (r.sLip - r.sStart)
  }
  return _lipSlope
}
