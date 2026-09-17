/** Build-time harness switch (see vite.config.ts). Vite `define` folds this to a
 *  boolean literal; in the shipped `vite build` it is `false` so the
 *  harness-gated branch in `src/main.ts` (and `src/dev/harness.ts`) is dead-code
 *  eliminated out of the bundle (spec §18/§23.4 — debug tooling off by default). */
declare const __VR_HARNESS__: boolean
