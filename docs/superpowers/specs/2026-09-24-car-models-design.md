# Car models and per-model stats design

Date: 2026-09-24

Status: approved design, pending implementation

## 1. Problem and goal

The game ships exactly one car. All six cars on the grid (player plus five AI) are
`buildCar(paintHex)` with different paint, and all of them share the global `VEHICLE`
tuning block, so they drive identically. Players have no way to pick a car that suits
their style, and the shared visual language makes the field read as clones.

This design adds:

- four car models with distinct silhouettes and cosmetic kits;
- per-model stat profiles (top speed / acceleration / grip / drift / brake) with a
  moderate spread (~±10–12%);
- a garage on the title screen to choose model and paint, with visible stat bars;
- a material/detail polish pass on the shared car kit (all models benefit).

The default selection remains the current hero car with its current geometry and
stats, so every existing deterministic test and visual gate keeps passing unchanged.

## 2. Scope

- a data-driven car catalog (`CAR_SPECS`) with per-model stat multipliers, authored
  body/cabin station sets, and cosmetic kit toggles;
- parameterised `buildCar(paintHex, spec)`;
- per-instance `CarTuning` consumed by `VehiclePhysics` (defaulting to today's
  `VEHICLE` values);
- title-screen garage UI: model cards, stat bars, persisted selection;
- AI field assigned mixed models deterministically;
- material refinement of the shared kit (paint, glass, wheels, lights);
- new unit tests plus the existing gate battery.

## 3. Non-goals

- selectable cosmetic effects (underglow, weather, nitro visual skins) — the chosen
  polish direction is materials and detail, not effects;
- new physics systems (per-wheel grip curves, drivetrain simulation) — the planar
  arcade model stays, only its constants become per-car;
- per-car audio variants;
- car progression/unlock mechanics (all models are available immediately);
- AI difficulty changes beyond giving the field distinct car specs.

## 4. Chosen approach and alternatives

**Chosen — A. Data-driven catalog.** One builder, one physics core; models differ by
resolved data (stations, kit toggles, stat multipliers). Single source of truth for
player, AI, garage, and tests. The hero spec is byte-for-byte today's car, which
pins the existing gates.

**Rejected — B. One builder file per model.** Maximum flexibility, ~700 duplicated
lines, four places to touch per material change, high drift risk.

**Rejected — C. Stats-only variants.** Cheapest, but fails the agreed requirement
that the four models differ in silhouette.

## 5. Data model: the car catalog

New file `src/vehicles/CarSpecs.ts` holds the catalog and its geometry tables
(`config.ts` stays the tuning surface; multi-megabyte station arrays do not belong
there). `config.ts` gains only the `CAR` block: stat spread bounds, kit defaults
shared by all models, and the AI model assignment table.

```ts
export interface CarSpec {
  id: 'hero' | 'hyper' | 'grip' | 'drift'
  name: string              // 'Velocity GT' | 'Solaris Hyper' | 'Apex Grip' | 'Slide King'
  class: string             // 'BALANCED' | 'TOP SPEED' | 'CORNER GRIP' | 'DRIFT'
  stat: CarStat             // multipliers over VEHICLE (section 7)
  shape: CarShape           // bodyStations + cabinStations (hero = today's, verbatim)
  kit: CarKit
}

export interface CarKit {
  splitter: boolean
  spoiler: 'none' | 'low' | 'gt'
  diffuserFins: number          // 0 | 4
  hoodVent: boolean
  roofScoop: boolean
  sideIntakes: boolean
  wheelStyle: 'five-spoke' | 'multi-spoke' | 'mesh' | 'teardrop'
  wheelRadiusMul: number        // 1.0 default; rally-style models may raise it
  wheelWidthMul: number         // 1.0 default; wider-tyre models > 1
  trackMul: number              // 1.0 default; widened-arch models > 1
  archExtension: number         // 0 default; opened-arch models > 0
  caliper: number               // hex colour
  glassTint: number             // 0..1 opacity delta over the shared glass material
}

export interface CarShape {
  bodyStations: readonly Station[]
  cabinStations: readonly Station[]
}
```

The four models:

| id | bias | silhouette and kit |
| --- | --- | --- |
| `hero` | balanced (default) | today's low coupe, small wing, five-spoke wheels — unchanged |
| `hyper` | highest top speed, average grip | longer and lower, sharper nose, large GT wing, mesh wheels |
| `grip` | cornering and drift recovery, lower top speed | compact, large splitter, widened arches, twin-spoke wheels |
| `drift` | easy sustained slide, twitchy response | widened track, opened rear arches, low wing, teardrop wheels |

`PAINTS` is untouched: paint stays an independent axis from model.

## 6. `CarModel`: parameterised builder and material polish

`buildCar(paintHex: number, spec: CarSpec = HERO_SPEC)` keeps the existing
construction strategy (lofted hulls, lathe wheels, beveled plates, static merge).
Only the data sources change:

- `buildHull` and `glassBandGeo` take their station arrays as parameters instead of
  reading module-level `BODY_STATIONS`/`CABIN_STATIONS` constants; `buildCar` passes
  `spec.shape`;
- kit toggles gate the existing meshes: splitter, spoiler (height/angle/blade by
  variant), diffuser fins, hood vent, roof scoop, side intakes;
- `wheelStyle` selects spoke count/pattern inside `buildWheelAssembly`, which
  already reads dimensions from config; wheel radius/width come from the spec
  (defaults equal today's `VEHICLE` values, so the hero is unchanged);
- widened arches (`grip`, `drift`) scale the arch rim radius and lateral seat via
  `trackMul`/`archExtension`;
- `WheelHandle.radius` carries the spec radius — `VehicleVisual` reads the handle
  (it must stop reading `VEHICLE.wheelRadius` directly, section 7).

Material polish pass (applies to all models, including hero):

- paint: flake/sparkle via strengthened roughness-map variation and a slight
  metalness sheen, keeping `MeshPhysicalMaterial` with clearcoat;
- glass: lower opacity, stronger reflection, per-model tint via `kit.glassTint`;
- wheels: stronger rim roughness-map contrast; calipers take `kit.caliper`;
- lights: small chrome projector ring inside each headlight housing; brighter tail
  bar response already exists via `setBrake`.

Naming convention for new meshes follows the existing `named()` scheme so
`mergeStaticMeshes` keepNames (wheel parts, light lenses, flame meshes) continue to
match exactly.

## 7. Physics: per-car tuning

`VehiclePhysics` currently reads the global `VEHICLE` object throughout `step()`.
It gains a resolved tuning record:

```ts
type CarTuning = { [K in keyof typeof VEHICLE]: number }  // same shape, resolved numbers
const BASE_TUNING: CarTuning = VEHICLE   // value-identity of today's constants
function resolveTuning(spec: CarSpec): CarTuning   // {...VEHICLE} with stat applied
new VehiclePhysics(probe, seed = PHYS_SEED, tuning: CarTuning = BASE_TUNING)
```

(`VEHICLE` is `as const`, so the mapped type is required for the resolved numeric
record to be assignable.)

- every `const V = VEHICLE` in the class becomes `const V = this.tuning`;
- `setTuning(t)` re-assigns the record; tuning is read-only per step, so swapping
  while the car is parked on the title screen is safe;
- `VehicleVisual` replaces its `VEHICLE.wheelRadius` reads with per-handle
  `w.radius` (spin integration and base wheel height);
- the stat vector is deliberately restricted to fields with clear gameplay meaning:
  `topSpeed, nitroTopSpeed, engineAccel, brakeForce, gripMax, gripDrift,
  driftYawBoost, yawResponse, drag`;
- `resolveTuning` clamps every multiplier to ±40% of the base value — the legal
  envelope for the moderate spread and a guard against future catalog typos;
- AI pace targets multiply the AI car's own resolved `topSpeed` (today they use the
  global one), so hyper AI are visibly faster on straights and grip AI hold tighter
  corners while `AI.rubberBand*` keeps races close.

Stat multipliers (approved spread):

| field | hero | hyper | grip | drift |
| --- | --- | --- | --- | --- |
| topSpeed | 1.0 | 1.12 | 0.90 | 0.96 |
| nitroTopSpeed | 1.0 | 1.10 | 0.90 | 0.96 |
| engineAccel | 1.0 | 1.02 | 1.0 | 1.0 |
| gripMax | 1.0 | 0.90 | 1.12 | 0.94 |
| gripDrift | 1.0 | 1.05 | 1.10 | 0.88 |
| driftYawBoost | 1.0 | 1.0 | 1.0 | 1.30 |
| yawResponse | 1.0 | 0.95 | 1.08 | 1.20 |
| brakeForce | 1.0 | 1.0 | 1.08 | 1.0 |
| drag | 1.0 | 0.92 | 1.0 | 1.0 |

Determinism: tuning is static resolved data; all RNG use is unchanged, so seeded
trajectories stay bit-identical for a given tuning and seed.

## 8. Garage UI on the title screen

No new UI mode. The garage extends the existing title screen around the paint row:

```
[ TITLE ]
  [ Velocity GT ][ Solaris Hyper ][ Apex Grip ][ Slide King ]   model cards
  ▸ Top speed  ████████░░
  ▸ Acceleration ██████░░░░                     [ 🎨 🎨 🎨 🎨 🎨 ]  paint swatches
  [ START ]
```

- `index.html`: `#model-cards` and `#model-stats` containers inside
  `#title-screen`; `styles.css` adds the card/bar classes in the existing skewed
  neon language;
- `UIManager.buildModelCards(specs, selectedId, onModel)` renders the card row;
  `UIManager.renderModelStats(tuning)` fills five normalized bars — top speed,
  acceleration, grip, drift (combined `driftYawBoost`/`yawResponse`), brake —
  each normalized against the min/max of the four resolved tunings so the spread
  reads maximal across the catalog;
- `Game.onModel(id)` → `selectModel(id)`: rebuild the player `CarModel` with
  `buildCar(paintHex, spec)`, swap the group in the scene keeping the parked pose,
  replace the `VehicleVisual`, call `player.phys.setTuning(resolveTuning(spec))`,
  refresh standings names and the swatch selection;
- standings names use `spec.name` (today they use paint names);
- AI field assignment is fixed and deterministic: slots get
  `[grip, hyper, drift, hero, grip]` (from `CAR.aiModels`), paints as today
  (excluding the player's chosen paint);
- selection persists as `localStorage['vr.model']` inside a try/catch guard
  (private-mode safe), defaulting to `hero`.

## 9. Error handling and edge cases

- unknown persisted model id → fall back to `hero`;
- missing `stat` field → multiplier defaults to 1.0 before clamping;
- a station array with non-uniform ring counts already throws in `buildHull`; the
  catalog is validated at load in dev builds by building each spec once behind the
  existing dev-only harness guard — shipped builds pay no cost;
- model switch while a race is running is not exposed in the UI (cards are on the
  title screen only); `selectModel` is a no-op during a race and logs in dev;
- `setTuning` during simulation is documented as unsafe and not called by any
  shipped path.

## 10. Testing

Regression surface (verified during design):

- `scripts/audit-shots.mjs` is a structural pixel proxy (no near-monochrome,
  populated regions, colour variety), not a pixel-diff baseline — the material
  polish cannot flip it unless a frame becomes degenerate;
- shots render fresh per run; frozen-pose harness uses wheel handles, whose
  interface is preserved;
- `tests/rig.ts` and the drive/ai/lap/shortcut cases construct `VehiclePhysics`
  with the default tuning — behaviour-identical by the `BASE_TUNING` invariant;
- `tests/cases/assets.test.ts` may assert model structure (mesh names/counts);
  where kit toggles change counts, assertions become spec-driven.

New cases:

1. `resolveTuning`: `hero` resolves bit-identical to `VEHICLE` (gate-pinning
   invariant); multipliers apply; every field within the ±40% clamp;
2. `buildCar(spec)`: four wheel handles with spec `radius`; kit correctness per
   model (hyper has the GT wing, grip the large splitter, drift the widened
   track); merge keepNames still match (`tire`, `wheel-spoke`, `wheel-hub`,
   light lenses, flames);
3. determinism: same seed + tuning produce a bit-identical trajectory (existing
   rig pattern);
4. garage: selecting a model fires `onModel`, rebuilds the player car, defaults to
   hero; stat bars render in [0, 1];
5. AI field: model assignment is the fixed table; standings names are model names.

Final gate battery: `npm run typecheck`, `npm run test`, `npm run shots`,
`npm run audit`, `npm run functional`, `npm run noleak`, `npm run perf`, plus the
human five-second look at new screenshots of all four models.

## 11. Rollout

One feature branch, ordered so each step is independently verifiable:

1. catalog + `resolveTuning` + physics tuning parameter (hero-identity test first);
2. builder parameterisation + material polish, hero unchanged;
3. three new shapes/kits with catalog tests;
4. garage UI + AI mix + persistence;
5. full gate battery + screenshot review.
