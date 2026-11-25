import { globalObject } from '../core/globals'
import { CAR, PAINTS } from '../config'
import type { CarStat } from './CarTuning'

/* ------------------------------------------------------------------------- *
 * The car catalog (car-models spec §5 + real-car-models spec): five real
 * production cars, each one a resolved record of silhouette (authored
 * stations), cosmetic kit and stat bias. The GLB pipeline owns the visual
 * truth; this table remains the runtime contract — the shape/kit pair is the
 * procedural FALLBACK blueprint (shared between cars where the fallback body
 * reads close), the finish is the paint-material recipe, and `identity`
 * carries the real-world branding behind the CAR.realBranding toggle.
 * Geometry data lives here — config.ts stays the tuning surface.
 * ------------------------------------------------------------------------- */

export type CarId = 'r34' | '930' | 's15' | 'centenario' | 'terzo' | 'carrera'

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
}

/* Each model's signature paint look (visual-enhancement group 1): colour data
 * only — the material layer that consumes these values lands in group 2.
 * paint/glassTint/accent are hex colours, clearcoat/flake/roughness are 0..1,
 * carbon is the weave-darkness scalar (0..1, lower = darker weave) so later
 * groups can shade plain geometry with it. */
export interface CarFinish {
  paint: number
  clearcoat: number
  flake: number
  roughness: number
  glassTint: number
  carbon: number
  accent: number
}

export interface CarIdentity {
  /** real-world display name, e.g. "Nissan Skyline GT-R R34" */
  name: string
  maker: string
  /** attribution for ASSETS.md parity: licence + Sketchfab author */
  license: string
  /** per-car kill switch, ANDed with CAR.realBranding */
  realBranding: boolean
}

export interface CarSpec {
  id: CarId
  name: string
  class: string
  stat: CarStat
  shape: CarShape
  kit: CarKit
  finish: CarFinish
  /** real-world branding metadata (optional so synthetic test specs stay valid) */
  identity?: CarIdentity
  /** the pre-branding fictional name, kept for the REAL_BRANDING=off path */
  fictionalName?: string
  /** rig lookup override; defaults to spec.id (CarRigs.ts) */
  rigId?: CarId
}

/* Hero silhouette, verbatim from the shipped car (car-models spec §5). The
 * loft machinery lives in CarModel.ts; data lives here so the catalog is the
 * single runtime source and the module edge stays one-way: CarModel consumes
 * this module (the CarSpec/CarShape types plus the HERO_SPEC / spokeCountForStyle
 * values) and this module never reaches back into it. */
const BODY_STATIONS: CarStation[] = [
  { z: -2.265, hw: 0.742, by: 0.268, ty: 0.700, rt: 0.150, rb: 0.110 },
  { z: -2.075, hw: 0.832, by: 0.288, ty: 0.782, rt: 0.135, rb: 0.080 },
  { z: -1.735, hw: 0.888, by: 0.315, ty: 0.868, rt: 0.105, rb: 0.050 },
  { z: -1.310, hw: 0.990, by: 0.350, ty: 0.890, rt: 0.075, rb: 0.032 },
  { z: -0.950, hw: 0.972, by: 0.355, ty: 0.902, rt: 0.055, rb: 0.030 },
  { z: -0.450, hw: 0.960, by: 0.358, ty: 0.892, rt: 0.045, rb: 0.028 },
  { z:  0.060, hw: 0.958, by: 0.358, ty: 0.872, rt: 0.040, rb: 0.028 },
  { z:  0.560, hw: 0.962, by: 0.358, ty: 0.882, rt: 0.050, rb: 0.030 },
  { z:  1.105, hw: 0.992, by: 0.352, ty: 0.902, rt: 0.090, rb: 0.040 },
  { z:  1.625, hw: 0.920, by: 0.360, ty: 0.906, rt: 0.120, rb: 0.068 },
  { z:  1.985, hw: 0.845, by: 0.365, ty: 0.822, rt: 0.135, rb: 0.095 },
  { z:  2.265, hw: 0.712, by: 0.390, ty: 0.678, rt: 0.135, rb: 0.095 },
]

const CABIN_STATIONS: CarStation[] = [
  { z: -0.980, hw: 0.740, by: 0.750, ty: 0.990, rt: 0.070, rb: 0.090, ts: 0.80 },
  { z: -0.640, hw: 0.760, by: 0.765, ty: 1.058, rt: 0.065, rb: 0.090, ts: 0.84 },
  { z: -0.200, hw: 0.770, by: 0.778, ty: 1.084, rt: 0.060, rb: 0.090, ts: 0.88 },
  { z:  0.300, hw: 0.768, by: 0.780, ty: 1.093, rt: 0.060, rb: 0.090, ts: 0.90 },
  { z:  0.700, hw: 0.744, by: 0.775, ty: 1.060, rt: 0.065, rb: 0.095, ts: 0.88 },
  { z:  1.060, hw: 0.690, by: 0.756, ty: 1.000, rt: 0.080, rb: 0.100, ts: 0.82 },
  { z:  1.280, hw: 0.618, by: 0.726, ty: 0.942, rt: 0.095, rb: 0.110, ts: 0.76 },
]

const BASE_KIT: CarKit = {
  splitter: 'std', spoiler: 'low', diffuserFins: 4, hoodVent: true, roofScoop: false,
  sideIntakes: true, wheelStyle: 'five-spoke', wheelRadiusMul: 1, wheelWidthMul: 1,
  trackMul: 1, archExtension: 0, caliper: 0xc23a28,
}

/* Hero finish values are calibrated anchors, not verbatim copies of old
 * CarModel constants: the material layer (MaterialSpecs) derives every PBR
 * number FROM these dials through its own HERO calibration block, and the
 * material tests pin the hero output to the shipped look (roughness 0.28 →
 * paintMaterialParams, metalness 0.15 and the sheen anchors sheen 0.2 /
 * sheenRoughness 0.4 from MaterialSpecs' HERO block — the shipped sheen itself
 * is the calibrated curve clamp01(0.45 − roughness·0.9), not a copied dial,
 * caliper 0xc23a28 now read from BASE_KIT by buildCar). Changing a dial here
 * intentionally changes the hero's look. */
const HERO_FINISH: CarFinish = {
  paint: PAINTS[1].color,
  clearcoat: 0.55,
  flake: 0.5,
  roughness: 0.28,
  glassTint: 0x151c25,
  carbon: 0.1,
  accent: BASE_KIT.caliper,
}

/* Real-world identity table (real-car-models spec §branding). Model sources +
 * licences live in ASSETS.md; CAR.realBranding is the publish-time kill
 * switch, identity.realBranding the per-car one. When both are on, `name`
 * carries the real car name; otherwise the catalog's fictionalName. */
const REAL: Record<CarId, { name: string; maker: string; license: string }> = {
  r34: { name: 'Nissan Skyline GT-R R34', maker: 'Nissan', license: 'CC-BY 4.0 — model by Lexyc16 (Sketchfab)' },
  '930': { name: 'Porsche 911 Turbo', maker: 'Porsche', license: 'CC-BY 4.0 — model by Lionsharp (Sketchfab)' },
  s15: { name: 'Nissan Silvia S15', maker: 'Nissan', license: 'CC-BY 4.0 — model by autoNgraphic (Sketchfab)' },
  centenario: { name: 'Lamborghini Centenario LP 770-4', maker: 'Lamborghini', license: 'CC-BY 4.0 — model by SDC (Sketchfab)' },
  terzo: { name: 'Lamborghini Terzo Millennio', maker: 'Lamborghini', license: 'CC-BY-NC 4.0 — model by SDC (Sketchfab)' },
  carrera: { name: 'Porsche 911 Carrera 4S', maker: 'Porsche', license: 'CC-BY-SA 4.0 — model by Lionsharp Studios (Sketchfab)' },
}

const identityFor = (id: CarId): CarIdentity => ({ ...REAL[id], realBranding: true })
const displayName = (id: CarId, fictional: string): string => (CAR.realBranding ? REAL[id].name : fictional)

export const HERO_SPEC: CarSpec = {
  id: 'r34', name: displayName('r34', 'Velocity GT'), fictionalName: 'Velocity GT',
  class: 'BALANCED', stat: {}, identity: identityFor('r34'),
  shape: { bodyStations: BODY_STATIONS, cabinStations: CABIN_STATIONS },
  kit: { ...BASE_KIT },
  finish: { ...HERO_FINISH },
}

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

/* Signature finishes — palette members only (the picker can never disagree
 * with the car): hyper rides Velocity Blue as the coolest pearl-leaning entry,
 * glossier + denser flake than hero; grip is Night Shift satin graphite with a
 * carbon-forward (darkest) weave and a yellow caliper-pop accent; drift wears
 * Plasma Gold at flake-max/roughness-min so it reads metallic, warm glass. */
/* The catalog (order is the garage card order). Signatures are palette
 * members only (the picker can never disagree with the car). Shape/kit/finish
 * ride the procedural fallback blueprint noted per entry; the GLB pipeline
 * replaces the visual layer but never these records. */
export const CAR_SPECS: readonly CarSpec[] = [
  HERO_SPEC,
  { id: '930', name: displayName('930', 'Apex Grip'), fictionalName: 'Apex Grip', class: 'CORNER GRIP',
    stat: { topSpeed: 0.90, nitroTopSpeed: 0.90, gripMax: 1.12, gripDrift: 1.10, yawResponse: 1.08, brakeForce: 1.08 },
    identity: identityFor('930'),
    shape: GRIP_SHAPE, kit: { ...BASE_KIT, splitter: 'big', spoiler: 'none', wheelStyle: 'multi-spoke', wheelRadiusMul: 1.04, trackMul: 1.05, archExtension: 0.05, caliper: 0x39c06a },
    finish: { paint: PAINTS[0].color, clearcoat: 0.2, flake: 0.25, roughness: 0.55, glassTint: 0x151c25, carbon: 0.04, accent: 0xf2d21c } },
  { id: 's15', name: displayName('s15', 'Slide King'), fictionalName: 'Slide King', class: 'DRIFT',
    stat: { topSpeed: 0.96, nitroTopSpeed: 0.96, gripMax: 0.94, gripDrift: 0.88, driftYawBoost: 1.30, yawResponse: 1.20 },
    identity: identityFor('s15'),
    shape: DRIFT_SHAPE, kit: { ...BASE_KIT, splitter: 'none', spoiler: 'low', diffuserFins: 0, roofScoop: true, wheelStyle: 'teardrop', wheelWidthMul: 1.08, trackMul: 1.07, archExtension: 0.07, caliper: 0xf27a1e },
    finish: { paint: PAINTS[5].color, clearcoat: 0.7, flake: 0.85, roughness: 0.15, glassTint: 0x241a10, carbon: 0.12, accent: 0xf29a1e } },
  { id: 'centenario', name: displayName('centenario', 'Solaris Hyper'), fictionalName: 'Solaris Hyper', class: 'TOP SPEED',
    stat: { topSpeed: 1.12, nitroTopSpeed: 1.10, engineAccel: 1.02, gripMax: 0.90, gripDrift: 1.05, yawResponse: 0.95, drag: 0.92 },
    identity: identityFor('centenario'),
    shape: HYPER_SHAPE, kit: { ...BASE_KIT, spoiler: 'gt', wheelStyle: 'mesh', wheelRadiusMul: 0.98, wheelWidthMul: 1.06, caliper: 0xe8b62e },
    finish: { paint: PAINTS[2].color, clearcoat: 0.9, flake: 0.75, roughness: 0.18, glassTint: 0x101a2a, carbon: 0.08, accent: 0x18d8e8 } },
  { id: 'terzo', name: displayName('terzo', 'Vector Zero'), fictionalName: 'Vector Zero', class: 'HYPER',
    stat: { topSpeed: 1.20, nitroTopSpeed: 1.14, engineAccel: 1.12, gripMax: 1.05, gripDrift: 1.05, driftYawBoost: 0.90, yawResponse: 1.00, drag: 0.88 },
    identity: identityFor('terzo'),
    shape: HYPER_SHAPE, kit: { ...BASE_KIT, spoiler: 'gt', wheelStyle: 'mesh', wheelRadiusMul: 0.98, wheelWidthMul: 1.06, caliper: 0xc23a28 },
    finish: { paint: PAINTS[3].color, clearcoat: 0.95, flake: 0.65, roughness: 0.15, glassTint: 0x101a2a, carbon: 0.06, accent: 0xff8c1a } },
  { id: 'carrera', name: displayName('carrera', 'Circuit Four'), fictionalName: 'Circuit Four', class: 'ALL-ROAD',
    stat: { topSpeed: 1.02, nitroTopSpeed: 1.03, engineAccel: 1.06, gripMax: 1.04, gripDrift: 0.98, yawResponse: 1.02, brakeForce: 1.04 },
    identity: identityFor('carrera'),
    shape: GRIP_SHAPE, kit: { ...BASE_KIT, splitter: 'big', spoiler: 'low', wheelStyle: 'mesh', wheelRadiusMul: 1.03, trackMul: 1.06, archExtension: 0.04, caliper: 0xf2d21c },
    finish: { paint: PAINTS[4].color, clearcoat: 0.85, flake: 0.55, roughness: 0.22, glassTint: 0x10202e, carbon: 0.05, accent: 0xd0d4da } },
]

export function getSpec(id: string): CarSpec {
  return CAR_SPECS.find((s) => s.id === id) ?? HERO_SPEC
}

export function spokeCountForStyle(style: CarKit['wheelStyle']): number {
  return { 'five-spoke': 5, 'multi-spoke': 8, 'mesh': 12, 'teardrop': 6 }[style]
}

/** Palette allocator for the AI-repaint seam (Game.selectModel): returns the
 *  first PAINTS member nobody currently wears, or null when the palette is
 *  exhausted (unreachable while AI.count < PAINTS.length). Pure + node-test. */
export function nextUnusedPaletteColor(used: ReadonlySet<number>): number | null {
  for (const p of PAINTS) if (!used.has(p.color)) return p.color
  return null
}

/**
 * PR review R2-4 — the ONE pure reconciliation core behind every colour
 * mutation in the game: boot pool seeding (Game constructor), the swatch
 * path (Game.onPaint) and the model path (Game.selectModel) all plan through
 * it, so no entry point can repaint the player onto a colour an AI slot
 * already wears. Returns a repaint plan (one entry per AI slot, input order
 * preserved): every slot keeps its colour unless it equals playerHex, in which
 * case it receives the first palette colour nobody (field + player) wears.
 * R3-2(i): explicit EXHAUSTION POLICY — when no unused palette colour exists,
 * the slot deterministically KEEPS its current colour (never an arbitrary
 * wrap-around or undefined hex) and the dev harness logs a warning, so an
 * under-sized palette surfaces loudly instead of silently leaving the slot
 * wearing the player's colour. Unreachable while AI.count < PAINTS.length
 * (pinned by the node invariant in cars.test).
 */
export function reconcileAiColours(
  currentAiHexes: readonly number[], playerHex: number, palette: readonly number[],
): number[] {
  const plan = [...currentAiHexes]
  const worn = new Set<number>([...plan, playerHex])
  for (let i = 0; i < plan.length; i++) {
    if (plan[i] !== playerHex) continue
    const next = palette.find((c) => !worn.has(c)) ?? null
    if (next === null) {
      if (typeof __VR_HARNESS__ !== 'undefined' && __VR_HARNESS__) {
        console.warn(`[garage] ai slot ${i} collides with the player colour ${playerHex.toString(16)} but the palette is exhausted — keeping its current colour (AI.count must stay below PAINTS.length)`)
      }
      continue
    }
    plan[i] = next
    worn.add(next)
  }
  return plan
}

const MODEL_KEY = 'vr.model'

export function readModelSelection(): CarId {
  try {
    const store = (globalObject().localStorage as Storage | undefined) ?? undefined
    const v = store?.getItem(MODEL_KEY)
    return CAR_SPECS.find((s) => s.id === v)?.id ?? 'r34'
  } catch { return 'r34' }
}

export function writeModelSelection(id: CarId): void {
  try {
    const store = (globalObject().localStorage as Storage | undefined) ?? undefined
    store?.setItem(MODEL_KEY, id)
  } catch { /* private mode */ }
}

/* Paint precedence (garage contract): an explicit swatch pick always wins; with
 * none stored the car wears its model's signature finish. Stored at boot, then
 * on every click of a swatch — model selection alone NEVER writes this key. */
export function resolvePaint(storedHex: number | null, spec: CarSpec): number {
  return storedHex ?? spec.finish.paint
}

/** PR review F8 — the full precedence chain with the in-memory explicit pick:
 *  once the player has explicitly picked in THIS session, the in-memory pick
 *  is authoritative — storage is a boot-seed only. The old chain let a stale
 *  (but readable) stored value beat a newer explicit pick, which is exactly
 *  the Safari-private-mode scenario F8 targeted: the write is swallowed, the
 *  old stored colour survives the next model switch and overwrites the pick.
 *  With no explicit pick this session, the stored read wins; with neither,
 *  the new model's signature owns the car. Pure core consumed by
 *  Game.selectModel. */
export function resolvePaintWithExplicit(
  storedHex: number | null, explicitPick: boolean, inMemoryHex: number, spec: CarSpec,
): number {
  return explicitPick ? inMemoryHex : (storedHex ?? spec.finish.paint)
}

const PAINT_KEY = 'vr.paint'

/** PR review F7: only a PAINTS member hex is a valid stored selection — the
 *  old Number.isFinite gate accepted '' (→ 0, black car) and any off-palette
 *  number. Anything else reads as "nothing stored". */
export function readPaintSelection(): number | null {
  try {
    const store = (globalObject().localStorage as Storage | undefined) ?? undefined
    const v = store?.getItem(PAINT_KEY)
    if (v === null || v === undefined) return null
    const n = Number(v)
    return PAINTS.some((p) => p.color === n) ? n : null
  } catch { return null }
}

export function writePaintSelection(hex: number): void {
  try {
    const store = (globalObject().localStorage as Storage | undefined) ?? undefined
    store?.setItem(PAINT_KEY, String(hex))
  } catch { /* private mode */ }
}
