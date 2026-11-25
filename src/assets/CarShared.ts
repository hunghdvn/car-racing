import type * as THREE from 'three'

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
