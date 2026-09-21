import * as THREE from 'three'
import { SEED, THEME, KIT } from '../config'
import { Rand, clamp, fbm2, hash21, mergeGeometries, sweepProfile, sanitizeGeometry, crNormals, kitLodEnabled, setKitLodEnabled, type MergePart, type SweepFrame } from '../util'
import { buildBuilding, buildingMaterials, BUILDING_DESIGNS, type BuildingDesignId } from './BuildingKit'
import { makeContainer, makeDrum, makeCrates, makePipeStack, makeTyreStack, makeBin, makeHydrant, makeBench, makePlanter, makeUtilityPole, makeMastLight, makeVan, makeBarrierUnit, makeBollard, makeSign, makeTrafficLight, makeStreetlight } from './PropKit'
import { broadleafGeometry, treeLOD, foliageVariants, foliageMaterial, palmGeometry, bushGeometry, rockGeometry } from './VegetationKit'
import { concreteMaps } from '../assets/Textures'
import type { TrackSpline } from './TrackSpline'
import type { CoastField } from './Terrain'

/* ------------------------------------------------------------------------- *
 * ComposeKit (spec §10) — authored cluster prefabs, not scatter loops.
 * Every prefab is a hand-composed composition with:
 *   · a focal landmark anchoring the group,
 *   · open/closed rhythm (tight pairs → breathing gap → tight run),
 *   · left/right asymmetric dressing,
 *   · seeded variation only inside the authored envelope
 *     (rotation jitter, ±15 % scale, colour variants, clustering).
 * Phase 5's section builder consumes these through `composeSection()`
 * without re-authoring anything.
 * ------------------------------------------------------------------------- */

export interface HeightReader { height(x: number, z: number): number; natural(x: number, z: number): number; seaLevel: number }

/** Prefab authors place children in local XZ. Sample the world terrain
 *  relative to the prefab's already-planted root, never the world origin. */
export function createPrefabHeightReader(
  field: HeightReader,
  root: { x: number; y: number; z: number },
  yaw: number,
): (x: number, z: number) => number {
  const cos = Math.cos(yaw), sin = Math.sin(yaw)
  return (lx, lz) => {
    const wx = root.x + cos * lx + sin * lz
    const wz = root.z - sin * lx + cos * lz
    return Math.max(0, field.height(wx, wz) - root.y)
  }
}

export type PrefabId =
  | 'CityBlock_Street' | 'CityBlock_Corner'
  | 'IndustrialCluster_Yard' | 'IndustrialCluster_Plant'
  | 'CoastalCliff_Dune'
  | 'TunnelApproach_Portal'
  | 'BridgeSegment_Deck'
  | 'Skyline_Backdrop'

/** §10 tight→loose rhythm sequence (relative weights between anchors). */
const RHYTHM = [1.0, 1.15, 0.72, 0.6, 1.6, 0.85, 0.7, 1.3] as const

export interface ComposeOpts {
  /** false renders full-detail meshes (kit boards); default true wires real LODs. */
  lod?: boolean
  seed: number
  /** ground sampler (slice field or flat board) */
  field: (x: number, z: number) => number
}

/** Seed a design pool pick without immediate repeats. */
function designRun(rnd: Rand, pool: BuildingDesignId[], n: number): BuildingDesignId[] {
  const out: BuildingDesignId[] = []
  for (let i = 0; i < n; i++) {
    let pick = rnd.pick(pool)
    let guard = 0
    while (out.length && pick === out[out.length - 1] && guard++ < 5) pick = rnd.pick(pool)
    out.push(pick)
  }
  return out
}

/** §10 variation envelope applied to any placed prefab: rot/scale jitter. */
function vary(o: THREE.Object3D, rnd: Rand, scaleBase = 1, tilt = 0.03): void {
  o.rotation.y += rnd.range(-KIT.yawJitter, KIT.yawJitter)
  const s = scaleBase * rnd.range(1 - KIT.scaleJitter, 1 + KIT.scaleJitter)
  o.scale.setScalar(s)
  o.rotation.x = rnd.range(-tilt, tilt)
  o.rotation.z = rnd.range(-tilt, tilt)
}

/** ================================================================= prefabs */

/** CityBlock_Street — 4–6 fronting buildings, sidewalk run, focal tower end.
 *  Front faces −z (the street). Composition reads: near pair tight → plaza
 *  gap → mid run tight → tall focal at the far end, open side-lot at street. */
function prefabCityBlockStreet(opts: ComposeOpts): THREE.Group {
  const rnd = new Rand(opts.seed)
  const g = new THREE.Group()
  g.name = 'CityBlock_Street'
  const pool: BuildingDesignId[] = ['cafe', 'retail', 'apartment', 'terrace', 'office', 'civic']
  const ids = designRun(rnd, pool, 5)
  ids[4] = ids[3] === 'civic' ? 'office' : rnd.chance(0.5) ? 'office' : 'civic'
  // massing line with rhythm spacing (+ footprint aware)
  let x = -30
  for (let i = 0; i < ids.length; i++) {
    const b = buildBuilding(ids[i], rnd, true)
    const depthJit = rnd.range(-0.9, 0.9)
    b.position.set(x + rnd.range(-1.2, 1.2), opts.field(x, 2) - 0.06, 2 + depthJit)
    b.rotation.y = rnd.range(-0.04, 0.04)
    vary(b, rnd, 1, 0.012)
    g.add(b)
    const fw = FOOTPRINT_W[ids[i]]
    x += fw + RHYTHM[i % RHYTHM.length] * rnd.range(2.4, 4.2) + (i === 2 ? 7 : 0)
  }
  // sidewalk furniture: staggered lamps, bollard clusters, planters, benches
  const lamps = 5
  for (let i = 0; i < lamps; i++) {
    const lx = -28 + i * 15 + rnd.range(-2.4, 2.4)
    const l = makeMastLight(rnd)
    l.position.set(lx, opts.field(lx, -7.6), -7.6)
    vary(l, rnd, 1, 0.02)
    g.add(l)
  }
  for (let i = 0; i < 3; i++) {
    const bx = -20 + i * 19 + rnd.range(-3, 3)
    for (let k = 0; k < 3; k++) {
      const bo = makeBollard(k % 2 ? 0xd8d3c6 : 0xc8c2b2)
      bo.position.set(bx + k * 0.95, opts.field(bx, -5.4), -5.4)
      g.add(bo)
    }
    const pl = makePlanter(rnd.range(1.5, 2.2))
    pl.position.set(bx + 4.4, opts.field(bx + 4.4, -5.6), -5.6)
    vary(pl, rnd, 1, 0.01)
    g.add(pl)
    if (i === 1) {
      const bn = makeBench()
      bn.position.set(bx - 5.2, opts.field(bx - 5.2, -6.4), -6.4)
      bn.rotation.y = rnd.range(-0.2, 0.2)
      g.add(bn)
      const hy = makeHydrant()
      hy.position.set(bx + 8.2, opts.field(bx + 8.2, -5.2), -5.2)
      g.add(hy)
    }
  }
  // open side-lot (left) with parked van + bin cluster — designed breathing
  const van = makeVan(rnd.pick([0x7a8288, 0x4f6a7d, 0x8a5530]), rnd)
  van.position.set(-26, opts.field(-26, -3) - 0.02, -3)
  van.rotation.y = Math.PI / 2 + rnd.range(-0.15, 0.15)
  g.add(van)
  for (let k = 0; k < 2; k++) {
    const bn = makeBin(rnd.pick([0x3f5a46, 0x42505c]))
    bn.position.set(-21 + k * 1.3, opts.field(-21, 1), 1)
    bn.rotation.y = rnd.range(-0.3, 0.3)
    g.add(bn)
  }
  // right-end filler: two broadleaf pairs (species mix §10)
  const fv = foliageVariants()
  for (const fx of [14, 18.5, 27]) {
    const t = treeLOD(broadleafGeometry(rnd, 1), broadleafGeometry(rnd, 0), rnd.pick(fv))
    t.position.set(fx, opts.field(fx, -4), -4 + rnd.range(-1, 1))
    t.scale.setScalar(rnd.range(0.75, 1.05))
    g.add(t)
  }
  return g
}

/** CityBlock_Corner — two retail faces + fenced rear lot with yard clutter. */
function prefabCityBlockCorner(opts: ComposeOpts): THREE.Group {
  const rnd = new Rand(opts.seed)
  const g = new THREE.Group()
  g.name = 'CityBlock_Corner'
  const a = buildBuilding('retail', rnd, true)
  a.position.set(0, opts.field(0, 4) - 0.05, 4)
  a.rotation.y = Math.PI
  vary(a, rnd, 1, 0.01)
  g.add(a)
  const b = buildBuilding('cafe', rnd, true)
  b.position.set(-11.5, opts.field(-11.5, -3) - 0.05, -3)
  b.rotation.y = Math.PI / 2 + rnd.range(-0.05, 0.05)
  vary(b, rnd, 1, 0.01)
  g.add(b)
  // fenced rear service lot (left/right asymmetric)
  const S = buildingMaterials()
  for (let i = 0; i < 7; i++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 6), S.frame)
    post.position.set(7 + (i % 4) * 2.6, opts.field(7, 12) + 0.85, 9 + Math.floor(i / 4) * 3.4)
    post.castShadow = true
    g.add(post)
  }
  for (const rz of [9, 12.4]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 10.4, 5), S.frame)
    rail.rotation.z = Math.PI / 2
    rail.position.set(11.6, opts.field(11.6, rz) + 1.62, rz)
    g.add(rail)
  }
  const c1 = makeContainer(rnd.pick([0x2e6470, 0x8a5530, 0x3a6f66]), rnd.int(0, 99))
  c1.position.set(9, opts.field(9, 10.6), 10.6)
  c1.rotation.y = rnd.range(-0.06, 0.06)
  g.add(c1)
  const up = makeUtilityPole(rnd)
  up.position.set(14.5, opts.field(14.5, 8), 8)
  g.add(up)
  for (let k = 0; k < 3; k++) {
    const dr = makeDrum(rnd.pick([0xb2592b, 0x365f86]), k === 2)
    dr.position.set(12.8 + rnd.range(-0.6, 0.6), opts.field(13, 11.6) + (k === 2 ? 0.3 : 0), 11.6 + k * 0.8)
    dr.rotation.y = rnd.next() * 3
    g.add(dr)
  }
  return g
}

/** IndustrialCluster_Yard — warehouse + factory pair, yard clutter, focal
 *  mast-light corner; open forecourt (closed back row). Consumable by §5. */
function prefabIndustrialYard(opts: ComposeOpts): THREE.Group {
  const rnd = new Rand(opts.seed)
  const g = new THREE.Group()
  g.name = 'IndustrialCluster_Yard'
  const wh = buildBuilding('warehouse', rnd, true)
  wh.position.set(-8, opts.field(-8, 6) - 0.05, 6)
  wh.rotation.y = Math.PI
  vary(wh, rnd, 1, 0.012)
  g.add(wh)
  const fa = buildBuilding('factory', rnd, true)
  fa.position.set(12, opts.field(12, 7) - 0.05, 7)
  fa.rotation.y = Math.PI + rnd.range(-0.05, 0.05)
  vary(fa, rnd, 1, 0.012)
  g.add(fa)
  // forecourt clutter — grouped not uniform: stack cluster + scattered trio
  const ca = makeContainer(rnd.pick([0x2e6470, 0x8a5530]), 11)
  ca.position.set(-3, opts.field(-3, -2), -2)
  ca.rotation.y = 0.05
  const cb = makeContainer(rnd.pick([0x2e6470, 0x8a5530]), 12)
  cb.position.set(-3 + rnd.range(-0.3, 0.3), opts.field(-2.6, -2) + 2.62, -2 + rnd.range(-0.3, 0.3))
  cb.rotation.y = -0.04
  g.add(ca, cb)
  const ps = makePipeStack(rnd)
  ps.position.set(3.4, opts.field(3.4, -3.6), -3.6)
  ps.rotation.y = Math.PI / 2 + rnd.range(-0.2, 0.2)
  g.add(ps)
  for (const [dx, dz, s2] of [[6.2, -1.8, 0.9], [15.8, -2.6, 1.05], [17.2, 1.4, 0.8]] as const) {
    const cr = makeCrates(rnd)
    cr.position.set(dx, opts.field(dx, dz), dz)
    cr.scale.setScalar(s2)
    g.add(cr)
  }
  const ty = makeTyreStack(rnd.int(3, 5))
  ty.position.set(-12.5, opts.field(-12.5, -1), -1)
  g.add(ty)
  const ml = makeMastLight(rnd)
  ml.position.set(18.5, opts.field(18.5, -5), -5)
  g.add(ml)
  const up = makeUtilityPole(rnd)
  up.position.set(-15, opts.field(-15, 3), 3)
  g.add(up)
  // weathered teal unit by the kerb (reads far, ages near)
  const c4 = makeContainer(0x3a6f66, 13)
  c4.position.set(16, opts.field(16, -6.4), -6.4)
  c4.rotation.y = 1.9 + rnd.range(-0.15, 0.15)
  g.add(c4)
  return g
}

/** IndustrialCluster_Plant — silos + substation + elevated pipe run; focal
 *  the silo cluster against the sky (Tier-1 landmark read). */
function prefabIndustrialPlant(opts: ComposeOpts): THREE.Group {
  const rnd = new Rand(opts.seed)
  const g = new THREE.Group()
  g.name = 'IndustrialCluster_Plant'
  const si = buildBuilding('silo', rnd, true)
  si.position.set(0, opts.field(0, 5) - 0.05, 5)
  si.rotation.y = rnd.range(-0.06, 0.06)
  g.add(si)
  const ss = buildBuilding('substation', rnd, true)
  ss.position.set(-12, opts.field(-12, -1) - 0.05, -1)
  ss.rotation.y = Math.PI
  vary(ss, rnd, 1, 0.01)
  g.add(ss)
  // elevated pipe run on trestles — the plant's artery (hand-authored sweep)
  const S = buildingMaterials()
  const pipeY = 2.6
  const frames: SweepFrame[] = []
  const pts: [number, number][] = [[-11, 2], [-4, 5], [6, 6.5], [13, 4]]
  for (let i = 0; i < pts.length; i++) {
    frames.push({ p: [pts[i][0], pipeY, pts[i][1]], s: [0, 0, 1], u: [0, 1, 0] })
  }
  const pipe = new THREE.Mesh(sweepProfile([[0, 0], [0.24, 0], [0.24, 0.24], [0, 0.24]], frames, { caps: true, uvScale: 0.5 }), S.metal)
  pipe.castShadow = true
  g.add(pipe)
  for (let i = 0; i < pts.length; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, pipeY, 6), S.frame)
    t.position.set(pts[i][0], pipeY / 2, pts[i][1])
    t.castShadow = true
    g.add(t)
    if (i < pts.length - 1) {
      const bx = (pts[i][0] + pts[i + 1][0]) / 2
      const bz = (pts[i][1] + pts[i + 1][1]) / 2
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, pipeY * 1.05, 5), S.frame)
      brace.position.set(bx, pipeY * 0.55, bz)
      brace.rotation.z = 0.36
      g.add(brace)
    }
  }
  const bar = makeBarrierUnit(3)
  bar.position.set(8, opts.field(8, 0), 0)
  bar.rotation.y = 0.1
  g.add(bar)
  return g
}

/** CoastalCliff_Dune — designed openness (the §10 sanctioned exception):
 *  focal headland boulder, leaning palm trio, spinifex drifts, driftwood. */
function prefabCoastalCliffDune(opts: ComposeOpts): THREE.Group {
  const rnd = new Rand(opts.seed ^ 0xc1a5)
  const g = new THREE.Group()
  g.name = 'CoastalCliff_Dune'
  // settled headland silhouette (Gate C1 round-1): two coherent lobes share
  // ONE profile — broad base, gentle windward slope, crest, steep lee slip
  // face — sampled as a continuous grid so normals stay coherent (no facet
  // explosion). fbm grain keeps the dune skin natural without shard noise.
  const duneH = (x: number, z: number): number => {
    const lobe = (cz: number, halfW: number, amp: number, crestX: number, crestW: number): number => {
      const v = Math.abs(z - cz) / (halfW * 0.62)
      if (v >= 1) return 0
      const u = (x - crestX) / crestW
      const along = u < 0
        ? Math.cos(clamp(-u, 0, 1) * Math.PI / 2) * (1 - 0.22 * Math.min(1, -u))
        : Math.pow(Math.max(0, 1 - u), 0.6)
      return Math.max(0, along) * (1 - v * v) * amp
    }
    const h = lobe(-1.1, 5.8, 2.8, 0.9, 6.6) + lobe(2.4, 4.8, 1.8, 2.7, 5.4)
    const grain = fbm2(x * 0.55 + 7.3, z * 0.55 + 2.1) * 0.2 + Math.sin(x * 1.9 + z * 0.8) * 0.04
    return Math.max(0, h + grain * Math.min(1, h))
  }
  const sx = 16.6 / 30, sz = 12.6 / 26
  const posA: number[] = [], uvA: number[] = [], colA: number[] = [], idxA: number[] = []
  const wet = [0.26, 0.235, 0.19], crestC = [0.46, 0.385, 0.285], rockC = [0.315, 0.295, 0.255]
  for (let j = 0; j <= 26; j++) for (let i = 0; i <= 30; i++) {
    const x = -7.4 + i * sx, z = -5.8 + j * sz
    const h = duneH(x, z)
    posA.push(x, h, z)
    uvA.push(i / 30, j / 26)
    const t = clamp(h / 2.7, 0, 1)
    const g = 0.86 + hash21(i * 0.37, j * 0.41) * 0.26
    const c = t < 0.18 ? wet : t > 0.8 ? crestC : rockC
    colA.push(c[0] * g, c[1] * g, c[2] * g)
  }
  for (let j = 0; j < 26; j++) for (let i = 0; i < 30; i++) {
    const a = j * 31 + i
    idxA.push(a, a + 31, a + 1, a + 1, a + 31, a + 32)
  }
  const duneGeo = new THREE.BufferGeometry()
  duneGeo.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3))
  duneGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2))
  duneGeo.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3))
  duneGeo.setIndex(idxA)
  sanitizeGeometry(duneGeo)
  crNormals(duneGeo)
  const dune = new THREE.Mesh(duneGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.02 }))
  dune.castShadow = true
  dune.receiveShadow = true
  g.add(dune)
  // driftwood log
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2.6, 7), new THREE.MeshStandardMaterial({ color: 0x8b7a5e, roughness: 0.95, flatShading: true }))
  log.rotation.z = Math.PI / 2 - 0.08
  log.rotation.y = 0.5
  log.position.set(2.6, duneH(2.6, 2) + 0.06, 2)
  log.castShadow = true
  g.add(log)
  const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.1, 5), log.material)
  branch.position.set(2.2, duneH(2.2, 1.8) + 0.34, 1.8)
  branch.rotation.z = 0.8
  g.add(branch)
  // leaning palm trio crowning the headland + spinifex drifts at the foot
  const palmMat = foliageMaterial(null, 0xb7c98a)
  // palms seat INTO the crest (base sunk below the surface so the trunk
  // emerges from the dune skin — no float gap)
  const trio: [number, number, number, number][] = [[-0.4, -1.0, 0.42, 0.24], [0.7, 0.7, -0.36, -0.3], [2.5, 2.9, 0.22, 0.14]]
  for (const [px, pz, lean, yaw] of trio) {
    const palm = treeLOD(palmGeometry(rnd, 1), palmGeometry(rnd, 0), palmMat)
    palm.position.set(px, duneH(px, pz) - 0.16, pz)
    palm.rotation.set(lean, yaw, lean * 0.6)
    palm.scale.setScalar(0.9 + rnd.range(0, 0.35))
    g.add(palm)
  }
  for (let b = 0; b < 6; b++) {
    const bx = rnd.range(-4.6, 4.6), bz = rnd.range(-4.2, 4.8)
    const bush = new THREE.Mesh(bushGeometry(rnd), foliageVariants()[b % 3])
    bush.position.set(bx, duneH(bx, bz) + 0.02, bz)
    bush.scale.setScalar(0.5 + rnd.range(0, 0.5))
    bush.castShadow = true
    g.add(bush)
  }
  for (let r = 0; r < 3; r++) {
    const rx = rnd.range(-5.4, 5.4), rz = rnd.range(-5, 5.4)
    const rk = new THREE.Mesh(rockGeometry(rnd, 40 + r), new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 0.93, flatShading: true }))
    rk.position.set(rx, duneH(rx, rz) - 0.06, rz)
    rk.scale.setScalar(0.5 + rnd.range(0, 0.7))
    rk.castShadow = true
    g.add(rk)
  }
  return g
}

function deform(geo: THREE.BufferGeometry, amt: number, rnd: Rand): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const arr = pos.array as Float32Array
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] *= 1 + (rnd.next() - 0.5) * amt
    arr[i + 1] *= 1 + (rnd.next() - 0.5) * amt * 0.6
    arr[i + 2] *= 1 + (rnd.next() - 0.5) * amt
  }
  crNormals(geo)
}

/** TunnelApproach_Portal — consumable shell: façade + wing walls + signage
 *  + light-pool emitters strips + banded kerbs (Phase 5 adds the tube). */
function prefabTunnelApproach(opts: ComposeOpts): THREE.Group {
  const rnd = new Rand(opts.seed)
  const g = new THREE.Group()
  g.name = 'TunnelApproach_Portal'
  const S = buildingMaterials()
  const W = 15.4, H = 6.4, TH = 1.1
  const span = W
  const leg = new THREE.Mesh(new THREE.BoxGeometry(TH, H, 2.4), S.concrete)
  leg.position.set(-span / 2 + TH / 2, H / 2, 0)
  const leg2 = leg.clone()
  leg2.position.x = span / 2 - TH / 2
  const headBeam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.5, 2.4), S.concrete)
  headBeam.position.y = H + 0.75
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(span + 0.6, 0.5, 2.7), S.concrete)
  fascia.position.y = H + 1.75
  for (const m of [leg, leg2, headBeam, fascia]) { m.castShadow = true; m.receiveShadow = true }
  g.add(leg, leg2, headBeam, fascia)
  // wing walls sloping with the approach, banded
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4 - k * 0.5, 0.7), k % 2 ? S.accent : S.concrete)
      seg.position.set(sx * (span / 2 + 1.3 + k * 2.5), (2.4 - k * 0.5) / 2, 1.4 + k * 0.7)
      seg.rotation.y = -sx * 0.28
      seg.castShadow = seg.receiveShadow = true
      g.add(seg)
    }
  }
  // portal signage band + twin arrows + height check bar
  const sign = new THREE.Mesh(new THREE.BoxGeometry(span * 0.5, 0.9, 0.14), S.frame)
  sign.position.set(0, H + 1.1, -1.28)
  g.add(sign)
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.5 - 0.3, 0.7), new THREE.MeshStandardMaterial({ color: 0x20242a, emissive: new THREE.Color(0x9fd8e8).convertSRGBToLinear(), emissiveIntensity: 1.1, roughness: 0.4, side: THREE.DoubleSide }))
  glow.position.set(0, H + 1.1, -1.42)
  glow.rotation.y = Math.PI
  g.add(glow)
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, span, 7), S.rust)
  bar.rotation.z = Math.PI / 2
  bar.position.y = H - 0.5
  bar.castShadow = true
  g.add(bar)
  // stub tube behind the portal so the strips sit under a real roof
  const tube = new THREE.Mesh(new THREE.BoxGeometry(span + 2.6, 0.9, 13.5), S.concrete)
  tube.position.set(0, H + 0.15, 6.9)
  tube.castShadow = tube.receiveShadow = true
  g.add(tube)
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.3, H + 1.2, 13.5), S.concrete)
    wall.position.set(sx * (span / 2 + 1.3), (H + 1.2) / 2, 6.9)
    wall.castShadow = wall.receiveShadow = true
    g.add(wall)
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(1.0, H + 2.9, 1.2), S.concrete)
    cheek.position.set(sx * (span / 2 + 1.3), (H + 2.9) / 2, 0.3)
    cheek.castShadow = cheek.receiveShadow = true
    g.add(cheek)
  }
  // ceiling fitting strips (emissive; the Phase-5 tube reuses their rhythm)
  for (const fy of [H - 0.18]) void fy
  for (let i = 0; i < 4; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(span * 0.8, 0.06, 0.3), S.glow)
    strip.position.set(0, H - 0.35, 2.2 + i * 3.1)
    g.add(strip)
  }
  // portal dark throat
  const throat = new THREE.Mesh(new THREE.PlaneGeometry(span - 0.4, H - 0.5), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95, side: THREE.DoubleSide }))
  throat.position.set(0, (H - 0.5) / 2 + 0.05, 13.4)
  g.add(throat)
  // kerb hazard panels
  for (const sx of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.16), new THREE.MeshStandardMaterial({ color: 0xd8a41d, roughness: 0.6 }))
    panel.position.set(sx * (span / 2 - 0.7), 0.6, -1.2)
    g.add(panel)
  }
  void rnd
  return g
}

/** BridgeSegment_Deck — deck span + twin piers + railing + soffit ribs. */
function prefabBridgeSegment(opts: ComposeOpts): THREE.Group {
  const rnd = new Rand(opts.seed)
  const g = new THREE.Group()
  g.name = 'BridgeSegment_Deck'
  const S = buildingMaterials()
  const len = 22, deckW = 11.6, y = opts.field(0, 0)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.85, len), S.concrete)
  deck.position.y = y
  deck.receiveShadow = true
  deck.castShadow = true
  g.add(deck)
  // kerbs + rails
  for (const sx of [-1, 1]) {
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.24, len), S.concrete)
    kerb.position.set(sx * (deckW / 2 - 0.2), y + 0.55, 0)
    g.add(kerb)
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, len), S.metal)
    rail.position.set(sx * (deckW / 2 - 0.2), y + 1.42, 0)
    g.add(rail)
    const mid = rail.clone()
    mid.position.y = y + 1.05
    g.add(mid)
    const np = Math.floor(len / 2.2)
    for (let i = 0; i <= np; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), S.metal)
      post.position.set(sx * (deckW / 2 - 0.2), y + 1.0, -len / 2 + 0.6 + i * ((len - 1.2) / np))
      post.castShadow = true
      g.add(post)
    }
  }
  // twin piers with stepped footing + expansion joint lines
  for (const pz of [-len / 2 + 0.02, len / 2 - 0.02]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(7.6, 4.2, 1.15), S.concrete)
    pier.position.set(0, y - 2.5, pz)
    pier.castShadow = pier.receiveShadow = true
    g.add(pier)
    const foot = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.6, 1.9), S.concrete)
    foot.position.set(0, y - 4.55, pz)
    g.add(foot)
    const rib = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.5, 0.3), S.roofDeckDark)
    rib.position.set(0, y - 0.45, pz)
    g.add(rib)
  }
  const joint = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.06, 0.12), new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.9 }))
  joint.position.set(0, y + 0.46, 0)
  g.add(joint)
  void rnd
  return g
}

/** Skyline_Backdrop — designed background silhouettes (depth layer 3).
 *  NOT random boxes: authored skyline modules (civic spire group / industrial
 *  stack line / stepped housing terrace), seeded variation, merged per
 *  material, never casts (spec §12 Tier-3). */
function prefabSkylineBackdrop(opts: ComposeOpts): THREE.Group {
  const rnd = new Rand(opts.seed ^ 0x5b1e)
  const g = new THREE.Group()
  g.name = 'Skyline_Backdrop'
  const tones = [0x7a7f88, 0x8a857c, 0x6d737c].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.88, metalness: 0.05 }))
  const parts: MergePart[] = []
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1)
  const push = (geo: THREE.BufferGeometry, mi: number, x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1): void => {
    e.set(0, yaw, 0); q.setFromEuler(e)
    p.set(x, y, z); sc.set(sx, sy, sz)
    m4.compose(p, q, sc)
    parts.push({ geometry: geo, matrix: m4.clone(), materialIndex: mi })
  }
  const baseZ = KIT.skyline.bandZ
  let x = -(KIT.skyline.modules * 31) / 2
  for (let mI = 0; mI < KIT.skyline.modules; mI++) {
    const kind = mI % 3
    if (kind === 0) {
      const hs = [14, 22, 11]
      for (let k = 0; k < 3; k++) {
        const w = 7 + k * 2, hh = hs[k]
        push(new THREE.BoxGeometry(w, hh, 9), 0, x, hh / 2, baseZ + k * 6, rnd.range(-0.14, 0.14))
        push(new THREE.BoxGeometry(w + 0.5, 0.7, 9.5), 1, x, hh, baseZ + k * 6, 0)
        if (k === 1) {
          push(new THREE.BoxGeometry(1.8, 6.5, 1.8), 2, x - w / 2 + 1.4, hh + 3.2, baseZ + 6, 0)
          push(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 5), 1, x - w / 2 + 1.4, hh + 7.4, baseZ + 6, 0)
        }
      }
      push(new THREE.SphereGeometry(3.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 1, x + 12, 4.4, baseZ + 2, 0, 1, 0.62, 1)
      push(new THREE.BoxGeometry(7.2, 4.4, 7.2), 0, x + 12, 2.2, baseZ + 2, 0.1)
      x += 30
    } else if (kind === 1) {
      for (let k = 0; k < 3; k++) {
        const sx2 = x + k * 5.6
        const hh = 21 + rnd.range(-2, 3)
        push(new THREE.CylinderGeometry(0.75, 0.95, hh, 9), 1, sx2, hh / 2, baseZ + 4, 0)
        push(new THREE.CylinderGeometry(0.86, 0.86, 0.9, 9), 0, sx2, hh - 1.2, baseZ + 4, 0)
        if (k === 1) push(new THREE.CylinderGeometry(0.95, 1.1, hh * 0.55, 9), 2, sx2, hh * 0.28, baseZ + 4, 0)
      }
      push(new THREE.BoxGeometry(0.5, 17, 0.5), 2, x + 18, 8.5, baseZ + 8, 0)
      push(new THREE.BoxGeometry(0.5, 17, 0.5), 2, x + 21.4, 8.5, baseZ + 8, 0)
      push(new THREE.BoxGeometry(0.36, 0.36, 5), 2, x + 19.7, 15.5, baseZ + 6, 0, 1, 1, 3.4)
      push(new THREE.BoxGeometry(9, 5.2, 6), 0, x + 8, 2.6, baseZ, 0.04)
      x += 30
    } else {
      for (let k = 0; k < 5; k++) {
        const hh = 6 + k * 1.9 + rnd.range(-1, 1)
        push(new THREE.BoxGeometry(5.4, hh, 7), k % 2, x + k * 5.6, hh / 2, baseZ + (k % 2) * 2.4, rnd.range(-0.08, 0.08))
        push(new THREE.BoxGeometry(5.6, 0.4, 7.2), 1, x + k * 5.6, hh, baseZ + (k % 2) * 2.4, 0)
        if (k % 2 === 0) push(new THREE.BoxGeometry(0.7, 1.7, 0.7), 1, x + k * 5.6 + 1.9, hh + 0.9, baseZ + (k % 2) * 2.4 - 2, 0)
      }
      x += 32
    }
  }
  const merged = mergeGeometries(parts)
  const mesh = new THREE.Mesh(merged, tones)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.scale.set(1.75, 2.1, 1)
  g.add(mesh)
  return g
}

const FOOTPRINT_W: Record<BuildingDesignId, number> = {
  warehouse: 17, cafe: 11, apartment: 13, office: 14, civic: 18, factory: 20,
  silo: 12, terrace: 17, carpark: 16, retail: 16, substation: 11,
}

const PREFABS: Record<PrefabId, (o: ComposeOpts) => THREE.Group> = {
  CityBlock_Street: prefabCityBlockStreet,
  CityBlock_Corner: prefabCityBlockCorner,
  IndustrialCluster_Yard: prefabIndustrialYard,
  IndustrialCluster_Plant: prefabIndustrialPlant,
  CoastalCliff_Dune: prefabCoastalCliffDune,
  TunnelApproach_Portal: prefabTunnelApproach,
  BridgeSegment_Deck: prefabBridgeSegment,
  Skyline_Backdrop: prefabSkylineBackdrop,
}

export function composePrefab(id: PrefabId, opts: ComposeOpts): THREE.Group {
  const prev = kitLodEnabled()
  setKitLodEnabled(opts.lod ?? true)
  try { return PREFABS[id](opts) } finally { setKitLodEnabled(prev) }
}

/* ====================================================== section composition ==
 * Phase-5 entry point: drops prefabs along a spline corridor with the §10
 * rules already applied (rhythm spacing, seeded jitter, left/right balance).
 * ======================================================================== */

export interface SectionPlacement {
  id: PrefabId
  /** arc-length station */
  s: number
  /** signed lateral offset (driver-right +) */
  lat: number
  /** world yaw of the prefab front (−z faces this way); default faces the road */
  yaw?: number
  seedSalt?: number
}

export function composeSection(spline: TrackSpline, field: HeightReader, layout: SectionPlacement[]): THREE.Group {
  const g = new THREE.Group()
  g.name = 'composed-section'
  for (const pl of layout) {
    const f = spline.frame(clamp(pl.s, 1, spline.length - 1))
    const p = new THREE.Vector3().copy(f.pos).addScaledVector(f.side, pl.lat)
    const rnd = new Rand(SEED ^ ((pl.seedSalt ?? 1) * 0x9e37) >>> 0)
    const rootY = field.height(p.x, p.z) - 0.1
    const yaw = (pl.yaw ?? f.yaw + Math.PI / 2)
    const pre = composePrefab(pl.id, { seed: (SEED ^ ((pl.seedSalt ?? 7) * 131)) >>> 0, field: createPrefabHeightReader(field, { x: p.x, y: rootY, z: p.z }, yaw) })
    pre.position.set(p.x, rootY, p.z)
    pre.rotation.y = yaw + rnd.range(-0.02, 0.02)
    g.add(pre)
  }
  return g
}

/* ================================================================ slice ====
 * The Phase-4 representative slice composition — the authored layout that
 * consumes the prefabs (migrating the Phase-3 inline cluster onto them).
 * ============================================================== */

export interface SliceLayoutOpts {
  spline: TrackSpline
  field: CoastField
}

export function dressSlice(opts: SliceLayoutOpts): THREE.Group {
  const { spline, field } = opts
  const g = new THREE.Group()
  g.name = 'slice-composition'
  const drop = (id: PrefabId, x: number, z: number, yaw: number, salt: number, yOff = -0.08): void => {
    const rootY = field.height(x, z) + yOff
    const pre = composePrefab(id, { seed: (SEED ^ (salt * 0x2545ff11)) >>> 0, field: createPrefabHeightReader(field, { x, y: rootY, z }, yaw) })
    pre.position.set(x, rootY, z)
    pre.rotation.y = yaw
    g.add(pre)
  }
  const dropOnTrack = (id: PrefabId, s: number, lat: number, yawOffset: number, salt: number, yOff = -0.08): void => {
    const f = spline.frame(clamp(s, 1, spline.length - 1))
    const x = f.pos.x + f.side.x * lat
    const z = f.pos.z + f.side.z * lat
    drop(id, x, z, f.yaw + Math.PI / 2 + yawOffset, salt, yOff)
  }
  // city block fronting the authored pad; corner block east of it
  drop('CityBlock_Street', 48, 26, 0.02, 11)
  drop('CityBlock_Corner', 96, 22, -0.1, 12)
  // industrial spine at the far (west) end — kills the empty road tail while
  // keeping its authored footprint clear of the circuit corridor
  drop('IndustrialCluster_Yard', -64, 36, 0.03, 13)
  dropOnTrack('IndustrialCluster_Plant', 12.7, 35, 0.06, 14)
  // designed-open coast: dune clusters on the sea verge (the §10 exception)
  drop('CoastalCliff_Dune', -20, -34, 0.5, 15)
  drop('CoastalCliff_Dune', 40, -37, -0.7, 16)
  // background depth layer
  drop('Skyline_Backdrop', 10, 118, 0, 17, 0)
  drop('Skyline_Backdrop', 150, 122, 0, 18, 0)
  return g
}
