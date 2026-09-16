import * as THREE from 'three'
import { TRACK } from '../config'
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

interface LutRow { x: number; y: number; z: number; s: number; tx: number; ty: number; tz: number; curv: number }

export class TrackSpline {
  readonly length: number
  private lut: LutRow[] = []
  private curve: THREE.CatmullRomCurve3

  constructor() {
    const pts = TRACK.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z))
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    // dense arc-length LUT (chord-accumulated from a uniform t walk)
    const raw = this.curve.getPoints(1500)
    const lut: LutRow[] = []
    let s = 0
    for (let i = 0; i < raw.length; i++) {
      if (i > 0) s += raw[i].distanceTo(raw[i - 1])
      lut.push({ x: raw[i].x, y: raw[i].y, z: raw[i].z, s, tx: 0, ty: 0, tz: 0, curv: 0 })
    }
    this.length = s
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
  }

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

  /** Nearest arc-length station to a world XZ point (coarse x-accelerated). */
  nearest(x: number, z: number): { s: number; lat: number; d2: number } {
    let best = { s: 0, lat: 0, d2: Infinity }
    const lut = this.lut
    // x is monotonic enough along the slice; binary search the x axis then scan
    let lo = 0, hi = lut.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (lut[mid].x < x) lo = mid + 1; else hi = mid
    }
    const step = 6
    for (let i = Math.max(0, lo - 160); i < Math.min(lut.length, lo + 160); i += step) {
      const r = lut[i]
      const d2 = (r.x - x) * (r.x - x) + (r.z - z) * (r.z - z)
      if (d2 < best.d2) best = { s: r.s, lat: 0, d2 }
    }
    const i = this.rowAt(best.s)
    const fineFrom = Math.max(0, i - step * 2), fineTo = Math.min(lut.length - 1, i + step * 2)
    for (let q = fineFrom; q <= fineTo; q++) {
      const r = lut[q]
      const d2 = (r.x - x) * (r.x - x) + (r.z - z) * (r.z - z)
      if (d2 < best.d2) best = { s: r.s, lat: 0, d2 }
    }
    const f = this.frame(best.s)
    const lat = (x - f.pos.x) * f.side.x + (z - f.pos.z) * f.side.z
    return { s: best.s, lat, d2: best.d2 }
  }

  /** Arc-length station whose centreline x is closest to target x. */
  sFromX(target: number): number {
    let lo = 0, hi = this.lut.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.lut[mid].x < target) lo = mid + 1; else hi = mid
    }
    const a = this.lut[Math.max(0, lo - 1)], b = this.lut[lo]
    return Math.abs(a.x - target) <= Math.abs(b.x - target) ? a.s : b.s
  }

  /** Plan curvature magnitude at s (props/dressing can read corner intensity). */
  curvature(s: number): number { return this.frame(s).curv }

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
