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

