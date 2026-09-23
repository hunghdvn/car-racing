/**
 * Phase 10 §23 visual-audit corroborator (spec §23.2 No-Empty-Space, §23.4
 * No-Placeholder-Survival). This is an OBJECTIVE proxy over the rendered frames,
 * not a substitute for the human 5-Second Test — it flags regressions mechanically:
 *   • no frame is near-monochrome (a surviving gray/debug box or an empty void),
 *   • the region below the horizon is materially populated (not empty world),
 *   • colour variety is present (a PBR scene, not flat single-material),
 *   • the bottom band is not a flat debug-gray slab (a dev pad that leaked).
 *
 * Decodes each shots/*.png into a 2D canvas in the browser and reads pixels.
 * Usage: node scripts/audit-shots.mjs [name ...]
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildHarness, startPreview } from './_harness.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SHOTS = resolve(ROOT, 'shots')
const BASE_PORT = 4535
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const OUTDIR = buildHarness(ROOT)
const prev = startPreview(ROOT, OUTDIR, BASE_PORT)
const probeUp = async () => { for (let i = 0; i < 80; i++) { try { const res = await fetch(prev.url); if (res.ok) return true } catch { /* */ } await wait(300) } return false }
if (!await probeUp()) { await prev.restartOnBusy(); if (!await probeUp()) { console.error('[audit] no server'); prev.close(); process.exit(1) } }

const { chromium } = await import('playwright')
let browser = null
let fails = 0
let audited = 0
let requested = 0
try {
  browser = await chromium.launch({ headless: true, args: ['--use-angle=1'] })
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
  await page.goto(`${prev.url}/`, { waitUntil: 'load' }) // a blank page context to run canvas in
  await page.waitForFunction('window.__vr && window.__vr.ready', null, { timeout: 30000 }).catch(() => {})
  // audit exactly the frames the current registry produces (stale dir files are
  // historical Phase-1/dev evidence and are not part of the §22 battery).
  const vr = await page.evaluate(() => Boolean(window.__vr))
  if (!vr) {
    console.error('[audit] FLAG the screenshot registry did not boot')
    fails++
  }
  const registry = vr ? await page.evaluate(() => window.__vr.list()) : []
  const wanted = process.argv.slice(2)
  const all = wanted.length ? wanted : registry
  if (!wanted.length && registry.length === 0) {
    console.error('[audit] FLAG the screenshot registry is empty')
    fails++
  }
  const names = all.filter((n) => !n.startsWith('_dbg') && !n.startsWith('perf_') && !n.startsWith('live_'))
  requested = names.length
  for (const name of names) {
    let buf
    try { buf = readFileSync(resolve(SHOTS, `${name}.png`)) } catch {
      console.error(`  FLAG ${name.padEnd(20)} registered shot is missing shots/${name}.png`)
      fails++
      continue
    }
    const b64 = buf.toString('base64')
    const stats = await page.evaluate(async (durl) => {
      const img = new Image()
      img.src = durl
      await img.decode()
      const W = img.width, H = img.height
      const c = document.createElement('canvas'); c.width = W; c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, W, H)
      const buckets = new Map()
      let lumSum = 0, n = 0
      for (let i = 0; i < data.length; i += 4 * 7) { // sample every 7th px for speed
        const r = data[i], g = data[i + 1], b = data[i + 2]
        const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
        buckets.set(k, (buckets.get(k) ?? 0) + 1)
        lumSum += (r * 0.299 + g * 0.587 + b * 0.114); n++
      }
      // entropy over colour buckets
      let ent = 0
      for (const v of buckets.values()) { const p = v / n; ent -= p * Math.log2(p) }
      // populate the ground band (rows 45%..100%) — exclude top sky
      const y0 = Math.floor(H * 0.45)
      let groundBuckets = new Set(), groundLum = 0, gn = 0, gray = 0
      for (let y = y0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
        const i = (y * W + x) * 4
        const r = data[i], g = data[i + 1], b = data[i + 2]
        groundBuckets.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4))
        const l = (r * 0.299 + g * 0.587 + b * 0.114); groundLum += l; gn++
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
        if (Math.abs(mx - mn) < 10 && l > 60 && l < 175) gray++ // flat mid-gray (debug-box) pixels
      }
      return { W, H, distinct: buckets.size, groundDistinct: groundBuckets.size, entropy: ent, meanLum: lumSum / n, groundGrayFrac: gray / gn }
    }, `data:image/png;base64,${b64}`)
    const showcase = name.startsWith('kit_') // dev-only isolated-product displays (Gate C1), not gameplay camera
    const empty = showcase ? stats.meanLum < 8 || stats.distinct < 25 : stats.entropy < 5.5 || stats.groundDistinct < 40
    const grayLeak = stats.groundGrayFrac > 0.55
    const ok = !empty && !grayLeak
    if (!ok) fails++
    audited++
    console.log(`  ${ok ? (showcase ? 'ok* ' : 'ok  ') : 'FLAG'} ${name.padEnd(20)} ent=${stats.entropy.toFixed(1)} distinct=${stats.distinct} groundDistinct=${stats.groundDistinct} meanLum=${stats.meanLum.toFixed(0)} groundGray=${(stats.groundGrayFrac * 100).toFixed(1)}%${showcase ? ' (dev-showcase, exempt from the gameplay empty-space bar)' : ''}`)
  }
} finally {
  if (browser) { try { await browser.close() } catch { /* best effort */ } }
  prev.close()
}
if (requested === 0 || audited !== requested) {
  console.error(`[audit] FLAG only ${audited}/${requested} selected frames could be audited`)
  fails++
}
console.log(`[audit] RESULT: ${fails === 0 ? 'ALL CLEAN' : fails + ' FLAGGED'} (${audited} frames)`)
process.exit(fails === 0 ? 0 : 1)
