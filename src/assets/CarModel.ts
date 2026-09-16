import * as THREE from 'three'
import { VEHICLE } from '../config'
import { clamp01 } from '../util'
import { alloyRoughness, carPaintMaps, roundedPlateGeo, tireTreadNormal } from './Textures'

/* ------------------------------------------------------------------------- *
 * Velocity Rush hero-car kit (spec rev.3 §4.1 / §6).
 * Construction strategy — continuous automotive surface construction:
 *   · lofted/swept closed cross-sections sampled along length, profiles are
 *     rounded-shoulder sections whose width/top/bottom follow authored
 *     automotive stations with Catmull-Rom interpolation (no box flanks)
 *   · separate lofted cabin greenhouse + independent inset glass band
 *   · beveled rounded-plate panels (bumpers, splitter, diffuser, spoiler)
 *   · lathe wheels: tread band + rounded shoulders, alloy dish + 5 spokes,
 *     hub, brake disc + caliper
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

function roundedUnitProfile(rt: number, rb: number, ts: number, seg = 4): Pt[] {
  const pts: Pt[] = []
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
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
  // top-pinch (roof/greenhouse taper) blended in by height
  for (const p of pts) if (p.u > 0.5) p.s *= THREE.MathUtils.lerp(1, ts, clamp01((p.u - 0.5) / 0.5))
  // dedupe consecutive
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

function interpStations(sts: Station[], z: number): Station {
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

/** Catmull-Rom smoothed vertex normals for indexed lofted hulls. */
function crNormals(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const idx = geo.getIndex() as THREE.BufferAttribute
  const n = pos.count
  const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n)
  const ax = new Float32Array(3), bx = new Float32Array(3), cx = new Float32Array(3)
  for (let f = 0; f < idx.count; f += 3) {
    const ia = idx.getX(f), ib = idx.getX(f + 1), ic = idx.getX(f + 2)
    ax[0] = pos.getX(ia); ax[1] = pos.getY(ia); ax[2] = pos.getZ(ia)
    bx[0] = pos.getX(ib); bx[1] = pos.getY(ib); bx[2] = pos.getZ(ib)
    cx[0] = pos.getX(ic); cx[1] = pos.getY(ic); cx[2] = pos.getZ(ic)
    const ux = bx[0] - ax[0], uy = bx[1] - ax[1], uz = bx[2] - ax[2]
    const vx = cx[0] - ax[0], vy = cx[1] - ax[1], vz = cx[2] - ax[2]
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    nx[ia] += fx; ny[ia] += fy; nz[ia] += fz
    nx[ib] += fx; ny[ib] += fy; nz[ib] += fz
    nx[ic] += fx; ny[ic] += fy; nz[ic] += fz
  }
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    let x = nx[i], y = ny[i], z = nz[i]
    const len = Math.hypot(x, y, z) || 1
    x /= len; y /= len; z /= len
    arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z
  }
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(arr, 3))
}

/**
 * Loft a hull through authored stations.
 * Columns = interpolated stations along z; ring = rounded-shoulder profile.
 */
function buildHull(stations: Station[], samples: number, opts: { caps?: boolean; vScale?: number; hwScale?: number } = {}): THREE.BufferGeometry {
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
  for (let iz = 0; iz < S; iz++) {
    const st = interpStations(stations, THREE.MathUtils.lerp(z0, z1, iz / (S - 1)))
    const prof = cols[iz]
    for (let j = 0; j < prof.length; j++) {
      pos.push(st.hw * hwScale * prof[j].s, st.by + (st.ty - st.by) * prof[j].u, st.z)
      uv.push(j / (prof.length - 1), (st.z - z0) / vScale)
    }
  }
  const ring = cols[0].length
  for (let iz = 0; iz < S - 1; iz++) {
    for (let j = 0; j < ring - 1; j++) {
      const a = iz * ring + j, b = a + ring, c = a + 1, d = b + 1
      idx.push(a, b, c, c, b, d)
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
      let cx = 0, cy = 0, cz = 0
      for (const p of prof) { cx += p.s; cy += p.u }
      cx = (cx / prof.length) * 0.3
      const base = iz * ring
      const centerVert = pos.length / 3
      const st = interpStations(stations, iz === 0 ? z0 : z1)
      pos.push(cx * st.hw * hwScale, st.by + (st.ty - st.by) * 0.5, st.z)
      uv.push(0.5, 0.5)
      for (let j = 0; j < prof.length - 1; j++) {
        if (flip < 0) capIdx.push(centerVert, base + j + 1, base + j)
        else capIdx.push(centerVert, base + j, base + j + 1)
      }
    }
    const ex = geo.getAttribute('position') as THREE.BufferAttribute
    void ex
    geo.setIndex([...idx, ...capIdx])
    const pAttr = geo.getAttribute('position') as THREE.BufferAttribute
    void pAttr
  }
  crNormals(geo)
  geo.computeBoundingSphere()
  return geo
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
    return new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.3, roughnessMap: alloyRoughness() })
  },
  dark(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55, metalness: 0.25 })
  },
  darkSoft(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.9, metalness: 0 })
  },
  glass(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({ color: 0x1c2833, roughness: 0.045, metalness: 0, transparent: true, opacity: 0.46, ior: 1.5 })
  },
  disc(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x555b63, metalness: 0.9, roughness: 0.42 })
  },
  caliper(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0xc23a28, roughness: 0.4, metalness: 0.3 })
  },
}

/* --------------------------------- wheels --------------------------------- */

function buildWheelAssembly(): { root: THREE.Group; spin: THREE.Group } {
  const wheelR = VEHICLE.wheelRadius
  const wheelW = VEHICLE.wheelWidth
  const spin = new THREE.Group()

  // tire — lathe section: tread band + rounded shoulders
  const tp: THREE.Vector2[] = [
    [0.000, 0.150], [0.200, 0.148], [0.260, 0.165], [0.310, 0.210], [0.344, 0.270],
    [0.358, 0.325], [0.360, 0.360], [0.358, 0.395], [0.344, 0.450], [0.310, 0.510],
    [0.255, 0.552], [0.200, 0.572], [0.000, 0.570],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const tireGeo = new THREE.LatheGeometry(tp, 34)
  const tire = new THREE.Mesh(tireGeo, shared.rubber())
  spin.add(tire)

  // alloy dish + lip
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.2, 0.03, 26), shared.alloy())
  dish.position.y = 0.215
  spin.add(dish)
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.242, 0.016, 8, 30), shared.alloy())
  lip.rotateX(Math.PI / 2)
  lip.position.y = 0.235
  spin.add(lip)

  // five spokes
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.Mesh(roundedPlateGeo(0.075, 0.19, 0.026, 0.01), shared.alloy())
    sp.rotateX(Math.PI / 2)
    sp.rotation.y = (k * Math.PI * 2) / 5
    sp.position.set(Math.sin(sp.rotation.y) * 0.145, 0.235, Math.cos(sp.rotation.y) * 0.145)
    spin.add(sp)
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.03, 14), shared.chrome())
  hub.position.y = 0.262
  spin.add(hub)

  // brake disc + caliper (outboard face)
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.238, 0.238, 0.024, 26), shared.disc())
  disc.position.y = 0.125
  spin.add(disc)
  const cal = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.045, 0.1), shared.caliper())
  cal.position.set(0, 0.125, 0.185)
  spin.add(cal)

  // bake axle Y -> X so `spin` rotates about its local X
  const bake = new THREE.Matrix4().makeRotationZ(-Math.PI / 2)
  spin.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.geometry.applyMatrix4(bake)
  })
  const root = new THREE.Group()
  root.add(spin)
  return { root, spin }
}

/* ---------------------------------- body ---------------------------------- */

const BODY_STATIONS: Station[] = [
  { z: -2.265, hw: 0.795, by: 0.300, ty: 0.790, rt: 0.150, rb: 0.115 },
  { z: -2.075, hw: 0.885, by: 0.312, ty: 0.862, rt: 0.135, rb: 0.085 },
  { z: -1.735, hw: 0.933, by: 0.340, ty: 0.940, rt: 0.105, rb: 0.055 },
  { z: -1.310, hw: 0.964, by: 0.348, ty: 0.952, rt: 0.075, rb: 0.035 },
  { z: -0.950, hw: 0.984, by: 0.330, ty: 0.968, rt: 0.055, rb: 0.030 },
  { z: -0.450, hw: 0.995, by: 0.318, ty: 0.950, rt: 0.045, rb: 0.030 },
  { z: 0.060, hw: 0.995, by: 0.318, ty: 0.925, rt: 0.040, rb: 0.030 },
  { z: 0.560, hw: 1.005, by: 0.318, ty: 0.936, rt: 0.050, rb: 0.032 },
  { z: 1.105, hw: 1.001, by: 0.330, ty: 0.956, rt: 0.090, rb: 0.042 },
  { z: 1.625, hw: 0.956, by: 0.354, ty: 0.960, rt: 0.120, rb: 0.070 },
  { z: 1.985, hw: 0.880, by: 0.374, ty: 0.872, rt: 0.135, rb: 0.098 },
  { z: 2.265, hw: 0.762, by: 0.410, ty: 0.726, rt: 0.135, rb: 0.098 },
]

const CABIN_STATIONS: Station[] = [
  { z: -1.020, hw: 0.700, by: 0.885, ty: 1.285, rt: 0.100, rb: 0.100, ts: 0.62 },
  { z: -0.640, hw: 0.725, by: 0.905, ty: 1.360, rt: 0.100, rb: 0.100, ts: 0.66 },
  { z: -0.200, hw: 0.740, by: 0.920, ty: 1.428, rt: 0.100, rb: 0.100, ts: 0.72 },
  { z: 0.300, hw: 0.742, by: 0.925, ty: 1.442, rt: 0.100, rb: 0.100, ts: 0.74 },
  { z: 0.720, hw: 0.712, by: 0.925, ty: 1.398, rt: 0.100, rb: 0.100, ts: 0.72 },
  { z: 1.080, hw: 0.652, by: 0.900, ty: 1.230, rt: 0.120, rb: 0.120, ts: 0.68 },
  { z: 1.300, hw: 0.585, by: 0.860, ty: 1.040, rt: 0.140, rb: 0.140, ts: 0.60 },
]

// glass band: same loft restricted to a mid-height profile band and slightly
// inflated, so the painted cabin pillars remain visible above/below it.
function glassBandGeo(): THREE.BufferGeometry {
  const z0 = CABIN_STATIONS[0].z, z1 = CABIN_STATIONS[CABIN_STATIONS.length - 1].z
  const S = 26, uMin = 0.16, uMax = 0.78
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  let ringLen = 0
  const rows: { z: number; st: Station }[] = []
  for (let iz = 0; iz < S; iz++) {
    const z = THREE.MathUtils.lerp(z0, z1, iz / (S - 1))
    rows.push({ z, st: interpStations(CABIN_STATIONS, z) })
  }
  const bands: Pt[][] = rows.map(({ st }) => {
    const full = getProfile(st.rt, st.rb, st.ts ?? 1)
    const out: Pt[] = []
    for (const p of full) {
      const u = clamp01((p.u - uMin) / (uMax - uMin)) * (uMax - uMin) + uMin
      const q = out[out.length - 1]
      if (!q || Math.abs(q.u - u) > 1e-4 || Math.abs(q.s - p.s) > 1e-4) out.push({ u, s: p.s })
    }
    return out
  })
  ringLen = bands[0].length
  for (let iz = 0; iz < S; iz++) {
    const { st } = rows[iz]
    const band = bands[iz]
    for (let j = 0; j < band.length; j++) {
      pos.push(st.hw * 1.012 * band[j].s, st.by + (st.ty - st.by) * band[j].u, st.z)
      uv.push(j / (band.length - 1), (st.z - z0) / 0.6)
    }
  }
  for (let iz = 0; iz < S - 1; iz++) for (let j = 0; j < ringLen - 1; j++) {
    const a = iz * ringLen + j, b = a + ringLen, c = a + 1, d = b + 1
    idx.push(a, b, c, c, b, d)
  }
  const g2 = new THREE.BufferGeometry()
  g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g2.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g2.setIndex(idx)
  crNormals(g2)
  g2.computeBoundingSphere()
  return g2
}

/* --------------------------------- build ---------------------------------- */

export function buildCar(paintHex: number): CarModel {
  const group = new THREE.Group()
  const paintMats: THREE.MeshPhysicalMaterial[] = []
  const mkPaint = (): THREE.MeshPhysicalMaterial => {
    const maps = carPaintMaps(7)
    const m = new THREE.MeshPhysicalMaterial({
      color: paintHex, metalness: 0.62, roughness: 0.34,
      roughnessMap: maps.roughnessMap, normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      clearcoat: 1, clearcoatRoughness: 0.06,
    })
    paintMats.push(m)
    return m
  }

  const paint = mkPaint()

  // main body + cabin hulls (lofted, smooth)
  group.add(new THREE.Mesh(buildHull(BODY_STATIONS, 52, { caps: true }), paint))
  group.add(new THREE.Mesh(buildHull(CABIN_STATIONS, 30, { caps: true }), paint))
  group.add(new THREE.Mesh(glassBandGeo(), shared.glass()))

  // arch rims + dark liners
  for (const front of [true, false]) {
    const z = front ? -VEHICLE.wheelbaseFront : VEHICLE.wheelbaseFront
    for (const side of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.475, 0.042, 8, 30, Math.PI * 1.24), paint)
      rim.rotation.order = 'YZX'
      rim.rotation.set(-1.1, Math.PI / 2, 0)
      rim.position.set(side * 0.965, 0.36, z)
      group.add(rim)
      const liner = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.03, 6, 24, Math.PI * 1.24), shared.darkSoft())
      liner.rotation.copy(rim.rotation)
      liner.position.set(side * 0.94, 0.36, z)
      group.add(liner)
    }
  }

  // bumpers / splitter / diffuser / skirts (beveled plates)
  const bumperF = new THREE.Mesh(roundedPlateGeo(1.66, 0.5, 0.13, 0.055), paint)
  bumperF.position.set(0, 0.48, -2.165)
  group.add(bumperF)
  const intakeC = new THREE.Mesh(roundedPlateGeo(1.02, 0.17, 0.05, 0.04), shared.dark())
  intakeC.position.set(0, 0.4, -2.24)
  group.add(intakeC)
  for (const side of [-1, 1]) {
    const intakeS = new THREE.Mesh(roundedPlateGeo(0.26, 0.14, 0.04, 0.03), shared.dark())
    intakeS.position.set(side * 0.64, 0.45, -2.235)
    group.add(intakeS)
  }
  const splitter = new THREE.Mesh(roundedPlateGeo(1.78, 0.06, 0.05, 0.02), shared.dark())
  splitter.position.set(0, 0.235, -2.12)
  group.add(splitter)

  const bumperR = new THREE.Mesh(roundedPlateGeo(1.68, 0.44, 0.1, 0.05), paint)
  bumperR.position.set(0, 0.51, 2.19)
  group.add(bumperR)
  const diffuser = new THREE.Mesh(roundedPlateGeo(1.34, 0.26, 0.05, 0.03), shared.dark())
  diffuser.position.set(0, 0.33, 2.245)
  group.add(diffuser)
  for (const fx of [-0.4, -0.13, 0.13, 0.4]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.11, 0.08), shared.dark())
    fin.position.set(fx, 0.29, 2.27)
    group.add(fin)
  }
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(roundedPlateGeo(1.55, 0.1, 0.07, 0.025), shared.dark())
    skirt.rotation.y = Math.PI / 2
    skirt.position.set(side * 0.94, 0.295, 0.06)
    group.add(skirt)
    const sill = new THREE.Mesh(roundedPlateGeo(1.3, 0.05, 0.02, 0.012), paint)
    sill.rotation.y = Math.PI / 2
    sill.position.set(side * 0.965, 0.355, 0.06)
    group.add(sill)
  }

  // exhaust tips
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.064, 0.16, 14), shared.chrome())
    tip.rotation.x = Math.PI / 2
    tip.position.set(side * 0.42, 0.3, 2.26)
    group.add(tip)
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), shared.darkSoft())
    inner.rotation.x = Math.PI / 2
    inner.position.set(side * 0.42, 0.3, 2.32)
    group.add(inner)
  }

  // headlight clusters (shaped lenses, emissive)
  const headMats: THREE.MeshStandardMaterial[] = []
  for (const side of [-1, 1]) {
    const hous = new THREE.Mesh(roundedPlateGeo(0.42, 0.15, 0.045, 0.02), shared.dark())
    hous.position.set(side * 0.5, 0.805, -2.115)
    hous.rotation.y = side * -0.07
    group.add(hous)
    const hm = new THREE.MeshStandardMaterial({ color: 0x39414d, emissive: new THREE.Color(0xfff1d6), emissiveIntensity: 2.6, roughness: 0.15 })
    const lens = new THREE.Mesh(roundedPlateGeo(0.36, 0.095, 0.024, 0.014), hm)
    lens.position.set(side * 0.5, 0.805, -2.142)
    lens.rotation.y = hous.rotation.y
    group.add(lens)
    headMats.push(hm)
  }

  // tail light bar + brake lenses (emissive, brake-reactive)
  const tailBase = new THREE.Mesh(roundedPlateGeo(1.38, 0.13, 0.035, 0.02), shared.dark())
  tailBase.position.set(0, 0.66, 2.238)
  group.add(tailBase)
  const brakeMats: THREE.MeshStandardMaterial[] = []
  for (const side of [-1, 1]) {
    const bm = new THREE.MeshStandardMaterial({ color: 0x531210, emissive: new THREE.Color(0xff2518), emissiveIntensity: 0.25, roughness: 0.25 })
    const lens = new THREE.Mesh(roundedPlateGeo(0.5, 0.06, 0.02, 0.012), bm)
    lens.position.set(side * 0.36, 0.665, 2.262)
    group.add(lens)
    brakeMats.push(bm)
  }
  const tailBar = new THREE.Mesh(roundedPlateGeo(0.52, 0.028, 0.016, 0.008), brakeMats[0])
  tailBar.position.set(0, 0.665, 2.262)
  group.add(tailBar)

  // mirrors on stalks
  for (const side of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.13, 8), shared.dark())
    stalk.rotation.z = side * 0.55
    stalk.position.set(side * 0.88, 1.0, -0.7)
    group.add(stalk)
    const head = new THREE.Mesh(roundedPlateGeo(0.17, 0.09, 0.05, 0.02), paint)
    head.position.set(side * 0.97, 1.06, -0.72)
    head.rotation.y = side * -0.3
    group.add(head)
    const g = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.055), shared.glass())
    g.position.set(side * 0.955, 1.06, -0.695)
    g.rotation.y = side * (-0.3 + Math.PI / 2 * side * 0 + side * 0) + side * 0.0
    g.rotation.y = side * -0.3 + (side < 0 ? Math.PI : 0) * 0 + 0.0
    g.rotation.y = side * -0.3 + side * -0.2
    group.add(g)
  }

  // rear spoiler on struts
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.14), shared.dark())
    strut.position.set(side * 0.58, 1.02, 2.0)
    group.add(strut)
  }
  const blade = new THREE.Mesh(roundedPlateGeo(1.4, 0.045, 0.03, 0.012), paint)
  blade.position.set(0, 1.145, 2.02)
  blade.rotation.x = -0.09
  group.add(blade)

  // hood power lines + cowl vent (greebles)
  for (const side of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.008, 0.5), shared.dark())
    line.position.set(side * 0.34, 0.962, -1.55)
    line.rotation.x = 0.05
    group.add(line)
  }
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.012, 0.07), shared.dark())
  cowl.position.set(0, 0.995, -0.94)
  cowl.rotation.x = -0.3
  group.add(cowl)

  // interior hints visible through glass
  for (const side of [-1, 1]) {
    const seatBase = new THREE.Mesh(roundedPlateGeo(0.4, 0.44, 0.08, 0.05), shared.darkSoft())
    seatBase.rotation.x = Math.PI / 2 - 0.12
    seatBase.position.set(side * 0.29, 0.97, 0.42)
    group.add(seatBase)
    const back = new THREE.Mesh(roundedPlateGeo(0.4, 0.46, 0.07, 0.06), shared.darkSoft())
    back.rotation.x = -0.28
    back.position.set(side * 0.29, 1.16, 0.62)
    group.add(back)
  }
  const dash = new THREE.Mesh(roundedPlateGeo(0.94, 0.08, 0.16, 0.03), shared.darkSoft())
  dash.position.set(0, 1.0, -0.86)
  dash.rotation.x = 0.3
  group.add(dash)
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.016, 6, 20), shared.dark())
  wheelRim.position.set(-0.3, 1.02, -0.72)
  wheelRim.rotation.x = 1.1
  group.add(wheelRim)

  // nitro flames (hidden until nitro)
  const flameMats: THREE.MeshBasicMaterial[] = []
  const flames: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9cc9ff), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.5, 10), fm)
    f.rotation.x = -Math.PI / 2
    f.position.set(side * 0.42, 0.3, 2.56)
    group.add(f)
    const fm2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf2f8ff), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    const f2 = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.3, 8), fm2)
    f2.rotation.x = -Math.PI / 2
    f2.position.set(side * 0.42, 0.3, 2.47)
    group.add(f2)
    flameMats.push(fm, fm2)
    flames.push(f, f2)
  }

  // wheels FL FR RL RR
  const wheels: WheelHandle[] = []
  const wr = VEHICLE.wheelRadius
  for (const front of [true, false]) {
    const z = front ? -VEHICLE.wheelbase / 2 : VEHICLE.wheelbase / 2
    for (const side of [-1, 1]) {
      const { root, spin } = buildWheelAssembly()
      root.position.set(side * (VEHICLE.trackWidth / 2), wr, z)
      let steer: THREE.Group | null = null
      if (front) {
        steer = new THREE.Group()
        root.position.set(side * (VEHICLE.trackWidth / 2), wr, z)
        steer.add(root)
        root.position.set(0, 0, 0)
        group.add(steer)
        steer.position.set(side * (VEHICLE.trackWidth / 2), wr, z)
      } else {
        group.add(root)
      }
      wheels.push({ steer, spin, radius: wr, front })
    }
  }

  // shadows: solid parts cast, glass/flames do not
  group.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      const mm = m.material as THREE.Material
      m.castShadow = !(mm.transparent && mm.blending === THREE.AdditiveBlending) && !(mm as THREE.MeshPhysicalMaterial).transparent || (mm as THREE.MeshPhysicalMaterial).opacity > 0.6
      if ((mm as THREE.MeshPhysicalMaterial).opacity === 0.46) m.castShadow = false
      m.receiveShadow = false
    }
  })

  let brakeVal = 0
  return {
    group,
    wheels,
    paintMats,
    setBrake(v: number) {
      if (brakeVal === v) return
      brakeVal = v
      for (const bm of brakeMats) bm.emissiveIntensity = 0.25 + v * 4.2
    },
    setNitro(v: number) {
      for (let i = 0; i < flameMats.length; i++) {
        const outer = i % 2 === 0
        flameMats[i].opacity = clamp01(v) * (outer ? 0.85 : 1)
      }
      for (const f of flames) f.scale.set(1, 0.65 + v * 0.6, 1)
    },
    setHeadlights(on: boolean) {
      for (const hm of headMats) hm.emissiveIntensity = on ? 2.6 : 0.35
    },
    setPaint(hex: number) {
      for (const pm of paintMats) pm.color.set(hex)
    },
  }
}
