import * as THREE from 'three'
import { mergeGeometries } from '../util'

/* ------------------------------------------------------------------------- *
 * Static density batching (spec §4.7/§17): authored density groups are many
 * single-material meshes. Each spatially local, render-identical bucket folds
 * into one mesh so an authored cluster costs a handful of draws instead of
 * thousands, while the cell bound keeps frustum and shadow-cascade culling
 * local. LOD levels, instanced sets, transparent materials, and explicitly
 * named dynamic parts stay exactly as authored.
 * ------------------------------------------------------------------------- */

const CELL = 24

let enabled = true
export function setStaticMergeEnabled(v: boolean): void { enabled = v }
export function staticMergeEnabled(): boolean { return enabled }

/* dev audit (harness reads via __dbg.densityAudit): what folded, what stayed */
const audit: { root: string; folded: number; buckets: number; fingerprinted: number; idKeys: number }[] = []
export function densityAudit(): object[] { return audit }

interface Bucket {
  mat: THREE.Material
  cast: boolean
  receive: boolean
  origin: THREE.Vector3
  parts: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]
  keep: THREE.Mesh[]
}

interface MergeStats {
  folded: number
  buckets: number
  fingerprinted: number
  idKeys: number
}

interface Scope {
  dest: THREE.Object3D
  inv: THREE.Matrix4
  buckets: Map<string, Bucket>
  stats: MergeStats
}

function materialFingerprint(m: THREE.Material): string {
  const o = m as unknown as Record<string, unknown>
  const std = m as unknown as { isMeshStandardMaterial?: boolean; isMeshPhysicalMaterial?: boolean; isMeshPhongMaterial?: boolean; isMeshLambertMaterial?: boolean }
  if (!std.isMeshStandardMaterial && !std.isMeshPhysicalMaterial && !std.isMeshPhongMaterial && !std.isMeshLambertMaterial) return `id:${m.id}`
  if (Object.prototype.hasOwnProperty.call(o, 'customProgramMaterial') && o.customProgramMaterial) return `id:${m.id}`
  if (Object.prototype.hasOwnProperty.call(o, 'onBeforeCompile') && o.onBeforeCompile) return `id:${m.id}`
  if (Object.prototype.hasOwnProperty.call(o, 'onBeforeRender') && o.onBeforeRender) return `id:${m.id}`
  const props = o.properties as { size?: number } | undefined
  if (props && typeof props.size === 'number' && props.size > 0) return `id:${m.id}`
  const parts: string[] = [m.type]
  for (const k of Object.keys(o).sort()) {
    if (k === 'id' || k === 'uuid' || k === 'name' || k === 'version' || k === 'source' || k === 'properties' || k === 'userData') continue
    const v = o[k]
    if (typeof v === 'function') return `id:${m.id}`
    if (v === null || v === undefined) { parts.push(k, '-'); continue }
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') { parts.push(k, String(v)); continue }
    if (Array.isArray(v)) { parts.push(k, v.join(',')); continue }
    const any = v as { isTexture?: boolean; isColor?: boolean; toArray?: () => number[]; uuid?: string }
    if (any.isTexture) {
      const t = v as unknown as { uuid: string; offset: { x: number; y: number }; repeat: { x: number; y: number }; center: { x: number; y: number }; rotation: number; wrapS: number; wrapT: number; magFilter: number; minFilter: number; generateMipmaps: boolean; colorSpace: string }
      parts.push(k, `${t.uuid}#${t.offset.x},${t.offset.y}|${t.repeat.x},${t.repeat.y}|${t.center.x},${t.center.y}|${t.rotation}|${t.wrapS},${t.wrapT}|${t.magFilter},${t.minFilter}|${t.generateMipmaps}|${t.colorSpace}`)
      continue
    }
    if (any.isColor) { parts.push(k, (v as THREE.Color).getHexString()); continue }
    if (typeof any.toArray === 'function') { parts.push(k, any.toArray().join(',')); continue }
    try { parts.push(k, JSON.stringify(v, (_k, vv) => { if (typeof vv === 'function') throw new Error('fn'); return vv })) } catch { return `id:${m.id}` }
  }
  return parts.join('|')
}

function attributeSignature(geo: THREE.BufferGeometry): string {
  const attrs = (geo as unknown as { attributes?: Record<string, { itemSize?: number }> }).attributes
  if (!attrs) return ''
  return Object.keys(attrs).sort().map((k) => `${k}${attrs[k]?.itemSize ?? '?'}`).join(',')
}

function isBatchable(m: THREE.Object3D, keepNames: ReadonlySet<string>): m is THREE.Mesh {
  const o = m as unknown as {
    isMesh?: boolean; isInstancedMesh?: boolean; isSkinnedMesh?: boolean
    visible?: boolean; renderOrder?: number; children?: unknown[]
    frustumCulled?: boolean; name?: string
    geometry?: { getAttribute?: (name: string) => unknown; morphAttributes?: unknown[] }
    material?: { transparent?: boolean } | unknown[]
  }
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return false
  if (!o.visible || (o.renderOrder ?? 0) !== 0) return false
  if (o.frustumCulled === false) return false
  if (o.name && keepNames.has(o.name)) return false
  if ((o.children?.length ?? 0) > 0) return false
  if (Array.isArray(o.material) || !o.material) return false
  if ((o.material as { transparent?: boolean }).transparent) return false
  const mat = o.material as { isMeshBasicMaterial?: boolean; isMeshDepthMaterial?: boolean }
  if (mat.isMeshBasicMaterial || mat.isMeshDepthMaterial) return false
  const geo = o.geometry
  if (!geo || typeof geo.getAttribute !== 'function' || !geo.getAttribute('position')) return false
  if (geo.morphAttributes?.length) return false
  return true
}

function flushScope(scope: Scope): number {
  let folded = 0
  scope.stats.buckets += scope.buckets.size
  for (const b of scope.buckets.values()) {
    if (b.parts.length < 2) continue
    const mesh = new THREE.Mesh(mergeGeometries(b.parts), b.mat)
    mesh.name = 'static-batch'
    mesh.position.copy(b.origin)
    mesh.castShadow = b.cast
    mesh.receiveShadow = b.receive
    scope.dest.add(mesh)
    for (const m of b.keep) m.parent?.remove(m)
    scope.stats.folded += b.parts.length - 1
  }
  return scope.stats.folded
}

function foldMesh(scope: Scope, m: THREE.Mesh, cellSize: number): void {
  const mat = m.material as THREE.Material
  const world = m.getWorldPosition(new THREE.Vector3())
  const cell = `${Math.floor(world.x / cellSize)}:${Math.floor(world.z / cellSize)}`
  const fingerprint = materialFingerprint(mat)
  if (fingerprint.startsWith('id:')) scope.stats.idKeys++
  else scope.stats.fingerprinted++
  const key = `${cell}|${fingerprint}|${m.castShadow ? 1 : 0}|${m.receiveShadow ? 1 : 0}|${attributeSignature(m.geometry)}`
  const matrix = new THREE.Matrix4().multiplyMatrices(scope.inv, m.matrixWorld)
  let b = scope.buckets.get(key)
  if (!b) {
    b = { mat, cast: m.castShadow, receive: m.receiveShadow, origin: new THREE.Vector3(matrix.elements[12]!, matrix.elements[13]!, matrix.elements[14]!), parts: [], keep: [] }
    scope.buckets.set(key, b)
  }
  if (b.origin.x !== 0 || b.origin.y !== 0 || b.origin.z !== 0) matrix.premultiply(new THREE.Matrix4().makeTranslation(-b.origin.x, -b.origin.y, -b.origin.z))
  b.parts.push({ geometry: m.geometry, matrix })
  b.keep.push(m)
}

function collect(scope: Scope, node: THREE.Object3D, keepNames: ReadonlySet<string>, cellSize: number): void {
  for (const ch of node.children) {
    if ((ch as unknown as { isLOD?: boolean }).isLOD) {
      for (const lvl of ch.children) {
        const level: Scope = { dest: lvl, inv: new THREE.Matrix4().copy(lvl.matrixWorld).invert(), buckets: new Map(), stats: scope.stats }
        collect(level, lvl, keepNames, cellSize)
        flushScope(level)
      }
      continue
    }
    if (ch.name && keepNames.has(ch.name) && !(ch as unknown as { isMesh?: boolean }).isMesh) {
      const landmark: Scope = { dest: ch, inv: new THREE.Matrix4().copy(ch.matrixWorld).invert(), buckets: new Map(), stats: scope.stats }
      collect(landmark, ch, keepNames, cellSize)
      flushScope(landmark)
      continue
    }
    if (isBatchable(ch, keepNames)) foldMesh(scope, ch, cellSize)
    collect(scope, ch, keepNames, cellSize)
  }
}

/** Fold the authored static density under `root` into local, render-identical
 *  batches. `keepNames` names meshes whose identity/animation/shadow policy
 *  must remain individually drawn. */
export function mergeStaticMeshes(root: THREE.Object3D, opts?: { keepNames?: Iterable<string>; cellSize?: number }): number {
  if (!enabled) return 0
  const keepNames = new Set(opts?.keepNames ?? [])
  const cellSize = Math.max(1, opts?.cellSize ?? CELL)
  root.updateWorldMatrix(true, true)
  const stats: MergeStats = { folded: 0, buckets: 0, fingerprinted: 0, idKeys: 0 }
  const scope: Scope = { dest: root, inv: new THREE.Matrix4().copy(root.matrixWorld).invert(), buckets: new Map(), stats }
  collect(scope, root, keepNames, cellSize)
  flushScope(scope)
  audit.push({ root: root.name, ...stats })
  return stats.folded
}

/** Compatibility alias for the existing world-density call sites. */
export const mergeStaticGroup = mergeStaticMeshes
