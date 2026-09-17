import { TRACK, type ZoneId } from '../config'
import { clamp, smoothstep } from '../util'
import { TrackSpline } from '../world/TrackSpline'
import { CoastField } from '../world/Terrain'
import { rampLiftAt } from '../world/RoadBuilder'

/* ------------------------------------------------------------------------- *
 * The single analytic surface the drive layer stands on: asphalt (with the
 * geometric kicker lift) inside the corridor, engineered shoulder, then the
 * terrain height-field beyond. Also answers the barrier line per station —
 * authored barrier/guard windows, the tunnel bore wall and the deck parapet.
 * Pure queries (no allocation beyond the corridor object per physics step),
 * safe to run headless: TrackSpline/CoastField/RoadBuilder-ramp are math.
 * ------------------------------------------------------------------------- */

export interface Corridor {
  y: number
  s: number
  /** signed lateral from crown centre, driver-right + */
  lat: number
  /** unit xz of the corridor's driver-right direction (lat's axis) */
  sideX: number
  sideZ: number
  onRoad: boolean
  /** 0 asphalt .. 1 loose surface (grip/roll penalty + rumble feel) */
  rough: number
  zone: ZoneId
  /** distance from crown centre where the corridor wall stands (Infinity = open) */
  wall: number
  /** road tangent dy/ds (launch + attitude grade) */
  grade: number
  /** superelevation roll (+ raises driver-right) */
  bank: number
}

export interface Surf {
  y: number
  onRoad: boolean
  rough: number
}

export interface CenterPose {
  x: number
  y: number
  z: number
  yaw: number
}

export interface TrackProbe {
  readonly seaLevel: number
  /** full centerline corridor sample at a world point (one allocation per step) */
  corridor(x: number, z: number): Corridor
  /** surface height for a wheel at (s, lat); wx/wz fall through to terrain */
  surface(s: number, lat: number, wx: number, wz: number): Surf
  /** on-centre placement (respawn snaps) */
  centerPose(s: number): CenterPose
}

const HW = TRACK.halfWidth
const RAMP_LAT = HW - TRACK.ramp.sideTrim
const SEA = TRACK.coast.seaLevel

interface Win { s0: number; s1: number }

export class RoadSurfaceProbe implements TrackProbe {
  readonly seaLevel = SEA
  private walls: Win[] = []

  constructor(private spline: TrackSpline, private field: CoastField) {
    const E = TRACK.edge
    this.walls = [...E.barrier, ...E.guard].map((w) => ({ s0: w.s0, s1: w.s1 }))
  }

  corridor(x: number, z: number): Corridor {
    const n = this.spline.nearest(x, z)
    const f = this.spline.frame(n.s)
    const lat = (x - f.pos.x) * f.side.x + (z - f.pos.z) * f.side.z
    const absLat = Math.abs(lat)
    const zone = this.spline.zoneAt(n.s)
    const sw = this.surface(n.s, lat, x, z)
    return {
      y: sw.y,
      s: n.s,
      lat,
      sideX: f.side.x,
      sideZ: f.side.z,
      onRoad: sw.onRoad,
      rough: sw.rough,
      zone,
      wall: this.wallAt(n.s, zone, absLat),
      grade: f.tangent.y,
      bank: f.bank,
    }
  }

  surface(s: number, lat: number, wx: number, wz: number): Surf {
    const absLat = Math.abs(lat)
    const zone = this.spline.zoneAt(s)
    if (zone === 'elevated') {
      if (absLat <= HW + TRACK.bridge.deckEdge + 0.2) {
        return { y: this.spline.surfaceY(s, clamp(lat, -HW, HW)), onRoad: absLat <= HW + 0.3, rough: 0 }
      }
      return { y: this.field.height(wx, wz), onRoad: false, rough: 1 }
    }
    if (absLat <= HW + 1.1) {
      let y = this.spline.surfaceY(s, clamp(lat, -HW, HW))
      const absS = s
      if (absS >= TRACK.ramp.sStart && absS <= TRACK.ramp.sLip && absLat <= RAMP_LAT) y += rampLiftAt(absS)
      return { y, onRoad: absLat <= HW + 0.3, rough: smoothstep(HW + 0.34, HW + 1.15, absLat) }
    }
    if (absLat <= TRACK.shoulderOuter) {
      return { y: this.spline.bedY(s, lat), onRoad: false, rough: 0.75 }
    }
    return { y: this.field.height(wx, wz), onRoad: false, rough: 1 }
  }

  private wallAt(s: number, zone: ZoneId, absLat: number): number {
    void absLat
    if (zone === 'tunnel') return TRACK.tunnel.tubeHalf - 0.35
    if (zone === 'elevated') return HW + TRACK.bridge.deckEdge + 0.05
    for (const w of this.walls) if (s >= w.s0 && s <= w.s1) return HW + 0.62
    return Infinity
  }

  centerPose(s: number): CenterPose {
    const f = this.spline.frame(s)
    return { x: f.pos.x, y: this.spline.surfaceY(s, 0), z: f.pos.z, yaw: f.yaw }
  }
}
