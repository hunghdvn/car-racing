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
    new THREE.MeshStandardMaterial({ color: 0xa07940, roughness: 0.94 }),
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

  // ---- deterministic validation poses (Gate A) --------------------------------
  Debug.registerPoses([
    ['car_front', { camera: [0, 0.80, -6.05], look: [0, 0.58, 0], fov: 33, player: { pos: [0, 0, 0], yaw: 0, speed: 0 }, freezeSim: true }],
    ['car_rear', { camera: [0, 0.95, 6.05], look: [0, 0.60, 0], fov: 33, player: { pos: [0, 0, 0], yaw: 0, speed: 0 }, freezeSim: true }],
    ['car_side', { camera: [7.55, 0.64, 0.10], look: [0, 0.58, 0], fov: 26, player: { pos: [0, 0, 0], yaw: 0, speed: 0 }, freezeSim: true }],
    ['car_fq3', { camera: [4.28, 0.98, -4.28], look: [0, 0.58, 0], fov: 33, player: { pos: [0, 0, 0], yaw: 0, speed: 0 }, freezeSim: true }],
    ['car_rq3', { camera: [4.35, 1.10, 4.35], look: [0, 0.60, 0], fov: 33, player: { pos: [0, 0, 0], yaw: 0, speed: 0 }, freezeSim: true }],
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
    passes[0].renderToScreen = false
    passes[0].render(view.gl, c.writeBuffer, rb, 0, false)
    r.sceneOnly = statRT2(rb)
    passes[1].renderToScreen = false
    passes[1].render(view.gl, c.writeBuffer, rb, 0, false)
    r.afterBloom = statRT2(rb)
    const bl = dp.bloom as Record<string, any>
    r.bright = statRT2(bl.renderTargetBright)
    // geometry scan
    const geo: Record<string, unknown> = {}
    const nz = new THREE.Vector3()
    car.group.traverse((o: unknown) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const g = m.geometry as THREE.BufferGeometry
      const nAttr = g.getAttribute("normal") as THREE.BufferAttribute | undefined
      const pAttr = g.getAttribute("position") as THREE.BufferAttribute
      let badN = 0, badP = 0, zeroN = 0
      if (nAttr) for (let i = 0; i < nAttr.count; i++) {
        nz.set(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i))
        if (!Number.isFinite(nz.x) || !Number.isFinite(nz.y) || !Number.isFinite(nz.z)) badN++
        else if (nz.lengthSq() < 1e-6) zeroN++
      }
      for (let i = 0; i < pAttr.count; i++) {
        if (!Number.isFinite(pAttr.getX(i)) || !Number.isFinite(pAttr.getY(i)) || !Number.isFinite(pAttr.getZ(i))) badP++
      }
      if (badN || badP || zeroN) geo[m.name || g.type] = { verts: pAttr.count, badN, badP, zeroN, mat: (m.material as THREE.Material).type }
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