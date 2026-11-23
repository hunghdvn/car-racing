import { CAR, VEHICLE } from '../config'

/* ------------------------------------------------------------------------- *
 * Per-car resolved physics tuning (car-models spec §7): one record of plain
 * numbers over the VEHICLE base, produced once per model by resolveTuning.
 * Read-only per step inside VehiclePhysics — swapping it between steps (the
 * title-screen model switch) is safe precisely because nothing caches it.
 * ------------------------------------------------------------------------- */

export type CarTuning = { [K in keyof typeof VEHICLE]: number }

/** multipliers over VEHICLE fields with a clear gameplay meaning (spec §7) */
export interface CarStat {
  topSpeed?: number
  nitroTopSpeed?: number
  engineAccel?: number
  brakeForce?: number
  gripMax?: number
  gripDrift?: number
  driftYawBoost?: number
  yawResponse?: number
  drag?: number
}

export const BASE_TUNING: CarTuning = { ...VEHICLE }

/** writable working copy of the resolved record (the homomorphic mapped type
 *  over the as-const VEHICLE keeps its readonly modifiers; the build below
 *  needs to write into its own fresh object) */
type MutableTuning = { -readonly [K in keyof CarTuning]: number }

export function resolveTuning(stat: Partial<CarStat>): CarTuning {
  const t = { ...VEHICLE } as MutableTuning
  const lo = 1 - CAR.statClamp
  const hi = 1 + CAR.statClamp
  for (const k of Object.keys(stat) as (keyof CarStat)[]) {
    const m = stat[k]
    if (m === undefined || !Number.isFinite(m)) continue
    t[k] = VEHICLE[k] * Math.min(hi, Math.max(lo, m))
  }
  return t
}
