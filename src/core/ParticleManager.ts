import * as THREE from 'three'
import { FX, PARTICLES, SEED, THEME } from '../config'
import { clamp01, Rand } from '../util'

/* ------------------------------------------------------------------------- *
 * Pooled world-space particle FX (spec §15/§17): drift smoke, off-road dust,
 * impact sparks + debris, landing puffs, the nitro trail behind the built
 * flames, and coastal water splash. Each kind is one THREE.Points driven by
 * a ring-buffer pool of fixed Float32Arrays — zero allocation in the steady
 * state, capacity scaled by the quality tier, deterministic randomness from
 * one SEED stream. The simulation core (ParticlePool) is pure and headless-
 * testable; the renderer only mirrors its arrays into GPU attributes.
 * ------------------------------------------------------------------------- */

/**
 * Pure particle pool: fixed-capacity ring buffer. `spawn` overwrites the
 * oldest slot once full (deterministic recycling), `update` integrates and
 * ages every live record. No DOM, no WebGL — directly unit-testable.
 */
export class ParticlePool {
  readonly cap: number
  readonly px: Float32Array; readonly py: Float32Array; readonly pz: Float32Array
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array
  readonly age: Float32Array; readonly life: Float32Array
  readonly size0: Float32Array; readonly size1: Float32Array
  readonly drag: Float32Array; readonly grav: Float32Array
  private cursor = 0

  constructor(cap: number) {
    this.cap = cap
    this.px = new Float32Array(cap); this.py = new Float32Array(cap); this.pz = new Float32Array(cap)
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap); this.vz = new Float32Array(cap)
    this.age = new Float32Array(cap); this.life = new Float32Array(cap)
    this.size0 = new Float32Array(cap); this.size1 = new Float32Array(cap)
    this.drag = new Float32Array(cap); this.grav = new Float32Array(cap)
  }

  /** ring write of one record; returns the slot it landed on */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number, drag: number, grav: number): number {
    const i = this.cursor
    this.cursor = (i + 1) % this.cap
    this.px[i] = x; this.py[i] = y; this.pz[i] = z
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz
    this.age[i] = 0; this.life[i] = life
    this.size0[i] = size0; this.size1[i] = size1
    this.drag[i] = drag; this.grav[i] = grav
    return i
  }

  /** integrate every live record (ballistic + drag), then age it */
  update(dt: number): void {
    const { px, py, pz, vx, vy, vz, age, life, drag, grav, cap } = this
    for (let i = 0; i < cap; i++) {
      if (age[i] >= life[i]) continue
      const d = Math.max(0, 1 - drag[i] * dt)
      vx[i] *= d; vz[i] *= d
      vy[i] = vy[i] * d - grav[i] * dt
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt
      age[i] += dt
    }
  }

  isAlive(i: number): boolean { return this.life[i] > 0 && this.age[i] < this.life[i] }
  /** 0 at birth .. 1 at death */
  fade(i: number): number { return this.life[i] > 0 ? clamp01(this.age[i] / this.life[i]) : 1 }
  aliveCount(): number {
    let n = 0
    for (let i = 0; i < this.cap; i++) if (this.isAlive(i)) n++
    return n
  }
  clear(): void {
    this.age.fill(0)
    this.life.fill(0)
  }
}

/**
 * Soft round sprite as a DataTexture. The falloff rides in the RGB channels:
 * PointsMaterial's alphaMap multiplies the G channel into the point alpha,
 * so the sprite works unmodified as material.alphaMap.
 */
function discTexture(): THREE.DataTexture {
  const n = 32
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5, dy = (y + 0.5) / n - 0.5
      const r = Math.hypot(dx, dy) * 2
      const a = r >= 1 ? 0 : Math.pow(1 - r, 1.7) * 255
      const i = (y * n + x) * 4
      const v = Math.round(a)
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, n, n)
  tex.needsUpdate = true
  return tex
}

interface EmitterSpec { cap: number; color: number; additive: boolean; /** reference-space point size */ size: number; opacity?: number; /** discard points below this alpha (cheap overdraw cut) */ alphaTest?: number }

/** One Points render backed by a ParticlePool. */
class Emitter {
  readonly pool: ParticlePool
  readonly points: THREE.Points
  readonly material: THREE.PointsMaterial
  private posAttr: THREE.BufferAttribute
  private colAttr: THREE.BufferAttribute
  private cols: Float32Array
  private xyz: Float32Array

  constructor(spec: EmitterSpec, map: THREE.DataTexture) {
    this.pool = new ParticlePool(Math.max(8, Math.floor(spec.cap)))
    const n = this.pool.cap
    this.cols = new Float32Array(n * 4)
    this.xyz = new Float32Array(n * 3)
    const geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(this.xyz, 3)
    this.colAttr = new THREE.BufferAttribute(this.cols, 4)
    this.posAttr.setUsage(THREE.DynamicDrawUsage)
    this.colAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', this.posAttr)
    geo.setAttribute('color', this.colAttr)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2e4)
    const mat = new THREE.PointsMaterial({
      color: spec.color,
      alphaMap: map,
      size: spec.size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: spec.opacity ?? 1,
      depthWrite: false,
      alphaTest: spec.alphaTest ?? 0.015,
      blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.points = new THREE.Points(geo, mat)
    this.material = mat
    this.points.frustumCulled = false
    this.points.renderOrder = 4
  }

  /** mirror the pool into the GPU attributes (allocation-free): the SoA pool
   *  is interleaved into xyz, and per-point RGBA rides in the vec4 color
   *  attribute; dead points get alpha 0 */
  sync(): void {
    const p = this.pool
    for (let i = 0; i < p.cap; i++) {
      const j = i * 3, k = i * 4
      if (!p.isAlive(i)) { this.cols[k + 3] = 0; continue }
      this.xyz[j] = p.px[i]; this.xyz[j + 1] = p.py[i]; this.xyz[j + 2] = p.pz[i]
      const f = p.fade(i)
      // fade in fast, fade out with the tail of the life
      const fadeIn = Math.min(1, f / 0.08)
      this.cols[k] = 1; this.cols[k + 1] = 1; this.cols[k + 2] = 1
      this.cols[k + 3] = fadeIn * (1 - f) * (1 - f)
    }
    this.posAttr.needsUpdate = true
    this.colAttr.needsUpdate = true
  }

  dispose(): void {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}

export interface FxTiers { /** live QUALITY[tier].particles multiplier */ particles: () => number }

/**
 * World-space FX bus. The Game owns one; emitters read gameplay only and
 * never write physics/racing state. All spawn helpers take world coordinates
 * and are safe to call from the fixed-dt path.
 */
export class ParticleManager {
  readonly smoke: Emitter
  readonly dust: Emitter
  readonly spark: Emitter
  readonly splat: Emitter
  private readonly emitters: Emitter[]
  private readonly rnd = new Rand(SEED ^ 0x9e3779)
  private frac = { smoke: 0, dust: 0, trail: 0 }

  constructor(scene: THREE.Object3D, private tier: FxTiers) {
    const map = discTexture()
    /* PointsMaterial point sizes in pixels at the projection reference: the
       renderer sets gl_PointSize = size * pixelRatio and divides by -z with
       scale = heightPx/2, i.e. px ≈ size * (heightPx/2) * pixelRatio / z.
       Tuned at the real chase distance (~3.5 m): smoke puffs ~55 px soft
       blobs, dust ~40, sparks ~12 px glints, splash ~16 px flecks. */
    this.smoke = new Emitter({ cap: PARTICLES.smokeMax * tier.particles(), color: 0xd9d6cf, additive: false, size: 0.55, opacity: 0.5 }, map)
    this.dust = new Emitter({ cap: PARTICLES.dustMax * tier.particles(), color: 0xb28a58, additive: false, size: 0.4, opacity: 0.6 }, map)
    this.spark = new Emitter({ cap: PARTICLES.sparkMax * tier.particles(), color: 0xffb45c, additive: true, size: 0.13 }, map)
    this.splat = new Emitter({ cap: PARTICLES.splatMax * tier.particles(), color: THEME.water.foam, additive: false, size: 0.17, opacity: 0.85 }, map)
    this.emitters = [this.smoke, this.dust, this.spark, this.splat]
    for (const e of this.emitters) scene.add(e.points)
  }

  /** deterministic rate sampler: emits floor(rate*dt + carried fraction) */
  private rate(key: 'smoke' | 'dust' | 'trail', perSec: number, dt: number): number {
    const f = this.frac[key] + perSec * dt * this.tier.particles()
    const n = Math.floor(f)
    this.frac[key] = f - n
    return n
  }

  /** continuous drift smoke (rear-wheel anchored, buoyant grey plumes) */
  emitSmoke(x: number, y: number, z: number, perSec: number, dt: number): void {
    const p = this.smoke.pool
    for (let k = this.rate('smoke', perSec, dt); k > 0; k--) {
      const r = this.rnd
      p.spawn(
        x + r.range(-0.16, 0.16), y + r.range(0, 0.08), z + r.range(-0.16, 0.16),
        r.range(-0.9, 0.9), FX.smokeRise * r.range(0.5, 1), r.range(-0.9, 0.9),
        FX.lifeSmoke * r.range(0.8, 1.15), r.range(0.5, 0.75), r.range(1.7, 2.5), 1.35, -FX.smokeRise * 0.35,
      )
    }
  }

  /** off-road dust: kicked low and wide off the loose surface */
  emitDust(x: number, y: number, z: number, perSec: number, dt: number): void {
    const p = this.dust.pool
    for (let k = this.rate('dust', perSec, dt); k > 0; k--) {
      const r = this.rnd
      p.spawn(
        x + r.range(-0.22, 0.22), y + 0.05, z + r.range(-0.22, 0.22),
        r.range(-1.6, 1.6), r.range(0.4, 1.5), r.range(-1.6, 1.6),
        FX.lifeDust * r.range(0.8, 1.2), r.range(0.35, 0.55), r.range(1.3, 2.0), 1.6, 0.6,
      )
    }
  }

  /** nitro trail behind the built flames — a cool vapour ribbon */
  emitTrail(x: number, y: number, z: number, dt: number): void {
    const p = this.smoke.pool
    for (let k = this.rate('trail', FX.trailPerSec, dt); k > 0; k--) {
      const r = this.rnd
      p.spawn(
        x + r.range(-0.1, 0.1), y + r.range(-0.05, 0.05), z + r.range(-0.1, 0.1),
        r.range(-0.5, 0.5), 0.25, r.range(-0.5, 0.5),
        FX.lifeTrail * r.range(0.75, 1.2), r.range(0.22, 0.34), r.range(0.75, 1.15), 2.4, 0,
      )
    }
  }

  /** impact spark fan + a few heavier debris chunks */
  burstImpact(x: number, y: number, z: number, nx: number, nz: number, severity: number): void {
    const p = this.spark.pool
    const r = this.rnd
    const scale = clamp01(severity / 8)
    const n = Math.round(FX.sparkBurst * (0.4 + 0.6 * scale) * this.tier.particles())
    for (let k = 0; k < n; k++) {
      const a = r.range(0, Math.PI * 2)
      const up = r.range(1.5, 6.5) * (0.5 + scale)
      const sp = FX.sparkSpeed * r.range(0.4, 1) * (0.5 + scale)
      p.spawn(
        x + nx * 0.5, y + r.range(0.05, 0.5), z + nz * 0.5,
        Math.cos(a) * sp + nx * 2.2, up, Math.sin(a) * sp + nz * 2.2,
        FX.lifeSpark * r.range(0.6, 1.2), r.range(0.1, 0.18), 0.02, 0.6, FX.sparkGrav,
      )
    }
    const dn = Math.round(FX.debrisBurst * (0.35 + 0.65 * scale) * this.tier.particles())
    for (let k = 0; k < dn; k++) {
      const a = r.range(0, Math.PI * 2)
      p.spawn(
        x, y + r.range(0.1, 0.6), z,
        Math.cos(a) * FX.debrisSpeed * r.range(0.3, 1), r.range(2, 6), Math.sin(a) * FX.debrisSpeed * r.range(0.3, 1),
        FX.lifeDebris * r.range(0.7, 1.15), r.range(0.12, 0.2), 0.05, 0.35, FX.debrisGrav,
      )
    }
  }

  /** landing puff: a wide flat smoke crown under the wheels */
  burstPuff(x: number, y: number, z: number, severity: number): void {
    const p = this.smoke.pool
    const r = this.rnd
    const scale = clamp01(severity / 9)
    const n = Math.round(FX.puffBurst * (0.45 + 0.55 * scale) * this.tier.particles())
    for (let k = 0; k < n; k++) {
      const a = r.range(0, Math.PI * 2)
      const sp = r.range(0.8, 3.4) * (0.5 + scale)
      p.spawn(
        x + r.range(-0.7, 0.7), y + 0.04, z + r.range(-0.7, 0.7),
        Math.cos(a) * sp, r.range(0.2, 1.1), Math.sin(a) * sp,
        FX.lifePuff * r.range(0.75, 1.2), r.range(0.4, 0.6), r.range(1.6, 2.6), 1.5, -FX.smokeRise * 0.15,
      )
    }
  }

  /** coastal water splash off the sea verge */
  burstSplash(x: number, y: number, z: number, severity: number): void {
    const p = this.splat.pool
    const r = this.rnd
    const scale = clamp01(severity / 8)
    const n = Math.round(FX.splashBurst * (0.4 + 0.6 * scale) * this.tier.particles())
    for (let k = 0; k < n; k++) {
      const a = r.range(0, Math.PI * 2)
      const sp = FX.splashSpeed * r.range(0.35, 1) * (0.5 + scale)
      p.spawn(
        x + r.range(-0.35, 0.35), y + 0.02, z + r.range(-0.35, 0.35),
        Math.cos(a) * sp, r.range(1.4, 4.5), Math.sin(a) * sp,
        FX.lifeSplash * r.range(0.7, 1.2), r.range(0.1, 0.2), 0.05, 0.4, FX.splashGrav,
      )
    }
  }

  /** one visual step: integrate every pool (call with the render dt).
   *  Point-size attenuation is handled by PointsMaterial in the renderer. */
  update(dt: number): void {
    for (const e of this.emitters) { e.pool.update(dt); e.sync() }
  }

  /** kill everything (pose capture / restart) */
  clearAll(): void {
    this.frac.smoke = this.frac.dust = this.frac.trail = 0
    for (const e of this.emitters) { e.pool.clear(); e.sync() }
  }
}
