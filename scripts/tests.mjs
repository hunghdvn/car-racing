/**
 * Headless test driver: bundles tests/ with the repo's esbuild (vite dep)
 * and runs them on plain node — pure math, no browser, no renderer.
 * Usage: npm run test
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = resolve(ROOT, 'build/tests')
mkdirSync(OUT_DIR, { recursive: true })
const OUT = resolve(OUT_DIR, 'run.mjs')

await build({
  entryPoints: [resolve(ROOT, 'tests/all.ts')],
  bundle: true,
  outfile: OUT,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['three'],
  absWorkingDir: ROOT,
  logLevel: 'warning',
})

const child = spawn(process.execPath, [OUT], { stdio: 'inherit', cwd: ROOT })
child.on('exit', (code) => process.exit(code ?? 1))
