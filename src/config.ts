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
  groundHemi: 0x5b5740,
  hemiIntensity: 0.78,
  envIntensity: 1.02,
  fogColor: 0xd3d2c4,
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
  engineFloor: 0.06, // residual throttle fraction of the curve at v->top (keeps the car pressed to the cap)
  topSpeed: 57,       // ~205 km/h
  nitroTopSpeed: 72,  // ~259 km/h
  nitroAccelMul: 1.62,
  brakeForce: 24,
  reverseMaxSpeed: 14,
  reverseAccel: 8,
  drag: 0.00055,      // quadratic air drag coeff (1/m) — tuned so the engine curve asymptotes just above 0.9 topSpeed
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
  /* --- Phase 6: drive-mode tuning (arcade feel, spec §14) --- */
  /** per-wheel suspension travel (m): jounce limit / droop extension / static preload */
  suspTravel: 0.13, suspDroop: 0.078, suspPreload: 0.045,
  /** wheel-speed (m/s) transferred into suspension load transfer (pitch/roll feel) */
  loadPitchK: 0.0042, loadRollK: 0.0034,
  /** body pitch/roll visual gains (rad per m/s²) and clamp */
  bodyPitchK: 0.0055, bodyRollK: 0.011, bodyLeanK: 0.1, bodyTiltMax: 0.16,
  /** geometric ramp launch: vy = speed * (grade + slopeAtLip * launchPop); gates */
  launchPop: 1.18, launchMinSpeed: 17, launchMinSlope: 0.04,
  /** airborne pitch toward velocity vector (rad/s pursuit) */
  airPitchK: 4.5,
  /** landing: vertical impact scrub (per m/s of impact speed) */
  landScrubK: 0.008,
  /** collision: wall sits barrierInset beyond the asphalt edge; post-hit scrub/cooldown */
  barrierInset: 0.62, collideScrub: 0.9, collideCd: 0.22, vehicleHalf: 0.92,
  /** off-road: beyond roadEdge+offPad the surface is loose */
  offPad: 0.42,
  /** respawn: blackout duration and out-of-corridor trigger distance */
  respawnTime: 0.8, respawnLat: 85, respawnSeaPad: 0.35,
  /** stuck (throttle pinned, no progress) auto-respawn gate */
  stuckTime: 3.5, stuckSpeed: 1.6,
  /** steering visual: max front-wheel angle (rad); derived from yaw rate (auto counter-steer) */
  steerMaxRad: 0.62, steerSpeedGate: 5,
  /** drift economy gate: slip must exceed driftMinSlip; chain bonus after driftChainHold s */
  driftMinSlip: 0.2, driftChainHold: 0.85, driftEndGrace: 0.45,
  /** nitro release flicker guard (s) */
  nitroOffCool: 0.3,
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
  /* --- Phase 7: AI controller + race integration extensions --- *
   * steerK/headingK are the approved base gains; headingScale/yawDamp are
   * fixed unit normalisations/calibration of that controller (the physics
   * consumes steer as normalised authority, so the rad-error term needs a
   * constant scale into that domain). */
  headingScale: 9.5,        // rad heading error -> normalised steer authority
  yawDamp: 0.085,           // yaw-rate damping term in the steer law (s)
  steerLookBase: 6,         // m of fixed look-ahead on the steering frame
  steerLookTime: 0.42,      // s of speed-proportional steering look-ahead
  lineGain: 150,            // racing-line cut: lat = clamp(curv * lineGain, ±lineMax)
  lineMax: 2.6,             // m max apex cut off the centreline
  laneBias: 0.5,            // m of seeded per-car lane preference (spacing personality)
  avoidBand: 2.3,           // m lateral band a close rival occupies before we nudge
  avoidReach: 3.2,          // m of lateral nudge a full avoidForce produces
  blockBrake: 0.55,         // max brake when a rival blocks the slot ahead
  nitroCurvGate: 0.0045,    // |curv| under which a stretch counts as straight
  nitroMinToActivate: 14,   // AI tank fraction required to light the nitro
  nitroClearGap: 13,        // m of clear slot ahead required to deploy nitro
} as const

export const PARTICLES = { smokeMax: 900, dustMax: 500, sparkMax: 420, splatMax: 260, smokesPerSec: 340 } as const

export const AUDIO = { master: 0.85, engineBase: 52, engineRange: 208, idleRpm: 0.14, shiftPoint: 0.82 } as const

/** Race (spec §20: single lap ~2 min, 6 cars). */
export const RACE = {
  laps: 1, cars: 6, totalProgressCheckpoints: 24,
  /* --- Phase 7: director + grid extensions --- */
  countdownTime: 3.2,       // s of lights-out hold before GO (countdown state)
  timeLimit: 320,           // s of sim time after which the field is classified
  gridFront: 14,            // m the pole slot stands before the start/finish line
  gridRowGap: 11,           // m between staggered grid rows (> car length + margin)
  gridLane: 1.55,           // m lateral lane offset off the crown centre
} as const

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

/** Asset kits (Phase 4, spec §4.2/§4.3/§4.7/§10). LOD switches in metres. */
export const KIT = {
  /** near / baked-silhouette mid / low-poly far (spec §4.7: ≥2 LOD levels). */
  lodNear: 0,
  lodMid: 48,
  lodFar: 130,
  vegLodMid: 52,
  vegLodFar: 150,
  /** variation rules (§10): rotation noise, ±15 % scale, colour variants. */
  scaleJitter: 0.15,
  yawJitter: 0.16,
  colourVariants: 3,
  /** composition rhythm: metres between cluster anchors (tight→loose). */
  clusterGapMin: 14,
  clusterGapMax: 27,
  /** skyline kit (depth layer 3) */
  skyline: { bandZ: 122, depth: 46, modules: 7 },
} as const

/** Track profile — the full Velocity Rush circuit (spec §7/§20).
 *  Control points are (x, z, y): road centreline crown elevation above sea datum.
 *  Indices 0–11 are the approved Phase-3 coastal slice (visual language frozen);
 *  the appended points close the lap: industrial east leg → tunnel → elevated
 *  deck over the north city → high-speed final sector → headland horseshoe →
 *  east-bound finishing straight that rejoins the start.
 *  `zone` tags drive every per-zone builder (edge assembly, dressing, terrain). */
export type ZoneId = 'coastal' | 'industrial' | 'tunnel' | 'elevated' | 'final' | 'start'
export interface TrackPoint { x: number; z: number; y: number; zone?: ZoneId }
export const TRACK = {
  controlPoints: [
    /* ---------------------------------------------------- coastal slice (0–11) */
    { x: -160, z: 24, y: 1.15, zone: 'coastal' as ZoneId },
    { x: -126, z: 27, y: 1.05, zone: 'coastal' as ZoneId },
    { x: -92, z: 24, y: 0.95, zone: 'coastal' as ZoneId },
    { x: -58, z: 17, y: 0.85, zone: 'coastal' as ZoneId },
    { x: -26, z: 7, y: 0.8, zone: 'coastal' as ZoneId },
    { x: 4, z: 0.5, y: 0.9, zone: 'coastal' as ZoneId },
    { x: 32, z: -1.5, y: 1.05, zone: 'coastal' as ZoneId },
    { x: 58, z: 0, y: 1.5, zone: 'coastal' as ZoneId },
    { x: 72, z: 0.5, y: 1.35, zone: 'coastal' as ZoneId },
    { x: 90, z: 5, y: 1.55, zone: 'coastal' as ZoneId },
    { x: 112, z: 15, y: 2.1, zone: 'coastal' as ZoneId },
    { x: 138, z: 29, y: 2.9, zone: 'coastal' as ZoneId },
    /* --------------------------------------------- industrial east leg (12–22) */
    { x: 202, z: 46, y: 3.3, zone: 'industrial' as ZoneId },
    { x: 264, z: 70, y: 4.2, zone: 'industrial' as ZoneId },
    { x: 320, z: 106, y: 5.3, zone: 'industrial' as ZoneId },
    { x: 368, z: 152, y: 6.4, zone: 'industrial' as ZoneId },
    { x: 408, z: 204, y: 7.4, zone: 'industrial' as ZoneId },
    { x: 448, z: 256, y: 8.2, zone: 'industrial' as ZoneId },
    { x: 472, z: 318, y: 9.0, zone: 'industrial' as ZoneId },
    { x: 478, z: 382, y: 9.8, zone: 'industrial' as ZoneId },
    { x: 488, z: 446, y: 10.5, zone: 'industrial' as ZoneId },
    { x: 490, z: 510, y: 11.2, zone: 'industrial' as ZoneId },
    { x: 482, z: 556, y: 11.9, zone: 'industrial' as ZoneId },
    /* ------------------------------------------------ tunnel (23–26): straight bore */
    { x: 476, z: 600, y: 12.7, zone: 'tunnel' as ZoneId },
    { x: 468, z: 646, y: 13.5, zone: 'tunnel' as ZoneId },
    { x: 460, z: 692, y: 14.4, zone: 'tunnel' as ZoneId },
    { x: 450, z: 738, y: 15.4, zone: 'tunnel' as ZoneId },
    /* ---------------------------------- elevated viaduct west over the north city */
    { x: 436, z: 782, y: 16.4, zone: 'elevated' as ZoneId },
    { x: 404, z: 818, y: 17.4, zone: 'elevated' as ZoneId },
    { x: 360, z: 848, y: 18.3, zone: 'elevated' as ZoneId },
    { x: 308, z: 872, y: 19.0, zone: 'elevated' as ZoneId },
    { x: 250, z: 888, y: 19.6, zone: 'elevated' as ZoneId },
    { x: 188, z: 896, y: 20.1, zone: 'elevated' as ZoneId },
    { x: 126, z: 898, y: 20.4, zone: 'elevated' as ZoneId },
    { x: 64, z: 894, y: 20.6, zone: 'elevated' as ZoneId },
    { x: 2, z: 884, y: 20.6, zone: 'elevated' as ZoneId },
    { x: -58, z: 870, y: 20.3, zone: 'elevated' as ZoneId },
    { x: -116, z: 852, y: 19.7, zone: 'elevated' as ZoneId },
    /* ------------------------- high-speed final sector descending the west ridge */
    { x: -228, z: 836, y: 18.9, zone: 'final' as ZoneId },
    { x: -286, z: 806, y: 18.1, zone: 'final' as ZoneId },
    { x: -334, z: 768, y: 17.3, zone: 'final' as ZoneId },
    { x: -374, z: 724, y: 16.5, zone: 'final' as ZoneId },
    { x: -404, z: 674, y: 15.7, zone: 'final' as ZoneId },
    { x: -426, z: 620, y: 14.9, zone: 'final' as ZoneId },
    { x: -442, z: 564, y: 14.1, zone: 'final' as ZoneId },
    { x: -452, z: 508, y: 13.4, zone: 'final' as ZoneId },
    { x: -458, z: 450, y: 12.7, zone: 'final' as ZoneId },
    { x: -458, z: 392, y: 12.0, zone: 'final' as ZoneId },
    { x: -450, z: 338, y: 11.4, zone: 'final' as ZoneId },
    /* ------------------- headland sweeper + east-bound finishing straight to cp0 */
    { x: -438, z: 284, y: 10.7, zone: 'start' as ZoneId },
    { x: -448, z: 232, y: 9.9, zone: 'start' as ZoneId },
    { x: -464, z: 178, y: 9.1, zone: 'start' as ZoneId },
    { x: -468, z: 124, y: 8.3, zone: 'start' as ZoneId },
    { x: -454, z: 78, y: 7.5, zone: 'start' as ZoneId },
    { x: -430, z: 40, y: 6.6, zone: 'start' as ZoneId },
    { x: -394, z: 18, y: 5.7, zone: 'start' as ZoneId },
    { x: -352, z: 20, y: 4.8, zone: 'start' as ZoneId },
    { x: -302, z: 24, y: 3.9, zone: 'start' as ZoneId },
    { x: -250, z: 22, y: 3.0, zone: 'start' as ZoneId },
    { x: -204, z: 24, y: 2.2, zone: 'start' as ZoneId },
    { x: -160, z: 24, y: 1.15, zone: 'start' as ZoneId },
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
    /** m before the lip where the built kicker's launch slope is sampled (VehiclePhysics) */
    launchProbe: 1.2,
  },
  /** Coastal terrain field (spec §4.4/§8/§9). */
  /** Full-circuit terrain shaping (spec §8). The coastal field is frozen; the
   *  appended zones each get a designed profile blended in along the arc. */
  terrain: {
    cell: 2.6,            // height-field sample spacing (m)
    tile: 150,            // culling tile size (m) — one mesh per tile
    margin: 170,          // field extent beyond the circuit bbox
    blend: 55,            // arc-length ramp between neighbouring zone profiles
    farFade: [96, 190],   // |lat| where a zone profile relaxes to the far field
    farRelief: 15,        // relief of the world outside the corridor
    tunnelRise: 8.0,      // ridge height above the crown that buries the bore
    tunnelCross: 0.34,    // ridge shoulder gain per metre of |lat|
    cityFloor: -12.8,     // north-city ground under the viaduct, relative to crown
    deckRise: 130,        // metres of deck end where the ground climbs to meet it
  },
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
  /** Authored terrain pads (spec §8): flatten a zone's build sites so clusters
   *  sit on formed ground instead of noise. cp = control-point index, lat =
   *  driver-right offset, dy = target height relative to the crown there. */
  pads: [
    { cp: 14, lat: -34, r: 30, dy: -1.4 },   // container yard, works south
    { cp: 16, lat: 30, r: 26, dy: -1.2 },     // warehouse apron east
    { cp: 19, lat: -32, r: 24, dy: -1.3 },    // pipe/steel yard
    { cp: 21, lat: 33, r: 26, dy: -1.1 },     // plant apron below the bore
    { cp: 28, lat: 0, r: 40, dy: -12.6 },     // north city under the deck (east)
    { cp: 31, lat: 0, r: 46, dy: -12.8 },     // north city under the deck (mid)
    { cp: 34, lat: 0, r: 44, dy: -12.9 },     // north city under the deck (west)
    { cp: 41, lat: 36, r: 22, dy: 2.8 },      // ridge overlook terrace cut, final sector
    { cp: 44, lat: -30, r: 20, dy: -3.2 },    // quarry yard on the valley bench
    { cp: 52, lat: -28, r: 20, dy: -1.0 },     // team-caravan apron, back straight inside
    { cp: 57, lat: -26, r: 24, dy: -1.2 },    // pit / grandstand apron, inside the straight
  ] as const,
  /** Tunnel bore (spec §7): terrain passes OVER the tube; portals mask the ends. */
  tunnel: {
    crownRise: 8.0,      // authored ridge height above the crown that buries the bore
    tubeHalf: 8.6,       // inner half-width of the bore (shoulders stay inside)
    tubeRise: 6.3,       // inner clear height at the crown
    apron: 15,           // carved-cut length each side where the tube emerges
    lightEvery: 12.5,    // fitting spacing along the bore
    ribEvery: 6.25,      // arch rib spacing
    portalDepth: 2.6,    // portal frame projection out of the rock
  },
  /** Elevated viaduct (spec §5 Tier 1): deck, parapets, pylons, soffit. */
  bridge: {
    deckUnder: 1.35,     // structural depth below the asphalt plane
    parapetH: 1.08,
    pylonEvery: 25,
    pylonW: 2.3,
    abutment: 22,        // earthwork transition at each deck end
    deckEdge: 0.72,      // kerb reveal outboard of the asphalt
  },
  /** Per-zone edge assemblies (spec §7). Each list is station windows; the
   *  frozen coastal runs keep their authored values so the hero slice is
   *  byte-stable. `style` picks the kerb paint character. */
  edge: {
    kerb: [
      { s0: 140, s1: 300, style: 'coast' as const },        // frozen authored slice
      { s0: 384, s1: 1050, style: 'hazard' as const },        // works: yellow/black
      { s0: 1955, s1: 2586, style: 'standard' as const },    // ridge esses
      { s0: 2602, s1: 2636, style: 'city' as const },         // city outskirts: red/white
      { s0: 2658, s1: 2966, style: 'city' as const },
      { s0: 3006, s1: 3118, style: 'city' as const },
    ],
    rumble: [
      { s0: 150, s1: 286 },                                   // frozen authored slice
      { s0: 640, s1: 690 }, { s0: 890, s1: 946 },            // yard corner entries
      { s0: 2062, s1: 2112 }, { s0: 2322, s1: 2374 },        // ridge esses apexes
      { s0: 2742, s1: 2796 },                                  // back-straight kink
      { s0: 2812, s1: 2862 },                                  // headland sweeper entry
    ],
    barrier: [
      { s0: 148, s1: 262 },                                    // frozen authored slice
      { s0: 1058, s1: 1092 }, { s0: 1210, s1: 1242 },        // tunnel portal approaches
      { s0: 2664, s1: 2762 },                                  // pit wall frontage
    ],
    guard: [
      { s0: 158, s1: 272 },                                    // frozen authored slice
      { s0: 376, s1: 1054 },                                   // works east leg
      { s0: 1948, s1: 2590 },                                  // ridge descent (high speed)
      { s0: 2594, s1: 2636 }, { s0: 2658, s1: 2966 },         // back straight (gap at the spur mouth)
      { s0: 3006, s1: 3120 },                                  // finishing straight
    ],
    tyres: [
      { s0: 1990, s1: 1996 }, { s0: 2240, s1: 2246 },        // ridge esses inside
      { s0: 2858, s1: 2866 },                                  // sweeper apex
    ],
    chevrons: [
      { s0: 662, s1: 668 }, { s0: 930, s1: 936 },             // yard corners
      { s0: 2380, s1: 2386 }, { s0: 2822, s1: 2828 },         // sweeper
    ],
  },
  /** Shortcut (spec §7/§20): an infield lane that skips the whole headland
   *  sweeper and re-joins the finishing straight before the line. ~100 m real
   *  saving (verified offline against the spline), its own lofted surface. */
  shortcut: {
    half: 3.9,
    pts: [
      [-448, 232, 9.9], [-424, 168, 8.4], [-392, 104, 6.7], [-352, 54, 5.2], [-302, 24, 3.9],
    ] as const,
  },
} as const
