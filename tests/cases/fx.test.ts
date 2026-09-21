import { assert, assertNear, assertFinite, test } from '../harness'
import { ParticlePool } from '../../src/core/ParticleManager'
import { SkidRing } from '../../src/core/SkidMarks'
import { Audio, engineFreqFor, windLevelFor } from '../../src/core/Audio'
import { applyPadToState, PAD, type GamepadSnapshot, type InputState } from '../../src/core/Input'
import { FX, PARTICLES, QUALITY, SKIDS, UI } from '../../src/config'

/* Phase 8 headless units: the pooled particle/skid cores, the gamepad fold
 * and the pure audio mappings — all DOM/WebGL-free by construction. */

test('particle pool: capacity is a hard cap and the ring recycles the oldest', () => {
  const p = new ParticlePool(8)
  for (let i = 0; i < 24; i++) p.spawn(i, 0, 0, 0, 0, 0, 5, 1, 1, 0, 0)
  assert(p.aliveCount() <= 8, `alive ${p.aliveCount()} <= cap 8`)
  assert(p.aliveCount() === 8, 'ring stays saturated while writes keep coming')
  // the 24 most recent x values are 16..23 — the oldest slots were recycled
  let seen = 0
  for (let i = 0; i < 8; i++) if (p.px[i] >= 16 && p.px[i] <= 23) seen++
  assert(seen === 8, 'every live slot holds a fresh write (oldest evicted first)')
})

test('particle pool: lifetimes retire particles and update() integrates motion', () => {
  const p = new ParticlePool(4)
  p.spawn(0, 0, 0, 10, 0, 0, 1, 1, 1, 0, 0) // 1 m/s drag/gravity-free path
  for (let i = 0; i < 60; i++) p.update(1 / 60)
  assert(p.isAlive(0), 'alive inside its life')
  assertFinite(p.px[0], 'position finite')
  assertNear(p.px[0], 10, 0.6, 'travels ~v*t after one second')
  for (let i = 0; i < 45; i++) p.update(1 / 60)
  assert(!p.isAlive(0), 'retired after its lifetime elapsed')
  assert(p.aliveCount() === 0, 'pool drains to zero')
})

test('particle pool: gravity pulls velocity and clear() kills everything at once', () => {
  const p = new ParticlePool(4)
  p.spawn(0, 5, 0, 0, 0, 0, 10, 1, 1, 0, 12)
  for (let i = 0; i < 30; i++) p.update(1 / 60)
  assert(p.vy[0] < 0, `gravity pulled vy to ${p.vy[0].toFixed(2)}`)
  p.clear()
  assert(p.aliveCount() === 0, 'clear() drops every record')
})

test('skid ring: persists across the lap, evicts round-robin, clears on demand', () => {
  const r = new SkidRing(16, SKIDS.holdSec, SKIDS.fadeSec)
  for (let i = 0; i < 10; i++) r.put(i, 0, 0, 0, 0, 0)
  assert(r.aliveCount() === 10, 'sub-capacity writes all persist')
  for (let i = 0; i < 16; i++) r.put(100 + i, 0, 0, 0, 0, 0)
  assert(r.aliveCount() === 16, 'ring saturates at capacity')
  let old = 0
  for (let i = 0; i < 16; i++) if (r.x[i] < 100) old++
  assert(old === 0, 'the first decade was fully evicted by newer writes')
  // deterministic recycling: slots 10..15 of the second pass overwrote 10..15? no — ring order
  const r2 = new SkidRing(4, SKIDS.holdSec, SKIDS.fadeSec)
  const slots = [r2.put(1, 0, 0, 0, 0, 0), r2.put(2, 0, 0, 0, 0, 0), r2.put(3, 0, 0, 0, 0, 0), r2.put(4, 0, 0, 0, 0, 0)]
  assert(slots.join(',') === '0,1,2,3', 'fill order is the slot order')
  const again = r2.put(5, 0, 0, 0, 0, 0)
  assert(again === 0 && r2.x[0] === 5, 'the oldest slot (first written) is recycled first')
  r.clear()
  assert(r.aliveCount() === 0, 'clear() wipes the board (restart hook)')
})

test('skid ring: marks hold, then fade out and return full ink only when re-laid', () => {
  const r = new SkidRing(8, 9, 17)
  r.put(0, 0, 0, 0, 0, 0)
  assertNear(r.ink(0), 1, 1e-6, 'fresh mark is at full ink')
  for (let i = 0; i < 9 * 10; i++) r.update(0.1)
  assert(r.ink(0) > 0.9, 'still near-full at the end of the hold window')
  for (let i = 0; i < 20 * 10; i++) r.update(0.1)
  assert(r.ink(0) === 0 && !r.isAlive(0), 'gone after hold+fade')
})

test('gamepad fold: RT/LT/stick/LB/RB drive the live InputState', () => {
  const s: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
  const pad: GamepadSnapshot = {
    axes: [0, 0, 0.75, 0],
    buttons: Array.from({ length: 16 }, (_, i) => ({
      pressed: i === PAD.rt || i === PAD.lb,
      value: i === PAD.rt ? 0.9 : i === PAD.lb ? 1 : 0,
    })),
  }
  const presence = applyPadToState(s, pad)
  assert(s.throttle > 0.8, `RT analogue folded into throttle (${s.throttle})`)
  assert(s.steer > 0.6, `stick steers (${s.steer})`)
  assert(s.handbrake, 'LB latches the handbrake')
  assert(!s.nitro, 'RB untouched stays false')
  assert(presence > 1, 'pad reports drive presence')
  const b: GamepadSnapshot = {
    axes: [0, 0, -0.9, 0],
    buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === PAD.lt || i === PAD.rb, value: i === PAD.lt ? 0.5 : i === PAD.rb ? 1 : 0 })),
  }
  const t: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
  applyPadToState(t, b)
  assert(t.brake > 0.4 && t.nitro && t.steer < -0.8, 'LT brake + RB nitro + left steer')
})

test('audio maps: engine pitch follows the tach and wind gates on speed', () => {
  assert(engineFreqFor(0) > 20 && engineFreqFor(0) < 120, 'idle pitch in a sensible band')
  assert(engineFreqFor(1) - engineFreqFor(0) > 150, 'full tach raises the pitch by a wide interval')
  assert(windLevelFor(UI.windInSpeed - 1) === 0, 'wind is out below its gate')
  assertNear(windLevelFor(UI.windFullSpeed + 5), 1, 1e-9, 'wind is in full above the ceiling')
  assert(windLevelFor((UI.windInSpeed + UI.windFullSpeed) / 2) > 0.3, 'wind crossfades between the gates')
})

test('quality tier: particle budgets scale with QUALITY[*].particles', () => {
  const t = QUALITY.medium.particles
  assert(t > 0 && t <= 1, 'tier multiplier is a sane fraction')
  const scaled = Math.floor(PARTICLES.smokeMax * t)
  assert(scaled <= PARTICLES.smokeMax, 'medium tier never exceeds the full budget')
  const small = new ParticlePool(Math.max(8, Math.floor(PARTICLES.sparkMax * QUALITY.low.particles)))
  assert(small.cap === Math.floor(PARTICLES.sparkMax * QUALITY.low.particles), 'low tier shrinks the spark pool')
})

test('audio surface without WebAudio: unlock stays unavailable, calls are no-ops', () => {
  const audio = new Audio()
  audio.unlock()
  assert(!audio.available, 'no AudioContext in node — the surface reports unavailable')
  audio.update(1 / 60, { rpm01: 0.7, load: 1, nitro: true, slip01: 0.5, speed: 40, active: true })
  audio.impact(4)
  audio.land(6)
  audio.launch()
  audio.nitroActivate()
  audio.countdownCue('go')
  audio.click()
  audio.reward()
  audio.setMuted(true)
  assert(true, 'every entry point survives a context-less environment')
})

test('FX config gates are consistent with the emission surfaces', () => {
  assert(FX.impactMin > 0 && FX.landMin > FX.impactMin, 'impact/landing gates ordered sensibly')
  assert(FX.smokeSpeedMin >= 4 && FX.dustSpeedMin < FX.smokeSpeedMin + 8, 'continuous FX gates sit in the drive envelope')
  assert(SKIDS.minSpeed > 0 && SKIDS.spacing > 0.2 && SKIDS.spacing < 1, 'decal spacing lands marks a foot apart at speed')
})
