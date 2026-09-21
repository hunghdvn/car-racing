/* ------------------------------------------------------------------------- *
 * Gate P measurement policy + rolling-sample math (Phase 9).
 *
 * Dual-use module: the node perf harness bundles this with esbuild for the
 * bucketed stats it reports, and the in-page sampler produces the same
 * `FrameSample` row shape from the dev `__perfDiag()` probe. Pure data only
 * — no DOM, no renderer imports — so the sampling math is unit-testable and
 * the Gate-P segment windows live in exactly one place.
 *
 * Segment windows are anchored to the approved §22 battery stations
 * (main.ts: sec('section_coastal',150) / sec('section_tunnel',1005) /
 * sec('section_elevated',1520)) and narrowed to the road corridor so they
 * measure the same stretches that the visual battery judges.
 * ------------------------------------------------------------------------- */

export interface FrameSample {
  /** performance.now() timestamp of the sample (ms) */
  t: number
  /** frame delta to the previous sample (ms) — first row is 0 */
  dt: number
  /** draw calls of the last completed composer chain (gl.info, whole chain) */
  calls: number
  /** triangles of the last completed composer chain */
  tris: number
  /** spline station of the player at the sample instant (m) */
  s: number
  /** zone tag of the player position ('coastal' | 'tunnel' | 'elevated' | …) */
  zone: string
  /** adaptive quality tier active at the sample instant */
  tier: string
  /** race director phase at the sample instant ('countdown' | 'racing' | …) */
  phase: string
}

export interface SampleStats {
  n: number
  mean: number
  median: number
  p95: number
  p99: number
  max: number
  meanFps: number
  p95Fps: number
  meanCalls: number
  p95Calls: number
  meanTris: number
  p95Tris: number
}

/** Nearest-rank percentile over an ascending-sorted copy. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * s.length))
  return s[Math.min(s.length - 1, rank - 1)]
}

const meanOf = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Summary stats for a stretch's worth of frame samples. */
export function statsFor(frames: readonly FrameSample[]): SampleStats {
  const dts = frames.map((f) => f.dt)
  const fps = dts.filter((d) => d > 0).map((d) => 1000 / d)
  return {
    n: frames.length,
    mean: meanOf(dts),
    median: percentile(dts, 50),
    p95: percentile(dts, 95),
    p99: percentile(dts, 99),
    max: dts.length ? Math.max(...dts) : 0,
    meanFps: meanOf(fps),
    p95Fps: percentile(fps, 5),
    meanCalls: Math.round(meanOf(frames.map((f) => f.calls))),
    p95Calls: Math.round(percentile(frames.map((f) => f.calls), 95)),
    meanTris: Math.round(meanOf(frames.map((f) => f.tris))),
    p95Tris: Math.round(percentile(frames.map((f) => f.tris), 95)),
  }
}

/** One named Gate-P stretch: spline-station window + zone guard. */
export interface StretchWindow {
  name: string
  s0: number
  s1: number
  zone: string
  /** |lat|-ish corridor guard: frames whose s lands on a spur branch outside
   *  the main-line corridor are excluded by the node harness via `station` */
  maxLat?: number
}

/** The three Gate-P stretches (brief: city + tunnel + coast). */
export const GATE_P_STRETCHES: readonly StretchWindow[] = [
  { name: 'coast', s0: 100, s1: 300, zone: 'coastal' },
  { name: 'tunnel', s0: 980, s1: 1250, zone: 'tunnel' },
  { name: 'city', s0: 1280, s1: 2060, zone: 'elevated', maxLat: 18 },
]

/** True when the sample belongs to the stretch window. */
export function inStretch(f: FrameSample, w: StretchWindow): boolean {
  return f.s >= w.s0 && f.s <= w.s1 && f.zone === w.zone
}

/** Bucket a full-lap recording into per-stretch + whole-run stats.
 *  `full-lap` only counts frames captured while the director is 'racing'
 *  (countdown/finished frames are car-stationary presentation, not drive). */
export function bucketFrames(frames: readonly FrameSample[]): Record<string, SampleStats> {
  const racing = frames.filter((f) => f.phase === 'racing')
  const out: Record<string, SampleStats> = { 'full-lap': statsFor(racing), 'all-frames': statsFor(frames) }
  for (const w of GATE_P_STRETCHES) out[w.name] = statsFor(racing.filter((f) => inStretch(f, w)))
  return out
}

export interface HeapTrend {
  /** MB/s least-squares slope of usedJSHeapSize over the window */
  mbPerSec: number
  usedStartMb: number
  usedEndMb: number
  n: number
}

/** Least-squares MB/s slope of heap-usage samples (GC-pressure indicator). */
export function heapTrend(samples: readonly { t: number; usedMb: number }[]): HeapTrend {
  if (samples.length < 2) return { mbPerSec: 0, usedStartMb: 0, usedEndMb: 0, n: samples.length }
  const t0 = samples[0].t
  const xs = samples.map((p) => (p.t - t0) / 1000)
  const ys = samples.map((p) => p.usedMb)
  const mx = meanOf(xs), my = meanOf(ys)
  let num = 0, den = 0
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  return { mbPerSec: den > 0 ? num / den : 0, usedStartMb: ys[0], usedEndMb: ys[ys.length - 1], n: samples.length }
}

/* ---------------------------------------------------------------------------
 * Mandated optimization order (brief Phase 9 / spec §12 downgrade path).
 * `optimizationLadder` is the profile→act gate: a later lever may only be
 * applied once the evidence shows every earlier lever was profiled and was
 * insufficient or inapplicable. `downgradeOrder` is the adaptive runtime
 * ladder (spec §12: detail geometry is LAST, effects are trimmed FIRST).
 * ------------------------------------------------------------------------- */

export const OPTIMIZATION_LADDER = [
  'profile',
  'batch/instance/merge',
  'cull',
  'lod',
  'reduce particles/effects',
  'shadow resolution',
  'bloom strength',
  'dpr',
  'geometry simplification (non-Tier-1 only)',
] as const

export type LadderLever = (typeof OPTIMIZATION_LADDER)[number]

/** The next lever permitted after `applied` (null once the ladder is spent). */
export function nextLever(applied: readonly LadderLever[]): LadderLever | null {
  for (const lever of OPTIMIZATION_LADDER) if (!applied.includes(lever)) return lever
  return null
}

/** Adaptive runtime downgrade order (spec §12) — effects first, geometry last. */
export const DOWNGRADE_ORDER = ['shadow res', 'bloom strength', 'dpr', 'prop density', 'lod'] as const

/** True when going from tier `a` to tier `b` follows the downgrade order. */
export function isDowngradeStep(a: string, b: string): boolean {
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 }
  return (rank[a] ?? -1) >= 0 && (rank[b] ?? -1) === (rank[a] ?? -1) + 1
}
