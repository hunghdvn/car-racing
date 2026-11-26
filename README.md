# Velocity Rush

A 3D arcade racing browser game: one track, six selectable production cars
(GLB models on wheels), a six-car field. Pick a model and paint in the garage,
then race the AI field to the top
of the standings. It targets 60 FPS with keyboard and gamepad input,
deterministic visual evidence, and an open-source contribution policy that
ties new code to Qwen3.8-flash-next.

![Race slice](shots/slice.png)
![Coastal section](shots/section_coastal.png)
![Tunnel section](shots/section_tunnel.png)
![City section](shots/section_city.png)
![Finish line](shots/section_finish.png)

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle | `W` or `↑` | Right trigger |
| Brake/reverse | `S` or `↓` | Left trigger |
| Steer | `A`/`←` and `D`/`→` | Left stick or d-pad |
| Handbrake | `Space` | LB |
| Nitro | `Shift` | RB |
| Respawn | `R` | Y |
| Pause | `P` or `Escape` | Start |
| Confirm | `Enter` | A |

On the title screen, navigate the garage with clicks or `Tab` + `Enter`.

## Cars & garage

The garage ships six real production cars as optimised GLB models
(`public/models/`, built by `npm run optimize-cars` from the sources and
licences listed in [ASSETS.md](ASSETS.md)); every number the runtime needs —
per-corner wheel radius/hub, lamp and badge anchors — is measured by that
pipeline and emitted by `npm run emit-rigs`. If a model is missing or fails
validation, that car silently falls back to the procedural builder (the same
one `?proc=1` forces for every car — the offline/dev kill switch):

| Model | Class | Character |
|---|---|---|
| Nissan Skyline GT-R R34 | Balanced | The all-rounder baseline |
| Lamborghini Centenario LP 770-4 | Top speed | Fastest straight line, more to manage in corners |
| Porsche 911 Turbo (930) | Corner grip | Hooks up mid-corner, trades terminal speed |
| Nissan Silvia S15 | Drift | Loose and playful on the handbrake |
| Lamborghini Terzo Millennio | Hyper | Concept-car wedge, highest ceiling |
| Porsche 911 Carrera 4S | All-road | Wide-body grip with usable top end |

Real names and maker badges sit behind the `CAR.realBranding` flag
(`src/config.ts`); with it off the garage and standings show the fictional
catalog names (Velocity GT, Solaris Hyper, …) and no wordmark decal is
attached. The procedural path keeps a realistic finish: clearcoat paint with
metallic flake and per-model micro-roughness breakup, environment
reflections, smoked tinted glass, carbon trim, brake discs and calipers, tire
sidewalls, and LED daytime-running/tail lamps.

![Nissan Skyline GT-R R34](shots/car_model_r34.png)
![Porsche 911 Turbo](shots/car_model_930.png)
![Nissan Silvia S15](shots/car_model_s15.png)
![Lamborghini Centenario](shots/car_model_centenario.png)
![Lamborghini Terzo Millennio](shots/car_model_terzo.png)
![Porsche 911 Carrera 4S](shots/car_model_carrera.png)

Garage behaviour:

- Model cards show live stat bars; selection persists between sessions.
- Paint swatches recolour the player car; AI cars are re-coloured to avoid
  colliding with your pick.
- Cards lock once the countdown starts; abandoning via MAIN MENU unlocks them
  and parks the AI field.
- The AI field runs mixed models, and the standings name each car's model.

## Quickstart

```bash
npm ci
npm run dev
```

Open the Vite URL printed by the development server.

## Validation

Run every gate before requesting review:

```bash
npm run test
npm run typecheck
npm run build
npm run noleak
npm run functional
npm run shots
npm run audit
```

`npm run test` is the headless node suite; `npm run typecheck` compiles both
`src` and `tests`. The functional command boots the built harness in headless
Chromium and asserts real-DOM behaviours (garage clicks, keyboard confirms,
wheel transforms, field parking). It is intentionally CPU/SwiftShader-
compatible and skips wall-clock timing gates that require a real GPU. GPU
performance evidence is collected separately with:

```bash
node scripts/perf.mjs --mode ladder --gpu --label review
node scripts/perf.mjs --mode tiers --gpu --label tiers
```

The committed `shots/` battery is the visual acceptance evidence. Maintainers
still perform manual audio-listening, physical gamepad-feel, and 5-Second
gameplay reviews before accepting a user-visible change.

## Tech stack

- Vite
- TypeScript strict mode
- Three.js `0.168.x`
- WebGL2
- Node.js test and validation harnesses
- Playwright/Chromium for deterministic screenshot capture

## Repository layout

```text
src/               game code
tests/             headless tests
scripts/         validation harnesses
shots/             committed visual battery
docs/            design and implementation documents
.github/        issue/PR templates and workflows
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting work.

New code, tests, workflows, package metadata, and assets must be authored with
`Qwen3.8-flash-next`. Documentation-only contributions can use the docs-only
declaration instead. The pull-request attestation is self-reported; maintainers
verify the declaration against the changed files and commit evidence. Existing
commit history is grandfathered under this policy.

## License

Velocity Rush is released under the [MIT License](LICENSE).
