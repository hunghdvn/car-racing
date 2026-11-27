import type * as THREE from 'three'
import contract from './car-contract.json'

/* ------------------------------------------------------------------------- *
 * Shared-resource registry for the real-car GLB clones (spec §5).
 *
 * A preloaded GLB is cloned, and THREE clones SHARE geometry and material
 * references with the source. disposeCarTree must therefore never dispose a
 * GLB buffer: one car leaving the garage would kill the paint under all the
 * others and the preload cache alike. The WeakSets below are the spares list,
 * filled once at preload time. A separate module (rather than living inside
 * CarModel.ts) keeps the CarModel → CarLibrary → CarModel edge acyclic.
 * ------------------------------------------------------------------------- */

const sharedCarGeos = new WeakSet<THREE.BufferGeometry>()
const sharedGLBMats = new WeakSet<THREE.Material>()

/** mark a GLB-authored geometry as preload-owned (never disposed by a clone) */
export function markCarGeometryShared(g: unknown): void {
  if (g != null) sharedCarGeos.add(g as THREE.BufferGeometry)
}

/** true when disposing a car tree must spare this geometry */
export function isSharedCarGeometry(g: unknown): boolean {
  return g != null && sharedCarGeos.has(g as THREE.BufferGeometry)
}

/** mark a GLB-authored material as preload-owned (clones reuse the reference) */
export function markGLBMaterialShared(m: unknown): void {
  if (m != null) sharedGLBMats.add(m as THREE.Material)
}

/** true when disposing a car tree must spare this material */
export function isGLBMaterialShared(m: unknown): boolean {
  return m != null && sharedGLBMats.has(m as THREE.Material)
}

/** The shared load-bearing contract (PR #21 r4): sanity bands + synthesized
 *  part names live in ONE JSON read by the runtime (here), the unit suite,
 *  the functional battery (via the dev harness) AND both pipeline scripts
 *  through fs — the emitter that validates a report and the runtime that
 *  gates a clone can no longer hold contradictory numbers (emit-rigs shipped
 *  its own [0.24, 0.44]/[-0.08, 0.24] beside this module's values for a
 *  whole round, so a legal re-bake hit a CI wall no rerun could clear). */
export const CAR_CONTRACT = contract

/** Rig sanity bands — nudging a band moves the runtime clone gate, the unit
 *  suite and the functional battery at once (PR #21 r3: four photocopies,
 *  narrowing one silently demoted cars to procedural). */
export const RIG_BANDS = {
  /** per-corner tyre radius, metres */
  radius: contract.rigBands.radius as unknown as readonly [number, number],
  /** body lowest point relative to the contact patch, metres (negative =
   *  splitter clipping the road — the accepted trade, see optimize-cars) */
  clearance: contract.rigBands.clearance as unknown as readonly [number, number],
}

/** brake-disc / caliper material + node prefix test, contract-fed: the
 *  DoubleSide fan fix and the caliper re-tint both hang off these names */
export const CAR_BRAKE_PART_RE = new RegExp(
  `^(${contract.nodePrefixes.brake}|${contract.nodePrefixes.caliper})`)
