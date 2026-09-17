import * as THREE from 'three'
import { Renderer } from '../core/Renderer'
import { Sky } from '../core/SkyEnv'
import { Debug, type ShotPose } from '../core/Debug'
import { Input, type InputState } from '../core/Input'
import { buildCar, type CarModel } from '../assets/CarModel'
import { ChaseCamera, type CarView } from '../camera/ChaseCamera'
import { AI, GRAPHICS, PAINTS, type PaintDef } from '../config'
import { clamp, clamp01 } from '../util'
import { buildTrackSlice, type Slice } from '../world/TrackSlice'
import { RoadSurfaceProbe } from '../vehicles/TrackProbe'
import { VehicleVisual, bindAIFieldVisuals } from '../vehicles/Vehicle'
import { PlayerVehicle } from '../vehicles/PlayerVehicle'
import { AIVehicle, stepAIField, type AIContext, type RivalView } from '../vehicles/AIVehicle'
import { RaceDirector, gridSlot, type Competitor } from './RaceDirector'
import type { Obstacle } from '../vehicles/VehiclePhysics'

/* ------------------------------------------------------------------------- *
 * Orchestrator (plan rev.2 File Structure): build order, the fixed-dt sim
 * loop under the dev-harness modes — DRIVE (keyboard, default) vs frozen
 * POSE shots (Debug registry) — collision event routing to the camera, and
 * the shadow-frustum follow. The car reaches every consumer through the
 * CarView contract; ChaseCamera is the camera's single input.
 *
 * Phase 7 extends the loop to the full field: the player plus AI.count AI
 * vehicles share one fixed-120Hz accumulator step (player first, then AI in
 * slot order, so the replay order is fixed), the RaceDirector owns the
 * countdown/laps/standings state those steps advance, and frozen shots
 * consume ShotPose.parkAi to hold the AI field on its deterministic grid.
 * Each car owns its own reusable CarView (never the shared player one).
 * ------------------------------------------------------------------------- */

const SIM_HZ = 1 / 120

export class Game {
  readonly view: Renderer
  readonly sky: Sky
  readonly slice: Slice
  readonly probe: RoadSurfaceProbe
  readonly car: CarModel
  readonly visual: VehicleVisual
  readonly player: PlayerVehicle
  readonly input: Input
  readonly chase: ChaseCamera
  readonly ai: AIVehicle[] = []
  readonly director: RaceDirector
  frameCount = 0
  simTime = 0
  paused = false
  private simFrozen = false
  private clock = new THREE.Clock()
  private acc = 0
  private loadingHidden = false
  private shadowFocus = new THREE.Vector3()
  private cvPos = new THREE.Vector3()
  private carView: CarView = { pos: new THREE.Vector3(), yaw: 0, speed: 0, nitro: false, drift: 0, airborne: false, airHeight: 0 }
  private readonly aiVisuals: VehicleVisual[] = []
  private readonly aiCars: CarModel[] = []
  private readonly rivals: RivalView[] = []
  private readonly ctx: AIContext = { locked: false, leaderProgress: 0, progress: 0 }

  constructor(canvas: HTMLCanvasElement, paintHex: number = PAINTS[1].color) {
    this.view = new Renderer(canvas)
    this.sky = new Sky()
    this.view.attachSky(this.sky)
    const t0 = performance.now()
    this.slice = buildTrackSlice()
    ;(globalThis as unknown as { __buildMs?: number }).__buildMs = Math.round(performance.now() - t0)
    this.slice.group.name = 'track-slice'
    this.view.scene.add(this.slice.group)
    this.probe = new RoadSurfaceProbe(this.slice.spline, this.slice.field)
    this.car = buildCar(paintHex)
    this.car.group.name = 'player-car'
    this.view.scene.add(this.car.group)
    this.visual = new VehicleVisual(this.car)
    this.player = new PlayerVehicle(this.probe)
    this.input = new Input()
    this.input.onAction = (a) => {
      if (a === 'respawn') this.player.requestRespawn()
      if (a === 'pause') this.paused = !this.paused
    }
    /* the AI field: distinct paints, per-car model + visual + brain, one
       shared probe/spline (world queries are never duplicated per car) */
    const playerPaint = PAINTS.find((pt) => pt.color === paintHex)
    const aiPaints: PaintDef[] = PAINTS.filter((pt) => pt !== playerPaint).slice(0, AI.count)
    for (let i = 0; i < AI.count; i++) {
      const model = buildCar(aiPaints[i % aiPaints.length].color)
      model.group.name = `ai-car-${i}`
      model.group.position.set(0, -600, 0) // parked off-scene until the grid
      this.view.scene.add(model.group)
      this.aiCars.push(model)
      this.aiVisuals.push(new VehicleVisual(model))
      this.ai.push(new AIVehicle(i, this.slice.spline, this.probe))
    }
    const competitors: Competitor[] = [{ id: 0, phys: this.player.phys }, ...this.ai.map((a, i) => ({ id: i + 1, phys: a.phys }))]
    this.director = new RaceDirector(competitors, this.slice.spline.length)
    for (const a of this.ai) this.rivals.push(a)
    this.rivals.unshift({ phys: this.player.phys })
    this.chase = new ChaseCamera(this.view.camera.aspect, this.view.camera)
    Debug.bind({
      applyPose: (p) => this.applyPose(p),
      render: (m) => this.view.render(m),
      getCanvas: () => canvas,
    })
    const releaseOrig = Debug.releasePose.bind(Debug)
    Debug.releasePose = () => { this.simFrozen = false; releaseOrig() }
  }

  /** put the car on the centreline at station s and put the camera behind it */
  spawnAt(s: number, speed = 0): void {
    this.player.resetTo(s, speed)
    this.chase.snapTo(this.snapshot())
    this.chase.mode = 'chase'
  }

  /** place the full field on its deterministic grid slots */
  spawnGrid(): void {
    const L = this.slice.spline.length
    const g0 = gridSlot(0, L)
    this.player.resetTo(g0.s, 0, g0.lat)
    for (let i = 0; i < this.ai.length; i++) {
      const g = gridSlot(i + 1, L)
      this.ai[i].resetTo(g.s, g.lat)
    }
  }

  /** grid the field and run the countdown to the flag */
  startRace(): void {
    this.spawnGrid()
    this.director.start()
    this.chase.snapTo(this.snapshot())
    this.chase.mode = 'chase'
  }

  /** restart the race from a completed one: grid + director, no stale state */
  restartRace(): void {
    this.startRace()
  }

  setObstacles(list: readonly Obstacle[]): void {
    this.player.phys.setObstacles(list)
    for (const a of this.ai) a.phys.setObstacles(list)
  }

  /** live CarView (ChaseCamera / HUD contract) — one shared instance, player */
  snapshot(): CarView {
    const p = this.player.phys
    const cv = this.carView
    cv.pos.set(p.x, p.y, p.z)
    cv.yaw = p.yaw
    cv.speed = p.speed
    cv.nitro = this.player.nitroActive
    cv.drift = p.drift
    cv.airborne = !p.grounded
    const g = this.probe.surface(p.s, p.lat, p.x, p.z)
    cv.airHeight = clamp01((p.y - g.y) / 4)
    return cv
  }

  /** per-AI reusable CarView (one owned instance per car, never re-allocated) */
  aiView(i: number): CarView {
    return this.ai[i].view
  }

  /** one fixed simulation step of the whole field + director (deterministic) */
  private stepSim(dt: number, inp: InputState): void {
    if (this.director.phase !== 'idle') this.director.update(dt)
    const locked = this.director.locked()
    this.player.update(dt, inp, locked)
    // the field holds its classified order once the flag drops
    this.ctx.locked = locked || this.director.phase === 'finished'
    // the field steps in slot order through the gated helper: fully dormant
    // before a race starts (no brain runs until startRace raises the flag)
    stepAIField(dt, this.director, this.ctx, this.ai, this.rivals)
  }

  /** frozen Debug-shot binding: car via the explicit pose visual, camera direct */
  applyPose(p: ShotPose): void {
    this.simFrozen = !!p.freezeSim
    const pl = p.player
    this.visual.applyPoseVisual({
      pos: pl?.pos ?? [0, -600, -60],
      yaw: pl?.yaw ?? 0,
      pitch: pl?.pitch ?? 0,
      bank: pl?.bank ?? 0,
      speed: pl?.speed ?? 0,
      nitro: pl?.nitroLevel ?? (pl?.nitro ? 1 : 0),
      brakeGlow: pl?.brakeGlow,
      wheelSteer: pl?.wheelSteer,
      susp: pl?.susp,
      lean: pl?.lean,
      air: pl?.air,
    })
    this.car.group.updateMatrixWorld(true)
    this.parkField(!!p.parkAi)
    this.view.camera.position.fromArray(p.camera)
    this.view.camera.lookAt(p.look ? new THREE.Vector3(...p.look) : new THREE.Vector3(0, 0.6, 0))
    if (p.fov) { this.view.camera.fov = p.fov; this.view.camera.updateProjectionMatrix() }
    // capture renders synchronously from applyPose — the shadow frustum must
    // follow HERE, not only in the rAF loop, or frozen poses render unshadowed
    const look = p.look ?? p.camera
    this.view.setShadowExtent(p.shadowSpan ?? GRAPHICS.shadowExtent)
    this.view.setShadowFocus(this.shadowFocus.set(look[0], Math.max(0, look[1] - 3), look[2]))
  }

  /**
   * ShotPose.parkAi consumption: a frozen shot either holds the AI field on
   * its deterministic grid slots (parkAi) or removes it from the frame
   * entirely (single-car shots) — both fully repeatable, the sim never
   * decides where a parked car stands.
   */
  private parkField(onGrid: boolean): void {
    const L = this.slice.spline.length
    for (let i = 0; i < this.ai.length; i++) {
      if (!onGrid) {
        this.aiCars[i].group.position.set(0, -600, 0)
        this.aiCars[i].group.updateMatrixWorld(true)
        continue
      }
      const g = gridSlot(i + 1, L)
      const c = this.probe.lanePose(g.s, g.lat)
      const f = this.slice.spline.frame(g.s)
      this.aiVisuals[i].applyPoseVisual({
        pos: [c.x, c.y, c.z],
        yaw: c.yaw,
        pitch: f.pitch,
        bank: f.bank,
        speed: 0,
        brakeGlow: 0.35,
      })
      this.aiCars[i].group.updateMatrixWorld(true)
    }
  }

  start(): void {
    const frame = (): void => {
      const dt = Math.min(this.clock.getDelta(), 0.05)
      this.frameCount++
      if (this.simFrozen && Debug.lastPose) {
        this.applyPose(Debug.lastPose)
      } else if (!this.paused) {
        this.simTime += dt
        const inp = this.input.poll(dt)
        // fixed-dt accumulator (determinism; clamped catch-up): the whole
        // field + director advance in one deterministic order per substep
        this.acc += dt
        let steps = 0
        while (this.acc >= SIM_HZ && steps < 10) {
          this.stepSim(SIM_HZ, inp)
          this.acc -= SIM_HZ
          steps++
        }
        if (steps === 10) this.acc = 0
        const p = this.player.phys
        this.visual.bind(dt, p, this.player.cmd, this.player.nitroActive ? 1 : 0)
        bindAIFieldVisuals(dt, this.director, this.ai, this.aiVisuals)
        // route collision/landing events into the camera trauma
        const ev = this.player.events
        if (ev.impact > 0.4) this.chase.shake(clamp(ev.impact / 9, 0.14, 0.9))
        if (ev.landed > 1.2) this.chase.shake(clamp(ev.landed * 0.085, 0.1, 0.85))
        if (p.grounded && p.rough > 0.1 && p.speed > 10) this.chase.shake(p.rough * p.speed * 0.00042)
        this.chase.mode = 'chase'
        this.chase.update(dt, this.snapshot(), window.innerWidth / window.innerHeight)
        this.view.setShadowExtent(GRAPHICS.shadowExtent)
        this.view.update(dt, this.shadowFocus.set(p.x, p.y, p.z))
        this.slice.update(this.simTime, this.view.camera.position)
        if (!this.loadingHidden && this.simTime > 0.5) {
          this.loadingHidden = true
          document.getElementById('loading')?.classList.add('hidden')
        }
      } else {
        // paused: keep rendering the held frame alive
        this.view.update(dt, this.shadowFocus)
      }
      this.view.render()
      document.title = `Velocity Rush — ${Math.round(this.view.fps)} fps — ${this.view.tier}${this.paused ? ' — PAUSED' : ''}`
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }
}
