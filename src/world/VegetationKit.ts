import * as THREE from 'three'
import { SEED } from '../config'
import { Rand, lerp, clamp, fbm2, hash21, mergeGeometries, sanitizeGeometry, crNormals, kitLodEnabled } from '../util'
import { KIT } from '../config'
import type { TrackSpline } from './TrackSpline'
import type { CoastField } from './Terrain'

const side2 = (a: number, b: number, rnd: Rand): number => (rnd.chance(0.5) ? 1 : -1) * rnd.range(a, b)

/* ------------------------------------------------------------------------- *
 * Real-silhouette vegetation (spec §4.3): curved-trunk palms with arched
 * fronds, clustered-volume coastal pines, blob bushs, noise-deformed rocks,
 * crossed alpha-card grass tufts. Seeded COMPOSITIONS (clusters, pairs,
 * jittered scale/rot/colour) — never uniform runs. Two LOD levels (§4.7).
 * ------------------------------------------------------------------------- */

const GREEN = { deep: [0.055, 0.12, 0.04], mid: [0.105, 0.225, 0.062], lite: [0.165, 0.3, 0.082], dry: [0.38, 0.33, 0.14], bark: [0.115, 0.08, 0.05], barkL: [0.19, 0.135, 0.082], rock: [0.3, 0.28, 0.25], moss: [0.16, 0.24, 0.085] }

function paint(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, i: number) => [number, number, number]): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const n = pos.count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const [r, g, b] = fn(pos.getX(i), pos.getY(i), pos.getZ(i), i)
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return geo
}

/** Loft a tube of circle rings along an authored point path. */
function tubeAlong(points: THREE.Vector3[], radii: number[], radial: number, colorAt: (t: number) => [number, number, number], wob = 0): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [], col: number[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const tan = new THREE.Vector3(), side = new THREE.Vector3(), sideUp = new THREE.Vector3()
  const n = points.length
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    if (i < n - 1) tan.subVectors(points[i + 1], points[i])
    else tan.subVectors(points[i], points[i - 1])
    tan.normalize()
    side.crossVectors(tan, up)
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
    side.normalize()
    sideUp.crossVectors(side, tan).normalize()
    const r = radii[i]
    const c = points[i]
    const base = pos.length / 3
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2 + t * 3.1
      const rr = r * (1 + (hash21(i * 3.7 + k, k * 1.3) - 0.5) * wob)
      pos.push(c.x + (Math.cos(a) * side.x + Math.sin(a) * sideUp.x) * rr, c.y + (Math.cos(a) * side.y + Math.sin(a) * sideUp.y) * rr, c.z + (Math.cos(a) * side.z + Math.sin(a) * sideUp.z) * rr)
      const [cr, cg, cb] = colorAt(t)
      col.push(cr, cg, cb)
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < radial; k++) {
    const kn = (k + 1) % radial
    const a = i * radial + k, b = a + radial, c = i * radial + kn, d = b + (kn - k)
    idx.push(a, c, b, c, d, b)
  }
  // caps
  const centerTop = pos.length / 3
  pos.push(points[n - 1].x, points[n - 1].y, points[n - 1].z)
  col.push(...colorAt(1))
  for (let k = 0; k < radial; k++) idx.push(centerTop, (n - 1) * radial + k, (n - 1) * radial + ((k + 1) % radial))
  const centerBot = pos.length / 3
  pos.push(points[0].x, points[0].y, points[0].z)
  col.push(...colorAt(0))
  for (let k = 0; k < radial; k++) idx.push(centerBot, k, (k + 1) % radial)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.setIndex(idx)
  sanitizeGeometry(geo)
  return geo
}

/** Noise-deformed blob volume (foliage / rock base shape). */
function blob(r: number, squashY: number, seed: number, rough: number, detail = 2): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(r, detail)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const arr = pos.array as Float32Array
  for (let i = 0; i < arr.length; i += 3) {
    const nx = arr[i] / r, ny = arr[i + 1] / (r * squashY), nz = arr[i + 2] / r
    const d = 1 + (fbm2(nx * 2.2 + seed, nz * 2.2 + seed * 1.7, 3) - 0.5) * rough + (hash21(arr[i] * 9 + seed, arr[i + 2] * 9) - 0.5) * rough * 0.35
    arr[i] *= d; arr[i + 1] *= d; arr[i + 2] *= d
    arr[i + 1] *= squashY
  }
  return geo
}

/* ------------------------------------------------------------- species ---- */

export function palmGeometry(rnd: Rand, lod = 1): THREE.BufferGeometry {
  const h = rnd.range(4.0, 5.6)
  const bend = rnd.range(0.5, 1.5) * (rnd.chance(0.5) ? 1 : -1)
  const lean = rnd.range(-0.35, 0.35)
  const rows = lod > 0 ? 11 : 4
  const pts: THREE.Vector3[] = []
  const radii: number[] = []
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1)
    pts.push(new THREE.Vector3(lean * t * t * 2 + bend * t * t * 0.7, t * h, bend * t * t))
    radii.push(lerp(0.2, 0.085, t) * (1 + Math.sin(t * 22) * 0.045))
  }
  const trunk = tubeAlong(pts, radii, lod > 0 ? 8 : 5, (t) => {
    const v = 0.8 + hash21(t * 90, 3) * 0.35
    return [GREEN.bark[0] * v * 1.25, GREEN.bark[1] * v * 1.2, GREEN.bark[2] * v]
  }, 0.24)
  const parts: { geometry: THREE.BufferGeometry }[] = [{ geometry: trunk }]
  const crown = pts[pts.length - 1]
  // fronds: arched lofted blades
  const nFr = lod > 0 ? 9 : 5
  for (let f = 0; f < nFr; f++) {
    const yaw = (f / nFr) * Math.PI * 2 + rnd.range(-0.25, 0.25)
    const len = rnd.range(1.9, 2.9) * (lod > 0 ? 1 : 0.7)
    const droop = rnd.range(0.42, 0.95)
    const steps = 7
    const fp: number[] = [], fc: number[] = [], fi: number[] = []
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = Math.sin(yaw) * len * t
      const z = Math.cos(yaw) * len * t
      const y = crown.y + 0.05 + t * 0.55 * (1 - t * 1.35) - t * t * droop
      const wdt = Math.sin(Math.PI * Math.min(1, t * 1.25) * 0.92 + 0.1) * 0.42 * (1 - t * 0.3) + 0.03
      const nx = Math.cos(yaw), nz = -Math.sin(yaw)
      const i0 = fp.length / 3
      fp.push(crown.x + x - nx * wdt, y, crown.z + z - nz * wdt)
      fp.push(crown.x + x + nx * wdt, y, crown.z + z + nz * wdt)
      const v = 0.75 + hash21(f * 3 + i, f) * 0.4
      const near = t > 0.6 ? 1 : 0.75
      const cr = GREEN.mid[0] * v * near, cg = GREEN.mid[1] * v * near * (t > 0.6 ? 1.15 : 1), cb = GREEN.mid[2] * v
      fc.push(cr, cg, cb, cr, cg, cb)
      void i0
    }
    for (let i = 0; i < steps; i++) {
      const a = i * 2
      fi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3))
    g.setIndex(fi)
    sanitizeGeometry(g)
    parts.push({ geometry: g })
  }
  // crown boot (leaf-bases) + coconuts
  const boot = new THREE.SphereGeometry(0.3, 8, 6)
  boot.translate(crown.x, crown.y, crown.z)
  paint(boot, () => [GREEN.bark[0] * 0.7, GREEN.bark[1] * 0.7, GREEN.bark[2] * 0.7])
  parts.push({ geometry: boot })
  if (lod > 0) for (let k = 0; k < 3; k++) {
    const c = new THREE.SphereGeometry(0.09, 6, 5)
    c.translate(crown.x + rnd.range(-0.25, 0.25), crown.y - 0.13, crown.z + rnd.range(-0.25, 0.25))
    paint(c, () => [0.24, 0.2, 0.12])
    parts.push({ geometry: c })
  }
  const merged = mergeGeometries(parts)
  return merged
}

export function pineGeometry(rnd: Rand, lod = 1): THREE.BufferGeometry {
  const h = rnd.range(3.2, 5.4)
  const parts: { geometry: THREE.BufferGeometry }[] = []
  const pts: THREE.Vector3[] = []
  const rows = 7
  const bend = rnd.range(-0.4, 0.4)
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1)
    pts.push(new THREE.Vector3(bend * t, t * h, Math.sin(t * 3) * 0.1 * bend))
  }
  parts.push({ geometry: tubeAlong(pts, Array.from({ length: rows }, (_, i) => lerp(0.17, 0.05, i / (rows - 1))) as never, 6, (t) => {
    const v = 0.85 + hash21(t * 44, 9) * 0.3
    return [GREEN.bark[0] * v, GREEN.bark[1] * v, GREEN.bark[2] * v]
  }, 0.3) })
  // branch stubs
  for (let k = 0; k < 4; k++) {
    const t = rnd.range(0.45, 0.8)
    const a = (k / 4) * Math.PI * 2 + rnd.range(-0.4, 0.4)
    const stub = new THREE.CylinderGeometry(0.028, 0.055, rnd.range(0.4, 0.85), 5)
    stub.rotateZ(1.0 + rnd.range(-0.2, 0.2))
    stub.rotateY(a)
    const attach = pts[Math.min(pts.length - 1, Math.floor(t * (rows - 1)))]
    stub.translate(attach.x, attach.y, attach.z)
    paint(stub, () => [GREEN.bark[0] * 0.9, GREEN.bark[1] * 0.9, GREEN.bark[2] * 0.9])
    parts.push({ geometry: stub })
  }
  // layered needle pads: tiered whorls of drooping tapered fans around a
  // slim leader — layered silhouette, no stacked-ball "popcorn" read.
  const fanPaint = (base: number[], toneSeed: number) => (_x: number, y: number, _z: number, i: number): [number, number, number] => {
    const v = 0.8 + hash21(i * 1.7 + toneSeed, toneSeed * 3.1) * 0.42
    const lite = clamp(y / h, 0, 1) * 0.4
    return [lerp(GREEN.deep[0], base[0], 0.5 + lite) * v, lerp(GREEN.deep[1], base[1], 0.58 + lite) * v, lerp(GREEN.deep[2], base[2], 0.46 + lite) * v]
  }
  const tiers: [number, number][] = lod > 0 ? [[0.5, 1], [0.66, 0.82], [0.8, 0.6], [0.92, 0.38]] : [[0.62, 0.8]]
  for (const [tt, spread] of tiers) {
    const attach = pts[Math.min(pts.length - 1, Math.round(tt * (rows - 1)))]
    const nFan = lod > 0 ? 6 + rnd.int(0, 3) : 4
    const yaw0 = rnd.range(0, Math.PI * 2)
    const tone = rnd.next() > 0.72 ? GREEN.lite : rnd.next() > 0.4 ? GREEN.mid : GREEN.deep
    for (let k = 0; k < nFan; k++) {
      const a = yaw0 + (k / nFan) * Math.PI * 2 + rnd.range(-0.3, 0.3)
      const len = h * 0.27 * spread * rnd.range(0.78, 1.22)
      const droop = rnd.range(0.34, 0.62)
      parts.push({ geometry: needlePad(rnd, len, droop, attach, a, fanPaint(tone, k + tt * 9)) })
    }
    // two squashed volume pads core the whorl (irregular, faceted at LOD0)
    if (lod > 0) for (let k = 0; k < 2; k++) {
      const r = h * 0.13 * spread * rnd.range(0.7, 1.1)
      const g = blob(r, 0.5, rnd.next() * 10, 0.55, 1)
      g.translate(attach.x + rnd.range(-0.3, 0.3) + bend * tt, attach.y + rnd.range(-0.1, 0.22), attach.z + rnd.range(-0.3, 0.3))
      paint(g, fanPaint(tone, k + tt * 5 + 3))
      parts.push({ geometry: g })
    }
  }
  // wind-swept crown tuft
  {
    const r = h * 0.09 * rnd.range(0.8, 1.2)
    const g = blob(r, 0.72, rnd.next() * 7, 0.5, lod > 0 ? 1 : 0)
    const top = pts[pts.length - 1]
    g.translate(top.x + bend * 0.12, top.y + r * 0.4, top.z)
    paint(g, fanPaint(GREEN.mid, 99))
    parts.push({ geometry: g })
  }
  return mergeGeometries(parts)
}

/** One drooping tapered needle fan: apex at the attach point, tip outward. */
function needlePad(
  rnd: Rand, len: number, droop: number, attach: THREE.Vector3, yaw: number,
  paintFn: (x: number, y: number, z: number, i: number) => [number, number, number],
): THREE.BufferGeometry {
  const steps = 5
  const pos: number[] = [], col: number[] = [], idx: number[] = []
  const nx = Math.cos(yaw), nz = Math.sin(yaw)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const out = len * t
    const y = attach.y + 0.06 + Math.sin(t * 2.1) * 0.09 - t * t * droop * 1.5
    const w = (0.09 + Math.sin(Math.PI * t * 0.86) * 0.34) * (1 - t * 0.35) * (len * 0.9 + 0.3)
    const px = attach.x + nx * out, pz = attach.z + nz * out
    pos.push(px - nx * w * 0.35 - nz * w, y, pz - nz * w * 0.35 + nx * w)
    pos.push(px + nx * w * 0.35 - nz * w * 0.12, y + 0.02, pz + nz * w * 0.35 + nx * w * 0.12)
    const c = paintFn(px, y, pz, i)
    col.push(c[0], c[1], c[2], c[0] * 1.12, c[1] * 1.12, c[2] * 1.05)
  }
  for (let i = 0; i < steps; i++) {
    const a = i * 2
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  sanitizeGeometry(g)
  void rnd
  return g
}

export function bushGeometry(rnd: Rand): THREE.BufferGeometry {
  // Spec §4.3: clustered blobs with a SETTLED base — a wide flattened skirt,
  // 5–8 angular lobes sharing one mass (not round popcorn), twig crown and
  // deep olive-green body with a sunlit top gradient (kills the pale read).
  const parts: { geometry: THREE.BufferGeometry }[] = []
  const dry = rnd.next() > 0.8
  const base = dry ? GREEN.dry : GREEN.mid
  const dark = GREEN.deep
  const skirt = blob(rnd.range(0.62, 0.8), 0.34, rnd.next() * 30, 0.5, 1)
  skirt.translate(0, 0.13, 0)
  paint(skirt, (_x, y, _z, i) => {
    const v = 0.62 + hash21(i * 1.9, 9) * 0.28
    return [dark[0] * v * 1.05, dark[1] * v * 1.05, dark[2] * v]
  })
  parts.push({ geometry: skirt })
  const n = rnd.int(5, 8)
  const spread = rnd.range(0.5, 0.78)
  for (let k = 0; k < n; k++) {
    const big = k === 0
    const r = big ? rnd.range(0.44, 0.58) : rnd.range(0.2, 0.42)
    const g = blob(r, rnd.range(0.52, 0.9), rnd.next() * 20, 0.85, k === 0 ? 2 : 1)
    const a = (k / n) * Math.PI * 2 + rnd.range(-0.5, 0.5)
    const rad = big ? 0 : spread * rnd.range(0.45, 1)
    const ox = Math.cos(a) * rad
    const oz = Math.sin(a) * rad
    g.translate(ox, (big ? 0.52 : 0.2 + rnd.range(0, 0.16)) + r * 0.3, oz)
    paint(g, (_x, y, _z, i) => {
      const v = 0.7 + hash21(i * 2.3 + k, 5) * 0.44
      const t = clamp((y - 0.2) / 0.75, 0, 1)
      return [lerp(dark[0] * 0.9, base[0] + 0.1, t) * v, lerp(dark[1] * 0.95, base[1] + 0.12, t) * v, lerp(dark[2] * 0.9, base[2], t) * v]
    })
    parts.push({ geometry: g })
  }
  // twigs punching through the rim — breaks the round silhouette
  for (let k = 0; k < 4; k++) {
    const twig = new THREE.CylinderGeometry(0.016, 0.03, rnd.range(0.4, 0.72), 5)
    twig.rotateZ(rnd.range(0.45, 1.2))
    twig.rotateY(rnd.next() * Math.PI * 2)
    twig.translate(rnd.range(-0.45, 0.45), rnd.range(0.42, 0.62), rnd.range(-0.45, 0.45))
    paint(twig, () => [GREEN.barkL[0] * 0.8, GREEN.barkL[1] * 0.78, GREEN.barkL[2] * 0.7])
    parts.push({ geometry: twig })
  }
  return mergeGeometries(parts)
}

export function rockGeometry(rnd: Rand, seed: number): THREE.BufferGeometry {
  // faceted, directionally deformed boulder with a settled flat base
  const g = blob(1, rnd.range(0.55, 0.85), seed, 0.68, rnd.next() > 0.4 ? 1 : 0)
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const arr = pos.array as Float32Array
  const bx = rnd.range(0.8, 1.35), bz = rnd.range(0.7, 1.2), by = rnd.range(0.45, 0.8)
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] *= bx; arr[i + 1] *= by; arr[i + 2] *= bz
    if (arr[i + 1] < -by * 0.3) arr[i + 1] = -by * (0.3 + hash21(arr[i] * 3 + seed, arr[i + 2] * 3) * 0.12)
  }
  pos.needsUpdate = true
  crNormals(g)
  g.scale(rnd.range(0.85, 1.35), rnd.range(0.85, 1.1), rnd.range(0.85, 1.3))
  paint(g, (_x, y, _z, i) => {
    const moss = clamp(y * 2.4, 0, 1) * (hash21(i * 3.3, seed) > 0.55 ? 0.55 : 0.18)
    const v = 0.82 + hash21(i + seed, 1.7) * 0.36
    return [lerp(GREEN.rock[0], GREEN.moss[0], moss) * v, lerp(GREEN.rock[1], GREEN.moss[1], moss) * v, lerp(GREEN.rock[2], GREEN.moss[2], moss) * v]
  })
  return g
}

/** Crossed alpha-cards for instanced grass tufts. */
function grassTuftGeometry(): THREE.BufferGeometry {
  const mk = (rot: number): THREE.BufferGeometry => {
    const g = new THREE.PlaneGeometry(0.7, 0.5)
    g.translate(0, 0.25, 0)
    g.rotateY(rot)
    return g
  }
  const crossed = mergeGeometries([{ geometry: mk(0) }, { geometry: mk(Math.PI / 2.4) }])
  const pos = crossed.getAttribute('position') as THREE.BufferAttribute
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 0.5
    col[i * 3] = lerp(0.2, 0.42, t); col[i * 3 + 1] = lerp(0.28, 0.5, t); col[i * 3 + 2] = lerp(0.1, 0.16, t)
  }
  crossed.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return crossed
}

/* ----------------------------------------------------------- materials ---- */

export function foliageMaterial(alphaMap: THREE.Texture | null = null, tint = 0xffffff): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide, color: tint,
    alphaMap: alphaMap ?? undefined, transparent: alphaMap != null, alphaTest: alphaMap ? 0.4 : 0,
  })
}

/** Colour-variant set (§10): three tints so repeats never read identical. */
export function foliageVariants(): THREE.MeshStandardMaterial[] {
  return [foliageMaterial(null, 0xc8cfae), foliageMaterial(null, 0x9fb878), foliageMaterial(null, 0xd2c290)]
}

/* ------------------------------------------------------------ species+LOD -- */

/** Broadleaf: leaning trunk, branch stubs, 3–5 clustered foliage volumes
 *  (spec §4.3 — layered clusters, never a cylinder+ball lollipop). */
export function broadleafGeometry(rnd: Rand, lod = 1): THREE.BufferGeometry {
  const h = rnd.range(3.4, 5.8)
  const parts: { geometry: THREE.BufferGeometry }[] = []
  const rows = lod > 0 ? 8 : 4
  const lean = rnd.range(-0.5, 0.5)
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1)
    pts.push(new THREE.Vector3(lean * t * t, t * h, Math.sin(t * 2.6) * 0.16 * lean))
  }
  parts.push({ geometry: tubeAlong(pts, Array.from({ length: rows }, (_, i) => lerp(0.21, 0.07, i / (rows - 1))) as never, lod > 0 ? 7 : 5, (t) => {
    const v = 0.82 + hash21(t * 61, 4) * 0.3
    return [GREEN.bark[0] * v * 1.3, GREEN.bark[1] * v * 1.15, GREEN.bark[2] * v]
  }, 0.22) })
  // 4–5 clustered foliage volumes: dominant core + offset satellites at
  // staggered heights (breaks the single-blob lollipop profile), each with a
  // CONNECTED limb running from the trunk to the satellite's underside — no
  // floating stubs (Gate C1 round-1: connected structure doctrine).
  const crown = pts[pts.length - 1]
  const nVol = lod > 0 ? 4 + rnd.int(0, 1) : 2
  const leaf = rnd.next() > 0.75 ? GREEN.lite : GREEN.mid
  const leafPaint = (cx: number, cyBase: number) => (_x: number, y: number, _z: number, i: number): [number, number, number] => {
    const v = 0.74 + hash21(i * 2.1 + cx * 7, cyBase * 3) * 0.5
    const up = clamp((y - cyBase + 0.4) / 1.4, 0, 1)
    return [lerp(GREEN.deep[0], leaf[0], 0.35 + up * 0.6) * v, lerp(GREEN.deep[1], leaf[1], 0.42 + up * 0.6) * v, lerp(GREEN.deep[2], leaf[2], 0.3 + up * 0.5) * v]
  }
  let rCore = 1
  const limbAt = lod > 0 ? Math.floor((rows - 1) * 0.8) : Math.floor((rows - 1) * 0.72)
  const trunkPt = pts[limbAt]
  for (let k = 0; k < nVol; k++) {
    const big = k === 0
    const r = big ? rnd.range(0.95, 1.2) : rnd.range(0.68, 0.98)
    if (big) rCore = r
    const g = blob(r, rnd.range(0.62, 0.82), rnd.next() * 16, 0.68, lod > 0 ? 2 : 0)
    // satellites sit ON the core's surface (distance built from radii —
    // overlap guaranteed, no floating LOD0 blobs); the last one droops low
    const dirA = (k / (nVol - 1 || 1)) * Math.PI * 2 + rnd.range(-0.5, 0.5)
    const sep = k === 0 ? 0 : rCore * 0.52 + r * 0.62
    const ox = big ? 0 : Math.cos(dirA) * sep
    const oz = big ? 0 : Math.sin(dirA) * sep
    const oy = big ? 0.3 : k === nVol - 1 ? -rCore * 0.5 : rnd.range(-rCore * 0.3, rCore * 0.45)
    const cx = crown.x + ox + lean * 0.4, cy = crown.y + oy, cz = crown.z + oz
    g.translate(cx, cy, cz)
    paint(g, leafPaint(ox + oz, crown.y - 0.5))
    parts.push({ geometry: g })
    if (big) continue // core sits directly on the trunk crown
    if (lod === 0 && k > 1) continue // far level keeps one connected satellite
    // connected limb: trunk attach point → satellite underside
    const target = new THREE.Vector3(cx, cy - r * 0.15, cz)
    const src = trunkPt.clone().lerp(target, 0.3)
    const dir = target.clone().sub(src)
    const len = dir.length()
    const limb = new THREE.CylinderGeometry(0.075, 0.14, len, 6)
    limb.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()))
    limb.translate(src.x + (target.x - src.x) * 0.5, src.y + (target.y - src.y) * 0.5, src.z + (target.z - src.z) * 0.5)
    paint(limb, () => [GREEN.bark[0] * 0.6, GREEN.bark[1] * 0.56, GREEN.bark[2] * 0.5])
    parts.push({ geometry: limb })
  }
  return mergeGeometries(parts)
}

/** Wrap two seeded geometry levels into a real THREE.LOD (§4.7). */
export function treeLOD(near: THREE.BufferGeometry, far: THREE.BufferGeometry, mat: THREE.Material): THREE.Object3D {
  const a = new THREE.Mesh(near, mat)
  a.castShadow = true
  if (!kitLodEnabled()) return a
  const b = new THREE.Mesh(far, mat)
  b.castShadow = false
  const lod = new THREE.LOD()
  lod.addLevel(a, KIT.lodNear)
  lod.addLevel(b, KIT.vegLodMid)
  return lod
}

/* ---------------------------------------------------------- compositions --- */

export interface VegeHost { add(o: THREE.Object3D): void }

export function placeVegetation(host: VegeHost, spline: TrackSpline, field: CoastField, grassCard: THREE.Texture | null): void {
  const rnd = new Rand(SEED ^ 0xbeef)
  const foliage = foliageMaterial()
  const [foliageA, foliageB, foliageC] = foliageVariants()
  const pickFol = (): THREE.MeshStandardMaterial => rnd.chance(0.5) ? foliage : rnd.chance(0.55) ? foliageA : foliageB
  const drop = (geo: THREE.BufferGeometry, x: number, z: number, sc: number, tilt = 0, mat: THREE.MeshStandardMaterial = foliage): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat)
    const y = field.height(x, z)
    m.position.set(x, y - 0.06, z)
    m.scale.setScalar(sc)
    m.rotation.set(rnd.range(-tilt, tilt), rnd.next() * Math.PI * 2, rnd.range(-tilt, tilt))
    m.castShadow = true
    m.receiveShadow = false
    return m
  }

  /* palms — designed clusters on the sea verge + one pair east of the ramp */
  for (const [sC, count, spread] of [[170, 3, 4.5], [200, 2, 2.8], [238, 4, 5.5], [266, 2, 3.2]] as const) {
    for (let k = 0; k < count; k++) {
      const s = sC + rnd.range(-spread, spread)
      const f = spline.frame(s)
      const lat = -9.4 - rnd.range(0.4, 3.4)
      const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, lat)
      host.add(drop(palmGeometry(rnd), p.x, p.z, rnd.range(0.82, 1.22), 0.05, pickFol()))
    }
  }
  {
    const f = spline.frame(spline.sFromX(132))
    const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, 10.5)
    host.add(drop(palmGeometry(rnd), p.x, p.z, 1.05))
    const p2 = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, 12.2)
    host.add(drop(palmGeometry(rnd), p2.x, p2.z, 0.85))
  }

  /* coastal pines — loose groups behind the barrier + flanking the cluster */
  for (const [sC, count, latA, latB] of [[162, 3, 15, 26], [212, 2, 17, 30], [252, 3, 13, 24]] as const) {
    for (let k = 0; k < count; k++) {
      const s = sC + rnd.range(-6, 6)
      const f = spline.frame(s)
      const lat = rnd.range(latA, latB)
      const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, lat)
      {
        const t = treeLOD(pineGeometry(rnd, 1), pineGeometry(rnd, 0), pickFol())
        const y = field.height(p.x, p.z)
        t.position.set(p.x, y - 0.06, p.z)
        t.scale.setScalar(rnd.range(0.8, 1.25))
        t.rotation.set(rnd.range(-0.06, 0.06), rnd.next() * Math.PI * 2, rnd.range(-0.06, 0.06))
        host.add(t)
      }
    }
  }
  /* broadleaf groups — cluster flank + mid-ground band (species breadth §4.3) */
  for (const [sC, count, latA, latB] of [[140, 3, 11, 17], [185, 2, 12, 18], [228, 3, 11, 16], [280, 2, 12, 19]] as const) {
    for (let k = 0; k < count; k++) {
      const s = sC + rnd.range(-5, 5)
      const f = spline.frame(s)
      const lat = side2(latA, latB, rnd)
      const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, lat)
      if (field.height(p.x, p.z) < field.seaLevel + 0.8) continue
      const t = treeLOD(broadleafGeometry(rnd, 1), broadleafGeometry(rnd, 0), pickFol())
      const y = field.height(p.x, p.z)
      t.position.set(p.x, y - 0.06, p.z)
      t.scale.setScalar(rnd.range(0.85, 1.3))
      t.rotation.set(0, rnd.next() * Math.PI * 2, 0)
      host.add(t)
    }
  }
  // low LOD copies on the far hills (two LOD levels per spec §4.7)
  for (let k = 0; k < 9; k++) {
    const x = rnd.range(-40, 150)
    const z = rnd.range(62, 115)
    if (field.natural(x, z) < 2) continue
    const m = drop(pineGeometry(rnd, 0), x, z, rnd.range(1.1, 1.7))
    m.castShadow = false
    host.add(m)
  }

  /* bushs — dune strip, barrier back, cluster skirt */
  for (let k = 0; k < 26; k++) {
    const zone = k % 3
    let x: number, z: number
    if (zone === 0) { const f = spline.frame(rnd.range(155, 285)); const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, -rnd.range(13, 26)); x = p.x; z = p.z }
    else if (zone === 1) { const f = spline.frame(rnd.range(150, 290)); const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, rnd.range(11, 19)); x = p.x; z = p.z }
    else { x = rnd.range(16, 84); z = rnd.range(34, 44) }
    const gy = field.height(x, z)
    if (gy < field.seaLevel + 0.8) continue
    host.add(drop(bushGeometry(rnd), x, z, rnd.range(0.5, 1.35), 0, pickFol()))
  }

  /* authored mid-ground infill: barrier-to-buildings band must never be empty */
  for (let k = 0; k < 15; k++) {
    const s = rnd.range(150, 268)
    const f = spline.frame(s)
    const lat = rnd.range(9.8, 16)
    const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, lat)
    if (field.height(p.x, p.z) < field.seaLevel + 0.8) continue
    host.add(drop(bushGeometry(rnd), p.x, p.z, rnd.range(0.65, 1.5), 0, pickFol()))
  }

  /* rocks — cliff rim, shoreline, a pair of shoulder stones */
  const rocks: [number, number, number][] = []
  for (let k = 0; k < 9; k++) {
    const f = spline.frame(rnd.range(158, 280))
    const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, -rnd.range(21, 38))
    rocks.push([p.x, p.z, rnd.range(0.8, 2.6)])
  }
  for (const [rx, rz, rs] of [[-88, -41, 3.1], [-34, -44, 2.3], [6, -42, 1.7], [-130, -36, 2.6]] as const) rocks.push([rx + rnd.range(-4, 4), rz + rnd.range(-2, 2), rs])
  for (const [rx, rz, rs] of rocks) {
    const m = drop(rockGeometry(rnd, rnd.next() * 40), rx, rz, rs, 0.12)
    host.add(m)
  }
  {
    const f1 = spline.frame(178), f2 = spline.frame(246)
    for (const f of [f1, f2]) {
      const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, -6.45)
      host.add(drop(rockGeometry(rnd, rnd.next() * 40), p.x, p.z, 0.4, 0.2))
    }
  }

  /* grass tufts — instanced, colour-jittered, on dune + verge bands */
  if (grassCard) {
    const geo = grassTuftGeometry()
    const mat = foliageMaterial(grassCard)
    const N = 170
    const inst = new THREE.InstancedMesh(geo, mat, N)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3()
    let n = 0
    const col = new THREE.Color()
    for (let k = 0; k < N * 3 && n < N; k++) {
      let x: number, z: number
      const r = k % 2
      if (r === 0) { x = rnd.range(-110, 120); z = -rnd.range(15, 30) }
      else { const f = spline.frame(rnd.range(150, 290)); const pp = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, (k % 2 ? 1 : -1) * rnd.range(7.5, 10)); x = pp.x; z = pp.z }
      const y = field.height(x, z)
      if (y < field.seaLevel + 0.5) continue
      if (fbm2(x * 0.05 + 1.2, z * 0.05 + 3.7, 2) < 0.72) continue
      e.set(0, rnd.next() * Math.PI * 2, 0)
      q.setFromEuler(e)
      p.set(x, y - 0.02, z)
      const sc = rnd.range(1.7, 2.8)
      s.set(sc, rnd.range(1.3, 2.3), sc)
      m4.compose(p, q, s)
      inst.setMatrixAt(n, m4)
      const dry = rnd.next()
      col.setRGB(lerp(0.75, 1.15, dry), lerp(0.8, 1.0, dry), lerp(0.7, 0.95, dry))
      inst.setColorAt(n, col)
      n++
    }
    inst.count = n
    inst.instanceMatrix.needsUpdate = true
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true
    inst.frustumCulled = false
    host.add(inst)
  }
}

void crNormals
