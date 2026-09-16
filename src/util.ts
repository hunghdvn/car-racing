import * as THREE from 'three'

/* ---------------------------------- math ---------------------------------- */

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const invLerp = (a: number, b: number, v: number): number => (v - a) / ((b - a) || 1)
export const remap = (v: number, a: number, b: number, c: number, d: number): number =>
  lerp(c, d, clamp(invLerp(a, b, v), 0, 1))

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / ((edge1 - edge0) || 1e-9), 0, 1)
  return t * t * (3 - 2 * t)
}
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
/** frame-rate independent exponential smoothing */
export const damp = (cur: number, target: number, lambda: number, dt: number): number =>
  lerp(cur, target, 1 - Math.exp(-lambda * dt))
export const wrapPi = (a: number): number => {
  a %= Math.PI * 2
  if (a > Math.PI) a -= Math.PI * 2
  if (a < -Math.PI) a += Math.PI * 2
  return a
}
export const dampAngle = (cur: number, target: number, lambda: number, dt: number): number =>
  cur + wrapPi(target - cur) * (1 - Math.exp(-lambda * dt))

export function dampVec(cur: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
  const k = 1 - Math.exp(-lambda * dt)
  cur.lerpVectors(cur, target, k)
}

/* -------------------------------- seeded rng -------------------------------- */

export class Rand {
  private s: number
  constructor(seed: number) { this.s = seed >>> 0 || 1 }
  next(): number {
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(min: number, max: number): number { return min + (max - min) * this.next() }
  int(min: number, max: number): number { return Math.floor(this.range(min, max + 1)) }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)] }
  chance(p: number): boolean { return this.next() < p }
}

/* ------------------------------ value noise 2D ------------------------------ */

export function hash21(x: number, y: number): number {
  let h = Math.imul(Math.round(x * 3651 + 1013), 0x9e3779b1) ^ Math.imul(Math.round(y * 2379 + 1723), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
export function valueNoise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash21(xi, yi), b = hash21(xi + 1, yi), c = hash21(xi, yi + 1), d = hash21(xi + 1, yi + 1)
  return lerp(lerp(a, b, u), lerp(c, d, u), v)
}
export function fbm2(x: number, y: number, octaves = 4, lac = 2, gain = 0.5): number {
  let amp = 0.5, f = 1, sum = 0, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * f, y * f)
    norm += amp
    amp *= gain
    f *= lac
  }
  return sum / norm
}

/* ----------------------------- canvas textures ------------------------------ */

export interface CanvasTexOpts {
  srgb?: boolean
  repeatX?: number
  repeatY?: number
  clamp?: boolean
  anisotropy?: number
  nearest?: boolean
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  return { canvas, ctx }
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, opts: CanvasTexOpts = {}): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(w, h)
  draw(ctx, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.wrapS = tex.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
  tex.repeat.set(opts.repeatX ?? 1, opts.repeatY ?? 1)
  if (opts.nearest) { tex.magFilter = THREE.NearestFilter }
  tex.anisotropy = opts.anisotropy ?? 8
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.needsUpdate = true
  return tex
}

/** Build a tangent-space normal map canvas from a height/bump canvas (sobel-ish). */
export function normalFromHeightCanvas(hCanvas: HTMLCanvasElement, strength = 2.4): HTMLCanvasElement {
  const w = hCanvas.width, h = hCanvas.height
  const hctx = hCanvas.getContext('2d') as CanvasRenderingContext2D
  const src = hctx.getImageData(0, 0, w, h).data
  const { canvas: nCanvas, ctx } = makeCanvas(w, h)
  const img = ctx.createImageData(w, h)
  const at = (x: number, y: number): number => {
    const xi = (x + w) % w, yi = (y + h) % h
    return src[(yi * w + xi) * 4] / 255
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      let nx = -dx, ny = -dy, nz = 1
      const len = Math.hypot(nx, ny, nz)
      nx /= len; ny /= len; nz /= len
      const i = (y * w + x) * 4
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return nCanvas
}

export function heightCanvasFrom(fn: (x: number, y: number, w: number, h: number) => number, w: number, h: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(w, h)
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = clamp01(fn(x, y, w, h)) * 255
      const i = (y * w + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/* --------------------------- geometry merge utility -------------------------- */

export interface MergePart { geometry: THREE.BufferGeometry; matrix?: THREE.Matrix4; materialIndex?: number }

/**
 * Merge geometries into one BufferGeometry with material groups.
 * Supports position (required), normal, uv, color (optional, consistent).
 */
export function mergeGeometries(parts: MergePart[]): THREE.BufferGeometry {
  let hasColor = false, hasUv = false, hasNormal = false
  const geos = parts.map((p) => ({
    g: p.geometry,
    matrix: p.matrix ?? new THREE.Matrix4(),
    m: p.materialIndex ?? 0,
  }))
  for (const { g } of geos) {
    if (g.getAttribute('color')) hasColor = true
    if (g.getAttribute('uv')) hasUv = true
    if (g.getAttribute('normal')) hasNormal = true
  }
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const groups: { start: number; count: number; m: number }[] = []
  const nm = new THREE.Matrix3()
  const v = new THREE.Vector3()
  for (const { g, matrix, m } of geos) {
    const start = indices.length
    const base = positions.length / 3
    const pos = g.getAttribute('position')
    const nor = g.getAttribute('normal')
    const uv = g.getAttribute('uv')
    const col = g.getAttribute('color')
    nm.getNormalMatrix(matrix)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix)
      positions.push(v.x, v.y, v.z)
      if (hasNormal) {
        if (nor) { v.fromBufferAttribute(nor, i).applyNormalMatrix(nm).normalize(); normals.push(v.x, v.y, v.z) }
        else normals.push(0, 1, 0)
      }
      if (hasUv) { uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0) }
      if (hasColor) {
        if (col && i < col.count) colors.push(col.getX(i), col.getY(i), col.getZ(i))
        else colors.push(1, 1, 1)
      }
    }
    if (g.index) {
      const idx = g.getIndex() as THREE.BufferAttribute
      for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i))
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(base + i)
    }
    groups.push({ start, count: indices.length - start, m })
  }
  // groups keep build order; three.js accepts unordered material groups
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (hasNormal) out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  if (hasUv) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  if (hasColor) out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  out.setIndex(indices)
  for (const gr of groups) {
    if (gr.count > 0) out.addGroup(gr.start, gr.count, gr.m)
  }
  out.computeBoundingSphere()
  return out
}

/* --------------------------- geometry hardening ------------------------------ */

/**
 * NaN discipline (shared, spec §3 budgets + bloom-poison protection):
 * filter zero-area/NaN faces, then rebuild all-finite unit vertex normals
 * from the surviving faces. Any custom BufferGeometry goes through this.
 */
export function sanitizeGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  if (!pos || pos.count === 0) return geo
  let bad = 0
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) bad++
  }
  if (bad) {
    // positions poisoned: rebuild as a degenerate-safe point cloud at origin
    const arr = pos.array as Float32Array
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) arr[i] = 0
  }
  const idx = geo.getIndex()
  let keep: number[] | null = null
  if (idx) {
    keep = []
    for (let f = 0; f < idx.count; f += 3) {
      const ia = idx.getX(f), ib = idx.getX(f + 1), ic = idx.getX(f + 2)
      const ux = pos.getX(ib) - pos.getX(ia), uy = pos.getY(ib) - pos.getY(ia), uz = pos.getZ(ib) - pos.getZ(ia)
      const vx = pos.getX(ic) - pos.getX(ia), vy = pos.getY(ic) - pos.getY(ia), vz = pos.getZ(ic) - pos.getZ(ia)
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
      if (!Number.isFinite(fx + fy + fz) || fx * fx + fy * fy + fz * fz < 1e-14) continue
      keep.push(ia, ib, ic)
    }
    if (keep.length === 0) keep.push(0, 0, 0)
    geo.setIndex(keep)
  }
  crNormals(geo)
  return geo
}

/** Catmull-Rom smoothed, guaranteed-finite unit vertex normals. */
export function crNormals(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const idx = geo.getIndex() as THREE.BufferAttribute | null
  const n = pos.count
  const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n)
  const used = new Uint8Array(n)
  const tri = (ia: number, ib: number, ic: number): void => {
    const ux = pos.getX(ib) - pos.getX(ia), uy = pos.getY(ib) - pos.getY(ia), uz = pos.getZ(ib) - pos.getZ(ia)
    const vx = pos.getX(ic) - pos.getX(ia), vy = pos.getY(ic) - pos.getY(ia), vz = pos.getZ(ic) - pos.getZ(ia)
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    if (!Number.isFinite(fx + fy + fz) || fx * fx + fy * fy + fz * fz < 1e-12) return
    nx[ia] += fx; ny[ia] += fy; nz[ia] += fz
    nx[ib] += fx; ny[ib] += fy; nz[ib] += fz
    nx[ic] += fx; ny[ic] += fy; nz[ic] += fz
    used[ia] = 1; used[ib] = 1; used[ic] = 1
  }
  if (idx) for (let f = 0; f < idx.count; f += 3) tri(idx.getX(f), idx.getX(f + 1), idx.getX(f + 2))
  else for (let f = 0; f + 2 < n; f += 3) tri(f, f + 1, f + 2)
  let cx = 0, cy = 0, cz = 0
  for (let i = 0; i < n; i++) { cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i) }
  cx /= n; cy /= n; cz /= n
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    let x = nx[i], y = ny[i], z = nz[i]
    let len = Number.isFinite(x + y + z) ? Math.sqrt(x * x + y * y + z * z) : 0
    if (len < 1e-6 || !used[i]) {
      const rx = pos.getX(i) - cx, ry = pos.getY(i) - cy, rz = pos.getZ(i) - cz
      const rl = Math.sqrt(rx * rx + ry * ry + rz * rz)
      if (Number.isFinite(rl) && rl > 1e-6) { x = rx / rl; y = ry / rl; z = rz / rl }
      else { x = 0; y = 1; z = 0 }
      len = Math.sqrt(x * x + y * y + z * z)
      if (!Number.isFinite(len) || len < 1e-6) { x = 0; y = 1; z = 0; len = 1 }
    }
    x /= len; y /= len; z /= len
    if (!Number.isFinite(x + y + z)) { x = 0; y = 1; z = 0 }
    arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z
  }
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(arr, 3))
  geo.computeBoundingSphere()
}

/** Flip index winding when the majority of triangles face the centroid. */
export function ensureOutwardWinding(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const idx = geo.getIndex() as THREE.BufferAttribute | null
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
 * Flip every triangle whose geometric normal opposes `up` (dominant-axis
 * orient for near-planar ribbons: road surfaces, shoulders). Leaves
 * side-facing tris (|dot| < tol) untouched so walls keep their authored order.
 */
export function forceUpWinding(geo: THREE.BufferGeometry, up: THREE.Vector3, tol = 0.05): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const idx = geo.getIndex() as THREE.BufferAttribute | null
  if (!idx || idx.count < 3) return
  const arr = new Uint32Array(idx.count)
  for (let f = 0; f < idx.count; f += 3) {
    const ia = idx.getX(f), ib = idx.getX(f + 1), ic = idx.getX(f + 2)
    arr[f] = ia; arr[f + 1] = ib; arr[f + 2] = ic
    const ux = pos.getX(ib) - pos.getX(ia), uy = pos.getY(ib) - pos.getY(ia), uz = pos.getZ(ib) - pos.getZ(ia)
    const vx = pos.getX(ic) - pos.getX(ia), vy = pos.getY(ic) - pos.getY(ia), vz = pos.getZ(ic) - pos.getZ(ia)
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    const l = Math.hypot(fx, fy, fz) || 1
    const d = (fx * up.x + fy * up.y + fz * up.z) / l
    if (d < -tol) { arr[f + 1] = ic; arr[f + 2] = ib }
  }
  geo.setIndex(new THREE.Uint32BufferAttribute(arr, 1))
}

/**
 * Sweep a closed 2D profile along a sampled path of frames.
 * frames: [x,y,z, nx,ny,nz(bank axis-free side), ux,uy,uz(up)] per station.
 * Emits a watertight tube (profile ring wrapped) + optional end caps.
 */
export interface SweepFrame { p: [number, number, number]; s: [number, number, number]; u: [number, number, number] }
export function sweepProfile(profile: [number, number][], frames: SweepFrame[], opts: { caps?: boolean; uvScale?: number } = {}): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  const ring = profile.length
  const S = frames.length
  if (S < 2 || ring < 3) throw new Error('[sweep] insufficient frames/profile')
  let runLen = 0
  for (let i = 1; i < S; i++) {
    const dx = frames[i].p[0] - frames[i - 1].p[0], dy = frames[i].p[1] - frames[i - 1].p[1], dz = frames[i].p[2] - frames[i - 1].p[2]
    runLen += Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
  const sc = opts.uvScale ?? 1
  let acc = 0
  for (let i = 0; i < S; i++) {
    if (i > 0) {
      const dx = frames[i].p[0] - frames[i - 1].p[0], dy = frames[i].p[1] - frames[i - 1].p[1], dz = frames[i].p[2] - frames[i - 1].p[2]
      acc += Math.sqrt(dx * dx + dy * dy + dz * dz)
    }
    const f = frames[i]
    for (const [a, b] of profile) {
      pos.push(f.p[0] + f.s[0] * a + f.u[0] * b, f.p[1] + f.s[1] * a + f.u[1] * b, f.p[2] + f.s[2] * a + f.u[2] * b)
      uv.push(a * sc, (acc + b) * sc)
    }
  }
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const jn = (j + 1) % ring
      const a = i * ring + j, b = a + ring, c = i * ring + jn, d = b + (jn - j)
      idx.push(a, c, b, c, d, b)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  ensureOutwardWinding(geo)
  sanitizeGeometry(geo)
  return geo
}

/* ---------------------------------- misc ----------------------------------- */

export function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}
export const hexToCss = (n: number): string => `#${String(n.toString(16).padStart(6, '0'))}`

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const mm of mats) mm.dispose()
  })
}
