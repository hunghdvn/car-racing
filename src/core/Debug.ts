/**
 * Deterministic visual-validation API (spec §22).
 * window.__vr drives authored fixed poses + PNG capture for Playwright gates.
 */

export interface ShotPose {
  /** authoritative chase-camera position for the shot */
  camera: [number, number, number]
  look?: [number, number, number]
  fov?: number
  player?: {
    pos?: [number, number, number]
    yaw?: number
    /** road-frame orientation (YXZ order) so the car sits on banked/pitched deck */
    pitch?: number
    bank?: number
    speed?: number
    drift?: boolean
    nitro?: boolean
    air?: boolean
    wheelsSpin?: number
    /* --- Phase 6 explicit state visuals (frozen poses render these) --- */
    /** nitro flame intensity 0..1 (overrides `nitro` flag) */
    nitroLevel?: number
    /** brake-light glow 0..1 (overrides the speed-derived default) */
    brakeGlow?: number
    /** front-wheel angle (rad, + = left as for yaw) — counter-steer in drifts */
    wheelSteer?: number
    /** uniform suspension travel (m; - compressed, + drooped); `air` extends */
    susp?: number
    /** extra body roll beyond `bank` (rad) — drift skid lean */
    lean?: number
  }
  freezeSim?: boolean
  parkAi?: boolean
  /** section tag for reporting */
  tag?: string
  /** dev/kit poses: half-width of the sun's ortho shadow box so isolated
   *  display boards sit inside the frustum (gameplay uses GRAPHICS default) */
  shadowSpan?: number
}

export interface DebugHost {
  applyPose(pose: ShotPose): void
  render(renderMode?: number): void
  getCanvas(): HTMLCanvasElement
}

class DebugApi {
  private poses = new Map<string, ShotPose>()
  private host: DebugHost | null = null
  ready = false
  cameraFrozen = false
  lastPose: ShotPose | null = null

  bind(host: DebugHost): void {
    this.host = host
    this.ready = true
    ;(window as unknown as { __vr: DebugApi }).__vr = this
  }

  registerPose(name: string, pose: ShotPose): void { this.poses.set(name, pose) }
  registerPoses(list: [string, ShotPose][]): void { for (const [n, p] of list) this.registerPose(n, p) }
  list(): string[] { return [...this.poses.keys()] }

  poseShot(name: string): void {
    const pose = this.poses.get(name)
    if (!pose || !this.host) throw new Error(`[vr] unknown shot pose "${name}"`)
    this.lastPose = pose
    this.host.applyPose(pose)
    if (pose.camera) this.cameraFrozen = true
  }

  releasePose(): void { this.cameraFrozen = false }

  async captureShot(name: string): Promise<string> { return this.shot(name) }

  async shot(name: string, renderMode = 0): Promise<string> {
    this.poseShot(name)
    const h = this.host
    if (!h) throw new Error('[vr] host not bound')
    h.render(renderMode)
    return h.getCanvas().toDataURL('image/png')
  }
}

export const Debug = new DebugApi()
