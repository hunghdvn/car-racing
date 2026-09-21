/**
 * Phase 10 no-leak boot validation (spec §18/§23.4; plan graybox "debug tooling
 * off by default"; Phase 10 brief no-leak contract).
 *
 * The no-leak AUTHORITY is the shipped build, not a dev probe. This driver builds
 * the PRODUCTION bundle (`npm run build`, `__VR_HARNESS__`=false → the harness is
 * dead-code-eliminated out of `dist/`) and then boots it headlessly through the
 * real loading → title → race flow, asserting:
 *   1. none of the forbidden debug globals exist on the shipped window,
 *   2. the shipped scene exposes no harness board names via any global,
 *   3. the game reaches the title and a click on START runs the race with no
 *      fatal overlay — i.e. the shipped build boots AND plays without relying on
 *      any dev-only entry path,
 *   4. the production asset bytes carry no debug-global token strings.
 *
 * Exits non-zero (so CI / the brief loop can gate on it) if any assertion fails.
 * Usage: node scripts/noleak.mjs
 */
import { spawnSync, spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const FORBIDDEN = [
  '__vr', '__dbg', '__probe', '__tally', '__perfStart', '__perfStop', '__perfDiag',
  '__perfZone', '__perfRenderSet', '__perfFrames', '__perfHeap', '__bisect',
  '__tireDbg', '__wheelScan', '__carInfo', '__carState', '__raceState', '__startRace',
  '__densityAudit', '__buildMs',
]
const BOARD_NAMES = ['board-buildings', 'board-props', 'board-vegetation']

// ---- build the clean production bundle (harness folded out of dist/) --------
console.log('[noleak] building the production bundle (no harness)…')
const br = spawnSync('npm', ['run', '--silent', 'build'], { cwd: ROOT, stdio: 'ignore' })
if (br.status !== 0) { console.error('[noleak] production build failed'); process.exit(1) }

// ---- static asset grep: the shipped bytes must not carry any debug token -----
const assetsDir = resolve(ROOT, 'dist', 'assets')
let assetLeaks = 0
for (const f of readdirSync(assetsDir)) {
  const txt = readFileSync(resolve(assetsDir, f), 'utf8')
  for (const g of FORBIDDEN) if (txt.includes(g)) { console.error(`[noleak] ASSET LEAK ${f} contains ${g}`); assetLeaks++ }
  for (const b of BOARD_NAMES) if (txt.includes(b)) { console.error(`[noleak] ASSET LEAK ${f} contains board ${b}`); assetLeaks++ }
  if (txt.includes('std-replace')) { console.error(`[noleak] ASSET LEAK ${f} contains dev std-replace material`); assetLeaks++ }
  if (txt.includes('nomerge')) { console.error(`[noleak] ASSET LEAK ${f} contains nomerge lever`); assetLeaks++ }
}
console.log(`[noleak] static asset grep: ${assetLeaks} leaks across ${readdirSync(assetsDir).length} assets`)

// ---- boot the SHIPPED dist/ headlessly and exercise the real play path -------
const OUTDIR = 'dist' // preview the production tree, NOT the harness build
const { chromium } = await import('playwright')
const server = spawn('npx', ['--yes', 'vite', 'preview', '--port', '4531', '--strictPort', '--outDir', OUTDIR], { cwd: ROOT, stdio: 'ignore' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let up = false
for (let i = 0; i < 60; i++) { try { const res = await fetch('http://localhost:4531/'); if (res.ok) { up = true; break } } catch { /* retry */ } await wait(300) }
if (!up) { console.error('[noleak] preview server did not come up'); server.kill(); process.exit(1) }

let browser = null
let fails = 0
const check = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++ }
try {
  browser = await chromium.launch({ headless: true, args: ['--use-angle=1', '--enable-unsafe-experimental-webgpu-discard'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('[page error]', String(e).slice(0, 400)))
  await page.goto('http://localhost:4531/', { waitUntil: 'load' })
  // the shipped build must warm its own loading gate with no dev globals present
  await page.waitForFunction('document.getElementById("loading")?.classList.contains("hidden")', null, { timeout: 30000 }).catch(() => {})
  const win = await page.evaluate((names) => {
    const present = names.filter((n) => typeof (window)[n] !== 'undefined')
    return {
      present,
      titleVisible: !document.getElementById('title-screen')?.classList.contains('hidden'),
      errShown: !document.getElementById('error-screen')?.classList.contains('hidden'),
      loadingHidden: document.getElementById('loading')?.classList.contains('hidden') ?? false,
      hasWebgl: !!document.getElementById('scene')?.getContext,
    }
  }, FORBIDDEN)
  console.log('[noleak] shipped window globals present:', JSON.stringify(win.present))
  console.log('[noleak] shipped boot state:', JSON.stringify({ titleVisible: win.titleVisible, errShown: win.errShown, loadingHidden: win.loadingHidden }))
  check(win.present.length === 0, `no forbidden debug globals on the shipped window (found: ${JSON.stringify(win.present)})`)
  check(win.loadingHidden, 'the shipped build retires its own loading gate')
  check(win.titleVisible && !win.errShown, 'the shipped build reaches the title with no fatal overlay')

  // click START RACE — the real UI seam — and confirm the race runs with no error.
  // Use the element's own click() so the DOM click listener (→ host.onStart →
  // Game.beginRace → ui.raceStarted) fires regardless of headless hit-testing.
  await page.evaluate(() => { window.dispatchEvent(new Event('pointerdown')); window.dispatchEvent(new Event('keydown')) })
  await page.evaluate(() => { const el = document.getElementById('btn-start'); if (el) el.click() })
  await wait(1500)
  const raced = await page.evaluate(() => ({
    titleHidden: document.getElementById('title-screen')?.classList.contains('hidden'),
    hudVisible: !document.getElementById('hud')?.classList.contains('hidden'),
    errShown: !document.getElementById('error-screen')?.classList.contains('hidden'),
    fps: Number((document.title.match(/(\d+)\s*fps/) ?? [0, 0])[1]),
  }))
  console.log('[noleak] after START:', JSON.stringify(raced))
  check(!raced.errShown, 'START RACE runs the shipped game with no fatal overlay')
  check(raced.hudVisible === true && raced.titleHidden === true, 'START RACE hands the screen to the live HUD')
} finally {
  if (browser) { try { await browser.close() } catch { /* best effort */ } }
  try { server.kill() } catch { /* best effort */ }
}

const total = fails + assetLeaks
console.log(`[noleak] RESULT: ${total === 0 ? 'CLEAN' : 'LEAKED'} (runtime fails=${fails}, asset leaks=${assetLeaks})`)
process.exit(total === 0 ? 0 : 1)
