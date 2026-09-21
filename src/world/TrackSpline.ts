import * as THREE from 'three'
import { TRACK, type ZoneId } from '../config'
import { clamp, lerp, smoothstep } from '../util'

/**
 * Plan-view + elevation spline of the track (spec §7): arc-length LUT over a
 * centripetal Catmull-Rom through the authored control points, with signed
 * curvature, superelevation (corner camber), drainage crown and the road
 * surface sampler every downstream system (road/terrain/ramp/props) shares.
 */
export interface RoadFrame {
  s: number
  pos: THREE.Vector3       // crown centre on the asphalt surface
  tangent: THREE.Vector3   // unit, includes grade
  side: THREE.Vector3      // driver-right, banked
  up: THREE.Vector3        // banked surface normal
  yaw: number              // heading (forward = (-sin,0,-cos))
  pitch: number            // nose-up angle following the grade
  bank: number             // roll: + raises the right edge
  curv: number             // signed plan curvature (right-turn positive)
}

const DEG = Math.PI / 180

/** reusable allocation-free planar frame (AI hot path, see planarAt) */
export interface PlanarFrame {
  x: number; z: number; yaw: number; sideX: number; sideZ: number; curv: number
}

interface LutRow { x: number; y: number; z: number; s: number; tx: number; ty: number; tz: number; curv: number; zone: ZoneId }

/** Per-control-point authored tags (the Phase-5 circuit profile, spec §7). */
interface CpTag { zone: ZoneId }

export class TrackSpline {
  readonly length: number
  private lut: LutRow[] = []
  private curve: THREE.CatmullRomCurve3
  /** uniform-plan grid over the LUT: key = cellX + cellZ * cols (Phase-5 circuit
   *  folds back over itself, so the old x-monotonic binary search is invalid). */
  private grid: Map<number, number[]> = new Map()
  private box = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  /** arc-length station of each authored control point (level-design anchors) */
  private cpS: number[] = []
  /** station of control point i — how the per-zone layouts address the circuit */
  sAtControl(i: number): number { return this.cpS[clamp(Math.round(i), 0, this.cpS.length - 1)] }
  private gridCols = 0
  private gridX0 = 0
  private gridZ0 = 0
  private static readonly CELL = 24

  constructor() {
    const pts = TRACK.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z))
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    const tags: CpTag[] = TRACK.controlPoints.map((p) => ({ zone: p.zone ?? 'coastal' }))
    // dense arc-length LUT, resolution scaled to the total chord so the ~3.9 km
    // circuit keeps the Phase-3 slice's per-metre sampling density
    let chord = 0
    for (let i = 1; i < pts.length; i++) chord += pts[i].distanceTo(pts[i - 1])
    const samples = clamp(Math.round(chord / 0.35), 1500, 14000)
    const raw = this.curve.getPoints(samples)
    const lut: LutRow[] = []
    let s = 0
    const cpStation: number[] = tags.map((_, i) => Math.round((i / (tags.length - 1)) * (raw.length - 1)))
    this.cpS = cpStation.map((idx) => 0)
    for (let i = 0; i < raw.length; i++) {
      if (i > 0) s += raw[i].distanceTo(raw[i - 1])
      // zone of the LUT row = zone of the control-point segment it lives on
      const seg = clamp(Math.floor((i / (raw.length - 1)) * (tags.length - 1)), 0, tags.length - 2)
      const segT = (i / (raw.length - 1)) * (tags.length - 1) - seg
      lut.push({ x: raw[i].x, y: raw[i].y, z: raw[i].z, s, tx: 0, ty: 0, tz: 0, curv: 0, zone: segT < 0.5 ? tags[seg].zone : tags[seg + 1].zone })
    }
    this.length = s
    for (let i = 0; i < this.cpS.length; i++) this.cpS[i] = lut[clamp(cpStation[i], 0, lut.length - 1)].s
    for (let i = 0; i < lut.length; i++) {
      const a = lut[Math.max(0, i - 1)], b = lut[Math.min(lut.length - 1, i + 1)]
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
      const l = Math.hypot(dx, dy, dz) || 1
      lut[i].tx = dx / l; lut[i].ty = dy / l; lut[i].tz = dz / l
    }
    // signed curvature: k = side . dt/ds  (right turn positive)
    for (let i = 1; i < lut.length - 1; i++) {
      const p = lut[i - 1], c = lut[i], n = lut[i + 1]
      const ds = Math.max(1e-4, n.s - p.s)
      const ctx = (n.tx - p.tx) / ds, ctz = (n.tz - p.tz) / ds
      // driver-right of (tx,0,tz) is (-tz,0,tx)
      c.curv = -c.tz * ctx + c.tx * ctz
    }
    this.lut = lut
    this.buildGrid()
  }

  /** Bucket the LUT into a uniform plan grid so nearest() is O(1) for the loop. */
  private zones: Map<ZoneId, { s0: number; s1: number }> = new Map()

  /** First/last arc-length of a zone (used to scope per-zone builders). */
  zoneRange(zone: ZoneId): { s0: number; s1: number } {
    const hit = this.zones.get(zone)
    if (hit) return hit
    let s0 = 0, s1 = this.length
    for (let i = 0; i < this.lut.length; i++) if (this.lut[i].zone === zone) { s0 = this.lut[i].s; break }
    for (let i = this.lut.length - 1; i >= 0; i--) if (this.lut[i].zone === zone) { s1 = this.lut[i].s; break }
    this.zones.set(zone, { s0, s1 })
    return { s0, s1 }
  }

  private buildGrid(): void {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const r of this.lut) {
      if (r.x < minX) minX = r.x; if (r.x > maxX) maxX = r.x
      if (r.z < minZ) minZ = r.z; if (r.z > maxZ) maxZ = r.z
    }
    this.box = { minX, maxX, minZ, maxZ }
    const C = TrackSpline.CELL
    this.gridX0 = minX - C; this.gridZ0 = minZ - C
    this.gridCols = Math.ceil((maxX - minX + C * 2) / C) + 1
    const rows = Math.ceil((maxZ - minZ + C * 2) / C) + 1
    for (let i = 0; i < this.lut.length; i++) {
      const r = this.lut[i]
      const cx = clamp(Math.floor((r.x - this.gridX0) / C), 0, this.gridCols - 1)
      const cz = clamp(Math.floor((r.z - this.gridZ0) / C), 0, rows - 1)
      const k = cz * this.gridCols + cx
      const b = this.grid.get(k); if (b) b.push(i); else this.grid.set(k, [i])
    }
  }

  /** Plan-view extent of the centre line (terrain/water bounds derive from it). */
  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } { return this.box }

  /** Index of the last LUT row with s <= query (binary search). */
  private rowAt(s: number): number {
    const sc = clamp(s, 0, this.length)
    let lo = 0, hi = this.lut.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lut[mid].s <= sc) lo = mid; else hi = mid - 1
    }
    return lo
  }

  /** Interpolated centreline position (crown) at arc-length s. */
  sample(s: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const i = this.rowAt(s)
    const a = this.lut[i], b = this.lut[Math.min(this.lut.length - 1, i + 1)]
    const t = b.s > a.s ? clamp((clamp(s, 0, this.length) - a.s) / (b.s - a.s), 0, 1) : 0
    return out.set(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
  }

  /** Full banked surface frame at arc-length s. */
  frame(s: number): RoadFrame {
    const i = this.rowAt(s)
    const a = this.lut[i], b = this.lut[Math.min(this.lut.length - 1, i + 1)]
    const t = b.s > a.s ? clamp((clamp(s, 0, this.length) - a.s) / (b.s - a.s), 0, 1) : 0
    const pos = new THREE.Vector3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
    const tangent = new THREE.Vector3(lerp(a.tx, b.tx, t), lerp(a.ty, b.ty, t), lerp(a.tz, b.tz, t)).normalize()
    const curv = lerp(a.curv, b.curv, t)
    const maxBank = TRACK.camberMaxDeg * DEG
    const bank = clamp(curv * TRACK.camberGain, -maxBank, maxBank) * -1
    // plan heading from the flat tangent (rotation order YXZ)
    const yaw = Math.atan2(-tangent.x, -tangent.z)
    const hLen = Math.hypot(tangent.x, tangent.z) || 1e-4
    const pitch = Math.atan2(tangent.y, hLen)
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
    const up = new THREE.Vector3().crossVectors(side, tangent).normalize()
    // roll the cross-section about the tangent: +bank raises driver-right
    const cb = Math.cos(bank), sb = Math.sin(bank)
    const sideR = side.clone().multiplyScalar(cb).addScaledVector(up, sb)
    const upR = up.clone().multiplyScalar(cb).addScaledVector(side, -sb)
    return { s, pos, tangent, side: sideR, up: upR, yaw, pitch, bank, curv }
  }

  /** Crown elevation (before lateral crown fall) at arc-length s. */
  roadY(s: number): number { return this.sample(s).y }

  private crownDrop(lat: number): number {
    // gentle fall from centre crown to edge
    const t = clamp(Math.abs(lat) / TRACK.halfWidth, 0, 1)
    return -t * t * TRACK.crown * TRACK.halfWidth * 0.45
  }

  /** Exact banked surface point (used by every world builder). */
  surfacePoint(s: number, lat: number, lift = 0, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const f = this.frame(s)
    out.copy(f.pos)
    out.addScaledVector(f.side, lat)
    out.addScaledVector(f.up, lift + this.crownDrop(lat))
    return out
  }

  /** Asphalt surface height at lateral offset (driver-right +) — includes
   *  drainage crown + superelevation. Single source of truth for road/terrain. */
  surfaceY(s: number, lat: number): number {
    return this.surfacePoint(s, lat, 0, this._tmp).y
  }
  private _tmp = new THREE.Vector3()

  /** Zone tag of the section at arc-length s (drives per-zone builders). */
  zoneAt(s: number): ZoneId { return this.lut[this.rowAt(s)].zone }

  /** Nearest arc-length station to a world XZ point (uniform-grid accelerated). */
  nearest(x: number, z: number): { s: number; lat: number; d2: number } {
    const C = TrackSpline.CELL
    const cx = Math.floor((x - this.gridX0) / C), cz = Math.floor((z - this.gridZ0) / C)
    let best = { s: 0, lat: 0, d2: Infinity }
    for (let r = 0; r < 3 && best.d2 > C * C; r++) {
      for (let oz = -r; oz <= r; oz++) for (let ox = -r; ox <= r; ox++) {
        if (r > 0 && Math.abs(ox) !== r && Math.abs(oz) !== r) continue
        const b = this.grid.get((cz + oz) * this.gridCols + (cx + ox))
        if (!b) continue
        for (const i of b) {
          const row = this.lut[i]
          const d2 = (row.x - x) * (row.x - x) + (row.z - z) * (row.z - z)
          if (d2 < best.d2) best = { s: row.s, lat: 0, d2 }
        }
      }
    }
    // refine over a local window of LUT rows for a sub-metre station
    let bi = this.rowAt(best.s)
    for (let q = Math.max(0, bi - 6); q <= Math.min(this.lut.length - 1, bi + 6); q++) {
      const row = this.lut[q]
      const d2 = (row.x - x) * (row.x - x) + (row.z - z) * (row.z - z)
      if (d2 < best.d2) { best = { s: row.s, lat: 0, d2 }; bi = q }
    }
    // planar driver-right from the LUT tangent — no RoadFrame/Vector3 allocation
    // (nearest() runs once per height-field vertex and per shore-bake texel)
    const row = this.lut[bi]
    const tl = Math.hypot(row.tx, row.tz) || 1
    const lat = (x - row.x) * (-row.tz / tl) + (z - row.z) * (row.tx / tl)
    return { s: row.s, lat, d2: best.d2 }
  }

  /** Arc-length station whose centreline x is closest to target.
   *  Defaults to the COASTAL zone window so the Phase-3 authored anchors
   *  (props/vegetation/harness) keep their meaning now that the plan view of
   *  the full circuit crosses the same x values again in other zones.
   *  Pass an explicit window for stations outside the slice. */
  sFromX(target: number, sMin?: number, sMax?: number): number {
    if (sMin === undefined && sMax === undefined) { const w = this.zoneRange('coastal'); sMin = w.s0; sMax = w.s1 }
    const a = sMin ?? 0, b = sMax ?? this.length
    let bestI = 0, bestD = Infinity
    let lo = this.rowAt(a), hi = this.rowAt(b)
    // x is monotonic inside any authored zone window, so bisect then refine
    while (hi - lo > 4) {
      const m1 = lo + Math.floor((hi - lo) / 3), m2 = hi - Math.floor((hi - lo) / 3)
      if (Math.abs(this.lut[m1].x - target) <= Math.abs(this.lut[m2].x - target)) hi = m2; else lo = m1
    }
    for (let i = lo; i <= hi; i++) { const d = Math.abs(this.lut[i].x - target); if (d < bestD) { bestD = d; bestI = i } }
    return this.lut[bestI].s
  }

  /** Plan curvature magnitude at s (props/dressing can read corner intensity). */
  curvature(s: number): number { return this.frame(s).curv }

  /**
   * Allocation-free LUT reads for the AI hot path (spec §22 determinism):
   * station -> signed curvature and the planar centre/side/yaw frame, both
   * interpolated between LUT rows. The AI samples the line several times per
   * step; frame()/curvature() allocate, these do not.
   */
  curvAt(s: number): number {
    const sc = clamp(s, 0, this.length)
    const i = this.rowAt(sc)
    const a = this.lut[i], b = this.lut[Math.min(this.lut.length - 1, i + 1)]
    const t = b.s > a.s ? clamp((sc - a.s) / (b.s - a.s), 0, 1) : 0
    return lerp(a.curv, b.curv, t)
  }

  planarAt(s: number, out: PlanarFrame): PlanarFrame {
    const sc = clamp(s, 0, this.length)
    const i = this.rowAt(sc)
    const a = this.lut[i], b = this.lut[Math.min(this.lut.length - 1, i + 1)]
    const t = b.s > a.s ? clamp((sc - a.s) / (b.s - a.s), 0, 1) : 0
    const tx = lerp(a.tx, b.tx, t), tz = lerp(a.tz, b.tz, t)
    out.x = lerp(a.x, b.x, t)
    out.z = lerp(a.z, b.z, t)
    out.yaw = Math.atan2(-tx, -tz)
    const l = Math.hypot(tx, tz) || 1
    out.sideX = -tz / l
    out.sideZ = tx / l
    out.curv = lerp(a.curv, b.curv, t)
    return out
  }

  /**
   * Engineered road-bed profile: the surface the terrain skirt must meet.
   * Crown → shoulder → outer edge fall (spec §7/§8: embedded, no floating).
   */
  /** lat is SIGNED (driver-right +) so the bank tilt matches the surface. */
  bedY(s: number, lat: number): number {
    const hw = TRACK.halfWidth, so = TRACK.shoulderOuter
    const absLat = Math.abs(lat)
    if (absLat <= hw) return this.surfacePoint(s, lat, 0, this._tmp).y
    const t = smoothstep(hw, so, absLat)
    const edge = this.surfacePoint(s, lat >= 0 ? hw : -hw, 0, this._tmp).y
    return lerp(edge, edge - TRACK.shoulderDrop, t)
  }
}
