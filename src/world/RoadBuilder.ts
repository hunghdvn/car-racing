import * as THREE from 'three'
import { TRACK, SEED, type ZoneId } from '../config'
import { Rand, clamp, lerp, smoothstep, fbm2, mergeGeometries, sanitizeGeometry, crNormals, sweepProfile, ensureOutwardWinding, forceUpWinding, type SweepFrame } from '../util'

const UP = new THREE.Vector3(0, 1, 0)
import { asphaltMaps, concreteMaps, curbStripeTexture, gravelMaps, patchDecalTexture, kickerFaceTexture, finishBannerTexture, billboardFaceTexture } from '../assets/Textures'
import { rockGeometry } from './VegetationKit'
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
  private mats: Record<string, THREE.Material> = {}

  constructor(spline: TrackSpline, field: HeightField | null) {
    this.spline = spline
    this.field = field
    this.group.name = 'road'
  }

  /** Build the road over [sFrom,sTo] in ~150 m station chunks. Chunking keeps
   *  every mesh's bounding volume local so both the camera and the sun's shadow
   *  frustum can cull the ~3.1 km circuit (one merged mesh spanning the whole
   *  loop is never culled and re-draws the entire track into the shadow map). */
  build(sFrom: number, sTo: number): THREE.Group {
    const g = this.group
    const CHUNK = 150
    const tz = this.spline.zoneRange('tunnel')
    const ez = this.spline.zoneRange('elevated')
    const ezPre = ez
    const emit = (a: number, b: number, tag: string): void => {
      const seg = new THREE.Group()
      seg.name = tag
      seg.add(this.buildAsphalt(a, b))
      seg.add(this.buildShoulders(a, b))
      // under the flying deck the skirt would read as an embankment wall;
      // the deckRun soffit/girder/fascia close the underside instead
      if (!(b > ezPre.s0 - 3 && a < ezPre.s1 + TRACK.bridge.abutment)) seg.add(this.buildSkirts(a, b))
      seg.add(this.buildMarkings(a, b))
      seg.add(this.buildPatches(a, b))
      const mid = (a + b) / 2
      const zone = this.spline.zoneAt(mid)
      // Zone content is emitted by COVERAGE, not by the chunk's mid station:
      // the bore and the deck straddle chunk seams, and a mid-zone test dropped
      // exactly the seam chunks that carry the portals and the abutments.
      const tPad = TRACK.tunnel.apron + 7
      const inTunnel = b > tz.s0 - tPad && a < tz.s1 + tPad
      const inDeck = b > ez.s0 - 3 && a < ez.s1 + TRACK.bridge.abutment
      if (inTunnel) {
        seg.add(this.tunnelRun(a, b))
        if (zone === 'tunnel') {
          // the authored portal-approach barriers still belong outside the bore
          const bg = new THREE.Group()
          bg.name = `edge-barrier-${Math.round(a)}`
          for (const w of RoadBuilder.windows(TRACK.edge.barrier, a, b)) this.barrierRun(bg, w.s0, w.s1)
          seg.add(bg)
        }
      } else if (inDeck) {
        seg.add(this.deckRun(a, b))
      } else {
        seg.add(this.zoneEdgeRun(a, b, zone))
      }
      if (inDeck && inTunnel) seg.add(this.deckRun(a, b))
      g.add(seg)
    }
    for (let a = sFrom; a < sTo - 1; a += CHUNK) emit(a, Math.min(sTo, a + CHUNK), `road-seg-${Math.round(a)}`)
    // The circuit closes on itself: the finish line sits exactly on the seam at
    // s = 0 = length, so the stubs either side of it are paved too.
    if (sFrom > 0.05) emit(0, Math.min(sFrom, 4), 'road-seam-head')
    if (sTo < this.spline.length - 0.05) emit(Math.max(sTo, this.spline.length - 4), this.spline.length, 'road-seam-tail')
    // The frozen Phase-3 coastal edge stack is authored once, over its own
    // windows, and stays byte-identical to the approved slice.
    g.add(this.buildEdgeProfiles(0, this.spline.length))
    g.add(this.buildGuardrail())
    g.add(this.buildDrains())
    g.add(this.buildKicker())
    g.add(this.buildFinish())
    g.add(this.buildShortcut())
    // An InstancedMesh whose count exceeds its allocated capacity makes the GPU
    // read past the end of the instance buffer — on screen that is black garbage
    // geometry that is maddening to diagnose from a screenshot, so fail loudly
    // here instead (spec §21 discipline).
    const walk = (o: THREE.Object3D, path: string): void => {
      const im = o as unknown as { isInstancedMesh?: boolean; count?: number; instanceMatrix?: { count?: number }; matrix?: { elements: number[] } }
      if (im.isInstancedMesh && im.instanceMatrix?.count) {
        const cap = im.instanceMatrix.count // items, not floats, in this fork
        if ((im.count ?? 0) > cap) {
          const e = im.matrix?.elements
          const at = e ? `@(${e[12].toFixed(0)},${e[13].toFixed(0)},${e[14].toFixed(0)})` : ''
          throw new Error(`[road] instanced overflow: ${path}/<${o.name || 'unnamed'}>${at} ${im.count} > ${cap} (raw ${im.instanceMatrix.count})`)
        }
      }
      for (const c of o.children) walk(c, `${path}/${o.name || o.type}`)
    }
    walk(g, 'road')
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
    up?: THREE.Vector3,
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
    if (up) forceUpWinding(geo, up)
    return geo
  }

  /* --------------------------------------------------------------- asphalt */
  private asphaltMat(): THREE.MeshStandardMaterial {
    const m = asphaltMaps()
    const mat = new THREE.MeshStandardMaterial({
      map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap,
      roughness: 0.92, metalness: 0.02, vertexColors: true,
    })
    mat.normalScale = new THREE.Vector2(0.8, 0.8)
    return mat
  }

  buildAsphalt(sFrom: number, sTo: number): THREE.Mesh {
    const hw = TRACK.halfWidth
    const cols = [-hw, -hw * 0.6, -hw * 0.22, hw * 0.22, hw * 0.6, hw]
    const geo = this.loft(sFrom, sTo, 0.9, cols,
      (s, lat, out) => { this.spline.surfacePoint(s, lat, rampLiftAt(s), out); },
      0.2, (s, lat, c) => roadVertexColor(s, lat, c), false, UP)
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
        },
        false, UP)
    }
    const geo = mergeGeometries([
      { geometry: build(1) },
      { geometry: build(-1) },
    ])
    const mat = new THREE.MeshStandardMaterial({ map: gr.map, normalMap: gr.normalMap, roughness: 0.98, metalness: 0, vertexColors: true })
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
    // dash lattices are keyed to the GLOBAL station grid so chunk boundaries
    // never drop or duplicate a bar (each chunk owns the lattice points in it)
    const lattice = (from: number, step: number, pad: number, end: number): number[] => {
      const out: number[] = []
      for (let i = Math.ceil((from - pad) / step); ; i++) {
        const s = pad + i * step
        if (s >= end - pad) break
        out.push(s)
      }
      return out
    }
    for (const side of [1, -1]) for (const s of lattice(sFrom, 4, 2, sTo)) white.push(this.bar(s, side * (hw - 0.42), 4.06, 0.15, 0.014))
    for (const s of lattice(sFrom, 7, 3, sTo)) if (!this.atSpurMouth(s + 1.7)) white.push(this.bar(s + 1.7, 0, 3.4, 0.15, 0.014))
    for (const s of lattice(sFrom, 8, 2, sTo)) faded.push(this.bar(s + 2, hw * 0.45, 4, 0.14, 0.012))
    // landing-zone transverse bars after the lip (spec §7 landing zone)
    const r = TRACK.ramp
    if (r.landingS >= sFrom && r.landingS < sTo) {
      for (let k = 0; k < 3; k++) white.push(this.bar(r.landingS + 0.6 + k * 1.7, 0, 0.34, hw * 2 - 1.1, 0.013))
    }
    // approach chevrons before the kicker
    if (r.sStart >= sFrom && r.sStart < sTo) for (let k = 0; k < 3; k++) {
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
    const rnd = new Rand(SEED ^ 0x7e2b ^ Math.imul(0x9e3779b1, Math.round(sFrom * 7 + 13)))
    const parts: { geometry: THREE.BufferGeometry; matrix?: THREE.Matrix4 }[] = []
    const p = new THREE.Vector3()
    const count = Math.max(2, Math.round((sTo - sFrom) / 22))
    for (let k = 0; k < count; k++) {
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
    ensureOutwardWinding(slabGeo)
    const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({
      map: asphalt.map, normalMap: asphalt.normalMap, roughnessMap: asphalt.roughnessMap,
      roughness: 0.9, metalness: 0.02, vertexColors: true,
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

  /* ════════════════════════ circuit structures (Phase 5) ═══════════════════════ *
   * Everything the appended zones need that the frozen coastal slice never did:
   * per-zone edge assemblies, the tunnel bore with its portals and light pools,
   * the elevated viaduct (deck structure, parapets, pylons, joints), the finish
   * gantry over the lap seam and the guarded infield shortcut.                  */

  private mat(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.mats[key] as THREE.Material | undefined
    if (!m) { m = make(); this.mats[key] = m }
    return m
  }

  private static windows(list: readonly { s0: number; s1: number; style?: string }[], a: number, b: number): { s0: number; s1: number; style?: string }[] {
    const out: { s0: number; s1: number; style?: string }[] = []
    for (const w of list) {
      const s0 = Math.max(a, w.s0), s1 = Math.min(b, w.s1)
      if (s1 - s0 > 2.5) out.push({ s0, s1, style: w.style })
    }
    return out
  }

  private concMat(tone = 0xa9a49a, seed = 51, rough = 0.85): THREE.MeshStandardMaterial {
    return this.mat(`conc${tone}/${seed}`, () => {
      const c = concreteMaps(tone, seed)
      return new THREE.MeshStandardMaterial({ map: c.map, normalMap: c.normalMap, roughnessMap: c.roughnessMap, roughness: rough, metalness: 0.02 })
    }) as THREE.MeshStandardMaterial
  }

  private steelMat(color: number, metal = 0.82, rough = 0.44): THREE.MeshStandardMaterial {
    return this.mat(`steel${color}/${metal}/${rough}`, () => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough })) as THREE.MeshStandardMaterial
  }

  /** Kerb + painted stripe on both edges (style picks the stripe palette). */
  private kerbRun(g: THREE.Group, s0: number, s1: number, style: 'coast' | 'hazard' | 'standard' | 'city'): void {
    const conc = this.concMat()
    const stripeKind = style === 'hazard' ? 'rumble' : style === 'standard' ? 'standard' : 'curb'
    const stripeMat = this.mat(`stripe-${stripeKind}`, () => new THREE.MeshStandardMaterial({
      map: curbStripeTexture(stripeKind), roughness: 0.8, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })) as THREE.MeshStandardMaterial
    const curbChain: [number, number][] = [[5.32, -0.02], [5.32, 0.13], [6.12, 0.16], [6.26, 0.13], [6.26, -0.03], [6.7, -0.05]]
    const stripeChain: [number, number][] = [[5.325, -0.005], [6.115, 0.145], [6.25, 0.115]]
    for (const side of [1, -1] as const) {
      const curb = new THREE.Mesh(this.chainStrip(side, s0, s1, 6.4, curbChain, 0.34), conc)
      curb.castShadow = true
      curb.receiveShadow = true
      curb.name = 'curb'
      g.add(curb)
      const stripe = new THREE.Mesh(this.chainStrip(side, s0, s1, 6.4, stripeChain, 0.172), stripeMat)
      stripe.renderOrder = 1
      g.add(stripe)
    }
  }

  private rumbleRun(g: THREE.Group, s0: number, s1: number): void {
    const chain: [number, number][] = [[5.32, -0.01], [5.32, 0.03], [6.28, 0.045], [6.38, 0.02], [6.38, -0.02]]
    const mat = this.mat('rumble', () => new THREE.MeshStandardMaterial({ map: curbStripeTexture('rumble'), roughness: 0.75, metalness: 0.04 })) as THREE.MeshStandardMaterial
    for (const side of [1, -1] as const) {
      const m = new THREE.Mesh(this.chainStrip(side, s0, s1, 6.2, chain, 0.155), mat)
      m.receiveShadow = true
      m.name = 'rumble'
      g.add(m)
    }
  }

  /** Segment-jointed concrete barrier, both edges. */
  private barrierRun(g: THREE.Group, s0: number, s1: number): void {
    const profile: [number, number][] = [
      [6.55, 0.02], [7.32, 0.02], [7.14, 0.17], [6.98, 0.36], [6.92, 0.74], [6.87, 0.88], [6.72, 0.88], [6.66, 0.74], [6.6, 0.36], [6.55, 0.14],
    ]
    const conc = this.concMat()
    for (const side of [1, -1] as const) {
      const frames: SweepFrame[] = []
      const rows = Math.max(2, Math.ceil((s1 - s0) / 1.6))
      for (let i = 0; i <= rows; i++) {
        const s = lerp(s0, s1, i / rows)
        const f = this.spline.frame(s)
        const dy = this.spline.bedY(s, side * 6.9) - f.pos.y
        frames.push({ p: [f.pos.x, f.pos.y + dy, f.pos.z], s: [f.side.x * side, f.side.y * side, f.side.z * side], u: [f.up.x, f.up.y, f.up.z] })
      }
      const m = new THREE.Mesh(sweepProfile(profile, frames, { caps: false, uvScale: 0.42 }), conc)
      m.castShadow = true
      m.receiveShadow = true
      m.name = 'barrier'
      g.add(m)
    }
  }

  /** Corrugated W-rail with posts on a global lattice (seam-free across chunks). */
  private guardRun(g: THREE.Group, s0: number, s1: number): void {
    const bandA: [number, number][] = [[-6.16, 0.5], [-5.84, 0.5], [-5.84, 0.615], [-6.16, 0.615]]
    const bandB: [number, number][] = [[-6.16, 0.665], [-5.84, 0.665], [-5.84, 0.78], [-6.16, 0.78]]
    const spine: [number, number][] = [[-6.18, 0.47], [-6.06, 0.47], [-6.06, 0.81], [-6.18, 0.81]]
    const steel = this.steelMat(0x9aa2ab)
    for (const side of [1, -1] as const) {
      const frames: SweepFrame[] = []
      const rows = Math.max(2, Math.ceil((s1 - s0) / 2.6))
      for (let i = 0; i <= rows; i++) {
        const s = lerp(s0, s1, i / rows)
        const f = this.spline.frame(s)
        const dy = this.spline.bedY(s, side * -6.0) - f.pos.y + 0.02
        frames.push({ p: [f.pos.x, f.pos.y + dy, f.pos.z], s: [f.side.x * side, f.side.y * side, f.side.z * side], u: [f.up.x, f.up.y, f.up.z] })
      }
      const rail = new THREE.Mesh(mergeGeometries([bandA, bandB, spine].map((p) => ({ geometry: sweepProfile(p, frames, { caps: false, uvScale: 0.3 }) }))), steel)
      rail.castShadow = true
      rail.receiveShadow = true
      rail.name = 'guardrail-rail'
      g.add(rail)
    }
    // posts on the absolute lattice so chunk seams never double up or gap
    const post = new THREE.BoxGeometry(0.085, 0.84, 0.085)
    post.translate(0, 0.36, 0)
    const start = Math.ceil(s0 / 3.4) * 3.4
    const count = Math.floor((s1 - start) / 3.4) + 1
    // two posts per lattice station (both verges) — the capacity has to cover both
    const posts = new THREE.InstancedMesh(post, this.steelMat(0x707880, 0.7, 0.52), Math.max(1, count * 2))
    posts.castShadow = true
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    const p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1)
    const rj = new Rand(SEED ^ 0x9a11)
    let n = 0
    for (let i = 0; i < count; i++) {
      const s = start + i * 3.4
      for (const side of [1, -1] as const) {
        const lat = side * 6.0 + rj.range(-0.05, 0.05)
        const f = this.spline.frame(s)
        p.copy(f.pos).addScaledVector(f.side, lat)
        p.y = f.pos.y + (this.spline.bedY(s, lat) - f.pos.y)
        e.set(rj.range(-0.012, 0.012), f.yaw, rj.range(-0.02, 0.02))
        q.setFromEuler(e)
        m4.compose(p, q, sc)
        posts.setMatrixAt(n++, m4)
      }
    }
    posts.count = Math.min(n, Math.max(1, count * 2))
    posts.instanceMatrix.needsUpdate = true
    posts.name = 'guardrail-posts'
    g.add(posts)
  }

  /** Tyre-barrier bags (instanced) against a high-speed exit. */
  private tyreRun(g: THREE.Group, s0: number, s1: number): void {
    const rows = Math.max(1, Math.round((s1 - s0) / 1.2))
    const geo = new THREE.CylinderGeometry(0.34, 0.34, 0.36, 10)
    const inst = new THREE.InstancedMesh(geo, this.mat('tyre', () => new THREE.MeshStandardMaterial({ color: 0x21232a, roughness: 0.86, metalness: 0.05 })) as THREE.Material, rows * 8 * 3)
    inst.castShadow = true
    inst.receiveShadow = true
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    const p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1)
    const rnd = new Rand(SEED ^ 0x51a7)
    let n = 0
    for (let i = 0; i < rows; i++) {
      const s = s0 + (i + 0.5) * (s1 - s0) / rows
      const f = this.spline.frame(s)
      for (let k = 0; k < 8; k++) for (let tier = 0; tier < 3; tier++) {
        const lat = -6.9 - (k % 2) * 0.62
        const base = this.spline.bedY(s, lat)
        p.copy(f.pos).addScaledVector(f.side, lat + rnd.range(-0.04, 0.04))
        p.y = base + 0.19 + tier * 0.355
        e.set(rnd.range(-0.05, 0.05), f.yaw + rnd.range(-0.2, 0.2), rnd.range(-0.05, 0.05))
        q.setFromEuler(e)
        m4.compose(p, q, sc)
        inst.setMatrixAt(n++, m4)
      }
    }
    inst.count = n
    inst.instanceMatrix.needsUpdate = true
    inst.name = 'tyres'
    g.add(inst)
  }

  /** Chevron alignment boards facing the driver into a corner. */
  private chevronRun(g: THREE.Group, s0: number, s1: number): void {
    const plate = new THREE.BoxGeometry(1.5, 1.1, 0.08)
    const chev = new THREE.BoxGeometry(0.3, 0.86, 0.1)
    const boards = Math.max(1, Math.round((s1 - s0) / 6))
    const plateInst = new THREE.InstancedMesh(plate, this.mat('chevPlate', () => new THREE.MeshStandardMaterial({ color: 0xe9e6dd, roughness: 0.7 })) as THREE.Material, boards)
    const chevInst = new THREE.InstancedMesh(chev, this.mat('chevInk', () => new THREE.MeshStandardMaterial({ color: 0x1d2026, roughness: 0.68 })) as THREE.Material, boards * 2)
    plateInst.castShadow = true
    chevInst.castShadow = true
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    const p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1)
    let nc = 0
    for (let i = 0; i < boards; i++) {
      const s = s0 + (i + 0.5) * (s1 - s0) / boards
      const f = this.spline.frame(s)
      const lat = -8.6
      const base = this.spline.bedY(s, lat)
      p.copy(f.pos).addScaledVector(f.side, lat)
      p.y = base + 1.35
      e.set(0, f.yaw + Math.PI / 2, 0)
      q.setFromEuler(e)
      m4.compose(p, q, sc)
      plateInst.setMatrixAt(i, m4)
      for (const off of [-0.34, 0.34]) {
        p.copy(f.pos).addScaledVector(f.side, lat - 0.07)
        p.y = base + 1.35
        e.set(0, f.yaw + Math.PI / 2 + off * 0.55, 0)
        q.setFromEuler(e)
        m4.compose(p, q, sc)
        chevInst.setMatrixAt(nc++, m4)
      }
    }
    plateInst.instanceMatrix.needsUpdate = true
    chevInst.count = nc
    chevInst.instanceMatrix.needsUpdate = true
    plateInst.name = 'chevron-plate'
    chevInst.name = 'chevron-ink'
    g.add(plateInst, chevInst)
  }

  /** Per-zone edge stack for one station chunk (the coastal slice keeps its
   *  authored Phase-3 assemblies, which stay byte-identical). */
  zoneEdgeRun(a: number, b: number, zone: ZoneId): THREE.Group {
    const g = new THREE.Group()
    g.name = `edge-${zone}-${Math.round(a)}`
    if (zone === 'coastal') return g
    const E = TRACK.edge
    for (const w of RoadBuilder.windows(E.kerb, a, b)) this.kerbRun(g, w.s0, w.s1, 'standard')
    for (const w of RoadBuilder.windows(E.rumble, a, b)) this.rumbleRun(g, w.s0, w.s1)
    for (const w of RoadBuilder.windows(E.barrier, a, b)) this.barrierRun(g, w.s0, w.s1)
    for (const w of RoadBuilder.windows(E.guard, a, b)) this.guardRun(g, w.s0, w.s1)
    for (const w of RoadBuilder.windows(E.tyres, a, b)) this.tyreRun(g, w.s0, w.s1)
    for (const w of RoadBuilder.windows(E.chevrons, a, b)) this.chevronRun(g, w.s0, w.s1)
    return g
  }

  /* ───────────────────────────── tunnel bore ───────────────────────────── *
   * The terrain ridge passes OVER the tube; the shell is the readable inside,
   * with a dark wainscot, a reflective band at eye height, ribs, emissive
   * fittings and additive light pools on the asphalt (dark-but-not-black). */
  private tunnelRun(a: number, b: number): THREE.Group {
    const g = new THREE.Group()
    g.name = `tunnel-${Math.round(a)}`
    const T = TRACK.tunnel
    const rng = this.spline.zoneRange('tunnel')
    // the shell spans portal-face to portal-face (not the full apron window):
    // tube protruding beyond a portal reads as a floating culvert, and the rock
    // is supposed to meet the PORTAL, not the tube
    const s0 = Math.max(a, rng.s0 - 1.6), s1 = Math.min(b, rng.s1 + 1.6)
    if (s1 - s0 < 1) return g
    const H = T.tubeHalf, R = T.tubeRise, so = TRACK.shoulderOuter
    const prof: [number, number][] = [
      [-H - 0.6, -0.9], [-H, -0.9], [-H, R * 0.4], [-H * 0.94, R * 0.72],
      [-H * 0.66, R * 0.9], [-H * 0.33, R * 0.985], [0, R],
      [H * 0.33, R * 0.985], [H * 0.66, R * 0.9], [H * 0.94, R * 0.72],
      [H, R * 0.4], [H, -0.9], [H + 0.6, -0.9],
    ]
    const lift = prof.map((p) => p[1])
    const cols = prof.map((p) => p[0])
    const conc = this.concMat(0x8f8c86, 131, 0.9)
    conc.side = THREE.DoubleSide
    const bed = (s: number, lat: number): number => this.spline.bedY(s, clamp(lat, -so - 3, so + 3))
    const shell = new THREE.Mesh(this.loft(s0, s1, 1.4, cols,
      (s, lat, out, j) => this.absPoint(s, lat, bed(s, lat) + lift[j], out),
      0.22,
      (s, lat, c, j) => {
        const h = lift[j] / R
        const v = 0.2 + fbm2(s * 0.07 + 2.2, j * 1.31 + 0.7, 2) * 0.055
        if (h < 0.2) c.setRGB(v * 0.78, v * 0.79, v * 0.84)
        else if (h < 0.36) c.setRGB(0.64, 0.625, 0.56)
        else c.setRGB(v, v * 0.985, v * 0.93)
      }), conc)
    shell.receiveShadow = true
    shell.name = 'tunnel-shell'
    g.add(shell)

    // ribs: one arch band instanced along the bore
    const centre = R * 0.42
    const ribPos: number[] = [], ribIdx: number[] = []
    const depth = 0.42
    for (const zc of [0, depth]) for (const [lat, y] of prof) {
      const ox = lat - 0, oy = y - centre
      const l = Math.hypot(ox, oy) || 1
      ribPos.push(lat + (ox / l) * 0.14, y + (oy / l) * 0.14, zc)
    }
    const pn = prof.length
    for (const base of [0, pn]) for (let j = 0; j < pn - 1; j++) {
      const a0 = base + j, b0 = a0 + pn
      ribIdx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1)
    }
    const ribGeo = new THREE.BufferGeometry()
    ribGeo.setAttribute('position', new THREE.Float32BufferAttribute(ribPos, 3))
    ribGeo.setIndex(ribIdx)
    sanitizeGeometry(ribGeo)
    crNormals(ribGeo)
    ribGeo.translate(0, 0, -depth / 2)
    const ribMat = this.concMat(0x75736e, 211, 0.88)
    ribMat.side = THREE.DoubleSide
    const ribN = Math.max(1, Math.floor((s1 - s0) / T.ribEvery))
    const ribs = new THREE.InstancedMesh(ribGeo, ribMat, ribN)
    ribs.castShadow = false
    ribs.receiveShadow = true

    // fittings + light pools
    const fitGeo = new THREE.BoxGeometry(3.4, 0.1, 0.3)
    const fitMat = new THREE.MeshStandardMaterial({ color: 0xf2e6c8, emissive: 0xffe3ab, emissiveIntensity: 2.1, roughness: 0.5 })
    const poolGeo = new THREE.PlaneGeometry(6.6, 10.5, 4, 6)
    poolGeo.rotateX(-Math.PI / 2)
    {
      const pp = poolGeo.getAttribute('position')
      const cc = new Float32Array(pp.count * 3)
      for (let i = 0; i < pp.count; i++) {
        const dx = Math.abs(pp.getX(i)) / 3.3, dz = Math.abs(pp.getZ(i)) / 5.25
        const f = clamp(1 - Math.max(dx, dz), 0, 1)
        cc[i * 3] = f * f; cc[i * 3 + 1] = f * f * 0.86; cc[i * 3 + 2] = f * f * 0.6
      }
      poolGeo.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3))
      sanitizeGeometry(poolGeo)
    }
    const poolMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    const lightN = Math.max(1, Math.floor((s1 - s0) / T.lightEvery))
    const fits = new THREE.InstancedMesh(fitGeo, fitMat, lightN)
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, lightN)
    pools.renderOrder = 3

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    const p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1)
    for (let i = 0; i < ribN; i++) {
      const s = s0 + (i + 0.5) * (s1 - s0) / ribN
      const f = this.spline.frame(s)
      p.copy(f.pos).addScaledVector(f.side, 0)
      p.y = bed(s, 0)
      e.set(0, f.yaw, 0)
      q.setFromEuler(e)
      m4.compose(p, q, sc)
      ribs.setMatrixAt(i, m4)
    }
    for (let i = 0; i < lightN; i++) {
      const s = s0 + (i + 0.5) * (s1 - s0) / lightN
      const f = this.spline.frame(s)
      p.copy(f.pos); p.y = bed(s, 0) + R - 0.14
      e.set(0, f.yaw, 0)
      q.setFromEuler(e)
      m4.compose(p, q, sc)
      fits.setMatrixAt(i, m4)
      p.copy(f.pos); p.y = this.spline.surfaceY(s, 0) + 0.014
      m4.compose(p, q, new THREE.Vector3(1, 1, 1))
      pools.setMatrixAt(i, m4)
    }
    ribs.instanceMatrix.needsUpdate = true
    fits.instanceMatrix.needsUpdate = true
    pools.instanceMatrix.needsUpdate = true
    ribs.name = 'tunnel-ribs'; fits.name = 'tunnel-fittings'; pools.name = 'tunnel-pools'
    g.add(ribs, fits, pools)

    // portals where this chunk reaches an end of the bore
    for (const [se, dir] of [[rng.s0, -1], [rng.s1, 1]] as const) {
      if (se < a || se > b) continue
      g.add(this.portalAt(se, dir))
    }
    return g
  }

  /** Portal frame: jambs, a deep lintel with a sign band, wing walls into the
   *  rock and mouth ribs, so the bore reads as driven through a ridge. */
  private portalAt(s: number, dir: -1 | 1): THREE.Group {
    const g = new THREE.Group()
    g.name = 'tunnel-portal'
    const T = TRACK.tunnel
    const f = this.spline.frame(s)
    const bed0 = this.spline.bedY(s, 0)
    const H = T.tubeHalf, R = T.tubeRise
    const conc = this.concMat(0xa5a19a, 151, 0.88)
    const dark = this.mat('portalInk', () => new THREE.MeshStandardMaterial({ color: 0x25262a, roughness: 0.92 })) as THREE.Material
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, lat: number, y: number, yawExtra = 0): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat)
      p.copy(f.pos).addScaledVector(f.side, lat)
      m.position.set(p.x, bed0 + y, p.z)
      m.rotation.set(0, f.yaw + yawExtra, 0)
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
      return m
    }
    const p = new THREE.Vector3()
    const jambW = 1.25, jambH = R + 1.5
    for (const side of [-1, 1] as const) {
      add(new THREE.BoxGeometry(jambW, jambH, T.portalDepth), conc, side * (H + jambW * 0.5 - 0.1), jambH * 0.5 - 0.9)
      add(new THREE.BoxGeometry(2.1, 0.5, T.portalDepth + 1.4), conc, side * (H + 1.9), 0.2)     // footing
      // wing walls splay back into the hillside
      add(new THREE.BoxGeometry(0.8, 3.4, 6.4), conc, side * (H + 2.4), 1.5, side * 0.22 * dir)
    }
    add(new THREE.BoxGeometry(2 * H + 2 * jambW + 0.6, 1.7, T.portalDepth), conc, 0, jambH - 0.35)
    add(new THREE.BoxGeometry(2 * H + 2 * jambW + 1.3, 0.42, T.portalDepth + 0.35), conc, 0, jambH + 0.62)
    const band = add(new THREE.BoxGeometry(2 * H + 0.4, 0.86, T.portalDepth + 0.4), dark, 0, jambH + 1.28)
    band.renderOrder = 1
    // the mouth ring: a rib stood just outside the frame so the opening reads deep
    add(new THREE.BoxGeometry(2 * H + 0.5, 0.34, 0.34), conc, 0, R + 0.18)
    for (const side of [-1, 1] as const) add(new THREE.BoxGeometry(0.34, R + 0.4, 0.34), conc, side * (H + 0.2), (R + 0.4) * 0.5 - 0.9)
    // boulders at the threshold, half-buried in the cut floor — seated at the
    // deterministic bed level so none of them float on the hillside
    for (const [lat, sc, seed] of [[-H - 0.95, 1.25, 3], [H + 1.15, 1.45, 11], [-H - 2.1, 0.95, 23], [H + 2.35, 1.05, 31]] as const) {
      const r = new THREE.Mesh(rockGeometry(new Rand(SEED ^ (seed * 7919 + 13)), seed), this.concMat(0x8a8781, 71 + seed, 0.95))
      p.copy(f.pos).addScaledVector(f.side, lat)
      r.position.set(p.x, bed0 - 0.18, p.z)
      r.scale.setScalar(sc)
      r.rotation.set(0.1, seed * 1.7, 0.08)
      r.castShadow = true
      r.receiveShadow = true
      g.add(r)
    }
    return g
  }

  /* ───────────────────────── elevated viaduct (the north city) ────────────── */
  private deckRun(a: number, b: number): THREE.Group {
    const g = new THREE.Group()
    g.name = `deck-${Math.round(a)}`
    const B = TRACK.bridge
    const rng = this.spline.zoneRange('elevated')
    const s0 = Math.max(a, rng.s0 - 3), s1 = Math.min(b, rng.s1 - B.abutment * 0.15)
    if (s1 - s0 < 1) return g
    const hw = TRACK.halfWidth, so = TRACK.shoulderOuter
    const conc = this.concMat(0xb0aba1, 171, 0.86)
    const darkConc = this.concMat(0x6f6c68, 191, 0.9)

    // parapet: a LOW jersey plus an open steel railing, so the driver looks
    // through the posts to the city and pylons 13 m below — the deck must read
    // as flying, which a solid slab parapet prevents
    const para: [number, number][] = [
      [hw + 0.34, -0.05], [hw + 0.34, 0.5], [hw + 0.52, 0.62], [hw + 0.66, 0.6], [hw + 0.66, -0.92],
    ]
    const steelR = this.steelMat(0x8d949c, 0.72, 0.5)
    const m4b = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler()
    for (const side of [1, -1] as const) {
      const m = new THREE.Mesh(this.chainStrip(side, s0, s1, hw + 0.5, para, 0.3), conc)
      m.castShadow = true
      m.receiveShadow = true
      m.name = 'deck-parapet'
      g.add(m)
      // twin rails across the railing line
      for (const [lo, hi] of [[0.72, 0.8], [0.92, 1.02]] as const) {
        const prof: [number, number][] = [[hw + 0.46, lo], [hw + 0.8, lo], [hw + 0.8, hi], [hw + 0.46, hi]]
        const rm = new THREE.Mesh(this.chainStrip(side, s0, s1, hw + 0.6, prof, 0.4), steelR)
        rm.name = 'deck-rail'
        g.add(rm)
      }
      // railing posts every 3 m
      const pn = Math.max(2, Math.round((s1 - s0) / 3))
      const postGeo = new THREE.BoxGeometry(0.09, 0.54, 0.09)
      postGeo.translate(0, 0.27, 0)
      const posts = new THREE.InstancedMesh(postGeo, steelR, pn)
      posts.castShadow = true
      for (let i = 0; i < pn; i++) {
        const s = s0 + (i + 0.5) * (s1 - s0) / pn
        const f = this.spline.frame(s)
        const lat = side * (hw + 0.64)
        m4b.compose(new THREE.Vector3(f.pos.x + f.side.x * lat, this.spline.bedY(s, 0) + 0.58, f.pos.z + f.side.z * lat), q4.setFromEuler(e4.set(0, f.yaw, 0)), new THREE.Vector3(1, 1, 1))
        posts.setMatrixAt(i, m4b)
      }
      posts.instanceMatrix.needsUpdate = true
      posts.name = 'deck-rail-posts'
      g.add(posts)
    }

    // structural depth: two girders plus the soffit panel
    const gir: [number, number][] = [[hw - 0.95, -0.02], [hw - 0.95, -B.deckUnder], [hw - 0.35, -B.deckUnder], [hw - 0.35, -0.02]]
    for (const side of [1, -1] as const) {
      const gm = new THREE.Mesh(this.chainStrip(side, s0, s1, hw - 0.65, gir, 0.3), conc)
      gm.name = 'deck-girder'
      gm.receiveShadow = true
      g.add(gm)
    }
    const soft = new THREE.Mesh(this.loft(s0, s1, 2.4, [-hw - 1.05, 0, hw + 1.05],
      (s, lat, out) => this.absPoint(s, lat, this.spline.bedY(s, clamp(lat, -so, so)) - B.deckUnder, out),
      0.2, undefined, false, new THREE.Vector3(0, -1, 0)), darkConc)
    soft.name = 'deck-soffit'
    g.add(soft)
    // fascia: the deck's outer face — with the skirt suppressed under the fly
    // the deck edge must close itself (shoulder underside across, down, back)
    for (const side of [1, -1] as const) {
      const fprof: [number, number][] = [[hw + 0.95, -0.5], [so + 0.16, -0.5], [so + 0.16, -1.42], [hw + 0.95, -1.42]]
      const fm = new THREE.Mesh(this.chainStrip(side, s0, s1, hw + 1.1, fprof, 0.3), conc)
      fm.castShadow = true
      fm.receiveShadow = true
      fm.name = 'deck-fascia'
      g.add(fm)
    }

    // pylons: columns to the ground plus a pier cap under the soffit
    const n = Math.max(1, Math.round((s1 - s0) / B.pylonEvery))
    const colGeo = new THREE.BoxGeometry(1, 1, 1.95)
    colGeo.translate(0, -0.5, 0)
    const capGeo = new THREE.BoxGeometry(B.pylonW + 1.5, 0.55, 3.4)
    const cols = new THREE.InstancedMesh(colGeo, conc, n)
    const caps = new THREE.InstancedMesh(capGeo, conc, n)
    const joints = new THREE.InstancedMesh(new THREE.BoxGeometry(2 * hw + 1.7, 0.02, 0.17), darkConc, n)
    cols.castShadow = true
    cols.receiveShadow = true
    caps.castShadow = true
    caps.receiveShadow = true
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    const p = new THREE.Vector3(), sc = new THREE.Vector3()
    let placed = 0
    for (let i = 0; i < n; i++) {
      const s = s0 + (i + 0.5) * (s1 - s0) / n
      const f = this.spline.frame(s)
      const soffit = this.spline.bedY(s, 0) - B.deckUnder
      const ground = this.field ? this.field.height(f.pos.x, f.pos.z) : soffit - 8
      const h = soffit - ground + 0.5
      if (h < 2.2) continue
      e.set(0, f.yaw, 0)
      q.setFromEuler(e)
      p.copy(f.pos); p.y = soffit
      m4.compose(p, q, new THREE.Vector3(1, 1, 1))
      caps.setMatrixAt(placed, m4)
      m4.compose(p, q, new THREE.Vector3(B.pylonW, h, 1.95))
      cols.setMatrixAt(placed, m4)
      // expansion joint across the deck at every pier
      p.copy(f.pos); p.y = this.spline.surfaceY(s, 0) + 0.008
      m4.compose(p, q, sc.set(1, 1, 1))
      joints.setMatrixAt(placed, m4)
      placed++
    }
    cols.count = caps.count = joints.count = placed
    cols.instanceMatrix.needsUpdate = true
    caps.instanceMatrix.needsUpdate = true
    joints.instanceMatrix.needsUpdate = true
    cols.name = 'deck-pylons'; caps.name = 'deck-pier-caps'; joints.name = 'deck-joints'
    g.add(cols, caps, joints)

    // abutment cheeks where the deck lands into the embankment
    for (const se of [rng.s1 - B.abutment * 0.15]) {
      if (se < a || se > b) continue
      const f = this.spline.frame(se)
      for (const side of [-1, 1] as const) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.1, 8.5, B.abutment), conc)
        w.position.set(f.pos.x + f.side.x * side * (so + 0.6), this.spline.bedY(se, 0) - 3.4, f.pos.z + f.side.z * side * (so + 0.6))
        w.rotation.set(0, f.yaw, 0)
        w.castShadow = true
        w.receiveShadow = true
        w.name = 'deck-abutment'
        g.add(w)
      }
    }
    void so
    return g
  }

  /* ───────────────────────── finish gantry at the lap seam ───────────────── */
  private buildFinish(): THREE.Group {
    const g = new THREE.Group()
    g.name = 'finish'
    const s = 0
    const f = this.spline.frame(s)
    const bed0 = this.spline.bedY(s, 0)
    const so = TRACK.shoulderOuter
    const steel = this.steelMat(0x4a4f57, 0.72, 0.5)
    const ink = this.mat('finishInk', () => new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.7 })) as THREE.Material
    const lite = this.mat('finishLite', () => new THREE.MeshStandardMaterial({ color: 0xe8eaee, emissive: 0xfff0d0, emissiveIntensity: 1.5, roughness: 0.6 })) as THREE.Material
    const p = new THREE.Vector3()
    const put = (geo: THREE.BufferGeometry, mat: THREE.Material, lat: number, y: number, yaw = 0): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat)
      p.copy(f.pos).addScaledVector(f.side, lat)
      m.position.set(p.x, bed0 + y, p.z)
      m.rotation.set(0, f.yaw + yaw, 0)
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
      return m
    }
    const legH = 9.6, span = 2 * (so + 2.6)
    for (const side of [-1, 1] as const) {
      const lat = side * (so + 2.6)
      put(new THREE.BoxGeometry(0.84, legH, 0.74), steel, lat, legH * 0.5)
      put(new THREE.BoxGeometry(1.8, 0.42, 1.8), this.concMat(0x9d988f, 231, 0.9), lat, 0.21)
      // crossed lattice up the leg + a service ladder on the inner face
      put(new THREE.BoxGeometry(0.13, 3.7, 0.13), steel, lat - side * 0.52, 2.7, side * 0.55)
      put(new THREE.BoxGeometry(0.13, 3.7, 0.13), steel, lat + side * 0.52, 6.6, -side * 0.55)
      put(new THREE.BoxGeometry(0.12, legH - 0.9, 0.12), steel, lat - side * 0.66, legH * 0.5 + 0.45)
      // leg-mounted sponsor board, turned in toward the oncoming driver
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(1.15, 2.3, 0.12),
        this.mat(`finishSponsor${side}`, () => new THREE.MeshStandardMaterial({ map: billboardFaceTexture(side < 0 ? 'octane' : 'tyreking'), roughness: 0.7, metalness: 0.02 })) as THREE.Material,
      )
      board.position.copy(f.pos).addScaledVector(f.side, lat - side * 0.8)
      board.position.y = bed0 + 3.3
      board.rotation.set(0, f.yaw + side * 1.15, 0)
      board.castShadow = true
      board.receiveShadow = true
      board.name = 'finish-sponsor'
      g.add(board)
    }
    // the truss: deep chords, handrail and a full lattice, so it reads as a
    // rig at distance and not a slab
    const bandW = span * 0.88, bandH = bandW / 7.8, trussH = bandH + 0.55
    put(new THREE.BoxGeometry(span, 0.34, 0.6), steel, 0, legH)
    put(new THREE.BoxGeometry(span, 0.34, 0.6), steel, 0, legH + trussH)
    put(new THREE.BoxGeometry(span, 0.11, 0.11), steel, 0, legH + trussH + 0.24)
    for (let i = 0; i <= 15; i++) put(new THREE.BoxGeometry(0.11, trussH, 0.11), steel, -span / 2 + i * (span / 15), legH + trussH * 0.5)
    for (let i = 0; i < 15; i++) {
      const lat = -span / 2 + (i + 0.5) * (span / 15)
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.11, trussH * 1.18, 0.11), steel)
      d.position.set(f.pos.x + f.side.x * lat, bed0 + legH + trussH * 0.5, f.pos.z + f.side.z * lat)
      d.rotation.set(0, f.yaw + (i % 2 ? 0.5 : -0.5), 0)
      d.castShadow = true
      g.add(d)
    }
    // sponsor band across the truss on a red backing board, so the gantry
    // carries signage and reads from both directions
    put(new THREE.BoxGeometry(bandW + 0.34, bandH + 0.24, 0.1), this.mat('finishBanner', () => new THREE.MeshStandardMaterial({ color: 0x8f2a24, roughness: 0.72, metalness: 0.05 })) as THREE.Material, 0, legH + trussH * 0.5 - 0.06)
    put(new THREE.BoxGeometry(bandW, bandH, 0.14), this.mat('finishBand', () => new THREE.MeshStandardMaterial({ map: finishBannerTexture(), roughness: 0.62, metalness: 0.02 })) as THREE.Material, 0, legH + trussH * 0.5)
    // start-light pods over each lane, with a lamp grid so the line reads at
    // distance instead of vanishing into a dot
    const red = this.mat('finishLamp', () => new THREE.MeshStandardMaterial({ color: 0xb0182a, emissive: 0xff2a3a, emissiveIntensity: 1.4, roughness: 0.5 })) as THREE.Material
    for (const lat of [-3.55, -1.2, 1.2, 3.55]) {
      const pod = put(new THREE.BoxGeometry(0.72, 0.5, 0.34), ink, lat, legH - 0.42)
      pod.castShadow = false
      put(new THREE.BoxGeometry(0.14, 0.55, 0.14), steel, lat, legH - 0.1)
      for (const [dx, dy] of [[-0.17, 0.11], [0.17, 0.11], [-0.17, -0.11], [0.17, -0.11]] as const) {
        const lamp = put(new THREE.BoxGeometry(0.16, 0.16, 0.08), red, lat + dx, legH - 0.42 + dy)
        lamp.castShadow = false
      }
    }
    for (const side of [-1, 1] as const) put(new THREE.BoxGeometry(0.22, 0.22, 0.22), lite, side * (so + 1.2), legH + trussH + 0.4)
    // the chequered line across the asphalt
    // the chequered line across the asphalt: real squares, three rows deep
    const sq = this.mat('lineWhite', () => new THREE.MeshStandardMaterial({ color: 0xe9e7df, roughness: 0.78, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })) as THREE.Material
    const ink2 = this.mat('lineInk', () => new THREE.MeshStandardMaterial({ color: 0x25262a, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })) as THREE.Material
    const rows = 3, cols = 12
    const cell = (2 * TRACK.halfWidth) / cols
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const lat = -TRACK.halfWidth + (c + 0.5) * cell
      const sgn = (r + c) % 2 === 0 ? sq : ink2
      const bar = this.bar(0.16 + r * cell, lat, cell - 0.06, cell - 0.04, 0.012)
      const m = new THREE.Mesh(bar, sgn)
      m.renderOrder = 2
      g.add(m)
    }
    // solid white lines bounding the block, so the finish reads at distance
    for (const ss of [0.1, 0.16 + rows * cell]) {
      const m = new THREE.Mesh(this.bar(ss, 0, 0.16, 2 * TRACK.halfWidth, 0.01), sq)
      m.renderOrder = 2
      g.add(m)
    }

    return g
  }

  /* ─────────────────────── guarded infield shortcut ─────────────────────── *
   * A real alternate line: its own mini-spline, its own lofted surface, guards
   * on both sides, cones and an arrow at the mouth. The main line breaks its
   * centre dashes and its barrier run where the lane takes off.            */
  private spurMouths: number[] | null = null

  /** Stations where the shortcut lane meets the racing line (computed once). */
  private spurStations(): number[] {
    if (!this.spurMouths) this.spurMouths = TRACK.shortcut.pts.map(([x, z]) => this.spline.nearest(x, z).s)
    return this.spurMouths
  }

  /** True within the marking break at either junction. */
  private atSpurMouth(s: number): boolean {
    const L = this.spline.length
    for (const m of this.spurStations()) {
      const d = Math.abs(s - m)
      if (Math.min(d, L - d) < 10) return true
    }
    return false
  }

  private buildShortcut(): THREE.Group {
    const g = new THREE.Group()
    g.name = 'shortcut'
    const half = TRACK.shortcut.half
    const pts = TRACK.shortcut.pts.map(([x, z, y]) => new THREE.Vector3(x, y, z))
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    const raw = curve.getPoints(Math.round(pts.length * 46))
    const acc: number[] = [0]
    for (let i = 1; i < raw.length; i++) acc.push(acc[i - 1] + raw[i].distanceTo(raw[i - 1]))
    const total = acc[acc.length - 1]
    const at = (s: number): { p: THREE.Vector3; tx: number; tz: number; yaw: number } => {
      let i = 1
      while (i < acc.length - 1 && acc[i] < s) i++
      const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)]
      const tx = b.x - a.x, tz = b.z - a.z
      const l = Math.hypot(tx, tz) || 1
      return { p: raw[i], tx: tx / l, tz: tz / l, yaw: Math.atan2(-tx, -tz) }
    }
    const crown = (lat: number): number => -0.055 * Math.min(1, Math.abs(lat) / half) * Math.min(1, Math.abs(lat) / half)
    const cols = [-half, -half * 0.42, half * 0.42, half, half + 1.5]
    const rows = Math.max(2, Math.round(total / 1.1))
    const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = []
    const p = new THREE.Vector3(), c = new THREE.Color()
    for (let i = 0; i <= rows; i++) {
      const s = (i / rows) * total
      const fr = at(s)
      for (const lat of cols) {
        const sx = -fr.tz, sz = fr.tx // planar driver-right
        const x = fr.p.x + sx * lat, z = fr.p.z + sz * lat
        const edgeOut = Math.abs(lat) > half
        const y = edgeOut
          ? (this.field ? Math.min(this.field.height(x, z), fr.p.y - 0.9) : fr.p.y - 1.1)
          : fr.p.y + 0.022 + crown(lat)
        pos.push(x, y, z)
        uv.push(lat * 0.24, s * 0.24)
        roadVertexColor(s, lat * 1.4, c)
        // the lane reads a shade lighter and older than the racing line
        c.setRGB(c.r * 1.06, c.g * 1.05, c.b * 1.04)
        col.push(c.r, c.g, c.b)
      }
    }
    const n = cols.length
    for (let i = 0; i < rows; i++) for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = a + n
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setIndex(idx)
    sanitizeGeometry(geo)
    forceUpWinding(geo, UP)
    const lane = new THREE.Mesh(geo, this.mat('spurAsphalt', () => {
      const m = this.asphaltMat()
      m.polygonOffset = true
      m.polygonOffsetFactor = -2
      m.polygonOffsetUnits = -2
      return m
    }) as THREE.Material)
    lane.receiveShadow = true
    lane.name = 'shortcut-lane'
    g.add(lane)

    // guards both sides, stopping short of each mouth
    const postGeo = new THREE.BoxGeometry(0.08, 0.9, 0.08)
    postGeo.translate(0, 0.45, 0)
    const postN = Math.max(2, Math.round(total / 3.2)) * 2
    const posts = new THREE.InstancedMesh(postGeo, this.steelMat(0x767d85, 0.7, 0.5), postN)
    posts.castShadow = true
    const railGeo = new THREE.BoxGeometry(0.07, 0.2, 3.3)
    const rails = new THREE.InstancedMesh(railGeo, this.steelMat(0x9aa2ab), postN)
    rails.castShadow = true
    rails.receiveShadow = true
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    const v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1)
    let np = 0, nr = 0
    const gap = 15
    for (const side of [-1, 1] as const) for (let i = 0; i < postN / 2; i++) {
      const s = ((i + 0.5) / (postN / 2)) * total
      if (s < gap || s > total - gap) continue
      const fr = at(s)
      const sx = -fr.tz, sz = fr.tx
      const lat = side * (half + 0.45)
      const x = fr.p.x + sx * lat, z = fr.p.z + sz * lat
      const gy = this.field ? this.field.height(x, z) : fr.p.y - 1
      e.set(0, fr.yaw, 0)
      q.setFromEuler(e)
      m4.compose(new THREE.Vector3(x, Math.min(gy, fr.p.y - 0.4), z), q, sc)
      posts.setMatrixAt(np++, m4)
      m4.compose(new THREE.Vector3(x, Math.min(gy, fr.p.y - 0.4) + 0.72, z), q, sc)
      rails.setMatrixAt(nr++, m4)
    }
    posts.count = np
    rails.count = nr
    posts.instanceMatrix.needsUpdate = true
    rails.instanceMatrix.needsUpdate = true
    posts.name = 'shortcut-posts'; rails.name = 'shortcut-rails'
    g.add(posts, rails)

    // cones lining the mouth + a painted arrow into the lane
    const coneGeo = new THREE.ConeGeometry(0.21, 0.46, 9)
    coneGeo.translate(0, 0.23, 0)
    const cones = new THREE.InstancedMesh(coneGeo, this.mat('cone', () => new THREE.MeshStandardMaterial({ color: 0xe2622a, roughness: 0.6 })) as THREE.Material, 10)
    cones.castShadow = true
    let nc = 0
    for (const [sC, latA] of [[gap * 0.45, half + 0.5], [gap * 0.72, half + 0.5], [gap * 1.05, half + 0.5], [total - gap * 0.5, -half - 0.5], [total - gap * 0.8, -half - 0.5]] as const) {
      const fr = at(sC)
      const sx = -fr.tz, sz = fr.tx
      const x = fr.p.x + sx * latA, z = fr.p.z + sz * latA
      const gy = this.field ? Math.min(this.field.height(x, z), fr.p.y) : fr.p.y - 0.2
      e.set(0, fr.yaw, 0)
      q.setFromEuler(e)
      m4.compose(new THREE.Vector3(x, gy, z), q, sc)
      cones.setMatrixAt(nc++, m4)
    }
    cones.count = nc
    cones.instanceMatrix.needsUpdate = true
    cones.name = 'shortcut-cones'
    g.add(cones)

    const arrow = this.shortcutArrow(at(gap * 1.35), half * 0.62)
    arrow.name = 'shortcut-arrow'
    g.add(arrow)
    return g
  }

  /** Painted chevron arrow on the lane, just past the mouth. */
  private shortcutArrow(fr: { p: THREE.Vector3; tx: number; tz: number; yaw: number }, wide: number): THREE.Mesh {
    const sx = -fr.tz, sz = fr.tx
    const pts: number[] = [], uv: number[] = [], idx: number[] = []
    const shape: [number, number][] = [[-wide, 1.5], [0, 0.2], [wide, 1.5], [wide, 0.7], [0, -0.6], [-wide, 0.7]]
    for (const [lat, along] of shape) {
      pts.push(fr.p.x + sx * lat + fr.tx * along, fr.p.y + 0.014, fr.p.z + sz * lat + fr.tz * along)
      uv.push((lat + wide) / (2 * wide), (along + 0.6) / 2.1)
    }
    idx.push(0, 1, 2, 0, 1, 2, 0, 2, 5, 1, 4, 2, 2, 4, 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    sanitizeGeometry(geo)
    forceUpWinding(geo, UP)
    const m = new THREE.Mesh(geo, this.mat('arrowPaint', () => new THREE.MeshStandardMaterial({
      color: 0xe8c83e, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    })) as THREE.Material)
    m.renderOrder = 2
    return m
  }
}
