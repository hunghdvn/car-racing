import * as THREE from 'three'
import { Debug } from './core/Debug'
import type { ShotPose } from './core/Debug'
import { Renderer } from './core/Renderer'
import { KIT, PAINTS, RACE, QUALITY } from './config'
import { Rand } from './util'
import { buildBuilding, BUILDING_DESIGNS, type BuildingDesignId } from './world/BuildingKit'
import { composePrefab } from './world/ComposeKit'
import { makeBollard, makeCones, makeDrum, makePallet, makeCrates, makeTyreStack, makeBin, makeHydrant, makeBench, makePlanter, makeSign, makeTrafficLight, makeUtilityPole, makeStreetlight, makeMastLight, makeContainer, makeBarrierUnit, makePipeStack, makeVan, makeSignGantry, makeBillboard, makeRadioMast, makeWaterTower, makeGantryCrane } from './world/PropKit'
import { palmGeometry, pineGeometry, bushGeometry, rockGeometry, broadleafGeometry, treeLOD } from './world/VegetationKit'
import { roadPose, heroShot } from './world/TrackSlice'
import { setStaticMergeEnabled, densityAudit } from './world/StaticMerge'
import { gridSlot } from './game/RaceDirector'
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
 * Phase 1-6 DEV HARNESS (Gate A0/A/B/C). The real application lives in
 * game/Game.ts; this file only wires boot + dev probes + the shot registry.
 * DRIVE mode is the default (WASD/arrows, Space handbrake, Shift nitro, R
 * respawn, P pause); frozen POSE mode is driven through window.__vr.
 * Not shipped content (spec §23.4 — this whole harness goes in Phase 10).
 * ------------------------------------------------------------------------- */
function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement
  const bootStep = (t: string, pct: number): void => {
    const el = $('loading-step'), fill = $('loading-fill')
    if (el) el.textContent = t
    if (fill) fill.style.width = `${Math.round(pct * 100)}%`
  }
  bootStep('Booting renderer', 0.06)
  /* harness A/B lever (Phase 9): nomerge=1 boots with the density batching
     off so the cost evidence compares like-for-like against the fold. */
  if (new URLSearchParams(location.search).has('nomerge')) setStaticMergeEnabled(false)
  const game = new Game(canvas, PAINTS[1].color)
  /* the WebAudio context may only exist past a user gesture (spec §15) —
     the first real press unlocks it; everything before is a silent no-op */
  const unlockAudio = (): void => { game.audio.unlock() }
  window.addEventListener('pointerdown', unlockAudio, { once: true })
  window.addEventListener('keydown', unlockAudio, { once: true })
  const { view, car, slice } = game
  const dbg = { scene: view.scene, cam: view.camera, slice, THREE, game, Renderer, QUALITY }
  /* dev-only: drive the fixed-dt sim + presentation deterministically so the
     event-aggregating effects pipeline can be verified without waiting on the
     host's real-time frame rate (software rasterization throttles rAF). */
  ;(dbg as unknown as { pump: (simSeconds: number) => void }).pump = (simSeconds: number): void => {
    const dt = 1 / 120
    const steps = Math.min(Math.round(simSeconds / dt), 6000)
    const g = game as unknown as { stepSim: (d: number, inp: unknown) => void; flushFx: () => void; presentation: (d: number) => void; input: { poll: (d: number) => unknown } }
    const inp = g.input.poll(1 / 60)
    for (let i = 0; i < steps; i++) g.stepSim(dt, inp)
    g.flushFx()
    g.presentation(0)
  }
  ;(globalThis as unknown as { __dbg?: unknown }).__dbg = dbg

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
  // POSE mode: the harness boots camera-still (no drive input authority)
  if (qp['mode'] === 'pose' || qp['pose']) game.input.enabled = false

  /* ---------------- deterministic validation poses (Gate A/C batteries) ---- */
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

  /* ---------- Phase 6 drive-state shots: the vehicle systems, frozen -----
   * Each pose is an explicit visual state through the Vehicle binding (the
   * same path the sim feeds live), so it doubles as the Phase-2 gate check
   * on the moving car: mid-drift, airtime over the kicker, nitro burn,
   * collision recovery. */
  {
    const rp = roadPose(slice.spline, slice.spline.sFromX(30), 0)
    const rotAt = (yaw: number, v: [number, number, number], base: [number, number, number]): [number, number, number] => {
      const cy = Math.cos(yaw), sy = Math.sin(yaw)
      return [base[0] + v[0] * cy + v[2] * sy, base[1] + v[1], base[2] - v[0] * sy + v[2] * cy]
    }
    const SLIP = 0.5 // readable mid-drift slide angle
    Debug.registerPose('state_drift', {
      camera: rotAt(rp.yaw + SLIP, [4.35, 1.62, 3.75], rp.pos),
      look: rotAt(rp.yaw + SLIP, [0, 0.6, 0.4], rp.pos), fov: 58,
      player: {
        pos: rp.pos, yaw: rp.yaw + SLIP, pitch: rp.pitch - 0.025, bank: rp.bank,
        speed: 42, wheelSteer: -0.5, lean: 0.09, susp: -0.055, brakeGlow: 0.22,
      },
      freezeSim: true, tag: 'drive-state',
    })
    {
      const rpA = roadPose(slice.spline, slice.spline.sFromX(30), 0)
      Debug.registerPose('state_air', {
        camera: rotAt(rpA.yaw, [2.9, 3.0, 7.6], [rpA.pos[0], rpA.pos[1] + 0.85, rpA.pos[2]]),
        look: rotAt(rpA.yaw, [0, 0.55, 1.2], [rpA.pos[0], rpA.pos[1] + 0.85, rpA.pos[2]]), fov: 55,
        player: {
          pos: [rpA.pos[0], rpA.pos[1] + 0.85, rpA.pos[2]], yaw: rpA.yaw, pitch: rpA.pitch + 0.17, bank: rpA.bank,
          speed: 45, air: true, wheelSteer: 0.05,
        },
        freezeSim: true, tag: 'drive-state',
      })
    }
    Debug.registerPose('state_nitro', {
      camera: rotAt(rp.yaw, [3.5, 1.1, 4.6], rp.pos),
      look: rotAt(rp.yaw, [0, 0.45, 1.1], rp.pos), fov: 58,
      player: {
        pos: rp.pos, yaw: rp.yaw, pitch: rp.pitch + 0.02, bank: rp.bank,
        speed: 52, nitroLevel: 1, brakeGlow: 0,
      },
      freezeSim: true, tag: 'drive-state',
    })
    Debug.registerPose('state_recovery', {
      camera: rotAt(rp.yaw - 0.42, [-4.5, 1.25, 4.35], rp.pos),
      look: rotAt(rp.yaw - 0.42, [0, 0.55, 0.5], rp.pos), fov: 58,
      player: {
        pos: rp.pos, yaw: rp.yaw - 0.42, pitch: rp.pitch - 0.05, bank: rp.bank,
        speed: 14, wheelSteer: 0.44, lean: -0.075, susp: -0.09, brakeGlow: 0.95,
      },
      freezeSim: true, tag: 'drive-state',
    })
  }

  /* ---------------- Phase 7 — the six-car grid (Gate C battery shot 1) -----
   * All six painted cars staggered on the start straight, grounded on their
   * deterministic grid slots through the host's parkAi path, start-light
   * gantry over the seam dead ahead. parkAi holds the field regardless of
   * any race state, so the frame is fully repeatable run to run. */
  {
    const L = slice.spline.length
    const camS = L - (RACE.gridFront + 2 * RACE.gridRowGap + 19)
    const f = slice.spline.frame(camS)
    const g0 = gridSlot(0, L)
    const rp = roadPose(slice.spline, g0.s, g0.lat)
    const lg = slice.spline.frame(L - 4)
    Debug.registerPose('grid', {
      camera: [f.pos.x + f.side.x * 1.7, slice.spline.surfaceY(camS, 0) + 2.75, f.pos.z + f.side.z * 1.7],
      look: [lg.pos.x + lg.side.x * 0.2, lg.pos.y + 4.1, lg.pos.z + lg.side.z * 0.2],
      fov: 52,
      player: { pos: rp.pos, yaw: rp.yaw, pitch: rp.pitch, bank: rp.bank, speed: 0, brakeGlow: 0.4 },
      freezeSim: true, parkAi: true, tag: 'grid',
    })
  }

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

  // Gate C1 round-1 grounding evidence: the rebuilt CoastalCliff_Dune prefab
  // (sea verge) + inland broadleaf strip seen from the beach — in-shadow
  // terrain, real sun, no display raft.
  {
    const sD = slice.spline.sFromX(44)
    const rp = roadPose(slice.spline, sD, -1.5)
    Debug.registerPose('coast_dunes', {
      camera: [22, slice.field.height(22, -58) + 2.4, -58],
      look: [38, 1.5, -22],
      fov: 55,
      player: { pos: rp.pos, yaw: rp.yaw, pitch: rp.pitch, bank: rp.bank, speed: 0 },
      freezeSim: true, tag: 'ground',
    })
  }

  /* ---------------- Phase 5 Gate C — one frame per circuit section ---------
   * Driver's-eye (plus one structural) vantage per authored section, on the
   * racing line at section speed, so what is judged is what a player sees.
   * The rig trails the car along the travel direction (matching heroShot: the
   * heading vector for yaw is (-sin yaw, 0, -cos yaw)) and looks ahead. */
  {
    const sec = (name: string, s: number, lat: number, fov: number, speed: number, opt: { back?: number, rise?: number, side?: number, lead?: number, lookRise?: number, lookSide?: number, tag?: string } = {}): void => {
      const rp = roadPose(slice.spline, s, lat)
      const fx = -Math.sin(rp.yaw), fz = -Math.cos(rp.yaw)      // travel direction
      const sx = Math.cos(rp.yaw), sz = -Math.sin(rp.yaw)       // driver-right
      const back = opt.back ?? 7.4, rise = opt.rise ?? 2.05, side = opt.side ?? 0
      const lead = opt.lead ?? 26, lookRise = opt.lookRise ?? 1.1, lookSide = opt.lookSide ?? 0
      const px = rp.pos[0], py = rp.pos[1], pz = rp.pos[2]
      Debug.registerPose(name, {
        camera: [px - fx * back + sx * side, py + rise, pz - fz * back + sz * side],
        look: [px + fx * lead + sx * lookSide, py + lookRise, pz + fz * lead + sz * lookSide],
        fov,
        player: { pos: rp.pos, yaw: rp.yaw, pitch: rp.pitch, bank: rp.bank, speed },
        freezeSim: true, tag: opt.tag ?? 'circuit',
      })
    }
    sec('section_coastal', 150, 0, 62, 44, { tag: 'coastal' })              // dune verge + CAPE MARLO ahead
    sec('section_city', 2700, 0, 62, 38, { tag: 'start' })                   // pit wall frontage, city outskirts
    sec('section_industrial', 560, 0, 62, 32, { tag: 'industrial' })          // yards, gantries, hazard kerbs
    sec('section_tunnel', 1005, 0, 60, 42, { lead: 30, tag: 'tunnel' })       // looking into the portal face
    sec('tunnel_contrast', 1150, 0, 68, 44, { back: 5.6, rise: 1.85, lead: 34, tag: 'tunnel' }) // inside → exit
    sec('section_elevated', 1520, 0, 62, 46, { lead: 30, rise: 2.35, lookRise: 0.7, tag: 'elevated' }) // deck flying over the north city
    sec('deck_structure', 1600, 0, 55, 0, { back: 3, rise: -3.4, side: 26, lookSide: -8, tag: 'elevated' }) // parapets, pylons, soffit
    sec('section_final', 2250, 0, 63, 50, { tag: 'final' })                   // high-speed esses on the ridge
    sec('section_shortcut', 2628, 0, 62, 40, { lead: 30, tag: 'shortcut' })   // the guarded spur taking off
    sec('section_finish', 3088, 0, 62, 44, { lead: 34, tag: 'finish' })        // gantry + chequered line over the seam
    sec('finish_line', 3096, 0, 50, 40, { back: 7.5, lead: 15, rise: 1.7, tag: 'finish' }) // close read of the chequered grid under the gantry
  }

  /* ---------------- Phase 4 Gate C1/M — kit boards (dev-only showcases) ----
   * Each board lives in its own isolated zone (fog hides neighbours) so no
   * horizon contamination; boards render FULL detail (lod:false) — the LOD
   * silhouettes are judged on the dedicated far rows / slice frames. */
  {
    const pad = (cx: number, cz: number, w = 220, d = 130, col = 0x6b6155): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 8, d), new THREE.MeshStandardMaterial({ color: col, roughness: 0.9, metalness: 0.02, emissive: new THREE.Color(col).multiplyScalar(0.72) }))
      m.position.set(cx, -4, cz)
      m.receiveShadow = true
      m.castShadow = false
      view.scene.add(m)
    }
    const kitRand = (): Rand => new Rand(20260917)
    // --- buildings: two curated rows, front-to-camera, tight hero framing ---
    {
      const BX = 1600
      const row = new THREE.Group()
      row.name = 'board-buildings'
      const front: BuildingDesignId[] = ['cafe', 'terrace', 'retail', 'substation', 'apartment', 'office']
      const back: BuildingDesignId[] = ['civic', 'warehouse', 'factory', 'silo', 'carpark']
      front.forEach((id, i) => {
        const b = buildBuilding(id, kitRand(), true)
        b.position.set((i - 2.5) * 16.5, 0, 10)
        row.add(b)
      })
      back.forEach((id, i) => {
        const b = buildBuilding(id, kitRand(), true)
        b.position.set((i - 2) * 21, 0, 40)
        row.add(b)
      })
      row.position.set(BX, 0, 0)
      view.scene.add(row)
      pad(BX, 24, 230, 110)
      Debug.registerPose('kit_buildings', {
        camera: [BX, 12, -52], look: [BX, 5.5, 16], fov: 62,
        player: { pos: [BX, -600, -60], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit', shadowSpan: 240,
      })
    }
    // --- props: three converging rows, camera close enough to read greebles ---
    {
      const BX = 1600, BZ = 1000
      const row = new THREE.Group()
      row.name = 'board-props'
      const smalls = [
        () => makeBollard(), () => makeCones(new Rand(3)), () => makeDrum(), () => makePallet(2), () => makeCrates(new Rand(5)),
        () => makeTyreStack(4), () => makeBin(), () => makeHydrant(), () => makeBench(), () => makePlanter(1.9),
      ]
      smalls.forEach((f, i) => { const o = f(); o.position.set(i * 4.4 - 20, 0, 6); row.add(o) })
      const mids = [
        () => makeSign('jump', 2.4, 1.2), () => makeSign('speed', 1.4, 1.4, false), () => makeTrafficLight(new Rand(2)),
        () => makeUtilityPole(new Rand(3)), () => makeStreetlight(new Rand(4), 6.4), () => makeMastLight(new Rand(5)),
        () => makeContainer(0x2e6470, 7), () => makeBarrierUnit(3), () => makePipeStack(new Rand(6)), () => makeVan(0x7a8288, new Rand(8)),
      ]
      mids.forEach((f, i) => { const o = f(); o.position.set(i * 6.8 - 30, 0, 17); row.add(o) })
      const bigs = [
        () => makeSignGantry('jump', 8), () => makeBillboard('rush'), () => makeBillboard('tyreking'),
        () => makeRadioMast(20), () => makeWaterTower(), () => makeGantryCrane(new Rand(11)),
      ]
      bigs.forEach((f, i) => { const o = f(); o.position.set(i * 15.5 - 39, 0, 38); row.add(o) })
      row.position.set(BX, 0, BZ)
      row.traverse((o) => { if ((o as unknown as { isMesh?: boolean }).isMesh) o.castShadow = true })
      view.scene.add(row)
      pad(BX, BZ + 22, 240, 160)
      Debug.registerPose('kit_props', {
        camera: [BX, 1.9, BZ - 13], look: [BX, 2.6, BZ + 16], fov: 58,
        player: { pos: [BX, -600, BZ - 24], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit', shadowSpan: 260,
      })
    }
    // --- vegetation: species near row + decimated-LOD silhouette far row ---
    {
      const BX = 1600, BZ = 2000
      const row = new THREE.Group()
      row.name = 'board-vegetation'
      // each specimen gets its own seeded Rand so the board is deterministic
      // and every species shows a representative specimen (no seed flukes)
      const sp = (fn: (r: Rand, l: number) => THREE.BufferGeometry, seed: number) =>
        ({ near: () => fn(new Rand(seed), 1), far: () => fn(new Rand(seed), 0) })
      const species = [
        sp(palmGeometry, 101), sp(palmGeometry, 102),
        sp(pineGeometry, 201), sp(pineGeometry, 202),
        sp(broadleafGeometry, 301), sp(broadleafGeometry, 302),
      ]
      species.forEach((sp, i) => {
        const t = treeLOD(sp.near(), sp.far(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide }))
        t.position.set(i * 5.6 - 14, 0, 6)
        t.scale.setScalar(0.85 + (i % 3) * 0.18)
        t.rotation.y = (i * 0.7) % 6.28
        row.add(t)
      })
      const rb = new Rand(21)
      for (let i = 0; i < 4; i++) {
        const bm = new THREE.Mesh(bushGeometry(rb), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, side: THREE.DoubleSide }))
        bm.position.set(i * 3.4 + 22, 0, 6.5)
        bm.scale.setScalar(0.7 + (i % 2) * 0.5)
        bm.castShadow = true
        row.add(bm)
      }
      const rr = new Rand(31)
      for (let i = 0; i < 3; i++) {
        const rk = new THREE.Mesh(rockGeometry(rr, 10 + i), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }))
        rk.position.set(i * 4.2 + 36, 0, 7)
        rk.scale.setScalar(1.1 + (i % 2) * 1.1)
        rk.castShadow = true
        row.add(rk)
      }
      // far row = the LOD1 silhouettes at judgment distance
      species.forEach((sp, i) => {
        const m = new THREE.Mesh(sp.far(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, side: THREE.DoubleSide }))
        m.position.set(i * 5.6 - 14, 0, 24)
        m.scale.setScalar(0.85 + (i % 3) * 0.18)
        row.add(m)
      })
      row.position.set(BX, 0, BZ)
      row.traverse((o) => { if ((o as unknown as { isMesh?: boolean }).isMesh) o.castShadow = true })
      view.scene.add(row)
      pad(BX, BZ + 12, 200, 100)
      Debug.registerPose('kit_vegetation', {
        camera: [BX, 2.8, BZ - 20], look: [BX, 2.2, BZ + 12], fov: 52,
        player: { pos: [BX, -600, BZ - 32], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit', shadowSpan: 200,
      })
    }
    // --- cluster/infra boards: separate column, 400m apart, full detail ----
    {
      const CX = 3400
      const mk = (id: Parameters<typeof composePrefab>[0], x: number, z: number, seed: number, elev = 0, rotY = 0, scl = 1): void => {
        const pre = composePrefab(id, { seed, field: () => elev, lod: false })
        pre.position.set(x, 0, z)
        pre.rotation.y = rotY
        pre.scale.setScalar(scl)
        pre.traverse((o) => { if ((o as unknown as { isMesh?: boolean }).isMesh) o.castShadow = true })
        view.scene.add(pre)
      }
      const CITY = 3000
      mk('CityBlock_Street', CX - 34, CITY, 0xc1)
      mk('CityBlock_Corner', CX + 40, CITY, 0xc2)
      pad(CX, CITY, 200, 150)
      Debug.registerPose('kit_clusters', {
        camera: [CX, 13, CITY - 72], look: [CX, 7, CITY + 8], fov: 47,
        player: { pos: [CX, -600, CITY - 70], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit', shadowSpan: 220,
      })
      const IND = CITY + 400
      mk('IndustrialCluster_Yard', CX - 26, IND, 0xc3)
      mk('IndustrialCluster_Plant', CX + 28, IND, 0xc4)
      pad(CX, IND, 210, 160)
      Debug.registerPose('kit_industrial', {
        camera: [CX, 8.5, IND - 40], look: [CX, 4.2, IND + 6], fov: 52,
        player: { pos: [CX, -600, IND - 52], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit', shadowSpan: 240,
      })
      const INF = CITY + 1500
      mk('TunnelApproach_Portal', CX - 26, INF + 8, 0xc5)
      mk('BridgeSegment_Deck', CX + 10, INF, 0xc6, 2.8, Math.PI / 2)
      mk('CoastalCliff_Dune', CX + 38, INF + 14, 0xc7, 0, 0, 2.4)
      pad(CX + 6, INF + 12, 300, 130)
      Debug.registerPose('kit_infra', {
        camera: [CX + 6, 5.2, INF - 46], look: [CX + 6, 2.4, INF + 8], fov: 52,
        player: { pos: [CX + 6, -600, INF - 62], yaw: Math.PI, speed: 0 }, freezeSim: true, tag: 'kit', shadowSpan: 320,
      })
      const SKY = CITY + 900
      const SKX = CX + 2200
      mk('Skyline_Backdrop', SKX, SKY - KIT.skyline.bandZ, 0xc8)
      pad(SKX, SKY - KIT.skyline.bandZ + 6, 460, 60)
      Debug.registerPose('kit_skyline', {
        camera: [SKX + 40, 52, SKY + 430], look: [SKX + 40, 14, SKY - KIT.skyline.bandZ], fov: 38,
        player: { pos: [SKX, -600, SKY + 58], yaw: 0, speed: 0 }, freezeSim: true, tag: 'kit', shadowSpan: 520,
      })
    }
    // Gate M material matrix: road + sea + cluster + car rubber all in one.
    {
      const sA = slice.spline.sFromX(88)
      const cPose = roadPose(slice.spline, sA, -3.4)
      const sB = slice.spline.sFromX(79)
      const rp = roadPose(slice.spline, sB, -0.4)
      const cLook = roadPose(slice.spline, slice.spline.sFromX(50), 1.6)
      Debug.registerPose('materials_matrix', {
        camera: [cPose.pos[0], cPose.pos[1] + 1.7, cPose.pos[2]],
        look: [cLook.pos[0], cLook.pos[1] + 1.0, cLook.pos[2]],
        fov: 55,
        player: { pos: rp.pos, yaw: rp.yaw, pitch: rp.pitch, bank: rp.bank, speed: 30 },
        freezeSim: true, tag: 'gate-m',
      })
    }
  }

  /* ---------------- dev probes (removed with the harness, spec §23.4) ------ */
  ;(globalThis as unknown as { __densityAudit?: () => object }).__densityAudit = densityAudit
  ;(globalThis as unknown as { __tally?: () => object }).__tally = () => {
    const byRoot: Record<string, { meshes: number; tris: number; names: Record<string, number> }> = {}
    for (const root of view.scene.children) {
      const key = root.name || root.type
      const e = byRoot[key] ?? (byRoot[key] = { meshes: 0, tris: 0, names: {} })
      root.traverse((o: unknown) => {
        const m = o as THREE.Mesh
        if (!m.isMesh || !m.visible) return
        const g = m.geometry as THREE.BufferGeometry
        const cnt = g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3
        e.meshes++; e.tris += cnt
        e.names[m.name || '?'] = (e.names[m.name || '?'] ?? 0) + 1
      })
    }
    return byRoot
  }
  /* Phase 9 perf-sampler support (same dev-harness class as __probe/__tally,
     removed with the harness in Phase 10): per-frame station/zone tag, tier +
     pipeline diagnostics, and the rAF frame-time sampler the node harness
     (scripts/perf.mjs) drives. Read-only on game state; installed on demand. */
  ;(globalThis as unknown as { __perfZone?: () => object }).__perfZone = () => ({
    s: Math.round(game.player.phys.s * 10) / 10,
    zone: slice.field.zoneAt(game.player.phys.x, game.player.phys.z),
    phase: game.director.phase,
  })
  let gpuInfo: { renderer: string | null; vendor: unknown } | null = null
  let drawingCache: { pr: number; w: number; h: number; str: string } | null = null
  ;(globalThis as unknown as { __perfDiag?: () => object }).__perfDiag = () => {
    const pr = view.gl.getPixelRatio()
    const w = window.innerWidth, h = window.innerHeight
    if (!drawingCache || drawingCache.pr !== pr || drawingCache.w !== w || drawingCache.h !== h) {
      const sz = view.gl.getDrawingBufferSize(new THREE.Vector2())
      drawingCache = { pr, w, h, str: `${sz.x}x${sz.y}` }
    }
    return {
      tier: view.tier,
      pixelRatio: Math.round(pr * 100) / 100,
      drawing: drawingCache.str,
      shadowMap: view.sun.shadow.mapSize.width,
      bloom: (view.debugPipeline.bloom as unknown as { strength: number }).strength,
      geometries: view.gl.info.memory.geometries,
      textures: view.gl.info.memory.textures,
      calls: view.lastChain.calls,
      tris: view.lastChain.tris,
      heapMb: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1e5) / 10
        : null,
      fps: Math.round(view.fps),
      gpu: (() => {
        if (gpuInfo) return gpuInfo
        const gl = view.gl.getContext()
        const ext = gl.getExtension('WEBGL_debug_renderer')
        gpuInfo = { renderer: ext ? String(ext.debugRendererInfoWEBGL()).trim() : null, vendor: gl.getParameter(0x1f00) }
        return gpuInfo
      })(),
    }
  }
  ;(globalThis as unknown as { __perfStart?: () => void }).__perfStart = () => {
    const rec = globalThis as unknown as { __perfFrames?: unknown[]; __perfHeap?: unknown[] }
    rec.__perfFrames = []
    rec.__perfHeap = []
    const diagFn = (globalThis as unknown as { __perfDiag: () => Record<string, unknown> }).__perfDiag
    const zoneFn = (globalThis as unknown as { __perfZone: () => { s: number; zone: string; phase: string } }).__perfZone
    let last = -1
    const tick = (t: number): void => {
      if (last >= 0) {
        const d = diagFn()
        const z = zoneFn()
        ;(rec.__perfFrames as unknown[]).push({ t, dt: t - last, calls: d.calls, tris: d.tris, s: z.s, zone: z.zone, tier: d.tier, phase: z.phase })
      }
      last = t
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      if (mem) (rec.__perfHeap as unknown[]).push({ t, usedMb: Math.round(mem.usedJSHeapSize / 1e5) / 10 })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  /* Per-frame RENDER-SET attribution (dev probe): __tally() counts the whole
     scene graph regardless of culling, so it cannot explain the draw-call
     count. This walks the two render sets three.js draws per chain — main
     pass (visible ∩ camera frustum) and shadow pass (casters ∩ shadow-map
     frustum) — attributing meshes/tris to scene roots with the renderer's
     own Frustum.intersectsObject test. Read-only. */
  const frScratch = {
    camFr: new THREE.Frustum(), shFr: new THREE.Frustum(),
    m4: new THREE.Matrix4(),
    tmpCam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500),
  }
  ;(globalThis as unknown as { __perfRenderSet?: () => object }).__perfRenderSet = () => {
    const { camFr, shFr, m4, tmpCam } = frScratch
    const cam = view.camera
    m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    camFr.setFromProjectionMatrix(m4)
    // shadow-map frustum: the ortho camera lives at the light, aimed at target
    const sc = view.sun.shadow.camera
    tmpCam.left = sc.left; tmpCam.right = sc.right; tmpCam.top = sc.top; tmpCam.bottom = sc.bottom
    tmpCam.near = sc.near; tmpCam.far = sc.far
    tmpCam.updateProjectionMatrix()
    tmpCam.position.copy(view.sun.position)
    tmpCam.up.set(0, 1, 0)
    tmpCam.lookAt(view.sun.target.position)
    tmpCam.updateMatrixWorld(true)
    m4.multiplyMatrices(tmpCam.projectionMatrix, tmpCam.matrixWorldInverse)
    shFr.setFromProjectionMatrix(m4)
    const groups: Record<string, { main: number; mainTris: number; shadow: number; shadowTris: number }> = {}
    const gOf = (k: string): { main: number; mainTris: number; shadow: number; shadowTris: number } => (groups[k] ?? (groups[k] = { main: 0, mainTris: 0, shadow: 0, shadowTris: 0 }))
    let mainTotal = 0, shadowTotal = 0
    for (const root of view.scene.children) {
      const key = root.name || root.type
      const rec = gOf(key)
      root.traverse((o: THREE.Object3D) => {
        const m = o as THREE.Mesh
        if (!m.isMesh || !m.visible || !m.frustumCulled) return
        const g = m.geometry as THREE.BufferGeometry
        const tris = (g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3) | 0
        const inCam = !m.frustumCulled || camFr.intersectsObject(o)
        if (inCam) { rec.main++; rec.mainTris += tris; mainTotal++ }
        if (m.castShadow && (!m.frustumCulled || shFr.intersectsObject(o))) { rec.shadow++; rec.shadowTris += tris; shadowTotal++ }
      })
    }
    return { mainTotal, shadowTotal, groups }
  }
  ;(globalThis as unknown as { __probe?: () => object }).__probe = () => ({
    buildMs: (globalThis as unknown as { __buildMs?: number }).__buildMs ?? null,
    fps: Math.round(view.fps),
    frames: game.frameCount,
    title: document.title,
    err: !($('error-screen') as HTMLElement)?.classList.contains('hidden') ? (($('error-body') as HTMLElement)?.textContent ?? '').slice(0, 600) : null,
    loadingHidden: $('loading')?.classList.contains('hidden') ?? false,
    cam: `${view.camera.position.x.toFixed(1)},${view.camera.position.y.toFixed(1)},${view.camera.position.z.toFixed(1)} fov${Math.round(view.camera.fov)}`,
    children: view.scene.children.length,
    calls: view.lastChain.calls,
    tris: view.lastChain.tris,
    geometries: view.gl.info.memory.geometries,
    glErr: view.gl.getContext().getError(),
    ctxLost: view.gl.getContext().isContextLost(),
  })
  ;(globalThis as unknown as { __carState?: () => object }).__carState = () => ({
    x: Math.round(game.player.phys.x * 100) / 100,
    y: Math.round(game.player.phys.y * 100) / 100,
    z: Math.round(game.player.phys.z * 100) / 100,
    speed: Math.round(game.player.phys.speed * 100) / 100,
    drift: Math.round(game.player.phys.drift * 100) / 100,
    grounded: game.player.phys.grounded,
    nitro: Math.round(game.player.nitroVal),
    respawning: game.player.respawning,
    simTime: Math.round(game.simTime * 10) / 10,
    racePhase: game.director.phase,
    countdown: Math.round(game.director.countdown * 100) / 100,
    raceTime: Math.round(game.director.simTime * 100) / 100,
    position: game.director.positionOf(0),
  })
  /* dev race probes: they route through the same host seam as the UI, so the
     formal title/results flow stays true under Playwright too; a finished
     race restarts clean. The shots battery never presses them, so approved
     frames stay race-independent. */
  ;(globalThis as unknown as { __startRace?: () => string }).__startRace = () => {
    if (game.director.phase === 'finished' || game.director.phase === 'idle') game.beginRace()
    return game.director.phase
  }
  ;(globalThis as unknown as { __raceState?: () => object }).__raceState = () => ({
    phase: game.director.phase,
    countdown: Math.round(game.director.countdown * 100) / 100,
    simTime: Math.round(game.director.simTime * 100) / 100,
    standings: game.director.standingsFor().map((r) => ({ id: r.id, pos: r.position, pct: Math.round(r.fraction * 1000) / 10, cps: r.checkpoints, fin: r.finished ? Math.round(r.finishTime * 100) / 100 : null })),
  })
  // Enter confirm is owned by the central Input -> UIManager path (no raw
  // key handler here): title/Enter -> START, results/Enter -> RESTART.

  // ---- dev-only Gate A probes ------------------------------------------------
  function halfBits(h: number): number {
    const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x3ff
    if (e === 0x1f) return f !== 0 ? NaN : s === 0 ? Infinity : -Infinity
    if (e === 0) return (s === 0 ? 1 : -1) * f * Math.pow(2, -24)
    return (s === 0 ? 1 : -1) * Math.pow(2, e - 15) * (1 + f / 1024)
  }
  ;(globalThis as unknown as { __bisect?: () => Record<string, unknown> }).__bisect = () => {
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
  }
  ;(globalThis as unknown as { __tireDbg?: () => unknown }).__tireDbg = () => {
    const w = car.wheels[1]
    const holder = w.steer ?? w.spin
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

  ;(globalThis as unknown as { __wheelScan?: () => unknown }).__wheelScan = () => {
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

  ;(globalThis as unknown as { __carInfo?: () => Record<string, unknown> }).__carInfo = () => {
    const box = new THREE.Box3().setFromObject(car.group)
    const wheels = car.wheels.map((w) => {
      const wb2 = new THREE.Box3().setFromObject(w.steer ?? w.spin.parent ?? w.spin)
      return { front: w.front, min: wb2.min.toArray().map((v) => Math.round(v * 100) / 100), max: wb2.max.toArray().map((v) => Math.round(v * 100) / 100) }
    })
    const parts: { name: string; vis: boolean }[] = []
    for (const ch of car.group.children) parts.push({ name: ch.name, vis: ch.visible })
    return {
      carBox: { min: box.min.toArray().map((v) => Math.round(v * 1000) / 1000), max: box.max.toArray().map((v) => Math.round(v * 1000) / 1000) },
      wheels, parts,
    }
  }

/* ---------------------------------------------------------------------------
 * Formal boot flow (Phase 8): loading -> title -> race. The world builds
 * synchronously inside Game's constructor; the loading bar steps across
 * deferred frames so each stage actually paints, the bar retires through
 * UIManager (keeping the Playwright __probe().loadingHidden contract), and
 * the title board hands over to the race through the Input/UIManager path
 * (START RACE button or the Enter confirm action).
 * ------------------------------------------------------------------------- */
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
