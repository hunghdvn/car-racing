import type { CarFinish, CarSpec } from '../vehicles/CarSpecs'

/* ------------------------------------------------------------------------- *
 * Finish → material translation (visual-enhancement group 2).
 *
 * The per-model `finish` record (group 1) is the single source of truth for a
 * car's look; these pure functions are the only thing that turns those dials
 * into concrete PBR numbers. They are deliberately THREE- and canvas-free so
 * the whole mapping is node-testable (tests/cases/materials.test.ts) — the
 * old situation where the paint factory hard-coded roughness/clearcoat/sheen
 * that merely *mirrored* the finish is gone: CarModel now consumes these.
 * ------------------------------------------------------------------------- */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const clamp01 = (v: number): number => clamp(v, 0, 1)

/** Hero shipped look (CarModel.ts mkPaint before group 2) — the anchor the
 *  mapping is calibrated against so the never-tune path stays faithful. */
const HERO = {
  metalness: 0.15,
  clearcoatRoughness: 0.045,
  sheen: 0.2,
  sheenRoughness: 0.4,
  ccAnchor: 0.55, // finish.clearcoat of the hero — 1:1 point of the coat curve
}

export interface PaintParams {
  color: number
  metalness: number
  roughness: number
  clearcoat: number
  clearcoatRoughness: number
  sheen: number
  sheenRoughness: number
  /** speckle probability (0..1) fed to the flake roughness map */
  flakeSpeckle: number
  /** integer tile count for the flake map repeat */
  flakeRepeat: number
  /** amplitude of the fine value-noise micro-roughness breakup map */
  microRoughness: number
  /** PMREM-sky reflection strength so the body reads the environment */
  envMapIntensity: number
}

/** finish.clearcoat drives coat roughness monotonically: a deeper wet clear
 *  never roughens. Calibrated so the hero's own clearcoat reproduces ~0.045. */
const coatRoughness = (clearcoat: number): number =>
  clamp(HERO.clearcoatRoughness * (HERO.ccAnchor / Math.max(0.12, clearcoat)), 0.02, 0.2)

export function paintMaterialParams(finish: CarFinish): PaintParams {
  const clearcoat = clamp01(finish.clearcoat)
  const flake = clamp01(finish.flake)
  const roughness = clamp(finish.roughness, 0.05, 0.6)
  return {
    color: finish.paint,
    metalness: HERO.metalness,
    roughness,
    clearcoat,
    clearcoatRoughness: coatRoughness(clearcoat),
    // a subtler edge sheen the glossier the base coat (gloss paint barely sheens)
    sheen: clamp01(0.45 - roughness * 0.9),
    sheenRoughness: HERO.sheenRoughness,
    flakeSpeckle: clamp(0.002 + flake * 0.01, 0, 0.03),
    flakeRepeat: Math.round(clamp(3 + flake * 5, 2, 10)),
    microRoughness: clamp01(roughness * 0.6 + flake * 0.25),
    // glossier clear ⇒ the body drinks more of the PMREM sunset
    envMapIntensity: clamp(0.6 + clearcoat * 0.33, 0.6, 0.9),
  }
}

export interface GlassParams {
  color: number
  roughness: number
  opacity: number
  ior: number
  envMapIntensity: number
  metalness: number
}

/** Smoked automotive glazing: per-model tint from the finish, deep enough to
 *  read as safety glass, glossy + reflective enough to catch the sky. No
 *  transmission (perf) — the smoked opacity + envMap do the work instead. */
export function glassMaterialParams(finish: CarFinish): GlassParams {
  return {
    color: finish.glassTint,
    roughness: 0.045,
    opacity: 0.45,
    ior: 1.5,
    envMapIntensity: 0.82,
    metalness: 0,
  }
}

export interface CarbonParams {
  color: number
  roughness: number
  normalScale: number
  repeat: number
  envMapIntensity: number
}

/** Carbon-fibre weave tone. finish.carbon is the weave-darkness scalar
 *  (lower = darker weave), so the resin grey is scaled by it directly. */
export function carbonMaterialParams(finish: CarFinish): CarbonParams {
  const v = Math.round(clamp01(0.32 + clamp01(finish.carbon) * 1.8) * 255)
  const color = (v << 16) | (v << 8) | v
  return {
    color,
    roughness: 0.5,
    normalScale: 0.9,
    repeat: 8,
    envMapIntensity: 0.5,
  }
}

/** The per-car material contract (PR review F12): the ONLY thing buildCar
 *  consumes from the finish/kit layer — paint params plus the kit's caliper
 *  colour (spec §6) — so the per-model numbers are pinned headless instead of
 *  living in unreachable inline factories. */
export function carMaterialParamsFor(spec: CarSpec): { paint: PaintParams; caliper: number } {
  return { paint: paintMaterialParams(spec.finish), caliper: spec.kit.caliper }
}
