/** Velocity Rush — centralized tuning. All gameplay/visual constants live here (spec §18). */

export interface PaintDef { name: string; color: number; roughness?: number }

/** Golden-hour theme + lighting (spec §12). */
export const THEME = {
  sunElevationDeg: 16,
  sunAzimuthDeg: -128,
  sunColor: 0xffb57f,
  sunIntensity: 2.9,
  skyZenith: 0x2f6fbd,
  skyMid: 0x8fbce4,
  skyHorizon: 0xf2d3a2,
  skySunTint: 0xfff0d8,
  groundHemi: 0x58534a,
  hemiIntensity: 0.78,
  envIntensity: 1.02,
  fogColor: 0xcfd6da,
  fogDensity: 0.00128,
  water: { deep: 0x0a2f47, shallow: 0x115468, foam: 0xcfe4e8, spec: 0xffd9a8 },
} as const

/** Render/quality budgets (spec §3, §12, §17). */
export const GRAPHICS = {
  maxPixelRatio: 1.75,
  bloomThreshold: 0.92,
  bloomStrength: 0.32,
  bloomRadius: 0.6,
  vignetteDarkness: 0.32,
  vignetteOffset: 0.22,
  exposure: 1.06,
  shadowMapSize: 2048,
  shadowExtent: 130,
  shadowNearFar: [1, 420] as const,
  shadowBias: -0.00042,
  shadowNormalBias: 0.045,
  msaaSamples: 4,
} as const

/** Adaptive quality tiers — fallback order per spec §12/§18 (§18 of brief: shadows→bloom→DPR→particles→density→LOD). */
export const QUALITY = {
  high: { pixelRatio: 1.75, shadowMap: 2048, bloom: 0.32, particles: 1, propDensity: 1, lodBias: 1 },
  medium: { pixelRatio: 1.4, shadowMap: 1448, bloom: 0.26, particles: 0.8, propDensity: 1, lodBias: 0.85 },
  low: { pixelRatio: 1.15, shadowMap: 1024, bloom: 0.18, particles: 0.55, propDensity: 0.8, lodBias: 0.7 },
} as const

/** Vehicle physics — arcade (spec §14). All m/s, m/s², rad unless noted. */
export const VEHICLE = {
  length: 4.55, width: 1.94, height: 1.16,
  wheelRadius: 0.36, wheelWidth: 0.30, wheelbase: 2.72, trackWidth: 1.64,
  rideHeight: 0.30, wheelbaseFront: 1.4,
  engineAccel: 11.2, // m/s² at v=0 (before curve)
  topSpeed: 57,       // ~205 km/h
  nitroTopSpeed: 72,  // ~259 km/h
  nitroAccelMul: 1.62,
  brakeForce: 24,
  reverseMaxSpeed: 14,
  reverseAccel: 8,
  drag: 0.0034,       // quadratic air drag coeff (1/m)
  rollResist: 0.35,   // m/s² rolling friction
  grassRollResist: 3.4,
  gripMax: 14.2,      // max lateral accel on asphalt m/s²
  gripDrift: 0.44,    // multiplier while handbrake-drifting
  gripAir: 0.18,
  gripGrass: 0.5,
  steerLowSpeed: 2.45, // rad/s yaw authority at 0 speed...
  steerHighSpeed: 0.82,// ...tapered to this at top speed
  yawResponse: 6.4,    // how fast yaw rate approaches target (1/s)
  driftYawBoost: 1.55, // extra yaw authority while drifting
  driftAngleMax: 0.92, // rad, clamped visual/effective slide angle
  driftTriggerSpeed: 9.5,
  airGravity: 21.5,    // snappier than 9.81 — arcade jumps
  airSteerMul: 0.42,
  landLiftDamp: 0.14,  // vertical velocity killed on landing
  suspensionRate: 11,  // visual spring frequency (hz-ish)
  suspensionDamp: 0.72,
  bumpFrequency: 0.62,
  collisionBounce: 0.36,
  carPushRadius: 2.25,
  carPushForce: 10.5,
} as const

/** Nitro system (spec §14). */
export const NITRO = {
  max: 100,
  startValue: 32,
  minToActivate: 12,
  drainPerSec: 30,
  chargeDriftPerSec: 15,
  chargeCleanPerSec: 2.6,
  bonusPerDriftChain: 12,
  bonusShortcut: 26,
  bonusRampAirPerSec: 9,
} as const

/** Chase camera framing contract (spec §13). */
export const CAMERA = {
  distBase: 4.7, distSpeedAdd: 1.4, nitroPullIn: 0.4,
  heightBase: 1.86, heightSpeedAdd: 0.3, jumpHeightAdd: 1.0,
  lookAheadBase: 5.6, lookAheadSpeed: 0.16,
  fovBase: 57, fovSpeedAdd: 15, fovNitroAdd: 9,
  posLag: 7.6,
  yawLag: 5.8,
  maxDriftYawLag: 0.33,
  shakeDecay: 4.2, maxShake: 0.42,
  near: 0.12, far: 1600,
} as const

/** AI brains (spec §10 of brief / §24A). */
export const AI = {
  count: 5,
  paceBase: 0.94,           // fraction of top speed
  paceSpread: 0.055,        // per-slot variation
  rubberBandMin: 0.9, rubberBandMax: 1.06, rubberK: 0.11,
  cornerLatAccel: 12.6,     // for curvature-based speed target
  brakeLookaheadTime: 0.62, minLookaheadDist: 13,
  steerK: 0.62, headingK: 0.22,
  nitroOnStraight: true, nitroChargePerSec: 7, nitroDrainPerSec: 26, nitroMax: 100,
  avoidRadius: 5.4, avoidForce: 0.5,
  stuckTime: 3.2, stuckSpeed: 2.2,
  slipstreamDist: 9, slipstreamGain: 0.055,
} as const

export const PARTICLES = { smokeMax: 900, dustMax: 500, sparkMax: 420, splatMax: 260, smokesPerSec: 340 } as const

export const AUDIO = { master: 0.85, engineBase: 52, engineRange: 208, idleRpm: 0.14, shiftPoint: 0.82 } as const

/** Race (spec §20: single lap ~2 min, 6 cars). */
export const RACE = { laps: 1, cars: 6, totalProgressCheckpoints: 24 } as const

export const PAINTS: PaintDef[] = [
  { name: 'Solar Flare', color: 0xf27a1e },
  { name: 'Velocity Red', color: 0xd8232e },
  { name: 'Night Shift', color: 0x14181f, roughness: 0.34 },
  { name: 'Viper Green', color: 0x39c06a },
  { name: 'Velocity Blue', color: 0x1f8fe0 },
  { name: 'Plasma Gold', color: 0xe8b62e },
]

/** Determinism: master seed for all seeded placement (spec §22). */
export const SEED = 20260916

/** Track profile — Phase 3 representative coastal slice (~300 m, spec §7/§8/§20).
 *  Control points are (x, z, y): road centreline crown elevation above sea datum.
 *  Hero composition looks west (-X): sea + sun ahead-left, building cluster
 *  mid-right, ramp as built infrastructure, hills/skyline background. */
export interface TrackPoint { x: number; z: number; y: number }
export const TRACK = {
  controlPoints: [
    { x: -160, z: 24, y: 1.15 },
    { x: -126, z: 27, y: 1.05 },
    { x: -92, z: 24, y: 0.95 },
    { x: -58, z: 17, y: 0.85 },
    { x: -26, z: 7, y: 0.8 },
    { x: 4, z: 0.5, y: 0.9 },
    { x: 32, z: -1.5, y: 1.05 },
    { x: 58, z: 0, y: 1.5 },
    { x: 72, z: 0.5, y: 1.35 },
    { x: 90, z: 5, y: 1.55 },
    { x: 112, z: 15, y: 2.1 },
    { x: 138, z: 29, y: 2.9 },
  ] as TrackPoint[],
  halfWidth: 5.4,        // asphalt half-width (crown centre)
  crown: 0.055,          // drainage camber of the surface (edge fall)
  shoulderOuter: 8.0,    // engineered shoulder extent from centre
  shoulderDrop: 0.62,    // outer shoulder edge fall below crown
  camberGain: 9.4,       // superelevation: tan(bank) = clamp(curvature * gain)
  camberMaxDeg: 4.5,     // arcade-sane corner banking
  /** Big-jump kicker (built object on the racing line before the sweep).
   *  Arc-length stations along the ~330 m spline (x = 56..64 hero straight). */
  ramp: {
    sStart: 213, sLip: 224.6, height: 1.26, lipThick: 0.2,
    landingS: 228.6, landingLen: 6.2, sideTrim: 0.55, // asphalt inset each side
  },
  /** Coastal terrain field (spec §4.4/§8/§9). */
  coast: {
    seaLevel: -6.5,
    shelfAmp: 1.0,       // cliff-top shelf relief (blends into dune field)
    seaFloor: -10.4,
    cliffZTop: -26,      // shelf begins falling here …
    cliffZBase: -47,     // … down to the sea floor
    fieldAmp: 2.6,
    northHillStart: 44,
    northHillRise: 0.15,
    northHillNoise: 5.5,
    edgeMeander: 9,      // lateral bay/headland meander of the cliff line
  },
  /** Building-cluster pad anchor (world XZ) — Phase 3: one authored cluster. */
  cluster: { x: 48, z: 24, padR: 30 },
} as const
