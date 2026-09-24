import { globalObject } from '../core/globals'
import type { CarStat } from './CarTuning'
import { BODY_STATIONS, CABIN_STATIONS } from '../assets/CarModel'

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

export const CAR_SPECS: readonly CarSpec[] = [
  HERO_SPEC,
  { id: 'hyper', name: 'Solaris Hyper', class: 'TOP SPEED',
    stat: { topSpeed: 1.12, nitroTopSpeed: 1.10, engineAccel: 1.02, gripMax: 0.90, gripDrift: 1.05, drag: 0.92 },
    shape: HERO_SPEC.shape, kit: { ...BASE_KIT, spoiler: 'gt', wheelStyle: 'mesh', wheelRadiusMul: 0.98, wheelWidthMul: 1.06, caliper: 0xe8b62e, glassTint: 0.06 } },
  { id: 'grip', name: 'Apex Grip', class: 'CORNER GRIP',
    stat: { topSpeed: 0.90, nitroTopSpeed: 0.90, gripMax: 1.12, gripDrift: 1.10, yawResponse: 1.08, brakeForce: 1.08 },
    shape: HERO_SPEC.shape, kit: { ...BASE_KIT, splitter: 'big', spoiler: 'none', wheelStyle: 'multi-spoke', wheelRadiusMul: 1.04, trackMul: 1.05, archExtension: 0.05, caliper: 0x39c06a } },
  { id: 'drift', name: 'Slide King', class: 'DRIFT',
    stat: { topSpeed: 0.96, nitroTopSpeed: 0.96, gripMax: 0.94, gripDrift: 0.88, driftYawBoost: 1.30, yawResponse: 1.20 },
    shape: HERO_SPEC.shape, kit: { ...BASE_KIT, splitter: 'none', spoiler: 'low', diffuserFins: 0, roofScoop: true, wheelStyle: 'teardrop', wheelWidthMul: 1.08, trackMul: 1.07, archExtension: 0.07, caliper: 0xf27a1e, glassTint: 0.04 } },
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
