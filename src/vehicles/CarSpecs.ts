import { globalObject } from '../core/globals'
import type { CarStat } from './CarTuning'

/* ------------------------------------------------------------------------- *
 * The car catalog (car-models spec §5): four models, each one a resolved
 * record of silhouette (authored stations), cosmetic kit and stat bias.
 * Geometry data lives here — config.ts stays the tuning surface.
 * ------------------------------------------------------------------------- */

export type CarId = 'hero' | 'hyper' | 'grip' | 'drift'

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
  glassTint: number
}

export interface CarSpec {
  id: CarId
  name: string
  class: string
  stat: CarStat
  shape: CarShape
  kit: CarKit
}

/* Hero silhouette, verbatim from the shipped car (car-models spec §5). The
 * loft machinery lives in CarModel.ts; data lives here so the catalog is the
 * single runtime source and the module edge stays one-way (CarModel imports
 * only types from this module). */
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
  trackMul: 1, archExtension: 0, caliper: 0xc23a28, glassTint: 0,
}

export const HERO_SPEC: CarSpec = {
  id: 'hero', name: 'Velocity GT', class: 'BALANCED', stat: {},
  shape: { bodyStations: BODY_STATIONS, cabinStations: CABIN_STATIONS },
  kit: { ...BASE_KIT },
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

export const CAR_SPECS: readonly CarSpec[] = [
  HERO_SPEC,
  { id: 'hyper', name: 'Solaris Hyper', class: 'TOP SPEED',
    stat: { topSpeed: 1.12, nitroTopSpeed: 1.10, engineAccel: 1.02, gripMax: 0.90, gripDrift: 1.05, drag: 0.92 },
    shape: HYPER_SHAPE, kit: { ...BASE_KIT, spoiler: 'gt', wheelStyle: 'mesh', wheelRadiusMul: 0.98, wheelWidthMul: 1.06, caliper: 0xe8b62e, glassTint: 0.06 } },
  { id: 'grip', name: 'Apex Grip', class: 'CORNER GRIP',
    stat: { topSpeed: 0.90, nitroTopSpeed: 0.90, gripMax: 1.12, gripDrift: 1.10, yawResponse: 1.08, brakeForce: 1.08 },
    shape: GRIP_SHAPE, kit: { ...BASE_KIT, splitter: 'big', spoiler: 'none', wheelStyle: 'multi-spoke', wheelRadiusMul: 1.04, trackMul: 1.05, archExtension: 0.05, caliper: 0x39c06a } },
  { id: 'drift', name: 'Slide King', class: 'DRIFT',
    stat: { topSpeed: 0.96, nitroTopSpeed: 0.96, gripMax: 0.94, gripDrift: 0.88, driftYawBoost: 1.30, yawResponse: 1.20 },
    shape: DRIFT_SHAPE, kit: { ...BASE_KIT, splitter: 'none', spoiler: 'low', diffuserFins: 0, roofScoop: true, wheelStyle: 'teardrop', wheelWidthMul: 1.08, trackMul: 1.07, archExtension: 0.07, caliper: 0xf27a1e, glassTint: 0.04 } },
]

export function getSpec(id: string): CarSpec {
  return CAR_SPECS.find((s) => s.id === id) ?? HERO_SPEC
}

export function spokeCountForStyle(style: CarKit['wheelStyle']): number {
  return { 'five-spoke': 5, 'multi-spoke': 8, 'mesh': 12, 'teardrop': 6 }[style]
}

const MODEL_KEY = 'vr.model'

export function readModelSelection(): CarId {
  try {
    const store = (globalObject().localStorage as Storage | undefined) ?? undefined
    const v = store?.getItem(MODEL_KEY)
    return CAR_SPECS.find((s) => s.id === v)?.id ?? 'hero'
  } catch { return 'hero' }
}

export function writeModelSelection(id: CarId): void {
  try {
    const store = (globalObject().localStorage as Storage | undefined) ?? undefined
    store?.setItem(MODEL_KEY, id)
  } catch { /* private mode */ }
}
