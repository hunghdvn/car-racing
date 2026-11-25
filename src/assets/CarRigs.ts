import type { CarId } from '../vehicles/CarSpecs'

/**
 * Per-car runtime rig table for the real-model GLBs (spec §5, Task 4 output).
 * Every number here was MEASURED by scripts/optimize-cars.mjs on the committed
 * public/models/<id>.glb — never hand-edit: rerun the pipeline and paste the
 * printed rig block. The pipeline also drops build/cars/<id>.report.json with
 * the same literals plus the triangle audit.
 */
export interface CarRig {
  /** [fl, fr, rl, rr] metres — per-corner visual/spin radius (tyres differ L/R) */
  wheelRadius: [number, number, number, number]
  /** [fl, fr, rl, rr] hub centres in MODEL space (nose convention: −z forward) */
  wheelPos: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]]
  /** body min-Y when parked on the wheels (m); negative = splitter dips below road */
  groundClearance: number
  /** per-car brake caliper tint (mirrors the kit hex, pinned as catalog literal) */
  caliperColor: number
  /** true → no paint-* materials in the GLB, garage swatches keep author colours */
  bakedPaint: boolean
  /** add emissive glow planes over baked lamp textures */
  lampGlow: boolean
  /** front badge decal position (normalised m) */
  logoAnchor: [number, number, number]
  /** nitro flame origins, [left, right], at the tail (+z) */
  nitroAnchor: [[number, number, number], [number, number, number]]
}

/* Literals below are pasted from the pipeline rig output
 * (node scripts/optimize-cars.mjs <id> → prints the ready-to-paste block). */
export const CAR_RIGS: Record<CarId, CarRig> = {
  r34: {
    wheelRadius: [0.32, 0.32, 0.32, 0.32],
    wheelPos: [[0.702, 0.32, -1.315], [-0.702, 0.32, -1.315], [0.702, 0.32, 1.315], [-0.702, 0.32, 1.315]],
    groundClearance: 0.093, caliperColor: 0xc23a28, bakedPaint: false, lampGlow: true,
    logoAnchor: [0, 0.443, -2.125], nitroAnchor: [[-0.18, 0.176, 2.225], [0.18, 0.176, 2.225]],
  },
  '930': {
    wheelRadius: [0.34, 0.34, 0.334, 0.334],
    wheelPos: [[0.802, 0.334, -1.194], [-0.802, 0.334, -1.215], [0.823, 0.334, 1.205], [-0.823, 0.334, 1.205]],
    groundClearance: 0.094, caliperColor: 0x39c06a, bakedPaint: false, lampGlow: true,
    logoAnchor: [0, 0.444, -2.125], nitroAnchor: [[-0.18, 0.176, 2.225], [0.18, 0.176, 2.225]],
  },
  s15: {
    wheelRadius: [0.262, 0.262, 0.248, 0.248],
    wheelPos: [[-0.807, 0.263, -1.271], [0.807, 0.263, -1.271], [-0.805, 0.272, 1.271], [0.805, 0.272, 1.271]],
    groundClearance: -0.036, caliperColor: 0xf27a1e, bakedPaint: false, lampGlow: true,
    logoAnchor: [0, 0.314, -2.125], nitroAnchor: [[-0.18, 0.098, 2.225], [0.18, 0.098, 2.225]],
  },
  centenario: {
    wheelRadius: [0.326, 0.326, 0.345, 0.345],
    wheelPos: [[0.785, 0.332, -1.217], [-0.782, 0.332, -1.242], [0.774, 0.345, 1.23], [-0.777, 0.345, 1.23]],
    groundClearance: -0.042, caliperColor: 0xe8b62e, bakedPaint: false, lampGlow: true,
    logoAnchor: [0, 0.308, -2.125], nitroAnchor: [[-0.18, 0.095, 2.225], [0.18, 0.095, 2.225]],
  },
  terzo: {
    wheelRadius: [0.312, 0.312, 0.331, 0.331],
    wheelPos: [[0.857, 0.311, -1.332], [-0.852, 0.311, -1.332], [0.812, 0.338, 1.332], [-0.817, 0.338, 1.332]],
    groundClearance: 0.025, caliperColor: 0xc23a28, bakedPaint: false, lampGlow: true,
    logoAnchor: [0, 0.375, -2.125], nitroAnchor: [[-0.18, 0.135, 2.225], [0.18, 0.135, 2.225]],
  },
  carrera: {
    wheelRadius: [0.351, 0.351, 0.341, 0.341],
    wheelPos: [[0.776, 0.342, -1.23], [-0.771, 0.342, -1.307], [0.778, 0.342, 1.268], [-0.783, 0.342, 1.268]],
    groundClearance: 0.098, caliperColor: 0xf2d21c, bakedPaint: false, lampGlow: true,
    logoAnchor: [0, 0.448, -2.125], nitroAnchor: [[-0.18, 0.179, 2.225], [0.18, 0.179, 2.225]],
  },
}
