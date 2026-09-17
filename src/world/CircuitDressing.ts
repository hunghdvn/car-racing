import * as THREE from 'three'
import { SEED, TRACK } from '../config'
import { Rand } from '../util'
import { composePrefab, type PrefabId, type HeightReader } from './ComposeKit'
import { buildBuilding } from './BuildingKit'
import { makeGantryCrane, makeWaterTower, makeRadioMast, makeUtilityPole, makeMastLight, makeContainer, makeDrum, makePipeStack, makeTyreStack, makeVan, makeCones, makeSign, makeBillboard, makeBarrierUnit, makeBench } from './PropKit'
import { rockGeometry, bushGeometry, pineGeometry, treeLOD, foliageVariants } from './VegetationKit'
import type { TrackSpline } from './TrackSpline'

/* ------------------------------------------------------------------------- *
 * Circuit dressing (spec §8/§10, Phase 5C): authored content for the
 * non-coastal zones so every section meets the slice's visual floor —
 * focal landmarks, rhythm spacing, L/R variation, seeded within an authored
 * envelope. Consumed once from buildTrackSlice; nothing here scatters noise.
 * ------------------------------------------------------------------------- */

export interface DressCtx {
  spline: TrackSpline
  field: HeightReader
  rnd: Rand
  g: THREE.Group
}

export function dressCircuit(spline: TrackSpline, field: HeightReader): THREE.Group {
  const g = new THREE.Group()
  g.name = 'circuit-dressing'
  const ctx: DressCtx = { spline, field, rnd: new Rand(SEED ^ 0xd05e), g }
  dressIndustrial(ctx)
  dressRidge(ctx)
  dressStartFinish(ctx)
  return g
}

/** Place an object at (s, lat) on the formed ground, front facing the road
 *  when alignRoad (same convention as the north-city run). */
function put(c: DressCtx, o: THREE.Object3D, s: number, lat: number, faceRoad = true, dy = -0.05): THREE.Object3D {
  const f = c.spline.frame(s)
  o.position.set(f.pos.x + f.side.x * lat, c.field.height(f.pos.x + f.side.x * lat, f.pos.z + f.side.z * lat) + dy, f.pos.z + f.side.z * lat)
  if (faceRoad) o.rotation.y = f.yaw + (lat > 0 ? Math.PI / 2 : -Math.PI / 2)
  c.g.add(o)
  return o
}

function drop(c: DressCtx, id: PrefabId, s: number, lat: number, salt: number, scale = 1): void {
  const pre = composePrefab(id, { seed: (SEED ^ ((salt * 0x77e1) >>> 0)) >>> 0, field: (x: number, z: number) => c.field.height(x, z) })
  put(c, pre, s, lat, true, -0.1)
  if (scale !== 1) pre.scale.setScalar(scale)
}

const YAWJ = (rnd: Rand): number => rnd.range(-0.05, 0.05)

/* ═════════════════════════════════ industrial ═══════════════════════════ */

function dressIndustrial(c: DressCtx): void {
  const { rnd } = c
  const rng = c.spline.zoneRange('industrial')
  /* The four authored pads get purpose-built yards (config §pads comments). */
  const padAt = (cp: number): { s: number; lat: number } => ({ s: c.spline.sAtControl(cp), lat: (TRACK.pads.find((p) => p.cp === cp)?.lat ?? 30) })
  // pad: container yard, works south — the crane wharf focal
  {
    const p = padAt(14)
    const wharf = new THREE.Group()
    for (const [i, dx] of [[0, -14], [1, 10]] as const) {
      const cr = makeGantryCrane(new Rand(SEED ^ (0xc0a7 + i)))
      cr.position.set(dx, c.field.height(dx, 0) - 0.1, 0)
      cr.rotation.y = Math.PI / 2 + YAWJ(rnd)
      wharf.add(cr)
    }
    for (let k = 0; k < 9; k++) {
      const row = Math.floor(k / 3), col = k % 3
      const ca = makeContainer(rnd.pick([0x2e6470, 0x8a5530, 0x42505c]), 21 + k)
      ca.position.set(-6 + col * 6.6 + rnd.range(-0.25, 0.25), c.field.height(0, 0) + (k % 4 === 3 ? 2.7 : 0), -7 + row * 4.6 + rnd.range(-0.3, 0.3))
      ca.rotation.y = (row % 2 ? 1.57 : 0.04) + YAWJ(rnd)
      wharf.add(ca)
    }
    for (const [dx, dz] of [[12, -8], [-16, -4]] as const) {
      const p2 = makePipeStack(rnd)
      p2.position.set(dx, c.field.height(dx, dz), dz)
      wharf.add(p2)
    }
    put(c, wharf, p.s, p.lat, true, -0.08)
  }
  // pad: warehouse apron east
  {
    const p = padAt(16)
    const grp = new THREE.Group()
    for (const [i, dx] of [[0, -11], [1, 11]] as const) {
      const w = buildBuilding('warehouse', new Rand(SEED ^ (0xd9a7 + i)), true)
      w.position.set(dx, c.field.height(dx, 4) - 0.05, 4)
      w.rotation.y = Math.PI
      grp.add(w)
    }
    const v = makeVan(rnd.pick([0x7a8288, 0x8a5530]), rnd)
    v.position.set(-2, c.field.height(-2, -4), -4)
    v.rotation.y = 1.4 + YAWJ(rnd)
    grp.add(v)
    for (const [dx, dz] of [[6, -5], [16, -3]] as const) {
      const cn = makeContainer(0x3a6f66, 40 + dx)
      cn.position.set(dx, c.field.height(dx, dz), dz)
      cn.rotation.y = 0.1 + YAWJ(rnd)
      grp.add(cn)
    }
    const ml = makeMastLight(rnd)
    ml.position.set(-18, c.field.height(-18, -2), -2)
    grp.add(ml)
    put(c, grp, p.s, p.lat, true, -0.06)
  }
  // pad: pipe/steel yard
  {
    const p = padAt(19)
    const grp = new THREE.Group()
    for (let k = 0; k < 4; k++) {
      const ps = makePipeStack(rnd)
      ps.position.set(-10 + k * 7 + rnd.range(-0.6, 0.6), c.field.height(0, 0), rnd.range(-5, 5))
      ps.rotation.y = (k % 2 ? 1.57 : 0) + YAWJ(rnd)
      grp.add(ps)
    }
    const ty = makeTyreStack(6, 0x2a2c30)
    ty.position.set(13, c.field.height(13, 4), 4)
    grp.add(ty)
    const bar = makeBarrierUnit(3)
    bar.position.set(0, c.field.height(0, -6), -6)
    grp.add(bar)
    put(c, grp, p.s, p.lat, true, -0.06)
  }
  // pad: plant apron below the bore — the REFINERY focal landmark
  {
    const p = padAt(21)
    const grp = new THREE.Group()
    const fac = buildBuilding('factory', new Rand(SEED ^ 0xfa17), true)
    fac.position.set(-6, c.field.height(-6, 5) - 0.05, 5)
    fac.rotation.y = Math.PI
    grp.add(fac)
    for (const [i, dx] of [[0, 9], [1, 14.5], [2, 4.2]] as const) {
      const si = buildBuilding('silo', new Rand(SEED ^ (0x5110 + i)), true)
      si.position.set(dx, c.field.height(dx, 6) - 0.05, 6 + (i === 2 ? -3 : 0))
      grp.add(si)
    }
    // twin flare stacks with a pipe-bridge to the plant
    const S = new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.75, metalness: 0.15 })
    for (const [dx, h] of [[22, 21], [25.5, 16.5]] as const) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, h, 10), S)
      st.position.set(dx, c.field.height(dx, 2) + h / 2 - 0.1, 2)
      st.castShadow = true
      grp.add(st)
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.1, 10), new THREE.MeshStandardMaterial({ color: 0xb0342a, roughness: 0.6 }))
      band.position.set(dx, c.field.height(dx, 2) + h - 1.4, 2)
      grp.add(band)
    }
    const wt = makeWaterTower()
    wt.position.set(-16, c.field.height(-16, -2) - 0.1, -2)
    grp.add(wt)
    const rm = makeRadioMast(24)
    rm.position.set(30, c.field.height(30, -3) - 0.1, -3)
    grp.add(rm)
    const sg = makeSign('tyres', 2.6, 0.95)
    sg.position.set(-20, c.field.height(-20, -7), -7)
    grp.add(sg)
    put(c, grp, p.s, p.lat, true, -0.06)
  }

  /* Rhythm run between the pads: cluster prefabs, alternating sides, the
   * RHYTHM-derived gaps keep it tight→loose, never a picket fence. */
  const ids: PrefabId[] = ['IndustrialCluster_Yard', 'IndustrialCluster_Plant']
  let side = rnd.chance(0.5) ? 1 : -1
  for (let s = rng.s0 + 30, i = 0; s < rng.s1 - 26; i++) {
    const step = 62 + rnd.range(-6, 10) + (i % 4 === 3 ? 26 : 0)
    s += step
    if (s >= rng.s1 - 26) break
    drop(c, ids[i % 2], s, side * rnd.range(24, 38), i * 3 + 1)
    side = -side
  }
  // roadside filler: container pairs and drum groups at the near verge,
  // staggered sides so neither verge reads as a straight line of copies
  side = 1
  for (let s = rng.s0 + 18; s < rng.s1 - 14; s += rnd.range(44, 58)) {
    const grp = new THREE.Group()
    const n = rnd.int(1, 2)
    for (let k = 0; k <= n; k++) {
      const ca = makeContainer(rnd.pick([0x2e6470, 0x8a5530, 0x3a6f66]), Math.floor(s * 7 + k))
      ca.position.set(k * 6.7, c.field.height(0, 0) + (rnd.chance(0.4) ? 2.65 : 0), rnd.range(-1.2, 1.2))
      ca.rotation.y = 0.06 + YAWJ(rnd)
      grp.add(ca)
    }
    if (rnd.chance(0.6)) {
      const dm = makeDrum(rnd.pick([0xb2592b, 0x3f5a46]), rnd.chance(0.3))
      dm.position.set(-5, c.field.height(0, 0), 1.5)
      grp.add(dm)
    }
    put(c, grp, s, side * rnd.range(11.5, 13.5), true, -0.04)
    side = -side
  }
  // utility-pole runs follow the road like service infrastructure would
  for (const sgn of [1, -1] as const) {
    for (let s = rng.s0 + 10; s < rng.s1 - 8; s += rnd.range(26, 34)) {
      const up = makeUtilityPole(rnd)
      put(c, up, s, sgn * rnd.range(9.4, 10.4), false).rotation.y = c.spline.frame(s).yaw + Math.PI / 2
    }
  }
}

/* ═════════════════════════════════ ridge (final sector) ═════════════════ */

/** Instanced scatter that FOLLOWS the formed ground (rock/shrub treatment). */
function scatter(c: DressCtx, mkGeo: (r: Rand) => THREE.BufferGeometry, seeds: number[], rng0: { s0: number; s1: number }, latMin: number, latMax: number, scMin: number, scMax: number, count: number, mat: THREE.Material, bothSides: boolean): void {
  const { rnd } = c
  const geos = seeds.map((sd) => mkGeo(new Rand(SEED ^ sd)))
  const buckets: THREE.Matrix4[][] = geos.map(() => [])
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3()
  let placed = 0, guard = 0
  while (placed < count && guard++ < count * 6) {
    const s = rnd.range(rng0.s0 + 6, rng0.s1 - 6)
    const lat = (bothSides && rnd.chance(0.5) ? -1 : 1) * rnd.range(latMin, latMax)
    const f = c.spline.frame(s)
    const x = f.pos.x + f.side.x * lat, z = f.pos.z + f.side.z * lat
    const y = c.field.height(x, z)
    if (y < c.field.seaLevel - 0.5) continue
    const k = rnd.int(0, geos.length - 1)
    const scl = rnd.range(scMin, scMax)
    e.set(rnd.range(-0.14, 0.14), rnd.next() * Math.PI * 2, rnd.range(-0.14, 0.14))
    q.setFromEuler(e)
    m4.compose(v.set(x, y - 0.07, z), q, sc.setScalar(scl))
    buckets[k].push(m4.clone())
    placed++
  }
  geos.forEach((geo, k) => {
    if (!buckets[k].length) return
    const im = new THREE.InstancedMesh(geo, mat, buckets[k].length)
    buckets[k].forEach((m, j) => im.setMatrixAt(j, m))
    im.instanceMatrix.needsUpdate = true
    im.castShadow = true
    im.name = 'ridge-scatter'
    c.g.add(im)
  })
}

function dressRidge(c: DressCtx): void {
  const { rnd } = c
  const rng = c.spline.zoneRange('final')
  const fol = foliageVariants()
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })
  // scree: boulders half-sunk into the ridge flanks, both verges
  scatter(c, (r) => rockGeometry(r, 7), [11, 23, 37], rng, 10, 52, 0.6, 2.4, 132, rockMat, true)
  // shrub drifts hugging the same flanks (denser than the boulders)
  const bushMat = fol[0]
  scatter(c, (r) => bushGeometry(r), [51, 63], rng, 9.5, 44, 0.5, 1.35, 210, bushMat, true)
  // a few conifers on the crest so the ridge line is not bare silhouette
  const folB = fol[1]
  for (let i = 0; i < 26; i++) {
    const s = rnd.range(rng.s0 + 10, rng.s1 - 10)
    const lat = (rnd.chance(0.5) ? -1 : 1) * rnd.range(14, 52)
    const f = c.spline.frame(s)
    const x = f.pos.x + f.side.x * lat, z = f.pos.z + f.side.z * lat
    const y = c.field.height(x, z)
    if (y < c.field.seaLevel) continue
    const t = treeLOD(pineGeometry(rnd, 1), pineGeometry(rnd, 0), folB)
    t.position.set(x, y - 0.08, z)
    t.scale.setScalar(rnd.range(0.8, 1.35))
    t.rotation.y = rnd.next() * 6.28
    t.castShadow = true
    c.g.add(t)
  }
  // ridge overlook terrace (authored pad cp41): rail + bench + signage, rocks ringed
  {
    const s = c.spline.sAtControl(41)
    const grp = new THREE.Group()
    for (let k = 0; k < 5; k++) {
      const bar = makeBarrierUnit(3)
      bar.position.set(-7 + k * 3.4, c.field.height(0, 0), -4)
      grp.add(bar)
    }
    const b1 = makeBench()
    b1.position.set(-2, c.field.height(0, 0), 1.5)
    b1.rotation.y = 0.05
    grp.add(b1)
    const bb = makeBillboard('harbour')
    bb.position.set(9, c.field.height(0, 0), 0)
    bb.rotation.y = Math.PI / 2 + 0.1
    grp.add(bb)
    for (let k = 0; k < 5; k++) {
      const rk = new THREE.Mesh(rockGeometry(new Rand(SEED ^ (81 + k)), k), rockMat)
      rk.position.set(rnd.range(-12, 12), c.field.height(0, 0) - 0.08, rnd.range(3, 8))
      rk.scale.setScalar(rnd.range(0.6, 1.4))
      rk.rotation.y = rnd.next() * 6.28
      rk.castShadow = true
      grp.add(rk)
    }
    put(c, grp, s, 36, true, -0.05)
  }
  // quarry yard on the valley bench (authored pad cp44): plant + stock + cones
  {
    const s = c.spline.sAtControl(44)
    const grp = new THREE.Group()
    const fa = buildBuilding('factory', new Rand(SEED ^ 0xfa44), true)
    fa.position.set(0, c.field.height(0, 5) - 0.05, 5)
    grp.add(fa)
    const si = buildBuilding('silo', new Rand(SEED ^ 0x5144), true)
    si.position.set(-12, c.field.height(-12, 0) - 0.05, 0)
    grp.add(si)
    const ps = makePipeStack(rnd)
    ps.position.set(10, c.field.height(10, -3), -3)
    grp.add(ps)
    const cn = makeContainer(0x8a5530, 77)
    cn.position.set(16, c.field.height(16, 2), 2)
    grp.add(cn)
    const co = makeCones(rnd)
    co.position.set(5, c.field.height(5, -5), -5)
    grp.add(co)
    put(c, grp, s, -30, true, -0.06)
  }
  /* Elevated approaches: the two deck ends land on embankments — dress their
   * verges with the same rock/shrub language so they do not read as flat. */
  const ez = c.spline.zoneRange('elevated')
  for (const [a, b] of [[ez.s0 - 10, ez.s0 + 118], [ez.s1 - 118, ez.s1 + 10]] as const) {
    const win = { s0: a, s1: b }
    scatter(c, (r) => rockGeometry(r, 5), [91, 103], win, 10.5, 34, 0.55, 1.7, 26, rockMat, true)
    scatter(c, (r) => bushGeometry(r), [113, 127], win, 10, 28, 0.5, 1.2, 44, fol[0], true)
  }
}

/* ═════════════════════════════════ start / finish ═══════════════════════ */

function dressStartFinish(c: DressCtx): void {
  const { rnd } = c
  /* Grandstand + pit frontage on the pit/grandstand apron (authored pad
   * cp57, lat −26): stepped deck facing the racing line. */
  {
    const s = c.spline.sAtControl(57)
    const grp = new THREE.Group()
    const conc = new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.88 })
    const ink = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7 })
    for (let t = 0; t < 6; t++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(34, 1.05, 1.7), conc)
      tier.position.set(0, 0.52 + t * 1.05, t * 1.7)
      tier.castShadow = true
      tier.receiveShadow = true
      grp.add(tier)
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(34, 7.2, 0.6), ink)
    back.position.set(0, 3.4, 6 * 1.7 + 0.5)
    back.castShadow = true
    grp.add(back)
    // canopy on four columns + a sponsor fascia board
    const roof = new THREE.Mesh(new THREE.BoxGeometry(35, 0.35, 9), ink)
    roof.position.set(0, 7.9, 4.4)
    roof.castShadow = true
    grp.add(roof)
    for (const dx of [-15, -5, 5, 15]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.7, 0.4), conc)
      col.position.set(dx, 3.85, -1.2)
      col.castShadow = true
      grp.add(col)
    }
    const fas = makeBillboard('octane')
    fas.position.set(0, 8.4, 0.8)
    grp.add(fas)
    // pit building: low long bay with control-box above, between track and stand
    const pit = buildBuilding('civic', new Rand(SEED ^ 0xc17), true)
    pit.scale.set(1.6, 0.72, 0.9)
    pit.position.set(0, c.field.height(0, -14) - 0.05, -14)
    pit.rotation.y = Math.PI
    grp.add(pit)
    const tower = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.4, 2.6), ink)
    tower.position.set(13, c.field.height(0, -13) + 4.2, -13)
    tower.castShadow = true
    grp.add(tower)
    for (const dx of [-8, 0, 8]) {
      const ml = makeMastLight(rnd)
      ml.position.set(dx, c.field.height(dx, -7), -7)
      grp.add(ml)
    }
    put(c, grp, s, -26, true, 0)
  }
  /* Team-caravan apron (authored pad cp52): vans, banners, cones, seating */
  {
    const s = c.spline.sAtControl(52)
    const grp = new THREE.Group()
    for (let k = 0; k < 3; k++) {
      const v = makeVan(rnd.pick([0x7a8288, 0x4f6a7d, 0xb4ab9b]), rnd)
      v.position.set(-9 + k * 9, c.field.height(0, 0), 2 + (k % 2) * 3.2)
      v.rotation.y = 1.55 + YAWJ(rnd)
      grp.add(v)
    }
    for (const dx of [-14, 14]) {
      const bb = makeBillboard(rnd.pick(['rush', 'tyreking']))
      bb.position.set(dx, c.field.height(0, -3), -3)
      bb.rotation.y = Math.PI / 2 + 0.08
      grp.add(bb)
    }
    const co = makeCones(rnd)
    co.position.set(0, c.field.height(0, -4), -4)
    grp.add(co)
    for (const dx of [-4, 4]) {
      const bn = makeBench()
      bn.position.set(dx, c.field.height(0, 5), 5)
      bn.rotation.y = Math.PI
      grp.add(bn)
    }
    put(c, grp, s, -28, true, -0.05)
  }
  /* City frontage along the back straight (section_city's empty verges):
   * staggered blocks both sides at a rhythm pitch + mast-light runs. */
  for (const sgn of [1, -1] as const) {
    let s = 2640, i = 0
    while (s < 2952) {
      drop(c, i % 2 ? 'CityBlock_Street' : 'CityBlock_Corner', s, sgn * rnd.range(26, 38), 500 + i * 7 + (sgn > 0 ? 0 : 3))
      s += 64 + rnd.range(-8, 14) + (i % 3 === 2 ? 22 : 0)
      i++
    }
    for (let m = 2648; m < 2950; m += rnd.range(19, 25)) {
      const ml = makeMastLight(rnd)
      put(c, ml, m, sgn * rnd.range(9.6, 10.8), false).rotation.y = c.spline.frame(m).yaw + Math.PI / 2
    }
  }
  /* Finishing-straight infield: two blocks + bollard pairs toward the seam */
  drop(c, 'CityBlock_Corner', 3044, 27, 611)
  drop(c, 'CityBlock_Street', 3102, 33, 612, 0.8)
  // entry-gate signage at the straight's head
  const s2 = makeSign('shortcut', 2.6, 1.3)
  put(c, s2, 3018, -9.2, true, 0)
  const s3 = makeSign('speed', 1.3, 1.3, false)
  put(c, s3, 2632, 9.2, true, 0)

}


