import * as THREE from 'three';
import type { Vec2 } from '../types';
import type { TrackModel } from '../track/TrackModel';

export interface TrackMeshes {
  readonly group: THREE.Group;
  readonly minimapPoints: Vec2[];
  dispose(): void;
}

const ROAD_Y = 0.02;
const EDGE_Y = 0.04;
const MARKING_Y = 0.05;
const EDGE_WIDTH = 0.35;
const DASH_LENGTH = 1.6;
const DASH_PERIOD = 4.0;
const DASH_HALF_WIDTH = 0.09;
const CHECKPOINT_DEPTH = 0.4;
const MINIMAP_STEP = 8;

export class TrackMesh implements TrackMeshes {
  readonly group = new THREE.Group();
  readonly minimapPoints: Vec2[] = [];

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(model: TrackModel) {
    const width = model.config.width;
    this.buildRoad(model, width);
    this.buildEdgeStrips(model, width);
    this.buildCenterLine(model);
    this.buildStartLine(model, width);
    this.buildCheckpoints(model, width);
    this.buildObstacles(model);
    this.buildMinimap(model);
  }

  dispose(): void {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    this.group.clear();
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.geometries.push(geometry);
    this.materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    this.group.add(mesh);
    return mesh;
  }

  private ribbon(
    model: TrackModel,
    leftOffset: number,
    rightOffset: number,
    y: number,
    color: number,
    emissive: boolean,
  ): THREE.Mesh {
    const rows = model.samples.length + 1;
    const positions = new Float32Array(rows * 2 * 3);
    for (let i = 0; i < rows; i++) {
      const sample = i === rows - 1 ? model.sampleAt(0) : model.sampleAt(i * model.step);
      const surfaceY = sample.point.y + y;
      const base = i * 6;
      positions[base] = sample.point.x + sample.left.x * leftOffset;
      positions[base + 1] = surfaceY;
      positions[base + 2] = sample.point.z + sample.left.z * leftOffset;
      positions[base + 3] = sample.point.x + sample.left.x * rightOffset;
      positions[base + 4] = surfaceY;
      positions[base + 5] = sample.point.z + sample.left.z * rightOffset;
    }
    const segments = rows - 1;
    const indices: number[] = [];
    for (let i = 0; i < segments; i++) {
      indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = emissive
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.1 });
    return this.mesh(geometry, material);
  }

  private buildRoad(model: TrackModel, width: number): void {
    const half = width / 2;
    this.ribbon(model, half, -half, ROAD_Y, 0x141a26, false);
  }

  private buildEdgeStrips(model: TrackModel, width: number): void {
    const half = width / 2;
    this.ribbon(model, half, half - EDGE_WIDTH, EDGE_Y, 0x00e5ff, true);
    this.ribbon(model, -half + EDGE_WIDTH, -half, EDGE_Y, 0x00e5ff, true);
  }

  private quad(
    model: TrackModel,
    distance: number,
    depth: number,
    halfWidth: number,
    y: number,
    color: number,
  ): THREE.Mesh {
    const start = model.sampleAt(distance - depth / 2);
    const end = model.sampleAt(distance + depth / 2);
    const positions = new Float32Array(12);
    const put = (base: number, sample: ReturnType<TrackModel['sampleAt']>, side: number): void => {
      positions[base] = sample.point.x + sample.left.x * side * halfWidth;
      positions[base + 1] = sample.point.y + y;
      positions[base + 2] = sample.point.z + sample.left.z * side * halfWidth;
    };
    put(0, start, 1);
    put(3, start, -1);
    put(6, end, 1);
    put(9, end, -1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex([0, 1, 2, 1, 3, 2]);
    geometry.computeVertexNormals();
    return this.mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
  }

  private buildStartLine(model: TrackModel, width: number): void {
    this.quad(model, 0, 2, width / 2, MARKING_Y, 0xffffff);
  }

  private buildCheckpoints(model: TrackModel, width: number): void {
    for (const distance of model.config.checkpointDistances) {
      this.quad(model, distance, CHECKPOINT_DEPTH, width / 2, EDGE_Y, 0xffd166);
    }
  }

  private buildCenterLine(model: TrackModel): void {
    const dashCount = Math.max(1, Math.floor((model.length - DASH_LENGTH) / DASH_PERIOD));
    const positions = new Float32Array(dashCount * 4 * 3);
    const indices: number[] = [];
    for (let d = 0; d < dashCount; d++) {
      const start = model.sampleAt(d * DASH_PERIOD);
      const end = model.sampleAt(d * DASH_PERIOD + DASH_LENGTH);
      const base = d * 12;
      const put = (offset: number, sample: ReturnType<TrackModel['sampleAt']>, side: number): void => {
        positions[base + offset] = sample.point.x + sample.left.x * side * DASH_HALF_WIDTH;
        positions[base + offset + 1] = sample.point.y + MARKING_Y;
        positions[base + offset + 2] = sample.point.z + sample.left.z * side * DASH_HALF_WIDTH;
      };
      put(0, start, 1);
      put(3, start, -1);
      put(6, end, 1);
      put(9, end, -1);
      const quadBase = d * 4;
      indices.push(
        quadBase,
        quadBase + 1,
        quadBase + 2,
        quadBase + 1,
        quadBase + 3,
        quadBase + 2,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0xeaf6ff, side: THREE.DoubleSide }),
    );
  }

  private buildObstacles(model: TrackModel): void {
    const barrierGeometry = new THREE.BoxGeometry(1, 1, 1);
    const barrierMaterial = new THREE.MeshBasicMaterial({ color: 0xff4d6d });
    const coneGeometry = new THREE.ConeGeometry(1, 2, 10);
    const coneMaterial = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    this.geometries.push(barrierGeometry, coneGeometry);
    this.materials.push(barrierMaterial, coneMaterial);
    for (const obstacle of model.obstacles) {
      const isBarrier = obstacle.type === 'barrier';
      const mesh = new THREE.Mesh(
        isBarrier ? barrierGeometry : coneGeometry,
        isBarrier ? barrierMaterial : coneMaterial,
      );
      mesh.position.set(obstacle.position.x, obstacle.position.y, obstacle.position.z);
      if (isBarrier) {
        const sample = model.nearestSample(obstacle.position);
        mesh.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);
        mesh.scale.set(obstacle.radius * 2, 1, 0.6);
        mesh.position.y += 0.5;
      } else {
        mesh.scale.setScalar(obstacle.radius);
        mesh.position.y += obstacle.radius;
      }
      this.group.add(mesh);
    }
  }

  private buildMinimap(model: TrackModel): void {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < model.samples.length; i += MINIMAP_STEP) {
      const sample = model.samples[i]!;
      this.minimapPoints.push({ x: sample.point.x, y: sample.point.z });
      points.push(new THREE.Vector3(sample.point.x, 0, sample.point.z));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.geometries.push(geometry);
    const material = new THREE.LineBasicMaterial({ color: 0x00e5ff });
    this.materials.push(material);
    this.group.add(new THREE.LineLoop(geometry, material));
  }
}
