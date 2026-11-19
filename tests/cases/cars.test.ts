import { assert, assertNear, test } from '../harness'
import { VEHICLE, CAR, PAINTS } from '../../src/config'
import { AIVehicle } from '../../src/vehicles/AIVehicle'
import { BASE_TUNING, resolveTuning, type CarStat } from '../../src/vehicles/CarTuning'
import { CAR_SPECS, HERO_SPEC, getSpec, spokeCountForStyle, readModelSelection, readPaintSelection, resolvePaint, type CarKit } from '../../src/vehicles/CarSpecs'
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

test('catalog: the four models exist in order', () => {
  assert(CAR_SPECS.map((s) => s.id).join(',') === 'hero,hyper,grip,drift', 'catalog order')
  assert(CAR_SPECS.every((s) => s.name.length > 0 && s.class.length > 0), 'every model is named and classed')
})

test('catalog: hero is today\'s car — stations verbatim and stats resolved base', () => {
  const t = resolveTuning(HERO_SPEC.stat)
  for (const k of Object.keys(VEHICLE) as (keyof typeof VEHICLE)[]) assert(t[k] === BASE_TUNING[k], String(k))
  assert(HERO_SPEC.kit.spoiler === 'low' && HERO_SPEC.kit.splitter === 'std', 'hero kit matches the shipped look')
  assert(HERO_SPEC.kit.wheelRadiusMul === 1 && HERO_SPEC.kit.trackMul === 1, 'hero geometry is base')
})

test('catalog: getSpec falls back to hero for unknown ids', () => {
  assert(getSpec('nope') === HERO_SPEC && getSpec('drift').id === 'drift', 'lookup + guard')
})

test('catalog: every shape lofts cleanly (browser-free geometry gate)', () => {
  for (const s of CAR_SPECS) validateCarShape(s.shape)
})

test('catalog: wheel spoke counts per style', () => {
  const t: Record<CarKit['wheelStyle'], number> = { 'five-spoke': 5, 'multi-spoke': 8, 'mesh': 12, 'teardrop': 6 }
  for (const k of Object.keys(t) as CarKit['wheelStyle'][]) assert(spokeCountForStyle(k) === t[k], k)
})

test('catalog: headless localStorage guard returns hero', () => {
  assert(readModelSelection() === 'hero', 'no storage in node — fallback, no throw')
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

test('finishes: the four signature paints are pairwise distinct', () => {
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
  const grip = getSpec('grip')
  const hyper = getSpec('hyper')
  assert(resolvePaint(stored, grip) === stored, 'stored survives the grip rebuild')
  assert(resolvePaint(stored, hyper) === stored, 'stored survives switching to hyper')
  assert(resolvePaint(stored, grip) !== grip.finish.paint, 'and demonstrably overrides the signature')
})

test('paint flow: resolvePaint is pure — deterministic, storage-free, side-effect-free', () => {
  const spec = getSpec('drift')
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

test('shapes: all four silhouettes are distinct', () => {
  assert(new Set(CS.map(stationFingerprint)).size === 4, 'each model lofts a different body')
})

test('shapes: hyper is longer+lower, grip more compact, drift wider', () => {
  const L = (id: string) => { const s = CS.find((c) => c.id === id)!; const b = s.shape.bodyStations; return { len: b[b.length - 1].z - b[0].z, maxHw: Math.max(...b.map((v) => v.hw)), minTy: Math.min(...b.map((v) => v.ty)) } }
  const hero = L('hero')
  assert(L('hyper').len > hero.len + 0.1, 'hyper is longer')
  assert(L('hyper').minTy < hero.minTy, 'hyper is lower')
  assert(L('grip').len < hero.len - 0.05, 'grip is more compact')
  assert(L('drift').maxHw > hero.maxHw + 0.02, 'drift is wider')
})

test('builder: buildCar exposes the optional-paint signature resolved via the spec', async () => {
  const m = await import('../../src/assets/CarModel').catch(() => null)
  // node has no canvas, so buildCar itself runs only under the harness; the
  // node contract is the export shape plus the pure resolve wiring it leans on
  // (a no-arg buildCar can only be observed in-browser — this is the honest pin):
  assert(typeof m?.buildCar === 'function', 'builder export present')
  assert(m.buildCar.length === 0, 'paintHex is defaulted, so the arity pin is 0 — callers passing a hex still work')
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

test('ai: the brain pace-caps against its own car\'s top speed', () => {
  const r = rig()
  const hyper = new AIVehicle(1, r.spline, r.probe) // 'hyper' per the table
  assertNear(hyper.tuning.topSpeed, VEHICLE.topSpeed * 1.12, 1e-6, 'hyper tuning wired to the car')
  assert(hyper.phys.tuning === hyper.tuning, 'the physics runs the AI car\'s record')
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
  const slowest = CAR_SPECS[top.indexOf(Math.min(...top))]
  assert(slowest.id === 'grip', 'grip is the slowest — the bias is real')
})

test('garage: bars are index-aligned with the labels — DRIFT is the drift mean, BRAKE is brake', () => {
  const drift = STAT_AXIS_LABELS.indexOf('DRIFT')
  const brake = STAT_AXIS_LABELS.indexOf('BRAKE')
  const bars = (id: string) => statBarsFor(getSpec(id), CAR_SPECS)
  // the drift-biased spec owns the DRIFT axis; the brake-biased spec owns BRAKE
  assert(bars('drift')[drift] > bars('grip')[drift], 'slide king out-slides the corner-gripper on the drift bar')
  const brakeAxis = CAR_SPECS.map((s) => statBarsFor(s, CAR_SPECS)[brake])
  assert(bars('grip')[brake] === Math.max(...brakeAxis), 'apex grip takes the brake rail')
  assert(bars('drift')[brake] < bars('grip')[brake], 'the drift bar is not the brake bar wearing its label')
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
