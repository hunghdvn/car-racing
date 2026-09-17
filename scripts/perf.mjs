/**
 * Velocity Rush reproducible performance harness (Phase 9, Gate P).
 * Boots vite preview, drives the real race loop headlessly, and records raw
 * frame-chain evidence: per-frame dt, draw calls/triangles (gl.info over the
 * full composer chain), station/zone/phase tags, tier, JS heap, plus scene
 * census and a RE_RENDER_MODE-style render-cost bisect. Production paths are
 * untouched — the harness boots the dev-gated build (build/harness, __VR_
 * HARNESS__ on) and samples via the dev __perf* probes in src/dev/harness.ts
 * (same dev-harness class as __probe/__tally); the stats/bucketing math is the
 * bundled src/core/PerfPolicy.ts (single source of the Gate-P windows).
 *
 * Usage:
 *   node scripts/perf.mjs                                  # profile (census+drive+bisect)
 *   node scripts/perf.mjs --mode tiers                     # adaptive-tier demo
 *   node scripts/perf.mjs --mode lowbattery --tier low     # low-tier evidence
 * Options: --label NAME --runs N --seconds S --bisect N --poses a,b --tier T
 *          --nobisect  --timeout MS
 * Raw evidence: shots/perf_<label>.json
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { spawnSync, execSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildHarness, startPreview } from './_harness.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'shots')
mkdirSync(OUT, { recursive: true })

// ---- CLI -------------------------------------------------------------------
const argv = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return dflt
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : dflt
}
const flag = (name) => argv.includes(`--${name}`)
const MODE = opt('mode', 'profile')
const LABEL = opt('label', `${MODE}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`)
const RUNS = Number(opt('runs', '1'))
const SECONDS = Number(opt('seconds', '24'))
const BISECT_N = Number(opt('bisect', '36'))
const POSES = (opt('poses', 'section_city,section_tunnel,section_coastal,tunnel_contrast,section_elevated,section_final')).split(',')
const TIER = opt('tier', 'low')
const DRIVE_TIMEOUT = Number(opt('timeout', '300000'))
const STRETCH_SECONDS = Number(opt('stretch-seconds', '360'))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- policy module (bundled from src: single source of bucketing math) ----
const { build } = await import('esbuild')
const POLICY_OUT = resolve(ROOT, 'build/perf/policy.mjs')
mkdirSync(resolve(ROOT, 'build/perf'), { recursive: true })
await build({
  entryPoints: [resolve(ROOT, 'src/core/PerfPolicy.ts')],
  bundle: true,
  outfile: POLICY_OUT,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent',
})
const { bucketFrames, heapTrend, GATE_P_STRETCHES } = await import(pathToFileURL(POLICY_OUT))

// ---- browser discovery (mirrors shots.mjs) --------------------------------
async function findChromium() {
  const { chromium } = await import('playwright')
  try {
    const exec = chromium.executablePath()
    if (exec && existsSync(exec)) return chromium
  } catch { /* not installed under default registry path */ }
  const cache = resolve(process.env.HOME || '~', 'Library/Caches/ms-playwright')
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache)) {
      if (!dir.startsWith('chromium')) continue
      const p = resolve(cache, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium')
      const p2 = resolve(cache, dir, 'chrome-mac-headless-shell/Chromium Headless Shell.app/Contents/MacOS/Chromium Headless Shell')
      for (const cand of [p, p2]) if (existsSync(cand)) return chromium
    }
  }
  return null
}
let chromium = await findChromium()
if (!chromium) {
  console.log('[perf] chromium missing — installing (environment-aware fallback)')
  spawnSync('npx', ['--yes', 'playwright', 'install', 'chromium'], { stdio: 'inherit' })
  chromium = (await import('playwright')).chromium
}

// ---- serve the dev-harness build (the shipped dist/ has the harness stripped) --
const BASE_PORT = 4519
const OUTDIR = buildHarness(ROOT)
const prev = startPreview(ROOT, OUTDIR, BASE_PORT)
const probeUp = async () => { for (let i = 0; i < 80; i++) { try { const res = await fetch(prev.url); if (res.ok) return true } catch { /* retry */ } await wait(300) } return false }
let up = await probeUp()
if (!up) { await prev.restartOnBusy(); up = await probeUp() }
if (!up) { console.error('[perf] preview server did not come up'); prev.close(); process.exit(1) }
const url = `${prev.url}/?` + (process.env.SHOT_QUERY ?? '')

// --gpu switches to the headed ANGLE/Metal configuration (Playwright's
// headless shell is locked to SwiftShader CPU rasterization — proven via CDP
// SystemInfo, see the Phase 9 report). Visual-capture modes keep the
// battery-matched SwiftShader stack; Gate-P frame-rate evidence uses the GPU.
const GPU = flag('gpu')
const CHROME_ARGS = GPU
  ? ['--enable-unsafe-experimental-webgpu-discard', '--enable-precise-memory-info']
  : ['--use-angle=1', '--enable-unsafe-experimental-webgpu-discard', '--enable-precise-memory-info']
const browser = await chromium.launch({ headless: !GPU, args: CHROME_ARGS })
const cdpBrowser = await browser.newBrowserCDPSession()
const sysInfo = await cdpBrowser.send('SystemInfo.getInfo').catch(() => null)
const gpuDevice = sysInfo?.gpu?.devices?.[0]?.deviceString ?? null
const displayType = sysInfo?.gpu?.auxAttributes?.displayType ?? null
console.log(`[perf] rendering stack: ${displayType ?? 'unknown'} — ${gpuDevice ?? 'unknown'}`)
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[page error]', String(e).slice(0, 500)))
page.on('console', (m) => { if (m.type() === 'error') console.log(`[console ${m.type()}]`, m.text().slice(0, 300)) })
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction('window.__vr && window.__vr.ready', null, { timeout: 30000 })
await page.waitForFunction('window.__probe && window.__probe().loadingHidden', null, { timeout: 40000 })
await page.evaluate(() => new Promise((r) => setTimeout(r, 500)))

/** Tier-call recorder/suppressor on Renderer.prototype (harness-side only). */
const DIAG_INSTALL = () => {
  const R = window.__dbg.Renderer
  if (!R.prototype.__tierPatched) {
    const orig = R.prototype.setTier
    R.prototype.setTier = function (t) {
      const prev = this.tier
      const manual = !!this.__manualTier
      ;(window).__tierEvents = (window).__tierEvents || []
      if (window.__tierSuppress && !manual) {
        ;(window).__tierEvents.push({ at: Math.round(performance.now()), from: prev, to: t, manual: false, suppressed: true })
        return
      }
      orig.call(this, t)
      const sz = this.gl.getDrawingBufferSize(new (window.__dbg.THREE.Vector2)())
      ;(window).__tierEvents.push({ at: Math.round(performance.now()), from: prev, to: t, manual, suppressed: false, snap: { tier: this.tier, pixelRatio: +this.gl.getPixelRatio().toFixed(3), drawing: `${sz.x}x${sz.y}`, shadowMap: this.sun.shadow.mapSize.x, bloom: +this.bloom.strength.toFixed(3) } })
    }
    R.prototype.__tierPatched = true
  }
  window.__tierEvents = []
}

/** "Slow device" emulation (harness-side only): floor the wall-clock delta the
 *  production frame loop reads from THREE.Clock, by busy-waiting until each
 *  frame's real cadence reaches `window.__slowMs`. This makes the UNMODIFIED
 *  Renderer sampler observe a genuine, sustained frame-budget overrun (its
 *  emaFrameMs is an EMA of that real dt), so the adaptive ladder exercises
 *  itself exactly as it would on under-powered hardware. No production logic,
 *  threshold, or tier value is overridden here — the policy decides; we only
 *  slow the clock it measures. Gated per-run via window.__slowMs (0 = off). */
const SLOW_INSTALL = () => {
  const C = window.__dbg.THREE.Clock.prototype
  if (!C.__slowPatched) {
    const orig = C.getDelta
    C.getDelta = function () {
      const target = window.__slowMs || 0
      if (target > 0) {
        const t0 = performance.now()
        while (performance.now() - t0 < target) { /* hold the frame open */ }
      }
      return orig.call(this)
    }
    C.__slowPatched = true
  }
  window.__slowMs = 0
}

/** Harness-side autopilot: patches the Input INSTANCE's poll() (never the
 *  class, never shipped code) with the same pilot laws the headless lap-bot
 *  unit test uses (tests/rig.ts laneSteer/cornerTarget), so the sustained
 *  drive actually corners instead of grinding a barrier. Throttle-hold alone
 *  is not a drive protocol. */
const AUTOPILOT_INSTALL = () => {
  const g = window.__dbg.game
  const ip = g.input
  if (!ip.__origPoll) {
    ip.__origPoll = ip.poll.bind(ip)
    ip.poll = (dt) => {
      const st = ip.__origPoll(dt)
      if (!window.__AP || g.director.phase !== 'racing') return st
      const p = g.player.phys
      const spline = g.slice.spline
      const n = spline.nearest(p.x, p.z)
      const f = spline.frame(n.s + 6 + p.speed * 0.42)
      const lat = (p.x - f.pos.x) * f.side.x + (p.z - f.pos.z) * f.side.z
      let he = p.yaw - f.yaw
      he %= Math.PI * 2
      if (he > Math.PI) he -= Math.PI * 2
      if (he < -Math.PI) he += Math.PI * 2
      st.steer = Math.max(-1, Math.min(1, he * 2.1 - lat * 0.115))
      let minV = 57 * 0.92
      for (const k of [0.25, 0.5, 0.75]) {
        const ff = spline.frame(n.s + 6 + p.speed * k)
        const c = Math.abs(ff.curv)
        if (c > 1e-4) { const v = Math.sqrt((14.2 * 0.78) / c); if (v < minV) minV = v }
      }
      minV = Math.max(10.5, minV)
      if (p.speed > minV + 1.5) { st.throttle = 0; st.brake = 1 }
      else { st.throttle = 1; st.brake = 0 }
      st.handbrake = false
      st.nitro = false
      return st
    }
  }
  window.__AP = true
}
const AUTOPILOT_OFF = () => { window.__AP = false }

/** Snap the whole field onto the racing line at the stretch approach. */
const SNAP_FIELD = (startS) => {
  const g = window.__dbg.game
  g.spawnAt(startS, 45)
  for (let i = 0; i < g.ai.length; i++) {
    const lat = ((i % 2) * 2 - 1) * 1.55
    g.ai[i].resetTo(startS - (i + 1) * 10, lat, 42)
  }
}

/** Sustained full-throttle drive through the live race loop.
 *  untilFinish: stop at the chequered flag (full lap) else stop on the clock.
 *  stretch {start, exit}: snap the field at `start`, sample from there until
 *  the player passes `exit` (station-guarded; countdown never sampled). */
async function driveOnce({ suppress, untilFinish, seconds, stretch, slowMs = 0 }) {
  await page.evaluate(AUTOPILOT_INSTALL)
  await page.evaluate(SLOW_INSTALL)
  await page.evaluate(({ suppress: s }) => {
    window.__tierSuppress = s
    window.__tierEvents = []
  }, { suppress })
  await page.evaluate(() => {
    const g = window.__dbg.game
    const ph = window.__raceState().phase
    if (ph === 'racing' || ph === 'countdown') { g.ui.raceStarted(); g.restartRace() }
    else window.__startRace()
    return window.__raceState().phase
  })
  if (stretch) {
    // let the flag drop first (countdown frames are not drive evidence)
    for (let g = 0; g < 200; g++) {
      const ph = await page.evaluate(() => window.__raceState().phase)
      if (ph === 'racing') break
      await wait(250)
    }
    await page.evaluate(SNAP_FIELD, stretch.start)
    await wait(600)
  }
  await page.evaluate((ms) => { window.__slowMs = ms }, slowMs)
  await page.evaluate(() => window.__perfStart())
  const t0 = Date.now()
  let phaseEnd = 'unknown'
  let censusMid = null
  try {
    for (;;) {
      await wait(150)
      const st = await page.evaluate(() => ({ ph: window.__raceState().phase, z: window.__perfZone() }))
      const elapsed = Date.now() - t0
      if (st.ph === 'finished' && elapsed > 4000) { phaseEnd = 'finished'; break }
      phaseEnd = st.ph
      if (stretch && st.z.phase === 'racing' && !censusMid && st.z.s > (stretch.start + stretch.exit) / 2) {
        censusMid = await page.evaluate(() => {
          const t = window.__tally()
          const roots = {}
          for (const [k, v] of Object.entries(t)) if (v.meshes) roots[k] = { meshes: v.meshes, tris: v.tris }
          return roots
        })
      }
      if (stretch && st.z.phase === 'racing' && st.z.s > stretch.exit) break
      if (elapsed > (untilFinish ? DRIVE_TIMEOUT : seconds * 1000)) break
    }
  } finally {
    await page.evaluate(() => { window.__slowMs = 0 })
    await page.evaluate(() => window.__perfStop?.())
  }
  const out = await page.evaluate(() => ({
    frames: window.__perfFrames,
    heap: window.__perfHeap,
    tierEvents: window.__tierEvents,
    diag: window.__perfDiag(),
    car: window.__carState(),
  }))
  return { ...out, phaseEnd, driveWallMs: Date.now() - t0, censusMid }
}

const r1 = (v) => Math.round(v * 10) / 10
/** Bucketed one-line summary per stretch. */
function summarize(rec) {
  const stats = bucketFrames(rec.frames)
  return {
    stats,
    heap: rec.heap && rec.heap.length >= 2 ? heapTrend(rec.heap) : { note: 'performance.memory unavailable', n: (rec.heap || []).length },
    tierEvents: rec.tierEvents,
    tierSeen: [...new Set(rec.frames.map((f) => f.tier))],
    phaseSeen: [...new Set(rec.frames.map((f) => f.phase))],
    diagEnd: rec.diag,
    carEnd: rec.car,
    phaseEnd: rec.phaseEnd,
    driveWallMs: rec.driveWallMs,
    censusMid: rec.censusMid ?? null,
  }
}
function logRun(tag, s) {
  for (const [k, v] of Object.entries(s.stats)) {
    if (!v.n) continue
    console.log(`  [${tag} ${k}] n=${v.n} meanFps=${r1(v.meanFps)} p95Fps=${r1(v.p95Fps)} mean=${r1(v.mean)}ms p95=${r1(v.p95)}ms p99=${r1(v.p99)}ms calls=${v.meanCalls}/${v.p95Calls} tris=${v.meanTris}/${v.p95Tris}`)
  }
  console.log(`  [${tag} heap] ${JSON.stringify(s.heap)} tiers=${JSON.stringify(s.tierSeen)} phaseEnd=${s.phaseEnd} wall=${s.driveWallMs}ms`)
}

/** RE_RENDER_MODE cost bisect: per-mode synchronous render cost on frozen
 *  battery poses (0 full, 1 scene-only, 2 no-bloom, 3 bloom-strength-0,
 *  4 no-shadow). Modes interleaved across reps to spread thermal/boost drift. */
const MODES = [0, 1, 2, 3, 4]
const MODE_NAME = ['full', 'scene', 'nobloom', 'bloom0', 'noshadow']
async function bisect(poses, n) {
  const results = {}
  for (const pose of poses) {
    const raw = {}
    for (const m of MODES) raw[m] = []
    for (let rep = 0; rep < 3; rep++) {
      for (const m of MODES) {
        const s = await page.evaluate((a) => (async () => {
          const view = window.__dbg.game.view
          window.__vr.poseShot(a.pose)
          const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
          await frame()
          const out = []
          for (let i = 0; i < a.n; i++) {
            const t0 = performance.now()
            view.render(a.m)
            out.push(Math.round((performance.now() - t0) * 100) / 100)
            await frame()
          }
          return out
        })(), { pose, m, n })
        raw[m].push(...s)
      }
    }
    await page.evaluate(() => window.__vr.releasePose())
    await wait(200)
    results[pose] = {}
    for (const m of MODES) {
      const v = [...raw[m]].sort((a, b) => a - b)
      results[pose][`m${m}:${MODE_NAME[m]}`] = { n: v.length, medianMs: v[Math.floor(v.length / 2)] ?? 0, p95Ms: v[Math.max(0, Math.ceil(v.length * 0.95) - 1)] ?? 0 }
    }
    const row = MODES.map((m) => `${MODE_NAME[m]}=${results[pose][`m${m}:${MODE_NAME[m]}`].medianMs}`).join(' ')
    console.log(`  ${pose.padEnd(20)} ${row}`)
  }
  return results
}

// ---- modes ------------------------------------------------------------------
async function profileMode(report) {
  await page.evaluate(DIAG_INSTALL)
  report.census = await page.evaluate(() => {
    const t = window.__tally()
    const roots = {}
    for (const [k, v] of Object.entries(t)) if (v.meshes) roots[k] = { meshes: v.meshes, tris: v.tris }
    return {
      byRoot: roots,
      totalMeshes: Object.values(roots).reduce((a, b) => a + b.meshes, 0),
      totalTris: Object.values(roots).reduce((a, b) => a + b.tris, 0),
    }
  })
  console.log(`[perf] census: ${report.census.totalMeshes} visible meshes / ${report.census.totalTris} tris (whole scene)`)
  report.runs = []
  for (let i = 0; i < RUNS; i++) {
    console.log(`[perf] sustained drive run ${i + 1}/${RUNS} (full lap, autopilot pilot, auto-degrade suppressed)`)
    const rec = await driveOnce({ suppress: true, untilFinish: true, seconds: SECONDS })
    const s = summarize(rec)
    report.runs.push(s)
    logRun(`run${i + 1}`, s)
    await wait(500)
  }
  if (!flag('nostretches')) {
    report.stretches = {}
    for (const w of GATE_P_STRETCHES) {
      console.log(`[perf] stretch drive: ${w.name} (s ${w.s0}..${w.s1}, zone ${w.zone})`)
      const rec = await driveOnce({ suppress: true, untilFinish: false, seconds: STRETCH_SECONDS, stretch: { start: w.s0 - 45, exit: w.s1 + 55 } })
      const s = summarize(rec)
      report.stretches[w.name] = s
      logRun(`stretch:${w.name}`, s)
      await wait(400)
    }
  }
  if (flag('nobisect')) return
  console.log('[perf] render-mode cost bisect (frozen battery poses, interleaved)')
  report.bisect = await bisect(POSES, BISECT_N)
}

async function tiersMode(report) {
  await page.evaluate(DIAG_INSTALL)
  const city = GATE_P_STRETCHES.find((w) => w.name === 'city')
  const STRETCH = { start: city.s0 - 45, exit: city.s1 + 400 }
  /* Frame-budget pressure: a harness "slow device" floor (see SLOW_INSTALL)
     holds each frame's real wall-clock delta to SLOW_MS so the UNMODIFIED
     Renderer sampler crosses its own >19.2ms / >2.6s downgrade gate exactly as
     it would on under-powered hardware. The ladder is decided by production
     code; the harness only slows the clock it measures. */
  const SLOW_MS = 26
  report.stress = { method: 'clock-floor', slowMs: SLOW_MS, gate: { emaMs: 19.2, lowForS: 2.6, cooldownMs: 4000 } }
  console.log(`[perf] tiers: natural pressure run on the city stretch (auto-degrade live, ${SLOW_MS}ms/frame floor)`)
  const nat = await driveOnce({ suppress: false, untilFinish: false, seconds: 45, stretch: STRETCH, slowMs: SLOW_MS })
  report.natural = summarize(nat)
  report.naturalSampler = await page.evaluate(() => { const v = window.__dbg.game.view; return { ready: v.ready, emaMs: +v.emaFrameMs.toFixed(1), lowFor: +v.lowFor.toFixed(2), tier: v.tier, drawing: (() => { const s = v.gl.getDrawingBufferSize(new (window.__dbg.THREE.Vector2)()); return `${s.x}x${s.y}` })() } })
  console.log(`  sampler after natural: ${JSON.stringify(report.naturalSampler)}`)
  console.log(`  tiers seen: ${JSON.stringify(report.natural.tierSeen)}  real events: ${JSON.stringify(nat.tierEvents.filter((e) => !e.suppressed))}`)
  await page.evaluate(() => { window.__dbg.game.ui.showTitle(); const v = window.__dbg.game.view; v.__manualTier = true; v.setTier('high'); v.__manualTier = false })
  await wait(400)
  console.log('[perf] tiers: suppression run on the same stretch, identical frame floor (downgrade suppressible)')
  const sup = await driveOnce({ suppress: true, untilFinish: false, seconds: 45, stretch: STRETCH, slowMs: SLOW_MS })
  report.suppression = summarize(sup)
  report.suppressionSampler = await page.evaluate(() => { const v = window.__dbg.game.view; return { ready: v.ready, emaMs: +v.emaFrameMs.toFixed(1), lowFor: +v.lowFor.toFixed(2), tier: v.tier } })
  console.log(`  sampler after suppression: ${JSON.stringify(report.suppressionSampler)}`)
  console.log(`  tiers seen: ${JSON.stringify(report.suppression.tierSeen)}  suppressed-count: ${sup.tierEvents.filter((e) => e.suppressed).length}`)
  await wait(400)
  console.log('[perf] tiers: manual high -> medium -> low with QUALITY verification')
  report.manual = await page.evaluate(() => {
    const view = window.__dbg.game.view
    const snap = () => {
      const d = window.__perfDiag()
      return { tier: d.tier, pixelRatio: d.pixelRatio, drawing: d.drawing, shadowMap: d.shadowMap, bloom: d.bloom }
    }
    const out = { expected: window.__dbg.QUALITY, steps: [] }
    for (const t of ['high', 'medium', 'low']) {
      view.__manualTier = true
      view.setTier(t)
      view.__manualTier = false
      out.steps.push({ requested: t, snap: snap() })
    }
    return out
  })
  console.log(`  expected: ${JSON.stringify(report.manual.expected)}`)
  for (const s of report.manual.steps) console.log(`  ${s.requested}: ${JSON.stringify(s.snap)}`)
}

async function lowBatteryMode(report) {
  await page.evaluate(DIAG_INSTALL)
  await page.evaluate(({ tier }) => {
    const view = window.__dbg.game.view
    window.__tierSuppress = true
    view.__manualTier = true
    view.setTier(tier)
    view.__manualTier = false
  }, { tier: TIER })
  report.tierDiag = await page.evaluate(() => window.__perfDiag())
  console.log(`[perf] lowbattery: applied tier diag ${JSON.stringify(report.tierDiag)}`)
  report.shots = []
  for (const pose of POSES) {
    const dataUrl = await page.evaluate((p) => window.__vr.shot(p), pose)
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png')) {
      const file = `perf_${TIER}_${pose}.png`
      writeFileSync(join(OUT, file), Buffer.from(dataUrl.split(',')[1], 'base64'))
      report.shots.push({ pose, file })
      console.log(`[perf] wrote shots/${file}`)
    } else {
      report.shots.push({ pose, file: null })
      console.log(`[perf] ${pose}: no image (${String(dataUrl).slice(0, 60)})`)
    }
  }
  await page.evaluate(() => window.__vr.releasePose())
  await wait(300)
  console.log('[perf] lowbattery: sustained low-tier stretch drives (city/tunnel/coast)')
  report.lowStretch = {}
  for (const w of GATE_P_STRETCHES) {
    const rec = await driveOnce({ suppress: true, untilFinish: false, seconds: STRETCH_SECONDS, stretch: { start: w.s0 - 45, exit: w.s1 + 55 } })
    const s = summarize(rec)
    report.lowStretch[w.name] = s
    logRun(`low:${w.name}`, s)
    await wait(400)
  }
}

// ---- run --------------------------------------------------------------------
const report = {
  label: LABEL,
  mode: MODE,
  when: new Date().toISOString(),
  gitHead: execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
  gitDirty: execSync('git status --porcelain', { cwd: ROOT }).toString().trim().length > 0,
  stack: `${GPU ? 'headed' : 'headless'}: ${displayType ?? 'stack unknown'} — ${gpuDevice ?? 'device unknown'}`,
  gpuDevice: gpuDevice,
  displayType: displayType,
  env: {
    ua: await page.evaluate(() => navigator.userAgent),
    dpr: await page.evaluate(() => window.devicePixelRatio),
    viewport: '1280x720 dsf1',
    chromeArgs: CHROME_ARGS,
    headless: !GPU,
  },
  probe: await page.evaluate(() => window.__probe()),
  diag: await page.evaluate(() => window.__perfDiag()),
}
console.log(`[perf] env gpu: ${JSON.stringify(report.diag.gpu)}`)
console.log(`[perf] probe: ${JSON.stringify(report.probe)}`)

try {
  if (MODE === 'profile') await profileMode(report)
  else if (MODE === 'tiers') await tiersMode(report)
  else if (MODE === 'lowbattery') await lowBatteryMode(report)
  else throw new Error(`unknown mode ${MODE}`)
} finally {
  const file = join(OUT, `perf_${LABEL}.json`)
  writeFileSync(file, JSON.stringify(report, null, 1))
  console.log(`[perf] wrote ${file}`)
  if (browser) { try { await browser.close() } catch { /* best effort */ } }
  prev.close()
}
