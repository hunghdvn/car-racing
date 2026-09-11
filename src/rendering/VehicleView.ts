import * as THREE from 'three';

const WHEEL_RADIUS = 0.42;
const MAX_STEER = 0.42;

export function makeCarMaterial(color: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.55,
    roughness: 0.34,
  });
  material.emissive.setHex(color);
  material.emissiveIntensity = 0.16;
  return material;
}

export class VehicleView {
  readonly group = new THREE.Group();

  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly rimMaterial: THREE.MeshStandardMaterial;
  private readonly underglow: THREE.Mesh;
  private readonly bodyGroup = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  private readonly frontPivots: THREE.Group[] = [];
  private readonly flames: THREE.Mesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private steerAngle = 0;
  private elapsed = 0;
  private nitroGlow = 0;
  private driftGlow = 0;

  constructor(color: number, rim: number) {
    this.bodyMaterial = makeCarMaterial(color);
    this.rimMaterial = new THREE.MeshStandardMaterial({
      color: rim,
      metalness: 0.85,
      roughness: 0.28,
    });
    const glass = new THREE.MeshStandardMaterial({ color: 0x10151f, metalness: 0.75, roughness: 0.15 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.9, metalness: 0.1 });
    const headlight = new THREE.MeshBasicMaterial({ color: 0xfff3d6 });
    const taillight = new THREE.MeshBasicMaterial({ color: 0xff2547 });
    const flame = new THREE.MeshBasicMaterial({
      color: 0x6fe3ff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const underglowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(
      this.bodyMaterial,
      this.rimMaterial,
      glass,
      tire,
      headlight,
      taillight,
      flame,
      underglowMaterial,
    );

    this.addBox(1.9, 0.5, 4.1, 0, 0.52, 0, this.bodyMaterial);
    this.addBox(1.7, 0.3, 1.2, 0, 0.84, 1.45, this.bodyMaterial);
    this.addBox(1.56, 0.46, 1.9, 0, 0.98, -0.4, glass);
    this.addBox(1.7, 0.07, 0.45, 0, 1.12, -1.92, this.bodyMaterial);
    this.addBox(0.09, 0.3, 0.09, 0.62, 0.96, -1.9, this.bodyMaterial);
    this.addBox(0.09, 0.3, 0.09, -0.62, 0.96, -1.9, this.bodyMaterial);
    this.addBox(0.42, 0.13, 0.06, 0.56, 0.56, 2.06, headlight);
    this.addBox(0.42, 0.13, 0.06, -0.56, 0.56, 2.06, headlight);
    this.addBox(0.5, 0.11, 0.06, 0.5, 0.56, -2.06, taillight);
    this.addBox(0.5, 0.11, 0.06, -0.5, 0.56, -2.06, taillight);

    const flameGeometry = new THREE.ConeGeometry(0.15, 0.9, 8);
    flameGeometry.rotateX(-Math.PI / 2);
    this.geometries.push(flameGeometry);
    for (const x of [0.42, -0.42]) {
      const mesh = new THREE.Mesh(flameGeometry, flame);
      mesh.position.set(x, 0.42, -2.2);
      mesh.visible = false;
      this.flames.push(mesh);
      this.group.add(mesh);
    }
    const glowGeometry = new THREE.PlaneGeometry(1.7, 3.6);
    glowGeometry.rotateX(-Math.PI / 2);
    this.geometries.push(glowGeometry);
    const underglow = new THREE.Mesh(glowGeometry, underglowMaterial);
    underglow.position.y = 0.07;
    underglow.visible = false;
    this.underglow = underglow;
    this.group.add(underglow);

    const wheelGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.3, 14);
    wheelGeometry.rotateZ(Math.PI / 2);
    const rimGeometry = new THREE.CylinderGeometry(0.2, 0.21, 0.32, 10);
    rimGeometry.rotateZ(Math.PI / 2);
    this.geometries.push(wheelGeometry, rimGeometry);
    const wheelPositions: ReadonlyArray<readonly [number, number, boolean]> = [
      [0.85, 1.38, true],
      [-0.85, 1.38, true],
      [0.85, -1.38, false],
      [-0.85, -1.38, false],
    ];
    for (const [x, z, front] of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeometry, tire);
      wheel.add(new THREE.Mesh(rimGeometry, this.rimMaterial));
      wheel.castShadow = true;
      if (front) {
        const pivot = new THREE.Group();
        pivot.position.set(x, WHEEL_RADIUS, z);
        pivot.add(wheel);
        this.frontPivots.push(pivot);
        this.group.add(pivot);
      } else {
        wheel.position.set(x, WHEEL_RADIUS, z);
        this.group.add(wheel);
      }
      this.wheels.push(wheel);
    }

    for (const mesh of this.bodyGroup.children) {
      mesh.castShadow = true;
    }
    this.group.add(this.bodyGroup);
  }

  update(
    speed: number,
    steer: number,
    drift: boolean,
    nitro: boolean,
    delta: number = 1 / 60,
  ): void {
    if (delta <= 0) return;
    this.elapsed += delta;
    const spin = (speed / WHEEL_RADIUS) * delta;
    for (const wheel of this.wheels) {
      wheel.rotation.x -= spin;
    }
    const targetSteer = THREE.MathUtils.clamp(steer, -1, 1) * MAX_STEER;
    const k = 1 - Math.exp(-delta * 12);
    this.steerAngle += (targetSteer - this.steerAngle) * k;
    for (const pivot of this.frontPivots) {
      pivot.rotation.y = this.steerAngle;
    }
    const grip = THREE.MathUtils.clamp(speed / 45, 0, 1);
    this.bodyGroup.rotation.z = -this.steerAngle * 0.14 * grip;
    this.nitroGlow += ((nitro ? 1 : 0) - this.nitroGlow) * k;
    this.driftGlow += ((drift ? 1 : 0) - this.driftGlow) * k;
    this.bodyMaterial.emissiveIntensity = 0.16 + this.nitroGlow * 0.55;
    const flamesOn = this.nitroGlow > 0.15 && speed > 1;
    for (let i = 0; i < this.flames.length; i++) {
      const flame = this.flames[i]!;
      flame.visible = flamesOn;
      if (flamesOn) {
        const flicker = 0.65 + 0.35 * Math.sin(this.elapsed * 46 + i * 2.4);
        flame.scale.set(flicker, flicker, 0.7 + grip * 0.9 + this.nitroGlow * 0.6);
      }
    }
    this.underglow.visible = this.driftGlow > 0.05;
    (this.underglow.material as THREE.MeshBasicMaterial).opacity = this.driftGlow * 0.5;
  }

  setCosmetic(color: number, rim: number): void {
    this.bodyMaterial.color.setHex(color);
    this.bodyMaterial.emissive.setHex(color);
    this.rimMaterial.color.setHex(rim);
  }

  dispose(): void {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    this.geometries.length = 0;
    this.materials.length = 0;
    this.group.clear();
  }

  private addBox(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
  ): void {
    const geometry = new THREE.BoxGeometry(w, h, d);
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    this.bodyGroup.add(mesh);
  }
}
