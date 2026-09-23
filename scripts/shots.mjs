/**
 * Velocity Rush deterministic screenshot driver (plan rev.2, spec §22).
 * Usage: node scripts/shots.mjs [shotName ...]   (default: all registered)
 * Serves dist/ via vite preview; writes shots/<name>.png.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildHarness, startPreview } from './_harness.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'shots')
mkdirSync(OUT, { recursive: true })

// ---- environment-aware browser discovery -----------------------------------
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

let browserType = await findChromium()
if (!browserType) {
  console.log('[shots] chromium missing — installing (environment-aware fallback)')
  const { spawnSync } = await import('node:child_process')
  spawnSync('npx', ['--yes', 'playwright', 'install', 'chromium'], { stdio: 'inherit' })
  browserType = (await import('playwright')).chromium
}
const { chromium } = await import('playwright')

// ---- serve the dev-harness build (the shipped dist/ has the harness stripped) --
const BASE_PORT = 4517
const OUTDIR = buildHarness(ROOT)
const prev = startPreview(ROOT, OUTDIR, BASE_PORT)
const query = process.env.SHOT_QUERY ? `?${process.env.SHOT_QUERY}` : ''
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const probeUp = async () => { for (let i = 0; i < 60; i++) { try { const res = await fetch(prev.url); if (res.ok) return true } catch { /* retry */ } await wait(300) } return false }
let up = await probeUp()
if (!up) { await prev.restartOnBusy(); up = await probeUp() } // base port was an orphan → rebound
if (!up) { console.error('[shots] preview server did not come up'); prev.close(); process.exit(1) }
const url = `${prev.url}${query}`
let browser = null
let captureFailures = 0
try {

browser = await chromium.launch({ headless: true, args: ['--use-angle=1', '--enable-unsafe-experimental-webgpu-discard'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[page error]', String(e).slice(0, 500)))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[console ${m.type()}]`, m.text().slice(0, 400)) })
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction('window.__vr && window.__vr.ready', null, { timeout: 30000 }).catch(async () => {
  const err = await page.evaluate(() => ({
    errShown: !document.getElementById('error-screen')?.classList.contains('hidden'),
    errBody: document.getElementById('error-body')?.textContent?.slice(0, 800) ?? '(none)',
  }))
  console.log('[fatal diagnostics]', JSON.stringify(err, null, 1))
})
await page.waitForFunction('window.__probe && window.__probe().loadingHidden', null, { timeout: 20000 }).catch(() => console.log('[shots] warn: loop never warmed'))
await page.evaluate(() => new Promise((r) => setTimeout(r, 250)))
const probe = await page.evaluate(() => (window).__probe?.() ?? '(no probe)')
console.log('[probe]', JSON.stringify(probe))
const names = await page.evaluate(() => window.__vr.list())
const wanted = process.argv.slice(2)
const missing = wanted.filter((n) => !names.includes(n))
if (missing.length) {
  console.error(`[shots] unknown requested shot(s): ${missing.join(', ')}`)
  prev.close()
  process.exit(1)
}
const list = wanted.length ? wanted : names
if (!list.length) {
  console.error('[shots] no registered shots to capture')
  prev.close()
  process.exit(1)
}
for (const name of list) {
  const mode = Number(process.env.RENDER_MODE ?? 0)
  const dataUrl = await page.evaluate((a) => window.__vr.shot(a.n, a.m), { n: name, m: mode })
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) {
    console.error(`[shots] ${name}: no image (${String(dataUrl).slice(0, 60)})`)
    captureFailures++
    continue
  }
  writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`[shots] wrote shots/${name}.png`)
  const p2 = await page.evaluate(() => (window).__probe?.() ?? null)
  console.log(`[post ${name}]`, JSON.stringify(p2))
  if (process.env.TALLY) {
    const t = await page.evaluate(() => (window).__tally?.() ?? null)
    if (t) for (const [k, v] of Object.entries(t)) if (v.meshes) console.log(`  [${k}] meshes=${v.meshes} tris=${v.tris} ${JSON.stringify(Object.entries(v.names).sort((a, b) => b[1] - a[1]).slice(0, 8))}`)
  }
}
} finally {
  if (browser) { try { await browser.close() } catch { /* best effort */ } }
  prev.close()
}

if (captureFailures > 0) {
  console.error(`[shots] RESULT: FAIL (${captureFailures} registered shot(s) produced no image)`)
  process.exit(1)
}
