import { AI, RACE, SEED, VEHICLE } from '../../src/config'
import { assert, assertFinite, test } from '../harness'
import { cornerTarget, laneSteer, rig, SIM_DT } from '../rig'
import { PlayerVehicle } from '../../src/vehicles/PlayerVehicle'
import { AIVehicle, aiSlotSeed, stepAIField, type AIContext, type RivalView } from '../../src/vehicles/AIVehicle'
import { RaceDirector, gridSlot, type RaceStanding } from '../../src/game/RaceDirector'
import { VehicleVisual, bindAIFieldVisuals } from '../../src/vehicles/Vehicle'
import type { CarModel } from '../../src/assets/CarModel'
import type { InputState } from '../../src/core/Input'

/* Phase 7 — AI + Race Director headless suite (brief "Tests and gates").
 * The field is the real thing: PlayerVehicle + AI.count AIVehicles driven by
 * the RaceDirector through the fixed-dt accumulator order Game uses, over the
 * real spline/corridor. Every run here is wall-clock-free and seeded. */

interface Field {
  player: PlayerVehicle
  cars: AIVehicle[]
  director: RaceDirector
  rivals: RivalView[]
  grid: { s: number; lat: number }[]
}

function buildField(): Field {
  const { spline, probe } = rig()
  const L = spline.length
  const player = new PlayerVehicle(probe)
  const cars: AIVehicle[] = []
  for (let i = 0; i < AI.count; i++) cars.push(new AIVehicle(i, spline, probe))
  const grid: { s: number; lat: number }[] = []
  const g0 = gridSlot(0, L)
  player.resetTo(g0.s, 0, g0.lat)
  grid.push(g0)
  for (let i = 0; i < cars.length; i++) {
    const g = gridSlot(i + 1, L)
    cars[i].resetTo(g.s, g.lat)
    grid.push(g)
  }
  const director = new RaceDirector(
    [{ id: 0, phys: player.phys }, ...cars.map((c, i) => ({ id: i + 1, phys: c.phys }))],
    L,
  )
  const rivals: RivalView[] = [{ phys: player.phys }, ...cars]
  return { player, cars, director, rivals, grid }
}

function gridField(f: Field): void {
  const { spline } = rig()
  const L = spline.length
  const g0 = gridSlot(0, L)
  f.player.resetTo(g0.s, 0, g0.lat)
  for (let i = 0; i < f.cars.length; i++) {
    const g = gridSlot(i + 1, L)
    f.cars[i].resetTo(g.s, g.lat)
  }
}

interface RunReport {
  finished: boolean
  simTime: number
  steps: number
  standings: readonly RaceStanding[]
  maxLat: number
  maxSpeed: number
  minSep: number
  stackedFrames: number
  impacts: number
  recoveries: number
  nan: boolean
}

/** drive one field from GO to the flag (or budget) with the scripted pilot */
function runRace(f: Field, budget: number, onStep?: (t: number, rep: RunReport) => void): RunReport {
  const { spline } = rig()
  const input: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
  const ctx: AIContext = { locked: false, leaderProgress: 0, progress: 0 }
  const rep: RunReport = {
    finished: false, simTime: 0, steps: 0, standings: [],
    maxLat: 0, maxSpeed: 0, minSep: Infinity, stackedFrames: 0,
    impacts: 0, recoveries: 0, nan: false,
  }
  let t = 0
  while (f.director.phase !== 'finished' && t < budget) {
    f.director.update(SIM_DT)
    const p = f.player.phys
    // the Phase-6 lap-bot pilot drives the player car
    const n = spline.nearest(p.x, p.z)
    const vT = cornerTarget(spline, n.s, p.speed)
    const err = vT - p.speed
    input.throttle = err > 0 ? Math.min(1, 0.5 + err / 8) : 0
    input.brake = err < -4 ? Math.min(1, -err / 12) : 0
    input.steer = laneSteer(p, spline)
    f.player.update(SIM_DT, input, f.director.locked())
    ctx.locked = f.director.locked() || f.director.phase === 'finished'
    ctx.leaderProgress = f.director.leaderProgress()
    for (let i = 0; i < f.cars.length; i++) {
      const st = f.director.standingFor(i + 1)
      ctx.progress = st ? st.fraction : 0
      f.cars[i].update(SIM_DT, ctx, f.rivals)
    }
    t += SIM_DT
    rep.steps++
    if (!ctx.locked && f.director.phase === 'racing') {
      const ps = [p, ...f.cars.map((c) => c.phys)]
      for (const q of ps) {
        rep.maxLat = Math.max(rep.maxLat, Math.abs(q.lat))
        rep.maxSpeed = Math.max(rep.maxSpeed, q.speed)
        if (!Number.isFinite(q.x + q.y + q.z + q.vx + q.vy + q.vz)) rep.nan = true
      }
      // spacing contract covers the AI field: the scripted player pilot has
      // no avoidance duty (car-car collision is Phase 8's shared-physics work)
      for (let i = 1; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i], b = ps[j]
          const d = Math.hypot(a.x - b.x, a.z - b.z)
          if (d < rep.minSep) rep.minSep = d
          // two cars in one racing slot: same station AND same lane
          if (Math.abs(a.s - b.s) < 1 && Math.abs(a.lat - b.lat) < 1) rep.stackedFrames++
        }
      }
      if (f.player.events.impact > 0.4) rep.impacts++
      for (const c of f.cars) if (c.events.impact > 0.4) rep.impacts++
    }
    onStep?.(t, rep)
  }
  rep.simTime = f.director.simTime
  rep.standings = [...f.director.results]
  rep.finished = f.director.phase === 'finished' && rep.standings.length === RACE.cars
  rep.recoveries = f.cars.reduce((s, c) => s + c.recoveries, 0)
  return rep
}

/* the full field race is expensive — one canonical run backs several gates */
let _shared: { f: Field; rep: RunReport } | null = null
function sharedRace(): { f: Field; rep: RunReport } {
  if (!_shared) {
    const f = buildField()
    f.director.start()
    _shared = { f, rep: runRace(f, 200) }
  }
  return _shared
}

/* ------------------------------------------------- 1: completability */

test('ai-field: the five AIs + player complete the full circuit headlessly', () => {
  const { rep } = sharedRace()
  console.log(
    `  [ai-field] finished=${rep.finished} t=${rep.simTime.toFixed(1)}s ` +
    `max|lat|=${rep.maxLat.toFixed(2)} maxv=${rep.maxSpeed.toFixed(1)} ` +
    `minSep=${rep.minSep.toFixed(2)} stacked=${rep.stackedFrames} ` +
    `impacts=${rep.impacts} recoveries=${rep.recoveries}`,
  )
  assert(!rep.nan, 'every car stayed finite for the whole race')
  assert(rep.finished, `all ${RACE.cars} cars crossed the flag (${rep.standings.length} classified)`)
  assert(rep.simTime > 45 && rep.simTime < 200, `race inside the time bound (${rep.simTime.toFixed(0)} s)`)
  for (const r of rep.standings) {
    assert(r.finished, `car ${r.id} finished`)
    assertFinite(r.finishTime, `car ${r.id} finish time finite`)
    assert(r.fraction >= 0.98, `car ${r.id} covered the full circuit (${(r.fraction * 100).toFixed(1)}%)`)
  }
})

/* ------------------------------------------------- 3: spacing / slots */

test('ai-field: sane spacing — bounded lat, no shared slots, distinct grid slots', () => {
  const { f, rep } = sharedRace()
  assert(rep.maxLat <= 8.0, `field stayed inside the corridor bounds (max |lat| ${rep.maxLat.toFixed(2)} m)`)
  assert(rep.minSep >= 1.2, `no car-car overlap: min planar separation ${rep.minSep.toFixed(2)} m`)
  assert(rep.stackedFrames === 0, `no car ever shared another car's racing slot (${rep.stackedFrames} stacked frames)`)
  assert(rep.maxSpeed <= VEHICLE.nitroTopSpeed + 0.5, `vehicle/nitro speed caps respected (${rep.maxSpeed.toFixed(1)} <= ${VEHICLE.nitroTopSpeed})`)
  // grid: six pairwise-distinct slots on the asphalt, beyond car width apart
  const g = f.grid
  for (let i = 0; i < g.length; i++) {
    assert(Math.abs(g[i].lat) < 4, `grid slot ${i} sits on the asphalt (lat ${g[i].lat})`)
    for (let j = i + 1; j < g.length; j++) {
      const d = Math.hypot(g[i].s - g[j].s, g[i].lat - g[j].lat)
      assert(d >= 3.0, `grid slots ${i}/${j} are distinct (${d.toFixed(1)} m apart)`)
    }
  }
})

/* ---------------------------------------- 2: corner target + clean run */

test('ai: corner speed follows the curvature target; a solo run never touches a barrier', () => {
  const { spline, probe } = rig()
  const L = spline.length
  const car = new AIVehicle(1, spline, probe)
  car.resetTo(L - RACE.gridFront, 0, 0)
  const ctx: AIContext = { locked: false, leaderProgress: 0, progress: 0 }
  let t = 0, progress = 0, prevS = car.phys.s
  let impacts = 0, worstRatio = 0
  while (t < 200 && progress < L - 10) {
    const p = car.phys
    car.update(SIM_DT, ctx, [])
    let d = p.s - prevS
    if (d > L / 2) d -= L
    else if (d < -L / 2) d += L
    if (d > 0 && d < 20) progress += d
    prevS = p.s
    if (car.events.impact > 0.4) impacts++
    for (const k of [0, 8]) {
      const cv = Math.abs(spline.curvAt(p.s + k))
      if (cv > 0.004) worstRatio = Math.max(worstRatio, p.speed / Math.sqrt(AI.cornerLatAccel / cv))
    }
    t += SIM_DT
  }
  assert(progress >= L - 12, `solo AI completed the circuit (${(progress / L * 100).toFixed(1)}%)`)
  assert(impacts === 0, `clean solo run — no barrier contacts (${impacts})`)
  assert(car.recoveries === 0, `no recovery needed on the clean line (${car.recoveries})`)
  assert(worstRatio <= 1.25, `corner speed stays within 25 % of the curvature target (worst ratio ${worstRatio.toFixed(2)})`)
})

/* ------------------------------------------------------ 4: checkpoints */

test('director: out-of-order checkpoint attempts do not advance progress', () => {
  const f = buildField()
  f.director.start()
  let audited = false
  runRace(f, 60, (t) => {
    if (audited || t < 20) return
    audited = true
    const st = f.director.standingFor(1)
    assert(st !== null && st.checkpoints > 1, `car 1 has legit checkpoints by t=20s (${st?.checkpoints})`)
    const before = st!.checkpoints
    assert(!f.director.tryCheckpoint(1, before + 4), `cp ${before + 4} out-of-order rejected`)
    assert(!f.director.tryCheckpoint(1, before - 1), 'already-held checkpoint rejected')
    assert(!f.director.tryCheckpoint(1, RACE.totalProgressCheckpoints + 9), 'index outside the ladder rejected')
    assert(f.director.standingFor(1)!.checkpoints === before, `out-of-order attempts left the count at ${before}`)
    assert(f.director.tryCheckpoint(1, before), 'the next expected checkpoint validates')
    assert(f.director.standingFor(1)!.checkpoints === before + 1, 'accepting advances exactly one step')
  })
  assert(audited, 'the audit window executed')
})

test('director: a checkpoint-skipping car can never take the flag', () => {
  const f = buildField()
  f.director.start()
  const cheater = f.cars[4] // competitor id 5
  let injected = false
  // the shortcut is the real skip: hop the headland stations ahead of the
  // car's position, never revisited before the line — they must stay unticked
  const CP_SKIPPED = 2
  runRace(f, 130, (t) => {
    if (injected || t < 40) return
    const s = cheater.phys.s
    if (s < 2860 || s > 2892) return
    injected = true
    const st = f.director.standingFor(5)
    assert(st !== null && st.checkpoints >= 20, `cheater carries its legit checkpoints into the hop (${st?.checkpoints})`)
    const { probe } = rig()
    const lane = probe.lanePose(3118, 0)
    cheater.phys.resetAt(lane.x, lane.z, lane.yaw, 24)
  })
  assert(injected, 'the shortcut hop executed')
  const st = f.director.standingFor(5)
  assert(st !== null, 'the cheater is tracked')
  assert(!st!.finished, `a car that skipped a checkpoint never finishes (${st!.checkpoints}/${RACE.totalProgressCheckpoints} cps)`)
  assert(st!.checkpoints <= RACE.totalProgressCheckpoints - CP_SKIPPED, `its ladder stalled short (${st!.checkpoints})`)
  const clean = f.director.standingsFor().filter((r) => r.finished).length
  assert(clean >= RACE.cars - 2, `the rest of the field finished (${clean} classified)`)
})

/* ----------------------------------------------------------- 5: director */

test('director: countdown holds the field, single lap, standings permutation, sim-time timer', () => {
  const f = buildField()
  const before = f.cars.map((c) => ({ x: c.phys.x, z: c.phys.z }))
  const pBefore = { x: f.player.phys.x, z: f.player.phys.z }
  f.director.start()
  for (let i = 0; i < Math.floor((RACE.countdownTime - 0.6) / SIM_DT); i++) {
    f.director.update(SIM_DT)
    const locked = f.director.locked()
    f.player.update(SIM_DT, { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }, locked)
    const ctx: AIContext = { locked, leaderProgress: 0, progress: 0 }
    for (const c of f.cars) c.update(SIM_DT, ctx, f.rivals)
  }
  assert(f.director.locked(), 'countdown still holding inside its window')
  for (let i = 0; i < f.cars.length; i++) {
    assert(f.cars[i].phys.x === before[i].x && f.cars[i].phys.z === before[i].z, `AI ${i} did not move pre-GO`)
    assert(f.cars[i].cmd.throttle === 0 && f.cars[i].cmd.brake === 0 && f.cars[i].cmd.steer === 0, `AI ${i} command path held at rest`)
  }
  assert(f.player.phys.x === pBefore.x && f.player.phys.z === pBefore.z, 'player did not move pre-GO')

  const rep = runRace(f, 240)
  assert(rep.finished, `race completed after the single configured lap (${RACE.laps})`)
  for (const r of rep.standings) {
    assert(r.laps === RACE.laps, `car ${r.id} ran exactly ${RACE.laps} lap (${r.laps})`)
  }
  const ids = rep.standings.map((r) => r.id).sort((a, b) => a - b)
  assert(JSON.stringify(ids) === JSON.stringify([0, 1, 2, 3, 4, 5]), `standings cover every car exactly once (${ids.join(',')})`)
  const positions = rep.standings.map((r) => r.position).sort((a, b) => a - b)
  assert(JSON.stringify(positions) === JSON.stringify([1, 2, 3, 4, 5, 6]), 'positions 1..6 each exactly once')
  for (let i = 1; i < rep.standings.length; i++) {
    assert(rep.standings[i - 1].finishTime <= rep.standings[i].finishTime + 1e-9, 'results frozen in correct finishing order')
  }
  assert(Math.abs(f.director.simTime - f.director.raceSteps * SIM_DT) < 1e-9, `timer is pure simulation time (${f.director.simTime.toFixed(3)} over ${f.director.raceSteps} steps)`)
  for (const r of rep.standings) {
    const k = Math.round(r.finishTime / SIM_DT)
    assert(Math.abs(r.finishTime - k * SIM_DT) < 1e-9, `car ${r.id} finish time is a fixed-step multiple`)
  }
})

/* ----------------------------------------------------------- 6: restart */

test('director: restart from a completed race replays the identical race', () => {
  const f = buildField()
  f.director.start()
  runRace(f, 200)
  assert(f.director.phase === 'finished', 'first race finished')
  const first = JSON.stringify(f.director.results.map((r) => [r.id, r.position, r.finishTime, r.checkpoints, r.progress]))
  gridField(f)
  f.director.restart()
  assert(f.director.results.length === 0 && f.director.simTime === 0, 'restart wipes stale results/timer')
  assert(f.director.locked(), 'restart re-enters the countdown')
  runRace(f, 200)
  const second = JSON.stringify(f.director.results.map((r) => [r.id, r.position, r.finishTime, r.checkpoints, r.progress]))
  assert(first === second, 'the second race is bit-identical to the first from the completed state')
})

/* --------------------------------------------------------- 7: recovery */

test('ai: a deliberately buried car recovers, rejoins the circuit and respects the stuck timeout', () => {
  const { spline, probe } = rig()
  const L = spline.length
  const car = new AIVehicle(2, spline, probe)
  // nose it into the barrier inside a guard window: it grinds, throttles, sticks
  const s0 = 200
  car.resetTo(s0, 4.95, 6)
  const c = probe.lanePose(s0, 4.95)
  car.phys.resetAt(c.x, c.z, c.yaw - 1.5, 6) // misaligned heading, into the wall
  const ctx: AIContext = { locked: false, leaderProgress: 0, progress: 0 }
  let t = 0, progress = 0, prevS = car.phys.s
  let firstRecoverAt = -1, stuckAtRecover = 0, sawStuckClock = 0
  let recPrev = 0
  while (t < 220 && progress < L - 12) {
    const p = car.phys
    if (p.speed < AI.stuckSpeed) sawStuckClock = Math.max(sawStuckClock, car.stuckClock)
    car.update(SIM_DT, ctx, [])
    if (car.recoveries > recPrev) {
      if (firstRecoverAt < 0) { firstRecoverAt = t; stuckAtRecover = car.stuckClock }
      recPrev = car.recoveries
    }
    let d = p.s - prevS
    if (d > L / 2) d -= L
    else if (d < -L / 2) d += L
    if (d > 0 && d < 20) progress += d
    prevS = p.s
    t += SIM_DT
  }
  console.log(`  [ai-recover] recoveries=${car.recoveries} firstAt=${firstRecoverAt.toFixed(1)}s stuckAt=${stuckAtRecover.toFixed(2)}s progress=${(progress / L * 100).toFixed(1)}%`)
  assert(car.recoveries >= 1, `stuck condition triggered the lane re-join (${car.recoveries} recoveries)`)
  assert(sawStuckClock >= AI.stuckTime, `the watchdog ran the car at least the configured stuck timeout (${sawStuckClock.toFixed(2)} >= ${AI.stuckTime})`)
  assert(stuckAtRecover >= AI.stuckTime - 1e-6 && stuckAtRecover <= AI.stuckTime + 0.25, `first recovery fires at the timeout (${stuckAtRecover.toFixed(2)} s)`)
  assert(firstRecoverAt > 0, `recovery happened (${firstRecoverAt.toFixed(1)} s)`)
  assert(progress >= L - 14, `the recovered car re-joined and finished the circuit (${(progress / L * 100).toFixed(1)}%)`)
})

/* ------------------------------------------------ 8: deterministic poses */

test('ai: pose snapshots are deterministic from seed/spline state alone', () => {
  const { spline, probe } = rig()
  const driveScript = (slot: number) => {
    const car = new AIVehicle(slot, spline, probe)
    car.resetTo(spline.length - RACE.gridFront - slot * RACE.gridRowGap, (slot % 2 === 0 ? -1 : 1) * RACE.gridLane, 0)
    const ctx: AIContext = { locked: false, leaderProgress: 0.05, progress: 0.02 }
    for (let i = 0; i < 360; i++) car.update(SIM_DT, ctx, [])
    return car.snapshot()
  }
  const a = driveScript(3)
  const b = driveScript(3)
  assert(JSON.stringify(a) === JSON.stringify(b), 'same seed + same fixed script -> bit-identical snapshot')
  assertFinite(a.x + a.y + a.z + a.speed, 'snapshot state finite')
  assert(a.slot === 3 && a.pace !== 0, 'snapshot carries the seeded identity')
  assert(aiSlotSeed(0) === ((SEED ^ Math.imul(1, 0x9e3779b1)) >>> 0), 'per-slot streams root at the master seed')
})

/* ---------- field dormancy before the race (live-launch review fix) -------
 * Game drives the field exclusively through stepAIField + bindAIFieldVisuals,
 * gated by RaceDirector.fieldActive. This drives the same two helpers the
 * live loop calls: before a race is started no brain, physics or visual bind
 * runs at all — the field keeps the deterministic constructor park pose and
 * can never be seen roaming beside the launched player. */
test('ai: field is dormant before the race — no controller steps, field keeps its park pose', () => {
  const { spline, probe } = rig()
  const L = spline.length
  const player = new PlayerVehicle(probe)
  const cars: AIVehicle[] = []
  for (let i = 0; i < AI.count; i++) cars.push(new AIVehicle(i, spline, probe))
  const director = new RaceDirector(
    [{ id: 0, phys: player.phys }, ...cars.map((c, i) => ({ id: i + 1, phys: c.phys }))], L)
  const rivals: RivalView[] = [{ phys: player.phys }, ...cars]
  const ctx: AIContext = { locked: false, leaderProgress: 0, progress: 0 }
  const liveFrame = () => {
    if (director.phase !== 'idle') director.update(SIM_DT)
    ctx.locked = director.locked() || director.phase === 'finished'
    stepAIField(SIM_DT, director, ctx, cars, rivals)
    bindAIFieldVisuals(SIM_DT, director, cars, visuals)
  }
  // minimal CarModel stand-in: the visual bind path the game exercises
  const models = cars.map(() => {
    const g = {
      position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z } },
      rotation: { order: '' as string, x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z } },
    }
    return { g, model: { group: g, wheels: [], setHeadlights: () => {}, setBrake: () => {}, setNitro: () => {} } as unknown as CarModel }
  })
  const visuals = models.map((m) => new VehicleVisual(m.model))
  for (const m of models) m.g.position.set(0, -600, 0) // the Game constructor park
  const snap = (c: AIVehicle) =>
    [c.phys.x, c.phys.y, c.phys.z, c.phys.yaw, c.phys.vx, c.phys.vy, c.phys.vz, c.nitroLevel, c.recoveries].join('|')

  // idle: 4 s of live frames — nothing moves anywhere
  assert(!director.fieldActive(), 'idle: field gate closed')
  const pre = cars.map(snap)
  for (let k = 0; k < Math.round(4 / SIM_DT); k++) liveFrame()
  cars.forEach((c, i) => assert(snap(c) === pre[i], `idle: AI ${i} physics/controller did not advance`))
  for (const m of models) assert(
    m.g.position.x === 0 && m.g.position.y === -600 && m.g.position.z === 0,
    'idle: visual bind did not run — field keeps the deterministic park pose',
  )

  // startRace equivalent: grid everyone, raise the flag — countdown holds still,
  // but now the live bind runs and the field renders the deterministic grid slots
  for (let i = 0; i < cars.length; i++) { const g = gridSlot(i + 1, L); cars[i].resetTo(g.s, g.lat) }
  director.start()
  assert(director.phase === 'countdown' && director.fieldActive(), 'countdown: gate opens with the flag')
  const gpre = cars.map(snap)
  for (let k = 0; k < Math.ceil((RACE.countdownTime - 0.2) / SIM_DT); k++) liveFrame()
  assert(director.phase === 'countdown', 'countdown: field still held while the lights are up')
  cars.forEach((c, i) => assert(snap(c) === gpre[i], `countdown: AI ${i} held at rest on its grid slot`))
  for (let i = 0; i < cars.length; i++) assert(
    models[i].g.position.x === cars[i].phys.x && models[i].g.position.z === cars[i].phys.z,
    `countdown: AI ${i} renders its grid slot, not the park pose`,
  )

  // racing: the gate was never the brake — the field drives and the field follows
  for (let k = 0; k < Math.ceil(0.4 / SIM_DT); k++) liveFrame()
  assert(director.phase === 'racing', 'countdown elapsed -> racing')
  for (let k = 0; k < 120; k++) liveFrame()
  let moved = 0
  cars.forEach((c, i) => {
    if (snap(c) !== gpre[i]) moved++
    assert(models[i].g.position.x === c.phys.x && models[i].g.position.y === c.phys.y && models[i].g.position.z === c.phys.z,
      `racing: AI ${i} visual follows physics`)
  })
  assert(moved === cars.length, 'racing: every AI brain is live (physics advanced)')
})
