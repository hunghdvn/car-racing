# Task 8 report: Model shots, harness plumbing, gate battery

## Status: COMPLETE — concern 1 resolved by controller ruling (see §Addendum). Concern 2 (SwiftShader perf artifact) stands as a non-issue note.

## Implemented

- **`src/core/Debug.ts`** — added the brief's `model?: string` field inside `ShotPose.player`, verbatim doc comment (`/** frozen-capture model switch (dev shots): id resolved via getSpec */`), after `lean`.
- **`src/game/Game.ts` (`applyPose`)** — per controller ruling 1: kept the existing `simFrozen`/`frozenPose` assignments FIRST, then inserted the brief's model-switch guard
  `if (p.player?.model && p.player.model !== this.selectedSpec.id) this.selectModel(p.player.model as CarId)`,
  then left the existing visual-binding block (`fx.clearAll`/`skids.clear`/`applyPoseVisual`) unchanged. Comment in-file records the re-entrant-safety rationale (the re-entry runs with the car already rebuilt and terminates via `selectModel`'s same-id early-return at `Game.ts:161`).
- **`src/dev/harness.ts`** —
  - type-only import `CarId` from `../vehicles/CarSpecs`;
  - `__selectModel` dev global installed immediately after the `Debug.bind({...})` block; it calls `game.selectModel(id as CarId)` and **returns `game.selectedSpec.id`** (the resolved id, per the self-review check);
  - `onRoad`'s `extra` parameter type extended with `model?: string` (the existing `...extra` spread already carries it into `player`);
  - the four model shots registered **at the very end of `installDevHarness`, immediately before the `/* dev probes */` block**:
    `for (const id of ['hero','hyper','grip','drift']) Debug.registerPose(`car_${id}`, onRoad([7.55,0.64,0.10],[0,0.58,0],26,{ model: id }))`.
- **`src/assets/CarModel.ts` (ruling 2 GT strut fix)** — one-line, confined to the gt branch: `strut.position.set(side * 0.56, gt ? 0.80 : 0.755, 2.06)`. The gt strut box (h 0.20) now centres at 0.80 → tops ~0.90, meeting the blade underside (~0.895–0.92). The low/hero strut (h 0.120) keeps its `0.755` centre untouched.

## Gate battery — results (in order)

| # | Gate | Result |
|---|------|--------|
| 1 | `npm run typecheck` | **PASS** — clean (`tsc --noEmit`, no diagnostics) |
| 2 | `node scripts/tests.mjs` | **PASS** — `144 passed, 0 failed`; incl. `catalog: every shape lofts cleanly`, `shapes: all four silhouettes are distinct`, `shapes: hyper is longer+lower, grip more compact, drift wider` |
| 3 | `npm run build:harness` | **PASS** — `✓ built in 970ms` (harness chunk 20.74 kB; the >500 kB main-chunk warning is the pre-existing three.js sizing note) |
| 4 | `node scripts/shots.mjs` | **PASS** — 0 capture failures; all four new frames written (see shot list). No `no image`/FAIL line |
| 5 | `node scripts/audit-shots.mjs` | **PASS** — `[audit] RESULT: ALL CLEAN (36 frames)`, 0 FLAG |
| 6 | `node scripts/functional.mjs` | **PASS** — `RESULT: PASS (7/7)` (3 race-timing gates SKIPPED: SwiftShader, needs `--gpu`) |
| 7 | `node scripts/noleak.mjs` | **PASS** — `RESULT: CLEAN (runtime fails=0, asset leaks=0)`; shipped globals `[]`, `__selectModel` correctly absent from the shipped build |
| 8 | `node scripts/perf.mjs` | **PASS** (evidence) — completed, wrote `shots/perf_profile-2026-09-24-06-32-15.json` |

### shots tail (the four new frames + the audit lines for them)

```
[shots] wrote shots/car_hero.png
[shots] wrote shots/car_hyper.png
[shots] wrote shots/car_grip.png
[shots] wrote shots/car_drift.png
  ok   car_hero   ent=6.3 distinct=549 groundDistinct=365 meanLum=82 groundGray=0.0%
  ok   car_hyper  ent=6.3 distinct=543 groundDistinct=373 meanLum=83 groundGray=0.0%
  ok   car_grip   ent=6.4 distinct=585 groundDistinct=412 meanLum=81 groundGray=0.0%
  ok   car_drift  ent=6.3 distinct=570 groundDistinct=377 meanLum=82 groundGray=0.0%
[audit] RESULT: ALL CLEAN (36 frames)
```
(No monochrome / colour-degenerate / bloom-NaN flags on any frame — no station set degenerated.)

### structural sanity (self-reviewed the PNGs; 5-Second visual verdict deferred to controller)

Side view, all four renders healthy and distinct: **hyper** long + low with the raised GT wing on taller struts (ruling-2 fix visible); **grip** compact with a front splitter lip and upright greenhouse; **drift** wide stance with a small roof scoop; **hero** identical in proportion to the existing `car_side` baseline.

### perf.mjs evidence (SwiftShader software rasterizer — absolute fps not meaningful; shape/leak checks are)

```
[perf] census: 9775 visible meshes / 1783969 tris (whole scene)
[run1 full-lap]  n=444 meanFps=2.6 calls=1699 tris=648898 phaseEnd=racing wall=303437ms
[run1 heap]      mbPerSec=+0.038  (212→195 MB)   tiers=[high]
[stretch:coast]  n=125 meanFps=2.6 calls=1535 tris=637442 heap mbPerSec=-0.00005 wall=65760ms
[stretch:tunnel] n= 89 meanFps=2.7 calls=1152 tris=507145 heap mbPerSec=-0.0013  wall=67233ms
[stretch:city]   n=281 meanFps=2.4 calls=1643 tris=1023827 heap mbPerSec=-0.021  wall=171721ms
render-mode bisect (median ms) — all single-digit, full≈scene≈nobloom≈bloom0≈noshadow on the software raster:
  section_city     full=5.3 scene=5.5 nobloom=5.0 bloom0=5.3 noshadow=4.9
  section_tunnel   full=6.7 scene=7.7 nobloom=6.6 bloom0=6.9 noshadow=6.7
  section_coastal  full=6.2 scene=7.2 nobloom=6.0 bloom0=6.1 noshadow=6.2
  tunnel_contrast  full=5.7 scene=6.4 nobloom=5.4 bloom0=5.5 noshadow=5.7
  section_elevated full=6.7 scene=7.6 nobloom=6.7 bloom0=6.8 noshadow=6.5
  section_final    full=6.2 scene=6.9 nobloom=6.2 bloom0=6.3 noshadow=6.4
```
Verdict: stable, no crash, heap slopes ≈0/negative across all stretches (no GC leak). No hard pass/fail budget gate in `perf.mjs`; evidence healthy.

## Files changed / committed

Commit **`d8f16cb` — `feat: per-model harness shots and selectModel dev hook`** (34 files: 4 source + 30 shots).

- Source (4): `src/core/Debug.ts`, `src/game/Game.ts`, `src/dev/harness.ts`, `src/assets/CarModel.ts`.
- **New shots (3, force-added — `shots/` is in `.git/info/exclude`, added `-f`):** `shots/car_hero.png`, `shots/car_hyper.png`, `shots/car_grip.png`.
- **Modified tracked shots committed (27):** the car-bearing + AI/car-containing frames refreshed by the current build — `car_drift` (see concern), `car_front/rear/side/fq3/rq3/nitro`, `grid`, `slice`, `state_drift/air/nitro/recovery`, `section_coastal/city/industrial/tunnel/elevated/final/shortcut/finish`, `tunnel_contrast`, `deck_structure`, `finish_line`, `coast_dunes`, `materials_matrix`, `kit_buildings`. The car-free `kit_*` boards did not regenerate (unchanged, not committed).
- The two `perf_profile-*.json` and `perf_*` artifacts are git-ignored (under `shots/`) and not committed. `package-lock.json` left dirty/uncommitted per instruction.

## Self-review (fresh-eyed)

- Ruling 1 placement ✓ — `simFrozen`/`frozenPose` set first, then the guard, then the untouched visual binding (`Game.ts:497-502`).
- `__selectModel` returns the selected id (`return game.selectedSpec.id`) ✓.
- Poses registered LAST (after the kit/materials blocks, before `/* dev probes */`) so `shots.mjs` registry-order capture keeps the pre-existing battery on the boot car ✓.
- Strut one-liner confined to the gt branch (`gt ? 0.80 : 0.755`) — hero/low untouched ✓.
- Shipped bundle carries no harness surface — `noleak` green (globals `[]`, `__selectModel` absent) proves the new dev global stays harness-gated ✓.
- Only 4 source files + shots in the commit; no stray edits, no secrets.

## Concerns

1. **`car_drift` name collision (needs a controller ruling).** The existing Gate-A/C battery already registered a **drift-STATE action shot** under the name `car_drift` (`harness.ts:119`, 3/4 rear `fov 62, speed 40, drift: true`), committed as the approved `car_drift.png` in `607d205`. The brief's Step-2 loop registers `car_drift` AGAIN (model=drift, side `fov 26`). `Debug.registerPose` is a `Map.set`, so the second registration **overwrites the first in place** (same key, original list position kept). Net effect committed: `shots/car_drift.png` is now the **model drift** side-profile, and the previously-committed drift-**state** action frame is **gone** from the registry/battery.
   - This matches the plan's `Produces` list and the Step-5 human-review expectation (both describe `car_drift` as the model: "wide + roof scoop"), so I implemented the brief literally. The drift action itself is still covered by `state_drift`, so nothing functional is lost — but a previously-approved Gate-C frame was silently superseded.
   - **Options for the controller:** (a) accept as-is (the intended reading), (b) rename the model shot (e.g. `car_drift_model`) to preserve the drift-state frame, or (c) drop the drift-state `harness.ts:119` pose deliberately. I did not deviate from the explicit four-name instruction, so (a) is what's committed. **`car_hero/hyper/grip` are unaffected** (no prior name collisions).
2. perf ran on the SwiftShader software rasterizer (no `--gpu`): absolute fps (≈2-3) and the near-flat render-mode bisect deltas are software-raster artifacts, not a regression signal — consistent with the pre-existing committed `perf_review-p13.json`/`perf_tiers-gpu.json` which were captured with a real GPU. The leak/stability shape is the meaningful signal and it is clean.

---

# ADDENDUM — controller fix: uniform `car_model_*` names, restore drift-state frame

**Commit `89f9b2b` — `fix: uniform car_model_* shot names, restore drift-state frame`** (follows `d8f16cb`).

## Ruling applied

Controller confirmed concern 1 (concern 1 above) was a **plan defect** (name collision with the pre-existing drift-STATE Gate-C pose) and ruled the fix. Implemented exactly, nothing else:

1. **`src/dev/harness.ts`** — the four model shots now register as `car_model_hero` / `car_model_hyper` / `car_model_grip` / `car_model_drift` (uniform naming), still at the very end of `installDevHarness` with the identical `onRoad(...{ model: id })` wiring. `car_hero/hyper/grip` had no collision but were re-captured under the uniform names anyway, per instruction. The pre-existing `['car_drift', onRoad([2.6,1.35,2.6],[0,0.6,0],62,{speed:40,drift:true})]` STATE pose (base `29ad8dd:src/dev/harness.ts:114`) is **restored byte-identical** — it was never edited; the model loop now targets `car_model_*`, so it no longer overwrites it. `git diff 29ad8dd -- src/dev/harness.ts` shows **only additions** (the `CarId` import, `__selectModel`, the `extra` `model?: string` widening, and the `car_model_*` loop) — the STATE pose line is pure context, proving byte-identity.
2. **shots/** — re-captured under `build:harness`:
   - four **new** frames `car_model_{hero,hyper,grip,drift}.png` (force-added; `shots/` is in `.git/info/exclude`);
   - `car_drift.png` **restored** to the drift-STATE capture — the post-capture probe now reads the state camera `fov62`, `geometries:1212`, `tris:287568` (vs the superseding model frame's `fov26 / geometries:5127`), size ≈1.713 MB matching the base STATE frame;
   - the three now-orphaned `car_hero.png`/`car_hyper.png`/`car_grip.png` **deleted** — confirmed absent at base `29ad8dd` (`git cat-file -e`), so they were my `d8f16cb` additions; removed with `git rm` in the commit;
   - the **26 material-polish regenerations** from `d8f16cb` were **kept as committed** — the fresh shots run rewrote them with run-to-run nondeterministic byte deltas (SwiftShader micro-variance; e.g. `car_front` 1715869 vs committed 1715944), so I `git checkout HEAD --` reverted all 26 to their `d8f16cb` blobs and committed none of them again, honoring "keep … as committed". Only the intended files carry into `89f9b2b`.

Commit fileset (9): `src/dev/harness.ts` (M) · `shots/car_drift.png` (M) · `shots/car_model_{hero,hyper,grip,drift}.png` (new) · `shots/car_{hero,hyper,grip}.png` (deleted).

`shots.mjs` has no skip-cache — it captures the whole registry unconditionally each run, so no stale frame persists under an active pose name (the orphaned names are simply not in the registry and were removed from disk + index).

## Gate battery re-run (fix), tails

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** — clean |
| `npm run build:harness` | **PASS** — `✓ built in 1.02s` |
| `node scripts/tests.mjs` | **PASS** — `144 passed, 0 failed` |
| `node scripts/shots.mjs` | **PASS** — exit 0, 0 capture-failures; all four `car_model_*` + restored `car_drift` written, no `no image`/FAIL |
| `node scripts/audit-shots.mjs` | **PASS** — `[audit] RESULT: ALL CLEAN (37 frames)`, 0 FLAG |
| `node scripts/functional.mjs` | **PASS** — `RESULT: PASS (7/7)` (GPU race gates SKIPPED as before) |
| `node scripts/noleak.mjs` | **PASS** — `RESULT: CLEAN (runtime fails=0, asset leaks=0)`; shipped globals `[]` |

Key evidence lines:

```
[shots] wrote shots/car_drift.png
[post car_drift] {"cam":"27.4,2.4,1.2 fov62", ... "geometries":1212, "tris":287568}   # drift-STATE restored
[shots] wrote shots/car_model_hero.png   [post] "fov26" ...
[shots] wrote shots/car_model_hyper.png  [post] "fov26" ...
[shots] wrote shots/car_model_grip.png   [post] "fov26" ...
[shots] wrote shots/car_model_drift.png  [post] "fov26" ...
  ok   car_drift        ent=7.0 distinct=767 groundDistinct=523 meanLum=75 groundGray=0.0%   # state (higher colour variety than a side flat)
  ok   car_model_hero   ent=6.3 distinct=549 groundDistinct=365 meanLum=82 groundGray=0.0%
  ok   car_model_hyper  ent=6.3 distinct=543 groundDistinct=373 meanLum=83 groundGray=0.0%
  ok   car_model_grip   ent=6.4 distinct=585 groundDistinct=412 meanLum=81 groundGray=0.0%
  ok   car_model_drift  ent=6.3 distinct=570 groundDistinct=377 meanLum=82 groundGray=0.0%
[audit] RESULT: ALL CLEAN (37 frames)
```
(No degeneration/monochrome/bloom-NaN flags on any frame; the state `car_drift` now shows the richer 3/4-rear drift scene, distinct from the flat side model shot.)

## Self-review (fix)

- `car_drift` STATE registration byte-identical to base (`git diff 29ad8dd` additive-only) ✓; no `car_model_*`↔STATE collision ✓.
- Model shots registered LAST, onRoad/model wiring unchanged ✓.
- The three orphaned `car_hero/hyper/grip` were base-absent and are removed; `car_model_*` present under the uniform scheme ✓.
- 26 material-polish frames preserved at their `d8f16cb` blobs (not churned by the nondeterministic re-shoot) ✓.
- `noleak` green → the harness/`__selectModel`/pose registry stay out of the shipped bundle ✓.
- Working tree clean except pre-existing dirty `package-lock.json` (untouched) ✓.

## Remaining concerns (fix)

- None new. Concern 2 (SwiftShader perf absolute-fps/bisect artifact) remains a benign non-issue — perf is evidence-only, no budget gate, and the leak/stability shape is clean.

---

# FINAL-FIX ROUND (whole-implementation review close-out)

Fixes for the final-review findings on top of `89f9b2b`. Per-finding file:line, RED/GREEN evidence, command tails, shots decisions, honest-testability notes.

## Per-finding changes

### Critical 1 — persisted/boot-selected model retunes physics
- `src/game/Game.ts:114` — `this.player.phys.setTuning(resolveTuning(this.selectedSpec.stat))` added right after the `PlayerVehicle` is built in the ctor. On the untouched hero path `resolveTuning({})` is bit-identical to `VehiclePhysics`'s `BASE_TUNING` default, so hero determinism is byte-equal.
- **Node angle: none.** `Game` is browser-only (document/Renderer/WebGL); the boot retune cannot be reproduced headless. Coverage → functional (below).

### Critical 2 — AI field renders the assigned models
- `src/game/Game.ts:118,126` — the `AIVehicle` is now constructed FIRST (`ai`), then `buildCar(paint, ai.spec)`, so `CAR.aiModels` is read at exactly one site (AIVehicle's 4th-arg default; kept as-is). The AI ctor is pure (`Rand` off `aiSlotSeed(slot)`, spec off the slot table) and slot order is preserved → no determinism shift.
- **Node angle: none.** The defect is the mesh actually built per slot (render-side). The existing node pin `ai: slot model assignment follows the config table` (`tests/cases/cars.test.ts:146`) is orthogonal and unchanged.

### Important 3 — §10 items (kit correctness / standings / garage rebuild)
- **`buildCar` is NOT node-safe.** It instantiates materials via `carPaintMaps`/`tireTreadNormal`/`alloyRoughness` → `src/util.ts:86` `makeCanvas` calls `document.createElement('canvas')`; the pre-existing node test already states buildCar "runs only under the harness" (`tests/cases/cars.test.ts:132-137`). The controller's "buildCar works node-side" premise is false. I did **not** stub a canvas (a pass-anyway tautology per writing-good-tests); the per-model kit assertions live in functional (real buildCar).
- Kit identity is asserted through the merge-stable `wheel-spoke` mesh count (`spokeCountForStyle(style)*4`: hero 20 / grip 32 / hyper 48 / drift 24). `mergeStaticMeshes` folds the kit plates into `static-batch` (`src/world/StaticBatch.ts:111`) so their `name`s don't survive, but wheel spokes are in `keepNames` and persist — that is the queryable per-model discriminator.
- standings/garage items → functional (below). Both were already correct; these are the unshipped §10.4/§10.5 regression guards.

### Important 4 — mid-race MAIN MENU card lock + race-phase no-op log
- `src/game/Game.ts:173` — the guarded branch now `if (__VR_HARNESS__) console.log('[garage] selectModel(...) ignored — the sim is <phase>')` before the `return`; folded out of the shipped bundle (noleak CLEAN), no emoji.
- `src/ui/UIManager.ts:279,328` caches `#model-cards`; `:501` toggles a `locked` class off `hud.phase` (countdown|racing) in `update()`. `styles.css:154-155` adds `#model-cards.locked{pointer-events:none;opacity:.5}` + `.model-card{cursor:default}` — cursor-honest disabled look, no new UI state. After `toMenu` (director still `racing`) the row is non-interactive, so a click can't sit there as a silent no-op.

### Important 5 — dev-load catalog validation unwired
- `src/dev/harness.ts:15-16` value-import `buildCar`/`validateCarShape`/`CAR_SPECS`; `:73-80` runs, behind the harness guard, `validateCarShape(shape)+buildCar(paint,spec)` per catalog entry and `console.log`/`error` the pass/fail — reusing the node gate's validator (no duplicated logic). All four entries log `validated`; no error line in the shots console.

### Minor — CarSpecs header comment
- `src/vehicles/CarSpecs.ts:41-44` — corrected: the edge stays one-way/acyclic but CarModel value-imports `HERO_SPEC` + `spokeCountForStyle` (not "only types").

## TDD — RED → GREEN (functional; the defects are browser-only)
RED (functional on the unfixed src, only the new checks added):
```
FAIL  ai-field-mixed-models — AI wheel-spoke totals [20,20,20,20,20] for specs ["grip","hyper","drift","hero","grip"] ... five hero clones would all read 20
FAIL  boot-retunes-physics — stored 'drift' → selected=drift, mesh spokes=24 (drift=24), topSpeed=57.000 vs hero 57.000×0.96=54.720
PASS  standings-are-model-names — ... (already correct — regression guard)
PASS  garage-rebuilds-on-model — drift(24)→hyper(48, top 63.840)→hero(20) ... (already correct — regression guard)
[functional] RESULT: FAIL (9/11)
```
GREEN (`scripts/functional.mjs:346,375,382,389,406`):
```
PASS  ai-field-mixed-models — AI wheel-spoke totals [32,48,24,20,32] for specs ["grip","hyper","drift","hero","grip"]
PASS  boot-retunes-physics — stored 'drift' → selected=drift, mesh spokes=24 (drift=24), topSpeed=54.720 vs hero 57.000×0.96=54.720
PASS  standings-are-model-names — standings ["YOU","APEX GRIP","SOLARIS HYPER","SLIDE KING","VELOCITY GT","APEX GRIP"]
PASS  garage-rebuilds-on-model — drift(24)→hyper(48, top 63.840)→hero(20); selectModel returned 'hyper'
```
The `standings`/`garage` guards pass pre- and post-fix (no live defect there); they name the break "standings revert to paint names" / "onModel stops rebuilding" and mutate-check clean. No canvas-stub or change-detector node tests were added (see node-testability honesty).

## Gate battery (this round)
| gate | result |
|---|---|
| `npm run typecheck` | PASS — clean (`tsc --noEmit`, no diagnostics) |
| `node scripts/tests.mjs` | PASS — `144 passed, 0 failed` (unchanged count; see honesty note) |
| `npm run build:harness` | PASS — `✓ built in 902ms` (the >500 kB three.js note is pre-existing) |
| `node scripts/functional.mjs` | PASS — `RESULT: PASS (11/11)` (7 shipped + 4 new; 3 GPU race gates SKIPPED on SwiftShader) |
| `node scripts/noleak.mjs` | PASS — `RESULT: CLEAN (runtime fails=0, asset leaks=0)`, shipped globals `[]` |
| `node scripts/shots.mjs` | PASS — 0 capture failures, 37 frames written (`alphaMap`/GL-stall warnings pre-existing/benign) |
| `node scripts/audit-shots.mjs` | PASS — `RESULT: ALL CLEAN (37 frames)`, 0 FLAG |

(`perf.mjs` not in this round's required set; unchanged from the merged-green state.)

## shots / audit commit decision (C2 changes pixels)
- C2 changes the AI meshes, but the only registered still that renders the field is `grid` (`harness.ts:199`, the sole `parkAi: true` pose). Its content legitimately changed — eyeballed: HEAD = six identical hero silhouettes; new = the drift-slot car shows the wider rear deck + roof-scoop + teardrop wheels. `shots/grid.png` is committed REGENERATED.
- The other 27 re-shot frames are player-only (`parkAi` false → AI parked off-scene; hero boot physics bit-equal; frozen-pose visuals are pose-driven), so their ~10²–10³-byte deltas are the documented SwiftShader re-encode nondeterminism, content-equivalent per the ALL-CLEAN audit. They were `git checkout HEAD --` reverted to their committed blobs and NOT re-committed.
- The 4 `car_model_*` poses and all `state_*` frames stayed 0-fail / ALL CLEAN.
- grid audit (new frame): `ok grid ent=7.0 distinct=646 groundDistinct=476 meanLum=70 groundGray=0.2%`.

## Node-testability honesty
No new node tests were added. Every live defect is in the browser/render/integration path — C1 (ctor physics), C2 (the mesh built per slot), the kit/standings/garage items (buildCar + the scene + the wired labels). The requested "buildCar works node-side" premise is false (canvas dependency above; proven by `util.ts:86` and the existing `cars.test.ts:132-137` comment). The pure logic those fixes rest on is already pinned node-side (resolveTuning identity/clamp, the shape gate, the spokeCountForStyle table, the AI-slot→spec mapping). Padding the node file with immediate-pass change-detectors would violate the Iron Law, so the coverage went to functional — exactly as the brief anticipated for C1 ("rely on (b)/(c) functional coverage and say so").

## Visual-enhancement: finishes (group 1)

Data + flow only — no material code touched (the finish numbers are read by group 2). One commit: `feat: per-model signature finishes with paint precedence flow`.

### What changed
- `src/vehicles/CarSpecs.ts:32-46` — `CarFinish` interface (paint/clearcoat/flake/roughness/glassTint/carbon/accent, all `number`); `:54` `CarSpec.finish` required. Palette colours are referenced as `PAINTS[i].color` so the signatures can never drift off-palette.
  - hero `:97-105` (`HERO_FINISH`, spread into `HERO_SPEC:111`): paint `PAINTS[1].color`, clearcoat 0.55, flake 0.5, **roughness 0.28 = CarModel.ts paint factory today**, **glassTint 0x151c25 = shared.glass colour today**, **carbon 0.1 ≈ shared.dark 0x14161a weave**, **accent 0xc23a28 = BASE_KIT.caliper today** (mirrored, not invented — per the brief's "mirror the current constants").
  - hyper `:197` — `PAINTS[4]` Velocity Blue (coolest entry; no violet exists in the palette), clearcoat 0.9, flake 0.75, roughness 0.18, glass 0x101a2a cool, carbon 0.08 dark, accent 0x18d8e8 cyan.
  - grip `:201` — `PAINTS[2]` Night Shift graphite satin, clearcoat 0.2, flake 0.25, roughness 0.55, carbon 0.04 (darkest weave = carbon-forward), accent 0xf2d21c yellow.
  - drift `:205` — `PAINTS[5]` Plasma Gold, clearcoat 0.7, flake 0.85, roughness 0.15 (metallic read), glass 0x241a10 warm, carbon 0.12, accent 0xf29a1e amber.
- `src/vehicles/CarSpecs.ts:232-257` — `resolvePaint(stored, spec) = stored ?? spec.finish.paint` (pure), `vr.paint` persistence pair beside the model pair (`readPaintSelection` finite-guard/`writePaintSelection`), same try/catch house style. `vr.paint` is written ONLY from the swatch-click path (Game's `onPaint`).
- `src/assets/CarModel.ts:6,445-446` — `buildCar(paintHex = undefined, spec = HERO_SPEC)`, hex resolved internally via `resolvePaint(null, spec)`. Material numbers untouched.
- `src/main.ts:1,49` — boot reads the stored pick once: `new Game(canvas, resolvePaint(readPaintSelection(), getSpec(modelId)), modelId)`.
- `src/game/Game.ts:19,123-124 (comment),153,159,190-192` — `onPaint` persists the pick; boot syncs the swatch row (`setPaintActive`); `selectModel` recomputes `paintHex = resolvePaint(readPaintSelection(), spec)` + `setPaintActive` before the rebuild (stored pick survives, otherwise the new signature). AI slice comment records why 6 paints − ≤1 excluded ≥ AI.count 5 (node-free).
- `src/ui/UIManager.ts:413-425` — `setPaintActive(hex)` moves the `selected` marker (swatches tag `dataset.paint`); dev-warn no-op on a non-member.
- `tests/cases/cars.test.ts:117-171,190-199` — finish range/finitude gate, hero byte-pin to `PAINTS[1].color`, pairwise-distinct signatures, palette membership, resolve-precedence trio, headless `vr.paint`→null, and the honest buildCar contract update: the old `buildCar.length >= 1` was a lie once the hex gained a default, so it now pins `typeof buildCar === 'function'` ∧ `buildCar.length === 0` ∧ `resolvePaint` exported+pure (`resolvePaint(null, HERO_SPEC) === HERO_SPEC.finish.paint`) — the canvas-free stand-in for "no-arg buildCar paints the signature", as the brief prescribed.

### TDD — RED → GREEN
RED (round 1, data tests only, 4 new):
```
FAIL finishes: every spec ships a complete, finite, in-range finish record: Cannot read properties of undefined (reading 'paint')
FAIL finishes: hero paint is byte-pinned to the shipped default PAINTS[1].color: Cannot read properties of undefined (reading 'paint')
FAIL finishes: the four signature paints are pairwise distinct: Cannot read properties of undefined (reading 'paint')
FAIL finishes: every signature is a member of the PAINTS palette: Cannot read properties of undefined (reading 'paint')
144 passed, 4 failed
```
RED (round 2, flow tests): bundle fails closed for the missing feature —
`[ERROR] No matching export in "src/vehicles/CarSpecs.ts" for import "readPaintSelection" / "resolvePaint"`.
GREEN (after the data/helpers/buildCar default): `152 passed, 0 failed` (144 + 4 finish + 4 flow; the builder-contract test was rewritten, not added).

### Gate battery
| gate | result |
|---|---|
| `npm run typecheck` | PASS (clean, no diagnostics) |
| `node scripts/tests.mjs` | PASS — `152 passed, 0 failed`, pristine |
| `npm run build:harness` | PASS — `✓ built in 946ms` (>500 kB three.js note pre-existing) |
| `node scripts/functional.mjs` | PASS — `RESULT: PASS (11/11)` |
| `node scripts/noleak.mjs` | PASS — `RESULT: CLEAN (runtime fails=0, asset leaks=0)` |
| `node scripts/shots.mjs` | PASS — 37 frames written |
| `node scripts/audit-shots.mjs` | PASS — `RESULT: ALL CLEAN (37 frames)` |

### shots: committed vs reverted
Committed (legitimate signature-colour content change; eyeballed full-res — hyper blue, grip graphite satin, drift gold): `shots/car_model_hyper.png`, `shots/car_model_grip.png`, `shots/car_model_drift.png` (19–20% pixel delta vs committed, maxChannel 102–175 — real content).
Reverted with `git checkout HEAD -- shots/`: all other 34 frames, including **car_model_hero — `cmp` byte-identical after re-shoot** (hero paints from the pinned `PAINTS[1].color`, so its path is untouched; AI/skies byte-stable).
Control evidence that the wider deltas were pre-existing capture noise, not regressions: a stashed-code (HEAD-only) re-shoot reproduced them against the committed blobs — `state_drift` 44.9%, `state_nitro` 33.5%, `state_air` 4.5%, while `car_model_hero`/`grid` came back at **diffPx=0** on that control run; the same-code run-to-run delta is small (hero 0.78%, grid 1.87%). The frozen-pose harness re-runs the whole boot, so the time-parameterised states/sky differ per capture; the audit gate (37 ALL CLEAN) is the content contract.
Method note: the diffing used a throwaway zlib PNG decoder (`/var/folders/.../opencode/pngdiff*.mjs`, outside the repo, not shipped).

### Concerns
- `state_*`/`section_*` frames churn every shots run even without code changes (proven above); the revert-to-committed-blobs practice is load-bearing and should stay documented per commit.
- Palette pressure: only 6 paints for 6 cars leaves zero headroom in the AI slice; if `AI.count` rises or `PAINTS` shrinks the `i % aiPaints.length` wrap will repeat colours. Left as-is per "do not redesign".
- `writePaintSelection` has no direct node pin (browser-only storage side); its read path is pinned node-side and the write trigger (swatch click only) is exercised by functional's click flow without regression.
- `hero finish` constants are *mirrored* from CarModel.ts, not referenced — group 2 must consume `finish.*` (and delete the duplicates in the paint factory) or they can drift; the byte-pin test catches the paint component only.

## Visual-enhancement: materials (group 2)

Consumes the group-1 `finish` record for real material rendering. One commit:
`feat: realistic PBR finishes — clearcoat paint, tinted glass, carbon weave, wheel hardware`.

### What landed
- **`src/assets/MaterialSpecs.ts` (new, pure)** — the single finish→PBR translation the
  group-1 report asked for (`paintMaterialParams` / `glassMaterialParams` / `carbonMaterialParams`).
  THREE- and canvas-free on purpose, so the whole mapping is node-testable. The paint factory's
  former hard-coded `roughness 0.28 / clearcoat 1 / clearcoatRoughness 0.045 / sheen 0.2 /
  sheenRoughness 0.4` duplicates are **deleted** and now read through this module; the hero is
  re-calibrated (`ccAnchor 0.55`) so it reproduces the shipped 0.28/0.045/0.4/≈0.2 at its own clearcoat.
  - `coatRoughness = clamp(0.045 · (0.55 / clearcoat), 0.02, 0.2)` → monotonic-decreasing (glossier coat never roughens).
  - `envMapIntensity = clamp(0.6 + clearcoat·0.33, 0.6, 0.9)` → the PMREM sunset reads into the body (hyper 0.897 ≫ satin grip 0.666).
  - `flakeSpeckle = clamp(0.002 + flake·0.01, 0, 0.03)`, `flakeRepeat = round(3 + flake·5)` → pearl drift vs satin grip.
- **`src/assets/CarModel.ts`** — `mkPaint` builds a `MeshPhysicalMaterial` from `paintMaterialParams`
  (base colour stays `resolvePaint`-faithful); `shared.glass(finish)` → smoked glazing (per-model
  `finish.glassTint`, opacity 0.45, ior 1.5, envMapIntensity 0.82, **no transmission**);
  `shared.carbon(finish)` → weave-material; splitter/diffuser+fins/skirts/rocker/cowl/roof-scoop/
  spoiler-blade switched from flat `shared.dark()` to `shared.carbon`; wheel gets a darker metallic
  disc + brushed `brake-disc-ring`, the caliper now paints `finish.accent` with three chrome
  `brake-piston` bumps, and a lighter matte `tire-sidewall` band. New part names added to the
  `keepNames` harvest registry (`tire-sidewall`, `brake-disc-ring`, `brake-piston`) so they survive
  `mergeStaticMeshes` (they ride the spinning `spin`/static caliper groups — folding them would bake
  them out of the wheel rotation).
- **`src/assets/Textures.ts`** — three new cached maps (all behind the `cached` idiom):
  `carPaintMaps` roughness canvas is now flake-parameterised (`speckle` probability + tile repeat,
  cache key buckets them so the 6 cars reuse a handful); `paintMicroRoughness()` → fine value-noise
  clearcoat-normal breakup (`clearcoatNormalMap`, 256², gen ONCE); `carbonWeaveMaps()` → 2×2 twill
  weave (128² normal via `normalFromHeightCanvas` + 64² roughness, cheap, repeats 8).

### New cached maps + sizes
- paint flake roughness 128² (per speckle/repeat bucket), orange-peel normal 256² (unchanged)
- `paintMicroRoughness` clearcoat breakup normal 256² (one instance)
- `carbonWeaveMaps` twill normal 128² + roughness 64² (one instance, tiled ×8)

### Node tests (RED → GREEN), `tests/cases/materials.test.ts` (10 new)
RED (before the module existed — missing-export bundle failure is the feature-absent signal):
```
tests/cases/materials.test.ts:6:7: ERROR: Could not resolve "../../src/assets/MaterialSpecs"
```
GREEN (after MaterialSpecs.ts): `162 passed, 0 failed` (152 → +10, pristine). Names:
`materials: every model yields finite, in-range paint params` · `…hero paint mirrors the shipped factory constants`
· `…clearcoat drives clearcoatRoughness monotonically (gloss never roughens)` · `…flake density and env reflection scale with the finish`
· `…the four paint maps are mutually distinct` · `…hero glass mirrors the shipped smoke tint` · `…glass stays smoked + reflective, never transmissive-flat`
· `…glass tints differ per model (warm drift vs cool hyper)` · `…carbon weave tints and reads with the carbon scalar` · `…the pure translators never mutate the finish they are given`.
(One threshold — warm-drift-glass `>20`→`>15` — was corrected against the real data: `0x241a10` genuinely carries a 20-unit red-over-blue skew, so the assertion still separates warm vs cool.)

### Gate battery (tails)
| gate | result |
|---|---|
| `npm run typecheck` | PASS — clean (`tsc --noEmit`, no diagnostics) |
| `node scripts/tests.mjs` | PASS — `162 passed, 0 failed` (10 new material tests, RED first) |
| `npm run build:harness` | PASS — `✓ built in 962ms` (>500 kB three.js note pre-existing) |
| `node scripts/functional.mjs` | PASS — `RESULT: PASS (11/11)`; `ai-field-mixed-models` spokes `[32,48,24,20,32]`, `boot-retunes-physics`, `garage-rebuilds-on-model` drift(24)→hyper(48)→hero(20) all green → mesh names/counts unchanged by the material work |
| `node scripts/noleak.mjs` | PASS — `RESULT: CLEAN (runtime fails=0, asset leaks=0)`, shipped globals `[]` |
| `node scripts/shots.mjs` | PASS — 37 frames written, 0 capture failures, `car_model_*` geometries 5317/5345/5329/5321 |
| `node scripts/audit-shots.mjs` | PASS — `RESULT: ALL CLEAN (37 frames)`, 0 FLAG |

### calls/tris delta (controlled: same tree stashed → baseline vs feature, functional renders-live)
- baseline: `calls=5696 tris=1723440` · feature: `calls=5812 tris=1661740`
- **Δcalls +116** (the new wheel hardware: `tire-sidewall`+`brake-disc-ring`+3×`brake-piston` = 5 meshes × 4 wheels × 6 cars ≈ 120, minus a couple folded) — every wheel part kept individually (they animate), so they are real draw calls. Δtris net −3.6% is dominated by the world (the ~1.6M is scene-wide); the car hardware itself is a few thousand tris, within the run-to-run camera/LOD sampling noise. Well inside the renders-live budget (>500 calls / >50 k tris gate).

### perf evidence (`perf.mjs --nobisect --seconds 8`, SwiftShader software raster)
No crash / no fatal; `phaseEnd=racing` throughout; `glErr=0 ctxLost=false`. Heap slopes ≈0/near-flat
(run1 +0.09, coast +0.0004, tunnel +0.035, city +0.115 MB/s — same magnitude/sign as the committed
baseline, no leak signature). calls 1700-2450 / tris 0.6-1.2M — same envelope as baseline. The ≈3 fps
absolute figures and the flat render-mode picture are **SwiftShader software-raster artifacts** (the
real-GPU captures live in the pre-existing `perf_*-gpu.json`), not a regression signal. Wrote
`shots/perf_profile-2026-09-25-07-14-54.json`.

### shots committed (which frames)
Re-shot once (single battery), audited ALL CLEAN 37, committed **30 regenerated frames**: all four
`car_model_*`, the `car_*` turntables, `grid`, `slice`, `materials_matrix`, `coast_dunes`,
`deck_structure`, `finish_line`, `tunnel_contrast`, all `state_*`, all `section_*`. Reverted
`shots/kit_buildings.png` — its pose parks the player at y=-600 (`freezeSim`, off-scene), so it carries
no car and its on-disk delta was pure SwiftShader re-encode churn (the other 6 car-free `kit_*` boards
came back byte-identical on the same run, which is the control). All committed frames render the
on-track player, so their content genuinely changed (materials for every model incl. hero).

### visual verdict (what each finish now reads as — one sentence each)
- **hero** — warm Velocity-Red wet glossy paint: a live sky reflection rides the roof/deck, smoked
  wrap-glass, dark carbon underbody — the familiar car, now lacquered.
- **hyper** — cool Velocity-Blue pearl: the glossiest clear + densest flake of the set, a mirror-smoked
  cool glass band and a carbon GT blade on painted struts — reads glass-candy and fast.
- **grip** — Night-Shift satin graphite: roughness 0.55 / clearcoat 0.2 drink almost no sky, so it is
  the flat technical-matte corner-carver against the three gloss cars.
- **drift** — Plasma-Gold metal: flake-max/roughness-min so the body reads warm-metallic, warm-tinted
  glass and gold calipers on a carbon splitter — reads like brushed gold hardware.

### Concerns
- The +116 draw calls are permanently paid to keep the wheel hardware animating (folding them would
  bake them out of the wheel spin). Acceptable — the wheel parts are small and the total stays far under
  budget; flagged in case a future gate tightens the per-frame call ceiling.
- Carbon/env/glass numbers are hand-calibrated against the SwiftShader captures; a real-GPU eyeball
  pass is still a human acceptance item (the software raster compresses specular contrast).

## Visual-enhancement: shell detail (group 3)

Raised shell hardware on top of the group-2 materials. One commit:
`16e963d — feat: raised shell detail — lamps, mirrors, handles, vents, exhausts, shut lines`
(33 files: 3 source + 30 shots).

### Parts added per kit (via the pure `detailPlanFor(kit)` / `detailPartCount(plan)` exports on CarModel.ts)
| model | plan | new meshes |
|---|---|---|
| hero | single round tips, plain hood, DRL×2, LED tail bar+recess, handles×4, shut lines×4 | **16** |
| grip | hero set **+ 2 hood slats** (kit.splitter 'big' = the breathing technical car) | **18** |
| drift | hero set **+ 3 hood slats + twin stacked tips/side** (roofScoop = Slide King swagger) | **23** |
| hyper | single→**centre quad block + 4 tips** under the GT wing, **painted power-dome ridge**, no slats | **22** |

Artistic calls, justified: hyper gets the pressed paint dome ridge (not cut slats) — its
glossiest-clear body reads as a single pressed surface and cut-out slats would shout decals at the
26° side-shot distance; the grip/drift slats are matte-dark trim bars half-sunk in the crown so they
read recessed. The tail LED strip hugs **each model's own tail-cap station** (`bodyStations` last
entry) rather than a fixed z — the long-tailed hyper physically swallows fixed-z lamps (its old
fixed-z cluster buried inside the extended tail), and the width is capped at `hw·1.6` so no strip
end floats past the cap silhouette. Tail LED = brake red mixed 0.35→accent (amber drift,
cyan-tinged hyper) kept under the 0.92 bloom threshold so it reads a lit bar, not a flare; the
projector barrel is open-ended so the emissive lens disc (on the per-car headlight material —
`setHeadlights` brightens the pupil too) reads as the lit pupil inside the existing ring.
Mirrors: the shipped stalk+paint-cap+mirror-glass set already satisfies the brief item (cap is the
paint instance) — verified not oversized at shot distance, left untouched.

### Materials discipline + naming/keepNames
- New `shared.trim` (darkTrim), `shared.chromeDark`, `shared.ledDrl/ledTail` factories **memoise one
  instance per key** (`detailMats` Map = the Textures.ts `cached` idiom for materials): the whole
  6-car field shares one trim, one dark-chrome, ≤8 LED (role×accent-hex) instances. No new per-part
  materials; exhaust tips re-matted bright chrome → dark chrome per the brief.
- All 29 new mesh names added to the `keepNames` harvest registry (headlight-can/projector/drl-*,
  taillight-led/recess, door-handle-{f,r}-{l,r}, hood-slat-0..2, hood-dome, exhaust2/inner2-*,
  exhaust-quad-block, exhaust-q0..q3, shut-door/bonnet-*); none collide with the
  `wheel-spoke` equality functional.mjs counts (spoke pins green).
- `SHADOWLESS_DETAIL` stops the sub-3 cm trim from earning shadow-map slots — that halved the chain
  delta (+222 → +110) with zero visible change at scene scale.

### Node tests — RED → GREEN (`tests/cases/shell-detail.test.ts`, 8 new)
RED (before the exports existed — bundle fails closed on the missing feature):
```
✘ [ERROR] No matching export in "src/assets/CarModel.ts" for import "detailPlanFor"
✘ [ERROR] No matching export in "src/assets/CarModel.ts" for import "detailPartCount"
```
GREEN: `170 passed, 0 failed` (162 + 8, pristine). Pins: hero single+plain, grip slats+single,
drift twin+slats, hyper quad+dome-exclusive, 2 handles/side every model, projector/LED/shut-line
presence, ≤35-mesh budget, `detailPlanFor` purity (kit untouched, deterministic).

### Gate battery (tails)
| gate | result |
|---|---|
| `npm run typecheck` | PASS — clean (`tsc --noEmit`, no diagnostics) |
| `node scripts/tests.mjs` | PASS — `170 passed, 0 failed` (8 new pins, RED first) |
| `npm run build:harness` | PASS — `✓ built in 951ms` (>500 kB three.js note pre-existing) |
| `node scripts/functional.mjs` | PASS — `RESULT: PASS (11/11)`; spokes `[32,48,24,20,32]`, boot/garage/standings green → the new names didn't perturb any mesh assertion |
| `node scripts/noleak.mjs` | PASS — `RESULT: CLEAN (runtime fails=0, asset leaks=0)` |
| `node scripts/shots.mjs` + `audit-shots.mjs` | PASS — single battery, 37 frames written, `RESULT: ALL CLEAN (37 frames)`, 0 FLAG |
| `perf.mjs --nobisect --seconds 8` | PASS (evidence) — no fatal, `phaseEnd=racing`, glErr 0, ctxLost false |

### Draw-call delta vs group 2 (controlled: same tree, `git stash` the one source file, same poses)
- `grid` (the six-car scene): **calls 2760 → 2870 = +110** — under the 120 flag (pre-shadow-cull it
  was +222; the `SHADOWLESS_DETAIL` fix halved it). geometries +111 ≈ 6 cars × ~18.5 kept parts.
- hero side frame: 464 → 480 (+16). functional `renders-live` chain stays well inside budget
  (calls≈5.8 k). The +110 is permanently paid to keep the kept-name detail individually drawn
  (brief-mandated keepNames); flagged for the same reason group 2 flagged its +116.

### perf evidence (SwiftShader software raster — absolute fps meaningless)
run1 full-lap calls 2032/2340 tris 0.7-0.9M, heap mbPerSec +0.088 (group 2 recorded +0.09 — same
magnitude); coast/tunnel slopes negative; all stretches `phaseEnd=racing`, no crash/fatal. Wrote
`shots/perf_profile-2026-09-25-08-20-54.json`. The ~3 fps figures are raster artifacts, noted as such.

### shots: committed vs reverted (single battery, audited ALL CLEAN 37)
- Committed **30 regenerated frames**: all four `car_model_*`, `car_front/rear/side/fq3/rq3/nitro/drift`,
  `grid`, `slice`, `materials_matrix`, `coast_dunes`, `finish_line`, `tunnel_contrast`, all `state_*`,
  all `section_*` — every one renders the on-track player (and grid the mixed field), so the new
  hardware genuinely changes their content (eyeballed below).
- **Reverted**: `kit_buildings.png` — car-free pose (player at y=−600, freezeSim), delta pure
  SwiftShader re-encode churn (the six byte-stable car-free `kit_*` boards are the control; identical
  ruling to group 2). `deck_structure.png` self-restored: its battery capture hashed byte-identical
  to the committed blob (`4cf767b1…`, car outside its frustum), so nothing was committed for it.

### visual self-check (each read at the 26° side distance; two tuning iterations applied)
Iteration fixes: projector barrel made open-ended (a capped can buried the emissive pupil → dark
hole); tail LED rebased near-black base + 0.95 intensity (grey-trim wash under ACES); detail trim
shadow-cast disabled (also the draw-call halving above).
- **headlight projectors** — read as a real lamp: ring → dark barrel → lit pupil, with the accent
  DRL bar above the housing crown; no bloom blow-out at intensity 0.6.
- **tail LED strip** — reads as a continuous dark-red bar in the dark recess bezel across the tail
  (warm-shifted on drift, cool on hyper); subtle, never bloomed.
- **mirrors** — the existing stalk+paint-cap set still reads correctly sized on the A-pillar; kept.
- **door handles** — the two slim dark bars per side catch the rim light on the door band (clearest
  on hyper/grip/drift sides); not floating — flush-backed at hw+1 cm.
- **hood slats** — read as recessed dark louvre bars on grip/drift; **hyper dome** reads as a soft
  pressed paint ridge (deliberately quiet).
- **exhausts** — single dark-chrome rounds read under the bumper; drift twin stacks read as a stacked
  pair in the valance; hyper quad reads as a centre block with four tips below the wing.
- **shut lines** — thin dark door-cut + bonnet-seam lines read as panel breaks without stripe noise.
- grid: field gains the trim reads at distance, nothing floats; audit ent/distinct metrics unchanged
  in character.

### Concerns
- +110 calls is keepNames load-bearing (brief mandates individually-named kept meshes); if a future
  gate tightens the ceiling, the detail set is the first candidate for selective re-folding.
- Emissive reads are calibrated on SwiftShader captures (compresses emissive/specular contrast —
  group-2 caveat stands); the tail LED looked grey at intensity 0.7 and reads correctly at 0.95 —
  a real-GPU eyeball remains a human acceptance item.
- `detailPlanFor` derives models from kit archetypes (`spoiler 'gt'`, `splitter 'big'`,
  `roofScoop`); a future kit re-mix could re-route a model's detail plan — the node pins are the tripwire.


## PR review fix round

External review of PR #19 (feat/car-models) returned 14 verified findings (F1-F14);
all were reproduced, fixed, and pinned by tests. Worktree: `.worktrees/feat-car-models`.

### Per-finding summary

- **F1 — model-swap disposed field-wide shared materials.** `Game.selectModel`
  disposed every material in the retired car tree, including the memoised
  singletons the mounted AI cars still render with. Added
  `isSharedCarMaterial` + `disposeCarTree` to `src/assets/CarModel.ts`
  (geometry always, materials only when not a `detailMats` singleton, arrays
  handled — mirrors `util.disposeTree`); `selectModel` now calls it. RED:
  assets.test "disposeCarTree frees geometry always, materials only when not
  shared" failed pre-fix (function absent); GREEN post.
- **F2 — garage stayed locked after MAIN MENU + optimistic card UI.**
  (a) `RaceDirector.abandon()` added; `Game.toMenu()` calls it (+ `prevCd = 0`)
  so the director returns to idle, cards unlock and the AI field sleeps until
  the next `beginRace`. RED: cars.test "abandon() returns a live race to idle"
  (phase stayed `countdown`). (b) Persistence/active-marker/stat-bars moved out
  of the card click into the ACCEPTED path: `UIManager` gained public
  `setModelActive`/`renderModelStats`; `Game.selectModel` calls them (plus
  `writeModelSelection`) after the same-id/phase guards. Same-id check, phase
  guards and the harness dev log kept as-is; title-Enter-starts-race stays green.
- **F3 — headlight cluster/intakes hardcoded z.** The hero's absolute
  `-2.245..-2.286` literals left the long-nosed hyper's lamps in the air and
  buried the short-nosed grip's in its own nose. Added pure
  `frontLampAnchors(first)` (mirrors the tail's `lastStation` anchoring);
  calibrated so the hero's station reproduces the shipped z/y byte-identically
  (lens z -2.268, lampY 0.66, intake -2.29). RED: cars.test "frontLampAnchors
  derives the cluster from the model front station".
- **F4 — Input.preventDefault killed Enter on focused cards.** PREVENT keys are
  no longer preventDefault-ed when the keydown targets an interactive element
  (`closest('button,a,input,select,textarea')`); page-scroll defaults off
  controls are unchanged. RED: ui.test "Enter on a focused button is NOT
  preventDefault-ed" + arrow-key companion. Locked cards also leave the tab
  order (`tabIndex=-1`, `aria-disabled`).
- **F5 — AI colour collision on model switch.** The boot pool excludes only the
  BOOT paint, so a garage switch could land the player on a signature an AI
  slot wears. `nextUnusedPaletteColor(used)` (pure, CarSpecs) + `aiPaintHex`
  tracking; `selectModel` repaints the colliding rival and logs under harness.
- **F6 — hyper was missing `yawResponse: 0.95`** from the approved §7 table.
  Added; whole §7 table pinned as literals (RED: `hyper.yawResponse 6.4000 ≠
  6.08`).
- **F7 — `vr.paint` storage validation.** The `Number.isFinite` gate accepted
  `''` (→ 0, black car) and any off-palette number. `readPaintSelection` now
  accepts only PAINTS member hexes; unknown `vr.model` ids already fell back
  (`find(...)?.id ?? 'hero'`) and are pinned. RED: cars.test palette-hex-only
  gate; functional `paint-storage-valid-hex` / `paint-storage-garbage-falls-back`.
- **F8 — explicit swatch pick lost on model switch when storage swallowed the
  write.** `Game.paintExplicit` (set by `onPaint`, seeded from a stored boot
  read) + pure `resolvePaintWithExplicit(stored, explicit, inMemory, spec)`
  consumed by `selectModel`. RED: cars.test "resolvePaintWithExplicit keeps an
  in-memory pick through a storage loss".
- **F9 — (a)** HERO_FINISH "verbatim" comment was false — replaced with the
  true calibration-anchor description (MaterialSpecs pins the hero output).
  **(b)** harness material levers (`noemi`/`dblside`/...) documented as
  field-global by design (singletons). **(c)** `"perf": "node scripts/perf.mjs"`
  added to package.json (script existed, entry did not).
- **F10 — 52-entry keepNames list pinned every named detail mesh out of the
  static merge.** Pruned to the 6 names with a live consumer or a runtime
  transform: `tire` (harness pose code), `wheel-spoke` (functional spoke
  counts), the four flame meshes (`setNitro` scales them per-frame). Glow/DRL
  carriers survive the merge as captured MATERIALS. Measured (same harness
  driver, grid diag after `__vr.shot('grid')`): **draw calls 2870 → 2540
  (−330, −11.5%), triangles identical (909119)**; player-tree mesh count
  115 → 85, AI field 646 → 485.
- **F11 — four-card row clipped at 390 px.** `#model-cards` gets
  `flex-wrap: wrap; max-width: 92vw`. Functional check `garage-row-fits-390px`
  (row within [0, 391], document scrollWidth ≤ 391, 4 cards).
- **F12 — dead catalog knobs.** (a) `kit.caliper` WIRED: `buildWheelAssembly`
  now takes `caliperHex` from `spec.kit.caliper`; hero keeps the shipped
  `0xc23a28` (its accent equalled it before; byte-look confirmed in
  `car_model_hero.png`), hyper/grip/drift now wear their gold/green/orange
  kit calipers. (b) `CarKit.glassTint` (dead duplicate of the wired
  `CarFinish.glassTint`) DELETED with its interface field and catalog entries.
  (c) `PaintParams.microRoughness` WIRED as the per-material normalScale
  through pure `carMaterialParamsFor(spec)` consumed by `mkPaint`
  (`HERO_MICRO` anchor keeps the hero at the shipped 0.5); `PaintParams.color`
  KEPT (consumed by `applyPaintSnapshot`). RED: materials.test
  "carMaterialParamsFor lands distinct per-model numbers through the pure core".
- **F13 — (a)** MaterialSpecs' forked `clamp`/`clamp01` replaced by the
  `util` import (node suite survives the value import; header comment
  corrected to "canvas- and side-effect-free"). **(b)** the DRIFT stat-bar
  maths now rides the SAME `axis()` as the other four — a fully tied catalog
  reads neutral 0.5 instead of the hand-rolled copy degenerating to 0. RED:
  ui.test "a fully uniform catalog reads neutral 0.5 on every bar including DRIFT".
- **F14 — (b)** the remaining fixed-colour hardware materials (`rubber`,
  `chrome`, `alloy`, `dark`, `darkSoft`, `sidewall`, `disc`, `discRing`,
  `caliper(hex)`, `glass`, `carbon`) memoised through `detailMats` — the AI
  field no longer mints dozens of materials per `buildCar`; they join the F1
  shared-predicate automatically. **(c)** `noemi`/`dblside` levers noted as
  field-global by design (see F9b).

### keepNames pruned list (46 names)

`tire-sidewall, wheelback, brake-disc, brake-disc-ring, brake-caliper,
brake-piston, wheel-dish, wheel-lip, wheel-hub, wheel-f-l, wheel-f-r,
wheel-r-l, wheel-r-r, headlight-lens-l, headlight-lens-r, taillight-lens-l,
taillight-lens-r, taillight-bar, headlight-can-l, headlight-can-r,
headlight-projector-l, headlight-projector-r, headlight-drl-l, headlight-drl-r,
taillight-recess, taillight-led, door-handle-f-l, door-handle-f-r,
door-handle-r-l, door-handle-r-r, hood-slat-0, hood-slat-1, hood-slat-2,
hood-dome, exhaust2-l, exhaust2-r, exhaust-inner2-l, exhaust-inner2-r,
exhaust-quad-block, exhaust-q0, exhaust-q1, exhaust-q2, exhaust-q3,
shut-door-l, shut-door-r, shut-bonnet-l, shut-bonnet-r`

### Lamp visual notes (re-shot, audit ALL CLEAN 37 frames)

`car_model_hyper.png`: cluster flush at the long nose, gold calipers through
the mesh wheels. `car_model_grip.png`: lamps tucked under its shorter crown,
green calipers, satin NIGHT SHIFT body. `car_model_drift.png`: lamps at its
own nose line, orange calipers, roof scoop intact. `car_model_hero.png`:
visually identical to the previously committed frame's look (shipped red
caliper, shipped lamp line) — the never-touch byte-look is preserved. All 37
frames re-shot in one pass and genuinely changed (static-merge folding shifts
pixels); committed, none reverted.

### Test/battery evidence

- Node: `node scripts/tests.mjs` → **184 passed, 0 failed** (baseline 170; +14
  new, each RED-first for its finding: F4×3, F13b, F1, F6, F7×2, F8, F5, F2a,
  F3, F12c).
- `npm run typecheck` clean; `npm run build` + `npm run build:harness` green.
- `node scripts/functional.mjs` → **PASS (14/14)** — the 11 shipped checks plus
  `paint-storage-valid-hex`, `paint-storage-garbage-falls-back`,
  `garage-row-fits-390px`. (Helper pages are closed between boots to stay under
  Chromium's concurrent-WebGL-context cap.)
- `node scripts/noleak.mjs` → CLEAN (runtime fails 0, asset leaks 0).
- `node scripts/shots.mjs && node scripts/audit-shots.mjs` → ALL CLEAN (37).
- `npm run perf -- --nobisect --seconds 8 --label review-fix` → evidence
  `shots/perf_review-fix.json` (fatal/heap trend + `gitHead` match). The
  authoritative keepNames before/after is the shots-battery grid diag: 2870
  calls pre-prune vs 2540 post-prune (−330, −11.5%), tris identical.

### Deviations

- functional.mjs needed helper-page closes (context cap) — pre-existing pages
  accumulate WebGL contexts; closes added, no behaviour change.
- The F12 "range test" named by the review did not exist in the suite; the
  deletion is pinned by the surviving FINISH_FIELDS contract test (finish
  glassTint stays) and the deleted CarKit field's absence (typecheck).

Perf note: `npm run perf -- --nobisect --seconds 8 --label review-fix` exited 0 (gates green) —
`shots/perf_review-fix.json`: 1 run (full-lap/all-frames/coast/tunnel/city), fatal none,
heap 186.4→215.5 MB (0.080 MB/s) over 890 frames, gitHead 79af1942 (dirty: package-lock
only). FPS reads SwiftShader-CPU-level; the run evidences stability, not speed.

## PR review round 2

Fixer round for findings R2-1 … R2-12 on HEAD ae155d5. Every FIXED claim below
carries the command output that produced it; where a claim rests on a new test,
the test's TEETH were proven either RED-first (write/fix the test, mutate the
production code, watch it FAIL, restore, watch it PASS) or by an explicit
mutation run of the functional battery. Proofs that were not run are labelled
GREEN-FIRST — an honest weaker grade, never a false FIXED.

### Finding ledger

| # | Status | Fix | Proof grade |
|---|--------|-----|-------------|
| R2-1 | FIXED | `spin.name = 'wheel-spin'` + wheel landmarks restored in keepNames | MUTATION + functional |
| R2-2 | FIXED | `toMenu()` calls `parkField(false)` (constructor park pose) | GREEN-FIRST functional |
| R2-3 | FIXED | Input gate returns before dispatch/pressed.add; beginRace idempotent per (post-phase, frame) | 3 node tests + 2 e2e; GREEN-FIRST |
| R2-4 | FIXED | one `reconcileAiColours` core drives boot pool, onPaint, selectModel | MUTATION |
| R2-5 | FIXED | explicit in-session pick outranks stale stored value | MUTATION |
| R2-6 | FIXED | 390 px check now counts genuine wrap (rows ≥ 2, min card width) | MUTATION |
| R2-7 | FIXED | pace test drives the real brain `update()`/`targetSpeed` | MUTATION |
| R2-8 | FIXED | caliper routed through `carMaterialParamsFor`; lying comment fixed; literals pinned | MUTATION + functional |
| R2-9 | FIXED | duplicate test deleted; 186 names unique | uniq -d empty |
| R2-10 | FIXED | seeds ''/'garbage'/'1234567'/'3784810'; expectations are catalog literals | functional |
| R2-11 | FIXED | dispose test uses the REAL predicate + REAL memoised singleton | MUTATION |
| R2-12 | FIXED | card tab-order/aria written on the `prevCardsLocked` edge only | functional; structural |

OPEN: none.

### R2-1 — wheel hardware folded past spin into the car root

`StaticBatch.collect` opens a fold scope only at a NAMED group listed in
keepNames; with the wheel names pruned, the multi-part hardware buckets folded
past `spin`/`root` into the CAR ROOT with build-time matrices baked in while
`Vehicle.bind` turns `spin` every frame. Merely adding the four wheel-group
names was NOT enough: the discs/dishes/lips/hubs live UNDER `spin`, so the spin
group itself became a named landmark (`spin.name = 'wheel-spin'`,
buildWheelAssembly) and all five names joined keepNames.

Functional check `wheels-fold-stop-at-spin` (built through the SHIPPED
`buildCar` on the dev probe, merged tree audited):

```
PASS  wheels-fold-stop-at-spin — spin groups 4/4, wheel groups 4/4, brake-disc
chain [brake-disc > wheel-spin > Group > wheel-f-l] reaches wheel-spin = true,
per-wheel batches wheel-f-l:spin=1,root=2 wheel-f-r:spin=1,root=2
wheel-r-l:spin=1,root=2 wheel-r-r:spin=1,root=2 (each wheel needs >=1 batch in
spin + >=2 in its root), stray root-level wheel batches 7
```

MUTATION (landmarks removed from keepNames again):

```
FAIL  wheels-fold-stop-at-spin — … per-wheel batches wheel-f-l:spin=0,root=0
wheel-f-r:spin=0,root=0 wheel-r-l:spin=0,root=0 wheel-r-r:spin=0,root=0,
stray root-level wheel batches 14
[functional] RESULT: FAIL (21/23)
```

Note the check was strengthened after the first teeth attempt: the original
brake-disc parent-chain assertion PASSED even under the mutation (a
single-part bucket never moves), so the real regression signal is where the
merged `static-batch` meshes LAND — every wheel must own its hardware batches
inside its own spin/wheel-root subtree.

Draw-call truth (grid six-car diag, same probe as the round-1 numbers):

| state | grid draw calls |
|-------|-----------------|
| pre-prune (pre-F10, full keepNames) | 2870 |
| post-prune broken (frozen wheels) | 2540 |
| post-fix (this round, MEASURED) | **2660** |

The landmarks give back +120 calls versus the broken prune (the wheel hardware
folds per-wheel instead of into one root mega-bucket) — still −210 (−7.3%)
under pre-prune. The honest number is 2660, not a re-claim of 2540.

### R2-2 — MAIN MENU parked nothing

`toMenu()` now calls `parkField(false)` — with `director.abandon()` closing the
gate, `stepAIField`/`bindAIFieldVisuals` hold the last frame exactly where it
froze, so the retired field is explicitly moved to the constructor's off-scene
pose (0, −600, 0). `RaceDirector.abandon` documents that it owns race state
only and never moves meshes.

```
PASS  tomenu-parks-field — toMenu → phase 'idle', all ai-car groups parked
off-scene = true, cards re-enabled = true, .locked cleared = true (R2-2)
```

Proof grade GREEN-FIRST: the check was written against the fixed code and no
park-removal mutation was run this round.

### R2-3 — the keyboard confirm raced the native click

`Input` keydown: a PREVENT key aimed at an interactive target now RETURNS
entirely — no preventDefault, no confirm dispatch, no `pressed.add` entry.
The pressed-set half matters: the window listener runs before native
activation, and a lingering pressed entry silently swallowed the next real
keypress (covered by the new `a key aimed at a button never enters the pressed
set` node test). `beginRace` is idempotent per (post-call director phase,
rAF frame): a focused button whose Enter click races the action edge cannot
re-grid the field twice in one frame; genuine restarts arrive on later frames.
`onPaint` needs no extra guard — the gate delivers a keyboard Enter to that
seam exactly once (the native click) and a repeat activation is an idempotent
colour write (justified in the code comment).

Node tests (`node scripts/tests.mjs`, all green; the two dispatch assertions
were extended onto pre-existing tests — mutation-equivalent to reverting the
gate, which fails them):

```
ok   input: Enter on a focused button is NOT preventDefault-ed (native activation survives)
ok   input: a key aimed at a button never enters the pressed set (no later swallow)
ok   input: Enter with a non-interactive target still prevents its default
```

End-to-end (real `page.keyboard.press('Enter')`, beginRace instrumented):

```
PASS  keyboard-enter-picks-model — focused card 2 + Enter → model 'hyper',
selected marker 'hyper' (expect hyper), phase 'idle' (expect idle — Enter must
not also start the race)
PASS  enter-on-start-fires-once — Enter on focused START RACE invoked
beginRace 1× (expect exactly 1), phase 'countdown'
```

### R2-4 — one reconcile core for every field colour

`reconcileAiColours(currentAiHexes, playerHex, palette)` is the single pure
planner: boot pool seeding, `Game.onPaint` and `Game.selectModel` all apply its
plan through `applyAiColourPlan`. The boot pool no longer pre-excludes the boot
paint — the collision pass sees the whole field from every entry point.

MUTATION (invert the collision test so no slot is ever repainted):

```
FAIL ai colours: reconcileAiColours leaves no slot wearing the player colour:
assert failed — no AI hex equals player f27a1e — got f27a1e, e8b62e, 14181f,
39c06a, 1f8fe0
```

restored:

```
ok   ai colours: reconcileAiColours leaves no slot wearing the player colour
```

### R2-5 — stale storage beat the explicit pick

`resolvePaintWithExplicit` returns the in-memory pick whenever
`paintExplicit` is set — storage is a BOOT SEED only, exactly the
Safari-private-mode scenario F8 targeted (swallowed write, surviving old value).

MUTATION (restore the old `storedHex ?? (explicitPick ? … : …)` chain):

```
FAIL paint flow: an explicit in-session pick outranks a stale stored value:
assert failed — explicit pick (gold) wins over a readable-but-stored old colour
— storage is boot-seed only
```

restored:

```
ok   paint flow: an explicit in-session pick outranks a stale stored value
```

### R2-6 — the 390 px check had no teeth

The old check compared only the row bounding box + scrollWidth — a flex row
WITHOUT flex-wrap shrinks four cards into one squat line and fits 390 px
identically (this was reproduced live, both mutation checks passed before the
check was strengthened). The check now counts DISTINCT card rows and a minimum
card width.

baseline (flex-wrap present):

```
PASS  garage-row-fits-390px — card row [15.6, 374.4] in a 390 px viewport,
scrollWidth 390, 4 cards across 2 rows, min card width 141.2
```

MUTATION (`flex-wrap: wrap` deleted from `#model-cards`):

```
FAIL  garage-row-fits-390px — … 4 cards across 1 rows, min card width 104.1
```

### R2-7 — the pace test never touched the brain

The old test asserted only `hyper.tuning.topSpeed` wiring. The replacement
drives the REAL `AIVehicle.update()` for 1200 steps (rubber band pinned high,
nitro starved) and samples `targetSpeed` — the clamp in `update()` is the only
thing that can hold the ceiling, so a base-capped brain cannot pass.

MUTATION (cap the brain at the BASE `VEHICLE.topSpeed`):

```
FAIL ai: the brain pace-caps against its own car's top speed (driven
targetSpeed): assert failed — driven targetSpeed reached 55.5 — a base-capped
brain tops at 56.1, so this must clear 57.0 to prove the hyper (1.12×) cap is live
```

restored:

```
ok   ai: the brain pace-caps against its own car's top speed (driven targetSpeed) (8 ms)
```

### R2-8 — the caliper bypassed the material door

`buildCar` now takes the caliper hex through `carMaterialParamsFor(spec)` (the
same door as the paint params) instead of side-reading `spec.kit.caliper`; the
comment that claimed the door was "the only thing buildCar consumes" is
corrected to name both consumers. The tautological
`b.hero.caliper === HERO_SPEC.kit.caliper` half-assert was dropped (it only
restated the implementation); the literals stay, and the functional battery
asserts the BUILT cars actually carry the per-model kit hex on a real material.

MUTATION (`carMaterialParamsFor` returns a constant caliper):

```
FAIL materials: carMaterialParamsFor lands distinct per-model numbers through
the pure core: assert failed — hyper/grip/drift wear their kit caliper colours
```

functional, restored:

```
ok   materials: carMaterialParamsFor lands distinct per-model numbers through the pure core
PASS  caliper-colour-on-built-car — built cars carry their kit caliper hex:
hero true, hyper true, grip true, drift true (R2-8: through the
carMaterialParamsFor door, literals c23a28, e8b62e, 39c06a, f27a1e)
```

### R2-9 — the duplicate test

The `director: abandon() …` test existed twice (cars.test.ts :280 and :365);
the duplicate was deleted. Proof of uniqueness over the full suite:

```
$ node scripts/tests.mjs 2>&1 | tail -2
186 passed, 0 failed
$ grep -n "test(" tests/cases/cars.test.ts | awk -F"'" '{print $2}' | sort | uniq -d
(no output)
$ node scripts/tests.mjs 2>&1 | grep -cE "^  (ok|FAIL)"
186
```

(184/183-unique baseline, +3 new pure tests, −1 duplicate, +1 R2-3 pressed-set
test = 186.)

### R2-10 — F7 seeds tested themselves

The old pair seeded '3784810' + 'garbage' and the garbage expectation compared
`game.paintHex` against `game.selectedSpec.finish.paint` — read off the same
live object, so a resolver that simply mirrored the spec would pass. Now four
boots, every expectation a CATALOG LITERAL (0xd8232e = PAINTS[1] = hero
signature), covering the `Number('') → 0` black-car trap and an off-palette
finite int:

```
PASS  paint-storage-valid-hex — stored '3784810' → boot paint 0x39c06a (expect literal 0x39c06a)
PASS  paint-storage-empty-string-falls-back — stored '' → boot paint 0xd8232e (expect literal 0xd8232e)
PASS  paint-storage-garbage-falls-back — stored 'garbage' → boot paint 0xd8232e (expect literal 0xd8232e)
PASS  paint-storage-offpalette-int-falls-back — stored '1234567' → boot paint 0xd8232e (expect literal 0xd8232e)
```

### R2-11 — the dispose test injected its own predicate

The old test passed `(m) => m === shared` with FAKE material objects, so it
proved only that `disposeCarTree` honours a callback — never that the real
`isSharedCarMaterial` recognises the real memoised instances. It now calls
`disposeCarTree(root)` with NO predicate argument, mounts a REAL
`shared.chrome()` singleton (exported for the battery) beside a fresh material,
and observes dispose by spying on the instances.

MUTATION (`isSharedCarMaterial` returns true for everything):

```
FAIL car lifecycle: disposeCarTree (real predicate) frees geometry always,
materials only when not shared: assert failed — the real predicate rejects a
fresh material
```

restored:

```
ok   car lifecycle: disposeCarTree (real predicate) frees geometry always, materials only when not shared
```

### R2-12 — tab-order DOM churn every frame

`UIManager` caches the card row once (`modelCardEls`, built in
`buildModelCards`) and writes tabindex/aria-disabled/`.locked` only when
`cardsLocked` FLIPS (same prev-edge idiom as `prevPhase`) — no per-frame
`querySelectorAll` + attribute writes. Behaviour pinned by the battery:

```
PASS  cards-locked-during-race — card row carries .locked during 'countdown' (R2-12)
PASS  cards-unfocusable-during-race — 4 cards, all tabindex=-1 + aria-disabled=true = true
```

Proof grade: structural (the write-once discipline is visible in the diff); the
functional checks are GREEN-FIRST.

### Battery (this round, final code)

```
npm run typecheck                    → tsc --noEmit, no output
node scripts/tests.mjs               → 186 passed, 0 failed   (186 unique names)
npm run build:harness                → ✓ built in 957ms
node scripts/functional.mjs          → [functional] RESULT: PASS (23/23)
node scripts/noleak.mjs              → [noleak] RESULT: CLEAN (runtime fails=0, asset leaks=0)
node scripts/shots.mjs && node scripts/audit-shots.mjs → [audit] RESULT: ALL CLEAN (37 frames)
npm run perf -- --nobisect --seconds 8 --label review-fix2 → exit 0,
  shots/perf_review-fix2.json (gitHead ae155d5, dirty: package-lock only;
  SwiftShader CPU fps — evidences stability: heap +0.03..0.07 MB/s, no fatal)
```

Corrections to round 1's claims: the previous section asserted RED-first
"for every fix"; honest grades this round are in the ledger above — R2-2, R2-3
(unit-test extension) and R2-12 are GREEN-FIRST, the rest carry pasted
mutation output.

---

## PR review round 3

Fixer round for findings R3-1 … R3-8 on HEAD 8dce37b. Same honesty rules as
round 2, tightened where round 2 was soft: every FIXED claim below carries the
command output that produced it, and where a claim rests on a functional rec
the proof is now a WIRING mutation (production call deleted), not just a
pure-core one. Unproven items are OPEN, never FIXED.

### Finding ledger

| # | Status | Fix | Proof grade |
|---|--------|-----|-------------|
| R3-1 | FIXED | interactive-target gate does `pressed.add` BEFORE returning (blur-retargeted auto-repeat can no longer dispatch confirm); replacement node test | MUTATION (node) |
| R3-2 | FIXED | exhaustion policy + dev-warn (core) AND three new functional recs driving the REAL DOM with LIVE `aiPaintHex`/mesh reads (wiring) | MUTATION ×3 (M1, M2, M3) |
| R3-3(1) | FIXED | enter-on-start asserts `activeElement === btn-start` before the press | MUTATION (M5) |
| R3-3(2) | FIXED | wheel rec counts DIRECT-CHILD batches + zero root-wheel-hardware counter (extent-gated, calibrated against the mutation's leaked batches) | MUTATION (M4) |
| R3-3(3) | FIXED | pKeys boot gates rec instead of swallowing; pageerror → rec failure; every harness evaluate wrapped → `rec(name, false, 'boot failed: …')` | structural + M1-M6 runs each exercised the RESULT line |
| R3-3(4) | FIXED | tomenu rec precondition: field must have LEFT the park pose | MUTATION (M6) |
| R3-4(1) | FIXED | full-surface dispose test: all 15 `sharedCarMaterials()` singletons survive production `disposeCarTree`; audit-bound test | MUTATION (node) |
| R3-4(2) | FIXED | typecheck compiles tests/ (tsconfig.tests.json + @types/node + hand-written .d.mts for scripts modules); 22 latent errors fixed at call sites | INJECTION (below) |
| R3-5 | FIXED | this section: honest grades, true test arithmetic, perf re-run at final head with gitHead cited, genuine fatal capture | see battery |
| R3-6(1) | FIXED | StaticBatch audit array bounded to a 32-entry ring | MUTATION (node) |
| R3-6(2) | FIXED | harness catalog validation disposes the car it builds (`disposeCarTree(car.group)`) | GREEN (harness log line + noleak CLEAN) |
| R3-7 | FIXED | CarSpecs comment anchors corrected (metalness 0.15, sheen 0.2/sheenRoughness 0.4); CarModel breakup direction corrected (gloss models read MORE breakup: grip 0.3925, drift 0.3025, hyper 0.2955 vs HERO_MICRO 0.293); AMENDED notes appended to spec §6/§10 and plan keepNames rule documenting the LIVE contract | docs (live contract = keepNames array at tail of buildCar) |
| R3-8 | (no fix needed) | reviewer-confirmed round-2 fixes (wheel landmark rec + tomenu park) | — |

OPEN: real-GPU eyeball of emissive/specular reads and the audio listen pass
remain human acceptance items (unchanged from round 2). No code-level findings
left open.

### Test arithmetic (true unique counts)

`node scripts/tests.mjs`: 186 (baseline 8dce37b, R2-9 verified unique) → **189**, `uniq -d` empty.

| op | test |
|----|------|
| add | `ai colours: an exhausted pool keeps the colliding slot colour deterministically` |
| add | `ai colours: boot-pool invariant — AI.count stays below the palette size` |
| add | `static batching: the dev audit log stays bounded across repeated builds (R3-6)` |
| add | `input: interactive-target Enter marks pressed so body auto-repeat never dispatches confirm` (replaces the R2-3 pin whose behaviour was the R3-1 bug — paired op, see replace row) |
| replace | `input: a key aimed at a button never enters the pressed set (no later swallow)` → the interactive-target Enter pin above (the R3-1 gate INVERTS the round-2 expectation) |
| replace | `car lifecycle: disposeCarTree (real predicate) frees geometry always, materials only when not shared` → `car lifecycle: disposeCarTree spares EVERY field-wide shared singleton (full surface, R3-4)` (old test used an injected predicate — the lying-predicate hole R3-4 flagged) |
| remove | ~~— (net: 186 + 4 adds − 2 replace-partners = 189…)~~ **CORRECTED 2026-11-23 (R4-F1): the formula evaluated to 188. True set-diff (tests/ at 8dce37b vs HEAD): REMOVED 2 — `car lifecycle: disposeCarTree (real predicate) frees geometry always, materials only when not shared` and `input: a key aimed at a button never enters the pressed set (no later swallow)`; ADDED 5 — the two `ai colours:` tests, `static batching: the dev audit log stays bounded across repeated builds (R3-6)`, plus the two replace-partners named in the rows above. Arithmetic: 186 − 2 removed + 5 added = 189.** |

Functional battery: 23 → **28** recs. Added: `pkeys-boot-ready`,
`pkeys-loading-hidden`, `pkeys-no-page-errors`, `ai-paint-tracker-shape`,
`swatch-click-repaints-colliding-ai-car`, `explicit-pick-survives-model-click`.

### Mutation evidence (wiring mutations — production code, not test scaffolding)

Each mutation: apply → `node scripts/functional.mjs` (full battery, sequential)
→ restore from `cp` backup → `diff -q` verified identical. No `git checkout`
was used on uncommitted files.

**M1 — delete the reconcile call in `Game.onPaint`** (the R3-2(iii) hole:
core-only pins stayed green while the swatch path never reconciled):

```
FAIL  swatch-click-repaints-colliding-ai-car — clicked swatch 0xf27a1e (worn by
slot 0, meshes read 0xf27a1e before) → player 0xf27a1e; tracker still contains
the pick = true (must be false), slot 0 now 0xf27a1e with LIVE mesh 0xf27a1e —
tracker and materials must move together (R3-2)
[functional] RESULT: FAIL (27/28)
```

**M2 — delete `aiCars[i].setPaint(next)` but KEEP the tracker update** (the
self-masking mutation round 2 could not see — tracker lies, meshes stale):

```
FAIL  swatch-click-repaints-colliding-ai-car — clicked swatch 0xf27a1e …
tracker still contains the pick = false (must be false), slot 0 now 0x1f8fe0
with LIVE mesh 0xf27a1e — tracker and materials must move together (R3-2)
[functional] RESULT: FAIL (27/28)
```

**M3 — revert `selectModel` to the stored-first chain** (deletes the
resolvePaintWithExplicit line):

```
FAIL  explicit-pick-survives-model-click — swatch click → 0x39c06a
(explicit=true); stale vr.paint=0xe8b62e planted; card click switched model to
'drift' and the car still wears 0xe8b62e (must equal the pick, not the
stale/drift-signature 0xe8b62e — R3-2: reverting the resolvePaintWithExplicit
line lands here)
[functional] RESULT: FAIL (27/28)
```

**M4 — remove the four `wheel-*` GROUP names from keepNames, KEEP `wheel-spin`**
(the R3-3(2) hole: subtree counting made the halves measure together):

```
FAIL  wheels-fold-stop-at-spin — spin groups 4/4, wheel groups 4/4, brake-disc
chain … reaches wheel-spin = true, per-wheel DIRECT-CHILD batches
wheel-f-l:spin=1,root=0 wheel-f-r:spin=1,root=0 wheel-r-l:spin=1,root=0
wheel-r-r:spin=1,root=0 (each wheel needs >=1 batch as a direct child of spin +
>=1 of its root — subtree traversal made the halves measure together),
root-level WHEEL-HARDWARE footprint batches 2 (must be 0 …)
[functional] RESULT: FAIL (27/28)
```

Restored green (all four counters back): `… wheel-f-l:spin=1,root=1 …
root-level WHEEL-HARDWARE footprint batches 0 … RESULT: PASS (28/28)`.

**M5 — sabotage the enter-on-start focus** (teeth for the R3-3(1)
activeElement assertion; the mutation lives in the rec itself):

> **RE-RUN + CORRECTION 2026-11-23 (R4-F2):** the transcript originally pasted
> here (`RESULT: FAIL (24/26)`) was a mid-round baseline. Re-run on the
> current head, with one genuine bug the re-run exposed and fixed: when the
> focus gate failed, the two else-branch recs
> (`cards-locked-during-race`/`cards-unfocusable-during-race`) were silently
> NEVER RECORDED — the RESULT denominator shrank (24/26). The battery now
> records them as honest failures (`not evaluated — the focus gate failed`),
> so the denominator is always the full 28. Real transcript, current head:

```
FAIL  enter-on-start-fires-once — focus did not land on btn-start
(activeElement is elsewhere) — the Enter would ride the body/window confirm
path, not the focused button
FAIL  cards-locked-during-race — not evaluated — the focus gate failed, the
race never started through the button (R4)
FAIL  cards-unfocusable-during-race — not evaluated — the focus gate failed,
the race never started through the button (R4)
[functional] RESULT: FAIL (24/28)
```

(The round-4 brief predicted 27/28 — that arithmetic assumed the two
dependent card recs would still pass; their precondition, the race starting
through the focused button, did not happen, so failing them is the truthful
record. What matters for teeth: the focus gate went red under sabotage and
every one of the 28 recs is accounted for.)

**M6 — delete `parkField(false)` from `Game.toMenu`** (teeth for the R3-3(4)
precondition rec):

```
FAIL  tomenu-parks-field — precondition field-left-park = true (must be true —
the rec is meaningless on an unparked start pose), toMenu → phase 'idle', all
ai-car groups parked off-scene = false, cards re-enabled = true, .locked
cleared = true (R2-2/R3-3)
[functional] RESULT: FAIL (27/28)
```

Node-side mutations (this round):

- **R3-1**: revert the gate to the bare `return` (no `pressed.add`) →
  `FAIL input: interactive-target Enter marks pressed so body auto-repeat never dispatches confirm … got 'confirm'` (188 passed, 1 failed); restored green.
- **R3-6(1)**: remove the `AUDIT_LIMIT` shift →
  `FAIL static batching: the dev audit log stays bounded across repeated builds (R3-6) … (42)` (188 passed, 1 failed); restored green.
- **R3-4(1)**: memoise only the chrome variant so the paint singleton is per-car →
  `FAIL car lifecycle: disposeCarTree spares EVERY field-wide shared singleton (full surface, R3-4) … the REAL predicate recognises the REAL singleton (MeshStandardMaterial)`; restored green.

**R3-4(2) injection proof** (`const x: number = "str"` appended to
`tests/cases/ui.test.ts`):

```
> tsc --noEmit && tsc --noEmit -p tsconfig.tests.json
tests/cases/ui.test.ts(354,7): error TS2322: Type 'string' is not assignable to type 'number'.
injected exit=2
```

Removed → `npm run typecheck` exit 0. The gate compiles every test file
against `src/`.

### Corrections to the round-2 section (append-only amendment, 2026-11-23)

1. The round-2 battery line claims `perf_review-fix2.json … no fatal`. That
   claim was **not backed by the JSON** — pageerror was console.log-only.
   Superseded: perf.mjs now records `report.fatal.pageErrorCount` and the
   round-3 evidence below carries it.
2. The round-2 `wheels-fold-stop-at-spin` paste
   (`per-wheel batches … root=2 … stray root-level wheel batches 7` "informational")
   measured SUBTREE batches and left the root counter decorative — under the
   round-3 M4 mutation the old counters stayed green. Superseded by the
   direct-child + extent-gated counters (M4 paste above).
3. Round-2 "OPEN: none" predated R3-1/R3-2 being found; kept here for the
   record, corrected by this section's OPEN line.

### Battery (this round, final code commit 398fe4e)

```
npm run typecheck                    → tsc --noEmit && tsc --noEmit -p tsconfig.tests.json, exit 0 (tests ARE compiled)
node scripts/tests.mjs               → 189 passed, 0 failed   (189 unique names)
npm run build:harness                → ✓ built in 946ms
node scripts/functional.mjs          → [functional] RESULT: PASS (28/28)
node scripts/noleak.mjs              → [noleak] RESULT: CLEAN (runtime fails=0, asset leaks=0)
node scripts/shots.mjs && node scripts/audit-shots.mjs → [audit] RESULT: ALL CLEAN (37 frames)
npm run perf -- --nobisect --seconds 8 --label review-fix3 → exit 0,
  shots/perf_review-fix3.json (gitHead 398fe4edb27b4b2e50b165f07dca28924e6fc119
  = final code commit; gitDirty true = package-lock only, as in rounds 1-2;
  SwiftShader CPU fps — evidences stability: heap −0.005..0.077 MB/s, all
  phaseEnd=racing, fatal.pageErrorCount=0)
```

---

## PR review round 4

Fixer round for the two findings + two optional items on head eb8b8d6 (the
four green threads — Input gate, Game wiring M1-M3, functional teeth,
full-surface dispose — were reviewer-verified; nothing was re-litigated).

### Finding ledger

| # | Status | Fix | Proof grade |
|---|--------|-----|-------------|
| F1 | FIXED | ledger arithmetic line struck and corrected in place (186 − 2 removed + 5 added = 189, removes and adds named, 2 of the 5 adds are the replace-partners) | doc — controller-derived set-diff adopted verbatim |
| F2 | FIXED | M5 focus-sabotage re-run at the current head; the stale (24/26) transcript corrected in place with a dated note — and the re-run CAUGHT a real battery bug: the two else-branch card recs vanished from the RESULT denominator when the focus gate failed. They now record honest failures; the battery always accounts for all 28 recs | MUTATION (re-run transcript above) |
| F3 | FIXED | CarModel `sharedCarMaterials` comment: "the other twelve" → "the other fourteen (all 15 minus chrome)" | doc (count verified against the 15-entry return list) |
| opt-a | FIXED | main battery page pageerror now `rec('main-no-page-errors', false, …)` like pKeys | MUTATION (throw probe below) |
| opt-b | FIXED | cards-locked/unfocusable recs use a waitForFunction gate (≤5 s, honest fail on timeout) instead of the fixed setTimeout(250) one-shot sample | battery stays 28/28 |

**Round-3 disclosure update:** the functional battery now has 29 unique rec
NAMES — `main-no-page-errors` was added alongside `pkeys-no-page-errors`;
both are failure-only (recorded when an error fires), so a green run records
28/28 and the RESULT line is unchanged. PR-body expectation: "28/28 with a
29th rec name that only appears as a FAIL".

### Round-4 mutation evidence

**R4-a — throw probe on the MAIN page** (`setTimeout(() => { throw new
Error('MUTANT-R4A') }, 0)` injected into `src/main.ts` after the error
listeners, harness rebuilt):

```
FAIL  main-no-page-errors — page error: Error: MUTANT-R4A
[functional] RESULT: FAIL (26/30)
```

Before this fix the same mutation was a console.log the summary passed over.
(The denominator grew to 30 under the probe because the fatal page error also
tripped four dependent main-page recs — every one of them now lands in the
results instead of the console.) `main.ts` restored from `cp` backup,
`diff -q` verified identical + `git diff --exit-code` clean; the battery
returned to PASS (28/28).

**M5 re-run** (focus sabotage at the current head): transcript in the
corrected round-3 block above — `FAIL (24/28)`, focus gate red, both
dependent recs recorded as honest not-evaluated failures.

**Round-4 fixes verified together:** node 189/189 · typecheck (src+tests)
exit 0 · harness built · functional PASS (28/28) · noleak CLEAN ·
shots+audit ALL CLEAN (37 frames; the only src change was a comment — audit
pixels unchanged, churned PNG bytes restored to HEAD as in round 3).
