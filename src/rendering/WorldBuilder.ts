import * as THREE from 'three';
import type { EnvironmentVariant, QualitySettings, TrackConfig, Weather } from '../types';
import type { TrackModel } from '../track/TrackModel';

export type Environment = TrackConfig['environment'];
type Bounds = TrackConfig['minimapBounds'];
type Near = (x: number, z: number, threshold: number) => boolean;

export const DEFAULT_QUALITY: QualitySettings = {
  preset: 'medium',
  adaptiveEnabled: false,
  resolutionScale: 1,
  pixelRatio: 1.5,
  shadows: true,
  antiAliasing: true,
  textureQuality: 'medium',
  particleBudget: 500,
  propDensity: 1,
  postProcessing: false,
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WorldGroup extends THREE.Group {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly instances: THREE.InstancedMesh[] = [];

  track(geometry: THREE.BufferGeometry, material: THREE.Material): void {
    this.geometries.push(geometry);
    this.materials.push(material);
  }

  trackInstance(mesh: THREE.InstancedMesh): void {
    this.instances.push(mesh);
    this.add(mesh);
  }

  dispose(): void {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    for (const instance of this.instances) {
      instance.dispose();
    }
    this.geometries.length = 0;
    this.materials.length = 0;
    this.instances.length = 0;
    this.clear();
  }
}

export class WorldBuilder {
  build(
    environment: Environment,
    track: TrackModel,
    variant: EnvironmentVariant,
    quality: QualitySettings = DEFAULT_QUALITY,
  ): WorldGroup {
    const group = new WorldGroup();
    const bounds = track.config.minimapBounds;
    const center = new THREE.Vector3(
      (bounds.minX + bounds.maxX) / 2,
      0,
      (bounds.minY + bounds.maxY) / 2,
    );
    const night = THREE.MathUtils.clamp(variant.nightFactor, 0, 1);
    const density = THREE.MathUtils.clamp(quality.propDensity, 0.05, 1);
    const rand = mulberry32(environment === 'city' ? 7 : environment === 'coast' ? 17 : 27);
    const near: Near = (x, z, threshold) => {
      const limit = threshold * threshold;
      for (let i = 0; i < track.samples.length; i += 4) {
        const sample = track.samples[i]!;
        const dx = sample.point.x - x;
        const dz = sample.point.z - z;
        if (dx * dx + dz * dz < limit) return true;
      }
      return false;
    };
    this.addSky(group, environment, center, night);
    this.addGround(group, environment, center, variant.weather, night);
    this.addMist(group, variant.weather, bounds, density, rand);
    this.addStreetLights(group, track, night);
    this.addReflectorStuds(group, track);
    this.addObstacleGlow(group, track);
    if (environment === 'city') {
      this.addCity(group, bounds, center, night, density, rand, near);
    } else if (environment === 'coast') {
      this.addCoast(group, bounds, center, night, density, rand, near);
    } else {
      this.addMountain(group, bounds, center, night, density, rand, near);
    }
    return group;
  }

  private addInstances(
    group: WorldGroup,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    place: (index: number, mesh: THREE.InstancedMesh, dummy: THREE.Object3D) => void,
  ): void {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      place(i, mesh, dummy);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.frustumCulled = false;
    group.track(geometry, material);
    group.trackInstance(mesh);
  }

  private placeAlong(
    bounds: Bounds,
    rand: () => number,
    near: Near,
    count: number,
    clearance: number,
  ): { x: number; z: number }[] {
    const spots: { x: number; z: number }[] = [];
    let attempts = 0;
    const maxAttempts = count * 20;
    while (spots.length < count && attempts < maxAttempts) {
      attempts++;
      const x = bounds.minX - 50 + rand() * (bounds.maxX - bounds.minX + 100);
      const z = bounds.minY - 50 + rand() * (bounds.maxY - bounds.minY + 100);
      if (near(x, z, clearance)) continue;
      spots.push({ x, z });
    }
    return spots;
  }

  private addSky(group: WorldGroup, environment: Environment, center: THREE.Vector3, night: number): void {
    const palette: Record<Environment, { top: number; bottom: number; nightTop: number; nightBottom: number }> = {
      city: { top: 0x04060f, bottom: 0x341252, nightTop: 0x020308, nightBottom: 0x1d0a33 },
      coast: { top: 0x0c1840, bottom: 0x156078, nightTop: 0x04081a, nightBottom: 0x0a2c3e },
      mountain: { top: 0x070b18, bottom: 0x2b3c5e, nightTop: 0x03050c, nightBottom: 0x152036 },
    };
    const p = palette[environment];
    const top = new THREE.Color(p.top).lerp(new THREE.Color(p.nightTop), night);
    const bottom = new THREE.Color(p.bottom).lerp(new THREE.Color(p.nightBottom), night);
    const geometry = new THREE.SphereGeometry(2400, 32, 20);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const t = THREE.MathUtils.clamp((position.getY(i) / 2400 + 1) / 2, 0, 1);
      color.lerpColors(bottom, top, Math.pow(t, 0.72));
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    group.track(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center);
    mesh.renderOrder = -10;
    group.add(mesh);
  }

  private addGround(
    group: WorldGroup,
    environment: Environment,
    center: THREE.Vector3,
    weather: Weather,
    night: number,
  ): void {
    const base: Record<Environment, { color: number; roughness: number; metalness: number }> = {
      city: { color: 0x0b0e15, roughness: 0.5, metalness: 0.45 },
      coast: { color: 0x0e1116, roughness: 0.9, metalness: 0.15 },
      mountain: { color: 0x10141c, roughness: 0.95, metalness: 0.1 },
    };
    const b = base[environment];
    const wet = weather === 'rain';
    const material = new THREE.MeshStandardMaterial({
      color: b.color,
      roughness: wet ? b.roughness * 0.55 : b.roughness,
      metalness: wet ? Math.min(1, b.metalness + 0.35) : b.metalness,
      emissive: 0x05070d,
      emissiveIntensity: 0.4 + night * 0.5,
    });
    const geometry = new THREE.PlaneGeometry(6000, 6000);
    group.track(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(center);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  private addMist(group: WorldGroup, weather: Weather, bounds: Bounds, density: number, rand: () => number): void {
    const count = Math.round((weather === 'fog' ? 10 : weather === 'rain' ? 7 : 4) * density);
    if (count < 1) return;
    const opacity = weather === 'fog' ? 0.3 : weather === 'rain' ? 0.14 : 0.05;
    const geometry = new THREE.PlaneGeometry(90, 45);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0x8fa6bd,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    group.track(geometry, material);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        bounds.minX + rand() * (bounds.maxX - bounds.minX),
        0.5 + rand() * 1.2,
        bounds.minY + rand() * (bounds.maxY - bounds.minY),
      );
      const s = 0.8 + rand() * 1.8;
      mesh.scale.set(s, 1, s);
      group.add(mesh);
    }
  }

  private addStreetLights(group: WorldGroup, track: TrackModel, night: number): void {
    const spacing = track.config.environment === 'city' ? 26 : track.config.environment === 'coast' ? 48 : 42;
    const count = Math.max(8, Math.floor(track.length / spacing));
    const offset = track.config.width / 2 + 2.2;
    const poleGeometry = new THREE.CylinderGeometry(0.06, 0.1, 4.2, 6);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x171c26, roughness: 0.55, metalness: 0.6 });
    const lampGeometry = new THREE.BoxGeometry(0.55, 0.16, 0.3);
    const lampMaterial = new THREE.MeshStandardMaterial({
      color: 0x141821,
      emissive: 0xffd9a0,
      emissiveIntensity: 0.7 + night * 1.6,
    });
    const poolGeometry = new THREE.CircleGeometry(2.4, 20);
    poolGeometry.rotateX(-Math.PI / 2);
    const poolMaterial = new THREE.MeshBasicMaterial({
      color: 0x4a3a20,
      transparent: true,
      opacity: 0.22 + night * 0.22,
      depthWrite: false,
    });
    this.addInstances(group, poleGeometry, poleMaterial, count, (i, _mesh, dummy) => {
      const sample = track.sampleAt(((i + 0.5) / count) * track.length);
      const side = i % 2 === 0 ? 1 : -1;
      dummy.position.set(
        sample.point.x + sample.left.x * side * offset,
        2.1,
        sample.point.z + sample.left.z * side * offset,
      );
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
    });
    this.addInstances(group, lampGeometry, lampMaterial, count, (i, _mesh, dummy) => {
      const sample = track.sampleAt(((i + 0.5) / count) * track.length);
      const side = i % 2 === 0 ? 1 : -1;
      dummy.position.set(
        sample.point.x + sample.left.x * side * (offset - 0.9),
        4.28,
        sample.point.z + sample.left.z * side * (offset - 0.9),
      );
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
    });
    this.addInstances(group, poolGeometry, poolMaterial, count, (i, _mesh, dummy) => {
      const sample = track.sampleAt(((i + 0.5) / count) * track.length);
      const side = i % 2 === 0 ? 1 : -1;
      dummy.position.set(
        sample.point.x + sample.left.x * side * (offset - 1.6),
        0.045,
        sample.point.z + sample.left.z * side * (offset - 1.6),
      );
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
    });
  }

  private addReflectorStuds(group: WorldGroup, track: TrackModel): void {
    const spacing = 9;
    const perSide = Math.max(4, Math.floor(track.length / spacing));
    const count = perSide * 2;
    const offset = track.config.width / 2 - 0.35;
    const geometry = new THREE.BoxGeometry(0.12, 0.05, 0.12);
    const material = new THREE.MeshBasicMaterial({ color: 0xbfe9ff });
    this.addInstances(group, geometry, material, count, (i, _mesh, dummy) => {
      const side = i % 2 === 0 ? 1 : -1;
      const index = Math.floor(i / 2);
      const sample = track.sampleAt(((index + 0.5) / perSide) * track.length);
      dummy.position.set(
        sample.point.x + sample.left.x * side * offset,
        0.055,
        sample.point.z + sample.left.z * side * offset,
      );
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
    });
  }

  private addObstacleGlow(group: WorldGroup, track: TrackModel): void {
    const obstacles = track.config.obstacles;
    if (obstacles.length === 0) return;
    const geometry = new THREE.RingGeometry(0.8, 1.3, 24);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const cone = new THREE.Color(0xffb347);
    const barrier = new THREE.Color(0xff4d6d);
    this.addInstances(group, geometry, material, obstacles.length, (i, mesh, dummy) => {
      const obstacle = obstacles[i]!;
      const scale = obstacle.type === 'barrier' ? obstacle.radius * 1.2 : 1.2;
      dummy.position.set(obstacle.position.x, 0.06, obstacle.position.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(scale, 1, scale);
      mesh.setColorAt(i, obstacle.type === 'barrier' ? barrier : cone);
    });
  }

  private addCity(
    group: WorldGroup,
    bounds: Bounds,
    center: THREE.Vector3,
    night: number,
    density: number,
    rand: () => number,
    near: Near,
  ): void {
    const cell = 26;
    const minX = bounds.minX - 70;
    const maxX = bounds.maxX + 70;
    const minY = bounds.minY - 70;
    const maxY = bounds.maxY + 70;
    const maxBuildings = Math.round(300 * density);
    const buildings: { x: number; z: number; w: number; h: number; d: number }[] = [];
    for (let x = minX; x <= maxX && buildings.length < maxBuildings; x += cell) {
      for (let z = minY; z <= maxY && buildings.length < maxBuildings; z += cell) {
        const bx = x + (rand() - 0.5) * 10;
        const bz = z + (rand() - 0.5) * 10;
        if (near(bx, bz, 24)) continue;
        buildings.push({
          x: bx,
          z: bz,
          w: 7 + rand() * 9,
          d: 7 + rand() * 9,
          h: 8 + Math.pow(rand(), 1.6) * 55,
        });
      }
    }
    if (buildings.length > 0) {
      const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
      const buildingMaterial = new THREE.MeshStandardMaterial({
        color: 0x0c111d,
        roughness: 0.5,
        metalness: 0.5,
      });
      this.addInstances(group, buildingGeometry, buildingMaterial, buildings.length, (i, _mesh, dummy) => {
        const b = buildings[i]!;
        dummy.position.set(b.x, b.h / 2, b.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(b.w, b.h, b.d);
      });
      const palette = [0x00e5ff, 0xff2e88, 0xffd166, 0x9d4edd, 0x3dffa0];
      const stripGeometry = new THREE.BoxGeometry(0.22, 1, 0.22);
      const stripMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const neon = 0.55 + night * 0.75;
      const tint = new THREE.Color();
      this.addInstances(group, stripGeometry, stripMaterial, buildings.length * 2, (i, mesh, dummy) => {
        const b = buildings[Math.floor(i / 2)]!;
        const cx = rand() < 0.5 ? -1 : 1;
        const cz = rand() < 0.5 ? -1 : 1;
        dummy.position.set(
          b.x + cx * (b.w / 2 + 0.12),
          b.h * 0.48,
          b.z + cz * (b.d / 2 + 0.12),
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, b.h * 0.9, 1);
        tint.setHex(palette[Math.floor(rand() * palette.length)]!).multiplyScalar(neon);
        mesh.setColorAt(i, tint);
      });
    }
    const skylineGeometry = new THREE.BoxGeometry(1, 1, 1);
    const skylineMaterial = new THREE.MeshStandardMaterial({
      color: 0x060910,
      roughness: 0.8,
      metalness: 0.3,
      emissive: 0x0a1224,
      emissiveIntensity: 0.4 + night * 0.5,
    });
    this.addInstances(group, skylineGeometry, skylineMaterial, 48, (i, _mesh, dummy) => {
      const angle = (i / 48) * Math.PI * 2 + rand() * 0.2;
      const radius = 950 + rand() * 450;
      const h = 30 + rand() * 130;
      dummy.position.set(center.x + Math.cos(angle) * radius, h / 2, center.z + Math.sin(angle) * radius);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(25 + rand() * 40, h, 25 + rand() * 40);
    });
  }

  private addCoast(
    group: WorldGroup,
    bounds: Bounds,
    center: THREE.Vector3,
    night: number,
    density: number,
    rand: () => number,
    near: Near,
  ): void {
    const seaRadius = 1500;
    const seaGeometry = new THREE.CircleGeometry(seaRadius, 48);
    seaGeometry.rotateX(-Math.PI / 2);
    const seaMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a2338,
      roughness: 0.16,
      metalness: 0.85,
      emissive: 0x052033,
      emissiveIntensity: 0.5 + night * 0.4,
    });
    group.track(seaGeometry, seaMaterial);
    const sea = new THREE.Mesh(seaGeometry, seaMaterial);
    sea.position.set(bounds.maxX + 90 + seaRadius, 0.03, center.z);
    group.add(sea);

    const orbGeometry = new THREE.SphereGeometry(30, 20, 14);
    const orbMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffe6b3).lerp(new THREE.Color(0xd9e4ff), night),
      fog: false,
    });
    group.track(orbGeometry, orbMaterial);
    const orb = new THREE.Mesh(orbGeometry, orbMaterial);
    orb.position.set(bounds.maxX + 300, 480, center.z - 900);
    group.add(orb);

    const palms = this.placeAlong(bounds, rand, near, Math.round(90 * density), 16);
    if (palms.length > 0) {
      const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.2, 3.4, 6);
      const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x26332b, roughness: 0.9 });
      const crownGeometry = new THREE.IcosahedronGeometry(1.5, 0);
      const crownMaterial = new THREE.MeshStandardMaterial({
        color: 0x1c4a37,
        roughness: 0.8,
        emissive: 0x07231a,
        emissiveIntensity: 0.5,
      });
      this.addInstances(group, trunkGeometry, trunkMaterial, palms.length, (i, _mesh, dummy) => {
        const p = palms[i]!;
        dummy.position.set(p.x, 1.7, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
      });
      this.addInstances(group, crownGeometry, crownMaterial, palms.length, (i, _mesh, dummy) => {
        const p = palms[i]!;
        dummy.position.set(p.x, 3.5, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1.5, 0.6, 1.5);
      });
    }

    const headGeometry = new THREE.ConeGeometry(1, 1, 7);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0x0a131f, roughness: 0.9 });
    this.addInstances(group, headGeometry, headMaterial, 14, (i, _mesh, dummy) => {
      const angle = (i / 14) * Math.PI * 2 + rand() * 0.4;
      const radius = 1300 + rand() * 600;
      const s = 90 + rand() * 130;
      const h = 50 + rand() * 70;
      dummy.position.set(center.x + Math.cos(angle) * radius, h / 2, center.z + Math.sin(angle) * radius);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(s, h, s);
    });
  }

  private addMountain(
    group: WorldGroup,
    bounds: Bounds,
    center: THREE.Vector3,
    night: number,
    density: number,
    rand: () => number,
    near: Near,
  ): void {
    const rocks = this.placeAlong(bounds, rand, near, Math.round(140 * density), 13);
    if (rocks.length > 0) {
      const transforms = rocks.map((p) => ({
        x: p.x,
        z: p.z,
        w: (3 + rand() * 8) * (0.7 + rand() * 0.5),
        h: (3 + rand() * 8) * (0.8 + rand() * 0.8),
        d: (3 + rand() * 8) * (0.7 + rand() * 0.5),
      }));
      const rockGeometry = new THREE.ConeGeometry(1, 1, 6);
      const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x151b28, roughness: 0.95 });
      this.addInstances(group, rockGeometry, rockMaterial, transforms.length, (i, _mesh, dummy) => {
        const r = transforms[i]!;
        dummy.position.set(r.x, r.h / 2, r.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(r.w, r.h, r.d);
      });
      const caps = transforms.filter((r) => r.h > 9);
      if (caps.length > 0) {
        const capGeometry = new THREE.ConeGeometry(1, 1, 6);
        const capMaterial = new THREE.MeshStandardMaterial({
          color: 0xd7e6f4,
          roughness: 0.45,
          emissive: 0x223449,
          emissiveIntensity: 0.35 + night * 0.3,
        });
        this.addInstances(group, capGeometry, capMaterial, caps.length, (i, _mesh, dummy) => {
          const c = caps[i]!;
          const capH = c.h * 0.38;
          dummy.position.set(c.x, c.h / 2 - capH * 0.55, c.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(c.w * 0.5, capH, c.w * 0.5);
        });
      }
    }
    const pines = this.placeAlong(bounds, rand, near, Math.round(220 * density), 12);
    if (pines.length > 0) {
      const pineGeometry = new THREE.ConeGeometry(0.85, 3, 7);
      const pineMaterial = new THREE.MeshStandardMaterial({
        color: 0x0e2a20,
        roughness: 0.9,
        emissive: 0x041510,
        emissiveIntensity: 0.4,
      });
      this.addInstances(group, pineGeometry, pineMaterial, pines.length, (i, _mesh, dummy) => {
        const p = pines[i]!;
        dummy.position.set(p.x, 1.5, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.8 + rand() * 0.7);
      });
    }
    const peaks = Array.from({ length: 18 }, () => ({
      angle: rand() * Math.PI * 2,
      radius: 1400 + rand() * 700,
      w: 140 + rand() * 160,
      h: 200 + rand() * 280,
    }));
    const rangeGeometry = new THREE.ConeGeometry(1, 1, 7);
    const rangeMaterial = new THREE.MeshStandardMaterial({ color: 0x0c1220, roughness: 0.9 });
    this.addInstances(group, rangeGeometry, rangeMaterial, peaks.length, (i, _mesh, dummy) => {
      const peak = peaks[i]!;
      dummy.position.set(
        center.x + Math.cos(peak.angle) * peak.radius,
        peak.h / 2,
        center.z + Math.sin(peak.angle) * peak.radius,
      );
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(peak.w, peak.h, peak.w);
    });
    const snowGeometry = new THREE.ConeGeometry(1, 1, 7);
    const snowMaterial = new THREE.MeshStandardMaterial({
      color: 0xbcd0e4,
      roughness: 0.5,
      emissive: 0x2c3c52,
      emissiveIntensity: 0.3 + night * 0.3,
    });
    this.addInstances(group, snowGeometry, snowMaterial, peaks.length, (i, _mesh, dummy) => {
      const peak = peaks[i]!;
      dummy.position.set(
        center.x + Math.cos(peak.angle) * peak.radius,
        peak.h * 0.72,
        center.z + Math.sin(peak.angle) * peak.radius,
      );
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(peak.w * 0.45, peak.h * 0.4, peak.w * 0.45);
    });
  }
}
