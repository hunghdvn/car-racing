# Real Car Models — Design

Date: 2026-11-25
Status: draft (awaiting partner approval)
Supersedes: the model visuals of `docs/superpowers/specs/2026-09-24-car-models-design.md`
(its physics/stat/garage contracts remain in force).

## Intent

Replace the four fictional procedural cars (Velocity GT, Solaris Hyper, Apex
Grip, Slide King) with real production cars the player recognises at a glance.
The player explicitly wants the full "real" experience: real shapes, real
model names in the garage, real manufacturer logos on the body.

Why now: the procedural loft pipeline cannot reach "recognise at a glance" —
the silhouettes are generic. Real GLB models built from manufacturer references
are the only way to the goal.

## Goals

- The garage shows **5 real cars** (partner chose "everything"):

  | id | Real car | Class | Model source | License |
  |---|---|---|---|---|
  | `r34` | Nissan Skyline GT-R (R34) | BALANCED | Lexyc16, Sketchfab | CC-BY |
  | `930` | Porsche 911 Turbo (930) | CORNER GRIP | Lionsharp Studios, Sketchfab | CC-BY |
  | `s15` | Nissan Silvia S15 (Origin widebody) | DRIFT | autoNgraphic, Sketchfab | CC-BY |
  | `centenario` | Lamborghini Centenario LP-770 | TOP SPEED | SDC PERFORMANCE, Sketchfab | CC-BY |
  | `terzo` | Lamborghini Terzo Millennio | HYPER (aggressive all-rounder) | SDC PERFORMANCE, Sketchfab | CC-BY-**NC** |

  Both 911 candidates were the same car; the better Lionsharp version was
  chosen (builder's call). The Terzo's NC licence is a partner-accepted risk
  (game is free, MIT; see Constraints).
- Real names + logos by default, **all branding in one data table with a
  single toggle** (`REAL_BRANDING` in `config.ts`). Turning it off swaps in
  fictional names and removes logos with zero code changes — the "publish
  clean" escape hatch the partner asked for.
- Every existing garage behaviour survives: paint swatches recolour the body,
  model cards with live stat bars, selection persistence, AI field repaint to
  avoid the player's colour, standings naming each car's model.
- Wheels keep steering/spinning, brake and nitro and headlight effects keep
  working, 60 FPS target and the existing test/quality gates stay green.

## Non-goals

- Car physics overhaul — each car keeps the existing stat-bias system (±40%
  clamp, `CarTuning`) retuned per real car; no new physics model.
- Car selection per AI slot — the AI field keeps drawing models from the same
  5-car pool as today.
- Damage, doors opening, interiors in cockpit view (there is no cockpit view).
- Buying models from marketplaces — only the free Sketchfab assets listed above.

## Anti-goals

- A repo that balloons to hundreds of MB, or runtime downloads from Sketchfab
  (assets are vendored, optimised, and served from the game itself).
- Losing recognisability by over-optimising (a decimated 930 that no longer
  reads as a 930 fails the whole point).
- Shipping a model ripped from someone's game (CSR2/NFS extractions) — the
  candidate list already excluded those regardless of claimed CC licences.

## Constraints

- Browser game, three.js 0.168, Vite, desktop keyboard/gamepad, 60 FPS,
  7 cars on track at once (player + 6 AI).
- Total added download budget: **≤ 12 MB** for all five GLBs combined
  (meshopt-compressed, textures capped at 1024 px body / 512 px details).
  Per-car geometry target: ≤ 60k triangles.
- Licence hygiene: CC-BY requires attribution — a new `ASSETS.md` lists every
  model with author, source link, licence. The Terzo Millennio is CC-BY-NC:
  acceptable while the game stays free; the flag/data-table design means it
  can be dropped or replaced cheaply.
- Sketchfab downloads need a free account token; asset fetching happens
  off-line via a script the maintainer runs once, not in CI.
- Logos are trademarked images used under the partner's informed risk call,
  gated by the same `REAL_BRANDING` toggle.

## The how — decided pieces

**Asset pipeline (build-time, node script `scripts/optimize-cars.mjs`).**
Original downloads live outside the repo (`assets-src/`, gitignored). The
script runs `@gltf-transform/core` + meshoptimizer: weld, simplify to budget,
resize/recompress textures, quantise + meshopt compress, then writes
`public/models/<id>.glb`. Vite serves them as static assets.

**Model runtime (`src/assets/CarLibrary.ts`).**
Loads the five GLBs once at boot with `GLTFLoader` (+ MeshoptDecoder),
caches one template `Group` per car, and vends **clones** that share geometry
and materials the same way `mergeStaticMeshes` shares them today (the noleak
test's dispose discipline extends to the cache: `disposeCarTree` also releases
clone-only material instances; template teardown only on page unload).
`main.ts` awaits the preload behind the existing title screen before
constructing `Game`.

**Rigging per car (`src/assets/CarRigs.ts`, data only).**
Each Sketchfab author named their meshes differently, so each car gets a rig
record: mesh-name patterns → role (`body`, `glass`, `lights`, `wheel:<fl|fr|rl|rr>`,
`caliper`), plus measured wheel radius/position and steering-axis sign, and
body material override rules. A one-shot dev helper prints a GLB's node tree
so rigs are authored by reading names, not guessing. Wheels are detached into
steer/spin groups at their measured centres; body meshes receive the existing
clearcoat paint material instance (so `setPaint` keeps working); glass keeps
the game's tinted glass material.

**`buildCar` keeps its shape.**
`buildCar(paintHex, spec)` and the `CarModel` interface (`group`, `wheels`,
`setPaint`, `setBrake`, `setNitro`, `setHeadlights`, `paintMats`) stay the
public contract — Game, AIVehicle, VehiclePhysics, tests consume it unchanged.
Internally it becomes a library clone + rig bind. Roles that don't exist in a
given model (e.g. no nitro-visible part) degrade to no-ops.

**Procedural fallback.**
The existing lofted `buildCar` stays as an internal fallback used when a GLB
fails to load or fails validation — the game never shows a missing car, and
the procedural/material tests keep their teeth. (Builder's call.)

**Data (`src/vehicles/CarSpecs.ts`).**
`CarSpec` grows `identity: { realName, maker, logoTexture }` and
`rigId`; `shape` becomes optional (only the fallback reads it). The five
specs carry real names when `REAL_BRANDING` is on, the current fictional
names when off. Stat biases are re-flavoured per car (R34 balanced, 930 grip
king, S15 loose handbrake, Centenario top speed, Terzo fast everywhere) within
the existing clamp.

**Logos.**
Per-car decal planes (maker logo on the tail, model wordmark where sensible)
placed per rig record, textured from `public/logos/<maker>.png`, invisible
when the branding flag is off. Flat decals with matched blending are enough
at this camera distance; no decal system.

**Tests & gates.**
The four-model assumptions in `tests/cases/cars.test.ts`, `ui.test.ts` and the
harness catalog checks move to five-car expectations; new node tests cover rig
role resolution (pure function over a node-name list) and the branding toggle
(name/logo source selection). `noleak`, `perf`, `functional`, `audit-shots`
all keep passing; `shots/` gains five hero-car shots. `ASSETS.md` is added to
the PR-policy/docs checks if they enumerate top-level docs.

## Left to the builder

- Exact simplify ratios and texture caps per car (within the budget above).
- Rig mesh-name patterns per model, authored with the node-tree helper.
- Loading UX detail (progress line vs. instant) behind the title screen.
- Whether `n`/`p` keyboard model-switch keys need regenerating for 5 cards.
- Small stat re-tuning within the existing ±40% clamp.
