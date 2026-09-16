import * as THREE from 'three'
import { Renderer } from './core/Renderer'
import { Sky } from './core/SkyEnv'
import { Debug } from './core/Debug'
import type { ShotPose } from './core/Debug'
import { buildCar, type CarModel } from './assets/CarModel'
import { ChaseCamera, type CarView } from './camera/ChaseCamera'
import { PAINTS, VEHICLE } from './config'

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

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(160, 72),
    new THREE.MeshStandardMaterial({ color: 0x8d8676, roughness: 0.96 }),
  )
  ground.rotateX(-Math.PI / 2)
  ground.receiveShadow = true
  view.scene.add(ground)

  const car: CarModel = buildCar(PAINTS[1].color)
  view.scene.add(car.group)
  const qp: Record<string, string> = {}
  for (const kv of location.search.slice(1).split('&')) { const i = kv.indexOf('='); if (i > 0) qp[kv.slice(0, i)] = kv.slice(i + 1) }
  if (qp['nocar']) car.group.visible = false
  if (qp['hide']) for (const tok of qp['hide'].split(',')) for (const ch of car.group.children) if (ch.name.includes(tok)) ch.visible = false
  if (qp['noshadow']) view.sun.castShadow = false
  if (qp['dblside']) car.group.traverse((o: unknown) => { const m = o as { isMesh?: boolean; material?: { side?: number } }; if (m.isMesh && m.material) m.material.side = THREE.DoubleSide })
  if (qp['flat']) car.group.traverse((o: unknown) => { const m = o as { isMesh?: boolean; material?: unknown }; if (m.isMesh) m.material = new THREE.MeshBasicMaterial({ color: 0xff2222 }) })
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

  // ---- deterministic validation poses (Gate A) --------------------------------
  Debug.registerPoses([
    ['car_front', { camera: [0, 0.92, -3.6], look: [0, 0.6, 0], fov: 57, player: { pos: [0, 0, 0], yaw: 0, speed: 0 }, freezeSim: true }],
    ['car_rear', { camera: [0, 1.05, 3.7], look: [0, 0.62, 0], fov: 57, player: { pos: [0, 0, 0], yaw: 0, speed: 0 }, freezeSim: true }],
    ['car_side', { camera: [3.7, 0.72, 0.0], look: [0, 0.58, 0], fov: 57, player: { pos: [0, 0, 0], yaw: 0, speed: 0 }, freezeSim: true }],
    ['car_fq3', { camera: [2.75, 1.0, -2.75], look: [0, 0.6, 0], fov: 57, player: { pos: [0, 0, 0], yaw: 0, speed: 0 }, freezeSim: true }],
    ['car_rq3', { camera: [2.7, 1.25, 2.7], look: [0, 0.62, 0], fov: 57, player: { pos: [0, 0, 0], yaw: 0, speed: 0 }, freezeSim: true }],
    ['car_drift', { camera: [2.6, 1.35, 2.6], look: [0, 0.6, 0], fov: 62, player: { pos: [0, 0, 0], yaw: 0, speed: 40, drift: true }, freezeSim: true }],
    ['car_nitro', { camera: [2.7, 1.25, 2.7], look: [0, 0.62, 0], fov: 62, player: { pos: [0, 0, 0], yaw: 0, speed: 50, nitro: true }, freezeSim: true }],
  ])

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
      car.group.rotation.set(0, yaw, 0)
      carView.speed = shotSpeed
      carView.yaw = yaw
      carView.nitro = shotNitro
      carView.drift = shotDrift ? 0.55 : 0
      car.setNitro(shotNitro ? 1 : 0)
      car.setBrake(shotSpeed > 30 ? 0.7 : 0)
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

  const clock = new THREE.Clock()
  let t = 0
  let loadingHidden = false
  let wheelAngle = 0
  let frameCount = 0

  function frame(): void {
    const dt = Math.min(clock.getDelta(), 0.05)
    frameCount++
    if (!simFrozen) {
      t += dt
      const speed = 14 + Math.sin(t * 0.35) * 11
      yaw += Math.sin(t * 0.21) * 0.32 * dt * 2.2
      pos.add(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(speed * dt))
      const bump = Math.sin(t * 7.3) * 0.012 + Math.sin(t * 13.7) * 0.006
      car.group.position.set(pos.x, bump, pos.z)
      car.group.rotation.set(-0.012 - speed * 0.0004, yaw, Math.sin(t * 0.4) * 0.022)
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
    view.render()
    if (!loadingHidden && t > 0.5) { loadingHidden = true; $('loading')?.classList.add('hidden') }
    document.title = `Velocity Rush — ${Math.round(view.fps)} fps — ${view.tier}`
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

try { boot() } catch (e) { fatal(e) }