import { assert, assertNear, test } from '../harness'
import { CAR_SPECS, HERO_SPEC, getSpec } from '../../src/vehicles/CarSpecs'
import {
  paintMaterialParams, glassMaterialParams, carbonMaterialParams,
  type PaintParams, type GlassParams, type CarbonParams,
} from '../../src/assets/MaterialSpecs'

/* Visual-enhancement group 2: the pure finish→material translation. These are
 * canvas- and THREE-free on purpose so the whole mapping (the thing that used
 * to be duplicated constants in the paint factory) is pinned headless. */

const inRange = (v: number, lo: number, hi: number, what: string): void =>
  assert(Number.isFinite(v) && v >= lo && v <= hi, `${what} must sit in [${lo},${hi}] — got ${v}`)

/* --------------------------------------------------------------- paint params */

test('materials: every model yields finite, in-range paint params', () => {
  for (const s of CAR_SPECS) {
    const p = paintMaterialParams(s.finish)
    inRange(p.metalness, 0, 1, `${s.id}.metalness`)
    inRange(p.roughness, 0.05, 0.6, `${s.id}.roughness`)
    inRange(p.clearcoat, 0, 1, `${s.id}.clearcoat`)
    inRange(p.clearcoatRoughness, 0.02, 0.2, `${s.id}.clearcoatRoughness`)
    inRange(p.sheen, 0, 0.4, `${s.id}.sheen`)
    inRange(p.sheenRoughness, 0, 1, `${s.id}.sheenRoughness`)
    inRange(p.envMapIntensity, 0.6, 0.9, `${s.id}.envMapIntensity`)
    inRange(p.flakeSpeckle, 0, 0.03, `${s.id}.flakeSpeckle`)
    inRange(p.flakeRepeat, 2, 10, `${s.id}.flakeRepeat`)
    inRange(p.microRoughness, 0, 1, `${s.id}.microRoughness`)
    assert(p.color === s.finish.paint, `${s.id}.color must stay palette-faithful (${s.finish.paint.toString(16)})`)
  }
})

test('materials: hero paint mirrors the shipped factory constants', () => {
  const p = paintMaterialParams(HERO_SPEC.finish)
  assert(p.roughness === 0.28, `hero roughness ${p.roughness} must equal the shipped 0.28`)
  assert(p.metalness === 0.15, `hero metalness ${p.metalness} must equal the shipped 0.15`)
  assert(p.sheenRoughness === 0.4, `hero sheenRoughness ${p.sheenRoughness} must equal the shipped 0.4`)
  assertNear(p.clearcoatRoughness, 0.045, 0.004, 'hero clearcoatRoughness stays near the shipped 0.045')
  assertNear(p.sheen, 0.2, 0.015, 'hero sheen stays near the shipped 0.2')
  inRange(p.envMapIntensity, 0.6, 0.9, 'hero envMapIntensity')
  assert(p.color === HERO_SPEC.finish.paint, 'hero colour is its signature paint')
})

test('materials: clearcoat drives clearcoatRoughness monotonically (gloss never roughens)', () => {
  const base = HERO_SPEC.finish
  const glossy = paintMaterialParams({ ...base, clearcoat: 0.95 })
  const mid = paintMaterialParams({ ...base, clearcoat: 0.6 })
  const satin = paintMaterialParams({ ...base, clearcoat: 0.15 })
  assert(glossy.clearcoatRoughness <= mid.clearcoatRoughness, 'more clearcoat never raises its roughness')
  assert(mid.clearcoatRoughness <= satin.clearcoatRoughness, 'less clearcoat never lowers its roughness')
  assert(glossy.clearcoatRoughness < satin.clearcoatRoughness, 'the extremes genuinely separate')
})

test('materials: flake density and env reflection scale with the finish', () => {
  const base = HERO_SPEC.finish
  const sparse = paintMaterialParams({ ...base, flake: 0.2 })
  const dense = paintMaterialParams({ ...base, flake: 0.9 })
  assert(sparse.flakeSpeckle <= dense.flakeSpeckle, 'denser flake never reduces the speckle chance')
  assert(sparse.flakeRepeat <= dense.flakeRepeat, 'denser flake never coarsens the tile')
  assert(dense.flakeSpeckle > sparse.flakeSpeckle, 'the extremes genuinely separate')
  // gloss reads more sky: higher clearcoat ⇒ at least as much env reflection
  const mat = CAR_SPECS.map((s) => [s.id, s.finish.clearcoat, paintMaterialParams(s.finish).envMapIntensity] as const)
  const hyper = mat.find((m) => m[0] === 'hyper')!
  const grip = mat.find((m) => m[0] === 'grip')!
  assert(hyper[1] > grip[1], 'hyper is the glossiest clear')
  assert(hyper[2] > grip[2], `hyper (cc ${hyper[1]}) must reflect more sky than satin grip (${grip[1]})`)
})

test('materials: the four paint maps are mutually distinct', () => {
  const sig = CAR_SPECS.map((s) => {
    const p = paintMaterialParams(s.finish)
    return `${p.roughness.toFixed(3)}|${p.clearcoat.toFixed(3)}|${p.clearcoatRoughness.toFixed(4)}|${p.flakeSpeckle.toFixed(4)}|${p.envMapIntensity.toFixed(3)}`
  })
  assert(new Set(sig).size === CAR_SPECS.length, `paint params must differ per model — got ${sig.join(' / ')}`)
})

/* --------------------------------------------------------------- glass params */

test('materials: hero glass mirrors the shipped smoke tint', () => {
  const g = glassMaterialParams(HERO_SPEC.finish)
  assert(g.color === 0x151c25, `hero glass tint ${g.color.toString(16)} must mirror the shipped 0x151c25`)
  inRange(g.roughness, 0, 0.08, 'hero glass roughness')
  inRange(g.opacity, 0.3, 0.6, 'hero glass opacity')
  inRange(g.ior, 1.4, 1.6, 'hero glass ior')
  inRange(g.envMapIntensity, 0.5, 0.95, 'hero glass envMapIntensity')
})

test('materials: glass stays smoked + reflective, never transmissive-flat', () => {
  for (const s of CAR_SPECS) {
    const g = glassMaterialParams(s.finish)
    assert(g.color === s.finish.glassTint, `${s.id} glass colour comes from the finish`)
    inRange(g.roughness, 0, 0.08, `${s.id} glass roughness`)
    inRange(g.opacity, 0.3, 0.6, `${s.id} glass opacity`)
    inRange(g.ior, 1.4, 1.6, `${s.id} glass ior`)
    inRange(g.envMapIntensity, 0.5, 0.95, `${s.id} glass envMapIntensity`)
    assert(g.opacity >= 0.3, `${s.id} windows must read smoked, not clear`)
    assert(g.envMapIntensity >= 0.5, `${s.id} windows must carry sky reflection`)
  }
})

test('materials: glass tints differ per model (warm drift vs cool hyper)', () => {
  const drift = glassMaterialParams(getSpec('drift').finish)
  const hyper = glassMaterialParams(getSpec('hyper').finish)
  const warm = (c: number): number => ((c >> 16) & 255) - ((c >> 0) & 255)
  assert(warm(drift.color) > 15, 'drift glass leans warm (red over blue)')
  assert(warm(hyper.color) < 0, 'hyper glass leans cool (blue over red)')
})

/* -------------------------------------------------------------- carbon params */

test('materials: carbon weave tints and reads with the carbon scalar', () => {
  const dark = carbonMaterialParams({ ...HERO_SPEC.finish, carbon: 0.04 })
  const light = carbonMaterialParams({ ...HERO_SPEC.finish, carbon: 0.14 })
  const lum = (c: number): number => ((c >> 16) & 255) + ((c >> 8) & 255) + ((c >> 0) & 255)
  assert(lum(dark.color) < lum(light.color), 'lower carbon scalar means a darker weave')
  for (const s of CAR_SPECS) {
    const c = carbonMaterialParams(s.finish)
    inRange(c.roughness, 0.2, 0.7, `${s.id} carbon roughness`)
    inRange(c.normalScale, 0.2, 1.4, `${s.id} carbon normalScale`)
    inRange(c.envMapIntensity, 0.3, 0.8, `${s.id} carbon envMapIntensity`)
    assert(c.repeat >= 2, `${s.id} weave tile must repeat into a pattern`)
    assert(Number.isFinite(c.color), `${s.id} carbon colour must be finite`)
  }
})

test('materials: the pure translators never mutate the finish they are given', () => {
  const s = getSpec('drift')
  const snap = { ...s.finish }
  const p: PaintParams = paintMaterialParams(s.finish)
  const g: GlassParams = glassMaterialParams(s.finish)
  const c: CarbonParams = carbonMaterialParams(s.finish)
  for (const k of Object.keys(snap) as (keyof typeof snap)[]) assert(s.finish[k] === snap[k], `finish.${k} untouched`)
  assert(p.color === snap.paint && g.color === snap.glassTint && Number.isFinite(c.color), 'outputs derived, not aliased')
})

/* PR review F12/F6: the per-model numbers have to reach the materials through
 * ONE pure core that mkPaint consumes — gating the params objects while the
 * factory ignored them proved nothing. carMaterialParamsFor is that core:
 * paint params + the per-kit caliper colour, testable per model headless. */

test('materials: carMaterialParamsFor lands distinct per-model numbers through the pure core', async () => {
  const mod = await import('../../src/assets/MaterialSpecs').catch(() => null)
  const fn = mod?.carMaterialParamsFor as unknown as
    ((s: (typeof CAR_SPECS)[number]) => { paint: PaintParams; caliper: number }) | undefined
  assert(typeof fn === 'function', 'carMaterialParamsFor is exported from MaterialSpecs')
  const b = Object.fromEntries(CAR_SPECS.map((s) => [s.id, fn!(s)]))
  // satin grip vs gloss hyper: the micro-roughness breakup must genuinely differ
  assert(b.grip.paint.microRoughness > b.hyper.paint.microRoughness,
    `grip satin breakup (${b.grip.paint.microRoughness}) must beat hyper gloss (${b.hyper.paint.microRoughness})`)
  // per-model calipers come from the kit (spec §6), hero keeps the shipped red
  assert(b.hero.caliper === HERO_SPEC.kit.caliper && b.hero.caliper === 0xc23a28,
    'hero caliper stays the shipped 0xc23a28 (never-touch byte-look)')
  assert(b.hyper.caliper === 0xe8b62e && b.grip.caliper === 0x39c06a && b.drift.caliper === 0xf27a1e,
    'hyper/grip/drift wear their kit caliper colours')
  const sig = CAR_SPECS.map((s) => {
    const p = fn!(s)
    return `${p.paint.roughness}|${p.paint.clearcoat}|${p.paint.microRoughness}|${p.caliper}`
  })
  assert(new Set(sig).size === CAR_SPECS.length, `per-model material numbers are distinct — got ${sig.join(' / ')}`)
})
