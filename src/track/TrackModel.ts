import * as THREE from 'three';
import type { TrackConfig, TrackSample, Vec3 } from '../types';
import { TrackMesh, type TrackMeshes } from '../rendering/TrackMesh';

export const TRACK_SAMPLE_COUNT = 1200;

const HINT_WINDOW = 96;
const UP = new THREE.Vector3(0, 1, 0);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function buildSamples(
  controlPoints: Vec3[],
): { samples: TrackSample[]; length: number } {
  const points = controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  const length = curve.getLength();
  const spaced = curve.getSpacedPoints(TRACK_SAMPLE_COUNT);
  const samples: TrackSample[] = [];
  for (let i = 0; i < TRACK_SAMPLE_COUNT; i++) {
    const point = spaced[i]!;
    const tangent = curve.getTangentAt(i / TRACK_SAMPLE_COUNT);
    const left = new THREE.Vector3().crossVectors(UP, tangent).normalize();
    samples.push({
      point: { x: point.x, y: point.y, z: point.z },
      tangent: { x: tangent.x, y: tangent.y, z: tangent.z },
      left: { x: left.x, y: left.y, z: left.z },
      distance: (i / TRACK_SAMPLE_COUNT) * length,
      curvature: 0,
    });
  }
  for (let i = 0; i < TRACK_SAMPLE_COUNT; i++) {
    const a = samples[i]!;
    const b = samples[(i + 1) % TRACK_SAMPLE_COUNT]!;
    const delta = (b.distance - a.distance + length) % length;
    const angle = Math.atan2(cross(a.tangent, b.tangent).y, dot(a.tangent, b.tangent));
    a.curvature = angle / (delta || 1);
  }
  return { samples, length };
}

export class TrackModel {
  readonly config: TrackConfig;
  readonly samples: TrackSample[];
  readonly length: number;
  readonly step: number;

  constructor(config: TrackConfig) {
    this.config = config;
    const built = buildSamples(config.controlPoints);
    this.samples = built.samples;
    this.length = built.length;
    this.step = this.length / TRACK_SAMPLE_COUNT;
  }

  sampleAt(distance: number): TrackSample {
    const wrapped = ((distance % this.length) + this.length) % this.length;
    const index = Math.min(Math.floor(wrapped / this.step), TRACK_SAMPLE_COUNT - 2);
    const a = this.samples[index]!;
    const b = this.samples[index + 1]!;
    const t = (wrapped - a.distance) / this.step;
    const tangent = normalize(lerpVec(a.tangent, b.tangent, t));
    const up = { x: 0, y: 1, z: 0 };
    return {
      point: lerpVec(a.point, b.point, t),
      tangent,
      left: normalize(cross(up, tangent)),
      distance: wrapped,
      curvature: lerp(a.curvature, b.curvature, t),
    };
  }

  nearestSample(position: Vec3, hint?: number): TrackSample {
    return this.samples[this.nearestIndex(position, hint)]!;
  }

  project(
    position: Vec3,
    hint?: number,
  ): { distance: number; lateral: number; sample: TrackSample } {
    const sample = this.nearestSample(position, hint);
    const dx = position.x - sample.point.x;
    const dy = position.y - sample.point.y;
    const dz = position.z - sample.point.z;
    const along = dx * sample.tangent.x + dy * sample.tangent.y + dz * sample.tangent.z;
    const distance =
      ((sample.distance + along) % this.length + this.length) % this.length;
    const refined = this.sampleAt(distance);
    const rx = position.x - refined.point.x;
    const ry = position.y - refined.point.y;
    const rz = position.z - refined.point.z;
    const lateral = rx * refined.left.x + ry * refined.left.y + rz * refined.left.z;
    return { distance, lateral, sample: refined };
  }

  createMeshes(): TrackMeshes {
    return new TrackMesh(this);
  }

  private nearestIndex(position: Vec3, hint?: number): number {
    const count = this.samples.length;
    const dist2 = (index: number): number => {
      const p = this.samples[index]!.point;
      const dx = p.x - position.x;
      const dy = p.y - position.y;
      const dz = p.z - position.z;
      return dx * dx + dy * dy + dz * dz;
    };
    if (hint === undefined) {
      let best = 0;
      let bestDist = dist2(0);
      for (let i = 1; i < count; i++) {
        const d = dist2(i);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    }
    const center = ((Math.round(hint / this.step) % count) + count) % count;
    let best = -1;
    let bestDist = Infinity;
    for (let offset = -HINT_WINDOW; offset <= HINT_WINDOW; offset++) {
      const index = (center + offset + count) % count;
      const d = dist2(index);
      if (d < bestDist) {
        bestDist = d;
        best = index;
      }
    }
    return best;
  }
}
