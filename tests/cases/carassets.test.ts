import { test, assert } from '../harness'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { RIG_BANDS } from '../../src/assets/CarShared'
import { CAR_SPECS, rigKeyOf } from '../../src/vehicles/CarSpecs'
import { CAR_RIGS } from '../../src/assets/CarRigs'

/* Static container gates for the committed real-car GLBs (Task 2/4). The
 * files are parsed as raw GLB containers — 12-byte header, then chunk
 * length/type/data. NOTE: chunk DATA starts at byte 20 (the plan's snippet
 * said 24; that off-by-four parses spaces and fails on the first car).
 * No three.js, no fetch: a corrupted or misrigged asset must fail the node
 * suite, not the browser battery. */

interface GlbJson {
  nodes?: Array<{ name?: string; children?: number[]; mesh?: number; translation?: number[]; scale?: number[] }>
  meshes?: Array<{ name?: string; primitives: Array<{ attributes: Record<string, number>; material?: number }> }>
  materials?: Array<{ name?: string }>
  accessors?: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }>
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }>
}

function glbJson(path: string): GlbJson {
  const buf = readFileSync(path)
  assert(buf.readUInt32LE(0) === 0x46546c67, `${path}: glTF magic`)
  const type = buf.readUInt32LE(16)
  assert(type === 0x4e4f534a, `${path}: JSON chunk first`)
  const len = buf.readUInt32LE(12)
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'))
}

/** Decode one float32 VEC3/VEC4 accessor, honouring interleave (byteStride). */
function glbFloatVecs(path: string, accIndex: number): ArrayLike<number> | null {
  const buf = readFileSync(path)
  const j = glbJson(path)
  const acc = j.accessors?.[accIndex]
  const view = j.bufferViews?.[acc!.bufferView]
  if (!acc || !view || acc.componentType !== 5126) return null
  const comps = acc.type === 'VEC4' ? 4 : 3
  const binLen = buf.readUInt32LE(20 + buf.readUInt32LE(12))
  const binStart = 28 + buf.readUInt32LE(12)
  void binLen
  const base = binStart + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const stride = (view.byteStride ?? comps * 4) / 4
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out = new Float32Array(acc.count * comps)
  for (let i = 0; i < acc.count; i++)
    for (let k = 0; k < comps; k++) out[i * comps + k] = dv.getFloat32(base + (i * stride + k) * 4, true)
  return out
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

  test(`carassets/${id}: wheel tangents are non-degenerate`, () => {
    // PR #21 r4: Sketchfab bakes tire sidewalls with TANGENT ∥ NORMAL. The
    // normalMap shader's bitangent = normalize(cross(n,t)) then NaNs; the
    // fragment dies AND SwiftShader's tiler loses every draw behind it — one
    // such prim (carrera's rear rubber, 27 vertices) rendered 75% of the
    // car_model_carrera pose frame pure black while the geometry itself was
    // perfect. The pipeline repairs these (optimize-cars sanitizeTangents);
    // this gate catches any regression in a committed GLB, node-side.
    const j = glbJson(path)
    for (const n of j.nodes ?? []) {
      if (n.mesh == null || !/^wheel-.*-lr$/.test(n.name ?? '')) continue
      for (const p of j.meshes![n.mesh].primitives) {
        if (p.attributes.TANGENT == null || p.attributes.NORMAL == null) continue
        const nn = glbFloatVecs(path, p.attributes.NORMAL)
        const tt = glbFloatVecs(path, p.attributes.TANGENT)
        if (!nn || !tt) continue // non-float encodings are not what we bake
        assert(nn.length / 3 === tt.length / 4, `${path}: ${n.name} NORMAL/TANGENT vertex mismatch`)
        for (let i = 0; i < nn.length / 3; i++) {
          const [nx, ny, nz] = [nn[i * 3], nn[i * 3 + 1], nn[i * 3 + 2]]
          const [tx, ty, tz] = [tt[i * 4], tt[i * 4 + 1], tt[i * 4 + 2]]
          const dot = Math.abs(nx * tx + ny * ty + nz * tz)
          const cx = ny * tz - nz * ty, cy = nz * tx - nx * tz, cz = nx * ty - ny * tx
          assert(dot < 0.99 || Math.hypot(cx, cy, cz) > 0.1,
            `${path}: ${n.name} vertex ${i} has degenerate TANGENT (|dot(n,t)|=${dot.toFixed(4)})`)
        }
      }
    }
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
      assert(r >= RIG_BANDS.radius[0] && r <= RIG_BANDS.radius[1], `${id} wheelRadius ${r} outside the contract band`)
    }
    // −0.06 floor (plan said 0.08): the model sits ON its wheels, so a deep
    // splitter legitimately dips a few cm below the road plane (s15 −0.036).
    assert(rig.groundClearance >= RIG_BANDS.clearance[0] && rig.groundClearance <= RIG_BANDS.clearance[1],
      `${id} groundClearance ${rig.groundClearance} outside the contract band`)
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

test('carassets: RIG_BANDS stays the pinned contract values (widening a band is a silent gate removal)', () => {
  // the four numbers are the drift pin — car-contract.json is the source,
  // this test is the tripwire if either side is edited to "make CI pass"
  assert(RIG_BANDS.radius[0] === 0.2 && RIG_BANDS.radius[1] === 0.44, 'radius band is [0.2, 0.44]')
  assert(RIG_BANDS.clearance[0] === -0.06 && RIG_BANDS.clearance[1] === 0.25, 'clearance band is [-0.06, 0.25]')
})

test('carassets: total GLB payload within the 12 MB network budget', () => {
  // sum() accumulates during registration, but assert at RUN time against fs
  const bytes = CAR_SPECS.reduce((a, s) => a + (existsSync(`public/models/${s.id}.glb`) ? statSync(`public/models/${s.id}.glb`).size : 0), 0)
  assert(bytes <= 12 * GB, `total model payload ${(bytes / GB).toFixed(1)} MB > 12 MB`)
})

test('carassets/reports: the committed reports tie the GLBs to the generated table', () => {
  // rigs/reports/ is the regeneration SOURCE for CarRigs.ts (npm run
  // emit-rigs) and the CI evidence that public/models holds the VERY GLB
  // that was measured: a hand-edited table or a re-baked GLB reddens this
  // test even when every other gate only reads the emitted table
  // (PR #21 r3 — reports used to live in disposable build/, unregeneratable).
  for (const spec of CAR_SPECS) {
    const key = rigKeyOf(spec) // ONE formula for GLB file, report file and table row (PR #21 r4: the loop keyed the report by spec.id but the table by rigId ?? id)
    const p = `rigs/reports/${key}.report.json`
    assert(existsSync(p), `${p} must be committed`)
    const rep = JSON.parse(readFileSync(p, 'utf8')) as {
      id: string; tris: number; glbSha256: string; rig: Record<string, unknown>
      worldBox: { nearZ: number; farZ: number; topY: number }
      spikeClamped: { nose: boolean; tail: boolean }
    }
    assert(rep.id === key, `${p}: report id ${rep.id} is not the rig key ${key}`)
    assert(rep.tris <= 60000, `${key}: ${rep.tris} tris over the 60k budget (CI never reproduced the pipeline's own gate)`)
    const wb = rep.worldBox
    // spike-guard is honest evidence, not a wish: a clamped face is legal
    // (the guard exists for spires) but it MUST equal the percentile surface
    // exactly, and a reader must be able to tell clamped from measured
    // (PR #21 r4: warn output escaped as literal ${side} and nothing stuck)
    const HALF = 2.275 // TARGET_LEN/2 — the percentile surface by identity
    assert(rep.spikeClamped.nose ? Math.abs(wb.nearZ + HALF) <= 1e-3 : wb.nearZ > -(HALF + 0.25),
      `${key}: nose ${wb.nearZ} disagrees with its spikeClamped flag ${rep.spikeClamped.nose}`)
    assert(rep.spikeClamped.tail ? Math.abs(wb.farZ - HALF) <= 1e-3 : wb.farZ < HALF + 0.25,
      `${key}: tail ${wb.farZ} disagrees with its spikeClamped flag ${rep.spikeClamped.tail}`)
    const hash = createHash('sha256').update(readFileSync(`public/models/${key}.glb`)).digest('hex')
    assert(hash === rep.glbSha256, `${key}: public/models/${key}.glb is NOT the GLB the committed report measured`)
    const rig = CAR_RIGS[key] as unknown as Record<string, unknown>
    for (const [k, v] of Object.entries(rep.rig))
      assert(JSON.stringify(rig[k]) === JSON.stringify(v), `${key}.${k}: CarRigs.ts diverged from the committed report`)
    // worldBox is LOAD-BEARING evidence now (r4: zero readers made it a
    // comment): the emitted anchors must sit exactly where the box says
    const la = rig.logoAnchor as number[], na = rig.nitroAnchor as number[][], lz = rig.lampZ as number[]
    assert(Math.abs(la[2] - (wb.farZ + 0.02)) <= 1e-3, `${key}: logoAnchor z must be the reported tail face + 20 mm`)
    for (const a of na) assert(Math.abs(a[2] - (wb.farZ - 0.15)) <= 1e-3, `${key}: nitroAnchor z must be the tail face − 150 mm`)
    assert(Math.abs(lz[0] - (wb.nearZ - 0.012)) <= 1e-3 && Math.abs(lz[1] - (wb.farZ + 0.012)) <= 1e-3,
      `${key}: lamp planes must bracket the reported body ends ± 12 mm`)
    assert(la[1] <= wb.topY + 1e-3, `${key}: the badge cannot float above the reported roof`)
  }
})
