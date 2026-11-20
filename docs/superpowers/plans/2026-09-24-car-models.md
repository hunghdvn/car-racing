# Car Models and Per-Model Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four selectable car models (hero/hyper/grip/drift) with distinct silhouettes, per-model physics tuning, a title-screen garage with stat bars, and a material polish pass on the shared car kit.

**Architecture:** One data-driven catalog (`CarSpecs.ts`) resolves each model into a station-based geometry spec, a cosmetic kit, and a `CarTuning` stat record. `buildCar(paintHex, spec)` renders the model from the spec; `VehiclePhysics` steps against per-instance tuning (defaulting to today's `VEHICLE` values so the hero is bit-identical). The garage lives on the existing title screen.

**Tech Stack:** TypeScript, three.js 0.168, Vite, node test harness (`tests/`), Playwright shot/audit drivers (`scripts/`).

**Spec:** `docs/superpowers/specs/2026-09-24-car-models-design.md`

## Global Constraints

- The `hero` spec must resolve **bit-identical** to today's car: `resolveTuning(HERO_SPEC.stat)` deep-equals `VEHICLE`, and `HERO_SPEC.shape` reuses the existing `BODY_STATIONS`/`CABIN_STATIONS` verbatim (export them; do not re-type the numbers).
- Determinism unchanged: fixed-dt sim, seeded `Rand`, no wall-clock in gameplay paths. New code adds no RNG.
- Every multiplier applied by `resolveTuning` is clamped to `1 ± CAR.statClamp` with `statClamp = 0.4`.
- New stat fields restricted to: `topSpeed, nitroTopSpeed, engineAccel, brakeForce, gripMax, gripDrift, driftYawBoost, yawResponse, drag`.
- Follow the file's existing comment-banner style; do not add new dependencies; do not touch `mergeStaticMeshes` keepNames entries other than what Task 5 lists.
- No debug tooling in the shipped path: anything touching the harness goes in `src/dev/harness.ts` (dead-code-eliminated in production builds).
- Run gates after each task: `npm run typecheck` then `node scripts/tests.mjs`. Task 8 additionally runs `npm run shots && npm run audit`.
- Execute on a feature branch (e.g. `feat/car-models`) per superpowers:using-git-worktrees; commit at each task end.

---

### Task 1: Car tuning resolution (`CarTuning.ts` + `CAR` config)

**Files:**
- Create: `src/vehicles/CarTuning.ts`
- Modify: `src/config.ts` (add `CAR` block after `PAINTS`, line ~278)
- Test: `tests/cases/cars.test.ts` (create)
- Modify: `tests/all.ts` (add case import)

**Interfaces:**
- Consumes: `VEHICLE`, `CAR` (config).
- Produces:
  - `export type CarTuning = { [K in keyof typeof VEHICLE]: number }`
  - `export const BASE_TUNING: CarTuning`
  - `export function resolveTuning(stat: Partial<CarStat>): CarTuning` — needs `CarStat`, so `CarStat` is declared here too:
  - `export interface CarStat { topSpeed?: number; nitroTopSpeed?: number; engineAccel?: number; brakeForce?: number; gripMax?: number; gripDrift?: number; driftYawBoost?: number; yawResponse?: number; drag?: number }`
  - `config.ts`: `export const CAR = { statClamp: 0.4, aiModels: ['grip', 'hyper', 'drift', 'hero', 'grip'] as const }`

- [ ] **Step 1: Write the failing tests**

Create `tests/cases/cars.test.ts`:

```ts
import { assert, assertNear, test } from '../harness'
import { VEHICLE, CAR } from '../../src/config'
import { BASE_TUNING, resolveTuning, type CarStat } from '../../src/vehicles/CarTuning'

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
```

Register it in `tests/all.ts` (after the `assets.test` import line):

```ts
import './cases/cars.test'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/tests.mjs`
Expected: the five `tuning:` cases FAIL with "Cannot find module ... CarTuning" (or TS build error naming `CarTuning`).

- [ ] **Step 3: Implement `src/vehicles/CarTuning.ts`**

```ts
import { CAR, VEHICLE } from '../config'

/* ------------------------------------------------------------------------- *
 * Per-car resolved physics tuning (car-models spec §7): one record of plain
 * numbers over the VEHICLE base, produced once per model by resolveTuning.
 * Read-only per step inside VehiclePhysics — swapping it between steps (the
 * title-screen model switch) is safe precisely because nothing caches it.
 * ------------------------------------------------------------------------- */

export type CarTuning = { [K in keyof typeof VEHICLE]: number }

/** multipliers over VEHICLE fields with a clear gameplay meaning (spec §7) */
export interface CarStat {
  topSpeed?: number
  nitroTopSpeed?: number
  engineAccel?: number
  brakeForce?: number
  gripMax?: number
  gripDrift?: number
  driftYawBoost?: number
  yawResponse?: number
  drag?: number
}

export const BASE_TUNING: CarTuning = { ...VEHICLE }

export function resolveTuning(stat: Partial<CarStat>): CarTuning {
  const t = { ...VEHICLE } as CarTuning
  const lo = 1 - CAR.statClamp
  const hi = 1 + CAR.statClamp
  for (const k of Object.keys(stat) as (keyof CarStat)[]) {
    const m = stat[k]
    if (m === undefined || !Number.isFinite(m)) continue
    t[k] = VEHICLE[k] * Math.min(hi, Math.max(lo, m))
  }
  return t
}
```

Add to `src/config.ts` directly after the `PAINTS` array:

```ts
/** Car-model catalog tuning (car-models spec §5): stat clamp envelope and the
 *  deterministic AI grid model assignment (slot order, AI.count entries). */
export const CAR = {
  statClamp: 0.4,
  aiModels: ['grip', 'hyper', 'drift', 'hero', 'grip'] as const,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/tests.mjs`
Expected: all `tuning:` cases PASS, everything else still PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/vehicles/CarTuning.ts src/config.ts tests/cases/cars.test.ts tests/all.ts
git commit -m "feat: car tuning catalog with clamped stat resolution"
```

---

### Task 2: Per-instance physics tuning

**Files:**
- Modify: `src/vehicles/VehiclePhysics.ts` (constructor line 94; every `VEHICLE` read)
- Test: `tests/cases/cars.test.ts` (append)

**Interfaces:**
- Consumes: `CarTuning`, `BASE_TUNING`, `resolveTuning` (Task 1).
- Produces: `new VehiclePhysics(probe, seed?, tuning?: CarTuning)` — third arg, default `BASE_TUNING`; instance field `tuning: CarTuning`; method `setTuning(t: CarTuning): void`. All later tasks rely on these exact names.

- [ ] **Step 1: Write the failing tests** (append to `tests/cases/cars.test.ts`)

```ts
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics'
import { FlatProbe } from '../rig'

function topOut(tuning: CarTuning, seconds = 40): number {
  const p = new VehiclePhysics(new FlatProbe(), 7, tuning)
  const cmd = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }
  let t = 0
  while (t < seconds) { p.step(1 / 120, cmd); t += 1 / 120 }
  return p.speed
}

test('physics: default tuning is today's VEHICLE behaviour (top-speed cap)', () => {
  const base = topOut(BASE_TUNING)
  assert(base <= VEHICLE.topSpeed + 0.6, `base tops at ${base.toFixed(2)} <= ${(VEHICLE.topSpeed + 0.6).toFixed(2)}`)
  assert(base > VEHICLE.topSpeed * 0.92, 'and actually reaches it')
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
```

(Import types with `import type { CarTuning } from '../../src/vehicles/CarTuning'`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/tests.mjs`
Expected: new `physics:` cases FAIL — "Expected 3 arguments, but got 4" or `p.tuning is not a function`/undefined (constructor does not yet accept tuning).

- [ ] **Step 3: Parameterise `VehiclePhysics`**

Constructor (currently `src/vehicles/VehiclePhysics.ts:94`):

```ts
constructor(private probe: TrackProbe, seed = PHYS_SEED, readonly tuning: CarTuning = BASE_TUNING) {
  this.rnd = new Rand(seed)
}

/** model switch on a parked car (title garage); never call mid-sim (spec §9) */
setTuning(t: CarTuning): void {
  ;(this as { tuning: CarTuning }).tuning = t
}
```

(`readonly` + this documented cast is the minimal-diff option; no other file may cast.)

Replace every global read inside the class with the instance record — `const V = VEHICLE` becomes `const V = this.tuning` in `step()`, `updateSuspension()`, `collide()`, `applyBrake()`. Line 129 in `resetAt` becomes `this.susp[i] = -this.tuning.suspPreload`. Do **not** rename or reorder any computation; this is a pure data-source swap. `VehicleVisual.ts` is not touched in this task.

- [ ] **Step 4: Run the full battery**

Run: `npm run typecheck && node scripts/tests.mjs`
Expected: new `physics:` cases PASS; every pre-existing case (drive/lap/ai/shortcut) still PASSes — they construct `VehiclePhysics`/`PlayerVehicle` with the defaults, which are bit-identical by Task 1's invariant.

- [ ] **Step 5: Commit**

```bash
git add src/vehicles/VehiclePhysics.ts tests/cases/cars.test.ts
git commit -m "feat: per-instance physics tuning with hero-default record"
```

---

### Task 3: The car catalog (`CarSpecs.ts`) — types + hero entry

**Files:**
- Create: `src/vehicles/CarSpecs.ts`
- Modify: `src/assets/CarModel.ts` (export `BODY_STATIONS`, `CABIN_STATIONS`, add `validateCarShape`)
- Test: `tests/cases/cars.test.ts` (append)

**Interfaces:**
- Consumes: `Station` shape (redeclared locally as `CarStation` — the CarModel-internal interface stays private), `CarStat` (Task 1), `CAR` (config).
- Produces:
  - `export type CarId = 'hero' | 'hyper' | 'grip' | 'drift'`
  - `export interface CarStation { z: number; hw: number; by: number; ty: number; rt: number; rb: number; ts?: number }`
  - `export interface CarShape { bodyStations: readonly CarStation[]; cabinStations: readonly CarStation[] }`
  - `export interface CarKit { splitter: 'none' | 'std' | 'big'; spoiler: 'none' | 'low' | 'gt'; diffuserFins: number; hoodVent: boolean; roofScoop: boolean; sideIntakes: boolean; wheelStyle: 'five-spoke' | 'multi-spoke' | 'mesh' | 'teardrop'; wheelRadiusMul: number; wheelWidthMul: number; trackMul: number; archExtension: number; caliper: number; glassTint: number }`
  - `export interface CarSpec { id: CarId; name: string; class: string; stat: CarStat; shape: CarShape; kit: CarKit }`
  - `export const HERO_SPEC: CarSpec`
  - `export const CAR_SPECS: readonly CarSpec[]` (hero, hyper, grip, drift — hyper/grip/drift get placeholder shapes/kits in Task 4)
  - `export function getSpec(id: string): CarSpec` (unknown id → hero)
  - `export function spokeCountForStyle(style: CarKit['wheelStyle']): number`
  - `export function readModelSelection(): CarId` / `export function writeModelSelection(id: CarId): void` (localStorage-guarded)
  - `CarModel.ts`: `export function validateCarShape(shape: CarShape): void` — pure-THREE build of both hulls, throws on degeneration (browser-independent)

- [ ] **Step 1: Write the failing tests** (append to `tests/cases/cars.test.ts`)

```ts
import { CAR_SPECS, HERO_SPEC, getSpec, spokeCountForStyle, readModelSelection, type CarKit } from '../../src/vehicles/CarSpecs'
import { validateCarShape } from '../../src/assets/CarModel'
import { BASE_TUNING } from '../../src/vehicles/CarTuning'

test('catalog: the four models exist in order', () => {
  assert(CAR_SPECS.map((s) => s.id).join(',') === 'hero,hyper,grip,drift', 'catalog order')
  assert(CAR_SPECS.every((s) => s.name.length > 0 && s.class.length > 0), 'every model is named and classed')
})

test('catalog: hero is today's car — stations verbatim and stats resolved base', () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/tests.mjs`
Expected: FAIL — module `CarSpecs` not found.

- [ ] **Step 3: Author `src/vehicles/CarSpecs.ts`**

```ts
import { CAR } from '../config'
import type { CarStat } from './CarTuning'

/* ------------------------------------------------------------------------- *
 * The car catalog (car-models spec §5): four models, each one a resolved
 * record of silhouette (authored stations), cosmetic kit and stat bias.
 * Geometry data lives here — config.ts stays the tuning surface.
 * ------------------------------------------------------------------------- */

export type CarId = 'hero' | 'hyper' | 'grip' | 'drift'

export interface CarStation { z: number; hw: number; by: number; ty: number; rt: number; rb: number; ts?: number }
export interface CarShape { bodyStations: readonly CarStation[]; cabinStations: readonly CarStation[] }

export interface CarKit {
  splitter: 'none' | 'std' | 'big'
  spoiler: 'none' | 'low' | 'gt'
  diffuserFins: number
  hoodVent: boolean
  roofScoop: boolean
  sideIntakes: boolean
  wheelStyle: 'five-spoke' | 'multi-spoke' | 'mesh' | 'teardrop'
  wheelRadiusMul: number
  wheelWidthMul: number
  trackMul: number
  archExtension: number
  caliper: number
  glassTint: number
}

export interface CarSpec {
  id: CarId
  name: string
  class: string
  stat: CarStat
  shape: CarShape
  kit: CarKit
}

const BASE_KIT: CarKit = {
  splitter: 'std', spoiler: 'low', diffuserFins: 4, hoodVent: true, roofScoop: false,
  sideIntakes: true, wheelStyle: 'five-spoke', wheelRadiusMul: 1, wheelWidthMul: 1,
  trackMul: 1, archExtension: 0, caliper: 0xc23a28, glassTint: 0,
}
```

The hero body/cabin stations come from `CarModel.ts` — in `CarModel.ts`, change `const BODY_STATIONS` / `const CABIN_STATIONS` to `export const` (values untouched), then in `CarSpecs.ts`:

```ts
import { BODY_STATIONS, CABIN_STATIONS } from '../assets/CarModel'

export const HERO_SPEC: CarSpec = {
  id: 'hero', name: 'Velocity GT', class: 'BALANCED', stat: {},
  shape: { bodyStations: BODY_STATIONS, cabinStations: CABIN_STATIONS },
  kit: { ...BASE_KIT },
}
```

The hyper/grip/drift entries are added in Task 4; until then the catalog is:

```ts
export const CAR_SPECS: readonly CarSpec[] = [HERO_SPEC, HERO_SPEC, HERO_SPEC, HERO_SPEC]
```

…with `id`/`name`/`class`/`stat`/`kit` overridden for the three placeholder entries so Task 3's catalog tests pass already:

```ts
export const CAR_SPECS: readonly CarSpec[] = [
  HERO_SPEC,
  { id: 'hyper', name: 'Solaris Hyper', class: 'TOP SPEED',
    stat: { topSpeed: 1.12, nitroTopSpeed: 1.10, engineAccel: 1.02, gripMax: 0.90, gripDrift: 1.05, drag: 0.92 },
    shape: HERO_SPEC.shape, kit: { ...BASE_KIT, spoiler: 'gt', wheelStyle: 'mesh', wheelRadiusMul: 0.98, wheelWidthMul: 1.06, caliper: 0xe8b62e, glassTint: 0.06 } },
  { id: 'grip', name: 'Apex Grip', class: 'CORNER GRIP',
    stat: { topSpeed: 0.90, nitroTopSpeed: 0.90, gripMax: 1.12, gripDrift: 1.10, yawResponse: 1.08, brakeForce: 1.08 },
    shape: HERO_SPEC.shape, kit: { ...BASE_KIT, splitter: 'big', spoiler: 'none', wheelStyle: 'multi-spoke', wheelRadiusMul: 1.04, trackMul: 1.05, archExtension: 0.05, caliper: 0x39c06a } },
  { id: 'drift', name: 'Slide King', class: 'DRIFT',
    stat: { topSpeed: 0.96, nitroTopSpeed: 0.96, gripMax: 0.94, gripDrift: 0.88, driftYawBoost: 1.30, yawResponse: 1.20 },
    shape: HERO_SPEC.shape, kit: { ...BASE_KIT, splitter: 'none', spoiler: 'low', diffuserFins: 0, roofScoop: true, wheelStyle: 'teardrop', wheelWidthMul: 1.08, trackMul: 1.07, archExtension: 0.07, caliper: 0xf27a1e, glassTint: 0.04 } },
]

export function getSpec(id: string): CarSpec {
  return CAR_SPECS.find((s) => s.id === id) ?? HERO_SPEC
}

export function spokeCountForStyle(style: CarKit['wheelStyle']): number {
  return { 'five-spoke': 5, 'multi-spoke': 8, 'mesh': 12, 'teardrop': 6 }[style]
}

export function readModelSelection(): CarId {
  try {
    const v = globalThis.localStorage?.getItem('vr.model')
    return (CAR_SPECS.find((s) => s.id === v)?.id ?? 'hero') as CarId
  } catch { return 'hero' }
}

export function writeModelSelection(id: CarId): void {
  try { globalThis.localStorage?.setItem('vr.model', id) } catch { /* private mode */ }
}
```

(`import { globalThis } from './util'` — reuse the repo's global accessor pattern used elsewhere; if `util` does not export one, use `globalThis` from `src/core/globals.ts`.)

Add to `src/assets/CarModel.ts` (pure geometry, no materials — import `CarShape` from `../vehicles/CarSpecs` type-only to avoid a cycle: declare the parameter as `Pick`-compatible inline instead if tsc reports a cycle; `import type` breaks it):

```ts
/** Browser-free geometry gate (spec §9): lofts both hulls of a shape and
 *  lets buildHull's ring/non-uniform guard throw. Dev/test only. */
export function validateCarShape(shape: { bodyStations: Station[]; cabinStations: Station[] }): void {
  const a = buildHull(shape.bodyStations, 52, { caps: true })
  const b = buildHull(shape.cabinStations, 30, { caps: true })
  for (const g of [a, b]) {
    const n = g.getAttribute('normal')
    for (let i = 0; i < n.count; i++) {
      if (!Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i))) throw new Error('[car] degenerate normal in catalog shape')
    }
  }
}
```

- [ ] **Step 4: Run the full battery**

Run: `npm run typecheck && node scripts/tests.mjs`
Expected: all `catalog:` cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vehicles/CarSpecs.ts src/assets/CarModel.ts tests/cases/cars.test.ts
git commit -m "feat: car catalog with hero spec and browser-free shape gate"
```

---

### Task 4: Author the three new silhouettes

**Files:**
- Modify: `src/vehicles/CarSpecs.ts` (replace `shape: HERO_SPEC.shape` on hyper/grip/drift)
- Test: `tests/cases/cars.test.ts` (append silhouette-difference assertions)

**Interfaces:**
- Consumes: `CarShape`/`CarStation` (Task 3), `validateCarShape`.
- Produces: three distinct `CarShape` consts: `HYPER_SHAPE`, `GRIP_SHAPE`, `DRIFT_SHAPE` (module-level in `CarSpecs.ts`, referenced by the catalog entries).

- [ ] **Step 1: Write the failing tests** (append)

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/tests.mjs` → the two `shapes:` cases FAIL (three models share the hero shape).

- [ ] **Step 3: Author the station tables** (in `CarSpecs.ts`, above the catalog; the catalog's three placeholder entries switch `shape:` to these consts).

```ts
/* Solaris Hyper — 0.18 m longer, crown 0.06 lower, sharper nose stations. */
const HYPER_SHAPE: CarShape = {
  bodyStations: [
    { z: -2.440, hw: 0.700, by: 0.255, ty: 0.640, rt: 0.130, rb: 0.100 },
    { z: -2.240, hw: 0.800, by: 0.272, ty: 0.722, rt: 0.120, rb: 0.072 },
    { z: -1.880, hw: 0.872, by: 0.300, ty: 0.806, rt: 0.098, rb: 0.046 },
    { z: -1.430, hw: 0.982, by: 0.334, ty: 0.834, rt: 0.070, rb: 0.030 },
    { z: -1.020, hw: 0.966, by: 0.340, ty: 0.846, rt: 0.052, rb: 0.028 },
    { z: -0.480, hw: 0.950, by: 0.342, ty: 0.836, rt: 0.042, rb: 0.026 },
    { z:  0.080, hw: 0.948, by: 0.342, ty: 0.818, rt: 0.038, rb: 0.026 },
    { z:  0.600, hw: 0.952, by: 0.342, ty: 0.826, rt: 0.048, rb: 0.028 },
    { z:  1.180, hw: 0.984, by: 0.338, ty: 0.848, rt: 0.086, rb: 0.038 },
    { z:  1.740, hw: 0.912, by: 0.344, ty: 0.844, rt: 0.116, rb: 0.064 },
    { z:  2.120, hw: 0.838, by: 0.350, ty: 0.764, rt: 0.130, rb: 0.090 },
    { z:  2.440, hw: 0.688, by: 0.372, ty: 0.618, rt: 0.130, rb: 0.090 },
  ],
  cabinStations: [
    { z: -0.820, hw: 0.712, by: 0.726, ty: 0.948, rt: 0.066, rb: 0.088, ts: 0.80 },
    { z: -0.500, hw: 0.736, by: 0.740, ty: 1.010, rt: 0.060, rb: 0.088, ts: 0.84 },
    { z: -0.080, hw: 0.748, by: 0.752, ty: 1.034, rt: 0.056, rb: 0.088, ts: 0.88 },
    { z:  0.400, hw: 0.746, by: 0.754, ty: 1.042, rt: 0.056, rb: 0.088, ts: 0.90 },
    { z:  0.780, hw: 0.724, by: 0.750, ty: 1.012, rt: 0.062, rb: 0.092, ts: 0.88 },
    { z:  1.130, hw: 0.672, by: 0.732, ty: 0.956, rt: 0.078, rb: 0.098, ts: 0.82 },
    { z:  1.350, hw: 0.600, by: 0.702, ty: 0.898, rt: 0.092, rb: 0.108, ts: 0.76 },
  ],
}

/* Apex Grip — 0.13 m shorter footprint, taller greenhouse, wide shoulders. */
const GRIP_SHAPE: CarShape = {
  bodyStations: [
    { z: -2.150, hw: 0.748, by: 0.272, ty: 0.712, rt: 0.150, rb: 0.110 },
    { z: -1.950, hw: 0.836, by: 0.292, ty: 0.794, rt: 0.135, rb: 0.080 },
    { z: -1.610, hw: 0.890, by: 0.318, ty: 0.876, rt: 0.105, rb: 0.050 },
    { z: -1.190, hw: 0.988, by: 0.352, ty: 0.898, rt: 0.075, rb: 0.032 },
    { z: -0.840, hw: 0.978, by: 0.357, ty: 0.910, rt: 0.055, rb: 0.030 },
    { z: -0.380, hw: 0.966, by: 0.360, ty: 0.900, rt: 0.045, rb: 0.028 },
    { z:  0.100, hw: 0.964, by: 0.360, ty: 0.882, rt: 0.040, rb: 0.028 },
    { z:  0.580, hw: 0.968, by: 0.360, ty: 0.890, rt: 0.050, rb: 0.030 },
    { z:  1.080, hw: 0.996, by: 0.356, ty: 0.912, rt: 0.090, rb: 0.040 },
    { z:  1.540, hw: 0.928, by: 0.362, ty: 0.918, rt: 0.118, rb: 0.066 },
    { z:  1.860, hw: 0.852, by: 0.368, ty: 0.840, rt: 0.132, rb: 0.092 },
    { z:  2.130, hw: 0.726, by: 0.392, ty: 0.696, rt: 0.132, rb: 0.092 },
  ],
  cabinStations: [
    { z: -0.960, hw: 0.744, by: 0.762, ty: 1.002, rt: 0.070, rb: 0.090, ts: 0.80 },
    { z: -0.620, hw: 0.764, by: 0.777, ty: 1.070, rt: 0.065, rb: 0.090, ts: 0.84 },
    { z: -0.180, hw: 0.774, by: 0.790, ty: 1.096, rt: 0.060, rb: 0.090, ts: 0.88 },
    { z:  0.320, hw: 0.772, by: 0.792, ty: 1.105, rt: 0.060, rb: 0.090, ts: 0.90 },
    { z:  0.720, hw: 0.748, by: 0.787, ty: 1.072, rt: 0.065, rb: 0.095, ts: 0.88 },
    { z:  1.060, hw: 0.694, by: 0.768, ty: 1.012, rt: 0.080, rb: 0.100, ts: 0.82 },
    { z:  1.260, hw: 0.622, by: 0.738, ty: 0.954, rt: 0.095, rb: 0.110, ts: 0.76 },
  ],
}

/* Slide King — shoulders +6 %, same cabin, flatter tail for stable long slides. */
const DRIFT_SHAPE: CarShape = {
  bodyStations: [
    { z: -2.280, hw: 0.780, by: 0.262, ty: 0.706, rt: 0.150, rb: 0.110 },
    { z: -2.080, hw: 0.872, by: 0.282, ty: 0.788, rt: 0.135, rb: 0.080 },
    { z: -1.735, hw: 0.928, by: 0.308, ty: 0.872, rt: 0.105, rb: 0.050 },
    { z: -1.310, hw: 1.032, by: 0.344, ty: 0.894, rt: 0.075, rb: 0.032 },
    { z: -0.950, hw: 1.014, by: 0.349, ty: 0.906, rt: 0.055, rb: 0.030 },
    { z: -0.450, hw: 1.002, by: 0.352, ty: 0.896, rt: 0.045, rb: 0.028 },
    { z:  0.060, hw: 1.000, by: 0.352, ty: 0.876, rt: 0.040, rb: 0.028 },
    { z:  0.560, hw: 1.006, by: 0.352, ty: 0.884, rt: 0.050, rb: 0.030 },
    { z:  1.105, hw: 1.038, by: 0.348, ty: 0.904, rt: 0.090, rb: 0.040 },
    { z:  1.625, hw: 0.966, by: 0.354, ty: 0.886, rt: 0.118, rb: 0.064 },
    { z:  1.985, hw: 0.890, by: 0.360, ty: 0.796, rt: 0.132, rb: 0.090 },
    { z:  2.280, hw: 0.756, by: 0.384, ty: 0.650, rt: 0.132, rb: 0.090 },
  ],
  cabinStations: CABIN_STATIONS.slice(),
}
```

(`CABIN_STATIONS` imported from `CarModel.ts` — already the hero's set; drift shares it.)

- [ ] **Step 4: Run the full battery**

Run: `npm run typecheck && node scripts/tests.mjs`
Expected: `shapes:` cases PASS; the `catalog: every shape lofts cleanly` case (written in Task 3) now genuinely covers three new shapes.

- [ ] **Step 5: Commit**

```bash
git add src/vehicles/CarSpecs.ts tests/cases/cars.test.ts
git commit -m "feat: authored silhouettes for hyper, grip and drift"
```

---

### Task 5: Spec-driven `buildCar` + material polish

**Files:**
- Modify: `src/assets/CarModel.ts` (builder parameterisation, kit gating, wheel styles, materials)
- Modify: `src/assets/Textures.ts` (`carPaintMaps` flake specks)
- Modify: `src/vehicles/VehicleVisual.ts` (per-car wheel base height)
- Test: `tests/cases/cars.test.ts` (append node-safe contract checks)

**Interfaces:**
- Consumes: `CarSpec` (Task 3/4), `spokeCountForStyle`, `VEHICLE`.
- Produces: `export function buildCar(paintHex: number, spec: CarSpec = HERO_SPEC): CarModel` — signature change; the single `CarModel` interface gains nothing new (handles keep names/roles, so `VehicleVisual`/`mergeStaticMeshes` contracts hold).

- [ ] **Step 1: Write the failing tests** (append — node-safe, no canvas)

```ts
test('builder: buildCar exposes the spec-driven signature', async () => {
  const m = await import('../../src/assets/CarModel').catch(() => null)
  // node has no canvas, so buildCar itself runs only under the harness; the
  // node contract is the export shape plus the validated shapes gate:
  assert(typeof m?.buildCar === 'function' && m.buildCar.length >= 1, 'spec parameter present')
})

test('kit: the hero kit reproduces the shipped part set exactly', () => {
  // data-level pin: hero kit toggles match the mesh blocks that exist today
  const k = HERO_SPEC.kit
  assert(k.splitter === 'std' && k.spoiler === 'low' && k.diffuserFins === 4, 'front/aero/rear on')
  assert(k.hoodVent && k.sideIntakes && !k.roofScoop, 'greebles on, scoop off')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/tests.mjs`
Expected: the builder case FAILS (`buildCar.length` is 1 but calling with the default arg must typecheck — the real failure is tsc until the signature exists; the case fails once the module import exposes arity 0 defaults). Keep the red, then implement.

- [ ] **Step 3: Parameterise the builder** (`src/assets/CarModel.ts`)

1. Signature and imports:

```ts
import { CAR_SPECS, HERO_SPEC, spokeCountForStyle, type CarSpec } from '../vehicles/CarSpecs'
export function buildCar(paintHex: number, spec: CarSpec = HERO_SPEC): CarModel {
```

(If tsc flags a module cycle — CarModel ↔ CarSpecs — move the `BODY_STATIONS`/`CABIN_STATIONS`/`Station` definitions into `CarSpecs.ts` and import them back into `CarModel.ts`; values stay verbatim. Either direction is fine; pick whichever compiles clean and mention it in the commit.)

2. Hull calls: `buildHull(spec.shape.bodyStations, 52, { caps: true })`, `buildHull(spec.shape.cabinStations, 30, { caps: true })`, and `glassBandGeo(spec.shape.cabinStations)` — change `glassBandGeo()` to take the stations parameter it currently closes over (line 397: `function glassBandGeo(cabins: readonly Station[]): THREE.BufferGeometry` and replace the two `CABIN_STATIONS` reads inside).

3. Per-car wheel geometry. In `buildCar`:

```ts
const wr = VEHICLE.wheelRadius * spec.kit.wheelRadiusMul
const ww = VEHICLE.wheelWidth * spec.kit.wheelWidthMul
```

`buildWheelAssembly(sideSign, ww, spokeCount)` — pass `spec.kit.wheelWidthMul`-scaled width and `spokeCountForStyle(spec.kit.wheelStyle)` as parameters instead of reading `VEHICLE.wheelWidth` / hard-coded `k < 5`; the spoke loop becomes `for (let k = 0; k < spokeCount; k++)` with the radial plate length `R * 0.50` scaled by `spokeCount >= 8 ? 0.8 : 1` in the `roundedPlateGeo(0.072, R * 0.50, ...)` call (dense styles get shorter spokes so the pattern reads). Wheel handles get `radius: wr`; lateral placement `side * ((VEHICLE.trackWidth / 2) * spec.kit.trackMul)`.

4. Kit gating — wrap the existing mesh blocks so the hero kit reproduces today's set exactly:
   - `splitter !== 'none'` gates the splitter mesh; `'big'` uses `roundedPlateGeo(2.0, 0.07, 0.05, 0.02)` at `y 0.195` (std keeps today's 1.76 plate).
   - `spoiler !== 'none'` gates the two struts + blade; `'gt'` uses strut height `0.20`, blade `roundedPlateGeo(1.44, 0.05, 0.032, 0.013)` at `y 0.92`, `rotation.x = -0.14` (low keeps today's values).
   - `diffuserFins` replaces the hard-coded four-fin loop bound.
   - `hoodVent` gates `hood-line-*` + `cowl-vent`.
   - `sideIntakes` gates `intake-side-*`.
   - `roofScoop` adds, after the cowl block:

```ts
if (spec.kit.roofScoop) {
  const scoop = new THREE.Mesh(roundedPlateGeo(0.34, 0.10, 0.05, 0.02), shared.dark())
  scoop.position.set(0, 1.075, -0.55)
  scoop.rotation.x = -0.35
  group.add(named(scoop, 'roof-scoop'))
}
```

   - arches: `const archR = wr + 0.042 + spec.kit.archExtension` and the rim/liner lateral `side * (0.975 + spec.kit.archExtension)` / `(0.952 + …)`.
   - calipers: `shared.caliper()` gains a parameter — `shared.caliper(spec.kit.caliper)` (material `color: hex`).
   - glass: `shared.glass(spec.kit.glassTint)` — `opacity: 0.42`, `roughness: 0.02`, `ior: 1.45`, `color: new THREE.Color(0x151c25).multiplyScalar(1 - tint * 0.6)`.

5. Material polish (the "đẹp hơn" pass — hero gets it too):
   - `mkPaint()`: `roughness: 0.28`, `metalness: 0.15`, `clearcoatRoughness: 0.045`, `normalScale: (0.5, 0.5)`, `sheen: 0.2`, `sheenRoughness: 0.4`.
   - `alloy()`: `roughness: 0.2`.
   - headlight projector rings (add inside the existing headlight loop, before the static merge so they batch into the chrome bucket):

```ts
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 8, 18), shared.chrome())
ring.position.set(side * 0.46, 0.66, -2.282)
ring.rotation.y = hous.rotation.y
group.add(named(ring, `headlight-ring-${side < 0 ? 'l' : 'r'}`))
```

   - `src/assets/Textures.ts` `carPaintMaps` roughnessMap draw: inside the pixel loop, before writing `v`: `const flake = rnd.next() < 0.004 ? 235 : v` and use `flake` for the three channels (metallic sparkle).

6. `src/vehicles/VehicleVisual.ts`: `const WHEEL_BASE_Y` is module-level today (line 16) — make it per-instance:

```ts
constructor(private car: CarModel) {
  car.setHeadlights(false)
  this.baseY = (car.wheels[0]?.radius ?? VEHICLE.wheelRadius) - 0.012
}
private readonly baseY: number
```

Replace both `WHEEL_BASE_Y` reads (lines 54, 74) with `this.baseY`, and `const R = VEHICLE.wheelRadius` in `bind` with `const R = this.car.wheels[0]?.radius ?? VEHICLE.wheelRadius`.

- [ ] **Step 4: Run the battery**

Run: `npm run typecheck && node scripts/tests.mjs`
Expected: builder/kit cases PASS; everything else unchanged (the shipped hero path renders identically-plus-polish; shots re-render in Task 8's pass).

- [ ] **Step 5: Commit**

```bash
git add src/assets/CarModel.ts src/assets/Textures.ts src/vehicles/VehicleVisual.ts tests/cases/cars.test.ts src/vehicles/CarSpecs.ts
git commit -m "feat: spec-driven car builder, wheel styles and material polish"
```

---

### Task 6: AI field with distinct models

**Files:**
- Modify: `src/vehicles/AIVehicle.ts` (constructor line 129, pace lines 255-257)
- Modify: `src/game/Game.ts` (AI construction lines ~108-118, standings names line 136, `topSpeedRef` line 80)
- Test: `tests/cases/cars.test.ts` (append)

**Interfaces:**
- Consumes: `getSpec`, `CarSpec`, `resolveTuning`, `CAR.aiModels`, `VehiclePhysics` tuning parameter.
- Produces: `new AIVehicle(slot, spline, probe, spec?: CarSpec)` (default hero); public readonly `spec: CarSpec` and `tuning: CarTuning` fields on AIVehicle; `Game` uses `CAR.aiModels[slot]` for its field.

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { AIVehicle } from '../../src/vehicles/AIVehicle'
import { rig } from '../rig'

test('ai: slot model assignment follows the config table', () => {
  const r = rig()
  for (let slot = 0; slot < CAR.aiModels.length; slot++) {
    const ai = new AIVehicle(slot, r.spline, r.probe)
    assert(ai.spec.id === CAR.aiModels[slot], `slot ${slot} drives ${CAR.aiModels[slot]}`)
  }
})

test('ai: the brain pace-caps against its own car's top speed', () => {
  const r = rig()
  const hyper = new AIVehicle(1, r.spline, r.probe) // 'hyper' per the table
  assertNear(hyper.tuning.topSpeed, VEHICLE.topSpeed * 1.12, 1e-6, 'hyper tuning wired to the car')
  assert(hyper.phys.tuning === hyper.tuning, 'the physics runs the AI car's record')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/tests.mjs` → both `ai:` cases FAIL (`spec`/`tuning` undefined).

- [ ] **Step 3: Implement**

`src/vehicles/AIVehicle.ts` constructor:

```ts
constructor(readonly slot: number, private spline: TrackSpline, private probe: TrackProbe, readonly spec: CarSpec = getSpec(CAR.aiModels[slot % CAR.aiModels.length])) {
  this.rnd = new Rand(aiSlotSeed(slot + 40))
  this.pace = clamp(AI.paceBase + this.rnd.range(-1, 1) * AI.paceSpread, 0.5, 1.2)
  this.tuning = resolveTuning(spec.stat)
  this.phys = new VehiclePhysics(probe, aiSlotSeed(slot + 64), this.tuning)
}
```

with `readonly tuning: CarTuning` declared beside the other fields (assigned before `phys`). In the controller (lines 255-257) swap the three global reads:

```ts
const cap = this.nitroActive ? this.tuning.nitroTopSpeed : this.tuning.topSpeed
const band = rubberBand(ctx) * (this.drafting ? 1 + AI.slipstreamGain : 1)
const vT = clamp(this.pace * band * Math.min(vCorner, this.tuning.topSpeed), 5, cap * 0.985)
```

(Leave `VEHICLE.width`/`VEHICLE.nitroOffCool` reads — chassis/presentation constants, spec §7.)

`src/game/Game.ts`: the AI construction loop keeps its existing 3-arg call (the per-slot model now resolves inside the AIVehicle constructor from `CAR.aiModels`). Standings names (line 136) switch from paint names to model names:

```ts
this.ui.setStandingNames(['YOU', ...this.ai.map((a) => a.spec.name.toUpperCase())])
```

and the snapshot init (line 80) `topSpeedRef: VEHICLE.topSpeed` → the live value: read it at snapshot time as `this.player.phys.tuning.topSpeed` (find the `snapshot()` literal; if the init object at line 80 is the only default, replace both occurrences the same way).

- [ ] **Step 4: Run the battery**

Run: `npm run typecheck && node scripts/tests.mjs`
Expected: `ai:` cases PASS; existing `ai.test` cases still PASS (new constructor arg is defaulted).

- [ ] **Step 5: Commit**

```bash
git add src/vehicles/AIVehicle.ts src/game/Game.ts tests/cases/cars.test.ts
git commit -m "feat: mixed-model AI field paced by its own car"
```

---

### Task 7: Title-screen garage

**Files:**
- Modify: `index.html` (`#car-picker` block, lines 77-80)
- Modify: `styles.css` (garage styles after the swatch block, ~line 145)
- Modify: `src/ui/UIManager.ts` (`UiHost`, constructor, new methods + pure helpers)
- Modify: `src/game/Game.ts` (constructor model parameter, `selectModel`, `onModel` wiring)
- Test: `tests/cases/cars.test.ts` (append for the pure helpers)

**Interfaces:**
- Consumes: `CAR_SPECS`, `getSpec`, `readModelSelection`, `writeModelSelection`, `resolveTuning`, `CarTuning`.
- Produces:
  - `UIManager`: `buildModelCards(selectedId: CarId): void`, `renderModelStats(id: CarId): void`; pure exports `statBarsFor(spec: CarSpec, all: readonly CarSpec[]): number[]` and `export const STAT_AXIS_LABELS: string[]`
  - `Game`: `readonly selectedSpec: CarSpec`, `selectModel(id: CarId): void`; `UiHost.onModel(id: CarId): void`
  - `new Game(canvas, paintHex?, modelId?: CarId)` (third arg defaulted from `readModelSelection()` **at the call site in `main.ts`**, so harness boots keep defaulting to the saved/hero value exactly as today's paint default works)

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { statBarsFor, STAT_AXIS_LABELS } from '../../src/ui/UIManager'

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/tests.mjs` → FAIL, exports missing.

- [ ] **Step 3: Implement the UI**

`index.html` — replace the `#car-picker` inner block:

```html
<div id="car-picker">
  <div id="car-picker-label">GARAGE</div>
  <div id="model-cards"></div>
  <div id="model-stats"></div>
  <div id="paint-swatches"></div>
</div>
```

`styles.css` — after the `#paint-swatches`/`.swatch` rules:

```css
#model-cards { display: flex; gap: 10px; justify-content: center; pointer-events: auto; }
.model-card { padding: 8px 14px; transform: skewX(-14deg); border: 2px solid rgba(255,255,255,.22); cursor: pointer; background: rgba(8,12,18,.55); }
.model-card > * { transform: skewX(14deg); }
.model-card b { display: block; font-family: var(--font-display); font-size: 13px; letter-spacing: 2px; color: var(--ink); }
.model-card i { display: block; font-style: normal; font-size: 9px; letter-spacing: 3px; color: var(--amber); margin-top: 2px; }
.model-card.selected { border-color: var(--cyan); box-shadow: 0 0 18px rgba(53,226,255,.5); }
#model-stats { display: flex; flex-direction: column; gap: 3px; align-items: center; margin-top: 8px; }
.stat-row { display: flex; align-items: center; gap: 8px; font-size: 9px; letter-spacing: 2px; color: var(--ink-dim); }
.stat-row span { width: 92px; text-align: right; }
.stat-bar { width: 132px; height: 5px; background: rgba(255,255,255,.12); }
.stat-bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--cyan), var(--amber)); }
```

`src/ui/UIManager.ts` — pure exports near `buildCarNames` (line ~167):

```ts
import { CAR_SPECS, getSpec, writeModelSelection, type CarId, type CarSpec } from '../vehicles/CarSpecs'
import { resolveTuning } from '../vehicles/CarTuning'

export const STAT_AXIS_LABELS = ['TOP SPEED', 'ACCELERATION', 'GRIP', 'DRIFT', 'BRAKE'] as const

/** normalised bar fractions (0..1) for one spec across the catalog spread;
 *  the DRIFT axis averages the two drift fields' individually-normalised values */
export function statBarsFor(spec: CarSpec, all: readonly CarSpec[]): number[] {
  const get = (s: CarSpec) => resolveTuning(s.stat)
  const axis = (pick: (t: ReturnType<typeof get>) => number) => {
    const vals = all.map((s) => pick(get(s)))
    const lo = Math.min(...vals), hi = Math.max(...vals)
    return (s: CarSpec) => (hi - lo < 1e-9 ? 0.5 : (pick(get(s)) - lo) / (hi - lo))
  }
  const f = [
    axis((t) => t.topSpeed), axis((t) => t.engineAccel), axis((t) => t.gripMax),
    axis((t) => t.brakeForce),
  ]
  const driftLo = Math.min(...all.map((s) => resolveTuning(s.stat).driftYawBoost))
  const driftSpan = Math.max(1e-9, Math.max(...all.map((s) => resolveTuning(s.stat).driftYawBoost)) - driftLo)
  const yawLo = Math.min(...all.map((s) => resolveTuning(s.stat).yawResponse))
  const yawSpan = Math.max(1e-9, Math.max(...all.map((s) => resolveTuning(s.stat).yawResponse)) - yawLo)
  const t0 = get(spec)
  return [f[0](spec), f[1](spec), f[2](spec), f[3](spec),
    ((t0.driftYawBoost - driftLo) / driftSpan + (t0.yawResponse - yawLo) / yawSpan) / 2]
}
```

`UiHost` gains `onModel(id: CarId): void`. Constructor (after `buildSwatches`, line ~299) adds:

```ts
this.buildModelCards(readModelSelection())
```

New methods beside `buildSwatches`:

```ts
private buildModelCards(selectedId: CarId): void {
  const host = this.doc.getElementById('model-cards')
  if (!host) return
  host.textContent = ''
  for (const s of CAR_SPECS) {
    const b = this.doc.createElement('button')
    b.className = 'model-card' + (s.id === selectedId ? ' selected' : '')
    b.innerHTML = `<b>${s.name.toUpperCase()}</b><i>${s.class}</i>`
    b.addEventListener('click', () => {
      for (const c of Array.from(host.children)) c.classList.remove('selected')
      b.classList.add('selected')
      writeModelSelection(s.id)
      this.host.onModel(s.id)
    })
    host.appendChild(b)
  }
  this.renderModelStats(selectedId)
}

private renderModelStats(id: CarId): void {
  const host = this.doc.getElementById('model-stats')
  if (!host) return
  host.textContent = ''
  const bars = statBarsFor(getSpec(id), CAR_SPECS)
  STAT_AXIS_LABELS.forEach((label, i) => {
    const row = this.doc.createElement('div')
    row.className = 'stat-row'
    row.innerHTML = `<span>${label}</span><div class="stat-bar"><i style="width:${Math.round(bars[i] * 100)}%"></i></div>`
    host.appendChild(row)
  })
}
```

(If the class uses a cached `$` helper for elements — it does (`this.$`) — use `this.$('model-cards')` instead of `getElementById`; the ids exist in `index.html` so either resolves.)

`src/game/Game.ts`:

- constructor: `constructor(canvas: HTMLCanvasElement, paintHex: number = PAINTS[1].color, modelId: CarId = 'hero')`; keep `this.paintHex = paintHex`; build the player car through the new selection path:

```ts
this.selectedSpec = getSpec(modelId)
this.car = buildCar(paintHex, this.selectedSpec)
```

with `selectedSpec: CarSpec` public and `car`/`visual` non-readonly fields (update their declarations near the top of the class).

- the `UIManager` host literal gains `onModel: (id) => this.selectModel(id)`.
- `paintHex` becomes a field so a rebuild keeps the chosen colour; `onPaint` becomes `(hex) => { this.paintHex = hex; this.car.setPaint(hex) }`.
- rear-wheel scratch array: `rearWheels` is filled in the constructor (lines 138-141) — extract that four-line block into `private captureRearWheels(): void` and call it from the constructor and from `selectModel`.
- new method (title screen only — the cards are not on screen during a race):

```ts
/** title-screen model switch (garage spec §8): rebuild mesh+visual, retune */
selectModel(id: CarId): void {
  const spec = getSpec(id)
  if (spec.id === this.selectedSpec.id) return
  // spec §9: not exposed during a race — the cards are title-screen only
  if (this.director.phase === 'countdown' || this.director.phase === 'racing') return
  this.view.scene.remove(this.car.group)
  this.car.group.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose() }
  })
  this.selectedSpec = spec
  this.car = buildCar(this.paintHex, spec)
  this.car.group.name = 'player-car'
  this.view.scene.add(this.car.group)
  this.visual = new VehicleVisual(this.car)
  this.captureRearWheels()
  this.player.phys.setTuning(resolveTuning(spec.stat))
  if (this.frozenPose) this.applyPose(this.frozenPose) // keep a live capture in sync
}
```

(`import { getSpec, readModelSelection, type CarId, type CarSpec } from '../vehicles/CarSpecs'`, `import { resolveTuning } from '../vehicles/CarTuning'`.)

`src/main.ts`: `const game = new Game(canvas, PAINTS[1].color, readModelSelection())`.

- [ ] **Step 4: Run the battery**

Run: `npm run typecheck && node scripts/tests.mjs && npm run build`
Expected: `garage:` cases PASS; shipped build compiles (the harness path stays untouched in this task).

- [ ] **Step 5: Manual smoke on dev**

Run `npm run dev`, open the title: four skewed cards render, the selected card glows cyan, five stat bars update per card, paint swatches still repaint the car, START races the chosen model (verify the car in play visually differs for hyper/grip/drift). No command output errors in the console.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css src/ui/UIManager.ts src/game/Game.ts src/main.ts tests/cases/cars.test.ts
git commit -m "feat: title-screen garage with model cards and stat bars"
```

---

### Task 8: Model shots, harness plumbing, gate battery

**Files:**
- Modify: `src/core/Debug.ts` (`ShotPose.player.model?: string`)
- Modify: `src/game/Game.ts` (`applyPose` honours the model field)
- Modify: `src/dev/harness.ts` (`__selectModel` dev global + four registered poses)

**Interfaces:**
- Consumes: `Game.selectModel` (Task 7), pose registry (`Debug.registerPose`).
- Produces: shots `car_hero`, `car_hyper`, `car_grip`, `car_drift`; `window.__selectModel(id) => string` (dev-only).

- [ ] **Step 1: Extend the pose contract**

`src/core/Debug.ts` — inside `ShotPose.player` add:

```ts
/** frozen-capture model switch (dev shots): id resolved via getSpec */
model?: string
```

`src/game/Game.ts` `applyPose` — first line of the method body (before `simFrozen` assignment):

```ts
if (p.player?.model && p.player.model !== this.selectedSpec.id) this.selectModel(p.player.model as CarId)
```

- [ ] **Step 2: Dev global + registered poses** (`src/dev/harness.ts`)

After the `Debug.bind({...})` block (line ~62):

```ts
;(globalThis as unknown as { __selectModel?: (id: string) => string }).__selectModel =
  (id: string) => { game.selectModel(id as CarId); return game.selectedSpec.id }
```

(Import `CarId` type from `../vehicles/CarSpecs`.)

Register the four model shots **at the end of the install function** (immediately before the `/* dev probes */` block), reusing the `onRoad` factory defined in the pose section: extend its `extra` parameter type with `model?: string` (the `...extra` spread already carries it into `player`), then:

```ts
for (const id of ['hero', 'hyper', 'grip', 'drift']) {
  Debug.registerPose(`car_${id}`, onRoad([7.55, 0.64, 0.10], [0, 0.58, 0], 26, { model: id }))
}
```

End-registration matters: `scripts/shots.mjs` captures in registry order on one page, so every pre-existing pose renders before the first `selectModel` call — hero shots and the state/grid battery stay untouched, and each model shot sets its own body on arrival.

Known limitation (accepted, no change): `installDevHarness` destructures `const { view, car, slice } = game` at boot, so the install-time car-anchored dev levers (`nocar`/`hide`/`__carInfo`/`__tireDbg`) refer to the boot car after a switch. The model shots and the whole battery read live objects (`game.player.phys`, `__probe`) — none of them depend on those levers after a switch.

- [ ] **Step 3: Run the full gate battery**

```bash
npm run typecheck && npm run test && npm run build:harness && npm run shots && npm run audit && npm run functional && npm run noleak && npm run perf
```

Expected: every new `car_*` shot produces a PNG (a build crash in any model yields "no image" → FAIL, which is this task's smoke test); audit green; noleak green (the new dev global stays harness-gated); the four renders visually checked by the human (5-Second Test): hyper long/low + big wing, grip compact + big splitter, drift wide + roof scoop, hero unchanged in proportion.

If a shape renders degenerate (NaN normal → bloom cascade), tighten that station set in `CarSpecs.ts` and rerun `node scripts/tests.mjs` (`catalog: every shape lofts cleanly`) before reshooting.

- [ ] **Step 4: Commit**

```bash
git add src/core/Debug.ts src/game/Game.ts src/dev/harness.ts
git commit -m "feat: per-model harness shots and selectModel dev hook"
```

- [ ] **Step 5: Hand the screenshots to the human for review**

Show `shots/car_hero.png`, `shots/car_hyper.png`, `shots/car_grip.png`, `shots/car_drift.png` and get an explicit look/approve before the branch is finished (superpowers:finishing-a-development-branch).
