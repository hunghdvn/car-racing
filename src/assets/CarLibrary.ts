import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clamp01 } from '../util'
import { brandingOn, rigKeyOf } from '../vehicles/CarSpecs'
import type { CarId, CarSpec } from '../vehicles/CarSpecs'
import { CAR_RIGS } from './CarRigs'
import { carMaterialParamsFor } from './MaterialSpecs'
import { CAR_BRAKE_PART_RE, CAR_CONTRACT, markCarGeometryShared, markGLBMaterialShared, RIG_BANDS } from './CarShared'
import { makeCarPaintMaterial, shared, type CarModel, type WheelHandle } from './CarModel'

/* ------------------------------------------------------------------------- *
 * Real-car preload cache (spec §5, Task 5).
 *
 * The GLBs committed to public/models/ are produced by the offline pipeline
 * (scripts/optimize-cars.mjs): single scene, `vr-rig` grouper (unit scale,
 * wheels-on-ground, nose at −z), canonical `wheel-<corner>-lr` pivots with
 * `brake-*`/`caliper-*` descendants, and `paint-*` / `glass-*` / `caliper-*`
 * material names. This module loads them ONCE at boot and hands buildCar
 * synchronous clones; every miss (offline dev, bad asset) returns null and
 * the caller falls back to the procedural builder.
 * ------------------------------------------------------------------------- */

const CAR_IDS = Object.keys(CAR_RIGS) as CarId[]

let preload: Promise<void> | null = null
const cache = new Map<CarId, THREE.Group>()

/* session kill switch (?proc=1, harness override): force every buildCar back
 * to the procedural builder — A/B shots, offline dev, and the functional
 * battery's proc-fallback rec all lean on this. */
let forcedProcedural = typeof location !== 'undefined' && new URLSearchParams(location.search).has('proc')
export function forceProcedural(): boolean { return forcedProcedural }
export function setForceProcedural(v: boolean): void { forcedProcedural = v }

export function libraryReady(): boolean {
  return cache.size === CAR_IDS.length
}

/** Idempotent boot preload. Failures never reject: a missing GLB simply keeps
 *  that id out of the cache, and buildCar falls back procedural for it. */
export function preloadCars(): Promise<void> {
  if (!preload) {
    const loader = new GLTFLoader()
    preload = Promise.all(CAR_IDS.map((id) =>
      loader.loadAsync(`/models/${id}.glb`)
        .then((glb) => [id, glb.scene] as const)
        .catch((e) => { console.warn(`[carlib] ${id}: load failed —`, String(e).slice(0, 140)); return null }),
    )).then((loaded) => {
      for (const entry of loaded) {
        if (!entry) continue
        const [id, scene] = entry
        // every buffer + material is shared by all clones of this id —
        // disposeCarTree must spare them (CarShared spares-list)
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          markCarGeometryShared(mesh.geometry)
          for (const m of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
            // the pipeline synthesizes the brake disc as a single-sided fan
            // and two caliper faces wind inward — three culls them and the
            // hub reads hollow through the spokes (PR #21 review). DoubleSide
            // on the template once: every clone inherits it.
            if (CAR_BRAKE_PART_RE.test(m.name ?? '')) m.side = THREE.DoubleSide
            markGLBMaterialShared(m)
          }
        })
        cache.set(id, scene)
      }
      if (!libraryReady()) console.warn(`[carlib] ${cache.size}/${CAR_IDS.length} models cached`)
    })
  }
  return preload
}

export function disposeLibrary(): void {
  for (const scene of cache.values()) {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry?.dispose()
      for (const m of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) m.dispose()
    })
  }
  cache.clear()
  preload = null
}

/** The cached template for one id (functional battery: clone-vs-template
 *  geometry identity + the per-id load-failure rec). Null when not cached. */
export function getTemplate(id: CarId): THREE.Group | null {
  return cache.get(id) ?? null
}

const byName = (root: THREE.Object3D, name: string): THREE.Object3D | null => {
  let found: THREE.Object3D | null = null
  root.traverse((o) => { if (!found && o.name === name) found = o })
  return found
}

/** per-id wordmark texture: canvas shield + maker name (Textures.ts idiom) */
const logoCache = new Map<string, THREE.CanvasTexture | null>()
function logoTexture(id: CarId, maker: string, accent: number): THREE.CanvasTexture | null {
  if (logoCache.has(id)) return logoCache.get(id)!
  if (typeof document === 'undefined') { logoCache.set(id, null); return null }
  const c = document.createElement('canvas')
  c.width = 256; c.height = 96
  const g = c.getContext('2d')
  if (!g) { logoCache.set(id, null); return null }
  g.clearRect(0, 0, 256, 96)
  g.beginPath()
  g.ellipse(128, 48, 118, 40, 0, 0, Math.PI * 2)
  g.fillStyle = '#10141b'
  g.fill()
  g.lineWidth = 6
  g.strokeStyle = `#${accent.toString(16).padStart(6, '0')}`
  g.stroke()
  g.fillStyle = '#e8ecf2'
  g.font = 'bold 34px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(maker.toUpperCase(), 128, 50)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  logoCache.set(id, t)
  return t
}

/**
 * Clone a cached GLB into a live CarModel. ANY structural violation of the
 * pipeline contract (missing wheel pivot, impossible radius) returns null so
 * buildCar keeps the car on the procedural path — a wrong rig must never ship.
 */
export function cloneRealCar(id: CarId, paintHex: number, spec: CarSpec): CarModel | null {
  // ONE key formula for rig AND template (PR #21 r4): the old template door
  // trusted the free-form `id` parameter, so rig and geometry could be read
  // from two spellings of the same fact. The rigId alias is authoritative.
  const key = rigKeyOf(spec)
  const rig = CAR_RIGS[key]
  const src = cache.get(key)
  if (!src) return null

  // validate the pipeline contract BEFORE mutating anything
  const corners = ['fl', 'fr', 'rl', 'rr'] as const
  const probe = byName(src, 'wheel-fl-lr')
  if (!probe) { console.warn(`[carlib] ${id}: wheel pivots missing from the cached GLB`); return null }
  for (const r of rig.wheelRadius) {
    if (!(r >= RIG_BANDS.radius[0] && r <= RIG_BANDS.radius[1])) { console.warn(`[carlib] ${id}: wheel radius ${r} outside the sane band`); return null }
  }

  const group = src.clone(true)
  group.name = `car-model-${id}`

  // per-instance materials: paint (the ONE mkPaint recipe, CarModel.ts),
  // caliper, glass
  const paintMat = makeCarPaintMaterial(paintHex, carMaterialParamsFor(spec).paint)
  // caliper tint comes from the catalog through MaterialSpecs — the same door
  // the procedural builder and the functional battery use (PR #21: the old
  // CarRigs.caliperColor literal column let a stale hand-pin diverge).
  // DoubleSide: two of the synthesized caliper box faces wind inward.
  const caliperMat = new THREE.MeshStandardMaterial({
    name: 'caliper-paint', // named so the functional battery can find + assert it (r3)
    color: carMaterialParamsFor(spec).caliper, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide,
  })
  const glassMat = shared.glass(spec.finish) // memoised field-wide singleton (same as procedural)
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const one = (m: THREE.Material): THREE.Material =>
      /^paint/.test(m.name ?? '') ? paintMat
        : (m.name ?? '').includes(CAR_CONTRACT.nodePrefixes.caliper) ? caliperMat
          : /^glass/.test(m.name ?? '') ? glassMat : m
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(one) : one(mesh.material)
    // Shadow rule (PR #21 r4, honest scope): opaque meshes cast, transparent
    // (glass/flames) don't, nothing receives. This is NOT full parity with
    // CarModel.finalize — the procedural builder carves small detail meshes
    // (SHADOWLESS_DETAIL: lamps, handles) out of the pass, while GLB partners
    // ship anonymous Object_* node names with no channel to mirror the
    // carve-out, so baked lamps/handles DO cast here. Accepted delta; if a
    // partner ever ships named detail nodes, extend the pipeline to rename
    // them and add the carve-out here.
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    mesh.castShadow = !mats.some((m) => m.transparent)
    mesh.receiveShadow = false
  })

  // wheel rebuild: canonical pivots → procedural handle contract
  // (steer group 'wheel-<c>' at the hub, 'wheel-spin' child, whole wheel
  // subtree reparented into spin so brake/caliper spin with it).
  // The pipeline BAKES wheel geometry in world space and leaves the pivot at
  // identity — node origins say nothing about the hub (they read the grouper
  // anchor). CAR_RIGS.wheelPos are the pipeline-measured hubs and the only
  // hub truth; the wheel's world box is validated against them so a stale
  // rig table or misbaked asset degrades to the procedural builder instead
  // of shipping wheels that orbit the cabin when steered.
  group.updateMatrixWorld(true)
  const wheels: WheelHandle[] = []
  const wbox = new THREE.Box3()
  for (let i = 0; i < 4; i++) {
    const corner = corners[i]
    const node = byName(group, `wheel-${corner}-lr`)
    if (!node) { console.warn(`[carlib] ${id}: wheel-${corner}-lr vanished mid-clone`); return null }
    const hub = new THREE.Vector3(rig.wheelPos[i][0], rig.wheelPos[i][1], rig.wheelPos[i][2])
    wbox.setFromObject(node)
    const cc = new THREE.Vector3()
    wbox.getCenter(cc)
    if (cc.distanceTo(hub) > 0.07 || wbox.min.y < -0.07 || wbox.min.y > 0.12) {
      console.warn(`[carlib] ${id}: ${corner} wheel box centre (${cc.x.toFixed(2)},${cc.y.toFixed(2)},${cc.z.toFixed(2)}) / bottom ${wbox.min.y.toFixed(2)} disagrees with the rig hub (${hub.x.toFixed(2)},${hub.y.toFixed(2)},${hub.z.toFixed(2)})`)
      return null
    }
    const steer = new THREE.Group(); steer.name = `wheel-${corner}`
    steer.position.copy(hub)
    const spin = new THREE.Group(); spin.name = 'wheel-spin'
    steer.add(spin)
    group.add(steer) // model space — NOT node.parent (the vr-rig grouper, whose TRS would double the hub)
    spin.attach(node) // keeps the baked world placement (bakes the grouper TRS in); parks spin's origin on the hub
    wheels.push({ steer, spin, radius: rig.wheelRadius[i], front: i < 2, hubY: rig.wheelPos[i][1] })
  }

  // lamp glow + brake + nitro add-ons (procedural idiom: bloom-safe emissives)
  const glowMat = (emissive: number, intensity: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: 0x14181f, emissive: new THREE.Color(emissive), emissiveIntensity: intensity, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.95 })
  const headMats: THREE.MeshStandardMaterial[] = []
  const brakeMats: THREE.MeshStandardMaterial[] = []
  if (rig.lampGlow) { // the rig knob is honoured (PR #21: was decorative)
    const geo = new THREE.PlaneGeometry(0.5, 0.18)
    const gy = rig.groundClearance + 0.42
    for (const i of [-1, 1]) {
      const hm = glowMat(0xfff1d6, 0.95)
      headMats.push(hm)
      const g = new THREE.Mesh(geo, hm)
      g.name = 'glow-front'
      g.position.set(i * 0.62, gy, rig.lampZ[0]) // measured lamp faces, not ±2.16 inside the shell
      g.rotation.y = Math.PI
      g.renderOrder = 2
      group.add(g)
      const bm = glowMat(0xff2518, 0.8)
      brakeMats.push(bm)
      const b = new THREE.Mesh(geo, bm)
      b.name = 'glow-rear'
      b.position.set(i * 0.62, gy, rig.lampZ[1])
      b.renderOrder = 2
      group.add(b)
    }
  }

  // rear badge decal (wordmark over the tail) — gated by brandingOn(spec) at
  // CLONE time, which decides whether the real-name decal TEXTURE is built
  // and uploaded at all (a cost decision, not a leak: an invisible mesh
  // reaches nobody but the console). The LIVE half of the escape hatch is
  // Game.refreshBranding → syncFieldBadges, which flips logo-rear visibility
  // on the running field, so a flag flip strips cars actually on track and
  // not just the garage cards (PR #21 r4: this comment promised the on-track
  // effect the clone gate alone could not deliver). ONE gate with the display
  // names: the old `?? true` here defaulted the OPPOSITE way from
  // carDisplayName — badge-printed a made-up maker while the name said
  // fictional (PR #21 r3).
  const logo = brandingOn(spec)
    ? logoTexture(id, spec.identity!.maker, spec.finish.accent)
    : null
  if (logo) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.2), new THREE.MeshBasicMaterial({ map: logo, transparent: true, depthWrite: false }))
    decal.name = 'logo-rear'
    decal.position.set(...rig.logoAnchor) // tail side (+z), measured tail face + 20 mm
    decal.renderOrder = 3
    group.add(decal) // plane normal +z ⇒ reads correctly from behind, no mirror
  }

  // nitro flames (hidden until setNitro; scale along the +z tail axis)
  const flameGeo = new THREE.ConeGeometry(0.09, 0.5, 10)
  flameGeo.rotateX(Math.PI / 2)
  const nitroTips: THREE.Object3D[] = []
  for (const [side, tag] of [[-1, 'nitro-left'], [1, 'nitro-right']] as const) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x59b8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    const flame = new THREE.Mesh(flameGeo, mat)
    flame.name = tag
    flame.position.set(...rig.nitroAnchor[side < 0 ? 0 : 1])
    // no z nudge: the pipeline bakes the anchor AT the tail face, 150 mm
    // inboard so the cone (which grows toward +z from its origin) exits the
    // bumper. The old + 0.12 here, stacked on the old TARGET_LEN constant,
    // put the flame ORIGIN inside the shell on long-tail cars (930: origin
    // 2.345 vs shell end 2.384 — over half the plume buried, PR #21 r3).
    group.add(flame)
    nitroTips.push(flame)
  }

  let brakeVal = 0
  return {
    group,
    wheels,
    paintMats: [paintMat],
    nitroTips,
    setBrake(v: number) {
      if (brakeVal === v) return
      brakeVal = v
      for (const bm of brakeMats) bm.emissiveIntensity = 0.80 + v * 3.20
    },
    setNitro(v: number) {
      for (const f of nitroTips) {
        const m = (f as THREE.Mesh).material as THREE.MeshBasicMaterial
        m.opacity = clamp01(v)
        f.scale.set(1, 1, 0.65 + clamp01(v) * 0.6)
      }
    },
    setHeadlights(on: boolean) {
      for (const hm of headMats) hm.emissiveIntensity = on ? 1.8 : 0.35
    },
    setPaint(hex: number) {
      paintMat.color.set(hex)
    },
  }
}
