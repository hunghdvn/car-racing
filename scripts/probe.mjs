/** Structural probe: inspects the built scene through window.__dbg. */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const PORT = 4519
const server = spawn('npx', ['--yes', 'vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
const url = `http://localhost:${PORT}/?` + (process.env.SHOT_QUERY ?? '')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let up = false
for (let i = 0; i < 60; i++) { try { const res = await fetch(url); if (res.ok) { up = true; break } } catch { /* */ } await wait(300) }
if (!up) { console.error('no server'); server.kill(); process.exit(1) }

const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true, args: ['--use-angle=1'] })
const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
page.on('pageerror', (e) => console.log('[page error]', String(e).slice(0, 300)))
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction('window.__vr && window.__vr.ready', null, { timeout: 30000 })
await page.waitForFunction('window.__probe && window.__probe().loadingHidden', null, { timeout: 20000 }).catch(() => {})
await page.evaluate(() => new Promise((r) => setTimeout(r, 200)))

const out = await page.evaluate(() => {
  const dbg = window.__dbg
  const { scene, slice, THREE } = dbg
  const spline = slice.spline
  const zones = ['coastal', 'industrial', 'tunnel', 'elevated', 'final', 'start']
  const rng = {}
  for (const z of zones) rng[z] = spline.zoneRange(z)
  const find = (name) => { const a = []; scene.traverse((o) => { if (o.name === name) a.push(o) }); return a }
  const bb = (o) => { const b = new THREE.Box3().setFromObject(o); const c = new THREE.Vector3(); b.getCenter(c); return { min: b.min.toArray().map((v) => Math.round(v)), max: b.max.toArray().map((v) => Math.round(v)), c: c.toArray().map((v) => Math.round(v)) } }
  // terrain height samples via raycast
  const rc = new THREE.Raycaster()
  const down = new THREE.Vector3(0, -1, 0)
  const upv = new THREE.Vector3(0, 1, 0)
  const terrainTiles = []
  scene.traverse((o) => { if (o.name === 'terrain-tile') terrainTiles.push(o) })
  const sample = (x, z) => {
    rc.set(new THREE.Vector3(x, 200, z), down)
    const hits = rc.intersectObjects(terrainTiles, false)
    return hits.length ? +hits[0].point.y.toFixed(1) : null
  }
  const across = (s, sides) => {
    const f = spline.frame(s)
    return sides.map((lat) => {
      const x = f.pos.x + f.side.x * lat, z = f.pos.z + f.side.z * lat
      return { lat, roadY: +spline.bedY(s, 0).toFixed(1), terrain: sample(x, z) }
    })
  }
  const portals = find('tunnel-portal').map((o) => { const c = new THREE.Vector3(); o.getWorldPosition(c); return { x: Math.round(c.x), y: Math.round(c.y), z: Math.round(c.z) } })
  const shells = find('tunnel-shell').map((o) => bb(o))
  const pylons = find('deck-pylons').map((o) => ({ count: o.count ?? o.instanceMatrix?.count, bb: bb(o) }))
  const abut = find('deck-abutment').map((o) => bb(o))
  const soffit = find('deck-soffit').map((o) => bb(o))
  const shortcut = find('shortcut')
  const finish = find('finish').map((o) => bb(o))
  const cityUnderDeck = []
  // any prefab named CityBlock* whose centre sits near the elevated zone floor
  scene.traverse((o) => {
    if (/^CityBlock|^CityTower/.test(o.name ?? '') && o.parent?.name !== 'slice-composition') {
      const c = new THREE.Vector3(); new THREE.Box3().setFromObject(o).getCenter(c)
      cityUnderDeck.push({ name: o.name, c: c.toArray().map((v) => Math.round(v)) })
    }
  })
  return {
    length: +spline.length.toFixed(0), rng,
    tunnelAcross: [1010, 1050, 1100, 1150, 1200, 1240].map((s) => ({ s, row: across(s, [0, 12, 30, 60, 90, 120]) })),
    elevAcross: [1300, 1420, 1520, 1650, 1800, 1900].map((s) => ({ s, row: across(s, [0, 12, 30, 60, 90, 120]) })),
    portals, shells, pylons, abut: abut.slice(0, 4), soffit, finish, shortcutBB: shortcut.map((o) => bb(o)),
    cityUnderDeck,
  }
})
console.log(JSON.stringify(out, null, 1))
await browser.close()
server.kill()
