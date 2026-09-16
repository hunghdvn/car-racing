import * as THREE from 'three'
import { TRACK, SEED } from '../config'
import { Rand, clamp, lerp, smoothstep, fbm2, mergeGeometries, sanitizeGeometry, crNormals, sweepProfile, type SweepFrame } from '../util'
import { asphaltMaps, concreteMaps, curbStripeTexture, gravelMaps, patchDecalTexture, kickerFaceTexture } from '../assets/Textures'
import type { TrackSpline } from './TrackSpline'

/* ------------------------------------------------------------------------- *
 * Constructed road (spec §7/§8) — NOT a ribbon: asphalt with wear/patches,
 * engineered shoulders on the formed road-bed, skirts into the terrain,
 * curb + rumble profiles, real guardrail (corrugated rail + posts) and
 * segment-jointed concrete barrier, plus a modelled kicker ramp with side
 * transitions, painted launch face and landing zone.
 * ------------------------------------------------------------------------- */

export interface HeightField { height(x: number, z: number): number }

const WHEEL_TRACKS = [-3.55, -1.85, 1.85, 3.55]

function roadVertexColor(s: number, lat: number, out: THREE.Color): void {
  const mottle = 0.92 + fbm2(s * 0.11, lat * 0.6 + 3.1, 3) * 0.1
  let c = mottle
  for (const wt of WHEEL_TRACKS) {
    const d = Math.abs(lat - wt)
    if (d < 0.8) c = Math.min(c, 0.6 + smoothstep(0.34, 0.8, d) * 0.28)
  }
  const edge = smoothstep(4.55, 5.35, Math.abs(lat))
  out.setRGB(c * lerp(1, 0.86, edge), c * lerp(1, 0.88, edge), c * lerp(1, 0.8, edge))
}

/** Ramp surface lift above the road plane (0 outside the kicker). */
export function rampLiftAt(s: number): number {
  const r = TRACK.ramp
  if (s < r.sStart || s > r.sLip) return 0
  return r.height * smoothstep(r.sStart, r.sLip, s)
}
/** d(lift)/ds — for car pitch on the kicker. */
export function rampSlopeAt(s: number): number {
  const r = TRACK.ramp
  if (s < r.sStart || s > r.sLip) return 0
  const u = (s - r.sStart) / (r.sLip - r.sStart)
  return (1.5 * r.height * 4 * u * (1 - u)) / (r.sLip - r.sStart)
}

const RAMP_INSET = 4.85 // kicker asphalt inset each side (spec §7 side transitions)

export class RoadBuilder {
  private spline: TrackSpline
  private field: HeightField | null
  readonly group = new THREE.Group()

  constructor(spline: TrackSpline, field: HeightField | null) {
    this.spline = spline
    this.field = field
    this.group.name = 'road'
  }

  build(sFrom: number, sTo: number): THREE.Group {
    const g = this.group
    g.add(this.buildAsphalt(sFrom, sTo))
    g.add(this.buildShoulders(sFrom, sTo))
    g.add(this.buildSkirts(sFrom, sTo))
    g.add(this.buildEdgeProfiles(sFrom, sTo))
    g.add(this.buildGuardrail())
    g.add(this.buildMarkings(sFrom, sTo))
    g.add(this.buildPatches(sFrom, sTo))
    g.add(this.buildDrains())
    g.add(this.buildKicker())
    return g
  }

  /* ------------------------------------------------------------- primitives */
  private absPoint(s: number, lat: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    const f = this.spline.frame(s)
    out.copy(f.pos).addScaledVector(f.side, lat)
    out.y = y
    return out
  }

  /** Loft a grid strip over rows(s) x cols(lat) with per-vertex placement. */
  private loft(
    sFrom: number, sTo: number, sStep: number,
    cols: number[],
    place: (s: number, lat: number, out: THREE.Vector3, col: number) => void,
    uvScale: number,
    colorAt?: (s: number, lat: number, out: THREE.Color, col: number) => void,
    flip = false,
  ): THREE.BufferGeometry {
    const rows = Math.max(2, Math.ceil((sTo - sFrom) / sStep))
    const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = []
    const p = new THREE.Vector3(), c = new THREE.Color()
    for (let i = 0; i <= rows; i++) {
      const s = lerp(sFrom, sTo, i / rows)
      cols.forEach((lat, j) => {
        place(s, lat, p, j)
        pos.push(p.x, p.y, p.z)
        uv.push(lat * uvScale, s * uvScale)
        if (colorAt) { colorAt(s, lat, c, j); col.push(c.r, c.g, c.b) }
      })
    }
    const n = cols.length
    for (let i = 0; i < rows; i++) for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = a + n
      if (!flip) idx.push(a, b, a + 1, a + 1, b, b + 1)
      else idx.push(a, a + 1, b, a + 1, b + 1, b)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    if (colorAt) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setIndex(idx)
    sanitizeGeometry(geo)
    return geo
  }

  /* --------------------------------------------------------------- asphalt */
  private asphaltMat(): THREE.MeshStandardMaterial {
    const m = asphaltMaps()
    const mat = new THREE.MeshStandardMaterial({
      map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap,
      roughness: 0.92, metalness: 0.02, vertexColors: true, side: THREE.DoubleSide,
    })
    mat.normalScale = new THREE.Vector2(0.8, 0.8)
    return mat
  }

  buildAsphalt(sFrom: number, sTo: number): THREE.Mesh {
    const hw = TRACK.halfWidth
    const cols = [-hw, -hw * 0.6, -hw * 0.22, hw * 0.22, hw * 0.6, hw]
    const geo = this.loft(sFrom, sTo, 0.9, cols,
      (s, lat, out) => { this.spline.surfacePoint(s, lat, rampLiftAt(s), out) },
      0.2, (s, lat, c) => roadVertexColor(s, lat, c))
    const mesh = new THREE.Mesh(geo, this.asphaltMat())
    mesh.receiveShadow = true
    mesh.name = 'road-asphalt'
    return mesh
  }

  /* ------------------------------------------------------------- shoulders */
  buildShoulders(sFrom: number, sTo: number): THREE.Mesh {
    const hw = TRACK.halfWidth, so = TRACK.shoulderOuter
    const gr = gravelMaps()
    const build = (side: 1 | -1): THREE.BufferGeometry => {
      const cols = [hw, lerp(hw, so, 0.55), so]
      return this.loft(sFrom, sTo, 1.7, cols.map((o) => side * o),
        (s, lat, out) => this.absPoint(s, lat, this.spline.bedY(s, lat) - 0.004, out),
        0.26,
        (_s, lat, ccol) => {
          const t = smoothstep(hw, so, Math.abs(lat))
          const d = lerp(0.97, 0.6, t)
          ccol.setRGB(d * lerp(1, 0.95, t), d, d * lerp(1, 0.8, t))
        })
    }
    const geo = mergeGeometries([
      { geometry: build(1) },
      { geometry: build(-1) },
    ])
    const mat = new THREE.MeshStandardMaterial({ map: gr.map, normalMap: gr.normalMap, roughness: 0.98, metalness: 0, vertexColors: true, side: THREE.DoubleSide })
    mat.normalScale = new THREE.Vector2(1.1, 1.1)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.receiveShadow = true
    mesh.name = 'road-shoulders'
    return mesh
  }

  /* ---------------------------------------------------------------- skirts */
  /** Solid walls dropping the engineered shoulder into the terrain (embed). */
  buildSkirts(sFrom: number, sTo: number): THREE.Mesh {
    const so = TRACK.shoulderOuter
    const gr = gravelMaps()
    const build = (side: 1 | -1): THREE.BufferGeometry => this.loft(sFrom, sTo, 1.7, [side * so, side * (so + 2.3)],
      (s, lat, out, j) => {
        if (j === 0) this.absPoint(s, lat, this.spline.bedY(s, lat) - 0.02, out)
        else {
          const p = this.absPoint(s, lat, 0, new THREE.Vector3())
          const gy = this.field ? this.field.height(p.x, p.z) - 0.07 : this.spline.bedY(s, lat) - 0.25
          this.absPoint(s, lat, gy, out)
        }
      }, 0.2,
      (s, lat, ccol, j) => {
        void s; void lat
        if (j === 0) ccol.setRGB(0.5, 0.48, 0.42)
        else ccol.setRGB(0.38, 0.38, 0.3)
      })
    const geo = mergeGeometries([{ geometry: build(1) }, { geometry: build(-1) }])
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: gr.map, normalMap: gr.normalMap, roughness: 1, metalness: 0, vertexColors: true, side: THREE.DoubleSide,
    }))
    mesh.name = 'road-skirts'
    return mesh
  }

  /* ------------------------------------------------ edge profile furniture */
  /** Swept chain profile relative to the road-bed at a reference latitude. */
  private chainStrip(side: 1 | -1, sFrom: number, sTo: number, refLatAbs: number, chain: [number, number][], uvScale: number): THREE.BufferGeometry {
    const rows = Math.max(2, Math.ceil((sTo - sFrom) / 1.1))
    const n = chain.length
    const pos: number[] = [], uv: number[] = [], idx: number[] = []
    const p = new THREE.Vector3()
    for (let i = 0; i <= rows; i++) {
      const s = lerp(sFrom, sTo, i / rows)
      const base = this.spline.bedY(s, side * refLatAbs)
      for (const [latOff, lift] of chain) {
        this.absPoint(s, side * latOff, base + lift, p)
        pos.push(p.x, p.y, p.z)
        uv.push(latOff * uvScale, s * uvScale)
      }
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = a + n
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    sanitizeGeometry(geo)
    return geo
  }

  buildEdgeProfiles(sFrom: number, sTo: number): THREE.Group {
    const g = new THREE.Group()
    g.name = 'edge-profiles'
    void sFrom; void sTo
    const conc = concreteMaps(0xa9a49a, 51)
    const concMat = new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, roughnessMap: conc.roughnessMap, roughness: 0.85, metalness: 0.02 })

    // building-side raised curb; granite face carries the red/white stripes
    const curbChain: [number, number][] = [
      [5.32, -0.02], [5.32, 0.13], [6.12, 0.16], [6.26, 0.13], [6.26, -0.03], [6.7, -0.05],
    ]
    const curb = new THREE.Mesh(this.chainStrip(1, 140, 300, 6.4, curbChain, 0.34), concMat)
    curb.receiveShadow = true
    curb.name = 'curb'
    g.add(curb)
    const stripe = new THREE.Mesh(this.chainStrip(1, 140, 300, 6.4, [[5.325, -0.005], [6.115, 0.145], [6.25, 0.115]], 0.172),
      new THREE.MeshStandardMaterial({ map: curbStripeTexture('curb'), roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
    stripe.receiveShadow = true
    g.add(stripe)

    // sea-side black/yellow rumble strip
    const rumbleChain: [number, number][] = [
      [5.32, -0.01], [5.32, 0.03], [6.28, 0.045], [6.38, 0.02], [6.38, -0.02],
    ]
    const rumble = new THREE.Mesh(this.chainStrip(-1, 150, 286, 6.2, rumbleChain, 0.155),
      new THREE.MeshStandardMaterial({ map: curbStripeTexture('rumble'), roughness: 0.75, metalness: 0.04 }))
    rumble.receiveShadow = true
    rumble.name = 'rumble'
    g.add(rumble)

    // concrete barrier run (building side) — real jersey-ish closed section
    const barrierProfile: [number, number][] = [
      [6.55, 0.02], [7.32, 0.02], [7.14, 0.17], [6.98, 0.36], [6.92, 0.74], [6.87, 0.88], [6.72, 0.88], [6.66, 0.74], [6.6, 0.36], [6.55, 0.14],
    ]
    const frames: SweepFrame[] = []
    const bF = 148, bT = 262, step = 1.6
    const rows = Math.max(2, Math.ceil((bT - bF) / step))
    for (let i = 0; i <= rows; i++) {
      const s = lerp(bF, bT, i / rows)
      const f = this.spline.frame(s)
      const dy = this.spline.bedY(s, 6.9) - f.pos.y
      frames.push({
        p: [f.pos.x + f.side.x * 0, f.pos.y + dy, f.pos.z],
        s: [f.side.x, f.side.y, f.side.z],
        u: [f.up.x, f.up.y, f.up.z],
      })
    }
    const barrier = new THREE.Mesh(sweepProfile(barrierProfile, frames, { caps: false, uvScale: 0.42 }), concMat)
    barrier.castShadow = true
    barrier.receiveShadow = true
    barrier.name = 'barrier'
    g.add(barrier)
    return g
  }

  /* -------------------------------------------------------------- guardrail */
  buildGuardrail(): THREE.Group {
    const g = new THREE.Group()
    g.name = 'guardrail'
    // corrugated W-rail: two bands + spine (convex rings — the waist gap is
    // the corrugation shadow line that makes it read as a real guardrail)
    const bandA: [number, number][] = [[-6.16, 0.5], [-5.84, 0.5], [-5.84, 0.615], [-6.16, 0.615]]
    const bandB: [number, number][] = [[-6.16, 0.665], [-5.84, 0.665], [-5.84, 0.78], [-6.16, 0.78]]
    const spine: [number, number][] = [[-6.18, 0.47], [-6.06, 0.47], [-6.06, 0.81], [-6.18, 0.81]]
    const s0 = 158, s1 = 272
    const rows = Math.ceil((s1 - s0) / 2.6)
    const frames: SweepFrame[] = []
    for (let i = 0; i <= rows; i++) {
      const s = lerp(s0, s1, i / rows)
      const f = this.spline.frame(s)
      const dy = this.spline.bedY(s, -6.0) - f.pos.y + 0.02
      frames.push({ p: [f.pos.x, f.pos.y + dy, f.pos.z], s: [f.side.x, f.side.y, f.side.z], u: [f.up.x, f.up.y, f.up.z] })
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 0.82, roughness: 0.44 })
    const rail = new THREE.Mesh(mergeGeometries([bandA, bandB, spine].map((prof) => ({ geometry: sweepProfile(prof, frames, { caps: false, uvScale: 0.3 }) }))), steel)
    rail.castShadow = true
    rail.receiveShadow = true
    rail.name = 'guardrail-rail'
    g.add(rail)

    // posts with seeded jitter (spec §10 repetition rules)
    const postGeo = new THREE.BoxGeometry(0.085, 0.84, 0.085)
    postGeo.translate(0, 0.36, 0)
    const count = Math.floor((s1 - s0) / 3.4) + 1
    const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x707880, metalness: 0.7, roughness: 0.52 }), count)
    posts.castShadow = true
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    const p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1)
    const rj = new Rand(SEED ^ 0x9a11)
    for (let i = 0; i < count; i++) {
      const s = s0 + i * 3.4
      const lat = -6.0 + rj.range(-0.05, 0.05)
      const f = this.spline.frame(s)
      const dy = this.spline.bedY(s, lat) - f.pos.y
      p.copy(f.pos).addScaledVector(f.side, lat)
      p.y = f.pos.y + dy
      e.set(rj.range(-0.012, 0.012), f.yaw, rj.range(-0.02, 0.02))
      q.setFromEuler(e)
      m4.compose(p, q, sc)
      posts.setMatrixAt(i, m4)
    }
    posts.instanceMatrix.needsUpdate = true
    posts.name = 'guardrail-posts'
    g.add(posts)
    return g
  }

  /* ------------------------------------------------------- painted markings */
  private bar(s: number, lat: number, len: number, wide: number, lift: number): THREE.BufferGeometry {
    const p = new THREE.Vector3()
    const pts: number[] = [], uv = [0, 0, 1, 0, 1, 1, 0, 1]
    const corners: [number, number][] = [[s - len / 2, lat - wide / 2], [s - len / 2, lat + wide / 2], [s + len / 2, lat + wide / 2], [s + len / 2, lat - wide / 2]]
    for (const [cs, cl] of corners) { this.spline.surfacePoint(cs, cl, lift, p); pts.push(p.x, p.y, p.z) }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex([0, 1, 2, 0, 2, 3])
    sanitizeGeometry(geo)
    return geo
  }

  buildMarkings(sFrom: number, sTo: number): THREE.Mesh {
    const hw = TRACK.halfWidth
    const white: THREE.BufferGeometry[] = []
    const faded: THREE.BufferGeometry[] = []
    for (const side of [1, -1]) for (let s = sFrom + 2; s < sTo - 2; s += 4) white.push(this.bar(s, side * (hw - 0.42), 4.06, 0.15, 0.014))
    for (let s = sFrom + 3; s < sTo - 3; s += 7) white.push(this.bar(s + 1.7, 0, 3.4, 0.15, 0.014))
    for (let s = sFrom + 2; s < sTo - 2; s += 8) faded.push(this.bar(s + 2, hw * 0.45, 4, 0.14, 0.012))
    // landing-zone transverse bars after the lip (spec §7 landing zone)
    const r = TRACK.ramp
    for (let k = 0; k < 3; k++) white.push(this.bar(r.landingS + 0.6 + k * 1.7, 0, 0.34, hw * 2 - 1.1, 0.013))
    // approach chevrons before the kicker
    for (let k = 0; k < 3; k++) {
      const s0 = r.sStart - 5.4 - k * 2.3
      for (const dir of [-1, 1] as const) {
        const a = new THREE.Vector3(), b = new THREE.Vector3()
        this.spline.surfacePoint(s0, dir * 1.3, 0.012, a)
        this.spline.surfacePoint(s0 + 1.25, 0, 0.013, b)
        const dx = b.x - a.x, dz = b.z - a.z
        const L = Math.hypot(dx, dz) || 1
        const nx = (-dz / L) * 0.16, nz = (dx / L) * 0.16
        const pts = [a.x - nx, a.y, a.z - nz, a.x + nx, a.y, a.z + nz, b.x + nx, b.y, b.z + nz, b.x - nx, b.y, b.z - nz]
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
        geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
        geo.setIndex([0, 1, 2, 0, 2, 3])
        sanitizeGeometry(geo)
        white.push(geo)
      }
    }
    const geo = mergeGeometries([
      ...white.map((geometry) => ({ geometry, materialIndex: 0 })),
      ...faded.map((geometry) => ({ geometry, materialIndex: 1 })),
    ])
    const pm = (color: number, po: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
      color, roughness: 0.68, metalness: 0, polygonOffset: true, polygonOffsetFactor: po, polygonOffsetUnits: po,
    })
    const mesh = new THREE.Mesh(geo, [pm(0xe6e4da, -3), pm(0x9b9a92, -2)])
    mesh.name = 'road-markings'
    return mesh
  }

  /* ------------------------------------------------- asphalt patch decals */
  buildPatches(sFrom: number, sTo: number): THREE.Mesh {
    const rnd = new Rand(SEED ^ 0x7e2b)
    const parts: { geometry: THREE.BufferGeometry; matrix?: THREE.Matrix4 }[] = []
    const p = new THREE.Vector3()
    for (let k = 0; k < 15; k++) {
      const s = rnd.range(sFrom + 4, sTo - 4)
      const lat = rnd.range(-4.4, 4.4)
      const sx = rnd.range(1.1, 2.6)
      const sz = sx * rnd.range(0.75, 1.25)
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd.range(0, Math.PI * 2))
      this.spline.surfacePoint(s, lat, 0.012, p)
      const m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(sx, 1, sz))
      parts.push({ geometry: new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2), matrix: m })
    }
    const geo = mergeGeometries(parts)
    const mat = new THREE.MeshStandardMaterial({
      map: patchDecalTexture(), transparent: true, opacity: 0.96, roughness: 0.94,
      metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 2
    mesh.name = 'road-patches'
    return mesh
  }

  private buildDrains(): THREE.Group {
    const g = new THREE.Group()
    g.name = 'drains'
    const n = 7
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.06, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x2c2f33, metalness: 0.75, roughness: 0.62 }), n)
    inst.receiveShadow = true
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    const p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1)
    const rnd = new Rand(SEED ^ 0x33c1)
    for (let i = 0; i < n; i++) {
      const s = 166 + i * 13.5 + rnd.range(-2, 2)
      const f = this.spline.frame(s)
      const lat = 6.05 + rnd.range(-0.1, 0.1)
      p.copy(f.pos).addScaledVector(f.side, lat)
      p.y = this.spline.bedY(s, lat) + 0.02
      e.set(0, f.yaw + rnd.range(-0.05, 0.05), 0)
      q.setFromEuler(e)
      m4.compose(p, q, sc)
      inst.setMatrixAt(i, m4)
    }
    inst.instanceMatrix.needsUpdate = true
    g.add(inst)
    return g
  }

  /* ---------------------------------------------------------------- kicker */
  /** Modelled launch ramp: slab loft above the road, painted launch face,
   *  side-transition aprons with steel guide rails (spec §7). */
  private buildKicker(): THREE.Group {
    const g = new THREE.Group()
    g.name = 'kicker'
    const r = TRACK.ramp
    const conc = concreteMaps(0x9c968a, 77)
    const asphalt = asphaltMaps()

    // --- slab: top rows + under-rows closed by side walls/bottom/lip cap
    const cols = [-RAMP_INSET, -RAMP_INSET * 0.45, 0, RAMP_INSET * 0.45, RAMP_INSET]
    const n = cols.length
    const rows = 30
    const sA = r.sStart - 1.6, sB = r.sLip
    const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = []
    const p = new THREE.Vector3(), c = new THREE.Color()
    for (let i = 0; i <= rows; i++) {
      const s = lerp(sA, sB, i / rows)
      const lift = rampLiftAt(s) + 0.015
      for (const lat of cols) {
        this.spline.surfacePoint(s, lat, lift, p)
        pos.push(p.x, p.y, p.z)
        uv.push(lat * 0.2, s * 0.2)
        roadVertexColor(s, lat, c)
        c.multiplyScalar(1.02)
        col.push(c.r, c.g, c.b)
      }
    }
    const nTop = pos.length / 3
    for (let i = 0; i <= rows; i++) {
      const s = lerp(sA, sB, i / rows)
      for (const lat of cols) {
        const topY = this.spline.surfacePoint(s, lat, 0, new THREE.Vector3()).y
        this.absPoint(s, lat, topY - 0.03, p)
        pos.push(p.x, p.y, p.z)
        uv.push(lat * 0.2, s * 0.2)
        col.push(0.42, 0.4, 0.37)
      }
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = a + n
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
    // side walls
    for (const j of [0, n - 1]) for (let i = 0; i < rows; i++) {
      const t0 = i * n + j, t1 = t0 + n
      const d0 = nTop + i * n + j, d1 = d0 + n
      if (j === 0) idx.push(t0, d0, t1, t1, d0, d1)
      else idx.push(t0, t1, d0, t1, d1, d0)
    }
    // bottom face
    for (let i = 0; i < rows; i++) for (let j = 0; j < n - 1; j++) {
      const a = nTop + i * n + j, b = a + n
      idx.push(a, a + 1, b, a + 1, b + 1, b)
    }
    // start cap (low end; ramp lift ~0 there so it is a thin seal)
    for (let j = 0; j < n - 1; j++) {
      const t0 = j, t1 = j + 1, d0 = nTop + j, d1 = d0 + 1
      idx.push(t0, t1, d0, t1, d1, d0)
    }
    const slabGeo = new THREE.BufferGeometry()
    slabGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    slabGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    slabGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    slabGeo.setIndex(idx)
    sanitizeGeometry(slabGeo)
    const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({
      map: asphalt.map, normalMap: asphalt.normalMap, roughnessMap: asphalt.roughnessMap,
      roughness: 0.9, metalness: 0.02, vertexColors: true, side: THREE.DoubleSide,
    }))
    slab.castShadow = true
    slab.receiveShadow = true
    slab.name = 'kicker-slab'
    g.add(slab)

    // launch face at the lip, dropping below the road (reads as built mass)
    const fp: number[] = [], fu: number[] = [], fi: number[] = []
    const lf = 9
    for (let j = 0; j < lf; j++) {
      const lat = lerp(-RAMP_INSET - 0.15, RAMP_INSET + 0.15, j / (lf - 1))
      const top = this.spline.surfacePoint(r.sLip, lat, r.height + 0.015, new THREE.Vector3())
      const botY = this.spline.bedY(r.sLip, lat) - 0.06 - this.spline.surfacePoint(r.sLip, 0, 0, new THREE.Vector3()).y + this.spline.surfacePoint(r.sLip, 0, 0, new THREE.Vector3()).y
      const bot = this.absPoint(r.sLip, lat, this.spline.bedY(r.sLip, lat) - 0.06, new THREE.Vector3())
      void botY
      fp.push(top.x, top.y, top.z, bot.x, bot.y, bot.z)
      fu.push(j / (lf - 1), 1, j / (lf - 1), 0)
    }
    for (let j = 0; j < lf - 1; j++) {
      const a = j * 2
      fi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const faceGeo = new THREE.BufferGeometry()
    faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3))
    faceGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2))
    faceGeo.setIndex(fi)
    sanitizeGeometry(faceGeo)
    const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({
      map: kickerFaceTexture(), roughness: 0.82, metalness: 0.03, side: THREE.DoubleSide,
    }))
    face.castShadow = true
    face.receiveShadow = true
    face.name = 'kicker-face'
    g.add(face)

    // side-transition aprons + steel guide rails
    for (const side of [1, -1] as const) {
      const apron = new THREE.Mesh(this.kickerApron(side), new THREE.MeshStandardMaterial({
        map: conc.map, normalMap: conc.normalMap, roughnessMap: conc.roughnessMap, roughness: 0.85, metalness: 0.03, side: THREE.DoubleSide,
      }))
      apron.castShadow = true
      apron.receiveShadow = true
      apron.name = `kicker-apron-${side > 0 ? 'r' : 'l'}`
      g.add(apron)
      const guide = new THREE.Mesh(this.kickerGuide(side), new THREE.MeshStandardMaterial({ color: 0xb8bec6, metalness: 0.85, roughness: 0.35 }))
      guide.castShadow = true
      guide.name = `kicker-guide-${side > 0 ? 'r' : 'l'}`
      g.add(guide)
    }
    return g
  }

  private kickerApron(side: 1 | -1): THREE.BufferGeometry {
    const r = TRACK.ramp
    const rows = 14
    const pos: number[] = [], uv: number[] = [], idx: number[] = []
    for (let i = 0; i <= rows; i++) {
      const s = lerp(r.sStart - 1.6, r.sLip, i / rows)
      const lift = rampLiftAt(s) + 0.015
      const inner = this.spline.surfacePoint(s, side * RAMP_INSET, lift, new THREE.Vector3())
      const outerY = lift > 0.06 ? this.spline.surfacePoint(s, side * 6.9, lift * 0.42 - 0.02, new THREE.Vector3()).y : this.spline.bedY(s, side * 6.9)
      const outer = this.absPoint(s, side * 6.9, outerY, new THREE.Vector3())
      pos.push(inner.x, inner.y, inner.z, outer.x, outer.y, outer.z)
      uv.push(0, s * 0.25, 1, s * 0.25)
    }
    for (let i = 0; i < rows; i++) {
      const a = i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    sanitizeGeometry(geo)
    return geo
  }

  private kickerGuide(side: 1 | -1): THREE.BufferGeometry {
    const r = TRACK.ramp
    const frames: SweepFrame[] = []
    const rows = 16
    for (let i = 0; i <= rows; i++) {
      const s = lerp(r.sStart - 1.2, r.sLip - 0.1, i / rows)
      const f = this.spline.frame(s)
      const lift = rampLiftAt(s) + 0.015
      const base = lift > 0.06 ? lift * 0.42 - 0.02 : 0
      const lat = side * 6.85
      const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, lat)
      p.y = this.spline.bedY(s, lat) + base + 0.36
      frames.push({ p: [p.x, p.y, p.z], s: [f.side.x, f.side.y, f.side.z], u: [f.up.x, f.up.y, f.up.z] })
    }
    return sweepProfile([[0, 0], [0.055, 0], [0.055, 0.065], [0, 0.065]], frames, { caps: true, uvScale: 1 })
  }
}
