# Neon Rush 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished browser-native 3D arcade racing game with three handcrafted tracks, six upgradeable cars, five balanced AI opponents, Quick Race, cup-based Career, selectable graphics quality, multiple cameras and control modes, full audio, and a fully offline-capable PWA.

**Architecture:** Use Three.js for a procedural neon world and a deterministic fixed-step simulation. Keep track data, vehicle physics, AI, race rules, progression, UI, audio, quality control, and PWA caching in separate modules with explicit interfaces. The browser shell only bootstraps systems and forwards frame/input events.

**Tech Stack:** Three.js, TypeScript, Vite, Vitest, Web Audio API, Service Worker/PWA APIs, localStorage, SVG/procedural assets.

**Spec:** `docs/superpowers/specs/2026-09-10-neon-rush-3d-design.md`

## Global Constraints

- Support Chrome/Edge/Safari desktop and Chrome/Safari mobile modern browsers.
- Use Three.js, TypeScript, Vite, WebGL2 as the primary render target, Web Audio API, Service Worker API, and localStorage/IndexedDB.
- Target 60 FPS on modern desktop; Auto quality must reduce work dynamically on weaker mobile devices.
- Provide Graphics Quality presets: Auto, Low, Medium, High, Ultra.
- Include exactly three handcrafted tracks, six cars, five AI opponents, three laps per race, and five events per cup.
- Support Quick Race and cup-based Career with Race, Time Attack, Drift Challenge, and Nitro Challenge.
- Do not include civilian traffic; use only a small number of avoidable fixed obstacles.
- Collisions reduce speed and produce feedback; do not implement vehicle damage.
- Support keyboard, touch, and mobile tilt controls, with the mobile mode selectable in Settings.
- Support chase, hood/bumper, and cinematic cameras.
- Cache the complete runtime and game assets for full offline play after the first PWA installation.
- Save progress and settings locally; do not require an account or backend.
- Use only original procedural content or properly licensed open-source assets.
- Keep online multiplayer, cloud saves, traffic, detailed damage, fully procedural tracks, native apps, and microtransactions outside this implementation.

---

## File Structure

### Project and browser shell
- `package.json` — scripts, dependencies, test and build commands.
- `index.html` — canvas, screens, HUD, touch controls, settings and PWA metadata.
- `vite.config.ts` — Vite and PWA plugin configuration.
- `tsconfig.json` — strict TypeScript compiler settings.
- `src/main.ts` — browser bootstrap and animation loop.
- `src/styles.css` — responsive neon UI and touch-control styling.

### Shared contracts and content
- `src/types.ts` — vector, vehicle, race, save, quality and event contracts.
- `src/config/tracks.ts` — three fixed track definitions and obstacle data.
- `src/config/vehicles.ts` — six car definitions and upgrade slots.
- `src/config/ai.ts` — five deterministic AI skill profiles.
- `src/config/career.ts` — cup, event, reward and unlock definitions.

### Rendering and world
- `src/rendering/Renderer.ts` — Three.js renderer, scene, camera and resize lifecycle.
- `src/rendering/CameraRig.ts` — chase, hood/bumper and cinematic camera interpolation.
- `src/rendering/TrackMesh.ts` — road ribbon, markings, barriers, start line and minimap geometry.
- `src/rendering/WorldBuilder.ts` — city/coast/mountain props, lights, sky, ground and obstacles.
- `src/rendering/WeatherSystem.ts` — night, rain, fog transitions and weather particles.
- `src/rendering/VehicleView.ts` — procedural car meshes, wheels, lights and upgrade/cosmetic changes.
- `src/rendering/EffectsSystem.ts` — nitro, drift smoke, sparks, skid marks and screen feedback.

### Simulation and race rules
- `src/simulation/Vehicle.ts` — arcade vehicle integration and state.
- `src/simulation/PlayerController.ts` — keyboard, touch and tilt input mapping.
- `src/simulation/AIController.ts` — racing-line following, avoidance and skill profiles.
- `src/simulation/CollisionSystem.ts` — car-car and car-obstacle resolution.
- `src/race/RaceDirector.ts` — countdown, checkpoints, laps, positions, objectives and results.

### Progression, UI and audio
- `src/progression/SaveService.ts` — versioned local save/load/reset.
- `src/progression/CareerService.ts` — event completion, rewards, unlocks, upgrades and cosmetics.
- `src/progression/EventVariantService.ts` — deterministic weather, target and reward variation for Career events.
- `src/ui/UiController.ts` — screen routing, HUD updates, settings and control-mode selection.
- `src/audio/AudioEngine.ts` — procedural music, engine, nitro, drift, collision and UI audio.

### Platform and quality
- `src/quality/QualityManager.ts` — preset application, FPS sampling and adaptive scaling.
- `src/pwa/PwaService.ts` — service-worker registration, update and offline status.
- `public/manifest.webmanifest` — PWA identity and display metadata.
- `public/icons/icon-192.png`, `public/icons/icon-512.png` and `public/icons/maskable-512.png` — installable app icons.
- `scripts/verify-pwa.mjs` — production artifact and offline-cache verification.

### Tests
- `tests/contracts.test.ts`
- `tests/track.test.ts`
- `tests/render-contract.test.ts`
- `tests/vehicle.test.ts`
- `tests/input.test.ts`
- `tests/ai.test.ts`
- `tests/collision.test.ts`
- `tests/race-director.test.ts`
- `tests/career.test.ts`
- `tests/save.test.ts`
- `tests/content.test.ts`
- `tests/event-variant.test.ts`
- `tests/ui.test.ts`
- `tests/audio.test.ts`
- `tests/quality.test.ts`
- `tests/pwa.test.ts`
- `tests/game-integration.test.ts`

## Execution Order

1. Foundation and track/world rendering.
2. Vehicle simulation, input, AI and collisions.
3. Race director and event rules.
4. Career, garage, save and UI.
5. Audio, graphics quality and PWA.
6. Integration, tuning, browser verification and release checks.

Each sub-plan below ends in a buildable, testable slice. Do not start a later sub-plan until its dependencies pass the listed verification gate.

## Task 1: Project scaffold and shared contracts

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/types.ts`
- Create: `src/main.ts`
- Create: `tests/contracts.test.ts`

**Interfaces:**
- `Vec2`, `Vec3`, `TrackSample`, `TrackConfig`, `ObstacleConfig`, `VehicleConfig`, `VehicleUpgrade`, `EventConfig`, `EventInstance`, `Weather`, `EnvironmentVariant`, `SaveData`, `QualitySettings`, `ControlMode`, `CameraMode`, `GamePhase`, `QualityPreset`.
- Export runtime constants `GAME_PHASES`, `QUALITY_PRESETS`, `CONTROL_MODES`, `CAMERA_MODES` and `EVENT_TYPES` from `src/types.ts` for UI and validation.
- All simulation modules consume plain data objects; Three.js objects stay outside pure logic tests.

- [ ] **Step 1: Write the failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  CAMERA_MODES,
  CONTROL_MODES,
  GAME_PHASES,
  QUALITY_PRESETS,
} from '../src/types';

describe('shared contracts', () => {
  it('defines every required game phase', () => {
    expect(GAME_PHASES).toEqual(['menu', 'countdown', 'racing', 'paused', 'results']);
  });

  it('defines every required quality and input mode', () => {
    expect(QUALITY_PRESETS).toEqual(['auto', 'low', 'medium', 'high', 'ultra']);
    expect(CONTROL_MODES).toEqual(['keyboard', 'touch', 'tilt']);
    expect(CAMERA_MODES).toEqual(['chase', 'hood', 'cinematic']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/contracts.test.ts`
Expected: FAIL because the shared contract module does not exist yet.

- [ ] **Step 3: Add the strict build and test scaffold**

`package.json` contains:

```json
{
  "name": "neon-rush-3d",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": { "three": "^0.180.0" },
  "devDependencies": {
    "@vitest/coverage-v8": "^3.2.4",
    "happy-dom": "^18.0.0",
    "typescript": "^5.9.3",
    "vite": "^7.1.7",
    "vitest": "^3.2.4"
  }
}
```

Install dependencies with `npm install`; commit the generated `package-lock.json` with this scaffold.

`tsconfig.json` enables `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, ES2022, DOM libraries and Bundler module resolution. `vite.config.ts` sets the dev server host/port and ES2022 build target.

- [ ] **Step 4: Define the browser shell and shared contracts**

`index.html` contains a full-screen canvas plus mounted containers for menu, HUD, settings, pause, results, touch controls and toast messages. `src/main.ts` creates the canvas reference and exports `gameCanvas`; it does not start the game loop until Task 12. `src/types.ts` defines:

```ts
export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface TrackSample {
  point: Vec3;
  tangent: Vec3;
  left: Vec3;
  distance: number;
  curvature: number;
}
export type Weather = 'clear' | 'rain' | 'fog';
export interface EnvironmentVariant {
  nightFactor: number;
  weather: Weather;
}
export interface TrackConfig {
  id: string;
  displayName: string;
  environment: 'city' | 'coast' | 'mountain';
  controlPoints: Vec3[];
  width: number;
  lapCount: number;
  closed: boolean;
  variants: EnvironmentVariant[];
  startTransform: { position: Vec3; heading: number };
  checkpointDistances: number[];
  obstacleDistances: number[];
  minimapBounds: { minX: number; minY: number; maxX: number; maxY: number };
}
export type EventType = 'race' | 'timeAttack' | 'drift' | 'nitro';
export interface EventConfig {
  id: string;
  type: EventType;
  trackId: string;
  requiredLaps: number;
  targetTime: number;
  targetScore: number;
  reward: { currency: number; xp: number; unlock?: string };
}
export interface EventInstance {
  id: string;
  type: EventType;
  trackId: string;
  seed: number;
  variant: EnvironmentVariant;
  targetTime: number;
  targetScore: number;
  reward: { currency: number; xp: number; unlock?: string };
}
export interface VehicleConfig {
  id: string;
  displayName: string;
  baseSpeed: number;
  acceleration: number;
  grip: number;
  nitroPower: number;
  nitroCapacity: number;
  mass: number;
  upgradeSlots: string[];
  cosmeticOptions: string[];
}
export type ControlMode = 'keyboard' | 'touch' | 'tilt';
export type CameraMode = 'chase' | 'hood' | 'cinematic';
export type GamePhase = 'menu' | 'countdown' | 'racing' | 'paused' | 'results';
export type QualityPreset = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
```

- [ ] **Step 5: Run the contract test and build**

Run: `npm test -- --run tests/contracts.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: PASS with an empty browser shell.

- [ ] **Step 6: Commit the scaffold**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src/types.ts src/main.ts tests/contracts.test.ts
git commit -m "feat: scaffold Neon Rush project"
```

## Task 2: Track data, spline sampling and track mesh

**Files:**
- Create: `src/config/tracks.ts`
- Create: `src/track/TrackModel.ts`
- Create: `src/rendering/TrackMesh.ts`
- Create: `tests/track.test.ts`

**Interfaces:**
- Consumes: `TrackConfig`, `TrackSample`, `Vec3`.
- Produces: `TrackModel.sampleAt(distance): TrackSample`, `TrackModel.nearestSample(position: Vec3, hint?: number): TrackSample`, `TrackModel.project(position: Vec3, hint?: number): { distance: number; lateral: number; sample: TrackSample }`, `TrackModel.createMeshes(): TrackMeshes`.

- [ ] **Step 1: Write failing track tests**

```ts
import { describe, expect, it } from 'vitest';
import { TrackModel } from '../src/track/TrackModel';
import { tracks } from '../src/config/tracks';

describe('TrackModel', () => {
  it('creates a closed sampled loop', () => {
    const track = new TrackModel(tracks[0]);
    expect(track.length).toBeGreaterThan(100);
    expect(track.sampleAt(0).point).toEqual(track.sampleAt(track.length).point);
  });

  it('projects a centerline point with near-zero lateral offset', () => {
    const track = new TrackModel(tracks[0]);
    const sample = track.sampleAt(track.length * 0.25);
    const projection = track.project(sample.point);
    expect(Math.abs(projection.lateral)).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `npm test -- --run tests/track.test.ts`
Expected: FAIL because `TrackModel` and track content are absent.

- [ ] **Step 3: Add three fixed track definitions**

`src/config/tracks.ts` exports `tracks`, with control points for the night city, coastal highway and mountain pass. Each definition includes width, three-lap default, at least two environment variants with `nightFactor` and `weather`, start transform, checkpoint distances, minimap bounds and a short obstacle list. Obstacles use `{ position, radius, type: 'cone' | 'barrier' }` and never occupy the full road width.

- [ ] **Step 4: Implement deterministic spline sampling**

`TrackModel` uses a closed Catmull-Rom curve, 1,200 arc-length-spaced samples, cumulative distance, tangent/left vectors and curvature from adjacent tangents. `project` searches from the optional previous-sample hint, then refines the local distance. It returns a negative/positive lateral offset using the sample left vector.

- [ ] **Step 5: Build the road and race furniture**

`TrackMesh` creates a indexed road ribbon, glowing edge strips, dashed center line, start/finish plane, checkpoint markers, barriers and minimap line. It exposes `group: THREE.Group` and `minimapPoints: Vec2[]`; all geometry is disposed by `dispose()`.

- [ ] **Step 6: Run tests and build**

Run: `npm test -- --run tests/track.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Commit track geometry**

```bash
git add src/config/tracks.ts src/track/TrackModel.ts src/rendering/TrackMesh.ts tests/track.test.ts
git commit -m "feat: add handcrafted track models"
```

## Task 3: Renderer, procedural world and car views

**Files:**
- Create: `src/rendering/Renderer.ts`
- Create: `src/rendering/CameraRig.ts`
- Create: `src/rendering/WorldBuilder.ts`
- Create: `src/rendering/WeatherSystem.ts`
- Create: `src/rendering/VehicleView.ts`
- Create: `src/rendering/EffectsSystem.ts`
- Create: `tests/render-contract.test.ts`

**Interfaces:**
- Consumes: `TrackModel`, `TrackMesh`, `QualitySettings`.
- Produces: `Renderer.resize(width, height)`, `Renderer.setQuality(settings)`, `Renderer.render(scene, camera, delta)`, `CameraRig.setMode(mode)`, `CameraRig.update(vehicle, delta)`, `WorldBuilder.build(environment, track, variant)`, `WeatherSystem.setVariant(variant)`, `WeatherSystem.update(delta)`, `WeatherSystem.dispose()`, `VehicleView.update(speed, steer, drift, nitro)`, `VehicleView.setCosmetic(color, rim)`, `EffectsSystem.spawnNitro(position)`, `EffectsSystem.spawnDrift(position)`, `EffectsSystem.spawnImpact(position, strength)`, `EffectsSystem.update(delta)`, `EffectsSystem.dispose()`.

- [ ] **Step 1: Write a failing render contract test**

```ts
import { expect, it } from 'vitest';
import { makeCarMaterial } from '../src/rendering/VehicleView';

it('creates a disposeable car material', () => {
  const material = makeCarMaterial(0x00e5ff);
  expect(material.color.getHex()).toBe(0x00e5ff);
  material.dispose();
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm test -- --run tests/render-contract.test.ts`
Expected: FAIL because the renderer modules do not exist.

- [ ] **Step 3: Implement the renderer lifecycle**

`Renderer` creates an antialiased WebGL renderer, ACES tone mapping, sRGB output, a perspective camera, hemisphere/directional lights, fog and a resize observer. It clamps pixel ratio to the active quality preset and exposes `dispose()`.

- [ ] **Step 4: Build environment variants**

`WorldBuilder.build(environment, track, variant)` creates a large dark ground, sky gradient, fog, neon buildings or coastal/mountain props, street lights, reflective road accents, distant mountains/water, and fixed obstacles. It uses instanced meshes where possible and returns a `THREE.Group` configured for the selected `EnvironmentVariant`. `WeatherSystem` owns the track's rain/fog/night presentation, interpolates between variants, and budgets rain droplets to the active quality preset.

- [ ] **Step 5: Build procedural cars**

`VehicleView` composes a low-poly car from a body, cabin, spoiler, four wheels, headlights and taillights. Wheel rotation follows speed, front wheels follow steer, and nitro/drift states toggle emissive/exhaust effects. Cosmetic color and rim options update materials without rebuilding geometry.

- [ ] **Step 6: Add camera and effects systems**

`CameraRig` implements chase, hood/bumper and cinematic modes with smoothed position/look-at interpolation, speed-based FOV and impact shake. `EffectsSystem` owns pooled nitro flames, drift smoke, sparks, skid marks and screen feedback; spawning is budgeted by `QualitySettings` and all particles are updated/disposed centrally.

- [ ] **Step 7: Run tests and build**

Run: `npm test -- --run tests/render-contract.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Commit rendering foundation**

```bash
git add src/rendering/Renderer.ts src/rendering/CameraRig.ts src/rendering/WorldBuilder.ts src/rendering/WeatherSystem.ts src/rendering/VehicleView.ts src/rendering/EffectsSystem.ts tests/render-contract.test.ts
git commit -m "feat: build procedural racing world"
```

## Task 4: Arcade vehicle physics and player input

**Files:**
- Create: `src/simulation/Vehicle.ts`
- Create: `src/simulation/PlayerController.ts`
- Create: `tests/vehicle.test.ts`
- Create: `tests/input.test.ts`

**Interfaces:**
- `VehicleState`: `position: Vec3`, `heading: number`, `velocity: Vec3`, `speed: number`, `nitro: number`, `driftScore: number`, `offroad: boolean`, `finished: boolean`.
- `ControlInput`: `throttle: number`, `brake: number`, `steer: number`, `drift: boolean`, `nitro: boolean`.
- Produces: `integrateVehicle(state, config, input, track, delta): VehicleState`, `createPlayerController(mode): PlayerController`, `controller.setInput(source)`, `controller.sample(): ControlInput`.

- [ ] **Step 1: Write failing physics tests**

```ts
import { expect, it } from 'vitest';
import { integrateVehicle } from '../src/simulation/Vehicle';
import type { VehicleConfig } from '../src/types';

const config: VehicleConfig = {
  id: 'test',
  displayName: 'Test Car',
  baseSpeed: 60,
  acceleration: 22,
  grip: 1,
  nitroPower: 18,
  nitroCapacity: 100,
  mass: 1,
  upgradeSlots: [],
  cosmeticOptions: [],
};

it('accelerates toward the configured top speed', () => {
  const state = { position: {x:0,y:0,z:0}, heading:0, velocity:{x:0,y:0,z:0}, speed:0, nitro:100, driftScore:0, offroad:false, finished:false };
  const next = integrateVehicle(state, config, { throttle:1, brake:0, steer:0, drift:false, nitro:false }, null as never, 1);
  expect(next.speed).toBeGreaterThan(0);
  expect(next.speed).toBeLessThanOrEqual(config.baseSpeed);
});

it('consumes nitro and rewards drift', () => {
  const state = { position: {x:0,y:0,z:0}, heading:0, velocity:{x:0,y:0,z:0}, speed:30, nitro:100, driftScore:0, offroad:false, finished:false };
  const next = integrateVehicle(state, config, { throttle:1, brake:0, steer:1, drift:true, nitro:true }, null as never, 1);
  expect(next.nitro).toBeLessThan(100);
  expect(next.driftScore).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `npm test -- --run tests/vehicle.test.ts`
Expected: FAIL because the simulation module is absent.

- [ ] **Step 3: Implement fixed-step arcade integration**

`integrateVehicle` applies throttle/brake acceleration, quadratic drag, speed-dependent steering, grip lateral decay, off-road drag, nitro boost and drift scoring. It clamps speed to the configured top speed, keeps the state immutable, and uses a maximum delta to prevent tunneling.

- [ ] **Step 4: Add keyboard, touch and tilt sources**

`PlayerController` normalizes keyboard WASD/arrows, touch button state and `DeviceOrientationEvent` into the same `ControlInput`. Tilt has a dead zone, smoothing and calibration offset. The selected mode is stored in settings and exposed through `setMode`.

- [ ] **Step 5: Write and run input tests**

Test keyboard up/left mapping, touch gas/brake/steer state, tilt dead-zone behavior and mode switching. Run: `npm test -- --run tests/input.test.ts`; Expected: PASS.

- [ ] **Step 6: Run the full unit suite and build**

Run: `npm test` and `npm run build`; both Expected: PASS.

- [ ] **Step 7: Commit vehicle simulation**

```bash
git add src/simulation/Vehicle.ts src/simulation/PlayerController.ts tests/vehicle.test.ts tests/input.test.ts
git commit -m "feat: add arcade vehicle controls"
```

## Task 5: AI driving and collision response

**Files:**
- Create: `src/simulation/AIController.ts`
- Create: `src/simulation/CollisionSystem.ts`
- Create: `src/config/ai.ts`
- Create: `tests/ai.test.ts`
- Create: `tests/collision.test.ts`

**Interfaces:**
- `AIProfile`: `id`, `targetSpeed`, `aggression`, `laneBias`, `reactionTime`.
- `aiProfiles: AIProfile[]` exports exactly five deterministic profiles from `src/config/ai.ts`.
- `createAIControl(vehicle, track, rivals, obstacles, profile, delta): ControlInput`.
- `resolveCollisions(vehicles, obstacles): CollisionReport`.

- [ ] **Step 1: Write failing AI and collision tests**

```ts
import { expect, it } from 'vitest';
import { createAIControl } from '../src/simulation/AIController';
import { resolveCollisions } from '../src/simulation/CollisionSystem';

it('steers toward the lookahead racing line', () => {
  const control = createAIControl(
    { position: {x:0,y:0,z:0}, heading:0, velocity:{x:0,y:0,z:0}, speed:20, nitro:100, driftScore:0, offroad:false, finished:false },
    null as never, [], [], { id:'ai-1', targetSpeed:35, aggression:0.5, laneBias:0, reactionTime:0.2 }, 1
  );
  expect(control.steer).toBeTypeOf('number');
  expect(control.throttle).toBeGreaterThanOrEqual(0);
});

it('separates overlapping cars without damage state', () => {
  const cars = [
    { id:'a', position:{x:0,y:0,z:0}, radius:1, velocity:{x:0,y:0,z:0}, speed:10 },
    { id:'b', position:{x:1,y:0,z:0}, radius:1, velocity:{x:0,y:0,z:0}, speed:10 }
  ];
  const report = resolveCollisions(cars, []);
  expect(report.impacts).toBeGreaterThan(0);
  expect(cars[0].position.x).toBeLessThan(cars[1].position.x);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `npm test -- --run tests/ai.test.ts tests/collision.test.ts`
Expected: FAIL because the modules are absent.

- [ ] **Step 3: Implement racing-line AI**

`AIController` consumes one of the five profiles exported by `aiProfiles`, samples a lookahead point, converts the angle error to steer, reduces target speed for curvature and obstacles, shifts lane bias around slower rivals, and adds a small deterministic skill variation. It never reads player-only UI state.

- [ ] **Step 4: Implement speed-loss collisions**

`CollisionSystem` uses circle collisions in the XZ plane, positional separation, velocity exchange along the contact normal, a cooldown per pair and an impact magnitude. Obstacles apply a directional speed penalty and lateral push. No health or damage field exists.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- --run tests/ai.test.ts tests/collision.test.ts`; Expected: PASS.
Run: `npm run build`; Expected: PASS.

- [ ] **Step 6: Commit AI and collisions**

```bash
git add src/simulation/AIController.ts src/simulation/CollisionSystem.ts src/config/ai.ts tests/ai.test.ts tests/collision.test.ts
git commit -m "feat: add AI and arcade collisions"
```

## Task 6: Race director and event rules

**Files:**
- Create: `src/race/RaceDirector.ts`
- Create: `src/race/EventRunner.ts`
- Create: `tests/race-director.test.ts`

**Interfaces:**
- `RaceDirector.start(vehicles, track, event)`, `RaceDirector.update(delta, vehicles): RaceUpdate`, `RaceDirector.finish(vehicleId)`, `RaceDirector.rankVehicles(vehicles): VehicleRank[]`.
- `EventRunner.evaluate(event, state): EventResult`.

- [ ] **Step 1: Write failing race-rule tests**

```ts
import { expect, it } from 'vitest';
import { RaceDirector } from '../src/race/RaceDirector';

it('advances from countdown to racing', () => {
  const director = new RaceDirector({ laps:3, event: { type:'race' } } as never);
  director.start([], null as never, null as never);
  director.update(4, []);
  expect(director.phase).toBe('racing');
});

it('ranks finished cars before active cars', () => {
  const director = new RaceDirector({ laps:3, event: { type:'race' } } as never);
  const ranks = director.rankVehicles([
    { id:'a', progress:2, finished:true, finishTime:20 },
    { id:'b', progress:3, finished:false }
  ] as never);
  expect(ranks[0].id).toBe('a');
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `npm test -- --run tests/race-director.test.ts`
Expected: FAIL because the race director is absent.

- [ ] **Step 3: Implement countdown, checkpoints and laps**

`RaceDirector` holds a fixed countdown, validates checkpoint order, increments laps only after the start line is crossed in the correct direction, tracks race time, and emits phase/result events. It supports three laps and a restart without retaining stale state.

- [ ] **Step 4: Implement event scoring**

`EventRunner` handles Race placement, Time Attack target time, Drift Challenge score and Nitro Challenge nitro-use/speed score. It returns `passed`, `score`, `reward` and `bestMetric` from plain state.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- --run tests/race-director.test.ts`; Expected: PASS.
Run: `npm run build`; Expected: PASS.

- [ ] **Step 6: Commit race rules**

```bash
git add src/race/RaceDirector.ts src/race/EventRunner.ts tests/race-director.test.ts
git commit -m "feat: implement race event rules"
```

## Task 7: Career, garage and persistent saves

**Files:**
- Create: `src/config/vehicles.ts`
- Create: `src/config/career.ts`
- Create: `src/progression/SaveService.ts`
- Create: `src/progression/CareerService.ts`
- Create: `src/progression/EventVariantService.ts`
- Create: `tests/career.test.ts`
- Create: `tests/save.test.ts`
- Create: `tests/content.test.ts`
- Create: `tests/event-variant.test.ts`

**Interfaces:**
- `SaveService.load(): SaveData`, `SaveService.save(data): void`, `SaveService.reset(): void`.
- `CareerService.startEvent(cupId, eventId)`, `CareerService.completeEvent(eventId, result)`, `CareerService.purchaseUpgrade(vehicleId, slot)`, `CareerService.equipCosmetic(vehicleId, cosmetic)`.
- `createEventVariant(event: EventConfig, seed: number): EventInstance` deterministically chooses a valid track variant and bounded target/reward modifiers.

- [ ] **Step 1: Write failing progression tests**

```ts
import { expect, it } from 'vitest';
import { CareerService } from '../src/progression/CareerService';

it('rewards a completed event and unlocks the next gate', () => {
  const service = new CareerService({ load: () => ({ schemaVersion:1, currency:0, xp:0, completedEvents:[], ownedVehicles:['starter'], upgradeLevels:{}, cosmetics:{} } as never), save: () => {} } as never, null as never);
  const result = service.completeEvent('cup-1-event-1', { passed:true, score:100, reward:{ currency:250, xp:50, unlock:'car-2' } } as never);
  expect(result.currency).toBe(250);
  expect(result.unlocked).toContain('car-2');
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `npm test -- --run tests/career.test.ts tests/save.test.ts`
Expected: FAIL because progression modules are absent.

- [ ] **Step 3: Define six cars and three cups**

`vehicles.ts` exports six configs with distinct top speed, acceleration, grip, nitro and upgrade slots. `career.ts` exports three cups, five events each, rewards, unlock gates and best-score storage. All values are data, not hardcoded UI branches.

- [ ] **Step 4: Add content contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { tracks } from '../src/config/tracks';
import { vehicles } from '../src/config/vehicles';
import { aiProfiles } from '../src/config/ai';
import { careerCups } from '../src/config/career';
import { EVENT_TYPES } from '../src/types';

describe('game content', () => {
  it('ships the exact MVP content counts', () => {
    expect(tracks).toHaveLength(3);
    expect(vehicles).toHaveLength(6);
    expect(aiProfiles).toHaveLength(5);
    expect(careerCups).toHaveLength(3);
    expect(careerCups.every((cup) => cup.events.length === 5)).toBe(true);
    expect(tracks.every((track) => track.lapCount === 3)).toBe(true);
  });

  it('keeps every track closed and every event typed', () => {
    const trackIds = new Set(tracks.map((track) => track.id));
    const events = careerCups.flatMap((cup) => cup.events);
    expect(tracks.every((track) => track.closed)).toBe(true);
    expect(events.every((event) => trackIds.has(event.trackId))).toBe(true);
    expect(events.every((event) => EVENT_TYPES.includes(event.type))).toBe(true);
  });
});
```

- [ ] **Step 5: Add deterministic Career event variants**

`EventVariantService` uses a seeded hash to choose one valid `EnvironmentVariant` from the event's track, varies `targetTime` and `targetScore` within a bounded 10 percent range, and varies reward currency/XP within a bounded 20 percent range. `CareerService` stores the selected seed so the same Career event remains stable for one run and can produce a new variant when replayed.

```ts
import { describe, expect, it } from 'vitest';
import { createEventVariant } from '../src/progression/EventVariantService';
import type { EventConfig } from '../src/types';

const base: EventConfig = {
  id: 'event-1',
  type: 'timeAttack',
  trackId: 'coast',
  requiredLaps: 1,
  targetTime: 90,
  targetScore: 1000,
  reward: { currency: 100, xp: 10 },
};

describe('event variants', () => {
  it('produces deterministic bounded variation for a seed', () => {
    const first = createEventVariant(base, 7);
    const second = createEventVariant(base, 7);
    expect(first).toEqual(second);
    expect(first.targetTime).toBeGreaterThanOrEqual(81);
    expect(first.targetTime).toBeLessThanOrEqual(99);
    expect(first.reward.currency).toBeGreaterThanOrEqual(80);
    expect(first.reward.currency).toBeLessThanOrEqual(120);
  });
});
```

- [ ] **Step 6: Implement versioned local persistence**

`SaveService` uses a named localStorage key, schema version 1, JSON parse guards, deep defaults and atomic replacement. `load` returns a valid object for empty/corrupt storage; `save` serializes only known fields.

- [ ] **Step 7: Implement career transactions**

`CareerService` validates event completion, awards currency/XP, records best results, applies unlock gates, purchases bounded upgrade levels and equips owned cosmetics. Every mutation produces a new save object and calls `save` once.

- [ ] **Step 8: Run tests and build**

Run: `npm test -- --run tests/career.test.ts tests/save.test.ts tests/content.test.ts tests/event-variant.test.ts`; Expected: PASS.
Run: `npm run build`; Expected: PASS.

- [ ] **Step 9: Commit progression**

```bash
git add src/config/vehicles.ts src/config/career.ts src/progression/SaveService.ts src/progression/CareerService.ts src/progression/EventVariantService.ts tests/career.test.ts tests/save.test.ts tests/content.test.ts tests/event-variant.test.ts
git commit -m "feat: add career garage and saves"
```

## Task 8: UI, HUD, settings and control modes

**Files:**
- Create: `src/ui/UiController.ts`
- Modify: `index.html`
- Create: `src/styles.css`
- Create: `tests/ui.test.ts`

**Interfaces:**
- `UiController.showScreen(phase)`, `UiController.updateHud(snapshot)`, `UiController.bindActions(actions)`, `UiController.setSettings(settings)`.
- `reduceUiState(input: { phase: GamePhase; controlMode: ControlMode }): { showTouchControls: boolean; showHud: boolean }`.
- Actions include `startQuickRace`, `startCareer`, `resume`, `restart`, `backToMenu`, `changeCamera`, `setQuality`, `setControlMode`.

- [ ] **Step 1: Write failing UI state tests**

```ts
import { expect, it } from 'vitest';
import { reduceUiState } from '../src/ui/UiController';

it('shows touch controls only for touch or tilt mode', () => {
  expect(reduceUiState({ phase:'racing', controlMode:'touch' }).showTouchControls).toBe(true);
  expect(reduceUiState({ phase:'racing', controlMode:'keyboard' }).showTouchControls).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npm test -- --run tests/ui.test.ts`
Expected: FAIL because the UI module is absent.

- [ ] **Step 3: Build screen routing and HUD binding**

`UiController` queries the existing DOM IDs, updates text/bars/classes without innerHTML, routes menu/career/garage/settings/pause/results screens, and exposes a small action callback object. It formats time, speed, position and nitro deterministically.

- [ ] **Step 4: Add responsive neon styling**

`styles.css` implements the dark neon visual system, readable HUD, mobile-safe tap targets, safe-area padding, reduced-motion rules and touch control layouts. Settings exposes Auto/Low/Medium/High/Ultra, chase/hood/cinematic camera, keyboard/touch/tilt control mode, audio volume and mute.

- [ ] **Step 5: Wire input and camera actions**

Keyboard `P`/`Escape` pauses, `C` cycles camera, `R` restarts after results, and Enter starts from menu. Touch buttons use pointer events with `setPointerCapture`; tilt permission is requested on iOS when tilt is selected.

- [ ] **Step 6: Run tests and build**

Run: `npm test -- --run tests/ui.test.ts`; Expected: PASS.
Run: `npm run build`; Expected: PASS.

- [ ] **Step 7: Commit UI**

```bash
git add index.html src/styles.css src/ui/UiController.ts tests/ui.test.ts
git commit -m "feat: add responsive race interface"
```

## Task 9: Procedural audio engine

**Files:**
- Create: `src/audio/AudioEngine.ts`
- Create: `tests/audio.test.ts`

**Interfaces:**
- `AudioEngine.start()`, `setMuted(value)`, `setVolume(value)`, `setEngineState(speed, nitro, drift)`, `playCountdown(number)`, `playCollision(strength)`, `playFinish()`, `dispose()`.

- [ ] **Step 1: Write failing audio contract tests**

```ts
import { expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';

it('exposes mute and volume state', () => {
  const audio = new AudioEngine();
  audio.setMuted(true);
  audio.setVolume(0.4);
  expect(audio.muted).toBe(true);
  expect(audio.volume).toBe(0.4);
  audio.dispose();
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npm test -- --run tests/audio.test.ts`
Expected: FAIL because the audio module is absent.

- [ ] **Step 3: Implement browser-safe audio**

`AudioEngine` creates an `AudioContext` only after the first user gesture, uses oscillator/noise nodes for engine, nitro, drift, collision, countdown, UI and finish sounds, and routes music/SFX/engine through separate gains. All public methods are no-ops when audio is unavailable or muted.

- [ ] **Step 4: Add music state transitions**

Music uses a small procedural sequencer with menu, countdown, racing and results patterns. Tempo/intensity changes with race phase; no external audio files are required.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- --run tests/audio.test.ts`; Expected: PASS.
Run: `npm run build`; Expected: PASS.

- [ ] **Step 6: Commit audio**

```bash
git add src/audio/AudioEngine.ts tests/audio.test.ts
git commit -m "feat: add procedural racing audio"
```

## Task 10: Graphics quality and adaptive performance

**Files:**
- Create: `src/quality/QualityManager.ts`
- Create: `tests/quality.test.ts`

**Interfaces:**
- `QualityManager.applyPreset(preset, capabilities)`, `QualityManager.recordFrame(deltaMs)`, `QualityManager.recommendPreset(): QualityPreset`.
- `QualitySettings` includes `preset`, `adaptiveEnabled`, `resolutionScale`, `pixelRatio`, `shadows`, `antiAliasing`, `textureQuality`, `particleBudget`, `propDensity` and `postProcessing`.

- [ ] **Step 1: Write failing quality tests**

```ts
import { expect, it } from 'vitest';
import { QualityManager } from '../src/quality/QualityManager';

it('lowers resolution when sustained FPS is below target', () => {
  const manager = new QualityManager('auto');
  for (let i = 0; i < 180; i++) manager.recordFrame(28);
  expect(manager.recommendPreset()).toBe('low');
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npm test -- --run tests/quality.test.ts`
Expected: FAIL because the quality module is absent.

- [ ] **Step 3: Implement preset matrix**

Auto begins at Medium, Low disables shadows/post-processing and uses 0.75 resolution, Medium uses 1.0, High uses device pixel ratio capped at 1.5 with shadows, and Ultra caps at 2 with full effects. Mobile defaults one step lower when hardware concurrency or touch indicates a constrained device.

- [ ] **Step 4: Implement adaptive sampling**

`recordFrame` keeps a rolling 60-frame window. Three consecutive seconds below 50 FPS downgrade one preset; ten consecutive seconds above 58 FPS upgrade one preset, never exceeding the user-selected maximum. Applying a preset updates renderer, world density and effects budgets through a callback.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- --run tests/quality.test.ts`; Expected: PASS.
Run: `npm run build`; Expected: PASS.

- [ ] **Step 6: Commit quality control**

```bash
git add src/quality/QualityManager.ts tests/quality.test.ts
git commit -m "feat: add adaptive graphics quality"
```

## Task 11: PWA, offline cache and installation

**Files:**
- Create: `vite.config.ts` modification
- Create: `public/manifest.webmanifest`
- Create: `public/icons/icon.svg`
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Create: `public/icons/maskable-512.png`
- Create: `src/pwa/PwaService.ts`
- Create: `scripts/generate-icons.mjs`
- Create: `scripts/verify-pwa.mjs`
- Create: `tests/pwa.test.ts`

**Interfaces:**
- `PwaService.register()`, `PwaService.requestUpdate()`, `PwaService.getOfflineStatus(): boolean`.
- Service worker precaches `/`, `/index.html`, `/manifest.webmanifest`, JS/CSS bundles and icons; runtime cache is same-origin with navigation fallback to `/index.html`.

- [ ] **Step 1: Write failing PWA artifact tests**

```ts
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

it('declares standalone PWA display and installable icons', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  expect(manifest.display).toBe('standalone');
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(sizes).toContain('512x512 maskable');
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npm test -- --run tests/pwa.test.ts`
Expected: FAIL because PWA files are absent.

- [ ] **Step 3: Add manifest and icons**

`manifest.webmanifest` defines name, short name, description, theme/background colors, standalone display, start URL and PNG icons for `192x192`, `512x512` and `512x512 maskable`. `scripts/generate-icons.mjs` renders the original `icon.svg` and `maskable` source into those PNG files so the committed icons are generated, original, and maskable-safe.

- [ ] **Step 4: Configure Vite PWA generation**

Add `vite-plugin-pwa: ^1.1.0` and `@resvg/resvg-js: ^2.6.2` to devDependencies, add the `"icons": "node scripts/generate-icons.mjs"` script, run `npm install` and `npm run icons`, then configure `registerType: 'autoUpdate'`, precache manifests, navigation fallback and icon assets. `PwaService` registers the generated service worker, reports online/offline state and exposes update reload.

- [ ] **Step 5: Add production verification**

`scripts/verify-pwa.mjs` builds the project, checks `dist/index.html`, manifest, service worker and icon artifacts, then verifies the service-worker file contains precache and navigation fallback registrations. Run it with `node scripts/verify-pwa.mjs`.

- [ ] **Step 6: Run tests, build and PWA verification**

Run: `npm test -- --run tests/pwa.test.ts`; Expected: PASS.
Run: `npm run build`; Expected: PASS.
Run: `node scripts/verify-pwa.mjs`; Expected: PASS.

- [ ] **Step 7: Commit PWA support**

```bash
git add vite.config.ts public/manifest.webmanifest public/icons src/pwa/PwaService.ts scripts/generate-icons.mjs scripts/verify-pwa.mjs tests/pwa.test.ts package.json package-lock.json
git commit -m "feat: make Neon Rush installable offline"
```

## Task 12: Game orchestration and end-to-end integration

**Files:**
- Create: `src/game/Game.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/UiController.ts`
- Modify: `src/rendering/Renderer.ts`
- Create: `tests/game-integration.test.ts`

**Interfaces:**
- `Game.phase: GamePhase`, `Game.startQuickRace(trackId, vehicleId)`, `Game.startCareerEvent(cupId, eventId)`, `Game.pause()`, `Game.resume()`, `Game.restart()`, `Game.backToMenu()`, `Game.tick(deltaMs)`, `Game.dispose()`.
- `Game` owns the renderer, world, weather, vehicles, input, AI, collisions, race director, camera, effects, audio, quality manager and UI.

- [ ] **Step 1: Write failing integration contract tests**

```ts
import { expect, it } from 'vitest';
import { createGame } from '../src/game/Game';

it('transitions from menu to countdown to racing', () => {
  const game = createGame(null as never);
  expect(game.phase).toBe('menu');
  game.startQuickRace('city', 'starter');
  game.tick(4000);
  expect(game.phase).toBe('racing');
  game.pause();
  expect(game.phase).toBe('paused');
  game.dispose();
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npm test -- --run tests/game-integration.test.ts`
Expected: FAIL because orchestration is absent.

- [ ] **Step 3: Implement deterministic game loop**

`Game` accumulates fixed 120 Hz simulation steps, renders every animation frame, updates input, vehicles, AI, collisions, race director, weather, camera, effects and audio in that order, and sends a HUD snapshot to UI. It pauses simulation while preserving render and audio state.

- [ ] **Step 4: Wire all screens and actions**

Menu buttons call Quick Race or Career setup; results call CareerService; settings persist quality/control/camera/audio; pause/resume/restart/menu actions call Game methods. Mobile mode selection controls input source and touch UI visibility.

- [ ] **Step 5: Add visual integration checks**

Run the dev server and verify one race in each track, all camera modes, all quality presets, keyboard/touch/tilt controls, pause/resume/restart, results, garage changes and save reload. Record FPS and console errors for each matrix row.

- [ ] **Step 6: Run all tests and build**

Run: `npm test`; Expected: PASS.
Run: `npm run build`; Expected: PASS.

- [ ] **Step 7: Commit integration**

```bash
git add src/game/Game.ts src/main.ts src/ui/UiController.ts src/rendering/Renderer.ts tests/game-integration.test.ts
git commit -m "feat: integrate complete race loop"
```

## Task 13: Content tuning and acceptance verification

**Files:**
- Modify: `src/config/tracks.ts`
- Modify: `src/config/vehicles.ts`
- Modify: `src/config/career.ts`
- Modify: `src/simulation/AIController.ts`
- Modify: `src/quality/QualityManager.ts`
- Create: `docs/superpowers/verification/2026-09-10-neon-rush-3d.md`

**Interfaces:**
- No interface changes; tune data and thresholds only.

- [ ] **Step 1: Tune vehicle and AI envelopes**

Run repeated city/coast/mountain races. Adjust top speed, acceleration, grip, AI lookahead, curvature braking and lane bias until the player can win through skill/upgrades without AI rubber-banding that feels artificial.

- [ ] **Step 2: Tune event rewards**

Complete one cup with average and strong results. Verify five events grant enough currency for meaningful upgrades while preserving optional grind; verify unlock gates open in the intended order.

- [ ] **Step 3: Tune quality presets**

Measure desktop and mobile frame times. Confirm Auto downgrades under sustained load, returns upward after stable frames, and never changes race logic or save state.

- [ ] **Step 4: Run the acceptance matrix**

Verify: three tracks, six cars, five AI, three laps, five events per cup, Quick Race, Career, four event types, deterministic Career event variants, three cameras, three control modes, five quality presets, no traffic, fixed obstacles, speed-loss collisions, local save/load, PWA install and offline play.

- [ ] **Step 5: Record verification evidence**

`docs/superpowers/verification/2026-09-10-neon-rush-3d.md` records browser/device, build commit, FPS observations, test command results, PWA offline result and any residual hardware-specific notes. Do not claim a platform passes without an observed run.

- [ ] **Step 6: Run final checks**

Run: `npm test`, `npm run build`, `node scripts/verify-pwa.mjs`; all Expected: PASS.
Run: `git status --short`; Expected: only the verification document and intentional tuning diffs.

- [ ] **Step 7: Commit tuning and verification**

```bash
git add src/config src/simulation/AIController.ts src/quality/QualityManager.ts docs/superpowers/verification/2026-09-10-neon-rush-3d.md
git commit -m "tune Neon Rush content and verify release"
```

## Final Verification Checklist

- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `node scripts/verify-pwa.mjs` passes.
- [ ] Three tracks, six cars and five AI opponents are present.
- [ ] Quick Race and Career cups are playable.
- [ ] Race, Time Attack, Drift Challenge and Nitro Challenge produce results.
- [ ] Career event variants deterministically change weather, targets or rewards within bounded ranges.
- [ ] Keyboard, touch and tilt controls work.
- [ ] Chase, hood/bumper and cinematic cameras work.
- [ ] Auto/Low/Medium/High/Ultra quality settings work.
- [ ] PWA installs and plays offline after first load.
- [ ] Save/load preserves career, garage, settings and best results.
- [ ] No civilian traffic or vehicle damage system exists.
- [ ] No external asset license violations are present.
