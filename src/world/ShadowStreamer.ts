import * as THREE from 'three'

export interface ShadowStreamer {
  (focus: THREE.Vector3, dt?: number): void
}

/**
 * Distance-limited shadow-streaming for a static world group.
 *
 * Only casters within `radius + hysteresis` are allowed to submit to the
 * shadow map. A hysteresis band prevents repeated on/off toggling when the
 * focus moves along a bucket boundary.
 */
export function createShadowStreamer(
  root: THREE.Object3D,
  radius: number,
  hysteresis = 0,
): ShadowStreamer {
  const casters: { mesh: THREE.Mesh; position: THREE.Vector3; active: boolean }[] = []
  root.updateWorldMatrix(true, true)
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.castShadow) return
    casters.push({ mesh, position: obj.getWorldPosition(new THREE.Vector3()), active: true })
  })

  const activateDistSq = Math.max(0, radius - hysteresis) ** 2
  const deactivateDistSq = (radius + hysteresis) ** 2
  let nextRefresh = 0

  return (focus, dt = 1) => {
    nextRefresh -= dt
    if (nextRefresh > 0) return
    nextRefresh = 0.1
    for (const caster of casters) {
      const dx = caster.position.x - focus.x
      const dz = caster.position.z - focus.z
      const distSq = dx * dx + dz * dz
      if (caster.active && distSq > deactivateDistSq) {
        caster.mesh.castShadow = false
        caster.active = false
      } else if (!caster.active && distSq <= activateDistSq) {
        caster.mesh.castShadow = true
        caster.active = true
      }
    }
  }
}
