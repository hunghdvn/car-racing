import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clamp01 } from '../util'
import type { CarId, CarSpec } from '../vehicles/CarSpecs'
import { CAR_RIGS } from './CarRigs'
import { carMaterialParamsFor } from './MaterialSpecs'
import { carPaintMaps, paintMicroRoughness } from './Textures'
import { markCarGeometryShared, markGLBMaterialShared } from './CarShared'
import { shared, type CarModel, type WheelHandle } from './CarModel'

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
/** CarModel.ts mkPaint's calibration anchor — kept literal so this module
 *  stays import-free of CarModel's value exports (ESM cycle safety). */
const HERO_MICRO = 0.293

let preload: Promise<void> | null = null
const cache = new Map<CarId, THREE.Group>()

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
          for (const m of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) markGLBMaterialShared(m)
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
  const src = cache.get(id)
  if (!src) return null
  const rig = CAR_RIGS[id]

  // validate the pipeline contract BEFORE mutating anything
  const corners = ['fl', 'fr', 'rl', 'rr'] as const
  const probe = byName(src, 'wheel-fl-lr')
  if (!probe) { console.warn(`[carlib] ${id}: wheel pivots missing from the cached GLB`); return null }
  for (const r of rig.wheelRadius) {
    if (!(r >= 0.2 && r <= 0.44)) { console.warn(`[carlib] ${id}: wheel radius ${r} outside the sane band`); return null }
  }

  const group = src.clone(true)
  group.name = `car-model-${id}`

  // per-instance materials: paint (mkPaint recipe from CarModel), caliper, glass
  const pp = carMaterialParamsFor(spec).paint
  const maps = carPaintMaps(7, pp.flakeSpeckle, pp.flakeRepeat)
  const ns = clamp01(0.5 + (pp.microRoughness - HERO_MICRO))
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: paintHex, metalness: pp.metalness, roughness: pp.roughness,
    roughnessMap: maps.roughnessMap, normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(ns, ns),
    clearcoat: pp.clearcoat, clearcoatRoughness: pp.clearcoatRoughness,
    clearcoatNormalMap: paintMicroRoughness(),
    sheen: pp.sheen, sheenRoughness: pp.sheenRoughness,
    envMapIntensity: pp.envMapIntensity,
  })
  const caliperMat = new THREE.MeshStandardMaterial({ color: rig.caliperColor, roughness: 0.4, metalness: 0.1 })
  const glassMat = shared.glass(spec.finish) // memoised field-wide singleton (same as procedural)
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const one = (m: THREE.Material): THREE.Material =>
      /^paint/.test(m.name ?? '') ? paintMat
        : /caliper/.test(m.name ?? '') ? caliperMat
          : /^glass/.test(m.name ?? '') ? glassMat : m
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(one) : one(mesh.material)
    if (mesh.material === paintMat) { mesh.castShadow = true; mesh.receiveShadow = true }
  })

  // wheel rebuild: canonical pivots → procedural handle contract
  // (steer group 'wheel-<c>' at the hub, 'wheel-spin' child, whole wheel
  // subtree reparented into spin so brake/caliper spin with it)
  group.updateMatrixWorld(true)
  const wheels: WheelHandle[] = []
  for (let i = 0; i < 4; i++) {
    const corner = corners[i]
    const node = byName(group, `wheel-${corner}-lr`)
    if (!node?.parent) { console.warn(`[carlib] ${id}: wheel-${corner}-lr vanished mid-clone`); return null }
    const hub = new THREE.Vector3()
    node.getWorldPosition(hub)
    const steer = new THREE.Group(); steer.name = `wheel-${corner}`
    steer.position.copy(hub)
    const spin = new THREE.Group(); spin.name = 'wheel-spin'
    steer.add(spin)
    node.parent.add(steer)
    spin.attach(node) // keeps the GLB hub's world transform under the new parents
    wheels.push({ steer, spin, radius: rig.wheelRadius[i], front: i < 2 })
  }

  // lamp glow + brake + nitro add-ons (procedural idiom: bloom-safe emissives)
  const glowMat = (emissive: number, intensity: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: 0x14181f, emissive: new THREE.Color(emissive), emissiveIntensity: intensity, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.95 })
  const headMats = [glowMat(0xfff1d6, 0.95), glowMat(0xfff1d6, 0.95)]
  const brakeMats = [glowMat(0xff2518, 0.8), glowMat(0xff2518, 0.8)]
  const glowGeo = new THREE.PlaneGeometry(0.5, 0.18)
  const gy = rig.groundClearance + 0.42
  const gz = 2.16
  for (const i of [-1, 1]) {
    const g = new THREE.Mesh(glowGeo, headMats[i < 0 ? 0 : 1])
    g.name = 'glow-front'
    g.position.set(i * 0.62, gy, -gz)
    g.rotation.y = Math.PI
    g.renderOrder = 2
    group.add(g)
    const b = new THREE.Mesh(glowGeo, brakeMats[i < 0 ? 0 : 1])
    b.name = 'glow-rear'
    b.position.set(i * 0.62, gy, gz)
    b.renderOrder = 2
    group.add(b)
  }

  // rear badge decal (wordmark over the tail, per-car accent)
  const logo = logoTexture(id, spec.identity?.maker ?? spec.name.split(' ')[0], spec.finish.accent)
  if (logo) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.2), new THREE.MeshBasicMaterial({ map: logo, transparent: true, depthWrite: false }))
    decal.name = 'logo-rear'
    decal.position.set(...rig.logoAnchor)
    decal.rotation.y = Math.PI
    decal.renderOrder = 3
    group.add(decal)
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
    flame.position.z += 0.12
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
