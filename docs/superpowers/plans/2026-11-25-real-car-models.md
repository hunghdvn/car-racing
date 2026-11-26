# Real Car Models — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four fictional procedural cars with five real, at-a-glance-recognizable production cars (real GLB models from Sketchfab), keeping every garage/physics/AI contract intact. Real names + logo decals ship behind one config flag.

**Architecture:** `buildCar(paintHex?, spec)` stays the single public contract (sync, arity 0 default-args). A new `CarLibrary` preloads the five GLBs at boot, bakes nothing at runtime beyond cloning: an offline `scripts/optimize-cars.mjs` pipeline (run once per car, output committed to `public/models/`) does simplify/texture-compress/unit-normalize/ground-sit/wheel-rename/paint-material-naming. `buildCar` clones a preloaded GLB when available, else falls back to the unchanged procedural builder (offline/dev safety). `CarSpec` grows optional `identity` (real branding) + `rig` link; `CarRigs.ts` holds the per-car runtime table (wheel radii, clearance, caliper colour, baked-paint flag).

**Spec:** `docs/superpowers/specs/2026-11-25-real-car-models-design.md` — authoritative. Where this plan and the spec disagree, the spec wins; stop and ask.

**Tech stack:** three.js ^0.168 (GLTFLoader from `three/addons/loaders/`), Vite, esbuild node tests, `@gltf-transform/core|functions|extensions` + `sharp` (dev-only, pipeline), Playwright functional/shots/audit scripts.

**Asset prerequisite (blocks Tasks 4–6):** the five raw GLBs must exist in `assets-src/` (partner manual download, already agreed):

| id | file | real car | source (Sketchfab UID) |
|---|---|---|---|
| `r34` | `assets-src/r34.glb` | Nissan Skyline GT-R R34 | Lexyc16, CC-BY, `ff8fb2251dfa4bb9979e7022c5a6666c` |
| `930` | `assets-src/930.glb` | Porsche 911 Turbo (930) | Lionsharp, CC-BY, `8568d9d14a994b9cae59499f0dbed21e` |
| `s15` | `assets-src/s15.glb` | Nissan Silvia S15 | autoNgraphic, CC-BY, `18348c1698f74d9db1497a791bd21a2f` |
| `centenario` | `assets-src/centenario.glb` | Lamborghini Centenario LP 770-4 | SDC, CC-BY, `d679af35b5694301a185c7454a700c73` |
| `terzo` | `assets-src/terzo.glb` | Lamborghini Terzo Millennio | SDC, CC-BY-NC, `7ad3dffa9d344c3c978eafcc220cb709` |

If a file is missing, `npm run optimize-cars` must fail loudly with that car's page link. Do NOT fabricate substitute assets.

---

## File structure (ownership map)

| File | Action | Responsibility |
|---|---|---|
| `scripts/optimize-cars.mjs` | new | offline pipeline: per-car config table → simplify, webp textures, unit normalize, ground-sit, wheel-node rename, paint-material rename via hue mask, prune light meshes, nitro anchor stubs, budget gates, JSON report |
| `public/models/<id>.glb` | new (generated, committed) | optimized runtime assets |
| `src/assets/CarRigs.ts` | new | per-car runtime rig table (authoritative numbers measured by the pipeline) |
| `src/assets/CarLibrary.ts` | new | GLTFLoader cache, `preloadCars()`, synchronous clone, wheel reparenting, paint/caliper material remap, logo decal, lamp glow, nitro tips, shared-resource WeakSets |
| `src/assets/CarModel.ts` | modify | `buildCar` delegates to CarLibrary clone when ready, procedural otherwise; `disposeCarTree` spares GLB-shared resources; exports unchanged |
| `src/vehicles/CarSpecs.ts` | modify | 5 real specs, identity fields, stat table, hero alias, localStorage fallback id |
| `src/config.ts` | modify | `CAR.aiModels` new ids, `CAR.realBranding` flag |
| `src/vehicles/Vehicle.ts` | modify | per-wheel radius instead of `wheels[0].radius` |
| `src/game/Game.ts` | modify | kick off preload, rebuild player car when library lands, logo/standings name source |
| `src/three-addons.d.ts` | modify | wildcard declaration for `three/addons/loaders/*.js` |
| `src/dev/harness.ts` | modify | catalog loop awaits preload; `car_model_*` pose ids; `__dbg.CarRigs` + `__dbg.preloadCars` |
| `tests/cases/cars.test.ts` | modify | catalog/stat/paint/storage expectations for 5 real cars |
| `tests/cases/carassets.test.ts` | new | static GLB container gates (fs + GLB header parse, node-only) |
| `tests/cases/materials.test.ts` | modify | id renames only |
| `tests/cases/shell-detail.test.ts` | modify | id renames only (kits are reused verbatim) |
| `tests/cases/ui.test.ts` | modify | only if a required `CarSpec` field is added (it should not be) |
| `scripts/functional.mjs` | modify | car recs: ids, counts 4→5, spoke recs → rig recs |
| `ASSETS.md` | new | attribution table (CC licences) |
| `package.json` | modify | `optimize-cars` script + devDeps |

Do **not** touch `scripts/shots.mjs`, `scripts/audit-shots.mjs`, `scripts/noleak.mjs` — `tests/cases/workflows.test.ts` pins their source text and `noleak` its token list. All new debug surface hangs off the existing `__dbg` object.

---

### Task 1 — Catalog: five real specs (node-testable, no assets needed)

**Files:**
- Modify: `src/vehicles/CarSpecs.ts`, `src/config.ts`
- Test: `tests/cases/cars.test.ts`, `tests/cases/materials.test.ts`, `tests/cases/shell-detail.test.ts`

- [ ] **Step 1: Rewrite the failing catalog tests first.** In `tests/cases/cars.test.ts`:

  - `catalog: the four models exist in order` → five ids in order:
    ```ts
    assert(CAR_SPECS.map(s => s.id).join(',') === 'r34,930,s15,centenario,terzo', 'catalog order')
    ```
  - `catalog: hero is today's car` → `HERO_SPEC.id === 'r34'`, kit verbatim from today's hero (`spoiler 'low'`, `splitter 'std'`, `wheelRadiusMul 1`, `trackMul 1`).
  - `shapes: all four silhouettes are distinct` → replace with:
    ```ts
    test('shapes: the five fallback silhouettes reuse the four procedural bodies', () => {
      const fp = CS.map(s => stationFingerprint(s))
      assert(new Set(fp).size === 4, 'five cars, four distinct fallback bodies')
    })
    ```
  - `shapes: hyper is longer+lower…` → rename ids: `len('centenario') > len('r34') + 0.1`, `minTy('centenario') < minTy('r34')`, `len('930') < len('r34') − 0.05`, `maxHw('s15') > maxHw('r34') + 0.02`.
  - `catalog: the approved §7 stat table…` — `APPROVED_STATS` keyed by new ids. **Data rule:** `930` keeps today's `grip` row verbatim, `s15` keeps today's `drift` row verbatim, `centenario` keeps today's `hyper` row verbatim, `r34` keeps today's `hero` row verbatim (all 1.0 / absent multipliers), and `terzo` is the new hypercar row:
    ```ts
    terzo: { topSpeed: 1.2, accel: 1.12, gripMax: 1.05, brake: 1.0, driftYawBoost: 0.9 },
    ```
  - `garage: the spread reads` → fastest top-speed rail `terzo`, slowest `930`.
  - `garage: bars are index-aligned` → `bars('s15')[drift] > bars('930')[drift]`, `bars('930')[brake] === max`, `bars('s15')[brake] < bars('930')[brake]`.
  - `ai: slot model assignment` still reads `CAR.aiModels` (now `['930','centenario','s15','r34','930']`).
  - `lamps: frontLampAnchors…` → hero pins stay (r34 carries hero's shape), loop ids `['centenario','930']`.
  - `garage: readModelSelection falls back…` → stored `'not-a-car'` → `'r34'`; round-trip id `'930'`.
  - `finishes: hero paint byte-pinned` → `HERO_SPEC.finish.paint === PAINTS[1].color` (r34 keeps hero's red).
  - Add identity tests:
    ```ts
    test('identity: every spec carries real-world branding metadata', () => {
      for (const s of CAR_SPECS) {
        assert(s.identity && s.identity.name && s.identity.maker && s.identity.license, `identity ${s.id}`)
        assert(typeof s.identity.realBranding === 'boolean', 'realBranding flag')
      }
    })
    test('identity: REAL_BRANDING swaps display name', () => {
      assert(getSpec('r34').name === 'Nissan Skyline GT-R R34', 'branded name')
      assert(getSpec('r34').fictionalName.length > 0, 'fictional name present')
    })
    ```

- [ ] **Step 2: Run to verify failure** — `npm run test` → catalog tests FAIL (ids/names absent), others pass.

- [ ] **Step 3: Implement in `CarSpecs.ts`.** Extend the types (all new fields **optional** so the `tests/cases/ui.test.ts` CarSpec literal keeps compiling):

  ```ts
  export interface CarIdentity {
    name: string          // "Nissan Skyline GT-R R34"
    maker: string         // "Nissan"
    license: string       // "CC-BY 4.0 — model by Lexyc16 (Sketchfab)"
    realBranding: boolean // per-car kill switch; ANDed with CAR.realBranding
  }
  // on CarSpec:
  identity: CarIdentity
  fictionalName: string   // the old fictional name, kept for the toggle-off path
  rigId?: CarId           // rig lookup defaults to spec.id
  ```

  `CarSpec.name` becomes the **display** getter result at module build: when `CAR.realBranding && identity.realBranding` → `identity.name`, else `fictionalName`. Simplest compliant shape: keep `name` a plain field set once from the flag at table construction, e.g. `const R = (id: CarId, fn: string) => (CAR.realBranding ? REAL[id].name : fn)`.

  New catalog (id / display / fictional / kit+shape+finish source):

  | id | display (REAL_BRANDING on) | fictionalName | kit + shape + finish blueprint (reuse today's data verbatim) |
  |---|---|---|---|
  | `r34` | Nissan Skyline GT-R R34 | Velocity GT | hero |
  | `930` | Porsche 911 Turbo | Apex Grip | grip |
  | `s15` | Nissan Silvia S15 | Slide King | drift |
  | `centenario` | Lamborghini Centenario LP 770-4 | Solaris Hyper | hyper |
  | `terzo` | Lamborghini Terzo Millennio | Vector Zero | hyper |

  Signatures (all members of `PAINTS`, pairwise distinct — verify hexes against `config.ts` `PAINTS`): r34 `0xd8232e` (VELOCITY RED, = `PAINTS[1]`), 930 `0xf27a1e` (SOLAR FLARE), s15 `0xe8b62e` (PLASMA GOLD), centenario NIGHT SHIFT member, terzo VIPER GREEN member. Caliper literals carry over with their blueprints (r34 `0xc23a28`, 930 `0x39c06a`, centenario `0xe8b62e`, s15 `0xf27a1e`); terzo `0xc23a28`.

  Keep exports `HERO_SPEC` (= the r34 entry — `ai.test.ts` and harness import it), `getSpec` fallback → `HERO_SPEC`, `readModelSelection` fallback → `'r34'`, `spokeCountForStyle` (procedural builder keeps it).

  `src/config.ts`: `aiModels: ['930','centenario','s15','r34','930'] as const`, add `realBranding: true` to the `CAR` block, `CAR.defaultModel` (if present) → `'r34'`.

- [ ] **Step 4: Rename ids in the two collateral suites.** `materials.test.ts`: `'hyper'`→`'centenario'`, `'grip'`→`'930'`, `'drift'`→`'s15'`, `'hero'`→`'r34'` (caliper/microRoughness/glass pins keep their hex values, ride the blueprint). `shell-detail.test.ts`: `kitOf('grip')`→`kitOf('930')` (exhaust single), `kitOf('drift')`→`kitOf('s15')` (twin), `kitOf('hyper')`→`kitOf('centenario')` (quad) — kits are reused verbatim so all other assertions stand.

- [ ] **Step 5: Update `scripts/functional.mjs` id-dependent recs** (this task ships with the app green):
  - L348 `EXPECT_SPOKES` → keys `r34:20, terzo:48, '930':32, s15:24, centenario:48`.
  - L350 `EXPECT_STANDINGS` → `['YOU','PORSCHE 911 TURBO','LAMBORGHINI CENTENARIO LP 770-4','NISSAN SILVIA S15','NISSAN SKYLINE GT-R R34','PORSCHE 911 TURBO']` (must equal `displayName` of the aiModels slots, uppercase as the UI renders).
  - L353 seed `'vr.model' = 's15'`; rec `boot-retunes-physics`: `selectedId === 's15'`, `playerSpokes === 24`, `playerTop === r34Ref × 0.96` where `r34Ref = g.ai.find(a => a.spec.id === 'r34').tuning.topSpeed`.
  - `ai-field-mixed-models`: `boot.aiSpecIds.join(',') === '930,centenario,s15,r34,930'`.
  - `garage-rebuilds-on-model`: `__selectModel('centenario')` → `'centenario'`, spokes 24→48→20 (`__selectModel('r34')` last), `top === r34Ref × 1.12`.
  - `garage-row-fits-390px`: `cards === 5`, `rows >= 2`.
  - `caliper-colour-on-built-car`: `CALIPER` map → the five per-car caliper hexes above, gate `length === 5` and each id truthy.
  - `keyboard-enter-picks-model`: card 2 ⇒ `'930'`; `cards-locked-during-race`: `cards.length === 5`.
  - `explicit-pick-survives-model-click`: `data-model="s15"`, `STALE = 0xe8b62e` (s15 signature), `PICKED = 0x39c06a` unchanged.
  - `paint-storage-*` recs: `HERO_SIGNATURE = 0xd8232e` (r34) — literal stays, just re-point the constant name/comment.

- [ ] **Step 6: Green + commit** — `npm run test && npm run typecheck && npm run functional` all green (still fully procedural at this point; the app *looks* the same cars, new names). Commit: `feat(cars): five real-car catalog entries behind REAL_BRANDING`.

---

### Task 2 — Rig table + static asset gates (node-testable; assets arrive now)

**Files:**
- Create: `src/assets/CarRigs.ts`, `tests/cases/carassets.test.ts`
- Modify: `tests/all.ts` (add the new case import)

- [ ] **Step 1: Confirm the five raw files exist** — `ls -la assets-src/`. If any missing, STOP and ask the partner to finish the download.

- [ ] **Step 2: Write `tests/cases/carassets.test.ts`** (node-only; import in `tests/all.ts`). Parses each committed `public/models/<id>.glb` container directly (12-byte header, chunk length+type, JSON chunk) — no three.js, no fetch:

  ```ts
  import { test, assert } from '../harness'
  import { readFileSync, existsSync, statSync } from 'node:fs'
  import { CAR_SPECS } from '../../src/vehicles/CarSpecs'
  import { CAR_RIGS } from '../../src/assets/CarRigs'

  function glbJson(path: string): any {
    const buf = readFileSync(path)
    assert(buf.readUInt32LE(0) === 0x46546c67, 'glTF magic')
    const len = buf.readUInt32LE(12), type = buf.readUInt32LE(20)
    assert(type === 0x4e4f534a, 'JSON chunk first')
    return JSON.parse(buf.subarray(24, 24 + len).toString('utf8'))
  }
  ```

  Assert per `CAR_SPECS` entry (id `x`, file `public/models/${id}.glb`):
  - file exists, `statSync().size` between 100 KB and 4 MB; **total across five ≤ 12 MB** (one aggregate test).
  - JSON chunk has ≥ 4 node names matching `/^wheel-(fl|fr|rl|rr)-lr$/` (exactly one each).
  - a mesh node named `brake-fl-lr` (etc. per corner) exists **as a descendant of** its `wheel-*-lr` node (walk `nodes[].children`).
  - ≥ 1 material name starts with `paint` OR `CAR_RIGS[id].bakedPaint === true`.
  - ≥ 2 material names contain `glass`.
  - `CAR_RIGS[id]`: `wheelRadius` array length 4, every entry in [0.28, 0.44]; `groundClearance` ∈ [0.08, 0.24]; `caliperColor` integer; `logoAnchor`/`nitroAnchor` triples finite.
  - every mesh in the scene: `min Y` (from accessor min when POSITION has min, else skip) ≥ `groundClearance − 0.06` — skip meshes whose name matches `/glass|interior/`.

  These run against the committed GLBs, so **Task 1's commit is green before the files exist only if you land Tasks 2–5 together**; instead commit Task 2 code and Task 4 output in sequence — the test goes in *with* Task 4's assets (see Step ordering note below).

  **Ordering note:** author `CarRigs.ts` + the test in Task 2, but check its `tests/all.ts` import only after Task 4 produces the GLBs (keep the two commits adjacent; CI is run by the partner at gates, not per-commit).

- [ ] **Step 3: `src/assets/CarRigs.ts`** — exact schema:

  ```ts
  export interface CarRig {
    wheelRadius: [number, number, number, number] // [fl, fr, rl, rr] metres
    groundClearance: number                        // body min-Y when parked (m)
    caliperColor: number                           // per-car brake caliper tint
    bakedPaint: boolean                            // true → no paint-* materials, swatches ignored
    lampGlow: boolean                              // add emissive glow planes over baked lamps
    logoAnchor: [number, number, number]           // rear logo decal position (normalised m)
    nitroAnchor: [[number, number, number], [number, number, number]] // [left, right]
  }
  export const CAR_RIGS: Record<CarId, CarRig> = { /* filled from pipeline report */ }
  ```

  Seed with placeholder-measured values in Task 2? **No** — fill from the Task 4 report (the pipeline prints a `rig` snippet per car; paste it here). Until then the file exists with the interface only; do not land the `tests/all.ts` import early.

- [ ] **Step 4: Commit** `feat(cars): rig schema + static GLB container gates`.

---

### Task 3 — Per-wheel radius in the visual layer (node-testable)

**Files:**
- Modify: `src/assets/CarModel.ts` (`WheelHandle` type), `src/vehicles/Vehicle.ts`
- Test: new test inside `tests/cases/` (append to an existing vehicle case or a small new `vehicle-visual.test.ts` — if new, register in `tests/all.ts`)

- [ ] **Step 1: Failing test.** Build a fake `CarModel` whose four wheels have radii `[0.3, 0.3, 0.35, 0.35]` (plain `THREE.Group`s, `spin` groups), `VehicleVisual.bind(fakeCar, [0.3,0.3,0.35,0.35])`; call `applyTelemetry` with `dist = 1.0`; assert rear `spin.rotation.x` ≈ `1.0/0.35` and front ≈ `1.0/0.3` (`assertNear`, tol 1e-6). Signature change: `bind(car, wheelRadii: number[])` — falls back to `car.wheels[0].radius` when omitted so the procedural call site is untouched until Task 8.

- [ ] **Step 2: Run → FAIL.** `npm run test`.

- [ ] **Step 3: Implement.** `Vehicle.ts` L? (`spin.rotation.x += dist / car.wheels[0].radius`) → per-wheel `radii[i]`. Keep the frozen-pose path (`applyPoseVisual`) consistent. Procedural `buildCar` still passes one radius (all four equal) — unchanged behaviour, bit-identical shots (radius equals today's `wheels[0].radius`).

- [ ] **Step 4: `npm run test && npm run typecheck` green. Commit** `feat(cars): per-wheel visual radius`.

---

### Task 4 — Offline asset pipeline (`npm run optimize-cars`)

**Files:**
- Create: `scripts/optimize-cars.mjs`
- Modify: `package.json` (scripts + devDeps), `src/three-addons.d.ts` (later task needs it, not here)
- Generate: `public/models/*.glb`, `build/cars/<id>.report.json`
- Fill: `CAR_RIGS` entries + enable `tests/all.ts` import from Task 2

- [ ] **Step 1: Deps.** `npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions sharp` and `"optimize-cars": "node scripts/optimize-cars.mjs"` in `package.json` scripts.

- [ ] **Step 2: Per-car config table inside the script** (single source of tuning):

  ```js
  const CARS = {
    r34:        { file: 'r34.glb',        tris: 45000, bodyTex: 1024, detailTex: 512,
                  wheels: ['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR'], // EDIT after report
                  wheelMeshes: ['Tire','Wheel'], paintHue: [340, 20], paintSat: 0.35,
                  drop: [/light/i, /lamp/i, /headlight/i, /taillight/i] },
    /* …one entry per id, same keys… */
  }
  ```

- [ ] **Step 3: Pipeline stages** (all via `@gltf-transform/functions` unless noted):
  1. **Missing-file gate** — for each id, `existsSync('assets-src/'+file)` else `throw` printing the Sketchfab page URL from the table in this plan.
  2. `flatten()` → `dedup()` → `join()` (merge by material) → `weld()`.
  3. **Prune authored light/emissive meshes** by node-name regex from config (`drop`), and any material with `emissiveTexture` whose name matches — best-effort per spec; two-tier guard: a drop list over 15% of tris WARNs and drops anyway (verify it), over 30% keeps everything and demands review.
  4. `simplify({ ratio })` — bisect ratio until `triangles ≤ tris` budget (spec: ≤ 60k/car hard cap).
  5. **Texture pass:** dominant-hue detection — composite each material's baseColorTexture with `sharp().raw()`, histogram in HSL; the **body hue** = the hue bin with the largest saturated pixel count (s ≥ `paintSat`). Materials whose pixels ≥ 55% match the body hue bin (±10°) and have tri-count ≥ 5% of the car → rename material to `paint-<n>` (this is the spec's "hue-similarity mask picks body-panel material ids"). If **zero** materials match → set report `bakedPaint: true` (spec fallback).
  6. Rename glass candidates (material names containing `glass|wind|window|mesh_glass`) to `glass-<n>` if not already.
  7. **Wheel canonicalisation:** for each config `wheels[i]` name, find the node; rename the node to `wheel-fl-lr`/`wheel-fr-lr`/`wheel-rl-lr`/`wheel-rr-lr` in [fl,fr,rl,rr] order (sort matched nodes by (sign of x, sign of z) from world bbox centers); inside each, rename the largest-tri mesh `tire` and its brake mesh (smallest child near center, or config `brakeName`) to `brake-<corner>-lr`.
  8. **Unit + ground normalisation:** measure scene bbox; uniform `scale = TARGET_LEN / len` where `TARGET_LEN = 4.55` m (matches the procedural footprint); translate so min-Y = the report's `groundClearance` (measured as wheel-center Y − measured wheel radius; wheels must touch the ground plane within 0.01 m — if not, shift the whole scene so wheel bottoms sit at 0 and body min-Y becomes the clearance readout).
  9. **Texture compress:** `textureCompress({ targetSize: bodyTex/detailTex, encoder: 'webp', quality: 82 })` (sharp-backed).
  10. `prune()` (keep materials/nodes referenced by canonical names!), write `public/models/<id>.glb`, report to `build/cars/<id>.report.json` containing: bbox, triangles, texture sizes, **ready-to-paste `CarRig` literal** (measured `wheelRadius` per corner = bbox vertical extent / 2 of each canonical wheel node, `groundClearance`, `caliperColor: <config default>`, `bakedPaint`, `lampGlow: true`, `logoAnchor: [0, bodyMinY+0.35, +len/2 − 0.15]`, `nitroAnchor: [[±0.18, 0.22, +len/2 − 0.05]]`).
  11. **Budget gate:** total `public/models/*.glb` ≤ 12 MB and each ≤ 60k tris — else `process.exit(1)`.

- [ ] **Step 4: Run per car, iterate the config table.** `node scripts/optimize-cars.mjs r34` → inspect `build/cars/r34.report.json` (wheel node names discovered, hue bins, drop list hits) → fix `wheels`/`paintHue`/`drop` for that car → rerun until the report is sane (4 wheels found, ≥1 paint material unless intentionally baked, tris under budget). Repeat for all five. This step is where real-world mess is absorbed — expect several passes per car.

- [ ] **Step 5: Paste measured rig literals into `src/assets/CarRigs.ts`** (all five), add `import './cases/carassets.test'` to `tests/all.ts`.

- [ ] **Step 6: `npm run test`** → static container gates pass for all five. **Commit** `feat(cars): optimized GLB pipeline + committed runtime models + rig table`.

---

### Task 5 — CarLibrary (browser runtime)

**Files:**
- Create: `src/assets/CarLibrary.ts`
- Modify: `src/assets/CarModel.ts` (shared-resource WeakSets), `src/three-addons.d.ts`
- Test: `tests/cases/assets.test.ts` (extend)

- [ ] **Step 1: Type declaration** — in `src/three-addons.d.ts` add alongside the postprocessing wildcard:
  ```ts
  declare module 'three/addons/loaders/*.js' {
    const anyExport: any
    export = anyExport
  }
  ```

- [ ] **Step 2: Failing node tests in `assets.test.ts`** (data-level only — cloning itself is covered by functional recs in Task 7): `CAR_RIGS` covers every `CAR_SPECS` id (already from Task 2 — skip); export `libraryReady()`/`preloadCars()` exist on `CarLibrary` dynamic import:
  ```ts
  const lib = await import('../../src/assets/CarLibrary')
  assert(typeof lib.preloadCars === 'function' && typeof lib.cloneRealCar === 'function', 'library API')
  ```
  (Importing must not touch `fetch`/`window` at module scope — that's the actual contract under test.)

- [ ] **Step 3: Implement `CarLibrary.ts`:**

  ```ts
  export function preloadCars(): Promise<void>           // idempotent; fires at boot, loads all five
  export function libraryReady(): boolean
  export function cloneRealCar(id: CarId, paintHex: number, spec: CarSpec): CarModel | null
  export function disposeLibrary(): void                  // test hygiene
  ```

  Behaviour contract (from the spec):
  - `GLTFLoader` from `three/addons/loaders/GLTFLoader.js`; scene cache `Map<CarId, THREE.Group>`.
  - **Clone path (sync):** deep-clone the cached group; group name `car-model-${id}`. Traverse:
    - materials whose name starts `paint` → per-instance `MeshPhysicalMaterial` built from `carMaterialParamsFor(spec).paint` + `carPaintMaps(...)` (same recipe as the procedural builder, ~`CarModel.ts` L688 `mkPaint`); push to `paintMats`.
    - material name contains `caliper` → per-instance clone tinted `rig.caliperColor`.
    - **all other** GLB materials and **all** geometries get added to module-level `WeakSet`s and `disposeCarTree` (Task 6) must spare them — reuse `sharedCarMats` idiom, add `sharedCarGeos`; expose `isSharedCarGeometry(g)` export for tests.
  - **Wheel rebuild:** for the four canonical `wheel-*-lr` nodes, detach them and rebuild the procedural handle contract: `steer = Group(named 'wheel-<corner>')` at the node's world center (car-local), `spin = Group('wheel-spin')` child of steer, wheel subtree child of spin. `brake-*-lr` meshes must remain descendants of `spin` (they are, since the whole wheel node moved). `CarModel.wheels` gets `{ steer, spin, radius: rig.wheelRadius[i] }` in **[fl, fr, rl, rr]** order. Verify exactly 4 wheels found; **any rig violation → return `null`** (caller falls back procedural) with a `console.warn('[carlib] <id> <reason>').
  - **Emissive add-ons** (spec §lamps): `rig.lampGlow` → add two `Mesh(PlaneGeometry(0.5,0.18))` named `glow-front`/`glow-rear` at front/rear body stations with per-instance emissive material (front warm `0xfff0d8`, rear `0xff2b1f`), `renderOrder` above body.
  - **Logo decal:** plane `Mesh(PlaneGeometry(0.6,0.2))` named `logo-rear` at `rig.logoAnchor`, material = `MeshBasicMaterial({ map: logoTexture(id), transparent, depthWrite:false })`. `logoTexture(id)` = canvas wordmark generator (maker name in a shield ellipse, per-car accent `finish.accent`) cached per id — plus override: `fetch('/logos/<id>.png')` first (HEAD via `new Image`), use it if it loads. Generator mirrors the `Textures.ts` canvas idiom.
  - **Nitro:** two cone meshes named `nitro-left/right` at `rig.nitroAnchor`, per-instance emissive material (same as procedural), pushed to `nitroTips`. `headLights` = the two glow-front-class emissive materials (glow plane + any GLB emissive front material found; if none, still returns the glow planes) so `Game.setNitro`/brake-light paths keep working.
  - **Do not** call `mergeStaticMeshes` on real clones (multi-material, wheel reparenting).
  - `CarModel` interface: add `radius` to each wheel handle entry (Task 3 made `Vehicle` consume it).

- [ ] **Step 4: `disposeCarTree` spares GLB resources** — in `CarModel.ts`, alongside the `isSharedCarMaterial` check, skip `isSharedCarGeometry`. Existing `assets.test.ts` lifecycle test stays green (procedural set untouched, `mats.length >= 14` untouched).

- [ ] **Step 5: Green + commit** `feat(cars): CarLibrary preload/clone/material remap`.

---

### Task 6 — Wire the game (fallback-safe switch)

**Files:**
- Modify: `src/assets/CarModel.ts` (`buildCar`), `src/game/Game.ts`, `src/dev/harness.ts`

- [ ] **Step 1: `buildCar` delegate.** At the top of `buildCar` (keep signature + default args → `length === 0` pin intact):
  ```ts
  if (libraryReady()) {
    const real = cloneRealCar(spec.id, paintHex ?? resolvePaint(null, spec), spec)
    if (real) return real
  }
  // …existing procedural body unchanged (fallback, ?proc=1, or pre-preload window)
  ```
  Add a session kill switch mirroring the spec toggle: `?proc=1` query param or `CAR.forceProcedural` forces fallback (helps A/B shots and debugging).

- [ ] **Step 2: Game boot.** In `Game.boot` (after renderer exists, before first frame): fire-and-forget `void preloadCars().then(() => this.refreshModel())`. `refreshModel()` re-clones the player car (same paint/tuning) and re-`bind`s `VehicleVisual` with `car.wheels.map(w => w.radius)`. AI seeding path (`aiModels`) is unchanged — cars built after preload are real; ones built before land procedural and are NOT rebuilt (boot ordering makes this vanishingly rare; the loading screen covers it since models are part of boot: await `preloadCars()` inside the existing loading phase before hiding `#loading` if simpler — **choose the loading-await variant**, it keeps the first frame consistent).
- `selectModel` (Game.ts ~L634): unchanged call flow — `buildCar` now clones. After a real clone, call `vehicleVisual.bind(car, radii)` (already the pattern at the existing bind site ~L653).

- [ ] **Step 3: Harness.** `src/dev/harness.ts`:
  - catalog loop (L77–89): `void preloadCars().then(() => { for (const spec of CAR_SPECS) { validateCarShape(spec.shape); const car = buildCar(0x1f8fe0, spec); disposeCarTree(car.group); …log } })`.
  - pose loop (L455–457): ids `['r34','930','s15','centenario','terzo']`.
  - `__dbg` additions only: `CarRigs: CAR_RIGS`, `preloadCars`, `libraryReady`, `forceProcedural: (v: boolean) => …`. No new top-level globals (noleak untouched).

- [ ] **Step 4: Manual sanity** — `npm run dev`, open game, garage shows 5 cards, all cars render, swatches change paint on 4 of 5 (the baked-paint car ignores them, per spec). Commit `feat(cars): real models into game boot + harness`.

---

### Task 7 — Functional script: swap procedural recs for rig recs

**Files:**
- Modify: `scripts/functional.mjs`

- [ ] **Step 1: Replace `wheels-fold-stop-at-spin`** (procedural-only internals) with `glb-rigs-integrity`, using the already-forbidden `__dbg`:
  ```js
  const r = await page.evaluate(async () => {
    const d = window.__dbg
    await d.preloadCars()
    const out = {}
    for (const spec of d.CAR_SPECS) {
      const car = d.buildCar(0xf27a1e, spec)
      const byName = (n) => { let f = null; car.group.traverse(o => { if (!f && o.name === n) f = o }); return f }
      const rig = d.CarRigs[spec.id]
      const wheels = ['fl','fr','rl','rr'].map(c => byName(`wheel-${c}-lr`))
      const brakeParented = ['fl','fr','rl','rr'].every((c, i) => {
        let o = byName(`brake-${c}-lr`), ok = false
        while (o) { if (o === wheels[i]) { ok = true; break } o = o.parent }
        return !!byName(`wheel-spin`) && ok
      })
      const box = new d.THREE.Box3().setFromObject(car.group)
      out[spec.id] = { root: car.group.name === `car-model-${spec.id}`, wheels: wheels.every(Boolean),
        spin: !!byName('wheel-spin'), brakeParented, grounded: box.min.y >= rig.groundClearance - 0.08,
        radius: car.wheels.every(w => w.radius >= 0.28 && w.radius <= 0.44),
        paint: car.paintMats.length > 0 || d.CarRigs[spec.id].bakedPaint,
        logo: !!byName('logo-rear'), nitro: car.nitroTips.length === 2 }
      d.disposeCarTree(car.group)
      // cache-survives-dispose: second build must still be a real clone
      const again = d.buildCar(0xf27a1e, spec)
      out[spec.id].cache = again.group.name === `car-model-${spec.id}`
      d.disposeCarTree(again.group)
    }
    return out
  })
  ```
  PASS iff every flag true for all five. Keep the procedural wheel-fold rec **too**, gated behind `?proc=1` boot of a second page context (cheap insurance the fallback didn't rot) — name it `proc-wheel-fold-fallback`.

- [ ] **Step 2: Replace `caliper-colour-on-built-car`** with `glb-rig-data`: same `__dbg` loop, no build — assert per spec `Number.isInteger(rig.caliperColor)`, radii range, clearance range, `logoAnchor`/`nitroAnchor` finite. (The material-side caliper tint assertion can't survive baked textures per spec §7 — this is the agreed rig-equivalent.)

- [ ] **Step 3:** `garage-rebuilds-on-model`: replace spoke-count swaps with root-name swaps: before `car-model-s15` → after `__selectModel('centenario')` `car-model-centenario` → back `car-model-r34`, keeping the `top === r34Ref × 1.12` physics check. If `boot-retunes-physics`/`garage-rebuilds` still reference `spokeTotal`, keep `EXPECT_SPOKES` only inside the new `proc-wheel-fold-fallback` rec.

- [ ] **Step 4: `npm run functional` green. Commit** `test(cars): rig-integrity functional recs replace procedural internals`.

---

### Task 8 — Shots, attribution, docs, full gates

**Files:**
- Delete: `shots/car_model_{hero,hyper,grip,drift}.png`; Create: `shots/car_model_{r34,930,s15,centenario,terzo}.png` (generated)
- Create: `ASSETS.md`; Modify: `README.md`

- [ ] **Step 1: Regenerate.** `npm run shots && npm run audit` — the five new `car_model_*` shots must clear the **gameplay bar** (entropy ≥ 5.5, groundDistinct ≥ 40, groundGrayFrac ≤ 0.55). If a car's hero shot reads flat (matte dark paint on asphalt), nudge that car's paint signature (within palette) or its rig pose offset until the audit passes — do not lower audit thresholds.

- [ ] **Step 2: `ASSETS.md`** — attribution table: car, maker, model title, author (Lexyc16 / Lionsharp / autoNgraphic / SDC ×2), licence (CC-BY 4.0; Terzo CC-BY-NC 4.0 with the non-commercial note + the `REAL_BRANDING=false` / `?proc=1` clean-publish path), Sketchfab URL per UID (table at top of this plan). Add one line to `README.md` assets section pointing at it (governance.test pins only strings that remain).

- [ ] **Step 3: Full gate battery:**
  ```
  npm run test && npm run typecheck && npm run build && npm run noleak \
    && npm run functional && npm run perf && npm run shots && npm run audit
  ```
  `perf`: census will show the new mesh/tri counts — the hard gate is the frame-policy buckets; if tri budget regressed past spec (60k/car, 12 MB), go back to Task 4 budgets, do not touch gates.

- [ ] **Step 4: Commit** `feat(cars): real-car hero shots + attribution`.

---

## Explicit non-goals / untouched (do not "fix" these)

- `scripts/shots.mjs`, `scripts/audit-shots.mjs`, `scripts/noleak.mjs` — pinned source/token lists.
- Procedural `buildCar` internals, `detailPlanFor`/`detailPartCount`, `sharedCarMaterials` set (`assets.test.ts` requires ≥14), `spokeCountForStyle`, `validateCarShape` — all still exercised via the fallback path.
- AI colour reconciliation, paint storage chains, standings layout, garage DOM structure — behaviour preserved, only data (ids/names/counts) changes.
- Physics values beyond the catalog table (no changes to `VehiclePhysics`, `CarTuning`, `BASE_TUNING`).

## Known accepted deviations (from spec review, already agreed)

- Terzo is CC-BY-NC — accepted; `REAL_BRANDING`/`?proc=1` is the clean-publish escape hatch, documented in `ASSETS.md`.
- Paint masking is material-granular (spec's "picks body-panel material ids"), not per-triangle; a car whose body paint is baked into a shared UV atlas with trim ships with `bakedPaint: true` and keeps its baked colours (spec-sanctioned fallback).

## PR #21 review addendum (post-integration fixes)

The review round closed 15 findings. Deltas against the plan text above:

- `src/assets/CarRigs.ts` is GENERATED by `scripts/emit-rigs.mjs` from the
  pipeline reports (`npm run optimize-cars && npm run emit-rigs`) — the
  "paste the printed rig block" step is retired. `caliperColor` is not a rig
  field anymore: the caliper tint comes from the catalog through
  `carMaterialParamsFor`, so the functional caliper gate has teeth for all six.
- `CarRig` gained `lampZ` (measured lamp faces) and `logoAnchor` is now a
  MEASURED TAIL (+z) anchor; the badge no longer sits at the nose. The runtime
  honours `lampGlow` and `spec.rigId`. All six models bake their lamp
  textures, so `lampGlow` is false and the runtime glow rectangles are not
  attached — they were invisible inside the shell and floating slabs outside
  it (camfix captures, review round 2); the rig flag brings them back for any
  future lamp-less GLB, and the functional battery asserts clone mesh count
  vs flag in both directions.
- Wheel buckets label L/R by the WORLD layout (the 180°-flipped cars mirror
  x) — see the sign rule in `tests/cases/carassets.test.ts`.
- The logo decal, garage cards and standings all go through the
  `CAR.realBranding` × `identity.realBranding` gate at render time
  (`carDisplayName`), so flag-off ships no real badge or name.
- Prune gate is two-tier: >15% tri share WARNs and still drops; >30% keeps
  everything and demands review (plan step 3 and the script header now both
  document it — the earlier one-tier "keeps at 15%" wording was stale).
- README publishes the six-car catalog with ASSETS.md as the licence door;
  the four fictional-era `car_model_*` frames are retired.

Review round 3 (pipeline determinism + one transform) closed 14 further
findings. Second delta against the plan text:

- The pipeline reports are DURABLE: committed under `rigs/reports/` (they
  lived in disposable `build/`, so the emitted table was unregeneratable in
  CI). Each report carries `glbSha256`; `emit-rigs` re-hashes
  `public/models/<id>.glb` and refuses an out-of-sync GLB, then regenerates
  `src/assets/CarRigs.ts` byte-for-byte from the FIELDS table — one table
  drives validation, emitted order and the `CarRig` interface, so the
  generated file cannot drift from its validator.
- ONE pose transform (`toWorld`) is defined once; wheels, lamps, badge,
  nitro and the reported `worldBox` all flow through it. The nose sign can
  no longer be re-derived (or mis-derived) per measurement — round 3 found
  an x-sign, an end-swap and a label ternary each reading the same fact.
- Body scale is a 1st/99th-percentile of a corner cloud sampled from
  authored LEAF nodes under their own world matrices (weld/dedup merge the
  Sketchfab subtree into the first leaf; sampling group nodes re-baked
  world vertices and collapsed the pose scale 10x). Lamp/badge/nitro
  end-faces are the TRUE bbox extrema through `toWorld`, spike-guarded
  against the percentile surface — percentile-vs-percentile measured
  ±TARGET_LEN/2 for all six cars, which was the normalisation identity,
  not the body.
- Wheels ride their MEASURED hubs: `WheelHandle.hubY` from the rig, with
  `WHEEL_SINK` exported once from config (the literal lived in four sites).
  `caliperColor` left the rig table; the runtime nitro `+0.12` z-nudge left
  too — the pipeline bakes the anchor where the plume exits.
- The determinism claim is now double-run byte-identity of GLBs + reports
  (verified after every pipeline change), not per-car identity against the
  pre-feature baseline: the percentile scale legitimately moves all six
  models.
