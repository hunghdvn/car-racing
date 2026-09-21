import { assert, assertNear, test } from '../harness'
import {
  countdownCueFor, countdownLabelFor, countdownBoardVisible, popupExpired, buildResultRows, ordinalBadge,
  nitroReadyEdge, nitroSegmentsOn, NITRO_READY_FRAC, wrongWayStep, freshWrongWay,
  driftChainStep, freshDriftChain, distToPolyline, shortcutEnterEdge, freshShortcut,
  gearLabelFor, gearIndexOf, rpmFor, buildCarNames, type StandingLike,
} from '../../src/ui/UIManager'
import { Input, PAD, type InputAction, type GamepadSnapshot } from '../../src/core/Input'
import { globalObject } from '../../src/core/globals'
import { NITRO, RACE, UI, VEHICLE } from '../../src/config'

/* Phase 8 headless UI contracts: the countdown cue cadence, results rows,
 * the popup TTL policy, the wrong-way / shortcut / nitro-ready predicates
 * and the gear/rpm mapping — all DOM-free. */

test('countdown: full 3/2/1/GO cue sequence over the director clock', () => {
  const cues: string[] = []
  let cd = RACE.countdownTime
  while (cd > 0) {
    const next = Math.max(0, cd - 1 / 120)
    const cue = countdownCueFor(cd, next)
    if (cue) cues.push(cue)
    cd = next
  }
  assert(cues.join(',') === '3,2,1,go', `cue sequence is 3,2,1,go — got ${cues.join(',')}`)
})

test('countdown: each cue fires exactly once and the board clamps its label', () => {
  assert(countdownCueFor(3.01, 3.0) === '3', "'3' crosses once at the top second")
  assert(countdownCueFor(2.9, 2.8) === null, 'no double-fire inside a second')
  assert(countdownCueFor(0.02, 0) === 'go', 'GO drops with the flag')
  assert(countdownLabelFor(3.2) === '3', 'board never shows more than the configured top')
  assert(countdownLabelFor(0.1) === '1', 'the last visible number is 1')
})

test('countdown board: visibility follows the UI screen mode, not just the phase', () => {
  /* the defect this locks out: paused -> MAIN MENU mid-countdown leaves the
     director at 'countdown' while the title screen is up — a phase-only
     check would repaint a ghost board over the title */
  assert(!countdownBoardVisible('title', 'countdown', 0), 'title over a countdown phase hides the board')
  assert(!countdownBoardVisible('title', 'countdown', UI.goHoldSec), 'the GO window cannot leak onto the title either')
  assert(countdownBoardVisible('racing', 'countdown', 0), 'a normal countdown on the race screen shows the board')
  assert(countdownBoardVisible('racing', 'racing', UI.goHoldSec), 'the GO hold keeps the board through its window')
  assert(!countdownBoardVisible('racing', 'racing', 0), 'no hold, no countdown: the board retires')
  assert(!countdownBoardVisible('racing', 'idle', 0), 'idle never raises the board')
  assert(!countdownBoardVisible('racing', 'finished', 0), 'finished never raises the board')
})

test('popups: TTL policy expires on the configured span', () => {
  const born = 10_000
  assert(!popupExpired(born, born + UI.popupTtlSec * 1000 - 1), 'alive through its animated span')
  assert(popupExpired(born, born + UI.popupTtlSec * 1000), 'expired past the TTL')
  assert(popupExpired(born, born + 5_000), 'no leak: late polls still sweep it')
})

test('results: rows follow director order, mark the player and format times', () => {
  const standings: StandingLike[] = [
    { id: 2, position: 1, finished: true, finishTime: 96.42 },
    { id: 0, position: 2, finished: true, finishTime: 98.01 },
    { id: 1, position: 3, finished: false, finishTime: 0 },
  ]
  const rows = buildResultRows(standings, 0, ['YOU', 'VIPER GREEN', 'PLASMA GOLD'])
  assert(rows.length === 3 && rows[0].pos === 1 && rows[2].pos === 3, 'rows keep director position order')
  assert(rows[1].me && rows[0].name === 'PLASMA GOLD' && !rows[2].me, 'the player row is marked')
  assert(/^1:36\.42$/.test(rows[0].time), `finish time formats m:ss.cc — got ${rows[0].time}`)
  assert(rows[2].time === '—', 'running cars carry no time')
  assert(ordinalBadge(1) === '1ST' && ordinalBadge(2) === '2ND' && ordinalBadge(6) === '6TH', 'podium badges read right')
  const names = buildCarNames([{ name: 'Solar Flare', color: 1 } as never, { name: 'Viper Green', color: 2 } as never], 0)
  assert(names[0] === 'YOU' && names[1] === 'VIPER GREEN', 'the player id reads as YOU')
})

test('nitro-ready predicate fires on the ignition-threshold crossing only', () => {
  assert(nitroReadyEdge(NITRO_READY_FRAC - 0.02, NITRO_READY_FRAC + 0.01), 'edge on the upward crossing')
  assert(!nitroReadyEdge(NITRO_READY_FRAC + 0.05, NITRO_READY_FRAC + 0.06), 'no repeat while parked above')
  assert(!nitroReadyEdge(0.5, 0.1), 'draining never re-pops the popup')
  assert(nitroSegmentsOn(0) === 0 && nitroSegmentsOn(1) === UI.nitroSegments, 'segment bar fills end to end')
  assertNear(NITRO_READY_FRAC, NITRO.minToActivate / NITRO.max, 1e-9, 'ready fraction follows the config')
})

test('wrong-way: latches after the hold window, blips never latch, facing right stays out', () => {
  const st = freshWrongWay()
  for (let i = 0; i < 4; i++) wrongWayStep(st, -1, 14, 0.1)
  assert(!st.on, 'a sub-window blip does not light the board')
  for (let i = 0; i < 20; i++) wrongWayStep(st, -1, 14, 0.1)
  assert(st.on, 'sustained backwards driving latches it')
  for (let i = 0; i < 20; i++) wrongWayStep(st, 1, 14, 0.1)
  assert(!st.on, 'facing the right way clears it')
  const st2 = freshWrongWay()
  for (let i = 0; i < 40; i++) wrongWayStep(st2, -1, 0.5, 0.1)
  assert(!st2.on, 'a parked car is not driving the wrong way')
})

test('shortcut: inside the authored spur lane, enter edge fires once per pass', () => {
  const xs = [-448, -424, -392, -352, -302]
  const zs = [232, 168, 104, 54, 24]
  const onLane = distToPolyline(xs, zs, -392, 104)
  assert(onLane < 1, `a point on the lane reads near-zero (${onLane.toFixed(2)})`)
  const far = distToPolyline(xs, zs, -20, 4)
  assert(far > 20, 'the mainline at (0,0) is far from the spur (metres)')
  const st = freshShortcut()
  assert(shortcutEnterEdge(st, true), 'entering the spur fires the edge once')
  assert(!shortcutEnterEdge(st, true), 'staying inside does not re-fire')
  assert(!shortcutEnterEdge(st, false), 'leaving does not count as entering')
  assert(shortcutEnterEdge(st, true), 'a second pass re-arms the edge')
})

test('drift chain: a held slide completes a chain after the configured hold, blips do not', () => {
  const st = freshDriftChain()
  let fired = false
  for (let i = 0; i < 12; i++) fired = driftChainStep(st, true, 0.1) || fired // 1.2 s held
  assert(!fired, 'chains are declared when the slide is released')
  for (let i = 0; i < 8; i++) fired = driftChainStep(st, false, 0.1) || fired // through the grace
  assert(fired, `chain completes across driftChainHold=${VEHICLE.driftChainHold}s`)
  assert(st.chains === 1, 'one chain per held slide')
  const quick = freshDriftChain()
  let q = false
  for (let i = 0; i < 4; i++) q = driftChainStep(quick, true, 0.05) || q
  for (let i = 0; i < 20; i++) q = driftChainStep(quick, false, 0.1) || q
  assert(!q && quick.chains === 0, 'a sub-threshold wiggle never chains')
})

test('gear/rpm mapping: six gears, in-gear rise, shift resets, reverse reads R', () => {
  assert(gearIndexOf(0.02) === 0 && gearIndexOf(0.99) === UI.gearTops.length - 1, 'the gear ladder spans the gate table')
  // inside one gear the tach climbs monotonically toward the shift point
  const g = 2
  let prev = -1
  let ok = true
  for (let v = UI.gearTops[g - 1] + 0.01; v < UI.gearTops[g] - 0.01; v += 0.01) {
    const r = rpmFor(v, false)
    if (r < prev - 1e-6) ok = false
    prev = r
  }
  assert(ok && prev > 0.9, 'the tach sweeps up to ~1 at the shift')
  // across the shift it resets down toward the idle floor
  assert(rpmFor(UI.gearTops[0] - 0.001, false) > 0.9 && rpmFor(UI.gearTops[0] + 0.001, false) < 0.6, 'the shift drops the tach (gear feel)')
  assert(rpmFor(0.001, false) >= 0.05, 'the idle keeps a floor above zero')
  assert(gearLabelFor(0.3, true) === 'R', 'reverse reads R')
  assert(gearLabelFor(0.3, false) === `D${gearIndexOf(0.3) + 1}`, 'forward reads D#')
})

test('input: action map fires respawn/pause/confirm once per keypress and rebinds', () => {
  const listeners: Record<string, ((e: { code: string }) => void) | undefined> = {}
  const target = {
    addEventListener: (t: string, cb: (e: { code: string }) => void) => { listeners[t] = cb },
  }
  const input = new Input(target)
  const fired: InputAction[] = []
  input.onAction = (a) => { fired.push(a) }
  const down = (code: string): void => listeners.keydown?.({ code })
  const up = (code: string): void => listeners.keyup?.({ code })
  down('Enter'); up('Enter')
  assert(fired.join(',') === 'confirm', 'Enter routes the confirm action')
  down('Enter'); down('Enter'); up('Enter')
  assert(fired.filter((f) => f === 'confirm').length === 2, 'auto-repeat does not double-fire')
  down('KeyR'); up('KeyR')
  down('KeyP'); up('KeyP')
  down('Escape'); up('Escape')
  assert(fired.join(',') === 'confirm,confirm,respawn,pause,pause', 'R/P/Esc map to their actions')
  input.rebind('pause', ['Backquote'], null)
  const n = fired.length
  down('Backquote'); up('Backquote')
  down('KeyP'); up('KeyP')
  assert(fired.length === n + 1 && fired[fired.length - 1] === 'pause', 'rebind moves the action, old key goes dead')
  const s = input.poll(1 / 60)
  assert(s.throttle === 0 && s.steer === 0 && !s.handbrake, 'resting axes stay live zeros')
  down('KeyW')
  for (let i = 0; i < 30; i++) input.poll(1 / 60)
  assert(s.throttle > 0.8, 'W ramps throttle on the live state object')
  input.enabled = false
  for (let i = 0; i < 60; i++) input.poll(1 / 60)
  assert(s.throttle === 0, 'the lock gate (countdown) drains the axes to rest')
})

/* --- Phase 11 final-review: the window ?? globalObject() init hardening --- *
 * The subsystem init used to read the ES2020 `globalThis` bare, which throws a
 * ReferenceError on older-but-common browsers and silently disables audio/gamepad
 * behind their try/catch. These lock the accessor contract and the gamepad drive
 * mapping headlessly (no real browser globals needed — a synthetic pad + a fake
 * event target stand in). */

const padBtn = (v: number): { pressed: boolean; value: number } => ({ pressed: v > 0.08, value: v })
const padButtons = (overrides: Record<number, number>): { pressed: boolean; value: number }[] =>
  Array.from({ length: 16 }, (_, i) => padBtn(overrides[i] ?? 0))
const padOf = (buttons: { pressed: boolean; value: number }[], axis2 = 0): GamepadSnapshot =>
  ({ buttons, axes: [0, 0, axis2, 0] })

test('globalObject(): resolves a usable global without needing browser globals', () => {
  const marker = '__vrGlobalObjectMarker__'
  ;(globalThis as Record<string, unknown>)[marker] = 42
  const g = globalObject()
  assert(typeof g === 'object' && g !== null, 'the accessor always returns an object (never throws)')
  assert(g[marker] === 42, 'with no window the accessor resolves to the ambient global (node harness)')
  delete (globalThis as Record<string, unknown>)[marker]
})

type KeyboardLikeEvent = { code: string; key?: string; keyCode?: number; isComposing?: boolean }

const keyboardHarness = (): { target: { addEventListener(t: string, cb: (e: KeyboardLikeEvent) => void): void }; down(e: KeyboardLikeEvent): void; up(e: KeyboardLikeEvent): void } => {
  const listeners: Record<string, ((e: KeyboardLikeEvent) => void) | undefined> = {}
  return {
    target: { addEventListener: (t, cb) => { listeners[t] = cb } },
    down: (e) => { listeners.keydown?.(e) },
    up: (e) => { listeners.keyup?.(e) },
  }
}

test('input: Vietnamese IME conversion of W does not latch a false A key', () => {
  const kb = keyboardHarness()
  const input = new Input(kb.target)
  kb.down({ code: 'KeyA', key: 'ư' })
  kb.down({ code: 'KeyW', key: 'w' })
  for (let i = 0; i < 30; i++) input.poll(1 / 60)
  assert(input.state.throttle > 0.8, 'the IME-composed W keydown still drives throttle')
  assert(Math.abs(input.state.steer) < 0.05, `the composed KeyA must not latch left — got ${input.state.steer}`)
  kb.up({ code: 'KeyW', key: 'w' })
  for (let i = 0; i < 60; i++) input.poll(1 / 60)
  assert(input.state.throttle === 0 && input.state.steer === 0, 'releasing W returns both axes to rest')
})

test('input: localized Vietnamese A/D labels still drive steering', () => {
  const kb = keyboardHarness()
  const input = new Input(kb.target)
  kb.down({ code: 'KeyA', key: 'ă' })
  for (let i = 0; i < 30; i++) input.poll(1 / 60)
  assert(input.state.steer < -0.8, `the Vietnamese A label still steers left — got ${input.state.steer}`)
  kb.up({ code: 'KeyA', key: 'ă' })
  for (let i = 0; i < 30; i++) input.poll(1 / 60)
  kb.down({ code: 'KeyD', key: 'đ' })
  for (let i = 0; i < 30; i++) input.poll(1 / 60)
  assert(input.state.steer > 0.8, `the Vietnamese D label still steers right — got ${input.state.steer}`)
})

test('gamepad drive mapping folds through the accessor-backed pad source (RT/LB/RB/stick + one-shots)', () => {
  const target = { addEventListener: (_t: string, _cb: (e: { code: string }) => void) => { /* no keyboard */ } }
  let pad = padOf(padButtons({ [PAD.rt]: 1 }), 0.8) // RT throttle, stick right
  const input = new Input(target, () => [pad])
  const fired: InputAction[] = []
  input.onAction = (a) => { fired.push(a) }
  for (let i = 0; i < 30; i++) input.poll(1 / 60)
  const s = input.state
  assert(s.throttle > 0.8, 'right trigger drives throttle through the pad source')
  assert(s.steer > 0.5, 'the right stick steers with the deadzone respected')
  pad = padOf(padButtons({ [PAD.rt]: 1, [PAD.lb]: 1, [PAD.rb]: 1 }), 0.8)
  input.poll(1 / 60)
  assert(s.handbrake && s.nitro, 'LB latches handbrake and RB latches nitro')
  pad = padOf(padButtons({ [PAD.a]: 1 }), 0.8) // 'a' → confirm one-shot
  input.poll(1 / 60)
  assert(fired.includes('confirm'), 'the gamepad "a" button raises the confirm action once')
  const before = fired.length
  input.poll(1 / 60) // held across a second poll must not re-fire (edge detect)
  assert(fired.length === before, 'a held pad button does not repeat its one-shot')
})
