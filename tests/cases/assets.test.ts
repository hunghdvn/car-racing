import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { assert, test } from '../harness'
import { mergeStaticMeshes } from '../../src/world/StaticBatch'
import { createShadowStreamer } from '../../src/world/ShadowStreamer'

/* Draw-call control units: static density folding and distance-limited shadow
 * casting. Both are required to keep the authored world inside the Gate-P
 * technique budget without removing Tier 1/2 silhouette detail. */

function staticBox(material: MeshStandardMaterial, x: number, z: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), material)
  mesh.position.set(x, 0.5, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

test('static batching: many same-material authored meshes fold into spatial batches', () => {
  const root = new Group()
  const material = new MeshStandardMaterial()
  for (let i = 0; i < 30; i++) root.add(staticBox(material, i * 0.2, 0))

  const before = root.children.length
  const folded = mergeStaticMeshes(root, {})
  const after = root.children.filter((child): child is Mesh => (child as Mesh).isMesh === true).length

  assert(before === 30, 'the authored input contains 30 individual meshes')
  assert(folded >= 25, `at least the non-last mesh per bucket folds (${folded})`)
  assert(after > 0 && after <= 4, `thirty authored meshes leave at most four batched draws (${after})`)
})

test('static batching: dynamic callers can preserve named parts and keep shadows', () => {
  const root = new Group()
  const material = new MeshStandardMaterial()
  for (let i = 0; i < 8; i++) root.add(staticBox(material, i, 0))
  const dynamic = staticBox(material, 0, 10)
  dynamic.name = 'dynamic-part'
  dynamic.castShadow = false
  root.add(dynamic)

  mergeStaticMeshes(root, { keepNames: ['dynamic-part'] })

  assert(root.children.includes(dynamic), 'a preserved mesh stays attached')
  assert(dynamic.castShadow === false, 'a preserved mesh keeps its own shadow setting')
  assert(root.children.some((child) => {
    const mesh = child as Mesh
    return mesh.isMesh === true && mesh.name !== 'dynamic-part' && mesh.castShadow && mesh.receiveShadow
  }), 'batched meshes retain both shadow flags from their source bucket')
})

test('shadow distance: only authored casters inside the neighborhood submit to the shadow map', () => {
  const root = new Group()
  const material = new MeshStandardMaterial()
  const near = staticBox(material, 5, 0)
  const edge = staticBox(material, 82, 0)
  const far = staticBox(material, 140, 0)
  root.add(near, edge, far)

  const focus = new Vector3(0, 0, 0)
  const streamer = createShadowStreamer(root, 80, 20)
  streamer(focus)
  assert(near.castShadow, 'near casters remain active')
  assert(edge.castShadow, 'hysteresis keeps the boundary band stable')
  assert(!far.castShadow, 'far casters are excluded from the shadow pass')

  streamer(focus, 0.75)
  assert(near.castShadow, 'refresh cadence does not toggle near casters')

  streamer(new Vector3(140, 0, 0), 0.75)
  assert(!near.castShadow, 'moving the neighborhood deactivates old casters')
  assert(far.castShadow, 'the newly nearby caster activates')
})

/* PR review F1: the model-swap dispose must never touch the field-wide shared
 * car materials (detail trims, LED signatures, memoised wheel hardware) that
 * mounted AI cars still use, while geometry always goes. disposeCarTree
 * mirrors util.disposeTree's shape (geometry always, material arrays handled)
 * with a shared-material predicate. */

test('car lifecycle: disposeCarTree frees geometry always, materials only when not shared', async () => {
  const mod = await import('../../src/assets/CarModel').catch(() => null)
  const disposeCarTree = mod?.disposeCarTree as unknown as
    ((root: Group, isShared?: (m: unknown) => boolean) => void) | undefined
  const isSharedCarMaterial = mod?.isSharedCarMaterial as unknown as ((m: unknown) => boolean) | undefined
  assert(typeof disposeCarTree === 'function', 'disposeCarTree is exported from CarModel')
  assert(typeof isSharedCarMaterial === 'function', 'isSharedCarMaterial is exported from CarModel')
  assert(isSharedCarMaterial!(new MeshStandardMaterial()) === false, 'a fresh material is never shared')

  const mkMat = (): { dispose(): void; disposed: number } => {
    const m = { disposed: 0, dispose() { m.disposed++ } }
    return m
  }
  const shared = mkMat()
  const solo = mkMat()
  const geo = new BoxGeometry(1, 1, 1)
  let geoDisposed = 0
  geo.dispose = () => { geoDisposed++ }
  const mesh = new Mesh(geo as never, [shared as never, solo as never])
  const root = new Group()
  root.add(mesh)
  disposeCarTree(root, (m) => m === (shared as never))
  assert(geoDisposed === 1, 'geometry is always disposed')
  assert(shared.disposed === 0, 'a shared singleton survives the model swap (mounted AI cars still use it)')
  assert(solo.disposed === 1, 'a non-shared material inside a material array is disposed')
})
