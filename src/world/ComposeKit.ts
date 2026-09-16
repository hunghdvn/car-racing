import * as THREE from 'three'
import { SEED, THEME, KIT } from '../config'
import { Rand, lerp, clamp, smoothstep, fbm2, mergeGeometries, sweepProfile, crNormals, type MergePart, type SweepFrame } from '../util'
import { buildBuilding, buildingMaterials, BUILDING_DESIGNS, type BuildingDesignId } from './BuildingKit'
import { makeContainer, makeDrum, makeCrates, makePipeStack, makeTyreStack, makeBin, makeHydrant, makeBench, makePlanter, makeUtilityPole, makeMastLight, makeVan, makeBarrierUnit, makeBollard, makeSignGantry, propLOD, makeGantryCrane, makeSign, makeTrafficLight, makeStreetlight } from './PropKit'
import { broadleafGeometry, treeLOD, foliageVariants, foliageMaterial } from './VegetationKit'
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
  ids[4] = rnd.chance(0.5) ? 'office' : 'civic'
  // massing line with rhythm spacing (+ footprint aware)
  let x = -30
  for (let i = 0; i < ids.length; i++) {
    const b = buildBuilding(ids[i], rnd, true)
    const depthJit = rnd.range(-0.9, 0.9)
    b.position.set(x + rnd.range(-1.2, 1.2), opts.field(x, 2) - 0.06, 2 + depthJit)
    b.rotation.y = Math.PI + rnd.range(-0.04, 0.04)
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
  // focal boulder group (noise-deformed via VegetationKit path is heavy here;
  // three stacked faceted masses read as a settled headland core)
  const S = buildingMaterials()
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 0.92, metalness: 0.02, flatShading: true })
  const base = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 1), rockMat)
  deform(base.geometry, 0.55, rnd)
  base.position.set(0, opts.field(0, 0) + 0.9, 0)
  base.scale.set(1.15, 0.72, 1.0)
  const crest = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), rockMat)
  deform(crest.geometry, 0.5, rnd)
  crest.position.set(0.8, opts.field(0, 0) + 2.0, -0.5)
  crest.scale.set(1.0, 0.6, 0.9)
  const chip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), rockMat)
  deform(chip.geometry, 0.45, rnd)
  chip.position.set(-1.9, opts.field(-1.9, 1.4) + 0.3, 1.4)
  for (const r of [base, crest, chip]) { r.castShadow = true; r.receiveShadow = true }
  g.add(base, crest, chip)
  void S
  // driftwood log
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2.6, 7), new THREE.MeshStandardMaterial({ color: 0x8b7a5e, roughness: 0.95, flatShading: true }))
  log.rotation.z = Math.PI / 2 - 0.08
  log.rotation.y = 0.5
  log.position.set(2.6, opts.field(2.6, 2) + 0.14, 2)
  log.castShadow = true
  g.add(log)
  const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.1, 5), log.material)
  branch.position.set(2.2, opts.field(2.6, 2) + 0.42, 1.8)
  branch.rotation.z = 0.8
  g.add(branch)
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
  // ceiling fitting strips (emissive; the Phase-5 tube reuses their rhythm)
  for (const fy of [H - 0.18]) void fy
  for (let i = 0; i < 4; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(span * 0.8, 0.06, 0.3), S.glow)
    strip.position.set(0, H - 0.25, -3.2 - i * 3.1)
    g.add(strip)
  }
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
  let x = -62
  for (let mI = 0; mI < rnd.int(3, 4); mI++) {
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
  return PREFABS[id](opts)
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
    const pre = composePrefab(pl.id, { seed: (SEED ^ ((pl.seedSalt ?? 7) * 131)) >>> 0, field: (x, z) => field.height(x, z) })
    pre.position.set(p.x, field.height(p.x, p.z) - 0.1, p.z)
    pre.rotation.y = (pl.yaw ?? f.yaw + Math.PI / 2) + rnd.range(-0.02, 0.02)
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
  const flat = (x: number, z: number): number => field.height(x, z)
  const drop = (id: PrefabId, x: number, z: number, yaw: number, salt: number, yOff = -0.08): void => {
    const pre = composePrefab(id, { seed: (SEED ^ (salt * 0x2545ff11)) >>> 0, field: flat })
    pre.position.set(x, flat(x, z) + yOff, z)
    pre.rotation.y = yaw
    g.add(pre)
  }
  // city block fronting the authored pad; corner block east of it
  drop('CityBlock_Street', 48, 26, 0.02, 11)
  drop('CityBlock_Corner', 96, 22, -0.1, 12)
  // industrial spine at the far (west) end — kills the empty road tail
  drop('IndustrialCluster_Yard', -64, 36, 0.03, 13)
  drop('IndustrialCluster_Plant', -148, 30, 0.06, 14)
  // designed-open coast: dune clusters on the sea verge (the §10 exception)
  drop('CoastalCliff_Dune', -20, -34, 0.5, 15)
  drop('CoastalCliff_Dune', 40, -37, -0.7, 16)
  // background depth layer
  drop('Skyline_Backdrop', 10, 118, 0, 17, 0)
  drop('Skyline_Backdrop', 150, 122, 0, 18, 0)
  return g
}

void lerp; void smoothstep; void fbm2; void propLOD; void makeSignGantry; void makeGantryCrane
