import { defineConfig } from 'vite'

/* Velocity Rush build config (plan rev.2, spec §18).
 *
 * `__VR_HARNESS__` is the single build-time switch for the dev/test harness.
 * A production `npm run build` leaves it unset → the constant folds to `false`,
 * so Rollup dead-code-eliminates the harness-gated dynamic import in
 * `src/main.ts` and the whole `src/dev/harness.ts` module (every `__vr/__dbg/
 * __probe/…` global, the pose registry, the kit/gray display boards, the
 * query-driven material/culling levers) never reaches the shipped asset — the
 * Phase 10 no-leak contract.
 *
 * The Playwright drivers build the *harness* variant (`npm run build:harness`,
 * which exports `VR_HARNESS=1`) into `build/harness/` and drive it through
 * `window.__vr` / `window.__dbg`. `__VR_HARNESS__` is also forced on under the
 * interactive dev server (`vite dev`) so live probing works there. */
export default defineConfig(({ command }) => ({
  define: {
    __VR_HARNESS__: JSON.stringify(
      process.env.VR_HARNESS === '1' || process.env.VR_HARNESS === 'true' || command === 'serve',
    ),
  },
}))
