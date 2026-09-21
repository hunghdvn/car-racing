import { VEHICLE } from '../../src/config'
import { PlayerVehicle } from '../../src/vehicles/PlayerVehicle'
import { isShortcutLane, spurAt, spurNear, spurTotal } from '../../src/vehicles/TrackProbe'
import { assert, assertFinite, test } from '../harness'
import { rig, SIM_DT } from '../rig'
import type { InputState } from '../../src/core/Input'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

test('shortcut spur: the probe reports the authored spur lane as asphalt, not grass', () => {
  const r = rig()
  const pose = spurAt(70)
  const c = r.probe.corridor(pose.x, pose.z)
  assertFinite(pose.y, 'spur surface height is finite')
  assert(c.onRoad, 'the spur centreline reads as road surface')
  assert(c.rough < 0.08, `the spur centreline is not loose (${c.rough.toFixed(2)})`)
  assert(Math.abs(c.lat) < 0.5, `the spur centreline is its own zero-lane (${c.lat.toFixed(2)})`)
})

test('shortcut spur: the drivable lane follows the formed ground instead of floating or burying itself', () => {
  const { field } = rig()
  const start = 12
  const end = spurTotal - 12
  for (let s = start; s <= end; s += 4) {
    const centre = spurAt(s)
    const lane = spurNear(centre.x, centre.z)
    assert(lane !== null, `the spur centreline at s=${s.toFixed(0)} resolves to a drivable lane`)
    if (lane === null) break
    const ground = field.height(lane.x, lane.z)
    assert(ground - lane.y < 0.45, `the spur is not buried at s=${s.toFixed(0)}: ground ${ground.toFixed(2)}, lane ${lane.y.toFixed(2)}`)
    assert(lane.y - ground < 0.45, `the spur is not floating at s=${s.toFixed(0)}: lane ${lane.y.toFixed(2)}, ground ${ground.toFixed(2)}`)
  }
})

test('shortcut spur: the main-line handoff recognises the diverging mouth as the spur lane', () => {
  const r = rig()
  const pose = spurAt(8)
  const c = r.probe.corridor(pose.x, pose.z)
  assert(c.onRoad, 'the mouth handoff reads as road surface')
  assert(c.rough < 0.08, `the mouth handoff is not grass (${c.rough.toFixed(2)})`)
  assert(Math.abs(c.lat) < 0.5, `the mouth handoff uses the spur's own zero-lane (${c.lat.toFixed(2)})`)
})

test('shortcut spur: the handoff can carry a main-line edge car across the mouth apron', () => {
  const r = rig()
  const c = r.probe.corridor(-450.7858127280542, 205.74110421359612)
  assert(c.onRoad, 'the main edge remains drivable while transitioning into the spur')
  assert(Number.isFinite(c.wall), 'the transition uses the spur wall instead of the main-line barrier')
  assert(Math.abs(c.wall - 3.9 - VEHICLE.barrierInset) < 1e-9, `the transition wall belongs to the spur (${c.wall.toFixed(2)})`)
})

test('shortcut spur: the shortcut bonus gate follows the curved spur lane, not the coarse control polyline', () => {
  for (const s of [60, 120, 180, 240]) {
    const pose = spurAt(s)
    assert(isShortcutLane(pose.x, pose.z), `the curved spur centreline at s=${s.toFixed(0)} is inside the bonus lane`)
  }
})

test('shortcut spur: the player can drive the alternate lane from mouth to mouth', () => {
  const r = rig()
  const pv = new PlayerVehicle(r.probe)
  const start = spurAt(28)
  pv.phys.resetAt(start.x, start.z, start.yaw, 16)
  const input: InputState = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }
  const dt = SIM_DT
  let t = 0
  let targetS = 28
  let bestSpurS = 0
  let travelled = 0
  let maxImpacts = 0
  let px = pv.phys.x
  let pz = pv.phys.z
  let lastOutside = false
  let lastSunk = false
  let lastLat = 0
  let lastY = 0
  const exitS = spurTotal - 22
  while (t < 14 && !pv.respawning && bestSpurS < exitS) {
    const near = spurNear(pv.phys.x, pv.phys.z)
    if (near) {
      bestSpurS = Math.max(bestSpurS, near.s)
      targetS = Math.max(targetS, near.s)
    }
    const aim = spurAt(clamp(targetS + 12 + pv.phys.speed * 0.45, 6, spurTotal - 4))
    let headingError = pv.phys.yaw - aim.yaw
    headingError = ((headingError + Math.PI) % (Math.PI * 2)) - Math.PI
    const rx = -aim.tz
    const rz = aim.tx
    const lat = (pv.phys.x - aim.x) * rx + (pv.phys.z - aim.z) * rz
    input.steer = clamp(headingError * 1.75 - lat * 0.075, -1, 1)
    input.throttle = pv.phys.speed < 34 ? 1 : 0.18
    pv.update(dt, input)
    travelled += Math.hypot(pv.phys.x - px, pv.phys.z - pz)
    px = pv.phys.x; pz = pv.phys.z
    maxImpacts = Math.max(maxImpacts, pv.events.impact)
    lastOutside = pv.phys.outside
    lastSunk = pv.phys.sunk
    lastLat = pv.phys.lat
    lastY = pv.phys.y
    t += dt
  }
  assert(!pv.respawning, `the spur does not trigger the out-of-corridor respawn policy (spurS=${bestSpurS.toFixed(1)}, lat=${lastLat.toFixed(2)}, y=${lastY.toFixed(2)}, outside=${String(lastOutside)}, sunk=${String(lastSunk)})`)
  assert(bestSpurS > spurTotal * 0.78, `the car progressed along the spur (${bestSpurS.toFixed(1)} / ${spurTotal.toFixed(1)} m)`)
  assert(travelled > spurTotal * 0.72, `the car covered the spur distance (${travelled.toFixed(1)} m)`)
  assert(pv.phys.speed > VEHICLE.topSpeed * 0.3, `the spur is drivable at speed (${pv.phys.speed.toFixed(1)} m/s)`)
  assertFinite(maxImpacts, 'spur collision telemetry stays finite')
})
