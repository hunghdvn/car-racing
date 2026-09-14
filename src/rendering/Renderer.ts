import * as THREE from 'three';
import type { QualitySettings } from '../types';

export interface WorldLights {
  readonly hemisphere: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
}

export interface ShadowTargetPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function attachShadowTarget(scene: THREE.Scene, sun: THREE.DirectionalLight): THREE.Object3D {
  if (sun.target.parent === null) {
    scene.add(sun.target);
  }
  return sun.target;
}

export function updateShadowTarget(sun: THREE.DirectionalLight, position: ShadowTargetPosition): void {
  sun.target.position.set(position.x, position.y, position.z);
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export function canvasViewport(canvas: HTMLCanvasElement): ViewportSize | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { width: rect.width, height: rect.height };
}

export class Renderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly lights: WorldLights;

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly resizeObserver: ResizeObserver;
  private quality: QualitySettings;
  private width: number;
  private height: number;
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.canvas = canvas;
    this.quality = quality;
    this.width = 1280;
    this.height = 720;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antiAliasing,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = new THREE.FogExp2(0x0c1120, 0.0016);

    this.camera = new THREE.PerspectiveCamera(62, this.width / this.height, 0.1, 2600);

    const hemisphere = new THREE.HemisphereLight(0x9db4d6, 0x2a3340, 0.85);
    const sun = new THREE.DirectionalLight(0xeaf1ff, 1.0);
    sun.position.set(140, 220, 90);
    sun.castShadow = quality.shadows;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0005;
    this.scene.add(hemisphere, sun);
    attachShadowTarget(this.scene, sun);
    this.lights = { hemisphere, sun };

    this.resizeObserver = new ResizeObserver(() => {
      const viewport = canvasViewport(this.canvas);
      if (viewport) this.resize(viewport.width, viewport.height);
    });
    this.resizeObserver.observe(this.canvas);
    this.resize(this.width, this.height);
  }

  get time(): number {
    return this.elapsed;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const ratio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.renderer.setPixelRatio(ratio * this.quality.resolutionScale);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  updateShadowTarget(position: ShadowTargetPosition): void {
    updateShadowTarget(this.lights.sun, position);
  }

  setQuality(settings: QualitySettings): void {
    this.quality = settings;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.lights.sun.castShadow = settings.shadows;
    this.resize(this.width, this.height);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, delta: number): void {
    this.elapsed += delta;
    this.renderer.render(scene, camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}
