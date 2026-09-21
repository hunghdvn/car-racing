import { assert, assertNear, test } from '../harness'
import {
  bucketFrames, heapTrend, inStretch, isDowngradeStep, nextLever, percentile, statsFor,
  DOWNGRADE_ORDER, GATE_P_STRETCHES, OPTIMIZATION_LADDER, type FrameSample,
} from '../../src/core/PerfPolicy'

/* Phase 9 headless units: the Gate-P sampling math, the stretch windows and
 * the mandated optimization ladder — the policy the perf harness and the
 * optimization passes are judged by. */

const frame = (o: Partial<FrameSample> & { dt: number }): FrameSample => ({
  t: 0, calls: 0, tris: 0, s: 0, zone: 'coastal', tier: 'high', phase: 'racing', ...o,
})

test('percentile: nearest-rank on unsorted input, empty-safe', () => {
  assertNear(percentile([10, 5, 1, 8, 3], 50), 5, 0.001, 'median of 5 values')
  assertNear(percentile([1, 2, 3, 4], 95), 4, 0.001, 'p95 of 4 values is the top rank')
  assertNear(percentile([2], 95), 2, 0.001, 'single value')
  assert(percentile([], 95) === 0, 'empty is 0')
  assertNear(percentile([5, 5, 5, 5, 5], 5), 5, 0.001, 'constant series')
})

test('statsFor: mean fps from frame deltas; p95 fps is the low-side rank', () => {
  const frames = []
  for (let i = 0; i < 92; i++) frames.push(frame({ dt: 16.667, calls: 300, tris: 500000 }))
  for (let i = 0; i < 8; i++) frames.push(frame({ dt: 100, calls: 900, tris: 900000 }))
  const s = statsFor(frames)
  assertNear(s.meanFps, (92 * 60 + 8 * 10) / 100, 0.5, 'mean fps mixes both populations')
  assertNear(s.mean, (92 * 16.667 + 8 * 100) / 100, 0.2, 'mean frame ms')
  assert(s.p95 >= 16.667 && s.p95 <= 100, `p95 ms in range (${s.p95})`)
  assertNear(s.meanCalls, (92 * 300 + 8 * 900) / 100, 1, 'mean draw calls')
  assert(s.p95Calls === 900, `p95 calls catches the spikes (${s.p95Calls})`)
  assert(statsFor([]).n === 0 && statsFor([]).mean === 0, 'empty stats are safe')
})

test('bucketFrames: full-lap counts only racing-phase frames; stretches honour window+zone', () => {
  const frames: FrameSample[] = [
    frame({ dt: 20, phase: 'countdown', s: 50, zone: 'start' }),
    frame({ dt: 17, s: 150, zone: 'coastal' }),
    frame({ dt: 17, s: 250, zone: 'coastal' }),
    frame({ dt: 18, s: 1100, zone: 'tunnel' }),
    frame({ dt: 18, s: 1500, zone: 'elevated' }),
    frame({ dt: 19, s: 1500, zone: 'industrial' }), // right station, wrong zone -> excluded
  ]
  const b = bucketFrames(frames)
  assert(b['full-lap'].n === 5, `full-lap excludes countdown (${b['full-lap'].n})`)
  assert(b['all-frames'].n === 6, 'all-frames keeps everything')
  assert(b.coast.n === 2 && b.tunnel.n === 1 && b.city.n === 1, `window+zone filters (${b.coast.n}/${b.tunnel.n}/${b.city.n})`)
})

test('stretch windows: cover the battery anchors and stay disjoint', () => {
  const anchors: Record<string, number> = { coast: 150, tunnel: 1005, city: 1520 }
  for (const w of GATE_P_STRETCHES) {
    assert(anchors[w.name] > w.s0 && anchors[w.name] < w.s1, `${w.name} window contains its battery anchor`)
    assert(inStretch(frame({ dt: 16, s: anchors[w.name], zone: w.zone }), w), `${w.name} anchor sample lands inside`)
  }
  const sorted = [...GATE_P_STRETCHES].sort((a, b) => a.s0 - b.s0)
  for (let i = 1; i < sorted.length; i++) assert(sorted[i].s0 > sorted[i - 1].s1, 'windows are disjoint and ordered')
})

test('heapTrend: least-squares slope of the GC-pressure samples', () => {
  const samples = []
  for (let i = 0; i < 100; i++) samples.push({ t: i * 16, usedMb: 100 + i * 0.05 }) // 3.125 MB/s
  const h = heapTrend(samples)
  assertNear(h.mbPerSec, (0.05 * 100) / (99 * 16 / 1000), 0.2, 'slope of the linear climb')
  assertNear(h.usedStartMb, 100, 0.001, 'start sample')
  assertNear(h.usedEndMb, 104.95, 0.01, 'end sample')
  assert(heapTrend([{ t: 0, usedMb: 5 }]).mbPerSec === 0, 'degenerate input is safe')
})

test('optimization ladder: next lever follows the mandated order exactly', () => {
  assert(nextLever([]) === 'profile', 'first lever is profile')
  assert(nextLever(['profile']) === 'batch/instance/merge', 'batching follows profiling')
  assert(nextLever(['profile', 'batch/instance/merge', 'cull']) === 'lod', 'LOD follows culling')
  assert(nextLever(OPTIMIZATION_LADDER.slice(0, 8)) === 'geometry simplification (non-Tier-1 only)', 'geometry is last')
  assert(nextLever([...OPTIMIZATION_LADDER]) === null, 'a spent ladder permits nothing more')
  // a skipped lever must not allow skipping ahead
  assert(nextLever(['profile', 'cull']) === 'batch/instance/merge', 'unapplied earlier levers stay pending')
})

test('downgrade order: effects before geometry; tier steps are single-rank', () => {
  assert(DOWNGRADE_ORDER.indexOf('shadow res') < DOWNGRADE_ORDER.indexOf('bloom strength'), 'shadows before bloom')
  assert(DOWNGRADE_ORDER.indexOf('bloom strength') < DOWNGRADE_ORDER.indexOf('dpr'), 'bloom before DPR')
  assert(DOWNGRADE_ORDER.indexOf('dpr') < DOWNGRADE_ORDER.indexOf('prop density'), 'DPR before density')
  assert(DOWNGRADE_ORDER[DOWNGRADE_ORDER.length - 1] === 'lod', 'geometry-side change last')
  assert(isDowngradeStep('high', 'medium') && isDowngradeStep('medium', 'low'), 'single-rank steps pass')
  assert(!isDowngradeStep('high', 'low'), 'rank skips are rejected')
  assert(!isDowngradeStep('low', 'high'), 'upgrades are not downgrades')
})
