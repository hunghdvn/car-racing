/**
 * Minimal keyboard drive input (Phase 6 scope split: Phase 8 owns the full
 * gamepad/rebind InputManager). Exposes the InputState shape the future
 * InputManager grows into — axes are smoothed scalars, buttons booleans.
 */

export interface InputState {
  /** 0..1 forward throttle */
  throttle: number
  /** 0..1 brake / reverse */
  brake: number
  /** -1..1, + = right */
  steer: number
  handbrake: boolean
  nitro: boolean
}

type Action = 'respawn' | 'pause'

const AXES = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const
const HB = ['Space']
const NOS = ['ShiftLeft', 'ShiftRight']
const PREVENT = new Set<string>([...AXES.up, ...AXES.down, ...AXES.left, ...AXES.right, ...HB])

export class Input {
  readonly state: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
  /** false during respawna/countdown — axes forced to rest, raw keys still tracked */
  enabled = true
  onAction: ((a: Action) => void) | null = null
  private pressed = new Set<string>()

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault()
      if (this.pressed.has(e.code)) return
      this.pressed.add(e.code)
      if (e.code === 'KeyR') this.onAction?.('respawn')
      if (e.code === 'KeyP' || e.code === 'Escape') this.onAction?.('pause')
    })
    target.addEventListener('keyup', (e) => { this.pressed.delete(e.code) })
    target.addEventListener('blur', () => { this.pressed.clear() })
  }

  private held(codes: readonly string[]): boolean {
    for (const c of codes) if (this.pressed.has(c)) return true
    return false
  }

  /** frame-rate independent axis ramp (fast attack, faster release) */
  private ramp(cur: number, target: number, dt: number): number {
    const rate = target > Math.abs(cur) ? 5.5 : 9.5
    const k = 1 - Math.exp(-rate * dt)
    const v = cur + (Math.sign(target) * Math.abs(target) - cur) * k
    return Math.abs(v) < 1e-3 ? 0 : v
  }

  /** advance smoothed axes; returns the same live object (no per-frame garbage) */
  poll(dt: number): InputState {
    const s = this.state
    if (!this.enabled) {
      s.throttle = this.ramp(s.throttle, 0, dt)
      s.brake = this.ramp(s.brake, 0, dt)
      s.steer = this.ramp(s.steer, 0, dt)
      s.handbrake = false
      s.nitro = false
      return s
    }
    const tT = this.held(AXES.up) ? 1 : 0
    const tB = this.held(AXES.down) ? 1 : 0
    const tS = (this.held(AXES.right) ? 1 : 0) - (this.held(AXES.left) ? 1 : 0)
    s.throttle = this.ramp(s.throttle, tT, dt)
    s.brake = this.ramp(s.brake, tB, dt)
    s.steer = this.ramp(s.steer, tS, dt)
    s.handbrake = this.held(HB)
    s.nitro = this.held(NOS)
    return s
  }
}
