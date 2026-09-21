# Velocity Rush - Real 3D Browser Racing Game - Product & Architecture Spec (rev.3)

Sole authoritative spec. Supersedes rev.1/rev.2.
Source: user's original brief + the visual-quality revision directive + the
engineering-feasibility review directive of this session.

> **Governing principle: A real 3D renderer is necessary, but it is not sufficient.**
> The final visual result must itself look like a real 3D arcade racing game when
> observed through the actual gameplay camera, without the reviewer reading any code.

---

## 1. Product & references

- Working title: **Velocity Rush**. Genre: arcade 3D racing for the browser.
- Fully original assets, names, environments, audio and design; nothing copied.
- **Gameplay inspiration** (feel only): fast arcade racers of the Asphalt Nitro class —
  speed, accessibility, chase-camera behavior, drifting, Nitro, jumps, arcade handling.
- **Visual target** (what must be seen): a modern stylized 3D racing game — convincing
  vehicle geometry, detailed built environments, PBR materials, dynamic light/shadow,
  atmospheric depth, particles, polished presentation.
- Scope is fixed: ONE polished, re-playable race — one track, player + 5 AI,
  nitro/drift/jumps/tunnel/coastal/industrial/city/elevated, countdown, finish, restart.
  No meta systems, no extra menus, no new features.

## 2. NON-NEGOTIABLE VISUAL QUALITY CONTRACT

Judged from the **actual gameplay camera** (§22–§23), never from source, scene-graph,
or renderer settings.

- "Technically 3D" is not sufficient. A scene composed primarily of raw primitives
  (boxes, cylinders, spheres, planes, cones) fails acceptance even with PerspectiveCamera,
  PBR materials, shadows and bloom.
- Automatic visual failures as final presentation: cube-cars; one-box buildings with a
  facade decal; cylinder+ball trees; flat ribbon road; billboard scenery as primary
  environment; empty terrain; "road floating in a field"; flat single-color surfaces;
  graybox/debug look; surviving placeholders.
- **Procedural ≠ primitive.** A generated asset carries the same detail obligation as a
  hand-made one: swept/lofted profiles, curvature, bevels, panel breaks, greebles,
  multi-material parts, normal/roughness detail.
- The 5-Second Test (§23.1) overrides any technical argument: if ~5 s of gameplay-camera
  footage does not immediately read as a 3D arcade racer to a viewer who reads no code,
  the build is not complete.
- Post-processing may enhance, never substitute: with bloom/fog disabled the scene must
  still look like a game.

## 3. Technology & hybrid asset strategy

- TypeScript strict, Three.js r168 (WebGL2), Vite. ACES filmic tone mapping, sRGB,
  PMREM env from a procedural sky, PCF-soft shadows, bloom+vignette pass, fog matched to
  sky horizon.
- The acceptance criterion is the *visual result*, not how polygons were produced.
  Allowed in combination: custom mesh construction (lofting, lathes, swept/extruded
  profiles, beveled hulls, noise-displaced volumes, merged multi-part assemblies);
  GLTF/GLB when it adds quality; reusable authored mesh kits; procedural generation for
  roads, terrain, layout, dressing, variation.
- **Rendering feasibility budgets** (so quality coexists with 60 FPS, not by stripping
  detail): full composer + shadow-chain p95
  ≤ 2,100 at 1280×720/DPR1 on the reference M2 (2026-09-21 measured: full-lap mean
  1,561, p95 1,945 at 60 FPS; scene-only draw calls sampled mean 1,564, p95 1,845;
  instancing/merging per §17), textures ≤ 1024²
  (hero car atlases may reach 2048²), one shadow-casting light (§12), DPR capped,
  particles pooled (§15). Detail is paid for with technique, never removed from Tier 1/2.

## 4. Asset construction recipes (anti-primitive doctrine)

Each category has a required construction *strategy*; "assembled from primitives" is not
a strategy.

### 4.1 Player/opponent car — continuous automotive surface construction (required)
- **Lower body hull**: lofted/swept closed cross-sections sampled along length; each
  section built from a rounded-shoulder profile whose width/top/bottom follow automotive
  curves (front bumper → hood peak → beltline → rear haunch → tail). Catmull-Rom/Bezier
  interpolation between authored stations; smooth vertex normals; no hard box facets on
  the flanks or hood.
- **Cabin greenhouse**: separate lofted volume (raked windshield, roof, C-pillars)
  merged/blended into the beltline; windshield/side/rear glass are independent surfaces
  inset from the greenhouse frame.
- **Panels with shape**: hood, front/rear bumper forms with intake openings, side skirts,
  rear diffuser — extrusions/lofts with bevels, not slabs.
- **Wheel arches**: visible arch rims (torus-segment/tube geometry) with wheels tucked
  beneath; body panel break where arch meets flank.
- **Wheels**: LatheGeometry tire (tread band + rounded shoulders), rim dish, 5+ spokes,
  hub cap, brake disc + caliper; proportions width ≈ 30–35 % of diameter.
- **Lights**: headlight clusters with lens-shape (rounded rect/teardrop extrusions),
  emissive lens surfaces; tail light bar across the rear.
- **Greebles**: mirrors on stalks, door-cut panel lines (via baked AO line in paint
  roughness or thin dark inset strips), spoiler on struts, exhaust tips, splitter.
- Multi-material per car: clearcoat paint, glass, rubber, chrome/metal, dark trim,
  emissives.

### 4.2 Buildings (Tier 2 near-track)
Massing from offset blocks; parapets with cap geometry; roof-top equipment blocks
(HVAC/vents/tanks/antennas); window recesses or relief; entrances/canopies; balconies/
ledges; awnings; signage; facade materials with normal + roughness detail. A single
BoxGeometry + facade texture is NOT a compliant building.

### 4.3 Vegetation & rocks
Trees: trunk with branch stubs + 3–5 clustered foliage volumes (layered cones/dodeca
clusters or carded leaf clusters), 2–4 species, 2–3 scale variants, per-instance color
jitter; palms: curved trunk (bent loft) + arching fronds. Rocks: noise-deformed spheres,
never raw icosahedra. Bushes: clustered blobs; grass tufts: crossed alpha cards, instanced.

### 4.4 Terrain
Height-field mesh (grid ≥ 160×160 over the play area) from a designed field: hills,
cliff bands (coast), flatter pads away from roads; **road embankment/cut slopes modeled**
around the spline so the road sits IN the land (§7–§8). Vertex-color or splat blend into
shoulder dirt, no hard seam.

### 4.5 Water
Shader surface: 2 scrolled procedural normal maps, fresnel sky/ground mix toward env,
sharp sun glint from the sun vector, depth-tinted color toward horizon, foam line +
roughness change along shoreline (distance-to-shore mask or painted vertex attribute),
gentle vertex swell. Never a flat blue plane with a static texture.

### 4.6 Detail budgets (order-of-magnitude guardrails, NOT a checklist)
| Asset class | Triangles (per design, not per instance) |
|---|---|
| Player car (hero) | ~4k–15k |
| Opponent car | same kit, ~0.5–1× of hero |
| Major landmark (tunnel portal, gantry, crane, bridge section) | ~2k–10k |
| Near-track building (per design) | ~300–3k |
| Tier-2 prop | ~50–600 |
| Tier-3 background (per design, LOD) | ~50–500 |
These exist to reject a 50-triangle "car"; they do not replace §22–§23 as the judge.

### 4.7 Distance-tiered detail (required)
- **Close (≤ 40 m)**: hero + Tier-2 at full detail — readable bevels, strong silhouettes.
- **Mid (40–250 m)**: full designs (instanced), material detail carries it.
- **Far (> 250 m)**: LOD variants / simplified designs / skyline kits + fog.
The same primitive mesh may NOT serve all distances for one object type; vegetation and
props require at least 2 LOD levels.

## 5. Asset priority (Tier contract — as rev.2)

**Tier 1 hero**: player car, opponent cars (same kit, different paints so the grid reads
as six real cars), tunnel portals, bridge/elevated deck with pylons+railings+soffit,
finish gantry, industrial landmarks (gantry crane, stacks/silos, plant), roadside
landmarks (billboards on masts, water tower, radio mast).
**Tier 2 gameplay-critical**: barriers, guardrails (posts+bolts), curbs, rumble strips,
streetlights, signals, signs, markings, near buildings, Tier-2 trees, parked cars,
containers, bins, drain covers, ramps.
**Tier 3 distant**: skyline, hills, cranes/masts, distant vegetation — optimized, never
empty.
Optimization effort targets Tier 2/3; never Tier 1.

## 6. Hero asset: the player car (visual contract)

Per §4.1 plus: long hood / set-back cabin / wide hips proportions; silhouette readable
side/front/rear/three-quarter; moving specular highlights prove curvature; wheels spin
with speed, front wheels steer; suspension compresses visibly on ramps/landings; body
pitch/roll under input; brake lights brighten, head lights emissive; nitro flames from
exhausts. The car must appear to SIT on the road: wheel-ground gap ≤ 5 cm at rest,
tires visibly compressed on contact, no float in any §22 shot.

## 7. Road & track system

Constructed infrastructure: elevation profile (tunnel hill, 12 m bridge, crested ramps),
spline camber in corners, per-section edge assembly (asphalt → shoulder/verge → curb/
rumble → barrier/guardrail/wall, drainage where apt), markings + repaint ghosts +
patches + tire-wear darkening on the racing line, skid decals accumulate in play,
shortcut mouth with barrier gap + arrow + marking break, tunnel portal/walls/ceiling/
emissive fittings + light pools, modeled kicker ramps with side transitions and landing
zone. The road is embedded in modeled embankments/cuts (§4.4), never laid on a plane.

## 8. Terrain & road/terrain integration

- Real form: hills, coast cliffs, berms; the world has relief outside the road corridor.
- Transition stack rendered per zone: asphalt → curb → gravel/dirt shoulder → grass/
  scrub → rock/terrain, with blended edges (vertex-color ramps, skirt geometry or
  decal blends) — no hard texture boundaries anywhere visible from the road.
- Where the road rises/falls, modeled slope geometry (embankment fill or cutting)
  connects it to the terrain.

## 9. Water / coastal section

Sea visible beside/below the coast with: animated normals, fresnel, sun glint, depth/
distance color shift, shoreline foam interaction where it meets cliffs/rocks, water
reading as a *surface with behavior*, integrated with cliff geometry (§8).

## 10. Density, composition & repetition (camera-composed, not meters-measured)

- **No long road+grass+sky stretches.** Judged by pacing: while driving, something new
  and visually meaningful (structure, terrain feature, landmark, vegetation group,
  vehicle, prop cluster) must enter frame every few seconds. Intentional open coast is
  the only designed exception — and it must read as *designed* (sea, cliffs, dune grass).
- **Density over length**: the circuit is ~3.5–5 km; length serves density. Shortening
  the track to keep every backed view populated is allowed and preferred over padding.
- **Authored, not scattered**: asset placement is composed in groups/clusters with
  deliberate rhythm (tight → loose), never uniform grids or uniform spacing.
- **Repetition test (§23.3)**: reused module designs are fine; visible sequences
  (tree-tree-tree, identical lamp runs) are not — apply rotation, ±15 % scale jitter,
  color/material variants (2–3 per design), mixed species, varying spacing, paired/
  clustered placement.

## 11. Materials quality

As rev.2 §10: visible PBR differentiation across paint/glass/rubber/metal/asphalt/concrete/
vegetation/water; no large flat single-color areas (normal+roughness variation or vertex
blends required); readable moving highlights on all hero surfaces.

## 12. Lighting & shadow feasibility (WebGL2 budget)

Coexistable at 60 FPS under this contract:
- **One** directional sun (golden-hour, warm, low elevation) as the only shadow caster;
  ortho frustum (~110–150 m) re-fitted around the player each frame; map 2048² (1024² on
  adaptive downgrade); tuned bias + normalBias so surfaces are artifact-free.
- PMREM sky environment (specular + ambient) + modest hemisphere fill — never an
  ambient-flat scene.
- **No dynamic point/spot lights in the tunnel**: emissive fitting strips + bloom +
  baked-looking light-pool decals on the road + fog contrast sell it. (Optional ≤ 2
  non-shadow point lights near portals.)
- Shadow casters are an explicit allow-list: cars, Tier-1, near Tier-2. Tier-3 never
  casts; buildings cast only within the player neighborhood.
- Fog + atmospheric perspective for depth; emissives (lamps, signage, lights) drive bloom.
- Downgrade path (adaptive): shadow res → bloom strength → DPR → prop density — detail
  geometry is last, visual effects are trimmed first.

## 13. Camera framing contract

The hero car must look like a hero asset on screen:
- Chase rig: distance 5.5–7.5 m (grows with speed), height 2.2–2.9 m, look-at ahead of
  the car; the car occupies ~30–40 % of frame height in normal driving (never a speck).
- Nitro: pull-in (−0.4 m), FOV +8–12°, slight kick.
- Drift: camera yaw lags heading (up to ~15–20°), keeping the slide visible.
- Jump: camera raises to keep the airborne car framed with road visible below.
- Impact: trauma shake decayed over ≤ 0.5 s. Landing: 1 stronger shake + dust.
- Pre-race: cinematic orbit around the grid (cars large in frame, gantry visible).

## 14. Gameplay systems (unchanged scope)

Arcade physics per rev.2 (engine curve/drag, slip-based lateral grip, drift = handbrake
+ grip loss + counter-steer, air control, geometric ramp launches, barrier clamp+bounce,
car-car push, stuck/water/out-of-bounds respawn with short penalty). Nitro: charge from
drift/clean running/shortcut; raises accel, top speed, FOV, flames, audio. Checkpoints
gate lap validity; live positions; countdown; finish sequence with results + restart.

## 15. Feedback, effects, audio, UI (unchanged scope)

Particles (pooled, world-space): drift smoke, off-road dust, impact sparks + debris,
landing puffs, nitro flames, water splash; skid decals persist across the lap.
WebAudio original synthesis: layered engine (rpm+load pitch), turbo whoosh, nitro rush,
tire loop/chirp, impact thud/scrape, landing, countdown+GO, UI clicks, speed wind.
HUD: speed, rpm bar, segmented nitro, position/total, lap timer, progress ring,
minimap, popups (DRIFT CHAIN, NITRO READY, SHORTCUT!, WRONG WAY); loading screen;
title; animated countdown; results (position, time, standings, restart/menu).

## 16. Controls (unchanged)

W/S/↑/↓, A/D/←/→, Space drift, Shift nitro, R respawn, P/Esc pause, Enter confirm;
gamepad RT/LB/RB/sticks/A/B. Central `InputManager`.

## 17. Performance

As rev.2 §14: instancing for repeats, merged static geometry per material, frustum +
distance culling, LODs (§4.7), shared materials/atlases, pooled particles/decals,
single following shadow map, DPR cap, adaptive fallback. Target 60 FPS desktop —
achieved via technique within the §3 budgets, never by reducing Tier 1/2 fidelity.

## 18. Configuration & code quality

All tuning in `src/config.ts` (vehicle, nitro, drift, camera+framing, AI, graphics/
quality tiers, particles, audio, theme/paints, track profile+layout). Strict TS, small
focused modules, no globals, no monolith, comments on complex systems, fatal-error
overlay on load failure. Debug tooling (`__vr`, §22) gated behind an explicit flag.

## 19. DO NOT CHEAT THE VISUAL REQUIREMENT

Rejected as compliance evidence: "it uses a PerspectiveCamera", "a BoxGeometry is 3D",
"the car has depth", "it is procedural, therefore content", "PBR/bloom/fog present",
"it is real-time WebGL". Compliance = §22 battery + §23 tests passing on rendered frames.

## 20. Track content summary (scope lock)

City outskirts (start straight) → industrial zone (warehouses, containers, pipes, crane
landmark) → coastal (cliff, guardrails, palms/rocks, 3D sea, big ramp jump) → tunnel
(portal, lit interior) → elevated bridge over city → final high-speed sector with
shortcut + finish gantry. ~3.5–5 km, ~2 min lap, checkpoints, guarded shortcut, respawn.

## 21. IMPLEMENTATION PHASES (visual quality established early)

1. **Rendering foundation** — renderer, tone mapping, PMREM sky+env, fog, post, resize,
   quality tiers, asset framework.
2. **Hero vehicle** — §4.1 car on a test pad, materials, wheels/suspension, chase camera
   per §13. Gate: car reads as a real car in 5 angles before anything else exists.
3. **Track foundation** — spline, elevation+camber, road mesh + edge assembly, barriers/
   guardrails, ramps, tunnel shell, bridge deck+pylons, gantry; top-down + on-road check.
4. **Environment** — terrain (embedded road §8), buildings (Tier 2 kit), vegetation,
   props, water, skyline; density/composition rules (§10) applied as authored layouts.
5. **Gameplay** — physics/drift/nitro/AI/collisions/respawn/checkpoints/race FSM.
6. **Polish** — particles, skid decals, lighting/material tuning, audio, camera feel,
   HUD juice.
7. **Optimization** — LODs, instancing passes, culling, texture budget, adaptive tiers.
8. **Validation** — §22 battery, §23 tests, functional acceptance, placeholder audit.

No phase may be skipped "to get gameplay first": the hero-asset gates (1→2→3→4) are
prerequisites for gameplay-phase entry, so visual quality cannot become end-work.

## 22. Visual validation tooling & screenshot battery

Deterministic debug contract (flag-gated, e.g. `window.__vr`):
- `poseShot(name)` — teleport player + camera to an **authored, fixed** pose for a shot
  (position, speed, drift/nitro/airborne state, optional freeze-sim + parked AI).
- `captureShot(name)` → Promise<PNG> — renders the current state to file/objectURL.
- Convenience `shot(name)` = pose + settle frames + capture; identical names must yield
  visually comparable results across runs (seeded placement, fixed sun, fixed poses).

Battery (gameplay camera): 1 starting grid (6 cars + gantry), 2 city, 3 industrial,
4 coastal+sea+ramp, 5 tunnel entrance (portal+interior contrast), 6 elevated (pylons,
city below), 7 final sector/shortcut mouth, 8 nitro (flames/FOV), 9 mid-drift (smoke+
skids), 10 airborne from the big jump. Each shot reviewed against §2 failure list;
any fail ⇒ fix + re-shoot. Re-runnable after later changes to catch regressions.

## 23. Additional acceptance tests (rendered-result only)

1. **5-Second Test** — ~5 s of normal gameplay camera for a reviewer who reads no
   code/docs: does it immediately look like a 3D arcade racer?
2. **No-Empty-Space Test** — audit every battery shot for large barren regions: sky is
   fine; empty world is not. Visible land must establish scale/depth via terrain,
   structures, vegetation, infrastructure, landmarks — composition, not clutter.
3. **Repetition Test** — no visible identical-asset sequences (§10 variation rules);
   check streetscapes and lamp/tree runs specifically.
4. **No-Placeholder Survival Check** — project-wide audit before completion: no debug
   cubes/spheres, gray test materials, TODO assets, temp sky/road/car/lights visible in
   the shipped experience; debug tooling off by default.

## 24. Acceptance criteria (BOTH sets must pass)

**A. Functional** — drive/steer/brake; drift (grip loss, smoke, decals, nitro charge);
nitro (charge→activate→speed/FOV/flames/audio); jumps via geometric ramps + air control
+ landing effects; tunnel section; 5 AI on the racing line with sane spacing and recovery;
collisions react physically/visually/audibly; respawn works; checkpoints/positions/timer
correct; race completable; results shown; restart clean; HUD complete; countdown; audio;
particles; 60 FPS on a modern desktop browser.

**B. Visual** — §22 battery + §23 tests all pass: hero car contract (§4.1/§6), layered
world (§5/§10), constructed road (§7), embedded terrain (§8), water behavior (§9),
structured buildings (§4.2), varied vegetation (§4.3), PBR differentiation (§11),
feasible-but-contrasted lighting/shadows (§12), hero-framed camera (§13), Tier contract
(§5), detail budgets met (§4.6), distance-tiered detail (§4.7).

**Any build passing A but failing B is NOT complete.**
