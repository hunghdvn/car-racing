import * as THREE from 'three'
import { Renderer } from '../core/Renderer'
import { Sky } from '../core/SkyEnv'
import type { ShotPose } from '../core/Debug'
import { Input, type InputAction, type InputState } from '../core/Input'
import { ParticleManager } from '../core/ParticleManager'
import { SkidMarks } from '../core/SkidMarks'
import { Audio, type AudioDrive } from '../core/Audio'
import { UIManager, type HudData, freshShortcut, shortcutEnterEdge, distToPolyline, countdownCueFor, rpmFor } from '../ui/UIManager'
import { buildCar, type CarModel } from '../assets/CarModel'
import { ChaseCamera, type CarView } from '../camera/ChaseCamera'
import { AI, FX, GRAPHICS, PAINTS, QUALITY, SKIDS, TRACK, VEHICLE, type PaintDef } from '../config'
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
  readonly fx: ParticleManager
  readonly skids: SkidMarks
  readonly audio: Audio
  readonly ui: UIManager
  frameCount = 0
  simTime = 0
  paused = false
  private simFrozen = false
  /** the authored shot pose held by the dev harness (frozen capture); null in play */
  private frozenPose: ShotPose | null = null
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
  /* ---- Phase 8: fixed-dt FX event aggregation + presentation state ---- */
  private readonly fxAcc = {
    impact: 0, impacts: 0, landed: 0, landings: 0, launched: 0, launches: 0,
    ix: 0, iy: 0, iz: 0, inx: 0, inz: 0, lx: 0, ly: 0, lz: 0, splashCarry: 0,
  }
  private prevCd = 0
  private prevNitroActive = false
  private readonly uiData: HudData = {
    phase: 'idle', active: false, speed: 0, reverse: false, nitroLevel: 0, nitroActive: false,
    position: 0, total: 6, raceTime: 0, topSpeedRef: VEHICLE.topSpeed, progress: 0, countdown: 0,
    standings: [], headingDot: 1, drifting: false,
  }
  private readonly rearWheels: { x: number; z: number }[] = []
  private readonly skidAcc = [0, 0]
  private readonly rearScratch = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]
  private readonly shortcut = freshShortcut()
  private readonly shortcutXs: Float32Array
  private readonly shortcutZs: Float32Array
  private readonly mapPlayer = { x: 0, z: 0 }
  private readonly mapAi: { x: number; z: number }[] = []
  private mapAiCount = 0

  constructor(canvas: HTMLCanvasElement, paintHex: number = PAINTS[1].color) {
    this.view = new Renderer(canvas)
    this.sky = new Sky()
    this.view.attachSky(this.sky)
    this.slice = buildTrackSlice()
    this.slice.group.name = 'track-slice'
    this.view.scene.add(this.slice.group)
    this.probe = new RoadSurfaceProbe(this.slice.spline, this.slice.field)
    this.car = buildCar(paintHex)
    this.car.group.name = 'player-car'
    this.view.scene.add(this.car.group)
    this.visual = new VehicleVisual(this.car)
    this.player = new PlayerVehicle(this.probe)
    this.input = new Input()
    this.input.onAction = (a) => this.onInputAction(a)
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
    /* ---- Phase 8 presentation layer: pooled FX, decal board, synth audio
       and the DOM screen host (constructed once the field exists) ---- */
    this.fx = new ParticleManager(this.view.scene, { particles: () => QUALITY[this.view.tier].particles })
    this.skids = new SkidMarks(this.view.scene)
    this.audio = new Audio()
    this.ui = new UIManager(document, {
      onStart: () => this.beginRace(),
      onRestart: () => this.beginRace(),
      onResume: () => this.setPaused(false),
      onMenu: () => this.toMenu(),
      onPaint: (hex) => this.car.setPaint(hex),
    })
    this.ui.setStandingNames(['YOU', ...aiPaints.map((pt) => pt.name.toUpperCase())])
    this.ui.bindTrack(this.slice.spline)
    for (const w of this.car.wheels) if (!w.front) {
      const holder: THREE.Object3D = w.steer ?? w.spin.parent ?? w.spin
      this.rearWheels.push({ x: holder.position.x, z: holder.position.z })
    }
    for (let i = 0; i < AI.count; i++) this.mapAi.push({ x: 0, z: 0 })
    this.shortcutXs = new Float32Array(TRACK.shortcut.pts.map((p) => p[0]))
    this.shortcutZs = new Float32Array(TRACK.shortcut.pts.map((p) => p[2]))
  }

  /** Release a frozen shot pose held by the dev harness (see core/Debug host). */
  releasePose(): void {
    this.simFrozen = false
    this.frozenPose = null
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

  /* ----------------------------------------------------------- Phase 8 ---
   * Screen/intent flow. All user intents arrive either through the central
   * Input (Enter confirm) or the UIManager button seams — never raw UI
   * listeners. The presentation layer is a read-only consumer of the sim. */

  private onInputAction(a: InputAction): void {
    const racing = this.director.phase === 'countdown' || this.director.phase === 'racing'
    if (a === 'pause') {
      if (racing && this.ui.onScreen) this.setPaused(!this.paused)
      return
    }
    if (a === 'respawn') {
      if (racing && !this.paused) this.player.requestRespawn()
      return
    }
    if (a === 'confirm') {
      if (this.paused) { this.setPaused(false); return }
      /* the title screen is authority for "start": after MAIN MENU the sim
         may still be mid-flight behind the board, and Enter must behave like
         the START RACE button rather than dead-end on a stale phase */
      if (!this.ui.onScreen) { this.beginRace(); return }
      if (this.director.phase === 'finished') { this.beginRace(); return }
      if (this.director.phase === 'idle') { this.beginRace(); return }
    }
  }

  /** title Enter / START RACE / RESTART: gesture-unlock audio, grid the field */
  beginRace(): void {
    this.audio.unlock()
    this.audio.click()
    this.setPaused(false)
    this.ui.raceStarted()
    this.skids.clear()
    this.fx.clearAll()
    this.shortcut.armed = true
    this.prevCd = 0
    if (this.director.phase === 'finished') this.restartRace()
    else this.startRace()
  }

  /** MAIN MENU: back to the title board, HUD down, sim stays as posed */
  toMenu(): void {
    this.audio.unlock()
    this.audio.click()
    this.setPaused(false)
    this.ui.raceToMenu()
  }

  /** formal pause/resume: the overlay and the sim gate move together */
  setPaused(v: boolean): void {
    if (this.paused === v) return
    this.paused = v
    this.audio.setMuted(v)
    this.ui.showPause(v)
  }

  /** boot flow calls this once the loading screen retires */
  markLoadingShown(): void { this.loadingHidden = true; this.ui.loadingDone() }

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
    // effects/audio events are read inside the fixed-dt path, per substep,
    // and aggregated — never sampled only from the last substep
    if (!locked) this.fxStep(dt)
  }

  /* ---------------------------------------------------------------------- *
   * Continuous FX + event collection, called once per fixed substep (the
   * same cadence PlayerVehicle consumes CarEvents on). Read-only: physics
   * and race state are never written from here.
   * -------------------------------------------------------------------- */
  private fxStep(dt: number): void {
    const p = this.player.phys
    const cmd = this.player.cmd
    const ev = this.player.events
    const spd = p.speed
    const slipAbs = Math.abs(p.slip)
    const drifting = p.grounded && (cmd.handbrake || slipAbs > FX.smokeSlipMin) && spd > FX.smokeSpeedMin

    /* rear-wheel world anchors (authoritative from the car model locals) */
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw)
    for (let i = 0; i < this.rearWheels.length; i++) {
      const w = this.rearWheels[i]
      const out = this.rearScratch[i]
      out.x = p.x + (w.x * c + w.z * s)
      out.z = p.z + (-w.x * s + w.z * c)
      const latW = p.lat + (i === 0 ? -VEHICLE.trackWidth / 2 : VEHICLE.trackWidth / 2)
      out.y = this.probe.surface(p.s + w.z, latW, out.x, out.z).y
    }

    if (drifting) {
      const rate = FX.smokePerSec * Math.min(1, 0.35 + slipAbs * 1.7)
      this.fx.emitSmoke(this.rearScratch[0].x, this.rearScratch[0].y + 0.05, this.rearScratch[0].z, rate * 0.5, dt)
      if (this.rearScratch.length > 1) this.fx.emitSmoke(this.rearScratch[1].x, this.rearScratch[1].y + 0.05, this.rearScratch[1].z, rate * 0.5, dt)
    }
    const dusting = p.grounded && !p.onRoad && p.rough > FX.dustRoughMin && spd > FX.dustSpeedMin
    if (dusting) {
      const rate = FX.dustPerSec * Math.min(1, 0.4 + p.rough)
      this.fx.emitDust(this.rearScratch[0].x, this.rearScratch[0].y + 0.04, this.rearScratch[0].z, rate * 0.5, dt)
      if (this.rearScratch.length > 1) this.fx.emitDust(this.rearScratch[1].x, this.rearScratch[1].y + 0.04, this.rearScratch[1].z, rate * 0.5, dt)
    }
    if (this.player.nitroActive) {
      // rear along the heading (-sin yaw, -cos yaw): the stream starts behind it
      const bx = p.x + Math.sin(p.yaw) * FX.trailRear
      const bz = p.z + Math.cos(p.yaw) * FX.trailRear
      this.fx.emitTrail(bx, p.y + FX.trailLift, bz, dt)
    }
    if (p.grounded && p.zone === 'coastal' && spd > FX.splashSpeedMin && p.y <= this.probe.seaLevel + FX.splashSeaPad && !p.onRoad) {
      this.fxAcc.splashCarry += dt * spd
      if (this.fxAcc.splashCarry > 0.4) {
        this.fxAcc.splashCarry = 0
        this.fx.burstSplash(p.x, p.y, p.z, spd * 0.16)
      }
    }

    /* skid decals: laid per wheel every SKIDS.spacing metres of slip roll */
    const skidding = p.grounded && (cmd.handbrake || slipAbs > SKIDS.slipMin) && spd > SKIDS.minSpeed
    if (skidding) {
      const yaw = spd > 3 ? Math.atan2(-p.vx, -p.vz) : p.yaw
      for (let i = 0; i < this.rearScratch.length; i++) {
        this.skidAcc[i] += spd * dt
        if (this.skidAcc[i] >= SKIDS.spacing) {
          this.skidAcc[i] -= SKIDS.spacing
          const w = this.rearScratch[i]
          this.skids.lay(w.x, w.y, w.z, yaw, p.pitch * 0.6, p.roll * 0.6)
        }
      }
    } else for (let i = 0; i < this.skidAcc.length; i++) this.skidAcc[i] = 0

    /* one-substep events: aggregate for the once-per-frame flush */
    if (ev.impact > 0.05) {
      const a = this.fxAcc
      a.impact = Math.max(a.impact, ev.impact)
      a.impacts++
      const inv = 1 / Math.max(1, spd)
      a.ix = p.x; a.iy = p.y; a.iz = p.z
      a.inx = -p.vx * inv; a.inz = -p.vz * inv
    }
    if (ev.landed > 0.05) {
      const a = this.fxAcc
      a.landed = Math.max(a.landed, ev.landed)
      a.landings++
      a.lx = p.x; a.ly = p.y; a.lz = p.z
    }
    if (ev.launched > 0.05) {
      const a = this.fxAcc
      a.launched = Math.max(a.launched, ev.launched)
      a.launches++
    }
  }

  /** one burst per frame per event family (camera trauma, audio, particle) */
  private flushFx(): void {
    const a = this.fxAcc
    if (a.impacts > 0) {
      if (a.impact > 0.4) this.chase.shake(clamp(a.impact / 9, 0.14, 0.9))
      if (a.impact >= FX.impactMin) {
        this.audio.impact(a.impact)
        this.fx.burstImpact(a.ix, a.iy, a.iz, a.inx, a.inz, a.impact)
        this.ui.flash(Math.min(1, a.impact / 7))
      }
      a.impacts = 0; a.impact = 0
    }
    if (a.landings > 0) {
      if (a.landed > 1.2) this.chase.shake(clamp(a.landed * 0.085, 0.1, 0.85))
      if (a.landed >= FX.landMin) {
        this.audio.land(a.landed)
        this.fx.burstPuff(a.lx, a.ly, a.lz, a.landed)
      }
      a.landings = 0; a.landed = 0
    }
    if (a.launches > 0) {
      if (a.launched >= FX.launchMin) this.audio.launch()
      a.launches = 0; a.launched = 0
    }
  }

  /** shortcut spur probe: grants the configured bonus once per traversal */
  private shortcutCheck(): void {
    const p = this.player.phys
    const inside = this.director.phase === 'racing' && p.grounded
      && distToPolyline(this.shortcutXs, this.shortcutZs, p.x, p.z) < TRACK.shortcut.half
    if (shortcutEnterEdge(this.shortcut, inside) && this.shortcut.armed) {
      this.shortcut.armed = false
      this.player.addShortcutBonus()
      this.ui.pushPopup('SHORTCUT!', 'gold')
      this.audio.reward()
    }
  }

  /** shared silent drive record for pause/menu frames */
  private static readonly IDLE_DRIVE: AudioDrive = { rpm01: 0, load: 0, nitro: false, slip01: 0, speed: 0, active: false }

  /** once-per-frame presentation pass: HUD record, countdown cues, popups, audio */
  private presentation(dt: number): void {
    const d = this.uiData
    const phase = this.director.phase
    const p = this.player.phys
    d.phase = phase
    d.active = phase === 'countdown' || phase === 'racing'
    d.speed = p.speed
    d.reverse = p.forwardSpeed < -0.5
    d.nitroLevel = this.player.nitroLevel
    d.nitroActive = this.player.nitroActive
    d.position = this.director.positionOf(0)
    d.total = 1 + this.ai.length
    d.raceTime = this.director.simTime
    d.topSpeedRef = this.player.nitroActive ? VEHICLE.nitroTopSpeed : VEHICLE.topSpeed
    const st = this.director.standingFor(0)
    d.progress = st ? st.fraction : 0
    d.countdown = this.director.countdown
    d.standings = this.director.standingsFor()
    d.headingDot = Math.cos(p.yaw - this.slice.spline.frame(p.s).yaw)
    d.drifting = p.grounded && (this.player.cmd.handbrake || Math.abs(p.slip) > VEHICLE.driftMinSlip) && p.speed > VEHICLE.driftTriggerSpeed
    this.mapPlayer.x = p.x; this.mapPlayer.z = p.z
    this.mapAiCount = this.director.fieldActive() ? this.ai.length : 0
    for (let i = 0; i < this.mapAiCount; i++) { this.mapAi[i].x = this.ai[i].phys.x; this.mapAi[i].z = this.ai[i].phys.z }

    // countdown cues: the whole 3/2/1/GO sequence rides the director clock
    if (this.prevCd > 0 || phase === 'countdown') {
      const cd = this.director.countdown
      if (this.prevCd > 0 && cd < this.prevCd) {
        const cue = countdownCueFor(this.prevCd, cd)
        if (cue) {
          this.audio.countdownCue(cue)
          if (cue === 'go') this.ui.flagDropped()
        }
      }
      this.prevCd = phase === 'countdown' && cd > 0 ? cd : 0
    }

    // nitro ignition whoosh on the rising edge (the loop rides audio.update)
    if (this.player.nitroActive && !this.prevNitroActive) this.audio.nitroActivate()
    this.prevNitroActive = this.player.nitroActive

    this.shortcutCheck()
    this.ui.update(dt, d, this.mapPlayer, this.mapAi, this.mapAiCount)
    this.audio.update(dt, {
      rpm01: rpmFor(Math.min(1, p.speed / d.topSpeedRef), d.reverse),
      load: Math.max(this.player.cmd.throttle, this.player.cmd.brake),
      nitro: this.player.nitroActive,
      slip01: d.drifting ? Math.min(1, Math.abs(p.slip) * 1.8) : 0,
      speed: p.speed,
      active: d.active,
    })
  }

  /** frozen Debug-shot binding: car via the explicit pose visual, camera direct */
  applyPose(p: ShotPose): void {
    this.simFrozen = !!p.freezeSim
    this.frozenPose = p.freezeSim ? p : null
    // approved frames are pose-driven: transient effects never leak into a
    // frozen capture (and pose-capture clearing doubles as the restart hook)
    this.fx.clearAll()
    this.skids.clear()
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
      if (this.simFrozen && this.frozenPose) {
        this.applyPose(this.frozenPose)
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
        // aggregate collision/landing events: trauma, audio and particle
        // bursts once per frame from the fixed-dt collection (every substep
        // counted, not just the last one)
        this.flushFx()
        if (p.grounded && p.rough > 0.1 && p.speed > 10) this.chase.shake(p.rough * p.speed * 0.00042)
        this.chase.mode = 'chase'
        this.chase.update(dt, this.snapshot(), window.innerWidth / window.innerHeight)
        this.view.setShadowExtent(GRAPHICS.shadowExtent)
        this.view.update(dt, this.shadowFocus.set(p.x, p.y, p.z))
        this.slice.update(this.simTime, this.view.camera.position)
        this.presentation(dt)
        this.skids.update(dt)
        if (!this.loadingHidden && this.simTime > 1.2) this.markLoadingShown()
      } else {
        // paused: keep rendering the held frame alive
        this.view.update(dt, this.shadowFocus)
        this.audio.update(dt, Game.IDLE_DRIVE)
      }
      const fxdt = this.simFrozen || this.paused ? 0 : dt
      this.fx.update(fxdt)
      this.view.render()
      document.title = `Velocity Rush — ${Math.round(this.view.fps)} fps — ${this.view.tier}${this.paused ? ' — PAUSED' : ''}`
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }
}
