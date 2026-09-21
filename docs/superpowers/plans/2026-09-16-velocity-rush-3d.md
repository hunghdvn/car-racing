# Velocity Rush Implementation Plan (rev.2)

> **For agentic workers:** Execute inline, phase-by-phase. **A phase is not complete until
> its rendered result passes its screenshot gate (§ Gates) — code existing is not done.**
> Authority: spec rev.3 `docs/superpowers/specs/2026-09-16-velocity-rush-3d-design.md`.

**Goal:** A complete, polished, real-3D arcade racing vertical slice playable in the browser.
**Architecture:** Vite + TypeScript strict + Three.js r168 (WebGL2). A spline-based track
provides road meshes, elevation profile and lateral queries driving physics/AI/collision.
Fixed-timestep game loop under a race FSM. Visual quality is established EARLY via a
representative-section approach; gameplay systems are added only after the world passes gates.
**Tech:** three 0.168, vite 5, TypeScript strict. No other runtime deps.

## Global Constraints
- All tuning constants in `src/config.ts`; master `SEED` fixed for determinism.
- `npm run typecheck` and `npm run build` green at every phase boundary.
- **Hybrid asset strategy (spec §3).** Procedural generation is encouraged for roads,
  terrain, modular buildings, placement, variation, repeated props. Custom generated
  meshes, reusable authored mesh kits, and GLTF/GLB assets are all allowed where they
  materially improve the visual result. Hero assets must NOT be forced into
  primitive-only runtime generation; optimize for the visual result, not for any
  "100% procedural" claim. Do not pull external assets without a quality need.
- Renderer contract: ACES filmic tone mapping, sRGB, PMREM env from procedural sky,
  PCF-soft shadows, bloom + vignette, exponential fog matched to horizon.
- **Track is built for visual pacing, not distance** (spec §10): 3.5 km dense beats
  5 km with empty stretches. Shorten freely; never pad.
- Scope lock: one track, 6 cars, one race. No garage/career/upgrades/second track.

## Graybox policy (spec §19 + no-leak rule)
- **Internal prototype:** primitives allowed transiently, never left in a gated view.
- **Visual milestone (every gate):** assets must already satisfy the anti-primitive
  recipes (spec §4) — no cube-cars/box-buildings in gated screenshots.
- **Final build:** zero visible placeholders (audit in Phase 10).

## Visual validation tooling (built in Phase 1, expanded every phase)
- `window.__vr` (dev-flag gated): `poseShot(name)` applies an **authored deterministic
  pose** (player pos/speed/yaw, drift/nitro/air flags, optional `freezeSim`, parked AI,
  fixed sun via SEED), `captureShot(name)` → PNG via `canvas.toBlob()/toDataURL()`,
  `shot(name)` = pose + settle frames + capture. Shot registry grows with each section:
  Phase 3 adds `pad/car_*`, Phase 3b adds `slice`, Phase 5 adds `city industrial coastal
  tunnel bridge final shortcut nitro drift airborne grid`.
- Playwright driver `scripts/shots.mjs` (**environment-aware**: probe for an existing
  browser install first, only run `npx playwright install chromium` when missing):
  boots `vite preview`, calls `__vr.shot(name)` per registry entry, writes
  `shots/<name>.png`. Re-run any time; gates compare against the previous pass.

## Baseline rule (added per approval review)
> Phase 3's representative 3D slice defines the **minimum visual-quality baseline** for
> the entire project. Every subsequent asset kit, track section, environment section
> and gameplay view must meet or exceed this baseline **at its intended gameplay-camera
> distance**. Reusability is never a reason for a kit to render simpler than the slice.

## File Structure (all under `src/`)
| File | Responsibility |
|---|---|
| `../index.html`, `styles.css` | Canvas + DOM overlays (loading/title/countdown/HUD/results/pause) |
| `main.ts` | Boot, fatal-error overlay, `new Game().boot()` |
| `config.ts` | `THEME GRAPHICS QUALITY VEHICLE NITRO CAMERA AI PARTICLES AUDIO RACE PAINTS SEED` |
| `util.ts` | math, seeded `Rand`, canvas texture + normal-from-height helpers, `mergeGeometries`, `fmtTime` |
| `core/Renderer.ts` | WebGLRenderer + composer (bloom, vignette), resize/DPR, adaptive quality, shadow fit |
| `core/SkyEnv.ts` | procedural sky shader, PMREM env, fog match |
| `core/Debug.ts` | `__vr` shot registry, pose application, Playwright handshake |
| `core/Input.ts` | keyboard + gamepad → `InputState` |
| `core/Audio.ts` | WebAudio synth engine/drift/impacts/countdown/UI/wind |
| `core/ParticleManager.ts` | pooled Points: smoke/dust/sparks/splash |
| `core/SkidMarks.ts` | pooled skid decal quads |
| `assets/Textures.ts` | PBR texture library (asphalt/patches/cracks, concrete, curb stripes, paint, rubber, metal, grass, rock, container, billboards, sprites) |
| `assets/CarModel.ts` | lofted hero-car kit per spec §4.1 (hull, greenhouse, panels, arches, lathe wheels, lights, greebles), paint variants |
| `world/TrackSpline.ts` | control points → centerline; `sample(s)` with width/elev/camber/curb/barrier/zone tags; arc-length; shortcut spur |
| `world/RoadBuilder.ts` | road/edge assembly/curb/rumble/barriers/guardrails/tunnel shells+portals/bridge+pylons/ramps/gantry + terrain embed skirts |
| `world/EnvironmentBuilder.ts` | terrain heightfield + embed shaping, water, skyline |
| `world/BuildingKit.ts` | 10+ modular designs per spec §4.2 (merged multi-material geometry) |
| `world/PropKit.ts` | Tier-2 props (lamps, signals, signs, cones, jersey, containers, bins, hydrant, bench, barrels, pipes, pallets, utility boxes, billboards…) |
| `world/VegetationKit.ts` | species per spec §4.3 + 2 LOD levels each |
| `world/ComposeKit.ts` | authored cluster prefabs + composition rules (§ Phase 4) |
| `vehicles/VehiclePhysics.ts` | arcade physics core |
| `vehicles/Vehicle.ts` | mesh binding: wheels/suspension/lights/flames/telemetry |
| `vehicles/PlayerVehicle.ts` | input→drive, nitro+drift systems, charge economy |
| `vehicles/AIVehicle.ts` | spline brain (line, corner speed, nitro, avoidance, recovery, rubber-band) |
| `camera/ChaseCamera.ts` | framing contract spec §13 + shake + cinematics |
| `game/RaceDirector.ts` | progress/checkpoints/standings/countdown/finish FSM |
| `game/Game.ts` | orchestrator: build order, loop, states, collisions, respawn |
| `ui/UIManager.ts` | DOM HUD/popups/countdown/results wiring |

## Phases & Gates

### Phase 1 — Project + Rendering Foundation *(in progress)*
Scaffold (done), `config.ts` (done), `util.ts`, `core/Renderer.ts`, `core/SkyEnv.ts`,
`core/Debug.ts` (empty registry + `__vr` API), dev harness pad with material samples.
- **Gate A0 — Rendering:** screenshot of sky/fog/sun/shadows/sample-PBR-materials pad:
  golden-hour contrast visible, bloom on emissive bar, no banding/acne, ACES look.

### Phase 2 — Hero Car (hard gate, spec §4.1/§6)
`assets/Textures.ts` (car-relevant first), `assets/CarModel.ts`, chase cam per spec §13
on a lit test pad. Paint variants; wheels spin/steer; suspension demo; ground contact ≲ 5 cm.
- **Gate A — Hero Vehicle:** 5 shots `car_front/car_rear/car_side/car_fq3/car_rq3`.
  Pass bar: sports-coupe silhouette, curved lofted hull (no box flanks), distinct glass,
  real wheel proportions + spokes + discs, lights readable, material differentiation,
  grounded, ~30–40 % frame height. **No cube-car passes. Failing ⇒ fix before proceeding.**

### Phase 3 — Representative 3D Track Slice (~300 m, vertical slice)
`world/TrackSpline.ts` + `world/RoadBuilder.ts` (full edge assembly, camber, one ramp),
terrain strip w/ embed skirts, one building cluster + vegetation + props around it,
final lighting. This slice defines the project's visual language.
- **Gate B — Track Foundation:** road is constructed infrastructure (elevation, camber,
  curbs, barriers, shoulders) — never a flat ribbon; ramps read as built objects.
- **Gate C0 — Representative Section:** `slice` shot + 5-Second Test (driven through the
  gameplay camera): all three depth layers present, embedded terrain, real materials.
  **Only after passing ⇒ expand to the full circuit.**

### Phase 4 — Expand the Visual Language (kits)
`BuildingKit` (10+ designs), `PropKit` (~20), `VegetationKit` (species + LODs),
`ComposeKit` (authored cluster prefabs: `CityBlock_*`, `IndustrialCluster_*`,
`CoastalCliff_*`, `TunnelApproach_*`, `BridgeSegment_*`), water shader, skyline kit.
Variation rules enforced in-kit (rotation, ±15 % scale, color variants, clustering —
no `for every 20 m: spawn()` loops).
- **Gate C1 — Kit board (visual rejection gate, not a checklist):** every BuildingKit,
  PropKit, VegetationKit and major environment asset is rendered and inspected at its
  intended gameplay distance. Pass requires: convincing silhouettes, spec §4
  anti-primitive construction rules honored, correct PBR response (no flat-color faces),
  reads correctly at intended distance. **Asset counts are not compliance** — "10
  building types exist" fails if they are visually boxes; "multiple tree species exist"
  fails if they are indistinguishable primitive shapes.
- **Gate M — Material/Lighting:** full material matrix shot (paint/glass/rubber/metal/
  asphalt/concrete/vegetation/water) + tunnel-dark vs open-bright contrast test.
  Car shows moving specular highlights; road shows surface variation. Before gameplay.

### Phase 5 — Build the Full Track (per-section gates, incremental acceptance)
Compose city → industrial → coastal → tunnel → elevated → final sector + shortcut +
finish gantry, each as authored clusters (focal landmarks, open/closed rhythm,
sightline reveals, left/right variation). Screenshot + inspect each section **immediately
after building it**; a failing section is fixed before the next begins (no 10-section
polish backlog).
- **Gate C (per section):** foreground/midground/background present; no empty terrain,
  no road+grass+sky stretches, no repeated-object sequences, no cube buildings.

### Phase 6 — Vehicle Gameplay
`VehiclePhysics`, `Vehicle`, `PlayerVehicle`: accel/brake/steer, grip/drift/counter-steer,
air control, suspension, geometric ramp launches, landings, collisions, respawn, nitro
systems. Feel-tuned arcade. (Hard prerequisite: Phase 2 gate still passing.)

### Phase 7 — AI + Race Director
`AIVehicle` (racing line, corner braking, spacing, avoidance, recovery, deterministic
poses for shots), `RaceDirector` (checkpoints, standings, countdown, laps, finish,
results), grid placement, restart.

### Phase 8 — Effects / Audio / UI
`ParticleManager`, `SkidMarks`, `Audio`, `Input`, `UIManager`, loading/title/countdown/
results/pause wiring, popups.

### Phase 9 — Performance (no premature stripping)
Order of operations when frame time exceeds budget: profile → batch/instance/merge →
cull → LOD → reduce particles/effects → shadow res → bloom strength → DPR → only then
reconsider geometry. **Tier-1 assets are never simplified for performance.**
- **Gate P:** 60 FPS avg in city + tunnel + coast stretches; adaptive tiers demo (low
  tier must still pass visual smoke test).

### Phase 10 — Final Validation
Full §22 battery (10 shots) via `scripts/shots.mjs`; 5-Second Test; No-Empty-Space
audit; Repetition Test; placeholder-survival audit (grep TODO/debug/gray + scene audit);
functional acceptance §24A checklist; performance verification. Any failure ⇒ fix +
re-shoot; loop until both A and B pass.

## Completion definition
Spec rev.3 §24 A **and** B pass; every gate above green with stored evidence in `shots/`.
