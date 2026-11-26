import { test, assert } from '../harness'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { CAR_SPECS } from '../../src/vehicles/CarSpecs'
import { CAR_RIGS } from '../../src/assets/CarRigs'

/* Static container gates for the committed real-car GLBs (Task 2/4). The
 * files are parsed as raw GLB containers — 12-byte header, then chunk
 * length/type/data. NOTE: chunk DATA starts at byte 20 (the plan's snippet
 * said 24; that off-by-four parses spaces and fails on the first car).
 * No three.js, no fetch: a corrupted or misrigged asset must fail the node
 * suite, not the browser battery. */

interface GlbJson {
  nodes?: Array<{ name?: string; children?: number[]; mesh?: number; translation?: number[]; scale?: number[] }>
  meshes?: Array<{ name?: string; primitives: Array<{ attributes: Record<string, number> }> }>
  materials?: Array<{ name?: string }>
}

function glbJson(path: string): GlbJson {
  const buf = readFileSync(path)
  assert(buf.readUInt32LE(0) === 0x46546c67, `${path}: glTF magic`)
  const type = buf.readUInt32LE(16)
  assert(type === 0x4e4f534a, `${path}: JSON chunk first`)
  const len = buf.readUInt32LE(12)
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'))
}

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const
const GB = 1024 * 1024

for (const spec of CAR_SPECS) {
  const id = spec.id
  const path = `public/models/${id}.glb`

  test(`carassets/${id}: file within budget`, () => {
    assert(existsSync(path), `${path} must be committed`)
    const bytes = statSync(path).size
    assert(bytes > 100 * 1024, `${path} suspiciously tiny (${bytes} B)`)
    assert(bytes <= 4 * GB, `${path} over the 4 MB per-car budget (${(bytes / GB).toFixed(1)} MB)`)
  })

  test(`carassets/${id}: canonical wheel rig in the container`, () => {
    const j = glbJson(path)
    const names = (j.nodes ?? []).map((n) => n.name ?? '')
    for (const c of CORNERS) {
      assert(names.filter((n) => n === `wheel-${c}-lr`).length === 1, `${path}: exactly one wheel-${c}-lr node`)
      // the brake disc must hang UNDER its wheel pivot node — VehicleVisual
      // folds the spin group by name-walk, and an orphaned brake never spins.
      const wi = names.indexOf(`wheel-${c}-lr`)
      assert(wi >= 0, `${path}: wheel-${c}-lr node exists`)
      const stack = [...(j.nodes![wi].children ?? [])]
      let found = false
      while (stack.length) {
        const k = stack.pop()!
        if ((j.nodes![k].name ?? '') === `brake-${c}-lr`) { found = true; break }
        stack.push(...(j.nodes![k].children ?? []))
      }
      assert(found, `${path}: brake-${c}-lr must be a descendant of wheel-${c}-lr`)
    }
    assert(names.includes('vr-rig'), `${path}: pipeline grouper node vr-rig missing`)
  })

  test(`carassets/${id}: paint + glass material naming`, () => {
    const mats = (glbJson(path).materials ?? []).map((m) => m.name ?? '')
    const rig = CAR_RIGS[id]
    assert(mats.some((n) => /^paint/.test(n)) || rig.bakedPaint,
      `${path}: no paint-* material and the rig does not declare bakedPaint`)
    assert(mats.filter((n) => /glass/i.test(n)).length >= 2,
      `${path}: ≥2 glass materials (tinted cabin + lights/roof) — got ${mats.filter((n) => /glass/i.test(n)).length}`)
  })

  test(`carassets/${id}: rig table is sane`, () => {
    const rig = CAR_RIGS[id]
    assert(rig.wheelRadius.length === 4, 'four wheel radii')
    for (const r of rig.wheelRadius) {
      // 0.20 floor (plan said 0.28): the s15's staggered 18×19 rear set measures 0.248
      assert(r >= 0.2 && r <= 0.44, `${id} wheelRadius ${r} outside [0.20, 0.44]`)
    }
    // −0.06 floor (plan said 0.08): the model sits ON its wheels, so a deep
    // splitter legitimately dips a few cm below the road plane (s15 −0.036).
    assert(rig.groundClearance >= -0.06 && rig.groundClearance <= 0.25,
      `${id} groundClearance ${rig.groundClearance} outside [-0.06, 0.25]`)
    assert(Number.isFinite(rig.groundClearance), `${id} groundClearance finite`)
    // L/R convention (PR #21 review): with the nose at −z the car's LEFT hubs
    // (fl, rl) sit at world −x. Three models are 180°-flipped by the grouper;
    // when the bucketing forgot to mirror x, wheel-fl-lr landed on +x — and
    // node+hub pair out of the same bucket, so only this sign rule catches it.
    assert(rig.wheelPos[0][0] < 0 && rig.wheelPos[2][0] < 0, `${id} left hubs must sit at −x`)
    assert(rig.wheelPos[1][0] > 0 && rig.wheelPos[3][0] > 0, `${id} right hubs must sit at +x`)
    // caliper tint is catalog-sourced (MaterialSpecs), NOT a rig column anymore.
    for (const v of rig.lampZ) assert(Number.isFinite(v), `${id} lampZ finite`)
    assert(rig.lampZ[0] < -1.5 && rig.lampZ[1] > 1.5 && rig.lampZ[0] < rig.lampZ[1],
      `${id} lampZ [${rig.lampZ.join(', ')}] must bracket the body ends`)
    // the badge is the TAIL wordmark (mesh name logo-rear): anchored +z (PR #21:
    // the old fixed anchor planted it at the nose)
    assert(rig.logoAnchor[2] > 1.5, `${id} logoAnchor must be on the tail (+z), got ${rig.logoAnchor[2]}`)
    for (const v of rig.logoAnchor) assert(Number.isFinite(v), `${id} logoAnchor finite`)
    for (const a of rig.nitroAnchor) for (const v of a) assert(Number.isFinite(v), `${id} nitroAnchor finite`)
    // nose convention: the two FRONT hubs live at −z (procedural CarModel puts
    // the nose at −z; an inverted sign here once made every car drive backwards)
    assert(rig.wheelPos[0][2] < 0 && rig.wheelPos[1][2] < 0, `${id} front wheels must sit at −z`)
    assert(rig.wheelPos[2][2] > 0 && rig.wheelPos[3][2] > 0, `${id} rear wheels must sit at +z`)
    for (const p of rig.wheelPos) for (const v of p) assert(Number.isFinite(v), `${id} wheelPos finite`)
  })
}

test('carassets: total GLB payload within the 12 MB network budget', () => {
  // sum() accumulates during registration, but assert at RUN time against fs
  const bytes = CAR_SPECS.reduce((a, s) => a + (existsSync(`public/models/${s.id}.glb`) ? statSync(`public/models/${s.id}.glb`).size : 0), 0)
  assert(bytes <= 12 * GB, `total model payload ${(bytes / GB).toFixed(1)} MB > 12 MB`)
})
