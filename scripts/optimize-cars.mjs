#!/usr/bin/env node
/* -------------------------------------------------------------------------
 * Real-car asset pipeline (real-car-models plan, Task 4).
 *
 *   node scripts/optimize-cars.mjs [id ...]        (default: all five)
 *
 * Reads the raw Sketchfab GLBs from assets-src/<id>.glb (gitignored, partner
 * download) and writes optimised runtime assets to public/models/<id>.glb:
 *
 *   · prune authored light meshes (best-effort; >15% tri share keeps + WARN)
 *   · cluster wheel meshes → canonical wheel-fl-lr / -fr-lr / -rl-lr / -rr-lr
 *     nodes, plus synthesized brake-<c>-lr disc + caliper-<c>-lr lug
 *   · weld + simplify to the per-car triangle budget
 *   · hue-similarity paint mask: body-panel materials renamed paint-<n>
 *     (the runtime swaps those for the game clearcoat paint); if no body hue
 *     separates, report bakedPaint: true (spec-sanctioned fallback)
 *   · glass candidates renamed glass-<n>
 *   · webp textures (sharp), unit-normalised to the 4.55 m footprint, wheels
 *     touching y=0 (ground-sit)
 *   · budget gate: ≤60k tris and ≤4 MB per car, ≤12 MB across all five
 *
 * build/cars/<id>.report.json records measurements + a ready-to-paste CarRig
 * literal for src/assets/CarRigs.ts. Tuning knobs live in CARS below.
 * ----------------------------------------------------------------------- */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO, Accessor } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, simplify, simplifyPrimitive, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'assets-src')
const OUT = join(root, 'public', 'models')
const REPORTS = join(root, 'build', 'cars')

/* Per-car tuning table — the single source of pipeline knobs. wheelMatch /
 * drop / glass are regex strings matched against node AND material names.
 * wheelMeshes forces an explicit node-name list (merged-wheel bakes the name
 * regex can't see); nose is where the model's NOSE points relative to the
 * procedural convention (-z) — '+z' cars get a 180° spin in the rig grouper. */
const CARS = {
  r34: {
    file: 'r34.glb', page: 'https://sketchfab.com/3d-models/none-ff8fb2251dfa4bb9979e7022c5a6666c',
    tris: 45000, tex: 1024, nose: '+z',
    wheelMeshes: ['Object_13', 'Object_14'], wheelMatch: 'tire|tyre|wheel|rim|pneu|jante', wheelExclude: 'spare',
    drop: null, glass: 'glass|wind|window',
  },
  '930': {
    file: '930.glb', page: 'https://sketchfab.com/3d-models/none-8568d9d14a994b9cae59499f0dbed21e',
    tris: 45000, tex: 1024, nose: '-z', error: 3e-3,
    wheelMatch: 'tire|rim', wheelExclude: 'spare',
    drop: 'lights_refraction|930_lights|wunderbaum', glass: 'glass',
  },
  s15: {
    file: 's15.glb', page: 'https://sketchfab.com/3d-models/none-18348c1698f74d9db1497a791bd21a2f',
    tris: 50000, tex: 1024, nose: '-z', error: 5e-3, wheelTris: 16000,
    wheelMatch: 'blitz03|blitz_bolts_gold', wheelExclude: 'spare',
    drop: 'lights', glass: 'windows|glass',
    paint: '^BODY$',
    interior: 'steeringwheel|gauage|gauge|pedal|dashglow|interior_mats|pioneer_avh|pillownaoki|turbine|turboisolation|waterreservoir|sr20|nfsframe',
  },
  centenario: {
    file: 'centenario.glb', page: 'https://sketchfab.com/3d-models/none-d679af35b5694301a185c7454a700c73',
    tris: 45000, tex: 1024, nose: '-z', error: 3e-3,
    wheelMatch: 'wheel|pneu|crbn_jante|tire32', wheelExclude: 'spare',
    drop: 'display|logo|^Object_12$', glass: 'glass|vitre',
    paint: 'plastique',
    interior: 'steering|dash|cuir|seat',
  },
  terzo: {
    file: 'terzo.glb', page: 'https://sketchfab.com/3d-models/none-7ad3dffa9d344c3c978eafcc220cb709',
    tris: 45000, tex: 1024, nose: '-z',
    wheelMatch: 'tire|wheel|jante', wheelExclude: 'spare',
    drop: 'display|Material\\.044', glass: 'vitres|glass',
  },
  carrera: {
    file: 'carrera.glb', page: 'https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf',
    tris: 50000, tex: 1024, nose: '+z', error: 3e-3,
    wheelMatch: 'cylinder\\.00[01]', wheelExclude: 'spare',
    drop: '^plane_0$|license|logo|coat', glass: 'window|glass',
  },
}
const TARGET_LEN = 4.55 // matches the procedural footprint (spec: undistorted uniform scale)
const CORNERS = ['fl', 'fr', 'rl', 'rr']
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

const fail = (msg) => { console.error(`[cars] ERROR: ${msg}`); process.exit(1) }

/* ------------------------------------------------------------- measurements */

function worldMatrix(doc, node, parentMat) {
  const t = node.getTranslation(), r = node.getRotation(), s = node.getScale()
  // compose TRS manually (rotation is a quaternion xyzw)
  const [x, y, z, w] = r
  const m = mat4trs(t, [x, y, z, w], s)
  return mat4mul(parentMat, m)
}
function mat4trs(t, q, s) {
  const [x, y, z, w] = q
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  const [sx, sy, sz] = s
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ]
}
function mat4mul(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return o
}
function xformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}
/** direction transform (rotation/scale part only) + normalise — for NORMALs */
function xformDir(m, v) {
  const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2]
  const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2]
  const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2]
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}
function attrMinMax(pos) {
  // Accessor.getMin caches into metadata and throws without it — compute manually
  const arr = pos.getArray(), n = pos.getCount(), item = arr.length / n
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const v = arr[i * item + k]
    if (v < min[k]) min[k] = v
    if (v > max[k]) max[k] = v
  }
  return { min, max }
}
function meshBBox(mesh, mat) {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    const { min: pmin, max: pmax } = attrMinMax(pos)
    for (let ix = 0; ix < 8; ix++) {
      const p = xformPoint(mat, [ix & 1 ? pmax[0] : pmin[0], ix & 2 ? pmax[1] : pmin[1], ix & 4 ? pmax[2] : pmin[2]])
      for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k] }
    }
  }
  return { min, max, center: min.map((v, i) => (v + max[i]) / 2) }
}
const primTris = (prim) => (prim.getIndices() ? prim.getIndices().getCount() / 3 : (prim.getAttribute('POSITION')?.getCount() ?? 0) / 3)
function sceneBBox(doc) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const { node, mat } of sceneNodes(doc)) {
    if (!node.getMesh()) continue
    const b = meshBBox(node.getMesh(), mat)
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.min[k]); max[k] = Math.max(max[k], b.max[k]) }
  }
  return { min, max }
}
function nodeTris(node) {
  const mesh = node.getMesh()
  return mesh ? mesh.listPrimitives().reduce((a, p) => a + primTris(p), 0) : 0
}
const nodeMats = (node) => (node.getMesh()?.listPrimitives() ?? []).map((p) => p.getMaterial()).filter(Boolean)

function sceneNodes(doc) {
  const out = []
  for (const scene of doc.getRoot().listScenes()) {
    const walk = (node, mat) => {
      const m = worldMatrix(doc, node, mat)
      out.push({ node, mat: m })
      for (const c of node.listChildren()) walk(c, m)
    }
    for (const n of scene.listChildren()) walk(n, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  }
  return out
}

/* ------------------------------------------------------------ hue analysis */

function rgbToHue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  if (d < 1e-4 || mx < 0.08 || mx > 0.95 * 255 && d / mx < 0.18) return null
  let h
  if (mx === r) h = ((g - b) / d) % 6
  else if (mx === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  const sat = mx === 0 ? 0 : d / mx
  if (sat < 0.35) return null
  return { h, sat }
}
async function textureHueHist(texture) {
  const img = texture?.getImage()
  if (!img?.value) return null
  const raw = await sharp(Buffer.from(img.value)).resize(224, 224, { fit: 'inside' }).removeAlpha().raw().toBuffer()
  const bins = new Array(36).fill(0)
  let total = 0
  for (let i = 0; i < raw.length; i += 3) {
    const s = rgbToHue(raw[i], raw[i + 1], raw[i + 2])
    if (!s) continue
    bins[Math.min(35, Math.floor(s.h / 10))]++
    total++
  }
  return total > 120 ? { bins, total } : null
}
function factorHue(factor) {
  if (!factor) return null
  const s = rgbToHue(factor[0] * 255, factor[1] * 255, factor[2] * 255)
  return s ? { h: s.h } : null
}

/* ------------------------------------------------------------ pipeline body */

async function processCar(id) {
  const cfg = CARS[id]
  const src = join(SRC, cfg.file)
  if (!existsSync(src)) fail(`${id}: missing ${cfg.file} — download it from ${cfg.page} (glTF format) into assets-src/`)
  mkdirSync(OUT, { recursive: true })
  mkdirSync(REPORTS, { recursive: true })
  console.log(`[cars] ${id}: reading ${cfg.file}`)
  const doc = await io.read(src)
  const scene = doc.getRoot().listScenes()[0]


  const re = (s) => s ? new RegExp(s, 'i') : null
  cfg.paintRe = re(cfg.paint)
  const wheelRe = re(cfg.wheelMatch), dropRe = re(cfg.drop), glassRe = re(cfg.glass), exclRe = re(cfg.wheelExclude)

  // 1. prune authored light/display meshes (best-effort, spec §lamps)
  if (dropRe) {
    const kill = []
    let totalTris = 0, killTris = 0
    for (const { node } of sceneNodes(doc)) {
      totalTris += nodeTris(node)
      const matHit = nodeMats(node).some((m) => dropRe.test(m.getName() ?? ''))
      if ((node.getMesh() && dropRe.test(node.getName() ?? '')) || matHit) { kill.push(node); killTris += nodeTris(node) }
    }
    if (killTris / Math.max(1, totalTris) > 0.3) {
      console.warn(`[cars] ${id}: drop-list covers ${(100 * killTris / totalTris).toFixed(1)}% of tris (>30%) — keeping all, REVIEW`)
    } else {
      for (const n of kill) n.getParentNode()?.removeChild(n)
      console.log(`[cars] ${id}: dropped ${kill.length} light/display nodes (${killTris} tris)`)
    }
  }

  // 1b. interior/engine-bay strip: through-glass occluders at racing scale
  // are pure triangle tax. No % guard — deleting a big interior is intentional.
  const interiorRe = re(cfg.interior)
  if (interiorRe) {
    const kill = []
    for (const { node } of sceneNodes(doc)) {
      if (!node.getMesh()) continue
      const matHit = nodeMats(node).some((m) => interiorRe.test(m.getName() ?? ''))
      if (matHit || interiorRe.test(node.getName() ?? '')) kill.push(node)
    }
    let killTris = 0
    for (const n of kill) { killTris += nodeTris(n); n.getParentNode()?.removeChild(n) }
    console.log(`[cars] ${id}: stripped ${kill.length} interior nodes (${killTris} tris)`)
  }

  // 2. wheel clustering → canonical corner nodes — TRIANGLE level. Sketchfab
  // bakes all four wheels into one mesh per material (pneu.005, Cylinder.000,
  // Object_13…), so node-level assignment is not enough: every candidate
  // triangle is classified by its world centroid against the split planes and
  // the per-corner primitives are rebuilt from the subsets, originals emptied.
  const max0 = sceneBBox(doc)
  let cands = []
  const wantNodes = cfg.wheelMeshes?.length ? new Set(cfg.wheelMeshes) : null
  for (const { node, mat } of sceneNodes(doc)) {
    if (!node.getMesh()) continue
    const name = node.getName() ?? ''
    if (wantNodes) { if (wantNodes.has(name)) cands.push({ node, mat }); continue }
    const matNames = nodeMats(node).map((m) => m.getName() ?? '')
    if (exclRe && (exclRe.test(name) || matNames.some((n) => exclRe.test(n)))) continue
    if (!wheelRe.test(name) && !matNames.some((n) => wheelRe.test(n))) continue
    // name matches lie (the Terzo names sills/wing stays "Jantes" too): a
    // road wheel must read round from the front — y-extent ≈ z-extent.
    const b = meshBBox(node.getMesh(), mat)
    const dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2]
    if (Math.abs(dy - dz) > 0.35 * (dy + dz) / 2) continue
    cands.push({ node, mat })
  }
  if (cands.length === 0 && !wantNodes) {
    // generic Sketchfab names (Object_N): detect wheels GEOMETRICALLY — flat
    // rotating bodies: y-extent ≈ z-extent (circular profile), narrow x (the
    // axle axis), radius within the plausible road-wheel band.
    console.log(`[cars] ${id}: name match found no wheels — geometric fallback`)
    const carLen = max0.max[2] - max0.min[2]
    for (const { node, mat } of sceneNodes(doc)) {
      if (!node.getMesh()) continue
      const b = meshBBox(node.getMesh(), mat)
      const dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2], dx = b.max[0] - b.min[0]
      const radius = (dy + dz) / 4
      if (radius < 0.08 * carLen || radius > 0.19 * carLen) continue
      if (Math.abs(dy - dz) > 0.35 * radius) continue
      if (dx > 0.9 * radius) continue
      cands.push({ node, mat })
    }
  }
  if (cands.length === 0) fail(`${id}: no wheel candidates matched /${cfg.wheelMatch}/ (name, list or geometry) — tune CARS.${id}`)

  // harvest every candidate triangle in world space
  const triPool = [] // { prim, material, ws: number[9], li: number[3] }
  let sMinX = Infinity, sMaxX = -Infinity, sMinZ = Infinity, sMaxZ = -Infinity
  for (const { node, mat } of cands) {
    for (const prim of node.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const arr = pos.getArray(), item = pos.getElementSize()
      const idxAcc = prim.getIndices(), ia = idxAcc ? idxAcc.getArray() : null
      const nTri = Math.floor((ia ? ia.length : pos.getCount()) / 3)
      const material = prim.getMaterial()
      const nrmAcc = prim.getAttribute('NORMAL')
      const na = nrmAcc ? nrmAcc.getArray() : null
      const nes = nrmAcc ? nrmAcc.getElementSize() : 0
      for (let t = 0; t < nTri; t++) {
        const li = ia ? [ia[t * 3], ia[t * 3 + 1], ia[t * 3 + 2]] : [t * 3, t * 3 + 1, t * 3 + 2]
        const ws = new Array(9)
        for (let k = 0; k < 3; k++) {
          const w = xformPoint(mat, [arr[li[k] * item], arr[li[k] * item + 1], arr[li[k] * item + 2]])
          ws[k * 3] = w[0]; ws[k * 3 + 1] = w[1]; ws[k * 3 + 2] = w[2]
          if (w[0] < sMinX) sMinX = w[0]; if (w[0] > sMaxX) sMaxX = w[0]
          if (w[2] < sMinZ) sMinZ = w[2]; if (w[2] > sMaxZ) sMaxZ = w[2]
        }
        triPool.push({ prim, material, mat, na, nes, ws, li })
      }
    }
  }
  const splitX = (sMinX + sMaxX) / 2, splitZ = (sMinZ + sMaxZ) / 2
  const nosePlusZ = cfg.nose === '+z'
  // corner → source prim → { material, vmap: localIdx→newIdx, verts, tris }
  const cornerGroups = new Map()
  for (const t of triPool) {
    const cxT = (t.ws[0] + t.ws[3] + t.ws[6]) / 3
    const czT = (t.ws[2] + t.ws[5] + t.ws[8]) / 3
    const corner = `${(nosePlusZ ? czT > splitZ : czT < splitZ) ? 'f' : 'r'}${cxT < splitX ? 'l' : 'r'}`
    let byPrim = cornerGroups.get(corner)
    if (!byPrim) cornerGroups.set(corner, byPrim = new Map())
    let e = byPrim.get(t.prim)
    if (!e) byPrim.set(t.prim, e = { material: t.material, vmap: new Map(), verts: [], tris: [] })
    const ni = []
    for (let k = 0; k < 3; k++) {
      let n = e.vmap.get(t.li[k])
      if (n === undefined) {
        n = e.verts.length; e.vmap.set(t.li[k], n)
        e.verts.push({
          li: t.li[k],
          world: [t.ws[k * 3], t.ws[k * 3 + 1], t.ws[k * 3 + 2]],
          nrm: t.na ? xformDir(t.mat, [t.na[t.li[k] * t.nes], t.na[t.li[k] * t.nes + 1], t.na[t.li[k] * t.nes + 2]]) : null,
        })
      }
      ni.push(n)
    }
    e.tris.push(ni)
  }

  const wheelReport = {}
  for (const corner of CORNERS) {
    const byPrim = cornerGroups.get(corner)
    if (!byPrim || byPrim.size === 0) fail(`${id}: no wheel triangles for ${corner} (${triPool.length} harvested) — tune CARS.${id}`)
    const pivot = doc.createNode(`wheel-${corner}-lr`)
    const mesh = doc.createMesh(`wheel-${corner}-lr`)
    pivot.setMesh(mesh)
    scene.addChild(pivot)
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    let triCount = 0
    for (const [src, e] of byPrim) {
      mesh.addPrimitive(primFromSubset(doc, src, e.verts, e.tris, e.material))
      triCount += e.tris.length
      for (const v of e.verts) for (let k = 0; k < 3; k++) {
        if (v.world[k] < box.min[k]) box.min[k] = v.world[k]
        if (v.world[k] > box.max[k]) box.max[k] = v.world[k]
      }
    }
    const center = box.min.map((v, i) => (v + box.max[i]) / 2)
    for (const [src, e] of byPrim) if (process.env.CARS_DEBUG)
      console.log(`  [dbg ${id} ${corner}] ${src.getMaterial()?.getName()} verts=${e.verts.length} y=[${Math.min(...e.verts.map((v) => v.world[1])).toFixed(2)},${Math.max(...e.verts.map((v) => v.world[1])).toFixed(2)}]`)
    const radius = (Math.max(box.max[1] - box.min[1], box.max[2] - box.min[2])) / 2
    wheelReport[corner] = { prims: byPrim.size, tris: triCount, center: center.map((v) => +v.toFixed(3)), radius: +radius.toFixed(3), bottom: +box.min[1].toFixed(3) }

    // synthesized brake disc + caliper (tests require brake-<c>-lr under the wheel)
    const [cx, cy, cz] = center
    const brake = buildDiscMesh(doc, `brake-${corner}-lr`, radius * 0.72, cx, cy, cz)
    pivot.addChild(brake)
    const cal = buildCaliperMesh(doc, `caliper-${corner}-lr`, radius, cx, cy, cz, Math.sign(cx) || 1)
    pivot.addChild(cal)
  }
  // empty the consumed source meshes in place — non-candidate children keep
  // their ancestors (and thus their world placement); prune() cleans the husks
  for (const { node } of cands) {
    const mesh = node.getMesh()
    for (const p of [...mesh.listPrimitives()]) p.dispose()
  }
  console.log(`[cars] ${id}: wheels rebuilt — scene children=${scene.listChildren().length} rootMeshes=${doc.getRoot().listMeshes().length}`)

  // 3. weld + simplify to budget
  // Sketchfab export debris: attribute accessors without data crash weld/simplify.
  // Rebuild those primitives without the dead attributes (drop the primitive
  // only if POSITION itself was dead).
  for (const mesh of [...doc.getRoot().listMeshes()]) {
    for (const p of [...mesh.listPrimitives()]) {
      const dead = !p.getAttribute('POSITION')?.getArray()
        || p.listSemantics().some((s) => !p.getAttribute(s)?.getArray())
        || (p.getIndices() && !p.getIndices().getArray())
      if (!dead) continue
      const q = doc.createPrimitive()
      for (const s of p.listSemantics()) { const a = p.getAttribute(s); if (a?.getArray()) q.setAttribute(s, a) }
      if (p.getIndices()?.getArray()) q.setIndices(p.getIndices())
      if (p.getMaterial()) q.setMaterial(p.getMaterial())
      mesh.removePrimitive(p)
      if (q.getAttribute('POSITION')?.getArray()) mesh.addPrimitive(q)
      else q.dispose()
    }
    if (mesh.listPrimitives().length === 0) mesh.dispose()
  }
  await doc.transform(weld())
  // 3b. micro-strip: disconnected detail specks — tire tread blocks, wheel
  // bolts, stitching — are topologically locked triangle tax (meshopt only
  // collapses edges, it never deletes a component). A component with ≤64
  // tris and a sub-12 cm bbox is garnish: drop it, then let simplify breathe.
  const MICRO_TRIS = 64, MICRO_DIAG = 0.12
  let microTris = 0
  for (const mesh of [...doc.getRoot().listMeshes()]) {
    for (const p of mesh.listPrimitives()) {
      const matName = p.getMaterial()?.getName() ?? ''
      if (matName === 'brake-disc' || matName === 'caliper-paint') continue
      const pos = p.getAttribute('POSITION')
      const idxAcc = p.getIndices()
      if (!pos?.getArray() || !idxAcc?.getArray()) continue
      const arr = pos.getArray(), ia = idxAcc.getArray(), n = pos.getCount()
      const par = new Int32Array(n).fill(-1)
      const find = (x) => { while (par[x] >= 0) { if (par[par[x]] >= 0) par[x] = par[par[x]]; x = par[x] } return x }
      const uni = (a, b) => {
        const ra = find(a), rb = find(b)
        if (ra === rb) return
        if (par[ra] > par[rb]) { par[ra] += par[rb]; par[rb] = ra } else { par[rb] += par[ra]; par[ra] = rb }
      }
      for (let i = 0; i < ia.length; i += 3) { uni(ia[i], ia[i + 1]); uni(ia[i], ia[i + 2]) }
      // component stats keyed by root
      const stats = new Map()
      for (let i = 0; i < ia.length; i += 3) {
        const r = find(ia[i])
        let s = stats.get(r)
        if (!s) stats.set(r, s = { tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] })
        s.tris++
        for (let k = 0; k < 3; k++) for (let e = 0; e < 3; e++) {
          const v = arr[ia[i + e] * 3 + k]
          if (v < s.min[k]) s.min[k] = v
          if (v > s.max[k]) s.max[k] = v
        }
      }
      const doomed = new Set()
      for (const [r, s] of stats) {
        const diag = Math.hypot(s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2])
        if (s.tris <= MICRO_TRIS && diag < MICRO_DIAG) doomed.add(r)
      }
      if (doomed.size === 0) continue
      const keep = []
      for (let i = 0; i < ia.length; i += 3) if (!doomed.has(find(ia[i]))) keep.push(ia[i], ia[i + 1], ia[i + 2])
      microTris += (ia.length - keep.length) / 3
      if (keep.length === 0) { p.dispose(); continue }
      const Ctor = ia.constructor
      p.setIndices(doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(new Ctor(keep)))
    }
  }
  if (microTris > 0) console.log(`[cars] ${id}: micro-strip removed ${microTris} garnish tris`)
  const trisOf = () => doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + primTris(p), 0), 0)
  let tris = trisOf()
  for (let i = 0; i < 6 && tris > cfg.tris; i++) {
    // meshopt aims for ratio of the CURRENT count; repeat passes only if its
    // error cap stopped it short (ratio of the target/current, single shot)
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(0.95, cfg.tris / tris), error: (cfg.error ?? 1e-3) * Math.pow(4, i) }))
    const next = trisOf()
    if (next >= tris) break
    tris = next
  }
  if (tris > 60000) console.warn(`[cars] ${id}: ${tris} tris before wheel trim (over the 60k cap)`)
  // NB: no flatten() — it would merge the canonical wheel/brake nodes away.
  // Wheels spin: they can carry far fewer tris than a still body would allow,
  // and tire tread / bolt fields are the prims meshopt refuses to crack open.
  {
    const wheelPrims = []
    for (const node of doc.getRoot().listNodes()) {
      if (!/^wheel-/.test(node.getName() ?? '') || !node.getMesh()) continue
      for (const p of node.getMesh().listPrimitives()) if (p.getMaterial()?.getName() !== 'brake-disc' && p.getMaterial()?.getName() !== 'caliper-paint') wheelPrims.push(p)
    }
    const wheelTris = wheelPrims.reduce((a, p) => a + primTris(p), 0)
    const budget = cfg.wheelTris ?? 14000
    if (wheelTris > budget) {
      const ratio = Math.min(0.9, budget / wheelTris)
      for (const p of wheelPrims) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 2e-2 })
      console.log(`[cars] ${id}: wheels ${wheelTris} -> ${wheelPrims.reduce((a, p) => a + primTris(p), 0)} tris (spin budget ${budget})`)
    }
  }
  tris = trisOf()
  if (tris > 60000) fail(`${id}: ${tris} tris after wheel trim — above the 60k hard cap`)
  await doc.transform(dedup())

  // 4. paint mask (hue-similarity) + glass rename
  const triByMat = new Map()
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const k = p.getMaterial()?.getName() ?? ''
    triByMat.set(k, (triByMat.get(k) ?? 0) + primTris(p))
  }
  const totalTris2 = [...triByMat.values()].reduce((a, b) => a + b, 0)
  const matHue = new Map()
  const bins = new Array(36).fill(0)
  for (const mat of doc.getRoot().listMaterials()) {
    const tex = mat.getBaseColorTexture()
    const img = tex?.getImage?.()?.value
    // texture-less Sketchfab rigs carry the paint in baseColorFactor — both
    // sources vote for the body hue, weighted by the material's tri share
    const h = img ? await textureHueHist(tex) : factorHue(mat.getBaseColorFactor())
    if (!h) continue
    matHue.set(mat, h)
    const w = triByMat.get(mat.getName() ?? '') ?? 0
    if (w === 0) continue
    if (h.bins) { for (let i = 0; i < 36; i++) bins[i] += (h.bins[i] / h.total) * w }
    else bins[Math.min(35, Math.floor(h.h / 10))] += w
  }
  let bodyBin = -1, bodyCount = 0
  for (let i = 0; i < 36; i++) if (bins[i] > bodyCount) { bodyBin = i; bodyCount = bins[i] }
  let bakedPaint = true, paintN = 0, glassN = 0
  for (const mat of doc.getRoot().listMaterials()) {
    const name = mat.getName() ?? ''
    if (glassRe?.test(name)) { if (!/^glass/.test(name)) mat.setName(`glass-${glassN++}`); continue }
    if (/^(wheel|brake|caliper)/.test(name)) continue
    // alpha-blended backstop: Sketchfab glass is often just "Material.006"
    // (BLEND + low opacity + transmission) — name matching misses it, and the
    // runtime glass-tint pass keys on the glass- name.
    if (!/^paint/.test(name) && mat.getAlphaMode?.() === 'BLEND' && mat.getAlpha() < 0.96) { mat.setName(`glass-${glassN++}`); continue }
    // author-named body material: trust the naming (silver/white/black cars
    // have no dominant hue for the mask below to key on). cfg.paint names the
    // body paint material explicitly for models with opaque author naming.
    const tr = triByMat.get(name) ?? 0
    if ((/(^|[^a-z])paint([^a-z]|$)/i.test(name) || (cfg.paintRe && cfg.paintRe.test(name))) && tr / Math.max(1, totalTris2) >= 0.02) { mat.setName(`paint-${paintN++}`); bakedPaint = false }
  }
  if (bodyBin >= 0) {
    for (const mat of doc.getRoot().listMaterials()) {
      const name = mat.getName() ?? ''
      if (/^paint-/.test(name) || /^glass/.test(name)) continue
      const h = matHue.get(mat)
      const tr = triByMat.get(name) ?? 0
      if (!h) continue
      let matchFrac = 0
      if (h.bins) {
        let m = 0
        for (let d = -1; d <= 1; d++) m += h.bins[(bodyBin + d + 36) % 36]
        matchFrac = m / h.total
      } else if (Math.abs(((h.h / 10) | 0) - bodyBin) <= 1) matchFrac = 1
      if (matchFrac >= 0.55 && tr / Math.max(1, totalTris2) >= 0.04) { mat.setName(`paint-${paintN++}`); bakedPaint = false }
    }
  }

  // 5. textures → webp
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [cfg.tex, cfg.tex] }))
  await doc.transform(prune())

  // 6. unit normalize + ground-sit on a fresh root node — centred on the
  // wheelbase midpoint (physics pivots at the car centre) and spun 180° when
  // the model's nose points +z (procedural convention: nose at -z).
  // The SCALE is measured on the CAR BODY, not the scene: Sketchfab rigs
  // park display planes/decor metres away. Outlier rejection: a node counts
  // toward the body only if its centre sits within the wheel footprint
  // (+2 wheel radii of overhang in z, 1.2 track in x) and its own extent
  // stays under 1.9× the wheelbase (kills full-size ground/shadow planes).
  const wheelBottom = Math.min(...CORNERS.map((c) => wheelReport[c].bottom))
  const wheelMid = [0, 0, 0]
  for (const c of CORNERS) for (let k = 0; k < 3; k++) wheelMid[k] += wheelReport[c].center[k] / 4
  const wheelbase = Math.abs(wheelReport.fl.center[2] - wheelReport.rl.center[2])
  const wheelR = Math.max(...CORNERS.map((c) => wheelReport[c].radius))
  const track = Math.abs(wheelReport.fl.center[0] - wheelReport.fr.center[0])
  const maxSpan = 1.9 * Math.max(wheelbase, wheelR * 4)
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  let bodyMinY = Infinity
  for (const { node, mat } of sceneNodes(doc)) {
    if (!node.getMesh() || node.getMesh().listPrimitives().length === 0) continue
    if (/^(wheel-|brake-|caliper-)/.test(node.getName() ?? '')) continue
    const b = meshBBox(node.getMesh(), mat)
    // fully-sub-floor strays — paint-shop decals, jack stands, parking lines —
    // can never be seen once the wheels sit on the road: delete them outright
    // so they neither clip the floor nor poison the scale/clearance metrics.
    if (b.max[1] < wheelBottom - 0.02) {
      console.log(`[cars] ${id}: dropped sub-floor node ${node.getName()} (${nodeTris(node)} tris)`)
      node.getParentNode()?.removeChild(node)
      continue
    }
    if (process.env.CARS_DEBUG && b.min[1] < wheelBottom - 0.05)
      console.log(`  [dbg ${id} low] ${node.getName()} mats=${nodeMats(node).map((m) => m.getName()).join('/')} min=[${b.min.map((v) => v.toFixed(2))}]`)
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2
    const ex = b.max[0] - b.min[0], ez = b.max[2] - b.min[2]
    if (Math.abs(cx - wheelMid[0]) > 1.2 * Math.max(track, 1) || Math.abs(cz - wheelMid[2]) > wheelbase / 2 + 2 * wheelR) continue
    if (ex > maxSpan || ez > maxSpan) continue
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.min[k]); max[k] = Math.max(max[k], b.max[k]) }
    if (b.min[1] < bodyMinY) bodyMinY = b.min[1]
  }
  if (!Number.isFinite(min[2])) fail(`${id}: body bbox empty after outlier rejection — review node layout`)
  const scale = TARGET_LEN / (max[2] - min[2])
  const rootScene = doc.getRoot().listScenes()[0]
  // SIT ON THE WHEELS: the tyre contact patch at y=0 is the one pose physics
  // promises. A splitter hanging below the contact patch (s15, Centenario —
  // see the report's negative groundClearance) clips the road plane by a few
  // cm: the industry-standard trade, invisible from the chase camera, unlike
  // floating wheels which read instantly.
  const sitRef = wheelBottom
  const grouper = doc.createNode('vr-rig').setScale([scale, scale, scale])
  if (nosePlusZ) grouper.setRotation([0, 1, 0, 0])
  const sgn = nosePlusZ ? 1 : -1
  grouper.setTranslation([sgn * wheelMid[0] * scale, -sitRef * scale, sgn * wheelMid[2] * scale])
  for (const n of [...rootScene.listChildren()]) grouper.addChild(n)
  rootScene.addChild(grouper)
  const groundClearance = (bodyMinY - sitRef) * scale

  // 7. write + budgets + report
  const out = join(OUT, `${id}.glb`)
  await io.write(out, doc)
  const bytes = readFileSync(out).byteLength
  const rig = {
    wheelRadius: CORNERS.map((c) => +(wheelReport[c].radius * scale).toFixed(3)),
    // WORLD space after the grouper (nose convention: front wheels at −z).
    // world(p) = scale·(R·p) + t with t = sgn·wheelMid·scale ⇒ world =
    // −sgn·(p − wheelMid)·scale on x/z. Using +sgn here once put the front
    // wheels at +z and the car drove backwards.
    wheelPos: CORNERS.map((c) => {
      const p = wheelReport[c].center
      return [-sgn * (p[0] - wheelMid[0]) * scale, (p[1] - sitRef) * scale, -sgn * (p[2] - wheelMid[2]) * scale].map((v) => +v.toFixed(3))
    }),
    groundClearance: +groundClearance.toFixed(3),
    caliperColor: 0xc23a28,
    bakedPaint,
    lampGlow: true,
    logoAnchor: [0, +(groundClearance + 0.35).toFixed(3), -(TARGET_LEN / 2 - 0.15).toFixed(3)],
    nitroAnchor: [[-0.18, +(groundClearance * 0.6 + 0.12).toFixed(3), +(TARGET_LEN / 2 - 0.05).toFixed(3)], [0.18, +(groundClearance * 0.6 + 0.12).toFixed(3), +(TARGET_LEN / 2 - 0.05).toFixed(3)]],
  }
  const report = { id, bytes, tris, wheels: wheelReport, scale: +scale.toFixed(4), bakedPaint, rig }
  writeFileSync(join(REPORTS, `${id}.report.json`), JSON.stringify(report, null, 2))
  console.log(`[cars] ${id}: ${(bytes / 1e6).toFixed(1)} MB, ${tris} tris, bakedPaint=${bakedPaint}, rig:`)
  console.log(`  ${id}: ${JSON.stringify(rig)},`)
  if (tris > 60000) fail(`${id}: tri budget exceeded`)
  if (bytes > 4 * 1024 * 1024) fail(`${id}: ${(bytes / 1e6).toFixed(1)} MB > 4 MB per-car budget — drop texture size or tri budget`)
  return report
}

/* synthesized meshes (no three.js in node: hand-built accessors) */
function primFromSubset(doc, src, verts, triList, material) {
  const out = doc.createPrimitive()
  // POSITION/NORMAL must land in WORLD space (the pivot node is identity and
  // the wheel report / brake / caliper are all measured in world): copying the
  // source array would bake wheels at their SOURCE node's local origin — the
  // merged Sketchfab wheel meshes put all four wheels around (0,0,0), which
  // once shipped every GLB with its wheels stacked inside the cabin.
  const worldNrm = src.getAttribute('NORMAL') && verts.every((v) => v.nrm)
  for (const semantic of src.listSemantics()) {
    if (semantic === 'POSITION' || (semantic === 'NORMAL' && worldNrm)) {
      const dst = new Float32Array(verts.length * 3)
      for (let v = 0; v < verts.length; v++) {
        const s = semantic === 'POSITION' ? verts[v].world : verts[v].nrm
        dst[v * 3] = s[0]; dst[v * 3 + 1] = s[1]; dst[v * 3 + 2] = s[2]
      }
      out.setAttribute(semantic, doc.createAccessor().setType(Accessor.Type.VEC3).setArray(dst))
      continue
    }
    const a = src.getAttribute(semantic)
    const arr = a?.getArray()
    if (!arr) continue
    const es = a.getElementSize()
    const dst = new arr.constructor(verts.length * es)
    for (let v = 0; v < verts.length; v++) for (let k = 0; k < es; k++) dst[v * es + k] = arr[verts[v].li * es + k]
    const acc = doc.createAccessor().setType(a.getType()).setArray(dst)
    if (a.getNormalized && a.getNormalized()) acc.setNormalized(true)
    out.setAttribute(semantic, acc)
  }
  const Ctor = verts.length > 65535 ? Uint32Array : Uint16Array
  const idx = new Ctor(triList.length * 3)
  let o = 0
  for (const t of triList) for (const i of t) idx[o++] = i
  out.setIndices(doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(idx))
  if (material) out.setMaterial(material)
  return out
}
function buildDiscMesh(doc, name, radius, cx, cy, cz) {
  const SEGS = 20
  const pos = [], idx = []
  // disc in the y-z plane (axle along x), at the hub centre
  pos.push(cx, cy, cz)
  for (let i = 0; i <= SEGS; i++) {
    const a = (i / SEGS) * Math.PI * 2
    pos.push(cx, cy + Math.cos(a) * radius, cz + Math.sin(a) * radius)
  }
  for (let i = 1; i <= SEGS; i++) idx.push(0, i, i + 1)
  const p = doc.createAccessor().setType(Accessor.Type.VEC3).setArray(new Float32Array(pos))
  const inx = doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(new Uint16Array(idx))
  const mat = doc.createMaterial('brake-disc').setBaseColorFactor([0.25, 0.25, 0.27, 1]).setRoughnessFactor(0.5).setMetallicFactor(0.6)
  const mesh = doc.createMesh(name).addPrimitive(doc.createPrimitive().setAttribute('POSITION', p).setIndices(inx).setMaterial(mat))
  return doc.createNode(name).setMesh(mesh)
}
function buildCaliperMesh(doc, name, wheelR, cx, cy, cz, sideSign = 1) {
  const w = 0.02, h = wheelR * 0.36, d = wheelR * 0.5
  const ox = cx - sideSign * 0.005 // hug the inboard face of the wheel
  const y0 = cy + wheelR * 0.18, z0 = cz - d / 2
  const box = [
    [ox, y0, z0], [ox + w, y0, z0], [ox + w, y0 + h, z0], [ox, y0 + h, z0],
    [ox, y0, z0 + d], [ox + w, y0, z0 + d], [ox + w, y0 + h, z0 + d], [ox, y0 + h, z0 + d],
  ]
  const faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]]
  const pos = [], idx = []
  for (const f of faces) {
    const b = pos.length / 3
    for (const v of f) pos.push(...box[v])
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  const p = doc.createAccessor().setType(Accessor.Type.VEC3).setArray(new Float32Array(pos))
  const inx = doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(new Uint16Array(idx))
  const mat = doc.createMaterial('caliper-paint').setBaseColorFactor([0.76, 0.23, 0.16, 1]).setRoughnessFactor(0.4)
  const mesh = doc.createMesh(name).addPrimitive(doc.createPrimitive().setAttribute('POSITION', p).setIndices(inx).setMaterial(mat))
  return doc.createNode(name).setMesh(mesh)
}

const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'))
if (ids.length === 0) Object.keys(CARS).forEach((k) => ids.push(k))
for (const id of ids) {
  if (!CARS[id]) fail(`unknown car '${id}' — known: ${Object.keys(CARS).join(', ')}`)
  await processCar(id)
}
const total = ids.reduce((a, id) => a + readFileSync(join(OUT, `${id}.glb`)).byteLength, 0)
console.log(`[cars] total ${(total / 1e6).toFixed(1)} MB across ${ids.length} cars (budget 12 MB)`)
if (total > 12 * 1024 * 1024) fail(`total ${(total / 1e6).toFixed(1)} MB > 12 MB — tighten budgets`)
void existsSync; void dirname
