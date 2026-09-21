import { VEHICLE } from '../src/config'
import type { InputState } from '../src/core/Input'
import type { ZoneId } from '../src/config'
import { TrackSpline } from '../src/world/TrackSpline'
import { CoastField } from '../src/world/Terrain'
import { RoadSurfaceProbe, type Corridor, type CenterPose, type Surf, type TrackProbe } from '../src/vehicles/TrackProbe'
import { PlayerVehicle } from '../src/vehicles/PlayerVehicle'
import type { VehiclePhysics } from '../src/vehicles/VehiclePhysics'

/* Shared headless fixtures: the real spline+terrain for corridor/geometry
 * scenarios, and a flat open pad (no walls) for pure physics units. */

export const SIM_DT = 1 / 120

export interface Rig {
  spline: TrackSpline
  field: CoastField
  probe: RoadSurfaceProbe
}
let _rig: Rig | null = null
export function rig(): Rig {
  if (!_rig) {
    const spline = new TrackSpline()
    const field = new CoastField(spline)
    _rig = { spline, field, probe: new RoadSurfaceProbe(spline, field) }
  }
  return _rig
}

/** endless asphalt at y=0 running along -Z; lat = +x; open both sides */
export class FlatProbe implements TrackProbe {
  seaLevel = -1000
  onRoad = true
  zone: ZoneId = 'start'
  wall = Infinity
  constructor(private s0 = 400) { }
  corridor(x: number, z: number): Corridor {
    return { y: 0, s: this.s0 - z, lat: x, sideX: 1, sideZ: 0, onRoad: this.onRoad, rough: this.onRoad ? 0 : 0.6, zone: this.zone, wall: this.wall, grade: 0, bank: 0 }
  }
  surface(): Surf { return { y: 0, onRoad: this.onRoad, rough: this.onRoad ? 0 : 0.6 } }
  centerPose(s: number): CenterPose { return { x: 0, y: 0, z: this.s0 - s, yaw: 0 } }
  lanePose(s: number, lat: number): CenterPose { return { x: lat, y: 0, z: this.s0 - s, yaw: 0 } }
}

export function flatCar(): { pv: PlayerVehicle; probe: FlatProbe } {
  const probe = new FlatProbe()
  const pv = new PlayerVehicle(probe)
  return { pv, probe }
}

export function roadCar(s: number, speed = 0): PlayerVehicle {
  const r = rig()
  const pv = new PlayerVehicle(r.probe)
  pv.resetTo(s, speed)
  return pv
}

export function fakeInput(): InputState {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
}

/** drive for `seconds` of simulated time with scripted input */
export function drive(pv: PlayerVehicle, seconds: number, setup: (t: number, input: InputState, p: VehiclePhysics) => void): InputState {
  const input = fakeInput()
  let t = 0
  while (t < seconds) {
    setup(t, input, pv.phys)
    pv.update(SIM_DT, input)
    t += SIM_DT
  }
  return input
}

/** lane-keeping pilot (self-consistent conventions): keeps lat≈0, follows the heading of a look-ahead frame */
export function laneSteer(p: VehiclePhysics, spline: TrackSpline, lookBase = 6, lookV = 0.42): number {
  const n = spline.nearest(p.x, p.z)
  const sRef = n.s + lookBase + p.speed * lookV
  const f = spline.frame(sRef)
  const lat = (p.x - f.pos.x) * f.side.x + (p.z - f.pos.z) * f.side.z
  const headErr = wrapShort(p.yaw - f.yaw)
  return clamp(headErr * 2.1 - lat * 0.115, -1, 1)
}

/** curvature-limited speed for the lap pilot */
export function cornerTarget(spline: TrackSpline, s: number, speed: number): number {
  let minV = VEHICLE.topSpeed * 0.92
  for (const k of [0.25, 0.5, 0.75]) {
    const f = spline.frame(s + 6 + speed * k)
    const curv = Math.abs(f.curv)
    if (curv > 1e-4) minV = Math.min(minV, Math.sqrt((VEHICLE.gripMax * 0.78) / curv))
  }
  return Math.max(10.5, minV)
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
export function wrapShort(a: number): number {
  a %= Math.PI * 2
  if (a > Math.PI) a -= Math.PI * 2
  if (a < -Math.PI) a += Math.PI * 2
  return a
}
