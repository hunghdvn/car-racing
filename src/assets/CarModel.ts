import * as THREE from 'three'
import { VEHICLE } from '../config'
import { clamp01 } from '../util'
import { mergeStaticMeshes } from '../world/StaticBatch'
import { alloyRoughness, carPaintMaps, carbonWeaveMaps, paintMicroRoughness, roundedPlateGeo, tireTreadNormal } from './Textures'
import { carbonMaterialParams, glassMaterialParams, paintMaterialParams } from './MaterialSpecs'
import { HERO_SPEC, resolvePaint, spokeCountForStyle, type CarFinish, type CarSpec, type CarShape } from '../vehicles/CarSpecs'

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

/* -------------------------------- materials ------------------------------- */

const shared = {
  rubber(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.86, metalness: 0.02, normalMap: tireTreadNormal(), normalScale: new THREE.Vector2(0.8, 0.8) })
  },
  chrome(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0xd6dde6, metalness: 1, roughness: 0.11 })
  },
  alloy(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x98a8c0, metalness: 0.65, roughness: 0.2, roughnessMap: alloyRoughness() })
  },
  dark(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55, metalness: 0.25 })
  },
  darkSoft(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.9, metalness: 0 })
  },
  glass(finish: CarFinish): THREE.MeshPhysicalMaterial {
    const gp = glassMaterialParams(finish)
    return new THREE.MeshPhysicalMaterial({
      color: gp.color, roughness: gp.roughness, metalness: gp.metalness,
      transparent: true, opacity: gp.opacity, ior: gp.ior, envMapIntensity: gp.envMapIntensity,
    })
  },
  disc(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x33383f, metalness: 0.94, roughness: 0.36 })
  },
  caliper(hex: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.4, metalness: 0.3 })
  },
  carbon(finish: CarFinish): THREE.MeshStandardMaterial {
    const cp = carbonMaterialParams(finish)
    const weave = carbonWeaveMaps(cp.repeat)
    return new THREE.MeshStandardMaterial({
      color: cp.color, roughness: cp.roughness, metalness: 0.32,
      normalMap: weave.normalMap, normalScale: new THREE.Vector2(cp.normalScale, cp.normalScale),
      roughnessMap: weave.roughnessMap, envMapIntensity: cp.envMapIntensity,
    })
  },
  // brushed steel ring standing proud of the disc face (rotates with the wheel)
  discRing(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x5b616a, metalness: 0.95, roughness: 0.3 })
  },
}

/* --------------------------------- wheels --------------------------------- */

/**
 * Proper sports-coupe wheel (spec §6 / §4.1): dimensions come from the
 * per-car kit. Built around its own +Y axle (outboard face at +Y), then the
 * axle is baked onto world X with sideSign so both left/right wheels face
 * outboard.
 */
function buildWheelAssembly(sideSign: 1 | -1, width: number, spokeCount: number, radius: number, finish: CarFinish): { root: THREE.Group; spin: THREE.Group } {
  const R = radius
  const hw = width / 2
  const spin = new THREE.Group()

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
  const sidewall = new THREE.Mesh(new THREE.TorusGeometry(R * 0.72, 0.03, 6, 34), new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.92, metalness: 0 }))
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
  const cal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.052, 0.055), shared.caliper(finish.accent))
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
    const pp = paintMaterialParams(spec.finish)
    const maps = carPaintMaps(7, pp.flakeSpeckle, pp.flakeRepeat)
    const m = new THREE.MeshPhysicalMaterial({
      color: bodyHex, metalness: pp.metalness, roughness: pp.roughness,
      roughnessMap: maps.roughnessMap, normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
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
  const bumperF = new THREE.Mesh(roundedPlateGeo(1.62, 0.5, 0.12, 0.06), paint)
  bumperF.position.set(0, 0.46, -2.17)
  group.add(named(bumperF, 'bumper-front'))
  const intakeC = new THREE.Mesh(roundedPlateGeo(1.0, 0.17, 0.05, 0.04), shared.dark())
  intakeC.position.set(0, 0.36, -2.29)
  group.add(named(intakeC, 'intake-center'))
  if (spec.kit.sideIntakes) {
    for (const side of [-1, 1]) {
      const intakeS = new THREE.Mesh(roundedPlateGeo(0.26, 0.14, 0.04, 0.03), shared.dark())
      intakeS.position.set(side * 0.60, 0.42, -2.28)
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

  // exhaust tips (read under the bumper)
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.064, 0.18, 14), shared.chrome())
    tip.rotation.x = Math.PI / 2
    tip.position.set(side * 0.4, 0.245, 2.245)
    group.add(named(tip, `exhaust-${side < 0 ? 'l' : 'r'}`))
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), shared.darkSoft())
    inner.rotation.x = Math.PI / 2
    inner.position.set(side * 0.4, 0.245, 2.33)
    group.add(named(inner, `exhaust-inner-${side < 0 ? 'l' : 'r'}`))
  }

  // headlight clusters (shaped lenses, emissive)
  const headMats: THREE.MeshStandardMaterial[] = []
  for (const side of [-1, 1]) {
    const hous = new THREE.Mesh(roundedPlateGeo(0.42, 0.15, 0.045, 0.02), shared.dark())
    hous.position.set(side * 0.46, 0.66, -2.245)
    hous.rotation.y = side * -0.07
    group.add(named(hous, `headlight-housing-${side < 0 ? 'l' : 'r'}`))
    const hm = new THREE.MeshStandardMaterial({ color: 0x39414d, emissive: new THREE.Color(0xfff1d6), emissiveIntensity: 0.95, roughness: 0.15 })
    const lens = new THREE.Mesh(roundedPlateGeo(0.36, 0.095, 0.024, 0.014), hm)
    lens.position.set(side * 0.46, 0.66, -2.268)
    lens.rotation.y = hous.rotation.y
    group.add(named(lens, `headlight-lens-${side < 0 ? 'l' : 'r'}`))
    headMats.push(hm)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 8, 18), shared.chrome())
    ring.position.set(side * 0.46, 0.66, -2.282)
    ring.rotation.y = hous.rotation.y
    group.add(named(ring, `headlight-ring-${side < 0 ? 'l' : 'r'}`))
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
      const { root, spin } = buildWheelAssembly(side === 1 ? 1 : -1, ww, spokeCount, wr, spec.finish)
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

  // shadows: solid parts cast, glass/flames do not
  group.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      const mm = m.material as THREE.Material
      m.castShadow = !mm.transparent
      m.receiveShadow = false
    }
  })

  // Fold the static chassis into render-identical materials while keeping
  // wheels, steering/flame animation, and brake/headlight glow carriers intact.
  mergeStaticMeshes(group, {
    keepNames: [
      'tire', 'tire-sidewall', 'wheelback', 'brake-disc', 'brake-disc-ring', 'brake-caliper', 'brake-piston',
      'wheel-dish', 'wheel-lip', 'wheel-spoke', 'wheel-hub', 'wheel-f-l', 'wheel-f-r',
      'wheel-r-l', 'wheel-r-r', 'headlight-lens-l', 'headlight-lens-r',
      'taillight-lens-l', 'taillight-lens-r', 'taillight-bar',
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
