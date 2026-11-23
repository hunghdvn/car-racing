import * as THREE from 'three'
import { VEHICLE } from '../config'
import { clamp01 } from '../util'
import { mergeStaticMeshes } from '../world/StaticBatch'
import { alloyRoughness, carPaintMaps, carbonWeaveMaps, paintMicroRoughness, roundedPlateGeo, tireTreadNormal } from './Textures'
import { carbonMaterialParams, carMaterialParamsFor, glassMaterialParams } from './MaterialSpecs'
import { HERO_SPEC, resolvePaint, spokeCountForStyle, type CarFinish, type CarKit, type CarSpec, type CarShape } from '../vehicles/CarSpecs'

/* ------------------------------------------------------------------------- *
 * Velocity Rush hero-car kit (spec rev.3 §4.1 / §6).
 * Construction strategy — continuous automotive surface construction:
 *   · lofted/swept closed cross-sections sampled along length, profiles are
 *     rounded-shoulder sections whose width/top/bottom follow authored
 *     automotive stations with Catmull-Rom interpolation (no box flanks)
 *   · separate lofted cabin greenhouse + independent wrap glass band
 *   · beveled rounded-plate panels (bumpers, splitter, diffuser, spoiler)
 *   · lathe wheels: tread band + rounded shoulders, alloy dish + 5 spokes,
 *     hub, brake disc + static caliper
 *   · shaped head/tail light clusters, mirrors on stalks, exhaust tips,
 *     arch rims, dark greebles; multi-material PBR throughout
 * ------------------------------------------------------------------------- */

export interface WheelHandle {
  steer: THREE.Group | null
  spin: THREE.Group
  radius: number
  front: boolean
}

export interface CarModel {
  group: THREE.Group
  wheels: WheelHandle[]
  setBrake(v: number): void
  setNitro(v: number): void
  setHeadlights(on: boolean): void
  setPaint(hex: number): void
  paintMats: THREE.MeshPhysicalMaterial[]
}

interface Station {
  z: number; hw: number; by: number; ty: number; rt: number; rb: number; ts?: number
}

/* ------------------------------ math helpers ------------------------------ */

const cr = (a: number, b: number, c: number, d: number, t: number): number =>
  0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t)

interface Pt { u: number; s: number }

const MIN_ROUND = 0.02

/** Closed rounded-shoulder ring in (s=half-width, u=height) space, CCW from
 *  (rb, 1): up the right shoulder, across the crown, down the left side,
 *  across the belly. Uniform point count for any legal (rt, rb, ts). */
function roundedUnitProfile(rt: number, rb: number, ts: number, seg = 4): Pt[] {
  rt = Math.max(MIN_ROUND, Math.min(0.45, rt))
  rb = Math.max(MIN_ROUND, Math.min(0.45, rb))
  const pts: Pt[] = []
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number): void => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg
      pts.push({ u: cy + Math.sin(a) * r, s: cx + Math.cos(a) * r })
    }
  }
  pts.push({ u: rb, s: 1 })
  pts.push({ u: 1 - rt, s: 1 })
  arc(1 - rt, 1 - rt, rt, 0, Math.PI / 2)
  pts.push({ u: 1, s: 1 - rt })
  pts.push({ u: 1, s: -(1 - rt) })
  arc(-(1 - rt), 1 - rt, rt, Math.PI / 2, Math.PI)
  pts.push({ u: 1 - rt, s: -1 })
  pts.push({ u: rb, s: -1 })
  arc(-(1 - rb), rb, rb, Math.PI, Math.PI * 1.5)
  pts.push({ u: rb, s: -(1 - rb) })
  pts.push({ u: rb - 0.0001, s: 1 - rb })
  for (const p of pts) if (p.u > 0.5) p.s *= THREE.MathUtils.lerp(1, ts, clamp01((p.u - 0.5) / 0.5))
  const out: Pt[] = []
  for (const p of pts) {
    const prev = out[out.length - 1]
    if (!prev || Math.abs(prev.u - p.u) > 1e-4 || Math.abs(prev.s - p.s) > 1e-4) out.push(p)
  }
  return out
}

const profileCache = new Map<string, Pt[]>()
function getProfile(rt: number, rb: number, ts: number): Pt[] {
  const k = `${rt.toFixed(3)}|${rb.toFixed(3)}|${ts.toFixed(3)}`
  let p = profileCache.get(k)
  if (!p) { p = roundedUnitProfile(rt, rb, ts); profileCache.set(k, p) }
  return p
}

function interpStations(sts: readonly Station[], z: number): Station {
  let i = 0
  while (i < sts.length - 2 && sts[i + 1].z < z) i++
  const i0 = Math.max(0, i), i1 = Math.min(sts.length - 1, i + 1)
  const a = sts[Math.max(0, i0 - 1)], b = sts[i0], c = sts[i1], d = sts[Math.min(sts.length - 1, i1 + 1)]
  const t = i1 === i0 ? 0 : (z - b.z) / (c.z - b.z)
  return {
    z,
    hw: cr(a.hw, b.hw, c.hw, d.hw, t),
    by: cr(a.by, b.by, c.by, d.by, t),
    ty: cr(a.ty, b.ty, c.ty, d.ty, t),
    rt: cr(a.rt, b.rt, c.rt, d.rt, t),
    rb: cr(a.rb, b.rb, c.rb, d.rb, t),
    ts: cr(a.ts ?? 1, b.ts ?? 1, c.ts ?? 1, d.ts ?? 1, t),
  }
}

/**
 * Catmull-Rom smoothed vertex normals for indexed lofted hulls, hardened:
 * only finite, positive-area face contributions accumulate; any vertex left
 * with a degenerate vector gets an outward fallback normal and the whole
 * buffer is re-normalized. Guarantees an all-finite unit normal attribute
 * (NaN/zero normals poison the PBR fragment path and cascade via bloom).
 */
function crNormals(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const idx = geo.getIndex() as THREE.BufferAttribute
  const n = pos.count
  const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n)
  const used = new Uint8Array(n)
  for (let f = 0; f < idx.count; f += 3) {
    const ia = idx.getX(f), ib = idx.getX(f + 1), ic = idx.getX(f + 2)
    const ux = pos.getX(ib) - pos.getX(ia), uy = pos.getY(ib) - pos.getY(ia), uz = pos.getZ(ib) - pos.getZ(ia)
    const vx = pos.getX(ic) - pos.getX(ia), vy = pos.getY(ic) - pos.getY(ia), vz = pos.getZ(ic) - pos.getZ(ia)
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    if (!Number.isFinite(fx + fy + fz) || fx * fx + fy * fy + fz * fz < 1e-12) continue
    nx[ia] += fx; ny[ia] += fy; nz[ia] += fz
    nx[ib] += fx; ny[ib] += fy; nz[ib] += fz
    nx[ic] += fx; ny[ic] += fy; nz[ic] += fz
    used[ia] = 1; used[ib] = 1; used[ic] = 1
  }
  let cx = 0, cy = 0
  for (let i = 0; i < n; i++) { cx += pos.getX(i); cy += pos.getY(i) }
  cx /= n; cy /= n
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    let x = nx[i], y = ny[i], z = nz[i]
    let len = Number.isFinite(x + y + z) ? Math.sqrt(x * x + y * y + z * z) : 0
    if (len < 1e-6 || !used[i]) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i)
      const rx = px - cx, ry = py - cy
      const rl = Math.sqrt(rx * rx + ry * ry)
      if (Number.isFinite(rl) && rl > 1e-6) { x = rx / rl; y = ry / rl; z = 0.15 }
      else { x = 0; y = 1; z = 0 }
      len = Math.sqrt(x * x + y * y + z * z)
    }
    x /= len; y /= len; z /= len
    if (!Number.isFinite(x + y + z)) { x = 0; y = 1; z = 0 }
    arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z
  }
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(arr, 3))
}

/** Flip the index winding when the majority of triangles face the centroid
 *  (i.e. inward). Keeps lofted hulls and bands consistently outward-facing. */
function ensureOutwardWinding(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const idx = geo.getIndex() as THREE.BufferAttribute
  if (!idx || idx.count < 3) return
  let cx = 0, cy = 0, cz = 0
  for (let i = 0; i < pos.count; i++) { cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i) }
  cx /= pos.count; cy /= pos.count; cz /= pos.count
  let outward = 0, inward = 0
  for (let f = 0; f < idx.count; f += 3) {
    const a = idx.getX(f), b = idx.getX(f + 1), c = idx.getX(f + 2)
    const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a)
    const vx = pos.getX(c) - pos.getX(a), vy = pos.getY(c) - pos.getY(a), vz = pos.getZ(c) - pos.getZ(a)
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    const mx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3 - cx
    const my = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3 - cy
    const mz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3 - cz
    if (fx * mx + fy * my + fz * mz >= 0) outward++; else inward++
  }
  if (inward <= outward) return
  const arr = new Uint32Array(idx.count)
  for (let f = 0; f < idx.count; f += 3) {
    arr[f] = idx.getX(f); arr[f + 1] = idx.getX(f + 2); arr[f + 2] = idx.getX(f + 1)
  }
  geo.setIndex(new THREE.Uint32BufferAttribute(arr, 1))
}

/**
 * Loft a hull through authored stations.
 * Columns = interpolated stations along z; ring = rounded-shoulder profile.
 * Fully closed tube (ring wrap-around included) + optional end caps.
 */
function buildHull(stations: readonly Station[], samples: number, opts: { caps?: boolean; vScale?: number; hwScale?: number } = {}): THREE.BufferGeometry {
  const z0 = stations[0].z, z1 = stations[stations.length - 1].z
  const hwScale = opts.hwScale ?? 1
  const vScale = opts.vScale ?? 0.5
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  const S = Math.max(4, samples)
  const cols: Pt[][] = []
  for (let iz = 0; iz < S; iz++) {
    const z = THREE.MathUtils.lerp(z0, z1, iz / (S - 1))
    const st = interpStations(stations, z)
    cols.push(getProfile(st.rt, st.rb, st.ts ?? 1))
  }
  const ring = cols[0].length
  for (const c of cols) if (c.length !== ring) throw new Error('[car] non-uniform loft ring (profiles must share point count)')
  for (let iz = 0; iz < S; iz++) {
    const st = interpStations(stations, THREE.MathUtils.lerp(z0, z1, iz / (S - 1)))
    const prof = cols[iz]
    for (let j = 0; j < ring; j++) {
      pos.push(st.hw * hwScale * prof[j].s, st.by + (st.ty - st.by) * prof[j].u, st.z)
      uv.push(j / ring, (st.z - z0) / vScale)
    }
  }
  for (let iz = 0; iz < S - 1; iz++) {
    for (let j = 0; j < ring; j++) {
      const jn = (j + 1) % ring
      const a = iz * ring + j, b = a + ring, c = iz * ring + jn, d = b + (jn - j)
      idx.push(a, c, b, c, d, b)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  if (opts.caps) {
    const capIdx: number[] = []
    for (const [iz, flip] of [[0, -1], [S - 1, 1]] as [number, number][]) {
      const prof = cols[iz]
      let cx = 0, cy = 0
      for (const p of prof) { cx += p.s; cy += p.u }
      cx = (cx / prof.length) * 0.3
      const base = iz * ring
      const centerVert = pos.length / 3
      const st = interpStations(stations, iz === 0 ? z0 : z1)
      pos.push(cx * st.hw * hwScale, st.by + (st.ty - st.by) * 0.5, st.z)
      uv.push(0.5, 0.5)
      for (let j = 0; j < ring; j++) {
        const jn = (j + 1) % ring
        if (flip < 0) capIdx.push(centerVert, base + jn, base + j)
        else capIdx.push(centerVert, base + j, base + jn)
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex([...idx, ...capIdx])
  }
  ensureOutwardWinding(geo)
  crNormals(geo)
  geo.computeBoundingSphere()
  return geo
}

/** Browser-free geometry gate (spec §9): lofts both hulls of a shape and
 *  lets buildHull's ring/non-uniform guard throw. Dev/test only. */
export function validateCarShape(shape: CarShape): void {
  const a = buildHull(shape.bodyStations, 52, { caps: true })
  const b = buildHull(shape.cabinStations, 30, { caps: true })
  for (const g of [a, b]) {
    const n = g.getAttribute('normal')
    for (let i = 0; i < n.count; i++) {
      if (!Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i))) throw new Error('[car] degenerate normal in catalog shape')
    }
  }
}

/**
 * PR review F3: the headlight cluster and centre intake must anchor to THIS
 * model's own front station the way the tail strip anchors to lastStation —
 * the long-nosed hyper left its lamps 0.17 m inside the air and the short-nosed
 * grip buried them in its own nose. Offsets are calibrated so the hero's own
 * station reproduces the shipped cluster z/y byte-identically.
 */
export function frontLampAnchors(first: { z: number; ty: number }): {
  housingZ: number; lensZ: number; ringZ: number; projectorZ: number; drlZ: number
  lampY: number; drlY: number; intakeCenterZ: number
} {
  return {
    housingZ: first.z + 0.02,
    lensZ: first.z - 0.003,
    ringZ: first.z - 0.017,
    projectorZ: first.z - 0.021,
    drlZ: first.z - 0.001,
    lampY: first.ty - 0.04,
    drlY: first.ty - 0.04 + 0.062,
    intakeCenterZ: first.z - 0.025,
  }
}

/* -------------------------------- materials ------------------------------- */

/* Group-3 raised trim rides on ONE memoised instance per detail material
 * (the Textures.ts `cached` idiom applied to materials): every car in the
 * field shares the same dark trim, dark chrome and LED instances, so the
 * detail set never mints a per-part material. LED materials are keyed by
 * role + accent hex — four models means a handful of instances at most. */
const detailMats = new Map<string, THREE.Material>()
/* PR review F1: everything in detailMats is a FIELD-WIDE singleton — the AI
 * cars mount theirs for the whole session. A model swap must never dispose
 * one of these (its material would die under still-mounted meshes). */
const sharedCarMats = new WeakSet<THREE.Material>()
function memoDetailMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = detailMats.get(key) as T | undefined
  if (!m) { m = make(); detailMats.set(key, m); sharedCarMats.add(m) }
  return m
}

/** True for the memoised car materials every mounted car shares. */
export function isSharedCarMaterial(m: unknown): boolean {
  return m != null && sharedCarMats.has(m as THREE.Material)
}

/**
 * Dispose a retired car tree: geometry always (every buildCar mints fresh),
 * materials only when they are NOT field-wide singletons (per-car paint,
 * headlight, brake and flame materials). Mirrors util.disposeTree's shape.
 */
export function disposeCarTree(root: THREE.Object3D, isShared: (m: unknown) => boolean = isSharedCarMaterial): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const m of mats) if (!isShared(m)) m.dispose()
  })
}

/** linear blend of two packed hex colours (weight of `b`) */
const mixHex = (a: number, b: number, w: number): number =>
  new THREE.Color(a).lerp(new THREE.Color(b), w).getHex()

/* paintMaterialParams' micro-roughness for the HERO finish (roughness 0.28,
 * flake 0.5) — the calibration anchor of the mkPaint normalScale mapping. */
const HERO_MICRO = 0.293

/* PR review F14b: every fixed-colour hardware material goes through the same
 * detailMats memo so the AI field (5 cars × 4 wheels) reuses one instance per
 * look instead of minting dozens per buildCar. Consequence the model swap
 * must respect (F1): these are FIELD-WIDE singletons — disposeCarTree below
 * never disposes one an AI car still renders with. */
/* PR review R2-11: exported so the node battery can hand a REAL field-wide
 * singleton (chrome/alloy/dark…) to disposeCarTree's DEFAULT predicate —
 * the old test injected its own isShared stub and only proved the plumbing.
 * Internal code keeps using `shared`. */
export const shared = {
  rubber(): THREE.MeshStandardMaterial {
    return memoDetailMat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.86, metalness: 0.02, normalMap: tireTreadNormal(), normalScale: new THREE.Vector2(0.8, 0.8) }))
  },
  chrome(): THREE.MeshStandardMaterial {
    return memoDetailMat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xd6dde6, metalness: 1, roughness: 0.11 }))
  },
  alloy(): THREE.MeshStandardMaterial {
    return memoDetailMat('alloy', () => new THREE.MeshStandardMaterial({ color: 0x98a8c0, metalness: 0.65, roughness: 0.2, roughnessMap: alloyRoughness() }))
  },
  dark(): THREE.MeshStandardMaterial {
    return memoDetailMat('dark', () => new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55, metalness: 0.25 }))
  },
  darkSoft(): THREE.MeshStandardMaterial {
    return memoDetailMat('darkSoft', () => new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.9, metalness: 0 }))
  },
  sidewall(): THREE.MeshStandardMaterial {
    return memoDetailMat('sidewall', () => new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.92, metalness: 0 }))
  },
  glass(finish: CarFinish): THREE.MeshPhysicalMaterial {
    const gp = glassMaterialParams(finish)
    return memoDetailMat(`glass:${gp.color}:${gp.opacity}`, () => new THREE.MeshPhysicalMaterial({
      color: gp.color, roughness: gp.roughness, metalness: gp.metalness,
      transparent: true, opacity: gp.opacity, ior: gp.ior, envMapIntensity: gp.envMapIntensity,
    }))
  },
  disc(): THREE.MeshStandardMaterial {
    return memoDetailMat('disc', () => new THREE.MeshStandardMaterial({ color: 0x33383f, metalness: 0.94, roughness: 0.36 }))
  },
  caliper(hex: number): THREE.MeshStandardMaterial {
    return memoDetailMat(`caliper:${hex}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.4, metalness: 0.3 }))
  },
  carbon(finish: CarFinish): THREE.MeshStandardMaterial {
    const cp = carbonMaterialParams(finish)
    return memoDetailMat(`carbon:${cp.color}:${cp.repeat}`, () => {
      const weave = carbonWeaveMaps(cp.repeat)
      return new THREE.MeshStandardMaterial({
        color: cp.color, roughness: cp.roughness, metalness: 0.32,
        normalMap: weave.normalMap, normalScale: new THREE.Vector2(cp.normalScale, cp.normalScale),
        roughnessMap: weave.roughnessMap, envMapIntensity: cp.envMapIntensity,
      })
    })
  },
  // brushed steel ring standing proud of the disc face (rotates with the wheel)
  discRing(): THREE.MeshStandardMaterial {
    return memoDetailMat('discRing', () => new THREE.MeshStandardMaterial({ color: 0x5b616a, metalness: 0.95, roughness: 0.3 }))
  },
  // ---- group-3 detail materials (memoised singletons, see detailMats above)
  // matte dark trim: handles, shut lines, lamp cans, slats, recesses, quad block
  trim(): THREE.MeshStandardMaterial {
    return memoDetailMat('trim', () => new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.62, metalness: 0.2 }))
  },
  // dark chrome: exhaust hardware (sits a stop below the bright rim chrome)
  chromeDark(): THREE.MeshStandardMaterial {
    return memoDetailMat('chromeDark', () => new THREE.MeshStandardMaterial({ color: 0x565c66, metalness: 1, roughness: 0.28 }))
  },
  // daytime-runner strip: the model's accent carried into cool white, low
  // emissive so the bloom pass (threshold 0.92) reads a line, not a flare
  ledDrl(accent: number): THREE.MeshStandardMaterial {
    const hex = mixHex(0xf4f8ff, accent, 0.42)
    return memoDetailMat(`led-drl-${hex}`, () => new THREE.MeshStandardMaterial({
      color: 0x2b313a, emissive: new THREE.Color(hex), emissiveIntensity: 0.6, roughness: 0.25, metalness: 0,
    }))
  },
  // tail signature: brake red carried toward the model's accent (amber drift,
  // cyan-tinged hyper) — never past a believable red/amber lamp. The weight
  // stays on the red side and the base colour is near-black so the ACES tone
  // map keeps the strip saturated instead of washing it to trim grey.
  ledTail(accent: number): THREE.MeshStandardMaterial {
    const hex = mixHex(0xff2010, accent, 0.35)
    return memoDetailMat(`led-tail-${hex}`, () => new THREE.MeshStandardMaterial({
      color: 0x2e0a07, emissive: new THREE.Color(hex), emissiveIntensity: 0.95, roughness: 0.25, metalness: 0,
    }))
  },
}

/** PR review R3-4: the FULL dispose-surface of the field-wide shared set —
 *  every `shared` factory invoked with its production (hero) arguments,
 *  returning the memoised singletons. The node battery iterates this and
 *  asserts the real isSharedCarMaterial recognises EVERY entry and the
 *  production disposeCarTree spares every one; pinning a single singleton
 *  (the old chrome-only test) let a memoDetailMat regression regress the
 *  other twelve into the F1 bug class unnoticed. */
export function sharedCarMaterials(): THREE.Material[] {
  const f = HERO_SPEC.finish
  return [
    shared.rubber(), shared.chrome(), shared.alloy(), shared.dark(), shared.darkSoft(),
    shared.sidewall(), shared.glass(f), shared.disc(), shared.caliper(HERO_SPEC.kit.caliper),
    shared.carbon(f), shared.discRing(), shared.trim(), shared.chromeDark(),
    shared.ledDrl(f.accent), shared.ledTail(f.accent),
  ]
}

/* -------------------------------- detail plan ------------------------------- */

export type ExhaustLayout = 'single' | 'twin' | 'quad'

/** Per-kit raised shell-detail configuration (group 3). Pure and THREE-free
 *  so the kit conditionals are node-pinned (tests/cases/shell-detail.test.ts);
 *  buildCar reads nothing else when deciding which hardware a model wears. */
export interface DetailPlan {
  /** projector can + emissive lens disc inside each headlight ring */
  projectorLamps: boolean
  /** full-width accent LED strip (on its dark recess plate) across the tail */
  ledTailBar: boolean
  /** slim door-handle bars per side on the door band */
  handlesPerSide: number
  /** recessed-look hood slats (grip/drift); hero/hyper stay plain */
  hoodSlats: number
  /** hyper's single pressed power-dome ridge (exclusive with slats) */
  hoodDome: boolean
  /** tip architecture: hero/grip single round, drift twin stacked, hyper centre quad */
  exhaust: ExhaustLayout
  /** dark shut-line strips total (per-side pairs: door cut + bonnet seam) */
  shutLines: number
}

export function detailPlanFor(kit: CarKit): DetailPlan {
  const hyper = kit.spoiler === 'gt'
  const grip = kit.splitter === 'big'
  const drift = kit.roofScoop
  return {
    projectorLamps: true,
    ledTailBar: true,
    handlesPerSide: 2,
    // the technical cars breathe through the hood; the hero stays clean, the
    // hyper carries a pressed dome ridge instead of cut slats
    hoodSlats: hyper ? 0 : grip ? 2 : drift ? 3 : 0,
    hoodDome: hyper,
    exhaust: hyper ? 'quad' : drift ? 'twin' : 'single',
    shutLines: 4,
  }
}

/** Detail meshes too thin to earn a shadow-map slot (see the shadow traverse). */
const SHADOWLESS_DETAIL: ReadonlySet<string> = new Set([
  'headlight-can-l', 'headlight-can-r', 'headlight-projector-l', 'headlight-projector-r',
  'headlight-drl-l', 'headlight-drl-r',
  'taillight-recess', 'taillight-led',
  'door-handle-f-l', 'door-handle-f-r', 'door-handle-r-l', 'door-handle-r-r',
  'hood-slat-0', 'hood-slat-1', 'hood-slat-2',
  'exhaust2-l', 'exhaust2-r', 'exhaust-inner2-l', 'exhaust-inner2-r',
  'exhaust-quad-block', 'exhaust-q0', 'exhaust-q1', 'exhaust-q2', 'exhaust-q3',
  'shut-door-l', 'shut-door-r', 'shut-bonnet-l', 'shut-bonnet-r',
])

/** Total NEW meshes the plan adds over the pre-group-3 build (mesh budget gate). */
export function detailPartCount(plan: DetailPlan): number {
  return (plan.projectorLamps ? 6 : 0)
    + (plan.ledTailBar ? 2 : 0)
    + plan.handlesPerSide * 2
    + plan.hoodSlats
    + (plan.hoodDome ? 1 : 0)
    + (plan.exhaust === 'twin' ? 4 : plan.exhaust === 'quad' ? 5 : 0)
    + plan.shutLines
}

/* --------------------------------- wheels --------------------------------- */

/**
 * Proper sports-coupe wheel (spec §6 / §4.1): dimensions come from the
 * per-car kit. Built around its own +Y axle (outboard face at +Y), then the
 * axle is baked onto world X with sideSign so both left/right wheels face
 * outboard.
 */
function buildWheelAssembly(sideSign: 1 | -1, width: number, spokeCount: number, radius: number, caliperHex: number): { root: THREE.Group; spin: THREE.Group } {
  const R = radius
  const hw = width / 2
  const spin = new THREE.Group()
  // named landmark for the static merge (see keepNames at the buildCar tail):
  // the rotating hardware (dish/lip/sidewall/back/disc/ring/hub) folds INTO
  // this group, never past it to the car root
  spin.name = 'wheel-spin'

  const tp: THREE.Vector2[] = [
    [0.005, -hw * 0.92], [R * 0.50, -hw * 0.92], [R * 0.66, -hw * 0.78],
    [R * 0.82, -hw * 0.55], [R * 0.94, -hw * 0.28], [R * 0.992, -hw * 0.06],
    [R, 0], [R * 0.992, hw * 0.06], [R * 0.94, hw * 0.28], [R * 0.82, hw * 0.55],
    [R * 0.66, hw * 0.78], [R * 0.52, hw * 0.90],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const tire = new THREE.Mesh(new THREE.LatheGeometry(tp, 36), shared.rubber())
  tire.name = 'tire'
  spin.add(tire)

  // Sidewall ring band — a slightly lighter matte annulus on the outboard face
  // so the tyre is not one flat donut. Sits just proud of the shoulder.
  const sidewall = new THREE.Mesh(new THREE.TorusGeometry(R * 0.72, 0.03, 6, 34), shared.sidewall())
  sidewall.geometry.rotateX(Math.PI / 2)
  sidewall.geometry.translate(0, hw * 0.80, 0)
  sidewall.name = 'tire-sidewall'
  spin.add(sidewall)

  // Inboard backing cap — closes the wheel barrel, no sky/ground leaks through.
  const inboardCap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.50, R * 0.50, 0.018, 22), shared.darkSoft())
  inboardCap.geometry.translate(0, -hw * 0.92, 0)
  inboardCap.name = 'wheelback'
  spin.add(inboardCap)

  // Brake disc — large annular surface, INBOARD of the dish.
  // Extends to r=R*0.58, well beyond the dish edge (R*0.42), so its outer
  // annular ring is legible through the gaps between the five spokes.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.58, R * 0.58, 0.018, 28), shared.disc())
  disc.geometry.translate(0, hw * 0.12, 0)
  disc.name = 'brake-disc'
  spin.add(disc)

  // Drilled-disc outer ring — a brushed steel rim standing proud of the disc
  // face so the rotor reads as hardware behind the spokes, not a flat grey disc.
  const discRing = new THREE.Mesh(new THREE.TorusGeometry(R * 0.56, 0.012, 6, 30), shared.discRing())
  discRing.geometry.rotateX(Math.PI / 2)
  discRing.geometry.translate(0, hw * 0.21, 0)
  discRing.name = 'brake-disc-ring'
  spin.add(discRing)

  // Caliper — clamped at the 3-o'clock position, INBOARD of the dish so it
  // peeks through spoke gaps without being buried under the dish.
  const cal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.052, 0.055), shared.caliper(caliperHex))
  cal.geometry.translate(0, hw * 0.20, R * 0.575)
  cal.name = 'brake-caliper'

  // Caliper pistons — small boxes biting the disc edge under the caliper body
  // so the calliper is a real two-piece clamp, not a single brick.
  const pistons: THREE.Mesh[] = []
  for (const pOff of [-0.018, 0, 0.018]) {
    const piston = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.022), shared.chrome())
    piston.geometry.translate(0, hw * 0.14, R * 0.575 + pOff)
    piston.name = 'brake-piston'
    pistons.push(piston)
  }

  // Alloy dish (centre hub plate) — small radius, INBOARD of the spokes so it
  // acts as a backing plate behind them, not as a foreground brass shield.
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.40, R * 0.42, 0.024, 26), shared.alloy())
  dish.geometry.translate(0, hw * 0.30, 0)
  dish.name = 'wheel-dish'
  spin.add(dish)

  // Rim lip — at the outer face edge.
  const lip = new THREE.Mesh(new THREE.TorusGeometry(R * 0.54, 0.015, 8, 30), shared.alloy())
  lip.geometry.rotateX(-Math.PI / 2)
  lip.geometry.translate(0, hw * 0.86, 0)
  lip.name = 'wheel-lip'
  spin.add(lip)

  // Spokes — OUTBOARD of the dish (hw*0.68 vs dish at hw*0.30), extending
  // radially from near the hub centre (R*0.05) past the dish edge (R*0.42) to
  // near the rim (R*0.57), so the alloy alloy profile is legible from the side.
  // Dense styles (>=8 spokes) get shorter plates so the pattern reads.
  const spokeLen = R * 0.50 * (spokeCount >= 8 ? 0.8 : 1)
  for (let k = 0; k < spokeCount; k++) {
    const ang = (k * Math.PI * 2) / spokeCount
    const sp = new THREE.Mesh(roundedPlateGeo(0.072, spokeLen, 0.024, 0.014), shared.alloy())
    sp.geometry.rotateX(Math.PI / 2)
    sp.geometry.rotateY(ang)
    sp.geometry.translate(Math.sin(ang) * R * 0.30, hw * 0.68, Math.cos(ang) * R * 0.30)
    sp.name = 'wheel-spoke'
    spin.add(sp)
  }

  // Chrome centre hub cap — outboard, sits at the spoke convergence point.
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.030, 14), shared.chrome())
  hub.geometry.translate(0, hw * 0.80, 0)
  hub.name = 'wheel-hub'
  spin.add(hub)

  const bake = new THREE.Matrix4().makeRotationZ(sideSign * -Math.PI / 2)
  const bakeCal = bake.clone()
  spin.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.geometry.applyMatrix4(bake)
  })
  cal.geometry.applyMatrix4(bakeCal)
  for (const piston of pistons) piston.geometry.applyMatrix4(bakeCal)

  const root = new THREE.Group()
  root.add(spin)
  root.add(cal)
  for (const piston of pistons) root.add(piston)
  return { root, spin }
}

/* ---------------------------------- body ---------------------------------- */

// Wrap glazing band: same loft topology as the cabin, its ring mapped into a
// mid-height band and slightly inflated, so the painted roof frame above and
// the beltline below stay visible. Closed ring → no open tube seams.
function glassBandGeo(cabins: readonly Station[]): THREE.BufferGeometry {
  const z0 = cabins[0].z, z1 = cabins[cabins.length - 1].z
  const S = 24, uMin = 0.24, uMax = 0.90
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  const cols: Pt[][] = []
  for (let iz = 0; iz < S; iz++) {
    const z = THREE.MathUtils.lerp(z0, z1, iz / (S - 1))
    const st = interpStations(cabins, z)
    cols.push(getProfile(st.rt, st.rb, st.ts ?? 1))
  }
  const ring = cols[0].length
  for (const c of cols) if (c.length !== ring) throw new Error('[car] non-uniform glass ring')
  for (let iz = 0; iz < S; iz++) {
    const st = interpStations(cabins, THREE.MathUtils.lerp(z0, z1, iz / (S - 1)))
    const band = cols[iz]
    for (let j = 0; j < ring; j++) {
      const u = uMin + band[j].u * (uMax - uMin)
      pos.push(st.hw * 1.012 * band[j].s, st.by + (st.ty - st.by) * u, st.z)
      uv.push(j / ring, (st.z - z0) / 0.6)
    }
  }
  for (let iz = 0; iz < S - 1; iz++) {
    for (let j = 0; j < ring; j++) {
      const jn = (j + 1) % ring
      const a = iz * ring + j, b = a + ring, c = iz * ring + jn, d = b + (jn - j)
      idx.push(a, c, b, c, d, b)
    }
  }
  const g2 = new THREE.BufferGeometry()
  g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g2.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g2.setIndex(idx)
  ensureOutwardWinding(g2)
  crNormals(g2)
  g2.computeBoundingSphere()
  return g2
}

/* --------------------------------- build ---------------------------------- */

function named<T extends THREE.Object3D>(o: T, name: string): T {
  o.name = name
  return o
}

/** Diffuser fin x-positions for the kit's fin count; the shipped 4-fin set
 *  is verbatim, other counts spread evenly across the diffuser width. */
function diffuserFinXs(count: number): number[] {
  if (count <= 0) return []
  if (count === 4) return [-0.4, -0.13, 0.13, 0.4]
  return Array.from({ length: count }, (_, f) => count === 1 ? 0 : -0.4 + (f / (count - 1)) * 0.8)
}

/* An omitted hex resolves through the same pure precedence rule the UI uses
 * (null → the spec's signature finish), so poses/dev callers can pass one and
 * spec-only callers get the model's signature without hardcoding a colour. */
export function buildCar(paintHex: number | undefined = undefined, spec: CarSpec = HERO_SPEC): CarModel {
  const bodyHex = paintHex ?? resolvePaint(null, spec)
  const group = new THREE.Group()
  const paintMats: THREE.MeshPhysicalMaterial[] = []
  const mkPaint = (): THREE.MeshPhysicalMaterial => {
    const pp = carMaterialParamsFor(spec).paint
    const maps = carPaintMaps(7, pp.flakeSpeckle, pp.flakeRepeat)
    // the micro-roughness breakup drives the normal strength: calibrated so
    // the hero's own breakup reproduces the shipped fixed 0.5. DIRECTION (R3-7,
    // corrected from the earlier reversed claim): microRoughness is
    // clamp01(roughness·0.6 + flake·0.25), so the DENSE-FLAKE models read MORE
    // breakup than hero, not less — grip 0.3925 (satin: rough 0.55 carries it),
    // drift 0.3025 and hyper 0.2955 (gloss, but flake 0.85/0.75 lifts them)
    // against HERO_MICRO 0.293. Only the normal map's micro-roughness is
    // raised; the clearcoat layer keeps gloss models visibly glossier.
    const ns = clamp01(0.5 + (pp.microRoughness - HERO_MICRO))
    const m = new THREE.MeshPhysicalMaterial({
      color: bodyHex, metalness: pp.metalness, roughness: pp.roughness,
      roughnessMap: maps.roughnessMap, normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(ns, ns),
      clearcoat: pp.clearcoat, clearcoatRoughness: pp.clearcoatRoughness,
      clearcoatNormalMap: paintMicroRoughness(),
      sheen: pp.sheen, sheenRoughness: pp.sheenRoughness,
      envMapIntensity: pp.envMapIntensity,
    })
    paintMats.push(m)
    return m
  }

  const paint = mkPaint()
  const wr = VEHICLE.wheelRadius * spec.kit.wheelRadiusMul
  const ww = VEHICLE.wheelWidth * spec.kit.wheelWidthMul
  const plan = detailPlanFor(spec.kit)
  const lastStation = spec.shape.bodyStations[spec.shape.bodyStations.length - 1]

  // main body + cabin hulls (lofted, smooth) + wrap glazing
  group.add(named(new THREE.Mesh(buildHull(spec.shape.bodyStations, 52, { caps: true }), paint), 'body'))
  group.add(named(new THREE.Mesh(buildHull(spec.shape.cabinStations, 30, { caps: true }), paint), 'cabin'))
  group.add(named(new THREE.Mesh(glassBandGeo(spec.shape.cabinStations), shared.glass(spec.finish)), 'glass'))

  // arch rims + dark liners
  for (const front of [true, false]) {
    const wz = VEHICLE.wheelbase / 2
    const z = front ? -wz : wz
    const wy = wr - 0.012
    const archR = wr + 0.042 + spec.kit.archExtension
    const linerR = wr + 0.014 + spec.kit.archExtension
    for (const side of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(archR, 0.038, 8, 30, Math.PI * 1.22), paint)
      rim.geometry.rotateZ(-0.37)
      rim.rotation.y = Math.PI / 2
      rim.position.set(side * (0.975 + spec.kit.archExtension), wy, z)
      group.add(named(rim, `arch_${front ? 'f' : 'r'}_${side < 0 ? 'l' : 'r'}`))
      const liner = new THREE.Mesh(new THREE.TorusGeometry(linerR, 0.026, 6, 24, Math.PI * 1.22), shared.darkSoft())
      liner.geometry.rotateZ(-0.37)
      liner.rotation.copy(rim.rotation)
      liner.position.set(side * (0.952 + spec.kit.archExtension), wy, z)
      group.add(named(liner, `archliner_${front ? 'f' : 'r'}_${side < 0 ? 'l' : 'r'}`))
    }
  }

  // bumpers / splitter / diffuser / skirts (beveled plates)
  const lamp = frontLampAnchors(spec.shape.bodyStations[0])
  const bumperF = new THREE.Mesh(roundedPlateGeo(1.62, 0.5, 0.12, 0.06), paint)
  bumperF.position.set(0, 0.46, -2.17)
  group.add(named(bumperF, 'bumper-front'))
  const intakeC = new THREE.Mesh(roundedPlateGeo(1.0, 0.17, 0.05, 0.04), shared.dark())
  intakeC.position.set(0, 0.36, lamp.intakeCenterZ)
  group.add(named(intakeC, 'intake-center'))
  if (spec.kit.sideIntakes) {
    for (const side of [-1, 1]) {
      const intakeS = new THREE.Mesh(roundedPlateGeo(0.26, 0.14, 0.04, 0.03), shared.dark())
      intakeS.position.set(side * 0.60, 0.42, lamp.intakeCenterZ + 0.01)
      group.add(named(intakeS, `intake-side-${side < 0 ? 'l' : 'r'}`))
    }
  }
  if (spec.kit.splitter !== 'none') {
    const big = spec.kit.splitter === 'big'
    const splitter = new THREE.Mesh(big ? roundedPlateGeo(2.0, 0.07, 0.05, 0.02) : roundedPlateGeo(1.76, 0.06, 0.05, 0.02), shared.carbon(spec.finish))
    splitter.position.set(0, big ? 0.195 : 0.21, -2.16)
    group.add(named(splitter, 'splitter'))
  }

  const bumperR = new THREE.Mesh(roundedPlateGeo(1.66, 0.46, 0.1, 0.055), paint)
  bumperR.position.set(0, 0.5, 2.16)
  group.add(named(bumperR, 'bumper-rear'))
  const diffuser = new THREE.Mesh(roundedPlateGeo(1.3, 0.24, 0.05, 0.03), shared.carbon(spec.finish))
  diffuser.position.set(0, 0.28, 2.235)
  group.add(named(diffuser, 'diffuser'))
  for (const fx of diffuserFinXs(spec.kit.diffuserFins)) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.11, 0.08), shared.carbon(spec.finish))
    fin.position.set(fx, 0.24, 2.26)
    group.add(named(fin, 'diffuser-fin'))
  }
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(roundedPlateGeo(1.55, 0.10, 0.07, 0.025), shared.carbon(spec.finish))
    skirt.rotation.y = Math.PI / 2
    skirt.position.set(side * 0.952, 0.348, 0.06)
    group.add(named(skirt, `skirt-${side < 0 ? 'l' : 'r'}`))
    const sill = new THREE.Mesh(roundedPlateGeo(1.30, 0.05, 0.02, 0.012), paint)
    sill.rotation.y = Math.PI / 2
    sill.position.set(side * 0.968, 0.385, 0.06)
    group.add(named(sill, `sill-${side < 0 ? 'l' : 'r'}`))
    // rocker filler: closes the daylight gap between skirt and ground so the
    // side view reads as solid rocker panel, not a bar floating over the road
    const rocker = new THREE.Mesh(roundedPlateGeo(1.95, 0.30, 0.05, 0.03), shared.dark())
    rocker.rotation.y = Math.PI / 2
    rocker.position.set(side * 0.90, 0.185, 0.055)
    group.add(named(rocker, `rocker-${side < 0 ? 'l' : 'r'}`))
  }

  // exhaust tips (read under the bumper) — dark chrome per the group-3
  // plan: single rounds (hero/grip), Slide King's twin stacked swagger
  // (drift), or the hyper's centre quad block under the GT wing
  for (const side of [-1, 1]) {
    if (plan.exhaust === 'quad') break
    const sn = side < 0 ? 'l' : 'r'
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.064, 0.18, 14), shared.chromeDark())
    tip.rotation.x = Math.PI / 2
    tip.position.set(side * 0.4, 0.245, 2.245)
    group.add(named(tip, `exhaust-${sn}`))
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), shared.darkSoft())
    inner.rotation.x = Math.PI / 2
    inner.position.set(side * 0.4, 0.245, 2.33)
    group.add(named(inner, `exhaust-inner-${sn}`))
    if (plan.exhaust === 'twin') {
      // stacked just above the lower round, sized to stay inside the 0.16..0.40
      // diffuser band so the twin pair reads as cut into the rear valance
      const tip2 = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.056, 0.18, 14), shared.chromeDark())
      tip2.rotation.x = Math.PI / 2
      tip2.position.set(side * 0.4, 0.352, 2.245)
      group.add(named(tip2, `exhaust2-${sn}`))
      const inner2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), shared.darkSoft())
      inner2.rotation.x = Math.PI / 2
      inner2.position.set(side * 0.4, 0.352, 2.33)
      group.add(named(inner2, `exhaust-inner2-${sn}`))
    }
  }
  if (plan.exhaust === 'quad') {
    const block = new THREE.Mesh(roundedPlateGeo(0.52, 0.24, 0.03, 0.05), shared.trim())
    block.position.set(0, 0.3, 2.262)
    group.add(named(block, 'exhaust-quad-block'))
    for (const [qi, qx] of [-0.165, -0.055, 0.055, 0.165].entries()) {
      const qt = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.046, 0.12, 12), shared.chromeDark())
      qt.rotation.x = Math.PI / 2
      qt.position.set(qx, 0.3, 2.292)
      group.add(named(qt, `exhaust-q${qi}`))
    }
  }

  // headlight clusters (shaped lenses, emissive) — anchored to this model's
  // own front station (F3), calibrated to the hero's shipped positions
  const headMats: THREE.MeshStandardMaterial[] = []
  for (const side of [-1, 1]) {
    const hous = new THREE.Mesh(roundedPlateGeo(0.42, 0.15, 0.045, 0.02), shared.dark())
    hous.position.set(side * 0.46, lamp.lampY, lamp.housingZ)
    hous.rotation.y = side * -0.07
    group.add(named(hous, `headlight-housing-${side < 0 ? 'l' : 'r'}`))
    const hm = new THREE.MeshStandardMaterial({ color: 0x39414d, emissive: new THREE.Color(0xfff1d6), emissiveIntensity: 0.95, roughness: 0.15 })
    const lens = new THREE.Mesh(roundedPlateGeo(0.36, 0.095, 0.024, 0.014), hm)
    lens.position.set(side * 0.46, lamp.lampY, lamp.lensZ)
    lens.rotation.y = hous.rotation.y
    group.add(named(lens, `headlight-lens-${side < 0 ? 'l' : 'r'}`))
    headMats.push(hm)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 8, 18), shared.chrome())
    ring.position.set(side * 0.46, lamp.lampY, lamp.ringZ)
    ring.rotation.y = hous.rotation.y
    group.add(named(ring, `headlight-ring-${side < 0 ? 'l' : 'r'}`))
    // group-3 projector cluster in the ring mouth: dark barrel + emissive
    // lens disc (rides the per-car headlight material so setHeadlights
    // brightens the pupil with the lens), plus a slim accent DRL strip on
    // the housing crown kept at bloom-safe emissive
    if (plan.projectorLamps) {
      const sn = side < 0 ? 'l' : 'r'
      // open-ended barrel so the lens disc reads as a lit pupil inside the
      // ring (a capped can buries the emissive disc behind its front face)
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.05, 0.06, 14, 1, true), shared.trim())
      can.rotation.x = Math.PI / 2
      can.position.set(side * 0.46, lamp.lampY, lamp.lensZ)
      group.add(named(can, `headlight-can-${sn}`))
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.012, 14), hm)
      disc.rotation.x = Math.PI / 2
      disc.position.set(side * 0.46, lamp.lampY, lamp.projectorZ)
      group.add(named(disc, `headlight-projector-${sn}`))
      const drl = new THREE.Mesh(roundedPlateGeo(0.40, 0.020, 0.016, 0.008), shared.ledDrl(spec.finish.accent))
      drl.position.set(side * 0.46, lamp.drlY, lamp.drlZ)
      drl.rotation.y = hous.rotation.y
      group.add(named(drl, `headlight-drl-${sn}`))
    }
  }

  // tail light bar + brake lenses (emissive, brake-reactive) — attached to the
  // rear bumper/hull surface, not floating
  const tailBase = new THREE.Mesh(roundedPlateGeo(1.34, 0.12, 0.03, 0.02), shared.dark())
  tailBase.position.set(0, 0.62, 2.22)
  group.add(named(tailBase, 'taillight-base'))
  const brakeMats: THREE.MeshStandardMaterial[] = []
  for (const side of [-1, 1]) {
    const bm = new THREE.MeshStandardMaterial({ color: 0x531210, emissive: new THREE.Color(0xff2518), emissiveIntensity: 0.80, roughness: 0.25 })
    const lens = new THREE.Mesh(roundedPlateGeo(0.50, 0.055, 0.022, 0.012), bm)
    lens.position.set(side * 0.34, 0.62, 2.268)
    group.add(named(lens, `taillight-lens-${side < 0 ? 'l' : 'r'}`))
    brakeMats.push(bm)
  }
  const tailBar = new THREE.Mesh(roundedPlateGeo(0.50, 0.026, 0.018, 0.008), brakeMats[0])
  tailBar.position.set(0, 0.62, 2.268)
  group.add(named(tailBar, 'taillight-bar'))
  // group-3 signature strip: a full-width accent LED bar on a dark recess
  // plate, hugging THIS model's own tail-cap plane (the long-tailed hyper
  // swallows fixed-z lamps; the cap station keeps the strip on the body).
  // Width stays inside the cap's straight flank so no end floats in air.
  if (plan.ledTailBar) {
    const barW = lastStation.hw * 1.6
    const recess = new THREE.Mesh(roundedPlateGeo(barW * 1.08, 0.056, 0.014, 0.014), shared.trim())
    recess.position.set(0, lastStation.ty - 0.055, lastStation.z + 0.006)
    group.add(named(recess, 'taillight-recess'))
    const led = new THREE.Mesh(roundedPlateGeo(barW, 0.026, 0.016, 0.009), shared.ledTail(spec.finish.accent))
    led.position.set(0, lastStation.ty - 0.055, lastStation.z + 0.020)
    group.add(named(led, 'taillight-led'))
  }

  // mirrors on stalks
  for (const side of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.022, 0.12, 8), shared.dark())
    stalk.rotation.z = side * 0.55
    stalk.position.set(side * 0.935, 0.82, -0.82)
    group.add(named(stalk, `mirror-stalk-${side < 0 ? 'l' : 'r'}`))
    const head = new THREE.Mesh(roundedPlateGeo(0.155, 0.085, 0.045, 0.02), paint)
    head.position.set(side * 1.005, 0.885, -0.86)
    head.rotation.y = side * -0.3
    group.add(named(head, `mirror-head-${side < 0 ? 'l' : 'r'}`))
    const g = new THREE.Mesh(new THREE.PlaneGeometry(0.098, 0.048), shared.glass(spec.finish))
    g.position.set(side * 1.030, 0.885, -0.86)
    g.rotation.y = side * (Math.PI / 2 - 0.18)
    group.add(named(g, `mirror-glass-${side < 0 ? 'l' : 'r'}`))
  }

  // group-3 door-band hardware: slim dark-trim handle bars (flush-backed,
  // proud by a few cm so they catch the rim light at the side-shot distance)
  // and dark shut lines on the door cut + bonnet-side seam
  for (const [hi, hz] of [-0.38, 0.32].slice(0, plan.handlesPerSide).entries()) {
    const hSt = interpStations(spec.shape.bodyStations, hz)
    for (const side of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.026, 0.13), shared.trim())
      bar.position.set(side * (hSt.hw + 0.012), 0.70, hz)
      group.add(named(bar, `door-handle-${hi === 0 ? 'f' : 'r'}-${side < 0 ? 'l' : 'r'}`))
    }
  }
  if (plan.shutLines > 0) {
    const dSt = interpStations(spec.shape.bodyStations, 0.60)
    const bSt = interpStations(spec.shape.bodyStations, -1.72)
    for (const side of [-1, 1]) {
      const sn = side < 0 ? 'l' : 'r'
      const cut = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.30, 0.016), shared.trim())
      cut.position.set(side * (dSt.hw + 0.004), 0.605, 0.60)
      group.add(named(cut, `shut-door-${sn}`))
      const bon = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.16, 0.016), shared.trim())
      bon.position.set(side * (bSt.hw + 0.004), 0.70, -1.72)
      bon.rotation.x = 0.05
      group.add(named(bon, `shut-bonnet-${sn}`))
    }
  }

  // rear spoiler on struts
  if (spec.kit.spoiler !== 'none') {
    const gt = spec.kit.spoiler === 'gt'
    for (const side of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.040, gt ? 0.20 : 0.120, 0.120), paint)
      strut.position.set(side * 0.56, gt ? 0.80 : 0.755, 2.06)
      group.add(named(strut, `spoiler-strut-${side < 0 ? 'l' : 'r'}`))
    }
    const blade = new THREE.Mesh(gt ? roundedPlateGeo(1.44, 0.05, 0.032, 0.013) : roundedPlateGeo(1.34, 0.045, 0.03, 0.012), shared.carbon(spec.finish))
    blade.position.set(0, gt ? 0.92 : 0.840, 2.08)
    blade.rotation.x = gt ? -0.14 : -0.09
    group.add(named(blade, 'spoiler-blade'))
  }

  // hood power lines + cowl vent (greebles)
  if (spec.kit.hoodVent) {
    for (const side of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.008, 0.5), shared.dark())
      line.position.set(side * 0.34, 0.882, -1.55)
      line.rotation.x = 0.05
      group.add(named(line, `hood-line-${side < 0 ? 'l' : 'r'}`))
    }
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.012, 0.07), shared.carbon(spec.finish))
    cowl.position.set(0, 0.905, -0.92)
    cowl.rotation.x = -0.3
    group.add(named(cowl, 'cowl-vent'))
  }
  if (spec.kit.roofScoop) {
    const scoop = new THREE.Mesh(roundedPlateGeo(0.34, 0.10, 0.05, 0.02), shared.carbon(spec.finish))
    scoop.position.set(0, 1.075, -0.55)
    scoop.rotation.x = -0.35
    group.add(named(scoop, 'roof-scoop'))
  }
  // group-3 hood hardware: recessed-look dark slats for the breathing cars,
  // a single pressed paint ridge for the hyper (plan-gated; hero stays plain)
  for (let si = 0; si < plan.hoodSlats; si++) {
    const sz = -1.44 - si * 0.14
    const sSt = interpStations(spec.shape.bodyStations, sz)
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.014, 0.05), shared.trim())
    slat.position.set(0, sSt.ty + 0.006, sz)
    slat.rotation.x = 0.07
    group.add(named(slat, `hood-slat-${si}`))
  }
  if (plan.hoodDome) {
    const dz = -1.52
    const dSt = interpStations(spec.shape.bodyStations, dz)
    const domeGeo = roundedPlateGeo(0.46, 0.6, 0.03, 0.14)
    domeGeo.rotateX(-Math.PI / 2)
    const dome = new THREE.Mesh(domeGeo, paint)
    dome.position.set(0, dSt.ty + 0.008, dz)
    dome.rotation.x = 0.06
    group.add(named(dome, 'hood-dome'))
  }

  // interior hints visible through glass
  for (const side of [-1, 1]) {
    const seatBase = new THREE.Mesh(roundedPlateGeo(0.38, 0.38, 0.08, 0.05), shared.darkSoft())
    seatBase.rotation.x = Math.PI / 2 - 0.12
    seatBase.position.set(side * 0.28, 0.83, 0.42)
    group.add(named(seatBase, `seat-base-${side < 0 ? 'l' : 'r'}`))
    const back = new THREE.Mesh(roundedPlateGeo(0.38, 0.32, 0.07, 0.06), shared.darkSoft())
    back.rotation.x = -0.28
    back.position.set(side * 0.28, 0.86, 0.60)
    group.add(named(back, `seat-back-${side < 0 ? 'l' : 'r'}`))
  }
  const dash = new THREE.Mesh(roundedPlateGeo(0.9, 0.08, 0.15, 0.03), shared.darkSoft())
  dash.position.set(0, 0.88, -0.80)
  dash.rotation.x = 0.3
  group.add(named(dash, 'dash'))
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.015, 6, 20), shared.dark())
  wheelRim.position.set(-0.30, 0.89, -0.64)
  wheelRim.rotation.x = 1.1
  group.add(named(wheelRim, 'steering-wheel'))

  // nitro flames (hidden until nitro)
  const flameMats: THREE.MeshBasicMaterial[] = []
  const flames: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9cc9ff), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.5, 10), fm)
    f.rotation.x = -Math.PI / 2
    f.position.set(side * 0.4, 0.245, 2.52)
    group.add(named(f, `flame-${side < 0 ? 'l' : 'r'}`))
    const fm2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf2f8ff), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    const f2 = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.3, 8), fm2)
    f2.rotation.x = -Math.PI / 2
    f2.position.set(side * 0.4, 0.245, 2.42)
    group.add(named(f2, `flame-core-${side < 0 ? 'l' : 'r'}`))
    flameMats.push(fm, fm2)
    flames.push(f, f2)
  }

  // wheels FL FR RL RR
  const wheels: WheelHandle[] = []
  const spokeCount = spokeCountForStyle(spec.kit.wheelStyle)
  for (const front of [true, false]) {
    const z = front ? -VEHICLE.wheelbase / 2 : VEHICLE.wheelbase / 2
    for (const side of [-1, 1]) {
      // R2-8: the caliper colour arrives through the carMaterialParamsFor
      // contract (the same door as the paint params), not a side-read of the kit
      const { root, spin } = buildWheelAssembly(side === 1 ? 1 : -1, ww, spokeCount, wr, carMaterialParamsFor(spec).caliper)
      let steer: THREE.Group | null = null
      if (front) {
        steer = new THREE.Group()
        steer.add(root)
        group.add(named(steer, `wheel-${front ? 'f' : 'r'}-${side < 0 ? 'l' : 'r'}`))
        steer.position.set(side * ((VEHICLE.trackWidth / 2) * spec.kit.trackMul), wr - 0.012, z)
      } else {
        group.add(named(root, `wheel-${front ? 'f' : 'r'}-${side < 0 ? 'l' : 'r'}`))
        root.position.set(side * ((VEHICLE.trackWidth / 2) * spec.kit.trackMul), wr - 0.012, z)
      }
      wheels.push({ steer, spin, radius: wr, front })
    }
  }

  // shadows: solid parts cast, glass/flames do not — and the sub-3 cm raised
  // detail trim never casts (a few-px shadow map draw per strip is invisible
  // at scene scale but doubles the detail set's per-frame chain cost)
  group.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      const mm = m.material as THREE.Material
      m.castShadow = !mm.transparent && !(m.name && SHADOWLESS_DETAIL.has(m.name))
      m.receiveShadow = false
    }
  })

  // Fold the static chassis into render-identical materials while keeping
  // wheels, steering/flame animation, and brake/headlight glow carriers intact.
  // PR review F10: only names with a live consumer or a runtime transform are
  // kept out of the merge. Everything else (lens cans, handles, slats, trims)
  // folds freely — the glow/DRL carriers are the MATERIALS captured in
  // brakeMats/headMats, which survive the merge, and the scripts/harness only
  // ever look up 'tire' (harness shot poses) and 'wheel-spoke' (functional
  // spoke-count checks). The flame meshes are scaled per-frame by setNitro,
  // so they must never fuse into a static bucket.
  // PR review R2-1: the four wheel GROUP names and the 'wheel-spin' landmark
  // stay in the list because StaticBatch.collect only opens a fold scope at a
  // NAMED group: with them pruned, the wheel hardware (dish, lip, hub, discs,
  // caliper...) folded past spin/root into the CAR ROOT with build-time
  // matrices baked in — Vehicle.bind turns spin/root every frame and the rims
  // stood still beside the turning tyres. With the landmarks restored the
  // rotating hardware folds into each wheel's own spin group and the static
  // caliper hardware into its wheel root group (still fewer draws than the
  // fully unmerged pre-F10 tree).
  mergeStaticMeshes(group, {
    keepNames: [
      'tire', 'wheel-spoke', 'wheel-spin',
      'wheel-f-l', 'wheel-f-r', 'wheel-r-l', 'wheel-r-r',
      'flame-l', 'flame-r', 'flame-core-l', 'flame-core-r',
    ],
  })

  let brakeVal = 0
  return {
    group,
    wheels,
    paintMats,
    setBrake(v: number) {
      if (brakeVal === v) return
      brakeVal = v
      for (const bm of brakeMats) bm.emissiveIntensity = 0.80 + v * 3.20
    },
    setNitro(v: number) {
      for (let i = 0; i < flameMats.length; i++) {
        const outer = i % 2 === 0
        flameMats[i].opacity = clamp01(v) * (outer ? 0.85 : 1)
      }
      for (const f of flames) f.scale.set(1, 0.65 + v * 0.6, 1)
    },
    setHeadlights(on: boolean) {
      for (const hm of headMats) hm.emissiveIntensity = on ? 1.8 : 0.35
    },
    setPaint(hex: number) {
      for (const pm of paintMats) pm.color.set(hex)
    },
  }
}
