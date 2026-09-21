import { NITRO, VEHICLE } from '../../src/config'
import { assert, assertNear, assertFinite, test } from '../harness'
import { drive, flatCar } from '../rig'

/* Pure-planar drive units on the flat pad (no corridor interference). */

test('accel curve: monotone run-in, settles ~topSpeed, never exceeds the cap', () => {
  const { pv } = flatCar()
  pv.resetTo(320, 0)
  let prev = 0, monotone = true, aboveCap = false
  drive(pv, 14, (t, i) => {
    i.throttle = 1
    if (pv.phys.speed < prev - 0.15 && t > 2 && pv.phys.speed < VEHICLE.topSpeed * 0.85) monotone = false
    if (pv.phys.speed > VEHICLE.topSpeed + 0.35) aboveCap = true
    prev = pv.phys.speed
  })
  const v = pv.phys.speed
  assert(monotone, 'speed profile monotone while still far from the cap')
  assert(!aboveCap, `speed never exceeds the topSpeed cap (${v.toFixed(2)})`)
  assert(v > VEHICLE.topSpeed * 0.85 && v <= VEHICLE.topSpeed + 0.2, `terminal ${v.toFixed(2)} in [${(VEHICLE.topSpeed * 0.85).toFixed(1)}, ${VEHICLE.topSpeed}]`)
  assertFinite(v, 'terminal speed finite')
})

test('time-to-pace: 90 % of topSpeed inside 12 s', () => {
  const { pv } = flatCar()
  pv.resetTo(320, 0)
  let t90 = -1
  const dt = 1 / 120
  let t = 0
  const i = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }
  while (t < 15 && t90 < 0) {
    pv.update(dt, i)
    if (t90 < 0 && pv.phys.speed >= VEHICLE.topSpeed * 0.9) t90 = t
    t += dt
  }
  assert(t90 > 3 && t90 < 12, `t(0.9 topSpeed)=${t90.toFixed(2)} s in (3,12)`)
})

test('braking: v²/2a stop distance from top speed', () => {
  const { pv } = flatCar()
  pv.resetTo(320, VEHICLE.topSpeed * 0.98)
  const v0 = pv.phys.speed
  const dt = 1 / 120
  let t = 0, d = 0, px = pv.phys.x, pz = pv.phys.z
  const i = { throttle: 0, brake: 1, steer: 0, handbrake: false, nitro: false }
  while (t < 5 && pv.phys.speed > 0.6) {
    pv.update(dt, i)
    d += Math.hypot(pv.phys.x - px, pv.phys.z - pz)
    px = pv.phys.x; pz = pv.phys.z; t += dt
  }
  // mean deceleration = brakeForce + half drag contribution + rolling
  const a = VEHICLE.brakeForce + 0.5 * (VEHICLE.drag * v0 * v0 + VEHICLE.rollResist)
  const expected = (v0 * v0) / (2 * a)
  assertNear(d, expected, expected * 0.22, `stop distance ${d.toFixed(1)} m ≈ v²/2a ${expected.toFixed(1)} m`)
  assert(t > 1.6 && t < 3.0, `stop time ${t.toFixed(2)} s plausible`)
})

test('drift: handbrake grows slip angle, counter-steer recovers', () => {
  const { pv } = flatCar()
  pv.resetTo(320, 22)
  // phase 1: handbrake + right steer -> nose yaws right of travel
  drive(pv, 1.3, (_t, i) => {
    i.throttle = 0.15
    i.steer = 1
    i.handbrake = true
  })
  const p = pv.phys
  assert(p.drift > 0.25, `drift angle grew right-of-travel: ${p.drift.toFixed(2)}`)
  assert(Math.abs(p.yawRate) > 0.8, `yaw authority active: ${p.yawRate.toFixed(2)}`)
  const peak = p.drift
  assertFinite(peak, 'drift finite under handbrake')
  // phase 2: release + opposite steer (counter-steer) -> slip returns to zero
  drive(pv, 1.2, (_t, i) => {
    i.throttle = 0.15
    i.steer = -1
    i.handbrake = false
  })
  assert(Math.abs(p.slip) < 0.16, `slip recovered after counter-steer: ${p.slip.toFixed(3)}`)
  assert(Math.abs(p.drift) < 0.19, `drift view normalised back: ${p.drift.toFixed(3)}`)
})

test('steering: full lock cannot outrun the wheel-lock geometry at crawl speeds', () => {
  for (const speed of [3, 5, 7.5]) {
    const { pv } = flatCar()
    pv.resetTo(320, speed)
    let worst = 0
    drive(pv, 2, (_t, i, p) => {
      i.throttle = p.forwardSpeed < speed ? 1 : 0
      i.brake = p.forwardSpeed > speed + 0.4 ? 0.18 : 0
      i.steer = 1
      const lock = (Math.max(p.speed, 0.6) * Math.tan(VEHICLE.steerMaxRad)) / VEHICLE.wheelbase
      worst = Math.max(worst, Math.abs(p.yawRate) / lock)
    })
    assert(worst <= 1.15, `v=${speed}: peak yaw exceeds wheel-lock geometry by ${(worst * 100 - 100).toFixed(0)} %`)
  }
})

test('steering: ordinary cornering does not demand more lateral grip than the tyre circle provides', () => {
  for (const speed of [6, 7, 7.5, 7.9]) {
    const { pv } = flatCar()
    pv.resetTo(320, speed)
    let peakDemand = 0
    drive(pv, 2, (_t, i, p) => {
      i.throttle = p.forwardSpeed < speed ? 1 : 0
      i.brake = p.forwardSpeed > speed + 0.4 ? 0.18 : 0
      i.steer = 1
      peakDemand = Math.max(peakDemand, p.speed * Math.abs(p.yawRate))
    })
    assert(peakDemand <= VEHICLE.gripMax * 1.10, `v=${speed}: demanded ${peakDemand.toFixed(2)} m/s² exceeds grip ${VEHICLE.gripMax}`)
  }
})

test('steering: yaw authority is continuous through the low-speed grip gate', () => {
  const steadyYaw = (speed: number): number => {
    const { pv } = flatCar()
    pv.resetTo(320, speed)
    drive(pv, 1.8, (_t, i, p) => {
      i.throttle = p.forwardSpeed < speed ? 1 : 0
      i.brake = p.forwardSpeed > speed + 0.4 ? 0.18 : 0
      i.steer = 1
    })
    return Math.abs(pv.phys.yawRate)
  }
  let previous = steadyYaw(7)
  for (const speed of [7.5, 8, 8.5]) {
    const current = steadyYaw(speed)
    assert(previous - current < 0.25, `authority cliff between ${speed - 0.5} and ${speed}: ${previous.toFixed(2)} -> ${current.toFixed(2)}`)
    previous = current
  }
})

test('steering visuals: the front wheels follow the driver command while grip limits the arc', () => {
  for (const speed of [20, 35, 45]) {
    const { pv } = flatCar()
    pv.resetTo(320, speed)
    drive(pv, 2.5, (_t, i, p) => {
      i.throttle = p.forwardSpeed < speed ? 1 : 0
      i.brake = p.forwardSpeed > speed + 0.6 ? 0.18 : 0
      i.steer = 1
    })
    assert(Math.abs(pv.phys.steerVis) >= VEHICLE.steerMaxRad * 0.80, `v=${speed}: wheel angle ${pv.phys.steerVis.toFixed(3)} rad, command ${VEHICLE.steerMaxRad.toFixed(2)} rad`)
  }
})

test('nitro: beats the un-nitro pace at equal time, drains, and refills from drift/clean run', () => {
  const run = (withNitro: boolean): { at: (t: number) => number; val: number } => {
    const { pv } = flatCar()
    pv.resetTo(320, 32)
    if (withNitro) pv.nitroVal = NITRO.max
    const marks: Record<string, number> = {}
    drive(pv, 4, (_t, i) => {
      i.throttle = 1
      i.nitro = withNitro
      marks[_t.toFixed(1)] = pv.phys.speed
    })
    return { at: (t) => marks[t.toFixed(1)] ?? 0, val: pv.nitroVal }
  }
  const plain = run(false)
  const boost = run(true)
  assert(boost.at(3.5) > plain.at(3.5) + 5, `nitro pulls ahead: ${boost.at(3.5).toFixed(1)} vs ${plain.at(3.5).toFixed(1)} m/s at 3.5 s`)
  assert(boost.at(3.5) > VEHICLE.topSpeed * 0.99, `nitro crosses the natural cap: ${boost.at(3.5).toFixed(1)} m/s`)
  const r = run(true)
  assert(r.val < NITRO.max - NITRO.drainPerSec * 2.5, `drain tracked: ${r.val.toFixed(0)} after 4 s`)
  // refill on drift
  const { pv } = flatCar()
  pv.resetTo(320, 22)
  pv.nitroVal = 5
  const v0 = pv.nitroVal
  drive(pv, 2.4, (_t, i) => { i.throttle = 0.2; i.steer = 0.85; i.handbrake = true })
  assert(pv.nitroVal > v0 + NITRO.chargeDriftPerSec * 1.2, `drift charged ${pv.nitroVal.toFixed(1)} (from ${v0.toFixed(1)})`)
  // chain bonus landed at least once
  assert(pv.nitroVal >= v0 + NITRO.chargeDriftPerSec * 2.4, `charge accounted (chain optional): ${pv.nitroVal.toFixed(1)}`)
  // clean-run trickle
  const v1 = pv.nitroVal
  drive(pv, 5, (_t, i) => { i.throttle = 0.9 })
  assert(pv.nitroVal > v1 + NITRO.chargeCleanPerSec * 2.5, `clean running charged ${pv.nitroVal.toFixed(1)} (from ${v1.toFixed(1)})`)
})

test('nitro: resetTo re-arms a used nitro tank for a clean race replay', () => {
  const { pv } = flatCar()
  pv.resetTo(320, 30)
  pv.nitroVal = NITRO.max
  pv.nitroActive = true
  pv.resetTo(320, 0)
  assert(pv.nitroVal === NITRO.startValue, `fresh race restores the starting tank (${pv.nitroVal})`)
  assert(!pv.nitroActive, 'fresh race does not inherit a live boost')
  assert(!pv.cmd.nitro, 'fresh race does not inherit the nitro drive command')
})

test('determinism: identical script -> bit-identical state', () => {
  const script = (seedless?: boolean): string => {
    void seedless
    const { pv } = flatCar()
    pv.resetTo(320, 18)
    drive(pv, 6, (t, i) => {
      i.throttle = t < 4 ? 1 : 0
      i.steer = Math.sin(t * 2.7)
      i.handbrake = t > 2.2 && t < 3.1
      i.nitro = t > 1 && t < 5
    })
    const p = pv.phys
    return JSON.stringify([p.x, p.y, p.z, p.yaw, p.vx, p.vy, p.vz, p.yawRate, p.susp, pv.nitroVal, pv.events])
  }
  assert(script() === script(), 'two identical runs produce identical state')
})
