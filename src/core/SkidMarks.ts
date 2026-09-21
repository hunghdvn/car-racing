import * as THREE from 'three'
import { SKIDS } from '../config'

/* ------------------------------------------------------------------------- *
 * Persistent rear-wheel skid decals (spec §15): one InstancedMesh of pooled,
 * ring-buffer recycled quads laid flat on the surface. Writes stop at the
 * pool capacity — the ring overwrites the oldest marks first, so the trail
 * persists across the lap and recycles deterministically. Rendered with
 * Multiply blending: a fresh mark multiplies the road toward the rubber
 * tint, and an expiring mark lerps back to white (invisible), so death needs
 * no alpha and no allocation.
 * ------------------------------------------------------------------------- */

/**
 * Pure ring buffer of decal records — no THREE/DOM, headless-testable.
 * `put` writes the next ring slot; once full the oldest slot is recycled,
 * so insertion order is always the eviction order.
 */
export class SkidRing {
  readonly cap: number
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array
  readonly yaw: Float32Array; readonly pitch: Float32Array; readonly bank: Float32Array
  readonly age: Float32Array
  readonly life: number
  readonly hold: number
  readonly fade: number
  private cursor = 0

  constructor(cap: number, holdSec: number, fadeSec: number) {
    this.cap = Math.max(4, Math.floor(cap))
    this.hold = holdSec
    this.fade = fadeSec
    this.life = holdSec + fadeSec
    this.x = new Float32Array(this.cap); this.y = new Float32Array(this.cap); this.z = new Float32Array(this.cap)
    this.yaw = new Float32Array(this.cap); this.pitch = new Float32Array(this.cap); this.bank = new Float32Array(this.cap)
    this.age = new Float32Array(this.cap)
    this.age.fill(this.life + 1) // start dead
  }

  /** ring write; returns the slot (the previous occupant is evicted) */
  put(x: number, y: number, z: number, yaw: number, pitch: number, bank: number): number {
    const i = this.cursor
    this.cursor = (i + 1) % this.cap
    this.x[i] = x; this.y[i] = y; this.z[i] = z
    this.yaw[i] = yaw; this.pitch[i] = pitch; this.bank[i] = bank
    this.age[i] = 0
    return i
  }

  update(dt: number): void {
    for (let i = 0; i < this.cap; i++) if (this.age[i] <= this.life) this.age[i] += dt
  }

  isAlive(i: number): boolean { return this.age[i] <= this.life }

  /** 1 = freshly laid (full tint), 0 = gone (white / no-op under Multiply) */
  ink(i: number): number {
    if (!this.isAlive(i)) return 0
    const t = this.age[i] - this.hold
    return t <= 0 ? 1 : Math.max(0, 1 - t / this.fade)
  }

  aliveCount(): number {
    let n = 0
    for (let i = 0; i < this.cap; i++) if (this.isAlive(i)) n++
    return n
  }

  clear(): void { this.age.fill(this.life + 1) }
}

const TINT = new THREE.Color(SKIDS.tint)
const WHITE = new THREE.Color(0xffffff)

/** Decal renderer: ring records -> instance matrices + multiply ink. */
export class SkidMarks {
  readonly ring: SkidRing
  readonly mesh: THREE.InstancedMesh
  private readonly dummy = new THREE.Object3D()
  private readonly col = new THREE.Color()

  constructor(scene: THREE.Object3D) {
    this.ring = new SkidRing(SKIDS.pool, SKIDS.holdSec, SKIDS.fadeSec)
    const geo = new THREE.PlaneGeometry(SKIDS.width, SKIDS.len).rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      blending: THREE.MultiplyBlending,
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, this.ring.cap)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage)
    // park every instance invisible (white = multiply no-op) until first laid
    this.col.copy(WHITE)
    for (let i = 0; i < this.ring.cap; i++) {
      this.dummy.position.set(0, -1e4, 0)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
      this.mesh.setColorAt(i, this.col)
    }
    scene.add(this.mesh)
  }

  /** lay one mark at a rear-wheel contact patch (world y is the surface) */
  lay(x: number, y: number, z: number, yaw: number, pitch: number, bank: number): void {
    this.ring.put(x, y + 0.014, z, yaw, pitch, bank)
  }

  /** refresh instance ink every render step (allocation-free) */
  update(dt: number): void {
    const r = this.ring
    r.update(dt)
    for (let i = 0; i < r.cap; i++) {
      const ink = r.ink(i)
      if (ink <= 0) { this.hideInstance(i); continue }
      this.dummy.position.set(r.x[i], r.y[i], r.z[i])
      this.dummy.rotation.order = 'YXZ'
      this.dummy.rotation.set(r.pitch[i], r.yaw[i], r.bank[i])
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
      this.col.copy(WHITE).lerp(TINT, ink)
      this.mesh.setColorAt(i, this.col)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  private hideInstance(i: number): void {
    this.dummy.position.set(0, -1e4, 0)
    this.dummy.updateMatrix()
    this.mesh.setMatrixAt(i, this.dummy.matrix)
    this.col.copy(WHITE)
    this.mesh.setColorAt(i, this.col)
  }

  /** wipe the whole board (restart / frozen pose capture) */
  clear(): void {
    this.ring.clear()
    for (let i = 0; i < this.ring.cap; i++) this.hideInstance(i)
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}
