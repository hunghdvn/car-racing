/**
 * Browser-first global accessor.
 *
 * A bare read of the ES2020 `globalThis` keyword throws a ReferenceError on
 * older-but-still-common browsers that predate it. When such a read sits inside a
 * `try { … } catch { /* no-op *\/ }` subsystem init (audio, gamepad), that throw is
 * swallowed and the subsystem silently stays disabled — the exact silent-failure this
 * avoids. Resolve `window` first (present in every browser, and where the dev/test
 * harness installs its stubs), then fall back to `globalThis` (node test bundle),
 * then a benign empty object. Every branch is `typeof`-guarded so an absent binding
 * can never throw. Dependency-free.
 */
export function globalObject(): Record<string, unknown> {
  if (typeof window !== 'undefined' && window) return window as unknown as Record<string, unknown>
  if (typeof globalThis !== 'undefined' && globalThis) return globalThis as unknown as Record<string, unknown>
  return {}
}
