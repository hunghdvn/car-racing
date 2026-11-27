import { assert, assertNear, test } from '../harness'
import { VEHICLE, CAR, PAINTS, AI } from '../../src/config'
import { AIVehicle } from '../../src/vehicles/AIVehicle'
import { BASE_TUNING, resolveTuning, type CarStat } from '../../src/vehicles/CarTuning'
import { CAR_SPECS, HERO_SPEC, brandingOn, carDisplayName, getSpec, identityFor, REAL, spokeCountForStyle, readModelSelection, readPaintSelection, reconcileAiColours, resolvePaint, resolvePaintWithExplicit, type CarKit } from '../../src/vehicles/CarSpecs'
import { validateCarShape } from '../../src/assets/CarModel'
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics'
import { FlatProbe, rig } from '../rig'
import { statBarsFor, STAT_AXIS_LABELS } from '../../src/ui/UIManager'
import type { CarTuning } from '../../src/vehicles/CarTuning'

test('tuning: BASE_TUNING is the verbatim VEHICLE constant set', () => {
  for (const k of Object.keys(VEHICLE) as (keyof typeof VEHICLE)[]) {
    assert(BASE_TUNING[k] === VEHICLE[k], `${String(k)} identity`)
  }
})

test('tuning: empty stat resolves bit-identical to VEHICLE (hero invariant)', () => {
  const t = resolveTuning({})
  for (const k of Object.keys(VEHICLE) as (keyof typeof VEHICLE)[]) {
    assert(t[k] === VEHICLE[k], `${String(k)} — got ${t[k]}, want ${VEHICLE[k]}`)
  }
})

test('tuning: multipliers apply to the named fields only', () => {
  const stat: CarStat = { topSpeed: 1.12, gripMax: 0.9, yawResponse: 1.08 }
  const t = resolveTuning(stat)
  assertNear(t.topSpeed, VEHICLE.topSpeed * 1.12, 1e-9, 'topSpeed')
  assertNear(t.gripMax, VEHICLE.gripMax * 0.9, 1e-9, 'gripMax')
  assertNear(t.yawResponse, VEHICLE.yawResponse * 1.08, 1e-9, 'yawResponse')
  assert(t.engineAccel === VEHICLE.engineAccel, 'untouched fields stay base')
  assert(t.brakeForce === VEHICLE.brakeForce, 'untouched fields stay base')
})

test('tuning: every multiplier clamps to the legal ±40% envelope', () => {
  const t = resolveTuning({ topSpeed: 2, drag: 0.001, driftYawBoost: -1 } as CarStat)
  assertNear(t.topSpeed, VEHICLE.topSpeed * (1 + CAR.statClamp), 1e-9, 'top clamp')
  assertNear(t.drag, VEHICLE.drag * (1 - CAR.statClamp), 1e-12, 'bottom clamp')
  assert(t.driftYawBoost >= 0, 'a nonsense multiplier cannot flip a field negative')
})

test('tuning: non-finite multipliers are ignored, not propagated', () => {
  const t = resolveTuning({ brakeForce: Number.NaN } as CarStat)
  assert(t.brakeForce === VEHICLE.brakeForce, 'NaN behaves as absent')
})

function topOut(tuning: CarTuning, seconds = 40): number {
  const p = new VehiclePhysics(new FlatProbe(), 7, tuning)
  const cmd = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }
  let t = 0
  while (t < seconds) { p.step(1 / 120, cmd); t += 1 / 120 }
  return p.speed
}

test('physics: default tuning is today\'s VEHICLE behaviour (top-speed cap)', () => {
  const base = topOut(BASE_TUNING)
  assert(base <= VEHICLE.topSpeed + 0.6, `base tops at ${base.toFixed(2)} <= ${(VEHICLE.topSpeed + 0.6).toFixed(2)}`)
  assert(base > VEHICLE.topSpeed * 0.90, 'and actually reaches it')
})

test('physics: hyper tuning raises the achievable top speed', () => {
  const base = topOut(BASE_TUNING)
  const hyper = topOut(resolveTuning({ topSpeed: 1.12, nitroTopSpeed: 1.1 }))
  assert(hyper > base * 1.05, `hyper ${hyper.toFixed(2)} vs base ${base.toFixed(2)}`)
})

test('physics: setTuning swaps the active record mid-life', () => {
  const p = new VehiclePhysics(new FlatProbe(), 9)
  p.setTuning(resolveTuning({ brakeForce: 1.4 }))
  assertNear(p.tuning.brakeForce, VEHICLE.brakeForce * (1 + CAR.statClamp), 1e-9, 'clamped swap')
})

test('physics: same seed + same tuning replays bit-identical', () => {
  const run = (): number => {
    const p = new VehiclePhysics(new FlatProbe(), 42, resolveTuning({ gripMax: 1.1 }))
    let t = 0
    while (t < 8) { p.step(1 / 120, { throttle: 1, brake: 0, steer: 0.5, handbrake: false, nitro: false }); t += 1 / 120 }
    return p.x + p.z + p.yaw
  }
  assert(run() === run(), 'trajectory identity')
})

test('catalog: the six real models exist in order', () => {
  assert(CAR_SPECS.map((s) => s.id).join(',') === 'r34,930,s15,centenario,terzo,carrera', 'catalog order')
  assert(CAR_SPECS.length === 6, 'six models')
  assert(CAR_SPECS.every((s) => s.name.length > 0 && s.class.length > 0), 'every model is named and classed')
})

test('catalog: hero is today\'s car — stations verbatim and stats resolved base', () => {
  assert(HERO_SPEC.id === 'r34', 'the balanced blueprint car leads the catalog')
  const t = resolveTuning(HERO_SPEC.stat)
  for (const k of Object.keys(VEHICLE) as (keyof typeof VEHICLE)[]) assert(t[k] === BASE_TUNING[k], String(k))
  assert(HERO_SPEC.kit.spoiler === 'low' && HERO_SPEC.kit.splitter === 'std', 'hero kit matches the shipped look')
  assert(HERO_SPEC.kit.wheelRadiusMul === 1 && HERO_SPEC.kit.trackMul === 1, 'hero geometry is base')
})

test('identity: every spec carries real-world branding metadata', () => {
  for (const s of CAR_SPECS) {
    assert((s.identity?.name.length ?? 0) > 0 && (s.identity?.maker.length ?? 0) > 0 && (s.identity?.license.length ?? 0) > 0, `identity ${s.id}`)
    assert(s.identity?.realBranding === true, `realBranding flag ${s.id}`)
    assert(s.name.length > 0 && s.name !== s.identity?.name, `fictional catalog name on ${s.id} (the real name lives ONLY in identity)`)
  }
})

test('identity: REAL_BRANDING swaps the display name AT RENDER TIME (PR #21: runtime flag flips take effect)', () => {
  assert(CAR.realBranding === true, 'branding ships on (partner decision; ASSETS.md records the licences)')
  assert(carDisplayName(getSpec('r34')) === 'Nissan Skyline GT-R R34', 'branded name (flag on)')
  assert(getSpec('r34').name === 'Velocity GT', 'the catalog field is the FICTIONAL name; the real one is identity-only (default-safe data model)')
  const was = CAR.realBranding
  try {
    CAR.realBranding = false
    for (const s of CAR_SPECS) assert(carDisplayName(s) === s.name, `flag-off shows the fictional catalog name (${s.id})`)
  } finally { CAR.realBranding = was }
  assert(carDisplayName(getSpec('r34')) === 'Nissan Skyline GT-R R34', 'flag restored')
})

test('identity: per-car realBranding override drops one car name (CC-BY-NC escape hatch)', () => {
  const s = getSpec('terzo')
  const was = s.identity!.realBranding
  try {
    s.identity!.realBranding = false
    assert(carDisplayName(s) === s.name, 'the per-car override wins over the global flag')
    assert(carDisplayName(getSpec('r34')) === 'Nissan Skyline GT-R R34', 'other cars keep their real name')
  } finally { s.identity!.realBranding = was }
  // the PINNED door, not just the mutated field: identityFor is where a
  // REAL[id].realBranding = false entry takes effect, so the test must go
  // through it (mutating s.identity directly let a broken spread order pass
  // this test blind, PR #21 r3)
  // the PINNED door, seeded BEFORE identityFor builds the object: mutating
  // the RETURNED copy proved nothing — a regression swallowing the pin
  // (the REAL[id] spread losing realBranding:false) still passed, PR #21 r4.
  // REAL rows are module state: seed, assert through the gate, restore.
  const REAL_R34 = REAL['r34']
  const pinWas = REAL_R34.realBranding
  try {
    REAL_R34.realBranding = false
    assert(identityFor('r34').realBranding === false, 'identityFor propagates a REAL-row pin (the pin beats the true default)')
    assert(brandingOn({ identity: identityFor('r34') }) === false, 'the ONE gate honours the pin — no real-name decal for a pinned car')
    assert(carDisplayName({ name: getSpec('r34').name, identity: identityFor('r34') }) === getSpec('r34').name, 'a pinned car shows its fictional name')
  } finally { REAL_R34.realBranding = pinWas }
  assert(brandingOn({ identity: undefined }) === false, 'no identity = no branding (both gates agree, the safe direction)')
  assert(typeof REAL.terzo.license === 'string' && REAL.terzo.license.includes('NC'), 'terzo carries the CC-BY-NC licence the per-car pin exists for')
})

test('catalog: getSpec falls back to hero for unknown ids', () => {
  assert(getSpec('nope') === HERO_SPEC && getSpec('s15').id === 's15', 'lookup + guard')
})

test('catalog: every shape lofts cleanly (browser-free geometry gate)', () => {
  for (const s of CAR_SPECS) validateCarShape(s.shape)
})

test('catalog: wheel spoke counts per style', () => {
  const t: Record<CarKit['wheelStyle'], number> = { 'five-spoke': 5, 'multi-spoke': 8, 'mesh': 12, 'teardrop': 6 }
  for (const k of Object.keys(t) as CarKit['wheelStyle'][]) assert(spokeCountForStyle(k) === t[k], k)
})

test('catalog: headless localStorage guard returns hero', () => {
  assert(readModelSelection() === 'r34', 'no storage in node — fallback, no throw')
})

/* ------------------------------------------------------- per-model finishes */

const FINISH_FIELDS = ['paint', 'clearcoat', 'flake', 'roughness', 'glassTint', 'carbon', 'accent'] as const
const FINISH_RANGES = ['clearcoat', 'flake', 'roughness', 'carbon'] as const

test('finishes: every spec ships a complete, finite, in-range finish record', () => {
  for (const s of CAR_SPECS) {
    for (const k of FINISH_FIELDS) {
      assert(Number.isFinite(s.finish[k]), `${s.id}.${k} must be a finite number`)
    }
    for (const k of FINISH_RANGES) {
      assert(s.finish[k] >= 0 && s.finish[k] <= 1, `${s.id}.${k} must sit in [0,1] — got ${s.finish[k]}`)
    }
  }
})

test('finishes: hero paint is byte-pinned to the shipped default PAINTS[1].color', () => {
  assert(HERO_SPEC.finish.paint === PAINTS[1].color,
    `hero paint ${HERO_SPEC.finish.paint.toString(16)} !== ${PAINTS[1].color.toString(16)} (never-touch path)`)
})

test('finishes: the six signature paints are pairwise distinct', () => {
  const sigs = CAR_SPECS.map((s) => s.finish.paint)
  assert(new Set(sigs).size === CAR_SPECS.length,
    `signatures must differ — got ${sigs.map((v) => v.toString(16)).join(', ')}`)
})

test('finishes: every signature is a member of the PAINTS palette', () => {
  const palette = new Set(PAINTS.map((p) => p.color))
  for (const s of CAR_SPECS) assert(palette.has(s.finish.paint), `${s.id} paint ${s.finish.paint.toString(16)} is off-palette`)
})

/* -------------------------------------------------------- paint precedence */

test('paint flow: an absent pick resolves to the model signature', () => {
  for (const s of CAR_SPECS) assert(resolvePaint(null, s) === s.finish.paint, `${s.id} falls through to the signature`)
})

test('paint flow: a stored swatch beats the signature across a model switch', () => {
  const stored = PAINTS[3].color
  const p930 = getSpec('930')
  const cen = getSpec('centenario')
  assert(resolvePaint(stored, p930) === stored, 'stored survives the 930 rebuild')
  assert(resolvePaint(stored, cen) === stored, 'stored survives switching to the Centenario')
  assert(resolvePaint(stored, p930) !== p930.finish.paint, 'and demonstrably overrides the signature')
})

test('paint flow: resolvePaint is pure — deterministic, storage-free, side-effect-free', () => {
  const spec = getSpec('s15')
  assert(resolvePaint(null, spec) === resolvePaint(null, spec), 'same inputs, same output')
  assert(resolvePaint(0x123456, spec) === 0x123456, 'echoes the stored hex untouched')
  assert(resolvePaint(null, spec) === spec.finish.paint, 'never mutates the spec')
})

test('paint flow: headless localStorage guard yields null (no pick)', () => {
  assert(readPaintSelection() === null, 'no storage in node — null, no throw')
})

import { CAR_SPECS as CS } from '../../src/vehicles/CarSpecs'

const stationFingerprint = (s: (typeof CS)[number]): string => {
  const b = s.shape.bodyStations
  return `${b[0].z.toFixed(3)}|${b[b.length - 1].z.toFixed(3)}|${Math.max(...b.map((v) => v.hw)).toFixed(3)}|${Math.min(...b.map((v) => v.ty)).toFixed(3)}`
}

test('shapes: the six fallback silhouettes reuse the four procedural bodies', () => {
  assert(new Set(CS.map(stationFingerprint)).size === 4, 'six cars, four distinct fallback bodies')
})

test('shapes: the Centenario is longer+lower, the 930 more compact, the S15 wider', () => {
  const L = (id: string) => { const s = CS.find((c) => c.id === id)!; const b = s.shape.bodyStations; return { len: b[b.length - 1].z - b[0].z, maxHw: Math.max(...b.map((v) => v.hw)), minTy: Math.min(...b.map((v) => v.ty)) } }
  const r34 = L('r34')
  assert(L('centenario').len > r34.len + 0.1, 'the Centenario body is longer')
  assert(L('centenario').minTy < r34.minTy, 'the Centenario body is lower')
  assert(L('930').len < r34.len - 0.05, 'the 930 body is more compact')
  assert(L('s15').maxHw > r34.maxHw + 0.02, 'the S15 body is wider')
})

test('builder: buildCar exposes the optional-paint signature resolved via the spec', async () => {
  const m = await import('../../src/assets/CarModel').catch(() => null)
  // node has no canvas, so buildCar itself runs only under the harness; the
  // node contract is the export shape plus the pure resolve wiring it leans on
  // (a no-arg buildCar can only be observed in-browser — this is the honest pin):
  assert(typeof m?.buildCar === 'function', 'builder export present')
  assert(m?.buildCar != null && typeof m.buildCar === 'function' && m.buildCar.length === 0,
    'paintHex is defaulted, so the arity pin is 0 — callers passing a hex still work')
  assert(typeof resolvePaint === 'function' && resolvePaint(null, HERO_SPEC) === HERO_SPEC.finish.paint,
    'the module resolve helper is exported and pure — it is what a no-arg buildCar would use')
})

test('kit: the hero kit reproduces the shipped part set exactly', () => {
  // data-level pin: hero kit toggles match the mesh blocks that exist today
  const k = HERO_SPEC.kit
  assert(k.splitter === 'std' && k.spoiler === 'low' && k.diffuserFins === 4, 'front/aero/rear on')
  assert(k.hoodVent && k.sideIntakes && !k.roofScoop, 'greebles on, scoop off')
})

test('ai: slot model assignment follows the config table', () => {
  const r = rig()
  for (let slot = 0; slot < CAR.aiModels.length; slot++) {
    const ai = new AIVehicle(slot, r.spline, r.probe)
    assert(ai.spec.id === CAR.aiModels[slot], `slot ${slot} drives ${CAR.aiModels[slot]}`)
  }
})

test('ai: the brain pace-caps against its own car\'s top speed (driven targetSpeed)', () => {
  const r = rig()
  const hyper = new AIVehicle(1, r.spline, r.probe) // 'centenario' (1.12×) per the table
  assertNear(hyper.tuning.topSpeed, VEHICLE.topSpeed * 1.12, 1e-6, 'hyper tuning wired to the car')
  assert(hyper.phys.tuning === hyper.tuning, 'the physics runs the AI car\'s record')
  // R2-7: the REAL brain update() drives the rig spline with the rubber-band
  // pinned to its ceiling — on a straight the curvature target saturates and
  // only the cap in AIVehicle.update can hold the speed target down. A brain
  // capped at the BASE VEHICLE.topSpeed can never read above 0.985×base
  // (the clamp's ceiling); the hyper cap reads clearly above it. The nitro
  // policy is starved (tank pinned to 0) so the measured cap is always the
  // dry topSpeed, never the nitro ceiling.
  hyper.resetTo(r.spline.sFromX(30), 0, 12)
  const ctx = { locked: false, leaderProgress: 1, progress: 0 }
  const rivals = [hyper]
  const snap0 = hyper.snapshot()
  const band = Math.min(AI.rubberBandMax, 1 + AI.rubberK)
  let maxTarget = 0
  for (let i = 0; i < 1200; i++) {
    hyper.nitroVal = 0
    hyper.update(1 / 120, ctx, rivals)
    if (hyper.phys.speed > 20) maxTarget = Math.max(maxTarget, hyper.targetSpeed)
  }
  assert(maxTarget > VEHICLE.topSpeed * 1.0,
    `driven targetSpeed reached ${maxTarget.toFixed(1)} — a base-capped brain tops at ${(VEHICLE.topSpeed * 0.985).toFixed(1)}, so this must clear ${VEHICLE.topSpeed.toFixed(1)} to prove the hyper (1.12×) cap is live`)
  assert(maxTarget <= hyper.tuning.topSpeed * 0.985 + 1e-9,
    `and never past its own spec ceiling (got ${maxTarget.toFixed(1)}, want <= ${(hyper.tuning.topSpeed * 0.985).toFixed(1)})`)
  const pinned = snap0.pace * band * hyper.tuning.topSpeed * 0.985
  assert(maxTarget > Math.min(pinned, hyper.tuning.topSpeed * 0.985) * 0.98,
    `converges toward the spec cap through pace x band x 0.985 (expected ~${Math.min(pinned, hyper.tuning.topSpeed * 0.985).toFixed(1)}, got ${maxTarget.toFixed(1)})`)
})

test('garage: stat bars normalize across the catalog to [0,1] on every axis', () => {
  assert(STAT_AXIS_LABELS.length === 5, 'top speed / acceleration / grip / drift / brake')
  for (const s of CAR_SPECS) {
    const bars = statBarsFor(s, CAR_SPECS)
    assert(bars.length === 5 && bars.every((b) => b >= 0 && b <= 1), `${s.id} in range`)
  }
})

test('garage: the spread reads — extremes take the rails on their axis', () => {
  const top = CAR_SPECS.map((s) => statBarsFor(s, CAR_SPECS)[0])
  assert(Math.max(...top) - Math.min(...top) > 0.8, 'top-speed axis spans near the full bar')
  const fastest = CAR_SPECS[top.indexOf(Math.max(...top))]
  const slowest = CAR_SPECS[top.indexOf(Math.min(...top))]
  assert(slowest.id === '930', 'the 930 is the slowest — the bias is real')
  assert(fastest.id === 'terzo', 'the Terzo takes the top-speed rail')
})

test('garage: bars are index-aligned with the labels — DRIFT is the drift mean, BRAKE is brake', () => {
  const drift = STAT_AXIS_LABELS.indexOf('DRIFT')
  const brake = STAT_AXIS_LABELS.indexOf('BRAKE')
  const bars = (id: string) => statBarsFor(getSpec(id), CAR_SPECS)
  // the drift-biased spec owns the DRIFT axis; the brake-biased spec owns BRAKE
  assert(bars('s15')[drift] > bars('930')[drift], 'the S15 out-slides the 930 on the drift bar')
  const brakeAxis = CAR_SPECS.map((s) => statBarsFor(s, CAR_SPECS)[brake])
  assert(bars('930')[brake] === Math.max(...brakeAxis), 'the 930 takes the brake rail')
  assert(bars('s15')[brake] < bars('930')[brake], 'the drift bar is not the brake bar wearing its label')
})

/* PR review F2a — MAIN MENU abandons the race: the director must return
 * to idle so the garage cards unlock and the AI field sleeps until the next
 * beginRace. */

import { RaceDirector } from '../../src/game/RaceDirector'

test('director: abandon() returns a live race to idle (MAIN MENU garage unlock)', () => {
  const r = rig()
  const d = new RaceDirector([{ id: 0, phys: new VehiclePhysics(new FlatProbe(), 7) }], r.spline.length)
  d.start()
  assert(d.phase === 'countdown', 'start enters the countdown')
  ;(d as unknown as { abandon?: () => void }).abandon?.()
  assert(d.phase === 'idle', `abandon() must reset the phase — got ${d.phase}`)
  assert(!d.fieldActive(), 'the field sleeps again until the next beginRace')
})

/* F6 — the spec §7 approved stat table, pinned as literals. yawResponse for
 * hyper was never written into the catalog, so this fails until it lands. */
const APPROVED_STATS: Record<string, Record<string, number>> = {
  r34: { topSpeed: 1.0, nitroTopSpeed: 1.0, engineAccel: 1.0, gripMax: 1.0, gripDrift: 1.0, driftYawBoost: 1.0, yawResponse: 1.0, brakeForce: 1.0, drag: 1.0 },
  centenario: { topSpeed: 1.12, nitroTopSpeed: 1.1, engineAccel: 1.02, gripMax: 0.9, gripDrift: 1.05, driftYawBoost: 1.0, yawResponse: 0.95, brakeForce: 1.0, drag: 0.92 },
  '930': { topSpeed: 0.9, nitroTopSpeed: 0.9, engineAccel: 1.0, gripMax: 1.12, gripDrift: 1.1, driftYawBoost: 1.0, yawResponse: 1.08, brakeForce: 1.08, drag: 1.0 },
  s15: { topSpeed: 0.96, nitroTopSpeed: 0.96, engineAccel: 1.0, gripMax: 0.94, gripDrift: 0.88, driftYawBoost: 1.3, yawResponse: 1.2, brakeForce: 1.0, drag: 1.0 },
  terzo: { topSpeed: 1.2, nitroTopSpeed: 1.14, engineAccel: 1.12, gripMax: 1.05, gripDrift: 1.05, driftYawBoost: 0.9, yawResponse: 1.0, brakeForce: 1.0, drag: 0.88 },
  carrera: { topSpeed: 1.02, nitroTopSpeed: 1.03, engineAccel: 1.06, gripMax: 1.04, gripDrift: 0.98, driftYawBoost: 1.0, yawResponse: 1.02, brakeForce: 1.04, drag: 1.0 },
}

test('catalog: the approved §7 stat table lands literally on all six models', () => {
  for (const [id, table] of Object.entries(APPROVED_STATS)) {
    assert(Object.keys(APPROVED_STATS).length === CAR_SPECS.length, 'the table covers the whole catalog')
    const t = resolveTuning(getSpec(id).stat)
    for (const [field, mul] of Object.entries(table)) {
      const base = VEHICLE[field as keyof typeof VEHICLE]
      assert(typeof base === 'number', `${field} is a tuning field`)
      assertNear(t[field as keyof typeof t], base * mul, 1e-9, `${id}.${field} (${mul}×)`)
    }
  }
})

/* F3 — the headlight cluster must anchor to the model's own front station,
 * the way the tail bar anchors to lastStation. Hero keeps the shipped z/y
 * byte-identically; hyper/grip lamps move onto their own noses. */
test('lamps: frontLampAnchors derives the cluster from the model front station', async () => {
  const mod = await import('../../src/assets/CarModel').catch(() => null)
  const anchors = mod?.frontLampAnchors as unknown as
    ((st: { z: number; ty: number }) => { lensZ: number; lampY: number; intakeCenterZ: number }) | undefined
  assert(typeof anchors === 'function', 'frontLampAnchors is exported from CarModel')
  const hero = anchors!(HERO_SPEC.shape.bodyStations[0])
  assertNear(hero.lensZ, -2.268, 1e-9, 'hero lens keeps the shipped z')
  assertNear(hero.lampY, 0.66, 1e-9, 'hero lamp height stays 0.66')
  assertNear(hero.intakeCenterZ, -2.29, 1e-9, 'the centre intake keeps the shipped z')
  for (const id of ['centenario', '930'] as const) {
    const st = getSpec(id).shape.bodyStations[0]
    const a = anchors!(st)
    assert(Math.abs(a.lensZ - st.z) < 0.04, `${id} lens sits flush at its own nose (${a.lensZ.toFixed(3)} vs station ${st.z})`)
    assert(a.lampY <= st.ty && a.lampY > st.ty - 0.1, `${id} lamps tuck under its own crown (${a.lampY} vs ty ${st.ty})`)
  }
})

import * as carSpecs from '../../src/vehicles/CarSpecs'

/* F7 — vr.paint validation + vr.model unknown-id fallback. */
const fakeStore = (values: Record<string, string>): void => {
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string): string | null => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null),
    setItem: (k: string, v: string): void => { values[k] = v },
    removeItem: (k: string): void => { delete values[k] },
  }
}
const dropStore = (): void => { delete (globalThis as Record<string, unknown>).localStorage }

test('paint storage: readPaintSelection accepts only palette hexes', () => {
  try {
    fakeStore({ 'vr.paint': '' })
    assert(carSpecs.readPaintSelection() === null, 'the empty string is not a colour (Number("")===0 trap)')
    fakeStore({ 'vr.paint': 'garbage' })
    assert(carSpecs.readPaintSelection() === null, 'garbage is rejected')
    fakeStore({ 'vr.paint': '123456' })
    assert(carSpecs.readPaintSelection() === null, 'numeric but off-palette is rejected — no black off-catalog car')
    fakeStore({ 'vr.paint': String(PAINTS[2].color) })
    assert(carSpecs.readPaintSelection() === PAINTS[2].color, 'a palette hex round-trips')
  } finally { dropStore() }
})

test('garage: readModelSelection falls back to hero for an unknown stored id', () => {
  try {
    fakeStore({ 'vr.model': 'not-a-car' })
    assert(carSpecs.readModelSelection() === 'r34', 'unknown stored ids fall back, never throw')
    fakeStore({ 'vr.model': '930' })
    assert(carSpecs.readModelSelection() === '930', 'known ids round-trip')
  } finally { dropStore() }
})

/* F8 — the pure core of the explicit-pick retention: a stored read wins; with
 * nothing stored an explicit in-memory pick survives; with neither the
 * signature owns the car. */
test('paint flow: resolvePaintWithExplicit keeps an in-memory pick through a storage loss', () => {
  const spec = getSpec('centenario')
  const pick = carSpecs.resolvePaintWithExplicit as unknown as
    ((stored: number | null, explicit: boolean, inMemory: number, s: typeof spec) => number) | undefined
  assert(typeof pick === 'function', 'resolvePaintWithExplicit is exported')
  const stored = PAINTS[0].color
  assert(pick!(stored, false, spec.finish.paint, spec) === stored, 'a stored read still wins')
  assert(pick!(null, true, stored, spec) === stored, 'an explicit pick survives a swallowed write (private mode)')
  assert(pick!(null, false, stored, spec) === spec.finish.paint, 'without an explicit pick the signature owns the car')
})

/* F5 — the AI repaint seam needs a pure palette allocator. */
test('paint pool: nextUnusedPaletteColor hands out a colour nobody wears', () => {
  const pick = carSpecs.nextUnusedPaletteColor as unknown as ((used: ReadonlySet<number>) => number | null) | undefined
  assert(typeof pick === 'function', 'nextUnusedPaletteColor is exported')
  const used = new Set<number>(PAINTS.slice(0, PAINTS.length - 1).map((p) => p.color))
  const got = pick!(used)
  assert(got !== null && !used.has(got), 'the one free palette colour is returned')
  assert(pick!(new Set(PAINTS.map((p) => p.color))) === null, 'a fully-used palette reports null, never a duplicate')
})

/* R2-4 — the ONE reconcile core behind every colour mutation (boot pool,
 * onPaint, selectModel). Fed onPaint-path values (the live field + the picked
 * colour), no AI slot may keep the player's colour, and the plan never
 * duplicates a field colour. */
test('ai colours: reconcileAiColours leaves no slot wearing the player colour', () => {
  const palette = PAINTS.map((p) => p.color)
  assert(typeof carSpecs.reconcileAiColours === 'function', 'reconcileAiColours is exported')
  for (const playerHex of palette) {
    const field = palette.slice(0, 5) // a boot-style field (slot order)
    const plan = carSpecs.reconcileAiColours(field, playerHex, palette)
    assert(plan.length === field.length, 'one plan entry per slot, order preserved')
    assert(plan.every((c) => c !== playerHex), `no AI hex equals player ${playerHex.toString(16)} — got ${plan.map((c) => c.toString(16)).join(', ')}`)
    assert(new Set(plan).size === plan.length, `the plan never duplicates a field colour (player ${playerHex.toString(16)})`)
    assert(plan.every((c) => palette.includes(c)), 'every planned colour is a palette member')
  }
  // untouched slots keep their colours (a repaint plan moves ONLY the collision)
  const field = [palette[0], palette[2], palette[3], palette[4], palette[5]]
  const plan = carSpecs.reconcileAiColours(field, palette[1], palette)
  assert(plan.join(',') === field.join(','), 'no collision — the plan is a verbatim copy')
})

/* R3-2(i) — exhaustion policy: when the palette cannot resolve a collision,
 * the core must be deterministic (the slot KEEPS its current colour — never a
 * wrap-around, never undefined flowing into buildCar/setPaint) rather than
 * silently leaving the field shared. */
test('ai colours: an exhausted pool keeps the colliding slot colour deterministically', () => {
  const a = 0x111111, b = 0x222222, c = 0x333333
  const palette = [a, b, c]
  // every colour worn, player collides — nothing free to repaint with
  const full = reconcileAiColours([a, b, c], b, palette)
  assert(full[1] === b, 'the colliding slot keeps its current colour when the palette is exhausted')
  assert(full[0] === a && full[2] === c, 'non-colliding slots are untouched by the exhaustion path')
  // partial exhaustion: the first collision resolves, the second finds none left
  const partial = reconcileAiColours([c, a, a], a, palette)
  assert(partial[0] === c && partial[1] === b, 'earlier collisions take the free colours first')
  assert(partial[2] === a, 'the unresolvable collision keeps its colour (never undefined)')
})

/* R3-2(ii) — the boot pool COUPLES to config: the Game constructor seeds the
 * field with palette.slice(0, AI.count) and expects reconcileAiColours to be
 * able to resolve any player collision. If AI.count ever reached
 * PAINTS.length the pool would exhaust, slots would keep the player's colour
 * (silent sharing) and undefined hexes could reach buildCar/aiPaintHex.
 * This invariant pins whatever the boot path actually assumes. */
test('ai colours: boot-pool invariant — AI.count stays below the palette size', () => {
  assert(AI.count < PAINTS.length, `boot needs a free palette colour for collision resolution — AI.count=${AI.count} must stay < PAINTS.length=${PAINTS.length}`)
  assert(CAR.aiModels.length <= PAINTS.length, 'every AI slot can wear a distinct palette colour')
  // the boot-shape call itself (Game.ts:135) must resolve for EVERY player colour
  const palette = PAINTS.map((p) => p.color)
  const bootField = palette.slice(0, AI.count)
  for (const playerHex of palette) {
    const plan = reconcileAiColours(bootField, playerHex, palette)
    assert(plan.every((n) => Number.isInteger(n)), `boot plan carries only palette ints (player ${playerHex.toString(16)})`)
    assert(plan.every((n) => n !== playerHex), `boot-field collision against ${playerHex.toString(16)} resolves`)
  }
})

/* R2-5 — precedence: an in-memory explicit pick beats a stale-but-readable
 * stored value (the Safari-private-mode scenario F8 targeted); storage stays
 * the boot seed when nothing was picked this session. */
test('paint flow: an explicit in-session pick outranks a stale stored value', () => {
  const spec = getSpec('930')
  const stale = PAINTS[0].color
  const gold = PAINTS[5].color
  assert(resolvePaintWithExplicit(stale, true, gold, spec) === gold,
    'explicit pick (gold) wins over a readable-but-stored old colour — storage is boot-seed only')
  assert(resolvePaintWithExplicit(PAINTS[1].color, false, gold, spec) === PAINTS[1].color,
    'with no explicit pick this session the stored seed still owns the car')
  assert(resolvePaintWithExplicit(null, false, gold, spec) === spec.finish.paint,
    'with neither, the model signature wins')
})
