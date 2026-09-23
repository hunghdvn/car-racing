/**
 * Shared Phase 10 harness-driver support (spec §18/§22/§23.4 no-leak contract).
 *
 * The shipped bundle (`dist/`, from `npm run build`) has the dev harness dead-code
 * eliminated out of it. The deterministic Playwright drivers (shots / probe / perf)
 * cannot run against that clean asset — they drive `window.__vr` / `window.__dbg`.
 * So they build the *harness* variant (identical sources, `VR_HARNESS=1`) and
 * preview THAT through `vite preview`.
 *
 * The clean production bundle is therefore never the thing these tools serve; the
 * no-leak grep is always taken against `dist/`, not the harness build.
 *
 * The harness loads through a build-time-gated dynamic import, so Vite emits it as
 * a lazy `harness-*.js` chunk. To keep that serve race-free and hermetic each run
 * builds into its OWN fresh outDir (never wiping a tree another server may be
 * serving) and binds a discovered free port, so a crashed prior run can not leave
 * an orphan server on a shared port. Callers must `close()` in a finally.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

const VITE_CLI = resolve(import.meta.dirname, '../node_modules/vite/bin/vite.js')

/** Build the dev-harness variant into a unique, empty outDir (reproducible ~1s). */
export function buildHarness(root) {
  const outDir = `build/harness/${process.pid}-${Date.now().toString(36)}`
  const r = spawnSync(process.execPath, [VITE_CLI, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, VR_HARNESS: '1' },
  })
  const indexHtml = resolve(root, outDir, 'index.html')
  if (r.status !== 0 || !existsSync(indexHtml)) {
    console.error('[harness] harness build failed — is the tree type-clean? (npm run build:harness)')
    process.exit(1)
  }
  return outDir
}

/** Reserve a currently-free TCP port (listen on 0, read the OS-assigned port, release). */
export function freePort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.on('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
  })
}

/**
 * `vite preview` the built harness tree on a discovered free port.
 * Returns `{ server, url, outDir, close }`; `close()` tears the server down and
 * removes the throwaway outDir (safe to call twice; call it in a finally).
 */
export function startPreview(root, outDir, basePort) {
  const urlFor = (port) => `http://localhost:${port}/`
  const spawnAt = (port) => spawn(process.execPath, [VITE_CLI, 'preview', '--port', String(port), '--strictPort', '--outDir', outDir], { cwd: root, stdio: 'ignore' })
  const killServer = (server) => {
    if (!server) return
    try { server.kill() } catch { /* already gone */ }
  }
  // start eagerly on the requested base; the wait-for-up loop retries regardless.
  const state = { server: spawnAt(basePort), port: basePort }
  let closed = false
  return {
    get server() { return state.server },
    url: urlFor(basePort),
    outDir,
    /** true once the bound server stops answering (port clash with an orphan) */
    async restartOnBusy() {
      try {
        const res = await fetch(this.url)
        if (res.ok) return true
      } catch { /* base port is dead or orphaned */ }
      const port = await freePort()
      killServer(state.server)
      state.server = spawnAt(port)
      state.port = port
      this.url = urlFor(port)
      return false
    },
    close() {
      if (closed) return
      closed = true
      killServer(state.server)
      try { rmSync(resolve(root, outDir), { recursive: true, force: true }) } catch { /* best effort */ }
    },
  }
}
