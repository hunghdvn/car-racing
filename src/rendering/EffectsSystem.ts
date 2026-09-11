import * as THREE from 'three';
import type { QualitySettings } from '../types';

export interface WorldPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const PARTICLE_VERTEX = `
attribute float aScale;
attribute float aAlpha;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aScale * (320.0 / max(0.1, -mv.z));
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAGMENT = `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

interface ParticlePool {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  positions: Float32Array;
  scales: Float32Array;
  alphas: Float32Array;
  velocities: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  count: number;
  cursor: number;
  baseAlpha: number;
  fade: number;
  gravity: number;
  grow: number;
}

function countFor(budget: number, fraction: number, min: number, max: number): number {
  return Math.round(THREE.MathUtils.clamp(budget * fraction, min, max));
}

export class EffectsSystem {
  private readonly scene: THREE.Scene;
  private quality: QualitySettings;
  private nitro: ParticlePool | null = null;
  private smoke: ParticlePool | null = null;
  private sparks: ParticlePool | null = null;
  private skid: THREE.InstancedMesh | null = null;
  private skidLife: Float32Array | null = null;
  private skidMaxLife: Float32Array | null = null;
  private skidCursor = 0;
  private skidCount = 0;
  private flashLevel = 0;
  private readonly skidGeometry: THREE.CircleGeometry;
  private readonly skidMaterial: THREE.MeshBasicMaterial;
  private readonly fresh = new THREE.Color(0x05070a);
  private readonly road = new THREE.Color(0x141a26);
  private readonly tint = new THREE.Color();

  constructor(scene: THREE.Scene, quality: QualitySettings) {
    this.scene = scene;
    this.quality = quality;
    this.skidGeometry = new THREE.CircleGeometry(0.42, 14);
    this.skidGeometry.rotateX(-Math.PI / 2);
    this.skidMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.rebuild();
  }

  setQuality(quality: QualitySettings): void {
    if (quality.particleBudget === this.quality.particleBudget) return;
    this.quality = quality;
    this.rebuild();
  }

  get flash(): number {
    return this.flashLevel;
  }

  spawnNitro(position: WorldPosition): void {
    const pool = this.nitro;
    if (!pool) return;
    for (let i = 0; i < 3; i++) {
      this.emit(
        pool,
        position.x + (Math.random() - 0.5) * 0.5,
        position.y + 0.3 + Math.random() * 0.25,
        position.z + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 2.4,
        1.6 + Math.random() * 2.2,
        (Math.random() - 0.5) * 2.4,
        0.25 + Math.random() * 0.3,
        0.5 + Math.random() * 0.5,
      );
    }
  }

  spawnDrift(position: WorldPosition): void {
    const pool = this.smoke;
    if (pool) {
      this.emit(
        pool,
        position.x + (Math.random() - 0.5) * 0.9,
        position.y + 0.15 + Math.random() * 0.2,
        position.z + (Math.random() - 0.5) * 0.9,
        (Math.random() - 0.5) * 1.6,
        0.6 + Math.random() * 1.1,
        (Math.random() - 0.5) * 1.6,
        0.9 + Math.random() * 0.7,
        0.7 + Math.random() * 0.5,
      );
    }
    this.spawnSkid(
      position.x + (Math.random() - 0.5) * 0.9,
      position.y,
      position.z + (Math.random() - 0.5) * 0.9,
    );
  }

  spawnImpact(position: WorldPosition, strength: number): void {
    const pool = this.sparks;
    if (pool) {
      const count = Math.round(THREE.MathUtils.clamp(8 + strength * 16, 8, 28));
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const horizontal = 3 + Math.random() * 7;
        this.emit(
          pool,
          position.x,
          position.y + 0.3,
          position.z,
          Math.cos(angle) * horizontal,
          2 + Math.random() * 5,
          Math.sin(angle) * horizontal,
          0.3 + Math.random() * 0.4,
          0.16 + Math.random() * 0.18,
        );
      }
    }
    this.flashLevel = Math.min(1, this.flashLevel + 0.3 + strength * 0.35);
  }

  update(delta: number): void {
    if (delta <= 0) return;
    this.updatePool(this.nitro, delta);
    this.updatePool(this.smoke, delta);
    this.updatePool(this.sparks, delta);
    this.updateSkid(delta);
    this.flashLevel *= Math.exp(-delta * 5);
    if (this.flashLevel < 0.001) this.flashLevel = 0;
  }

  dispose(): void {
    for (const pool of [this.nitro, this.smoke, this.sparks]) {
      if (pool) {
        this.scene.remove(pool.points);
        pool.points.geometry.dispose();
        pool.material.dispose();
      }
    }
    this.nitro = null;
    this.smoke = null;
    this.sparks = null;
    if (this.skid) {
      this.scene.remove(this.skid);
      this.skid.dispose();
      this.skid = null;
    }
    this.skidGeometry.dispose();
    this.skidMaterial.dispose();
    this.skidLife = null;
    this.skidMaxLife = null;
    this.skidCount = 0;
    this.flashLevel = 0;
  }

  private rebuild(): void {
    for (const pool of [this.nitro, this.smoke, this.sparks]) {
      if (pool) {
        this.scene.remove(pool.points);
        pool.points.geometry.dispose();
        pool.material.dispose();
      }
    }
    if (this.skid) {
      this.scene.remove(this.skid);
      this.skid.dispose();
      this.skid = null;
    }
    const budget = this.quality.particleBudget;
    this.nitro = this.makePool(countFor(budget, 0.35, 16, 160), 0x66e0ff, THREE.AdditiveBlending, 0.9, 1.6, 0, 2.2);
    this.smoke = this.makePool(countFor(budget, 0.3, 16, 200), 0x93a1b3, THREE.NormalBlending, 0.38, 0.8, 0, 1.6);
    this.sparks = this.makePool(countFor(budget, 0.25, 12, 120), 0xffc266, THREE.AdditiveBlending, 1, 0.7, 20, 0);
    this.skidCount = countFor(budget, 0.1, 8, 64);
    const skid = new THREE.InstancedMesh(this.skidGeometry, this.skidMaterial, this.skidCount);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.skidCount; i++) {
      skid.setMatrixAt(i, hidden);
    }
    skid.instanceMatrix.needsUpdate = true;
    skid.frustumCulled = false;
    this.scene.add(skid);
    this.skid = skid;
    this.skidLife = new Float32Array(this.skidCount);
    this.skidMaxLife = new Float32Array(this.skidCount);
    this.skidCursor = 0;
  }

  private makePool(
    count: number,
    color: number,
    blending: THREE.Blending,
    baseAlpha: number,
    fade: number,
    gravity: number,
    grow: number,
  ): ParticlePool {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 1] = -9999;
    }
    const scales = new Float32Array(count);
    const alphas = new Float32Array(count);
    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    const scaleAttribute = new THREE.BufferAttribute(scales, 1);
    scaleAttribute.setUsage(THREE.DynamicDrawUsage);
    const alphaAttribute = new THREE.BufferAttribute(alphas, 1);
    alphaAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('aScale', scaleAttribute);
    geometry.setAttribute('aAlpha', alphaAttribute);
    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);
    return {
      points,
      material,
      positions,
      scales,
      alphas,
      velocities: new Float32Array(count * 3),
      life: new Float32Array(count),
      maxLife: new Float32Array(count),
      count,
      cursor: 0,
      baseAlpha,
      fade,
      gravity,
      grow,
    };
  }

  private emit(
    pool: ParticlePool,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
  ): void {
    const i = pool.cursor;
    pool.cursor = (i + 1) % pool.count;
    const base = i * 3;
    pool.positions[base] = x;
    pool.positions[base + 1] = y;
    pool.positions[base + 2] = z;
    pool.velocities[base] = vx;
    pool.velocities[base + 1] = vy;
    pool.velocities[base + 2] = vz;
    pool.life[i] = life;
    pool.maxLife[i] = life;
    pool.scales[i] = size;
    pool.alphas[i] = pool.baseAlpha;
  }

  private updatePool(pool: ParticlePool | null, delta: number): void {
    if (!pool) return;
    const count = pool.count;
    for (let i = 0; i < count; i++) {
      const current = pool.life[i]!;
      if (current <= 0) continue;
      const life = current - delta;
      if (life <= 0) {
        pool.life[i] = 0;
        pool.alphas[i] = 0;
        continue;
      }
      pool.life[i] = life;
      const base = i * 3;
      pool.positions[base] = pool.positions[base]! + pool.velocities[base]! * delta;
      pool.positions[base + 1] = pool.positions[base + 1]! + pool.velocities[base + 1]! * delta;
      pool.positions[base + 2] = pool.positions[base + 2]! + pool.velocities[base + 2]! * delta;
      if (pool.gravity > 0) {
        pool.velocities[base + 1] = pool.velocities[base + 1]! - pool.gravity * delta;
      }
      if (pool.grow > 0) {
        pool.scales[i] = pool.scales[i]! * (1 + pool.grow * delta);
      }
      pool.alphas[i] = pool.baseAlpha * Math.pow(life / pool.maxLife[i]!, pool.fade);
    }
    (pool.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (pool.points.geometry.getAttribute('aScale') as THREE.BufferAttribute).needsUpdate = true;
    (pool.points.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  private spawnSkid(x: number, y: number, z: number): void {
    const skid = this.skid;
    if (!skid || !this.skidLife || !this.skidMaxLife) return;
    const i = this.skidCursor;
    this.skidCursor = (i + 1) % this.skidCount;
    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(x, y + 0.05, z),
      new THREE.Quaternion(),
      new THREE.Vector3(0.7 + Math.random() * 0.6, 1, 0.7 + Math.random() * 0.6),
    );
    skid.setMatrixAt(i, matrix);
    skid.instanceMatrix.needsUpdate = true;
    const life = 3 + Math.random();
    this.skidLife[i] = life;
    this.skidMaxLife[i] = life;
  }

  private updateSkid(delta: number): void {
    const skid = this.skid;
    if (!skid || !this.skidLife || !this.skidMaxLife) return;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    let dirty = false;
    for (let i = 0; i < this.skidCount; i++) {
      const life = this.skidLife[i]!;
      if (life <= 0) continue;
      const next = life - delta;
      dirty = true;
      if (next <= 0) {
        this.skidLife[i] = 0;
        skid.setMatrixAt(i, hidden);
        continue;
      }
      this.skidLife[i] = next;
      const t = next / this.skidMaxLife[i]!;
      this.tint.lerpColors(this.road, this.fresh, t * 0.9);
      skid.setColorAt(i, this.tint);
    }
    if (dirty) {
      skid.instanceMatrix.needsUpdate = true;
      if (skid.instanceColor) {
        skid.instanceColor.needsUpdate = true;
      }
    }
  }
}
