import { TrackModel } from '../track/TrackModel';
import type { ObstacleConfig, TrackConfig, Vec3 } from '../types';

export interface TrackDefinition extends TrackConfig {
  obstacles: ObstacleConfig[];
}

interface ObstacleSpec {
  distanceFraction: number;
  lateral: number;
  radius: number;
  type: ObstacleConfig['type'];
}

interface TrackSeed
  extends Omit<TrackConfig, 'startTransform' | 'checkpointDistances' | 'obstacleDistances' | 'minimapBounds'> {
  checkpointFractions: number[];
  obstacleSpecs: ObstacleSpec[];
}

function buildTrack(seed: TrackSeed): TrackDefinition {
  const { checkpointFractions, obstacleSpecs, ...base } = seed;
  const provisional: TrackConfig = {
    ...base,
    startTransform: { position: { x: 0, y: 0, z: 0 }, heading: 0 },
    checkpointDistances: [],
    obstacleDistances: [],
    minimapBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  };
  const model = new TrackModel(provisional);
  const length = model.length;
  const start = model.sampleAt(0);
  const checkpointDistances = checkpointFractions.map((fraction) => fraction * length);
  const obstacleDistances = obstacleSpecs.map((spec) => spec.distanceFraction * length);
  const obstacles: ObstacleConfig[] = obstacleSpecs.map((spec) => {
    const sample = model.sampleAt(spec.distanceFraction * length);
    const position: Vec3 = {
      x: sample.point.x + sample.left.x * spec.lateral,
      y: sample.point.y + sample.left.y * spec.lateral,
      z: sample.point.z + sample.left.z * spec.lateral,
    };
    return { position, radius: spec.radius, type: spec.type };
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sample of model.samples) {
    minX = Math.min(minX, sample.point.x);
    minY = Math.min(minY, sample.point.z);
    maxX = Math.max(maxX, sample.point.x);
    maxY = Math.max(maxY, sample.point.z);
  }
  return {
    ...base,
    startTransform: {
      position: { x: start.point.x, y: start.point.y, z: start.point.z },
      heading: Math.atan2(start.tangent.x, start.tangent.z),
    },
    checkpointDistances,
    obstacleDistances,
    minimapBounds: {
      minX: minX - 10,
      minY: minY - 10,
      maxX: maxX + 10,
      maxY: maxY + 10,
    },
    obstacles,
  };
}

const city: TrackDefinition = buildTrack({
  id: 'city',
  displayName: 'Neon City Loop',
  environment: 'city',
  controlPoints: [
    { x: 0, y: 0, z: 0 },
    { x: 95, y: 0, z: -15 },
    { x: 175, y: 0, z: 35 },
    { x: 150, y: 0, z: 125 },
    { x: 55, y: 0, z: 150 },
    { x: -15, y: 0, z: 95 },
    { x: -95, y: 0, z: 145 },
    { x: -175, y: 0, z: 85 },
    { x: -150, y: 0, z: -25 },
    { x: -60, y: 0, z: -75 },
  ],
  width: 10,
  lapCount: 3,
  closed: true,
  variants: [
    { nightFactor: 1, weather: 'clear' },
    { nightFactor: 0.9, weather: 'rain' },
    { nightFactor: 0.55, weather: 'fog' },
  ],
  checkpointFractions: [0.25, 0.5, 0.75],
  obstacleSpecs: [
    { distanceFraction: 0.12, lateral: 2.6, radius: 0.45, type: 'cone' },
    { distanceFraction: 0.35, lateral: -2.1, radius: 0.45, type: 'cone' },
    { distanceFraction: 0.6, lateral: 2.9, radius: 2.0, type: 'barrier' },
    { distanceFraction: 0.8, lateral: -2.4, radius: 0.45, type: 'cone' },
  ],
});

const coast: TrackDefinition = buildTrack({
  id: 'coast',
  displayName: 'Coastal Highway',
  environment: 'coast',
  controlPoints: [
    { x: 0, y: 0, z: 0 },
    { x: 150, y: 0, z: 0 },
    { x: 300, y: 0, z: 20 },
    { x: 420, y: 0, z: 100 },
    { x: 435, y: 0, z: 240 },
    { x: 330, y: 0, z: 345 },
    { x: 165, y: 0, z: 365 },
    { x: 35, y: 0, z: 285 },
    { x: -45, y: 0, z: 165 },
    { x: -30, y: 0, z: 60 },
  ],
  width: 12,
  lapCount: 3,
  closed: true,
  variants: [
    { nightFactor: 0.15, weather: 'clear' },
    { nightFactor: 0.4, weather: 'fog' },
  ],
  checkpointFractions: [0.25, 0.5, 0.75],
  obstacleSpecs: [
    { distanceFraction: 0.15, lateral: -3.2, radius: 0.45, type: 'cone' },
    { distanceFraction: 0.45, lateral: 3.4, radius: 2.5, type: 'barrier' },
    { distanceFraction: 0.75, lateral: 3.0, radius: 0.45, type: 'cone' },
  ],
});

const mountain: TrackDefinition = buildTrack({
  id: 'mountain',
  displayName: 'Alpine Night Pass',
  environment: 'mountain',
  controlPoints: [
    { x: 0, y: 0, z: 0 },
    { x: 120, y: 0, z: -45 },
    { x: 225, y: 0, z: 15 },
    { x: 160, y: 0, z: 125 },
    { x: 265, y: 0, z: 205 },
    { x: 205, y: 0, z: 310 },
    { x: 60, y: 0, z: 285 },
    { x: -45, y: 0, z: 345 },
    { x: -145, y: 0, z: 245 },
    { x: -105, y: 0, z: 125 },
    { x: -165, y: 0, z: 5 },
    { x: -85, y: 0, z: -60 },
  ],
  width: 9,
  lapCount: 3,
  closed: true,
  variants: [
    { nightFactor: 0.8, weather: 'clear' },
    { nightFactor: 0.7, weather: 'fog' },
  ],
  checkpointFractions: [0.25, 0.5, 0.75],
  obstacleSpecs: [
    { distanceFraction: 0.2, lateral: 2.0, radius: 0.45, type: 'cone' },
    { distanceFraction: 0.5, lateral: -2.0, radius: 0.45, type: 'cone' },
    { distanceFraction: 0.7, lateral: 2.4, radius: 2.0, type: 'barrier' },
  ],
});

export const tracks: TrackDefinition[] = [city, coast, mountain];
