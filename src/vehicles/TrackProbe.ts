import { Vector3 } from 'three'
import { DECK_FACE, TRACK, VEHICLE, type ZoneId } from '../config'
import { clamp, smoothstep } from '../util'
import { TrackSpline } from '../world/TrackSpline'
import { CoastField } from '../world/Terrain'
import { rampLiftAt } from '../world/RoadBuilder'
import { makeSpurControlPoints } from '../world/SpurKit'

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
  /** placement on the racing lane at (s, lat) — grid slots, AI recovery */
  lanePose(s: number, lat: number): CenterPose
}

const HW = TRACK.halfWidth
const RAMP_LAT = HW - TRACK.ramp.sideTrim
const SEA = TRACK.coast.seaLevel

const SPUR_HALF = TRACK.shortcut.half
const SPUR_DEEP_FROM = 30
const SPUR_HANDOFF_FROM = 7
const SPUR_MAIN_HANDOFF_LAT = 3.4
const SPUR_HANDOFF_WIDTH = 14
const SPUR_CROWN_DEPTH = 0.055
const SPUR_SURFACE_LIFT = 0.022
const SPUR_DETECT_PAD = 1.2
const spurField = new CoastField(new TrackSpline())
const spurRaw = makeSpurControlPoints(spurField)
const spurAcc: number[] = [0]
for (let i = 1; i < spurRaw.length; i++) spurAcc.push(spurAcc[i - 1] + spurRaw[i].distanceTo(spurRaw[i - 1]))
export const spurTotal = spurAcc[spurAcc.length - 1]
const spurBox = spurRaw.reduce(
  (acc, p) => ({
    minX: Math.min(acc.minX, p.x), maxX: Math.max(acc.maxX, p.x),
    minZ: Math.min(acc.minZ, p.z), maxZ: Math.max(acc.maxZ, p.z),
  }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
)
const spurCrown = (lat: number): number => {
  const edge = Math.min(1, Math.abs(lat) / SPUR_HALF)
  return -SPUR_CROWN_DEPTH * edge * edge
}

export interface SpurPose {
  x: number
  y: number
  z: number
  yaw: number
  tx: number
  tz: number
  s: number
}

export interface SpurNear extends SpurPose {
  lat: number
  dist: number
  grade: number
}

const spurFrameAt = (i: number): { tx: number; tz: number; yaw: number } => {
  const a = spurRaw[Math.max(0, i - 1)]
  const b = spurRaw[Math.min(spurRaw.length - 1, i + 1)]
  const tx = b.x - a.x
  const tz = b.z - a.z
  const len = Math.hypot(tx, tz) || 1
  return { tx: tx / len, tz: tz / len, yaw: Math.atan2(-tx, -tz) }
}

export function spurAt(s: number): SpurPose {
  const target = clamp(s, 0, spurTotal)
  let i = 1
  while (i < spurAcc.length - 1 && spurAcc[i] < target) i++
  const fr = spurFrameAt(i)
  const p = spurRaw[i]
  return { x: p.x, y: p.y, z: p.z, yaw: fr.yaw, tx: fr.tx, tz: fr.tz, s: target }
}

export function spurNear(x: number, z: number): SpurNear | null {
  const pad = SPUR_HALF + SPUR_DETECT_PAD
  if (x < spurBox.minX - pad || x > spurBox.maxX + pad || z < spurBox.minZ - pad || z > spurBox.maxZ + pad) return null
  let best: SpurNear | null = null
  for (let i = 1; i < spurRaw.length; i++) {
    const a = spurRaw[i - 1]
    const b = spurRaw[i]
    const ex = b.x - a.x
    const ez = b.z - a.z
    const len2 = ex * ex + ez * ez
    if (len2 < 1e-9) continue
    const len = Math.sqrt(len2)
    const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / len2, 0, 1)
    const px = a.x + ex * t
    const pz = a.z + ez * t
    const dx = x - px
    const dz = z - pz
    const d2 = dx * dx + dz * dz
    if (best !== null && d2 >= best.dist * best.dist) continue
    const tx = ex / len
    const tz = ez / len
    const lat = dx * -tz + dz * tx
    const s = spurAcc[i - 1] + len * t
    best = {
      x: px,
      y: a.y + (b.y - a.y) * t + SPUR_SURFACE_LIFT + spurCrown(lat),
      z: pz,
      yaw: Math.atan2(-tx, -tz),
      tx,
      tz,
      s,
      lat,
      dist: Math.sqrt(d2),
      grade: (b.y - a.y) / len,
    }
  }
  return best
}

const spurInDeepSection = (near: SpurNear): boolean => near.s >= SPUR_DEEP_FROM && near.s <= spurTotal - SPUR_DEEP_FROM
const spurOnSurface = (near: SpurNear, width: number = SPUR_HALF + SPUR_DETECT_PAD * 0.65): boolean => near.dist <= width

export function isShortcutLane(x: number, z: number): boolean {
  const near = spurNear(x, z)
  if (near === null || Math.abs(near.lat) > SPUR_HALF) return false
  return spurInDeepSection(near) || (near.s >= SPUR_HANDOFF_FROM && near.s <= spurTotal - SPUR_HANDOFF_FROM)
}

/* Corridor lateral tolerances (spec §18 named tuning constants, metres). All
 * derived from TRACK.halfWidth so a single track-width edit propagates; the
 * residual offsets are the authored build-out past the painted edge.
 *   ONROAD_LAT          — past the painted half-width a wheel still reads full asphalt.
 *   CORRIDOR_EDGE       — outer limit of the paved deck before the engineered shoulder.
 *   ROUGH_FADE0/1       — smoothstep span over which grip/roll fade to loose-surface level.
 *   DECK_GRAZE          — elevated deck: overhang past the parapet face still stood on.
 *   DECK_PARAPET_STANDOFF — how far out the deck's barrier line stands from the deck edge.
 *   TUNNEL_WALL_INSET   — barrier inset from the tube wall (bore clearance). */
const ONROAD_LAT = HW + 0.3
const CORRIDOR_EDGE = HW + 1.1
const ROUGH_FADE0 = HW + 0.34
const ROUGH_FADE1 = HW + 1.15
const DECK_GRAZE = 0.2
const DECK_PARAPET_STANDOFF = 0.05
const TUNNEL_WALL_INSET = 0.35

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
    const zone = this.spline.zoneAt(n.s)
    const spur = this.spurAtDrivable(x, z)
    if (spur !== null) {
      return {
        y: spur.y,
        s: n.s,
        lat: spur.lat,
        sideX: -spur.tz,
        sideZ: spur.tx,
        onRoad: spur.onRoad,
        rough: spur.rough,
        zone,
        wall: SPUR_HALF + VEHICLE.barrierInset,
        grade: spur.grade,
        bank: 0,
      }
    }
    const f = this.spline.frame(n.s)
    const lat = (x - f.pos.x) * f.side.x + (z - f.pos.z) * f.side.z
    const absLat = Math.abs(lat)
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
    void s
    void lat
    const spur = this.spurAtDrivable(wx, wz)
    if (spur !== null) return { y: spur.y, onRoad: spur.onRoad, rough: spur.rough }
    const absLat = Math.abs(lat)
    const zone = this.spline.zoneAt(s)
    if (zone === 'elevated') {
      if (absLat <= DECK_FACE + DECK_GRAZE) {
        return { y: this.spline.surfaceY(s, clamp(lat, -HW, HW)), onRoad: absLat <= ONROAD_LAT, rough: 0 }
      }
      return { y: this.field.height(wx, wz), onRoad: false, rough: 1 }
    }
    if (absLat <= CORRIDOR_EDGE) {
      let y = this.spline.surfaceY(s, clamp(lat, -HW, HW))
      const absS = s
      if (absS >= TRACK.ramp.sStart && absS <= TRACK.ramp.sLip && absLat <= RAMP_LAT) y += rampLiftAt(absS)
      return { y, onRoad: absLat <= ONROAD_LAT, rough: smoothstep(ROUGH_FADE0, ROUGH_FADE1, absLat) }
    }
    if (absLat <= TRACK.shoulderOuter) {
      return { y: this.spline.bedY(s, lat), onRoad: false, rough: 0.75 }
    }
    return { y: this.field.height(wx, wz), onRoad: false, rough: 1 }
  }

  private spurAtDrivable(x: number, z: number): (SpurNear & { onRoad: boolean; rough: number }) | null {
    const near = spurNear(x, z)
    if (near === null) return null
    const deep = spurInDeepSection(near)
    const narrow = spurOnSurface(near)
    if (!deep || !narrow) {
      const handoffSection = near.s >= SPUR_HANDOFF_FROM && near.s <= spurTotal - SPUR_HANDOFF_FROM
      if (!handoffSection || !spurOnSurface(near, SPUR_HANDOFF_WIDTH)) return null
      const nearest = this.spline.nearest(x, z)
      const frame = this.spline.frame(nearest.s)
      const mainLat = (x - frame.pos.x) * frame.side.x + (z - frame.pos.z) * frame.side.z
      if (Math.abs(mainLat) < SPUR_MAIN_HANDOFF_LAT) return null
    }
    const absLat = Math.abs(near.lat)
    return {
      ...near,
      onRoad: absLat <= SPUR_HALF + 0.35 || absLat <= SPUR_HANDOFF_WIDTH,
      rough: absLat <= SPUR_HALF ? smoothstep(SPUR_HALF - 0.15, SPUR_HALF + 0.75, absLat) : smoothstep(SPUR_HALF, SPUR_HANDOFF_WIDTH, absLat),
    }
  }

  private wallAt(s: number, zone: ZoneId, absLat: number): number {
    void absLat
    if (zone === 'tunnel') return TRACK.tunnel.tubeHalf - TUNNEL_WALL_INSET
    if (zone === 'elevated') return DECK_FACE + DECK_PARAPET_STANDOFF
    for (const w of this.walls) if (s >= w.s0 && s <= w.s1) return HW + VEHICLE.barrierInset
    return Infinity
  }

  centerPose(s: number): CenterPose {
    const f = this.spline.frame(s)
    return { x: f.pos.x, y: this.spline.surfaceY(s, 0), z: f.pos.z, yaw: f.yaw }
  }

  lanePose(s: number, lat: number): CenterPose {
    const f = this.spline.frame(s)
    return {
      x: f.pos.x + f.side.x * lat,
      y: this.spline.surfaceY(s, lat),
      z: f.pos.z + f.side.z * lat,
      yaw: f.yaw,
    }
  }
}
