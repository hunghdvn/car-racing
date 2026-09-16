import * as THREE from 'three'
import { Renderer } from './core/Renderer'
import { Sky } from './core/SkyEnv'
import { Debug } from './core/Debug'
import type { ShotPose } from './core/Debug'
import { buildCar, type CarModel } from './assets/CarModel'
import { ChaseCamera, type CarView } from './camera/ChaseCamera'
import { PAINTS, VEHICLE, KIT } from './config'
import { Rand } from './util'
import { buildBuilding, BUILDING_DESIGNS } from './world/BuildingKit'
import { composePrefab } from './world/ComposeKit'
import { makeBollard, makeCones, makeDrum, makePallet, makeCrates, makeTyreStack, makeBin, makeHydrant, makeBench, makePlanter, makeSign, makeTrafficLight, makeUtilityPole, makeStreetlight, makeMastLight, makeContainer, makeBarrierUnit, makePipeStack, makeVan, makeSignGantry, makeBillboard, makeRadioMast, makeWaterTower, makeGantryCrane } from './world/PropKit'
import { palmGeometry, pineGeometry, bushGeometry, rockGeometry, broadleafGeometry, treeLOD } from './world/VegetationKit'
import { buildTrackSlice, roadPose, heroShot } from './world/TrackSlice'

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
 * Phase 1-2 DEV HARNESS (Gate A0/A). Replaced by Game.boot() in Phase 5-6.
 * Not shipped content (spec §23.4 placeholder audit will remove this file's
 * harness body entirely).
 * ------------------------------------------------------------------------- */
function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement
  const view = new Renderer(canvas)
  const sky = new Sky()
  view.attachSky(sky)

  // Phase 3 — the representative slice replaces the Phase-2 placeholder disc
  const slice = buildTrackSlice()
  view.scene.add(slice.group)

  const car: CarModel = buildCar(PAINTS[1].color)
  view.scene.add(car.group)
  const qp: Record<string, string> = {}
  for (const kv of location.search.slice(1).split('&')) { const i = kv.indexOf('='); if (i > 0) qp[kv.slice(0, i)] = kv.slice(i + 1) }
  if (qp['nocar']) car.group.visible = false
  if (qp['hide']) for (const tok of qp['hide'].split(',')) for (const ch of car.group.children) if (ch.name.includes(tok)) ch.visible = false
  if (qp['noshadow']) view.sun.castShadow = false
  if (qp['hideW']) for (const tok of qp['hideW'].split(',')) slice.group.traverse((o: unknown) => { const n = o as THREE.Object3D; if (n.name === tok) n.visible = false })
  if (qp['dblside']) car.group.traverse((o: unknown) => { const m = o as { isMesh?: boolean; material?: { side?: number } }; if (m.isMesh && m.material) m.material.side = THREE.DoubleSide })
  if (qp['flat']) car.group.traverse((o: unknown) => { const m = o as { isMesh?: boolean; material?: unknown }; if (m.isMesh) m.material = new THREE.MeshBasicMaterial({ color: 0xff2222 }) })
  if (qp['noemi']) car.group.traverse((o: unknown) => {
    const m = o as { isMesh?: boolean; material?: Record<string, unknown> }
    if (m.isMesh && m.material && m.material.emissiveIntensity !== undefined) {
      m.material.emissiveIntensity = 0; (m.material as { needsUpdate?: boolean }).needsUpdate = true
    }
  })
  if (qp['nophy'] || qp['nomap']) car.group.traverse((o: unknown) => {
    const mm = o as { isMesh?: boolean; material?: { isMeshPhysicalMaterial?: boolean; isMeshStandardMaterial?: boolean } }
    if (!mm.isMesh || !mm.material) return
    const mat = mm.material as Record<string, unknown>
    if (qp['nomap']) for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap', 'emissiveMap']) { if (mat[k]) { mat[k] = null; mat.needsUpdate = true } }
    if (qp['nophy'] && mat.isMeshPhysicalMaterial) {
      const std = new THREE.MeshStandardMaterial({ color: (mat.color as THREE.Color).clone(), roughness: mat.roughness as number, metalness: mat.metalness as number })
      std.name = 'std-replace'
      mm.material = std
    }
  })

  const pos = new THREE.Vector3(0, 0, 0)
  let yaw = 0.0
  const chase = new ChaseCamera(view.camera.aspect, view.camera)
  chase.snapTo({ pos, yaw, speed: 0, nitro: false, drift: 0, airborne: false, airHeight: 0 } as CarView)

  const spinners: { spin: THREE.Group; steer: THREE.Group | null }[] = car.wheels.map((w) => ({ spin: w.spin, steer: w.steer }))

  // ---- deterministic validation poses (Gate A on the road + Gate C0 hero) ----
  const anchor = roadPose(slice.spline, slice.spline.sFromX(30), 0)
  const onRoad = (camOff: [number, number, number], lookOff: [number, number, number], fov: number, extra: { speed?: number; drift?: boolean; nitro?: boolean } = {}): ShotPose => {
    const cy = Math.cos(anchor.yaw), sy = Math.sin(anchor.yaw)
    const rot = (v: [number, number, number]): [number, number, number] => [
      anchor.pos[0] + v[0] * cy + v[2] * sy,
      anchor.pos[1] + v[1],
      anchor.pos[2] - v[0] * sy + v[2] * cy,
    ]
    return {
      camera: rot(camOff), look: rot(lookOff), fov,
      player: { pos: anchor.pos, yaw: anchor.yaw, pitch: anchor.pitch, bank: anchor.bank, speed: 0, ...extra },
      freezeSim: true,
    }
  }
  Debug.registerPoses([
    ['car_front', onRoad([0, 0.80, -6.05], [0, 0.58, 0], 33)],
    ['car_rear', onRoad([0, 0.95, 6.05], [0, 0.60, 0], 33)],
    ['car_side', onRoad([7.55, 0.64, 0.10], [0, 0.58, 0], 26)],
    ['car_fq3', onRoad([4.28, 0.98, -4.28], [0, 0.58, 0], 33)],
    ['car_rq3', onRoad([4.35, 1.10, 4.35], [0, 0.60, 0], 33)],
    ['car_drift', onRoad([2.6, 1.35, 2.6], [0, 0.6, 0], 62, { speed: 40, drift: true })],
    ['car_nitro', onRoad([2.7, 1.25, 2.7], [0, 0.62, 0], 62, { speed: 50, nitro: true })],
  ])
  if (qp['kick']) {
    const hero = heroShot(slice.spline)
    const cx = hero.car.pos[0], cz = hero.car.pos[2]
    Debug.registerPose('kick', { camera: [cx + 7.4, hero.car.pos[1] + 2.3, cz - 4.6], look: [cx - 3, hero.car.pos[1] + 0.9, cz + 1.5], fov: 50, player: { pos: hero.car.pos, yaw: hero.car.yaw, pitch: hero.car.pitch, bank: hero.car.bank, speed: 0 }, freezeSim: true })
  }
  // Gate C0 — the 5-Second Test hero composition (chase cam down the coast)
  {
    const hero = heroShot(slice.spline)
    Debug.registerPose('slice', {
      camera: hero.camera, look: hero.look, fov: hero.fov,
      player: { pos: hero.car.pos, yaw: hero.car.yaw, pitch: hero.car.pitch, bank: hero.car.bank, speed: 46, drift: true },
      freezeSim: true, tag: 'coastal',
    })
  }

  /* ---------------- Phase 4 Gate C1/M — kit boards (dev-only showcases) ----
   * Deterministic display rows far outside the playable slice (x ≥ 1600)
   * so the hero frames never see them; poses park the player there so the
   * shadow frustum tracks the assets being judged. */
  {
    const BX = 1600
    const pad = (cx: number, cz: number, w = 170, d = 44): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.24, d), new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.95, metalness: 0.02 }))
      m.position.set(cx, -0.12, cz)
      m.receiveShadow = true
      view.scene.add(m)
    }
    const kitRand = (): Rand => new Rand(20260917)
    // buildings: one row per design, full detail, fronted to the row cam
    {
      const row = new THREE.Group()
      row.name = 'board-buildings'
      let x = -84
      for (const id of BUILDING_DESIGNS) {
        const b = buildBuilding(id, kitRand(), false)
        b.position.set(x, 0, 10)
        row.add(b)
        x += 17
      }
      row.position.set(BX, 0, 0)
      view.scene.add(row)
      pad(BX, 10, 200, 40)
      Debug.registerPose('kit_buildings', {
        camera: [BX, 4.6, -52], look: [BX, 5.5, 10], fov: 52,
        player: { pos: [BX, 0, -64], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit',
      })
    }
    // props: three depth rows (small / medium / landmarks)
    {
      const row = new THREE.Group()
      row.name = 'board-props'
      const smalls = [
        () => makeBollard(), () => makeCones(new Rand(3)), () => makeDrum(), () => makePallet(2), () => makeCrates(new Rand(5)),
        () => makeTyreStack(4), () => makeBin(), () => makeHydrant(), () => makeBench(), () => makePlanter(1.9),
      ]
      smalls.forEach((f, i) => { const o = f(); o.position.set(i * 4.6 - 21, 0, 6); row.add(o) })
      const mids = [
        () => makeSign('jump', 2.4, 1.2), () => makeSign('speed', 1.4, 1.4, false), () => makeTrafficLight(new Rand(2)),
        () => makeUtilityPole(new Rand(3)), () => makeStreetlight(new Rand(4), 6.4), () => makeMastLight(new Rand(5)),
        () => makeContainer(0x2e6470, 7), () => makeBarrierUnit(3), () => makePipeStack(new Rand(6)), () => makeVan(0x7a8288, new Rand(8)),
      ]
      mids.forEach((f, i) => { const o = f(); o.position.set(i * 7.2 - 32, 0, 17); row.add(o) })
      const bigs = [
        () => makeSignGantry('jump', 8), () => makeBillboard('rush'), () => makeBillboard('tyreking'),
        () => makeRadioMast(20), () => makeWaterTower(), () => makeGantryCrane(new Rand(11)),
      ]
      bigs.forEach((f, i) => { const o = f(); o.position.set(i * 17 - 42, 0, 40); row.add(o) })
      row.position.set(BX, 0, 240)
      view.scene.add(row)
      pad(BX, 262, 210, 90)
      Debug.registerPose('kit_props', {
        camera: [BX, 4.0, 218], look: [BX, 3.2, 250], fov: 52,
        player: { pos: [BX, 0, 210], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit',
      })
    }
    // vegetation: species × scale variants near, decimated LOD copies far
    {
      const row = new THREE.Group()
      row.name = 'board-vegetation'
      const r1 = new Rand(9)
      const species: { near: () => THREE.BufferGeometry; far: () => THREE.BufferGeometry }[] = [
        { near: () => palmGeometry(r1, 1), far: () => palmGeometry(r1, 0) },
        { near: () => palmGeometry(r1, 1), far: () => palmGeometry(r1, 0) },
        { near: () => pineGeometry(r1, 1), far: () => pineGeometry(r1, 0) },
        { near: () => pineGeometry(r1, 1), far: () => pineGeometry(r1, 0) },
        { near: () => broadleafGeometry(r1, 1), far: () => broadleafGeometry(r1, 0) },
        { near: () => broadleafGeometry(r1, 1), far: () => broadleafGeometry(r1, 0) },
      ]
      species.forEach((sp, i) => {
        const t = treeLOD(sp.near(), sp.far(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide }))
        t.position.set(i * 6.4 - 16, 0, 6)
        t.scale.setScalar(0.85 + (i % 3) * 0.18)
        t.rotation.y = (i * 0.7) % 6.28
        row.add(t)
      })
      const rb = new Rand(21)
      for (let i = 0; i < 4; i++) {
        const bm = new THREE.Mesh(bushGeometry(rb), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, side: THREE.DoubleSide }))
        bm.position.set(i * 3.4 + 26, 0, 6.5)
        bm.scale.setScalar(0.7 + (i % 2) * 0.5)
        bm.castShadow = true
        row.add(bm)
      }
      const rr = new Rand(31)
      for (let i = 0; i < 3; i++) {
        const rk = new THREE.Mesh(rockGeometry(rr, 10 + i), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }))
        rk.position.set(i * 3.6 + 40, 0, 6.5)
        rk.scale.setScalar(1.1 + (i % 2) * 1.1)
        rk.castShadow = true
        row.add(rk)
      }
      // far row = the LOD1 silhouettes at judgment distance
      const r2 = new Rand(9)
      species.forEach((sp, i) => {
        const m = new THREE.Mesh(sp.far(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, side: THREE.DoubleSide }))
        m.position.set(i * 6.4 - 16, 0, 26)
        m.scale.setScalar(0.85 + (i % 3) * 0.18)
        row.add(m)
      })
      row.position.set(BX, 0, 480)
      view.scene.add(row)
      pad(BX, 496, 160, 60)
      Debug.registerPose('kit_vegetation', {
        camera: [BX, 3.6, 466], look: [BX, 2.6, 488], fov: 50,
        player: { pos: [BX, 0, 458], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit',
      })
    }
    // cluster prefabs: two boards of two, camera down the avenue
    {
      const mk = (id: Parameters<typeof composePrefab>[0], x: number, z: number, seed: number): void => {
        const pre = composePrefab(id, { seed, field: () => 0 })
        pre.position.set(x, 0, z)
        view.scene.add(pre)
        pad(x, z, 120, 120)
      }
      const CITY = 1000
      mk('CityBlock_Street', BX - 62, CITY, 0xc1)
      mk('CityBlock_Corner', BX + 60, CITY, 0xc2)
      Debug.registerPose('kit_clusters', {
        camera: [BX, 6.5, CITY - 64], look: [BX, 5, CITY + 8], fov: 56,
        player: { pos: [BX, 0, CITY - 80], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit',
      })
      const IND = 1300
      mk('IndustrialCluster_Yard', BX - 62, IND, 0xc3)
      mk('IndustrialCluster_Plant', BX + 62, IND, 0xc4)
      Debug.registerPose('kit_industrial', {
        camera: [BX, 7.5, IND - 68], look: [BX, 6, IND + 8], fov: 55,
        player: { pos: [BX, 0, IND - 84], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit',
      })
      const INF = 1600
      mk('TunnelApproach_Portal', BX - 55, INF, 0xc5)
      mk('BridgeSegment_Deck', BX + 60, INF, 0xc6)
      mk('CoastalCliff_Dune', BX, INF + 95, 0xc7)
      Debug.registerPose('kit_infra', {
        camera: [BX, 5.0, INF - 58], look: [BX, 4, INF + 26], fov: 54,
        player: { pos: [BX, 0, INF - 74], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit',
      })
      const SKY = 1850
      mk('Skyline_Backdrop', BX, SKY - KIT.skyline.bandZ, 0xc8)
      Debug.registerPose('kit_skyline', {
        camera: [BX, 7, SKY + 24], look: [BX, 9, SKY - 4], fov: 52,
        player: { pos: [BX, 0, SKY + 40], yaw: 0, speed: 0 }, freezeSim: true, tag: 'kit',
      })
    }
    // Gate M material matrix: paint/glass/rubber/metal/asphalt/concrete/
    // vegetation/water in one gameplay-camera frame, car rolling
    {
      const sM = slice.spline.sFromX(66)
      const rp = roadPose(slice.spline, sM, 2.6)
      const f = slice.spline.frame(sM)
      Debug.registerPose('materials_matrix', {
        camera: [f.pos.x + 16, f.pos.y + 3.3, f.pos.z - 26],
        look: [f.pos.x - 26, f.pos.y + 0.4, f.pos.z + 6],
        fov: 55,
        player: { pos: rp.pos, yaw: rp.yaw, pitch: rp.pitch, bank: rp.bank, speed: 22 },
        freezeSim: true, tag: 'gate-m',
      })
    }
  }


  const carView: CarView = { pos, yaw: 0, speed: 0, nitro: false, drift: 0, airborne: false, airHeight: 0 }
  let simFrozen = false
  let shotSpeed = 0, shotNitro = false, shotDrift = false

  function applyPose(p: ShotPose): void {
      simFrozen = !!p.freezeSim
      shotSpeed = p.player?.speed ?? 0
      shotNitro = !!p.player?.nitro
      shotDrift = !!p.player?.drift
      if (p.player?.pos) { pos.set(...p.player.pos); yaw = p.player.yaw ?? 0 }
      car.group.position.copy(pos)
      car.group.rotation.order = 'YXZ'
      car.group.rotation.set(p.player?.pitch ?? 0, yaw, p.player?.bank ?? 0)
      const spinA = -shotSpeed * 0.09
      for (const s of spinners) s.spin.rotation.x = spinA
      carView.speed = shotSpeed
      carView.yaw = yaw
      carView.nitro = shotNitro
      carView.drift = shotDrift ? 0.55 : 0
      car.setNitro(shotNitro ? 1 : 0)
      car.setBrake(shotSpeed > 30 ? Math.min(0.32, shotSpeed / 160 + 0.08) : 0)
      car.group.updateMatrixWorld(true)
      view.camera.position.fromArray(p.camera)
      view.camera.lookAt(p.look ? new THREE.Vector3(...p.look) : new THREE.Vector3(0, 0.6, 0))
      if (p.fov) { view.camera.fov = p.fov; view.camera.updateProjectionMatrix() }
  }

  Debug.bind({
    applyPose,
    render(m) { view.render(m) },
    getCanvas() { return canvas },
  })
  const releaseOrig = Debug.releasePose.bind(Debug)
  Debug.releasePose = () => { simFrozen = false; releaseOrig() }
  ;(window as unknown as { __probe?: () => object }).__probe = () => ({
    fps: Math.round(view.fps),
    frames: frameCount,
    title: document.title,
    err: !($('error-screen') as HTMLElement)?.classList.contains('hidden') ? (($('error-body') as HTMLElement)?.textContent ?? '').slice(0, 600) : null,
    loadingHidden: $('loading')?.classList.contains('hidden') ?? false,
    cam: `${view.camera.position.x.toFixed(1)},${view.camera.position.y.toFixed(1)},${view.camera.position.z.toFixed(1)} fov${Math.round(view.camera.fov)}`,
    children: view.scene.children.length,
    glErr: view.gl.getContext().getError(),
    ctxLost: view.gl.getContext().isContextLost(),
  })

  // ---- dev-only Gate A probes (removed with the harness, spec �23.4) ----------------
  function halfBits(h: number): number {
    const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x3ff
    if (e === 0x1f) return f !== 0 ? NaN : s === 0 ? Infinity : -Infinity
    if (e === 0) return (s === 0 ? 1 : -1) * f * Math.pow(2, -24)
    return (s === 0 ? 1 : -1) * Math.pow(2, e - 15) * (1 + f / 1024)
  }
  interface BufStat { nan: number; inf: number; max: number; p95: number; samples: number }
  function statRT(rt: THREE.WebGLRenderTarget | null | undefined): BufStat | null {
    if (!rt) return null
    const w = rt.width, h = rt.height
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 24000)))
    const buf = new Uint16Array(w * h * 4)
    try { view.gl.readRenderTargetPixels(rt, 0, 0, w, h, buf) } catch { return null }
    let nan = 0, inf = 0, max = 0
    const vals: number[] = []
    for (let i = 0; i < buf.length; i += 4 * step) {
      for (let c = 0; c < 3; c++) {
        const v = halfBits(buf[i + c])
        if (Number.isNaN(v)) nan++
        else if (!Number.isFinite(v)) inf++
        else { if (v > max) max = v; vals.push(v) }
      }
    }
    vals.sort((a, b) => a - b)
    return { nan, inf, max: Math.round(max * 100) / 100, p95: vals.length ? Math.round(vals[Math.floor(vals.length * 0.95)] * 100) / 100 : 0, samples: vals.length }
  }
  ;(window as unknown as { __bisect?: () => Record<string, unknown> }).__bisect = () => {
    const dp = view.debugPipeline as unknown as Record<string, any>
    const c = dp.composer as Record<string, any>
    const passes = c.passes as Record<string, any>[]
    const r: Record<string, unknown> = {}
    const rb = c.readBuffer as THREE.WebGLRenderTarget
    const mode = Number(qp['bis']) || 0
    passes[0].renderToScreen = false
    passes[0].render(view.gl, c.writeBuffer, rb, mode, false)
    r.sceneOnly = statRT2(rb)
    passes[1].renderToScreen = false
    passes[1].render(view.gl, c.writeBuffer, rb, mode, false)
    r.afterBloom = statRT2(rb)
    const bl = dp.bloom as Record<string, any>
    r.bright = statRT2(bl.renderTargetBright)
    // geometry scan
    const geo: Record<string, unknown> = {}
    const nz = new THREE.Vector3()
    const scanRoot = (qp['all'] ? view.scene : car.group) as THREE.Object3D
    scanRoot.traverse((o: unknown) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const g = m.geometry as THREE.BufferGeometry
      const nAttr = g.getAttribute("normal") as THREE.BufferAttribute | undefined
      const pAttr = g.getAttribute("position") as THREE.BufferAttribute
      const cAttr = g.getAttribute("color") as THREE.BufferAttribute | undefined
      const uAttr = g.getAttribute("uv") as THREE.BufferAttribute | undefined
      let badN = 0, badP = 0, zeroN = 0, badC = 0, badU = 0
      if (nAttr) for (let i = 0; i < nAttr.count; i++) {
        nz.set(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i))
        if (!Number.isFinite(nz.x) || !Number.isFinite(nz.y) || !Number.isFinite(nz.z)) badN++
        else if (nz.lengthSq() < 1e-6) zeroN++
      }
      for (let i = 0; i < pAttr.count; i++) {
        if (!Number.isFinite(pAttr.getX(i)) || !Number.isFinite(pAttr.getY(i)) || !Number.isFinite(pAttr.getZ(i))) badP++
      }
      if (cAttr) for (let i = 0; i < cAttr.count; i++) {
        if (!Number.isFinite(cAttr.getX(i)) || !Number.isFinite(cAttr.getY(i)) || !Number.isFinite(cAttr.getZ(i))) badC++
      }
      if (uAttr) for (let i = 0; i < uAttr.count; i++) {
        if (!Number.isFinite(uAttr.getX(i)) || !Number.isFinite(uAttr.getY(i))) badU++
      }
      if (badN || badP || zeroN || badC || badU) {
        g.computeBoundingBox()
        const bb = g.boundingBox
        let firstBad = -1
        if (cAttr && badC) for (let i = 0; i < cAttr.count; i++) { if (!Number.isFinite(cAttr.getX(i)) || !Number.isFinite(cAttr.getY(i)) || !Number.isFinite(cAttr.getZ(i))) { firstBad = i; break } }
        const fbY = firstBad >= 0 ? Math.round(pAttr.getY(firstBad) * 10) / 10 : 0
        const fbX = firstBad >= 0 ? Math.round(pAttr.getX(firstBad)) : 0
        const fbZ = firstBad >= 0 ? Math.round(pAttr.getZ(firstBad)) : 0
        geo[m.name || g.type] = { verts: pAttr.count, badN, badP, zeroN, badC, badU, firstBad: [fbX, fbY, fbZ], bb: bb ? [bb.min.toArray(), bb.max.toArray()].map((a) => a.map((v) => Math.round(v))) : null, mat: (m.material as THREE.Material).type }
      }
    })
    r.geoScan = geo
    return r
  }
  function statRT2(rt: THREE.WebGLRenderTarget | null | undefined): Record<string, unknown> | null {
    if (!rt) return null
    const w = rt.width, h = rt.height
    const buf = new Uint16Array(w * h * 4)
    try { view.gl.readRenderTargetPixels(rt, 0, 0, w, h, buf) } catch { return null }
    let nan = 0, inf = 0, finite = 0, max = 0
    let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4
        let nanPix = false, infPix = false
        for (let cc = 0; cc < 3; cc++) {
          const v = halfBits(buf[i + cc])
          if (Number.isNaN(v)) nanPix = true
          else if (!Number.isFinite(v)) infPix = true
          else if (v > max) max = v
        }
        if (nanPix) { nan++; bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y) }
        else if (infPix) inf++
        else finite++
      }
    }
    return { nan, inf, finite, max: Math.round(max * 100) / 100, nanBox: bx1 < 0 ? null : [bx0, by0, bx1, by1], size: [w, h] }
  }  ;(window as unknown as { __tireDbg?: () => unknown }).__tireDbg = () => {
    const w = car.wheels[1]
    const holder = w.steer ?? w.spin
    const tire = holder.children.length ? holder : holder
    let mesh: THREE.Mesh | null = null
    holder.traverse((o: unknown) => { const m = o as THREE.Mesh; if (m.isMesh && m.name === "tire") mesh = m })
    const tm = mesh as unknown as THREE.Mesh
    if (!tm) return null
    const g = tm.geometry as THREE.BufferGeometry
    g.computeBoundingBox()
    const p = g.getAttribute("position") as THREE.BufferAttribute
    let maxRad = 0, maxX = 0
    for (let i2 = 0; i2 < p.count; i2++) {
      const r = Math.sqrt(p.getX(i2) * p.getX(i2) + p.getZ(i2) * p.getZ(i2))
      if (r > maxRad) maxRad = r
      if (Math.abs(p.getX(i2)) > maxX) maxX = Math.abs(p.getX(i2))
    }
    return {
      localBox: { min: g.boundingBox?.min.toArray(), max: g.boundingBox?.max.toArray() },
      maxRadial: maxRad, maxAxial: maxX, verts: p.count,
      worldMatrix: Array.from(tm.matrixWorld.elements).map((v) => Math.round(v * 1000) / 1000),
      spinRotX: Math.round(w.spin.rotation.x * 100) / 100,
      carPos: car.group.position.toArray(), carRot: car.group.rotation.toArray(),
    }
  }

  ;(window as unknown as { __wheelScan?: () => unknown }).__wheelScan = () => {
    const out: unknown[] = []
    for (const w of car.wheels) {
      const holder = w.steer ?? w.spin.parent ?? w.spin
      holder.traverse((o: unknown) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        const b = new THREE.Box3().setFromObject(m)
        const rnd = (v: number): number => Math.round(v * 1000) / 1000
        out.push({ pos: w.front ? 'f' : 'r', name: m.name, min: [rnd(b.min.x), rnd(b.min.y), rnd(b.min.z)], max: [rnd(b.max.x), rnd(b.max.y), rnd(b.max.z)] })
      })
    }
    return out
  }

  ;(window as unknown as { __carInfo?: () => Record<string, unknown> }).__carInfo = () => {
    const box = new THREE.Box3().setFromObject(car.group)
    const wheels = car.wheels.map((w) => {
      const wb2 = new THREE.Box3().setFromObject(w.steer ?? w.spin)
      return { front: w.front, min: wb2.min.toArray().map((v) => Math.round(v * 100) / 100), max: wb2.max.toArray().map((v) => Math.round(v * 100) / 100) }
    })
    const parts: { name: string; vis: boolean }[] = []
    for (const ch of car.group.children) parts.push({ name: ch.name, vis: ch.visible })
    return {
      carBox: { min: box.min.toArray().map((v) => Math.round(v * 1000) / 1000), max: box.max.toArray().map((v) => Math.round(v * 1000) / 1000) },
      wheels, parts,
    }
  }
  const clock = new THREE.Clock()
  let t = 0
  let dist = 0
  let loadingHidden = false
  let wheelAngle = 0
  let frameCount = 0

  function frame(): void {
    const dt = Math.min(clock.getDelta(), 0.05)
    frameCount++
    if (!simFrozen) {
      t += dt
      const speed = 17 + Math.sin(t * 0.35) * 9
      dist += speed * dt
      const sDrive = 170 + (dist % 142)
      const rp = roadPose(slice.spline, sDrive, Math.sin(t * 0.18) * 1.6)
      pos.set(rp.pos[0], rp.pos[1], rp.pos[2])
      yaw = rp.yaw
      car.group.position.copy(pos)
      car.group.rotation.order = 'YXZ'
      car.group.rotation.set(rp.pitch - speed * 0.0004, rp.yaw, rp.bank + Math.sin(t * 0.4) * 0.014)
      const steerA = Math.sin(t * 0.21) * 0.3
      carView.speed = speed
      carView.yaw = yaw
      carView.nitro = Math.sin(t * 0.4) > 0.75
      carView.drift = Math.sin(t * 0.4) > 0.75 ? 0.4 : 0
      car.setBrake(Math.sin(t * 1.4) > 0.7 ? 1 : 0)
      car.setNitro(carView.nitro ? 1 : 0)
      wheelAngle += (speed / VEHICLE.wheelRadius) * dt
      for (const s of spinners) {
        s.spin.rotation.x = -wheelAngle
        if (s.steer) s.steer.rotation.y = steerA
      }
      chase.mode = 'chase'
      chase.setOrbitFocus(pos)
      chase.update(dt, carView, window.innerWidth / window.innerHeight)
    } else if (Debug.lastPose) {
      applyPose(Debug.lastPose)
    }
    view.update(dt, car.group.position)
    slice.update(t, view.camera.position)
    view.render()
    if (!loadingHidden && t > 0.5) { loadingHidden = true; $('loading')?.classList.add('hidden') }
    document.title = `Velocity Rush — ${Math.round(view.fps)} fps — ${view.tier}`
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

try { boot() } catch (e) { fatal(e) }