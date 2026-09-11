import * as THREE from 'three';
import type { EnvironmentVariant, QualitySettings, Weather } from '../types';
import type { WorldLights } from './Renderer';

const FOG_PRESETS: Record<Weather, { density: number; color: number }> = {
  clear: { density: 0.0012, color: 0x0d1322 },
  rain: { density: 0.0034, color: 0x0a1018 },
  fog: { density: 0.009, color: 0x1a2534 },
};

const RAIN_HEIGHT = 34;
const RAIN_SPEED = 42;
const RAIN_TAIL_X = 0.23;
const RAIN_TAIL_Y = 1.38;
const RAIN_TAIL_Z = 0.1;

interface WeatherTarget {
  fogColor: THREE.Color;
  fogDensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  rain: number;
}

function buildTarget(variant: EnvironmentVariant): WeatherTarget {
  const night = THREE.MathUtils.clamp(variant.nightFactor, 0, 1);
  const preset = FOG_PRESETS[variant.weather];
  return {
    fogColor: new THREE.Color(preset.color).lerp(new THREE.Color(0x04060d), night * 0.5),
    fogDensity: preset.density,
    hemiSky: new THREE.Color(0x9db4d6).lerp(new THREE.Color(0x25304e), night),
    hemiGround: new THREE.Color(0x2a3340).lerp(new THREE.Color(0x10141d), night),
    hemiIntensity: THREE.MathUtils.lerp(0.9, 0.35, night),
    sunColor: new THREE.Color(0xeaf1ff).lerp(new THREE.Color(0x93a7d6), night),
    sunIntensity: THREE.MathUtils.lerp(1.0, 0.14, night),
    rain: variant.weather === 'rain' ? 1 : 0,
  };
}

function rainCountFor(quality: QualitySettings): number {
  return Math.round(THREE.MathUtils.clamp(quality.particleBudget * 0.5, 60, 900));
}

export class WeatherSystem {
  private readonly scene: THREE.Scene;
  private readonly lights: WorldLights;
  private readonly fog: THREE.FogExp2;
  private readonly bounds: THREE.Box3;
  private quality: QualitySettings;
  private target: WeatherTarget;
  private fogDensity: number;
  private hemiIntensity: number;
  private sunIntensity: number;
  private rainLevel: number;
  private readonly fogColor = new THREE.Color();
  private readonly hemiSky = new THREE.Color();
  private readonly hemiGround = new THREE.Color();
  private readonly sunColor = new THREE.Color();
  private rainMesh: THREE.LineSegments | null = null;
  private rainPositions: Float32Array | null = null;
  private dropX: Float32Array | null = null;
  private dropY: Float32Array | null = null;
  private dropZ: Float32Array | null = null;
  private rainCount = 0;

  constructor(
    scene: THREE.Scene,
    lights: WorldLights,
    quality: QualitySettings,
    rainBounds: THREE.Box3,
  ) {
    this.scene = scene;
    this.lights = lights;
    this.quality = quality;
    this.bounds = rainBounds.clone().expandByScalar(40);
    if (!(scene.fog instanceof THREE.FogExp2)) {
      scene.fog = new THREE.FogExp2(0x0c1120, 0.0016);
    }
    this.fog = scene.fog;
    this.target = buildTarget({ nightFactor: 1, weather: 'clear' });
    this.fogDensity = this.target.fogDensity;
    this.hemiIntensity = this.target.hemiIntensity;
    this.sunIntensity = this.target.sunIntensity;
    this.rainLevel = this.target.rain;
    this.fogColor.copy(this.target.fogColor);
    this.hemiSky.copy(this.target.hemiSky);
    this.hemiGround.copy(this.target.hemiGround);
    this.sunColor.copy(this.target.sunColor);
    this.applyState();
    this.buildRain();
  }

  setVariant(variant: EnvironmentVariant): void {
    this.target = buildTarget(variant);
  }

  setQuality(quality: QualitySettings): void {
    this.quality = quality;
    if (rainCountFor(quality) !== this.rainCount) {
      this.buildRain();
    }
  }

  update(delta: number): void {
    if (delta <= 0) return;
    const k = 1 - Math.exp(-delta * 1.1);
    this.fogDensity += (this.target.fogDensity - this.fogDensity) * k;
    this.hemiIntensity += (this.target.hemiIntensity - this.hemiIntensity) * k;
    this.sunIntensity += (this.target.sunIntensity - this.sunIntensity) * k;
    this.rainLevel += (this.target.rain - this.rainLevel) * k;
    this.fogColor.lerp(this.target.fogColor, k);
    this.hemiSky.lerp(this.target.hemiSky, k);
    this.hemiGround.lerp(this.target.hemiGround, k);
    this.sunColor.lerp(this.target.sunColor, k);
    this.applyState();
    this.updateRain(delta);
  }

  dispose(): void {
    if (this.rainMesh) {
      this.scene.remove(this.rainMesh);
      this.rainMesh.geometry.dispose();
      (this.rainMesh.material as THREE.Material).dispose();
      this.rainMesh = null;
    }
    this.rainPositions = null;
    this.dropX = null;
    this.dropY = null;
    this.dropZ = null;
    this.rainCount = 0;
  }

  private applyState(): void {
    this.fog.density = this.fogDensity;
    this.fog.color.copy(this.fogColor);
    this.lights.hemisphere.intensity = this.hemiIntensity;
    this.lights.hemisphere.color.copy(this.hemiSky);
    this.lights.hemisphere.groundColor.copy(this.hemiGround);
    this.lights.sun.intensity = this.sunIntensity;
    this.lights.sun.color.copy(this.sunColor);
  }

  private buildRain(): void {
    if (this.rainMesh) {
      this.scene.remove(this.rainMesh);
      this.rainMesh.geometry.dispose();
      (this.rainMesh.material as THREE.Material).dispose();
    }
    this.rainCount = rainCountFor(this.quality);
    const count = this.rainCount;
    const positions = new Float32Array(count * 6);
    const xs = new Float32Array(count);
    const ys = new Float32Array(count);
    const zs = new Float32Array(count);
    const width = this.bounds.max.x - this.bounds.min.x;
    const depth = this.bounds.max.z - this.bounds.min.z;
    for (let i = 0; i < count; i++) {
      xs[i] = this.bounds.min.x + Math.random() * width;
      ys[i] = Math.random() * RAIN_HEIGHT;
      zs[i] = this.bounds.min.z + Math.random() * depth;
    }
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(positions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    const material = new THREE.LineBasicMaterial({
      color: 0xa9c9ea,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.scene.add(mesh);
    this.rainMesh = mesh;
    this.rainPositions = positions;
    this.dropX = xs;
    this.dropY = ys;
    this.dropZ = zs;
  }

  private updateRain(delta: number): void {
    const mesh = this.rainMesh;
    if (!mesh || !this.rainPositions || !this.dropX || !this.dropY || !this.dropZ) return;
    const opacity = this.rainLevel * 0.55;
    mesh.visible = opacity > 0.01;
    (mesh.material as THREE.LineBasicMaterial).opacity = opacity;
    if (!mesh.visible) return;
    const positions = this.rainPositions;
    const xs = this.dropX;
    const ys = this.dropY;
    const zs = this.dropZ;
    const width = this.bounds.max.x - this.bounds.min.x;
    const depth = this.bounds.max.z - this.bounds.min.z;
    for (let i = 0; i < this.rainCount; i++) {
      let y = ys[i]! - RAIN_SPEED * delta;
      if (y < 0) {
        y += RAIN_HEIGHT;
        xs[i] = this.bounds.min.x + Math.random() * width;
        zs[i] = this.bounds.min.z + Math.random() * depth;
      }
      ys[i] = y;
      const x = xs[i]!;
      const z = zs[i]!;
      const base = i * 6;
      positions[base] = x;
      positions[base + 1] = y;
      positions[base + 2] = z;
      positions[base + 3] = x + RAIN_TAIL_X;
      positions[base + 4] = y + RAIN_TAIL_Y;
      positions[base + 5] = z + RAIN_TAIL_Z;
    }
    (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
