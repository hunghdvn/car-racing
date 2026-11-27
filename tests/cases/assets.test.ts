import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { assert, test } from '../harness'
import { densityAudit, mergeStaticMeshes } from '../../src/world/StaticBatch'
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

/* PR review F1/R2-11/R3-4: the model-swap dispose must never touch the field-wide
 * shared car materials (detail trims, LED signatures, memoised wheel hardware)
 * that mounted AI cars still use, while geometry always goes. R2-11: the old
 * test injected its own isShared predicate and fake singleton objects, so it
 * only proved disposeCarTree honours a callback. R3-4: the round-2 version
 * pinned ONE singleton (chrome) — mutating memoDetailMat to add only chrome
 * to the shared set stayed green while the other twelve regressed to the F1
 * bug class. This version iterates the FULL production surface
 * (sharedCarMaterials(): every factory with its hero arguments), asserts the
 * REAL predicate recognises EVERY entry and the production disposeCarTree
 * spares every one, restores every spied dispose in try/finally, and proves
 * memoisation identity across invocations. The canvas-dependent factories run
 * on a minimal node 2D-context stub (installed for this test only). */

interface StubImage { data: Uint8ClampedArray; width: number; height: number }

function installNodeCanvasStub(): () => void {
  const g = globalThis as Record<string, unknown>
  const saved = g.document
  const makeCtx = (): unknown => {
    const t: Record<string, unknown> = {}
    return new Proxy(t, {
      get(target, prop: string): unknown {
        if (prop in target) return target[prop]
        if (prop === 'canvas') return null
        return (...args: unknown[]): unknown => {
          if (prop === 'createImageData') {
            const [w, h] = args as [number, number]
            const buf = new Uint8ClampedArray(w * h * 4)
            for (let i = 3; i < buf.length; i += 4) buf[i] = 255
            return { data: buf, width: w, height: h } satisfies StubImage
          }
          if (prop === 'putImageData') { t.__img = args[0]; return undefined }
          if (prop === 'getImageData') {
            const img = t.__img as StubImage | undefined
            const [x0, y0, w, h] = args as [number, number, number, number]
            const buf = new Uint8ClampedArray(w * h * 4)
            if (img && x0 === 0 && y0 === 0) buf.set(img.data.subarray(0, Math.min(buf.length, img.data.length)))
            return { data: buf, width: w, height: h } satisfies StubImage
          }
          if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return { addColorStop: () => { /* no-op */ } }
          if (prop === 'measureText') return { width: 0 }
          return undefined
        }
      },
      set(target, prop: string, v: unknown): boolean { target[prop] = v; return true },
    })
  }
  g.document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`node canvas stub: unexpected createElement('${tag}')`)
      return { width: 0, height: 0, getContext: () => makeCtx() }
    },
  }
  return () => { if (saved === undefined) delete g.document; else g.document = saved }
}

test('car lifecycle: disposeCarTree spares EVERY field-wide shared singleton (full surface, R3-4)', async () => {
  const mod = await import('../../src/assets/CarModel').catch(() => null)
  const disposeCarTree = mod?.disposeCarTree as unknown as
    ((root: Group) => void) | undefined
  const isSharedCarMaterial = mod?.isSharedCarMaterial as unknown as ((m: unknown) => boolean) | undefined
  const sharedCarMaterials = mod?.sharedCarMaterials as unknown as (() => MeshStandardMaterial[]) | undefined
  assert(typeof disposeCarTree === 'function', 'disposeCarTree is exported from CarModel')
  assert(typeof isSharedCarMaterial === 'function', 'isSharedCarMaterial is exported from CarModel')
  assert(typeof sharedCarMaterials === 'function', 'the full shared-surface accessor is exported (R3-4)')
  assert(isSharedCarMaterial!(new MeshStandardMaterial()) === false, 'the real predicate rejects a fresh material')

  const restoreDoc = installNodeCanvasStub()
  type Spied = { mat: MeshStandardMaterial; orig: () => void; count: number }
  const spies: Spied[] = []
  try {
    const mats = sharedCarMaterials!()
    assert(mats.length >= 14, `the accessor covers the whole shared set, not a sample (${mats.length})`)
    assert(new Set(mats).size === mats.length, 'every factory returns a distinct memoised singleton')
    assert(sharedCarMaterials!().every((m, i) => m === mats[i]), 'factories are memoised (identity stable across calls)')
    for (const m of mats) assert(isSharedCarMaterial!(m) === true, `the REAL predicate recognises the REAL singleton (${m.type})`)

    for (const m of mats) {
      const spy: Spied = { mat: m, orig: m.dispose.bind(m), count: 0 }
      m.dispose = () => { spy.count++ }
      spies.push(spy)
    }
    const solo = new MeshStandardMaterial()
    let soloDisposed = 0
    const soloOrig = solo.dispose.bind(solo)
    solo.dispose = () => { soloDisposed++ }
    const geo = new BoxGeometry(1, 1, 1)
    let geoDisposed = 0
    geo.dispose = () => { geoDisposed++ }
    const mesh = new Mesh(geo as never, [...mats, solo])
    const root = new Group()
    root.add(mesh)
    disposeCarTree!(root) // NO injected predicate — the default isSharedCarMaterial decides
    assert(geoDisposed === 1, 'geometry is always disposed')
    for (const s of spies) assert(s.count === 0, `the real shared singleton (${s.mat.type}) survives the model swap (mounted AI cars still use it)`)
    assert(soloDisposed === 1, 'a fresh material in the array is disposed by the real predicate')
    solo.dispose = soloOrig
  } finally {
    for (const s of spies) s.mat.dispose = s.orig
    restoreDoc()
  }
})

/* R3-6: mergeStaticMeshes used to push an audit entry per call forever — every
 * selectModel buildCar (and every harness dev-boot) leaked one object per
 * car build. The log is now a bounded ring of the most recent AUDIT_LIMIT folds. */
test('static batching: the dev audit log stays bounded across repeated builds (R3-6)', () => {
  const material = new MeshStandardMaterial()
  for (let i = 0; i < 40; i++) {
    const root = new Group()
    root.name = `ring-root-${i}`
    root.add(staticBox(material, 0, 0), staticBox(material, 1, 0))
    mergeStaticMeshes(root, {})
  }
  const a = densityAudit()
  assert(a.length === 32, `40 merges on top of earlier ones stay capped at the 32-entry ring (${a.length})`)
  const last = a[a.length - 1] as { root?: string }
  assert(last.root === 'ring-root-39', 'the ring keeps the MOST RECENT folds (harness still reads the live tail)')
})

/* ---------------------------------------------------------------- car library */

test('car library: module contract is safe to import in node (no window/fetch at module scope)', async () => {
  const lib = await import('../../src/assets/CarLibrary')
  assert(typeof lib.preloadCars === 'function' && typeof lib.cloneRealCar === 'function'
    && typeof lib.libraryReady === 'function' && typeof lib.disposeLibrary === 'function', 'library API surface')
  assert(lib.libraryReady() === false, 'the cache is cold at import time (boot fires preloadCars itself)')
})

test('car library: disposeCarTree spares GLB-shared geometry (clones share buffers)', async () => {
  const mod = await import('../../src/assets/CarModel').catch(() => null)
  const disposeCarTree = mod?.disposeCarTree as unknown as ((root: Group) => void) | undefined
  const markCarGeometryShared = mod?.markCarGeometryShared as unknown as ((g: unknown) => void) | undefined
  assert(typeof disposeCarTree === 'function' && typeof markCarGeometryShared === 'function',
    'disposeCarTree + markCarGeometryShared are exported from CarModel')
  const seen = { shared: false, own: false }
  const shared = new BoxGeometry()
  shared.addEventListener('dispose', () => { seen.shared = true })
  markCarGeometryShared!(shared)
  const own = new BoxGeometry()
  own.addEventListener('dispose', () => { seen.own = true })
  const root = new Group()
  root.add(new Mesh(shared, new MeshStandardMaterial()))
  root.add(new Mesh(own, new MeshStandardMaterial()))
  disposeCarTree!(root)
  assert(seen.shared === false, 'a GLB-shared geometry must survive car disposal — the preload cache still references it')
  assert(seen.own === true, 'per-instance geometry (glow planes, flames) still disposes normally')
})

test('car library: disposeCarTree spares GLB-authored + detail singleton MATERIALS (PR #21 review #8)', async () => {
  const mod = await import('../../src/assets/CarModel')
  const { markGLBMaterialShared } = await import('../../src/assets/CarShared')
  const seen = { glb: 0, own: 0, detail: 0 }
  const glbMat = new MeshStandardMaterial() // stands in for a template brake-disc/glass material
  markGLBMaterialShared(glbMat)
  glbMat.addEventListener('dispose', () => { seen.glb++ })
  const ownMat = new MeshStandardMaterial() // stands in for the per-clone paint mat
  ownMat.addEventListener('dispose', () => { seen.own++ })
  const detail = mod.shared.chrome() // field-wide memoised singleton
  detail.addEventListener('dispose', () => { seen.detail++ })
  const root = new Group()
  root.add(new Mesh(new BoxGeometry(), [glbMat, ownMat]))
  root.add(new Mesh(new BoxGeometry(), detail))
  mod.disposeCarTree(root)
  assert(seen.glb === 0, 'a markGLBMaterialShared material survives — every sibling clone still renders with it')
  assert(seen.own === 1, 'the per-instance material is disposed exactly once')
  assert(seen.detail === 0, 'field-wide detail singletons (shared.chrome()) are spared by the DEFAULT predicate, no stub')
})
