/**
 * Central input manager (spec §16): keyboard + gamepad drive axes, a
 * rebindable one-shot action map (respawn / pause / confirm) and the live,
 * allocation-free InputState the drive layer polls every frame. UI screens
 * never install raw listeners — they route Enter/confirm through here.
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

export type InputAction = 'respawn' | 'pause' | 'confirm'

export interface ActionBinding {
  /** keyboard codes that fire the one-shot */
  kb: readonly string[]
  /** gamepad button index that fires the one-shot (null = keyboard only) */
  padButton: number | null
}

/** Structural slice of the Gamepad API the pad reader consumes. */
export interface GamepadSnapshot {
  readonly buttons: readonly { pressed: boolean; value: number }[]
  readonly axes: readonly number[]
}
export type GamepadSource = () => readonly GamepadSnapshot[]

/** Standard mapping indices (X-input order: A B X Y LB RB LT RT). */
export const PAD = {
  a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9,
  stickL: 10, stickR: 11, dUp: 12, dDown: 13, dLeft: 14, dRight: 15,
} as const

/** Drive-axis gamepad wiring (spec §16: RT/LB/RB/sticks). */
export const PAD_DRIVE = {
  steerAxis: 2, steerDead: 0.14,
  throttleButton: PAD.rt, brakeButton: PAD.lt,
  handbrakeButton: PAD.lb, nitroButton: PAD.rb,
  /** stickless fallback: d-pad drives the axes as fully-on buttons */
  leftButton: PAD.dLeft, rightButton: PAD.dRight,
} as const

const AXES = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const
const HB = ['Space']
const NOS = ['ShiftLeft', 'ShiftRight']
const PREVENT = new Set<string>([...AXES.up, ...AXES.down, ...AXES.left, ...AXES.right, ...HB, 'Enter', 'NumpadEnter'])

const defaultBindings = (): Record<InputAction, ActionBinding> => ({
  respawn: { kb: ['KeyR'], padButton: PAD.y },
  pause: { kb: ['KeyP', 'Escape'], padButton: PAD.start },
  confirm: { kb: ['Enter', 'NumpadEnter'], padButton: PAD.a },
})

const dead = (v: number, gate: number): number => (Math.abs(v) < gate ? 0 : Math.max(-1, Math.min(1, v)))

/**
 * Fold one connected gamepad into the live state (pure, exported for tests):
 * triggers ride their analog value, the stick steers with a deadzone, LB/RB
 * latch handbrake/nitro, and the d-pad drives steer as a digital fallback.
 * Returns the pad's total drive presence (for keyboard/pad precedence).
 */
export function applyPadToState(s: InputState, pad: GamepadSnapshot | null, drive = PAD_DRIVE): number {
  if (!pad) return 0
  const btn = (i: number): number => (pad.buttons[i] ? (pad.buttons[i].pressed || pad.buttons[i].value > 0.08 ? Math.max(pad.buttons[i].value, 0.001) : 0) : 0)
  let presence = 0
  const t = btn(drive.throttleButton)
  const b = btn(drive.brakeButton)
  const st = dead(pad.axes[drive.steerAxis] ?? 0, drive.steerDead) || (btn(drive.rightButton) ? 1 : btn(drive.leftButton) ? -1 : 0)
  const hb = btn(drive.handbrakeButton)
  const ni = btn(drive.nitroButton)
  if (t > 0) s.throttle = Math.max(s.throttle, Math.min(1, t))
  if (b > 0) s.brake = Math.max(s.brake, Math.min(1, b))
  if (st !== 0) s.steer = st
  if (hb > 0) s.handbrake = true
  if (ni > 0) s.nitro = true
  presence = t + b + Math.abs(st) + hb + ni
  return presence
}

interface InputEventTargetLike {
  addEventListener(type: string, cb: (e: { code: string; preventDefault?: () => void }) => void): void
}

export class Input {
  readonly state: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
  /** false during respawna/countdown — axes forced to rest, raw keys still tracked */
  enabled = true
  onAction: ((a: InputAction) => void) | null = null
  private pressed = new Set<string>()
  private bindings: Record<InputAction, ActionBinding> = defaultBindings()
  /** actions are a fixed union; rebind swaps a value at an existing key only,
   *  so the iteration list is hoisted off the keydown/poll hot paths (alloc-free) */
  private readonly actions = Object.keys(this.bindings) as InputAction[]
  /** pad button states of the last poll (edge detection for one-shots) */
  private padPrev: boolean[] = []

  constructor(target: InputEventTargetLike = window, padSource: GamepadSource = defaultPadSource) {
    this.padSource = padSource
    target.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault?.()
      if (this.pressed.has(e.code)) return
      this.pressed.add(e.code)
      for (const action of this.actions) {
        if (this.bindings[action].kb.includes(e.code)) this.onAction?.(action)
      }
    })
    target.addEventListener('keyup', (e) => { this.pressed.delete(e.code) })
    target.addEventListener('blur', () => { this.pressed.clear() })
  }

  private padSource: GamepadSource
  /** read the first connected pad */
  private activePad(): GamepadSnapshot | null {
    try {
      const pads = this.padSource()
      for (const p of pads) if (p && p.buttons.length > 7) return p
    } catch { /* no pad environment — keyboard only */ }
    return null
  }

  /** rebind seam: replaces the keyboard codes and/or pad button of an action */
  rebind(action: InputAction, kb: readonly string[], padButton: number | null): void {
    this.bindings[action] = { kb: [...kb], padButton }
  }
  bindingsSnapshot(): Readonly<Record<InputAction, ActionBinding>> { return this.bindings }

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
    const pad = this.activePad()
    if (!this.enabled) {
      s.throttle = this.ramp(s.throttle, 0, dt)
      s.brake = this.ramp(s.brake, 0, dt)
      s.steer = this.ramp(s.steer, 0, dt)
      s.handbrake = false
      s.nitro = false
      this.pollPad(pad, false)
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
    const kbPresence = tT + tB + Math.abs(tS) + (s.handbrake ? 1 : 0) + (s.nitro ? 1 : 0)
    // the pad joins in on top of the ramped keyboard axes (whichever drives)
    if (pad && kbPresence < 0.05) applyPadToState(s, pad)
    this.pollPad(pad, true)
    return s
  }

  /** gamepad one-shot edges against the current action bindings */
  private pollPad(pad: GamepadSnapshot | null, actionsActive: boolean): void {
    if (!pad) { this.padPrev.length = 0; return }
    for (const action of this.actions) {
      const b = this.bindings[action].padButton
      if (b === null) continue
      const hit = !!pad.buttons[b] && (pad.buttons[b].pressed || pad.buttons[b].value > 0.5)
      const was = this.padPrev[b] ?? false
      if (hit && !was && actionsActive) this.onAction?.(action)
      this.padPrev[b] = hit
    }
  }
}

function defaultPadSource(): readonly GamepadSnapshot[] {
  try {
    const nav = (globalThis as unknown as { navigator?: { getGamepads?: () => GamepadSnapshot[] } }).navigator
    return nav && nav.getGamepads ? nav.getGamepads() : []
  } catch { return [] }
}
