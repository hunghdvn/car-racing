import { assert, test } from '../harness'
import { CAR_SPECS, HERO_SPEC, getSpec, type CarKit } from '../../src/vehicles/CarSpecs'
import { detailPlanFor, detailPartCount } from '../../src/assets/CarModel'

/* Visual-enhancement group 3: the raised shell-detail plan. `detailPlanFor`
 * is the pure kit → detail-hardware config the buildCar detail blocks read;
 * it is canvas- and THREE-free on purpose (like the MaterialSpecs translators)
 * so the per-model kit conditionals are pinned headless. */

const kitOf = (id: string): CarKit => getSpec(id).kit

test('shell detail: the hero rides plain — single round tips, bare hood', () => {
  const p = detailPlanFor(HERO_SPEC.kit)
  assert(p.exhaust === 'single', `hero exhaust plan must be single, got ${p.exhaust}`)
  assert(p.hoodSlats === 0, `hero hood must stay plain (no slats), got ${p.hoodSlats}`)
  assert(!p.hoodDome, 'hero gets no power dome')
})

test('shell detail: the corner-carver vents — the 930 gets hood slats, still single tips', () => {
  const p = detailPlanFor(kitOf('930'))
  assert(p.hoodSlats >= 2 && p.hoodSlats <= 3, `grip must get 2-3 hood slats, got ${p.hoodSlats}`)
  assert(p.exhaust === 'single', `grip exhaust stays single, got ${p.exhaust}`)
  assert(!p.hoodDome, 'grip gets no dome')
})

test('shell detail: Slide King swagger — twin stacked tips and hood slats', () => {
  const p = detailPlanFor(kitOf('s15'))
  assert(p.exhaust === 'twin', `the S15 must twin its tips, got ${p.exhaust}`)
  assert(p.hoodSlats >= 2 && p.hoodSlats <= 3, `the S15 must get 2-3 hood slats, got ${p.hoodSlats}`)
  assert(!p.hoodDome, 'the S15 gets no dome')
})

test('shell detail: the Centenario gets the centre quad block and the power dome, never slats', () => {
  const p = detailPlanFor(kitOf('centenario'))
  assert(p.exhaust === 'quad', `the Centenario must run the centre quad, got ${p.exhaust}`)
  assert(p.hoodDome, 'the Centenario gets the single power-dome ridge')
  assert(p.hoodSlats === 0, `dome and slats are exclusive, got slats=${p.hoodSlats}`)
})

test('shell detail: every model gets two door handles per side', () => {
  for (const s of CAR_SPECS) {
    const p = detailPlanFor(s.kit)
    assert(p.handlesPerSide === 2, `${s.id} door band must carry two slim bars per side, got ${p.handlesPerSide}`)
  }
})

test('shell detail: every model gets projector lamps, an LED tail bar and shut lines', () => {
  for (const s of CAR_SPECS) {
    const p = detailPlanFor(s.kit)
    assert(p.projectorLamps, `${s.id} must get the projector cluster`)
    assert(p.ledTailBar, `${s.id} must get the LED tail strip`)
    assert(p.shutLines >= 2 && p.shutLines % 2 === 0, `${s.id} shut lines must come in per-side pairs, got ${p.shutLines}`)
  }
})

test('shell detail: the raised trim stays inside the mesh budget', () => {
  for (const s of CAR_SPECS) {
    const n = detailPartCount(detailPlanFor(s.kit))
    assert(n <= 35, `${s.id} adds ${n} detail meshes — budget is 35`)
    assert(n >= 12, `${s.id} adds only ${n} detail meshes — the plan must actually add detail`)
  }
})

test('shell detail: detailPlanFor is pure — same kit, same plan, kit untouched', () => {
  const kit = { ...kitOf('s15') }
  const snap = JSON.stringify(kit)
  const a = detailPlanFor(kit)
  const b = detailPlanFor(kit)
  assert(JSON.stringify(a) === JSON.stringify(b), 'deterministic')
  assert(JSON.stringify(kit) === snap, 'kit never mutated')
})
