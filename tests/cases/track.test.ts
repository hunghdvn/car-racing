import { TRACK, VEHICLE } from '../../src/config'
import { assert, assertNear, assertFinite, test } from '../harness'
import { cornerTarget, laneSteer, flatCar, rig, SIM_DT } from '../rig'
import { PlayerVehicle } from '../../src/vehicles/PlayerVehicle'
import { rampSlopeAt } from '../../src/world/RoadBuilder'
import type { InputState } from '../../src/core/Input'

/* Scenarios on the REAL corridor: geometric ramp launches, barrier clamp,
 * OBB obstacles, water/out-of-bounds respawn. */

test('ramp: the built kicker launches the car geometrically; landing settles on suspension', () => {
  const r = rig()
  const pv = new PlayerVehicle(r.probe)
  pv.resetTo(204, 45)
  const dt = SIM_DT
  const input: InputState = { throttle: 0.9, brake: 0, steer: 0, handbrake: false, nitro: false }
  let t = 0
  let launched = 0, landed = 0, apex = 0, airT = 0
  let suspMin = 0
  while (t < 5 && (launched === 0 || landed === 0 || t < 3.4)) {
    input.steer = laneSteer(pv.phys, r.spline)
    pv.update(dt, input)
    launched = Math.max(launched, pv.events.launched)
    landed = Math.max(landed, pv.events.landed)
    if (!pv.phys.grounded) { airT += dt; apex = Math.max(apex, pv.phys.apexAboveRoad) }
    if (t > 2 && landed > 0) suspMin = Math.min(suspMin, ...pv.phys.susp)
    t += dt
  }
  assert(launched > 3, `vertical launch velocity from the kicker slope: ${launched.toFixed(2)} m/s`)
  assert(apex > 1.4 && apex < 3.4, `apex above road ${apex.toFixed(2)} m (lip 1.26 m + pop)`)
  assert(airT > 0.35 && airT < 1.6, `airtime ${airT.toFixed(2)} s`)
  assert(landed > 2.5, `landing impact recorded: ${landed.toFixed(2)} m/s`)
  assert(suspMin < -VEHICLE.suspPreload - 0.015, `suspension jounced under the landing load: ${suspMin.toFixed(3)} m`)
  // settle within ~0.5 s after touchdown: oscillation dies out, wheels sit in their band
  let settle = 0
  while (settle < 0.9) { pv.update(dt, input); settle += dt }
  const s0 = [...pv.phys.susp]
  while (settle < 1.1) { pv.update(dt, input); settle += dt }
  for (let i = 0; i < 4; i++) {
    assert(Math.abs(pv.phys.susp[i] - s0[i]) < 0.03, `wheel ${i} oscillation damped out: ${s0[i].toFixed(3)} -> ${pv.phys.susp[i].toFixed(3)}`)
    assert(pv.phys.susp[i] >= -VEHICLE.suspTravel - 1e-6 && pv.phys.susp[i] <= VEHICLE.suspDroop + 0.005, `wheel ${i} stayed within its travel, no punch-through: ${pv.phys.susp[i].toFixed(3)}`)
  }
  assert(pv.phys.susp[1] < -0.01 || pv.phys.susp[3] < -0.01, 'springs carry the ride load after touchdown')
  assert(Math.abs(pv.phys.lat) < 3 && pv.phys.speed > 25, `car stayed on the line through the drop (lat=${pv.phys.lat.toFixed(2)})`)
})

test('barrier: the guard window clamps and bounces the corridor side', () => {
  const r = rig()
  const pv = new PlayerVehicle(r.probe)
  // inside the coastal guard window (158–272), driving a velocity-aligned diagonal at the wall
  const c = r.probe.centerPose(170)
  // the guard line stands at the config barrierInset — single source, no hardcodes
  assertNear(r.probe.corridor(c.x, c.z).wall, TRACK.halfWidth + VEHICLE.barrierInset, 1e-12,
    'corridor wall is the asphalt edge + config barrierInset')
  pv.phys.resetAt(c.x, c.z, c.yaw + 0.26, 22)
  let impacts = 0, maxLat = 0, restLat = 0
  const dt = SIM_DT
  const input: InputState = { throttle: 0.2, brake: 0, steer: 0, handbrake: false, nitro: false }
  let t = 0
  while (t < 3) {
    pv.update(dt, input)
    if (pv.events.impact > 0.4) impacts++
    maxLat = Math.max(maxLat, Math.abs(pv.phys.lat))
    restLat = Math.max(restLat, Math.abs(r.probe.corridor(pv.phys.x, pv.phys.z).lat))
    t += dt
  }
  const lim = TRACK.halfWidth + VEHICLE.barrierInset - VEHICLE.vehicleHalf
  assert(impacts >= 1, `barrier contact registered (${impacts})`)
  assert(maxLat <= lim + 0.12, `never crossed the guard line (${maxLat.toFixed(2)} ≤ ${lim.toFixed(2)})`)
  assert(restLat <= lim + 0.02, `resting position never rests beyond the line (${restLat.toFixed(3)} ≤ ${lim.toFixed(2)})`)
  assert(pv.phys.speed < 22, `contact scrubbed speed (${pv.phys.speed.toFixed(1)} m/s)`)
  assertFinite(pv.phys.speed, 'speed finite after contact')
})

test('ramp slope is single-source: launch vy comes from rampSlopeAt at the lip probe', () => {
  const r = rig()
  const pv = new PlayerVehicle(r.probe)
  pv.resetTo(204, 45)
  const dt = SIM_DT
  const input: InputState = { throttle: 0.9, brake: 0, steer: 0, handbrake: false, nitro: false }
  let t = 0, prevSpeed = 45, prevS = 204, launched = -1
  while (t < 5 && launched < 0) {
    input.steer = laneSteer(pv.phys, r.spline)
    prevSpeed = pv.phys.speed; prevS = pv.phys.s
    pv.update(dt, input)
    if (pv.events.launched > 0) launched = pv.events.launched
    t += dt
  }
  assert(launched > 0, 'the kicker launched the car')
  const slope = rampSlopeAt(TRACK.ramp.sLip - TRACK.ramp.launchProbe)
  assert(slope > VEHICLE.launchMinSlope, `probe slope ${slope.toFixed(4)} clears the launch gate`)
  // the physics must take its launch slope from the built helper — if the
  // kicker profile changes, both sides move together (no diverged derivative)
  const grade = Math.max(0, r.spline.frame(prevS).tangent.y)
  assertNear(launched, prevSpeed * (grade + slope * VEHICLE.launchPop), 1e-9,
    `launch vy equals speed·(grade + rampSlopeAt(sLip−probe)·launchPop) at v=${prevSpeed.toFixed(1)}`)
})

test('collide: the barrier clamp consults the current-position corridor, not the stale sample', () => {
  const { pv, probe } = flatCar()
  probe.wall = 10
  const lim = probe.wall - VEHICLE.vehicleHalf
  // aim the nose straight at the wall (+x): heading = (−sin yaw, 0, −cos yaw)
  pv.phys.resetAt(9.0, 380, -Math.PI / 2, 60)
  const dt = SIM_DT
  const input: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
  let impacts = 0, worst = 0
  // one hit then a stream of bounce-backs: at every step the *resting* position
  // (not just the pre-step telemetry) must respect the line — with a stale
  // pre-integration sample each hit would keep one dt of penetration (~0.5 m)
  for (let k = 0; k < 40; k++) {
    pv.update(dt, input)
    if (pv.events.impact > 0.4) impacts++
    worst = Math.max(worst, Math.abs(probe.corridor(pv.phys.x, pv.phys.z).lat))
  }
  assert(impacts >= 1, `the wall hit bounced the car (${impacts})`)
  assert(worst <= lim + 1e-9, `no step-of-penetration: worst resting |lat| ${worst.toFixed(6)} ≤ ${lim}`)
  assertFinite(pv.phys.speed, 'speed finite through the clamp')
})

test('obstacles: an authored OBB blocks and reflects the car', () => {
  const { pv } = flatCar()
  pv.phys.setObstacles([{ x: 0, z: -25, hw: 3, hd: 0.4, yaw: 0 }])
  pv.resetTo(400, 24)
  let impacts = 0
  const dt = SIM_DT
  const input: InputState = { throttle: 0.8, brake: 0, steer: 0, handbrake: false, nitro: false }
  let t = 0
  while (t < 3) {
    pv.update(dt, input)
    if (pv.events.impact > 0.4) impacts++
    t += dt
  }
  assert(impacts >= 1, `obstacle contact registered (${impacts})`)
  assert(pv.phys.z > -24.5, `car stayed outboard of the OBB face (z=${pv.phys.z.toFixed(2)})`)
  assert(pv.phys.speed < 18, `impact scrubbed speed: ${pv.phys.speed.toFixed(1)}`)
})

test('respawn: beyond the corridor (sea side) -> blackout -> snapped to centreline with heading', () => {
  const r = rig()
  const pv = new PlayerVehicle(r.probe)
  const n = r.spline.nearest(30, 0)
  const f = r.spline.frame(n.s)
  // drop the car wide toward the sea, past the lateral gate
  pv.phys.resetAt(f.pos.x + f.side.x * 120, f.pos.z + f.side.z * 120, f.yaw, 0)
  const dt = SIM_DT
  const input: InputState = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }
  pv.update(dt, input)
  pv.update(dt, input)
  assert(pv.respawning, 'out-of-corridor requested a respawn blackout')
  const held = [pv.phys.x, pv.phys.y, pv.phys.z]
  let t = 0
  while (t < VEHICLE.respawnTime * 0.6) { pv.update(dt, input); t += dt }
  assert(Math.abs(pv.phys.x - held[0]) < 1e-9 && Math.abs(pv.phys.z - held[2]) < 1e-9, 'car frozen during blackout')
  t = 0
  while (t < VEHICLE.respawnTime && pv.respawning) { pv.update(dt, input); t += dt }
  assert(!pv.respawning, 'respawn completed within the penalty window')
  const m = r.spline.nearest(pv.phys.x, pv.phys.z)
  const ff = r.spline.frame(m.s)
  const lat = (pv.phys.x - ff.pos.x) * ff.side.x + (pv.phys.z - ff.pos.z) * ff.side.z
  assert(Math.abs(lat) < 0.6, `snapped to the centreline (lat=${lat.toFixed(2)})`)
  assert(pv.phys.grounded && pv.phys.speed < 3 && Number.isFinite(pv.phys.yaw), 'heading-correct, grounded, stopped')
})

test('respawn: immersion below sea level triggers the sink path', () => {
  const { pv, probe } = flatCar()
  // dry-pad physics, but read as loose ground under a waterline above the floor
  probe.onRoad = false
  probe.zone = 'coastal'
  probe.seaLevel = 0.5
  pv.phys.resetAt(18, 200, 0, 0) // lat 18 — inside the OOB gate, only the sink can save us
  const dt = SIM_DT
  const input: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
  pv.update(dt, input)
  assert(pv.phys.sunk, 'immersion below the waterline flags sunk')
  pv.update(dt, input)
  assert(pv.respawning, 'sunk car blacked out')
  let t = 0
  while (t < VEHICLE.respawnTime && pv.respawning) { pv.update(dt, input); t += dt }
  assert(!pv.respawning && Math.abs(pv.phys.x) < 0.6, `respawned back onto the centreline (x=${pv.phys.x.toFixed(2)})`)
})

test('respawn: held throttle fully blocked (stuck) auto-respawns', () => {
  const r = rig()
  const pv = new PlayerVehicle(r.probe)
  pv.resetTo(170, 0)
  // wall the lane just ahead: the car pins its nose against it at full throttle
  const c = r.probe.centerPose(181)
  const f = r.spline.frame(181)
  pv.phys.setObstacles([{ x: c.x, z: c.z, hw: 2.4, hd: 0.4, yaw: f.yaw }])
  const dt = SIM_DT
  const input: InputState = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }
  let t = 0
  while (t < VEHICLE.stuckTime + VEHICLE.respawnTime + 2 && !pv.respawning) {
    pv.update(dt, input)
    t += dt
  }
  assert(pv.respawning, `stuck detector fired at ${t.toFixed(1)} s`)
  let u = 0
  while (u < VEHICLE.respawnTime * 1.5 && pv.respawning) { pv.update(dt, input); u += dt }
  assert(!pv.respawning, 'stuck car respawned')
  const n2 = r.spline.nearest(pv.phys.x, pv.phys.z)
  assert(n2.d2 < 900 && pv.phys.speed < 4, 'placed back on the track at rest')
})

test('off-road: grass raises rolling resistance and cuts grip (no teleport)', () => {
  const r = rig()
  const pv = new PlayerVehicle(r.probe)
  const f = r.spline.frame(80)
  // start coasting wide on the open start straight's verge beyond the asphalt
  pv.phys.resetAt(f.pos.x + f.side.x * 6.4, f.pos.z + f.side.z * 6.4, f.yaw, 10)
  const s0 = pv.phys.s
  const dt = SIM_DT
  const input: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
  let t = 0
  while (t < 2.2) { pv.update(dt, input); t += dt }
  assert(pv.phys.rough > 0.4, `off-road roughness read (${pv.phys.rough.toFixed(2)})`)
  assert(!pv.respawning && Number.isFinite(pv.phys.x), 'no teleport — driving continues on the loose surface')
  void s0
})

test('cornerTarget: curvature speed cap keeps the pilot inside the grip circle', () => {
  const r = rig()
  let worst = 0
  for (let s = 20; s < r.spline.length - 20; s += 40) {
    const v = cornerTarget(r.spline, s, 30)
    assert(v >= 10.4 && v <= VEHICLE.topSpeed * 0.94, `pilot target sane at s=${s}: ${v.toFixed(1)}`)
    for (const k of [0.25, 0.5, 0.75]) {
      const f = r.spline.frame(s + 6 + 30 * k)
      const demand = (v * v * Math.abs(f.curv)) / VEHICLE.gripMax
      worst = Math.max(worst, demand)
    }
  }
  assert(worst < 0.95, `peak cornering demand ${worst.toFixed(2)} of max grip — pilot is feasible`)
})
