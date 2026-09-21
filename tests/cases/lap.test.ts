import { VEHICLE } from '../../src/config'
import { assert, test } from '../harness'
import { cornerTarget, laneSteer, rig, SIM_DT } from '../rig'
import { PlayerVehicle } from '../../src/vehicles/PlayerVehicle'
import type { InputState } from '../../src/core/Input'

/* Self-driving smoke: a scripted-input pilot bot steers the full ~3.1 km
 * circuit (all six zones, kicker, tunnel, deck) under the real physics with
 * zero rendering — the headless proof the drive model is drivable. */

interface LapResult {
  completed: boolean
  seconds: number
  progress: number
  length: number
  maxLat: number
  impacts: number
  respawns: number
  launchings: number
  landings: number
  apex: number
  maxSpeed: number
  nan: boolean
}

function runLap(): LapResult {
  const { spline, probe } = rig()
  const pv = new PlayerVehicle(probe)
  const L = spline.length
  pv.resetTo(30, 6)
  const dt = SIM_DT
  const input: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
  let t = 0, prevS = 30, progress = 0, maxLat = 0, impacts = 0, respawns = 0
  let launchings = 0, landings = 0, apex = 0, maxSpeed = 0, nan = false
  let wasRespawning = false
  while (t < 220 && progress < L - 40) {
    const p = pv.phys
    const n = spline.nearest(p.x, p.z)
    const f = spline.frame(n.s)
    const lat = (p.x - f.pos.x) * f.side.x + (p.z - f.pos.z) * f.side.z
    const vT = cornerTarget(spline, n.s, p.speed)
    const err = vT - p.speed
    input.throttle = err > 0 ? Math.min(1, 0.5 + err / 8) : 0
    input.brake = err < -4 ? Math.min(1, -err / 12) : 0
    input.steer = laneSteer(p, spline)
    pv.update(dt, input)

    let d = n.s - prevS
    if (d > L / 2) d -= L
    else if (d < -L / 2) d += L
    progress += d
    prevS = n.s
    maxLat = Math.max(maxLat, Math.abs(lat))
    maxSpeed = Math.max(maxSpeed, p.speed)
    if (pv.events.impact > 0.4) impacts++
    if (pv.events.launched > 0) launchings++
    if (pv.events.landed > 1) landings++
    apex = Math.max(apex, p.apexAboveRoad)
    if (pv.respawning && !wasRespawning) respawns++
    wasRespawning = pv.respawning
    if (!Number.isFinite(p.x + p.y + p.z + p.vx + p.vz)) { nan = true; break }
    t += dt
  }
  return { completed: progress >= L - 40, seconds: t, progress, length: L, maxLat, impacts, respawns, launchings, landings, apex, maxSpeed, nan }
}

test('lap-bot: scripted pilot completes the full circuit without crashing', () => {
  const r = runLap()
  console.log(
    `  [lap-bot] completed=${r.completed} time=${r.seconds.toFixed(1)}s ` +
    `progress=${((r.progress / r.length) * 100).toFixed(1)}%/${r.length.toFixed(0)}m ` +
    `max|lat|=${r.maxLat.toFixed(2)}m impacts=${r.impacts} respawns=${r.respawns} ` +
    `launchings=${r.launchings} landings=${r.landings} apex=${r.apex.toFixed(2)}m maxv=${r.maxSpeed.toFixed(1)}m/s`,
  )
  assert(!r.nan, 'simulation stayed finite for the whole run')
  assert(r.completed, `lap completed (${(r.progress / r.length * 100).toFixed(1)}% in ${r.seconds.toFixed(0)} s)`)
  assert(r.seconds > 45, `lap is not absurdly fast (${r.seconds.toFixed(0)} s)`)
  assert(r.maxLat < 5.0, `pilot stayed inside the corridor (max |lat| ${r.maxLat.toFixed(2)} m)`)
  assert(r.impacts === 0, `clean lap — no barrier contacts (${r.impacts})`)
  assert(r.respawns === 0, `no respawns needed (${r.respawns})`)
  assert(r.launchings >= 1 && r.landings >= 1, `kicker launched + settled (${r.launchings}/${r.landings})`)
  assert(r.maxSpeed > VEHICLE.topSpeed * 0.8, `reached racing pace on the straights (${r.maxSpeed.toFixed(0)} m/s)`)
})
