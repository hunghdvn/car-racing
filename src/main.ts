import { PAINTS } from './config'
import { setStaticMergeEnabled } from './world/StaticMerge'
import { Game } from './game/Game'

const $ = (id: string): HTMLElement | null => document.getElementById(id)

function fatal(e: unknown): void {
  console.error(e)
  const scr = $('error-screen'), body = $('error-body')
  if (scr && body) {
    body.textContent = String((e as Error)?.stack ?? e)
    scr.classList.remove('hidden')
    $('loading')?.classList.add('hidden')
  }
}
window.addEventListener('error', (ev) => fatal(ev.error ?? ev.message))
window.addEventListener('unhandledrejection', (ev) => fatal(ev.reason))

/* ---------------------------------------------------------------------------
 * Production entry (plan rev.2 File Structure): boot + fatal overlay + the
 * formal loading → title → race handoff. The real application lives entirely in
 * `game/Game.ts`; nothing below is dev tooling.
 *
 * Phase 10 no-leak contract (spec §18/§23.4): every debug global, the shot-pose
 * registry, the kit/gray display boards and the query-driven material/culling
 * levers are compiled OUT of this bundle. They live in `src/dev/harness.ts`,
 * reached only through the harness-gated dynamic import guarded by the
 * build-time constant `__VR_HARNESS__` (see `vite.config.ts`). A production
 * `vite build` folds `__VR_HARNESS__` to `false`, so Rollup dead-code-eliminates
 * the branch and never includes the harness module in the shipped asset; the
 * Playwright drivers build the harness variant (`npm run build:harness`,
 * `VR_HARNESS=1`) and drive it through `window.__vr` / `window.__dbg`.
 * ------------------------------------------------------------------------- */
function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement
  const bootStep = (t: string, pct: number): void => {
    const el = $('loading-step'), fill = $('loading-fill')
    if (el) el.textContent = t
    if (fill) fill.style.width = `${Math.round(pct * 100)}%`
  }
  bootStep('Booting renderer', 0.06)
  /* harness-only A/B lever (Phase 9): ?nomerge=1 boots with the density
     batching off so the cost evidence compares like-for-like against the fold.
     It must be applied before the world builds; gated out of the shipped
     bundle with the rest of the dev harness. */
  if (__VR_HARNESS__ && new URLSearchParams(location.search).has('nomerge')) setStaticMergeEnabled(false)
  const t0 = performance.now()
  const game = new Game(canvas, PAINTS[1].color)
  const buildMs = Math.round(performance.now() - t0)
  /* the WebAudio context may only exist past a user gesture (spec §15) —
     the first real press unlocks it; everything before is a silent no-op */
  const unlockAudio = (): void => { game.audio.unlock() }
  window.addEventListener('pointerdown', unlockAudio, { once: true })
  window.addEventListener('keydown', unlockAudio, { once: true })

  /* dev harness: compiled out of the shipped bundle (see the header note); the
     drivers wait on window.__vr.ready, which the harness sets once bound. */
  if (__VR_HARNESS__) import('./dev/harness')
    .then((m) => m.installDevHarness(game, canvas, buildMs))
    .catch(fatal)

  /* ---------------- formal boot flow (Phase 8): loading -> title -> race ----
   * The world builds synchronously inside Game's constructor; the loading bar
   * steps across deferred frames so each stage actually paints, the bar retires
   * through UIManager (keeping the Playwright __probe().loadingHidden contract),
   * and the title board hands over to the race through the Input/UIManager path
   * (START RACE button or the Enter confirm action). */
  game.spawnAt(150)
  bootStep('Building the world', 0.42)
  requestAnimationFrame(() => {
    bootStep('Dressing the circuit', 0.68)
    requestAnimationFrame(() => {
      bootStep('Warming the pipeline', 0.9)
      requestAnimationFrame(() => {
        bootStep('Ready', 1)
        game.markLoadingShown()
        game.ui.showTitle()
        game.start()
      })
    })
  })
}

try { boot() } catch (e) { fatal(e) }
