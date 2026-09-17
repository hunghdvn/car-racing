import { RACE, TRACK } from '../config'
import { clamp01 } from '../util'
import type { VehiclePhysics } from '../vehicles/VehiclePhysics'

/* ------------------------------------------------------------------------- *
 * The race director (spec §14/§24A): countdown state gate, ordered +
 * monotonic checkpoints (out-of-order passage never counts), per-car laps
 * and unwrapped progress, pass-through standings, the single-lap finish
 * freeze and a clean restart. It owns race state only — cars are driven by
 * their vehicles through the fixed-dt Game accumulator, so the race timer is
 * simulation time, never wall-clock, and a replayed run is bit-identical.
 * ------------------------------------------------------------------------- */

export type RacePhase = 'idle' | 'countdown' | 'racing' | 'finished'

export interface Competitor {
  readonly id: number
  readonly phys: VehiclePhysics
}

export interface GridSlot {
  readonly s: number
  readonly lat: number
}

export interface RaceStanding {
  readonly id: number
  /** 1-based running position (passes update it live) */
  readonly position: number
  readonly laps: number
  /** unwrapped metres covered since GO */
  readonly progress: number
  /** 0..1 of one lap (rubber-band input) */
  readonly fraction: number
  readonly checkpoints: number
  readonly finished: boolean
  /** simulation seconds at the finish (0 while running) */
  readonly finishTime: number
}

/** deterministic staggered grid: pole at the line, 2-car rows back */
export function gridSlot(slot: number, lapLength: number): GridSlot {
  const row = Math.floor(slot / 2)
  return { s: lapLength - RACE.gridFront - row * RACE.gridRowGap, lat: (slot % 2 === 0 ? -1 : 1) * RACE.gridLane }
}

/** a checkpoint only validates inside the racing corridor */
const CP_LAT_LIMIT = TRACK.halfWidth + 3
/** deltas beyond this are teleports (reset/replay), not drive progress */
const MAX_STEP = 20

interface CarState {
  lastS: number
  /** unwrapped station along the race line */
  sU: number
  progress: number
  laps: number
  /** checkpoints passed so far (next expected = this index) */
  cpsPassed: number
  finished: boolean
  finishTime: number
  position: number
}

export class RaceDirector {
  phase: RacePhase = 'idle'
  /** simulation seconds since GO (drives the race timer + results) */
  simTime = 0
  /** number of fixed steps accumulated into simTime (sim-time proof) */
  raceSteps = 0
  /** seconds of lights hold remaining while phase === 'countdown' */
  countdown = 0

  readonly lapLength: number
  /** frozen finish order once phase === 'finished' */
  results: readonly RaceStanding[] = []

  private st: CarState[] = []
  private finishOrder: number[] = []
  private standings: RaceStanding[] = []

  constructor(private cars: readonly Competitor[], lapLength: number) {
    this.lapLength = lapLength
    for (const c of cars) this.st.push(blankState())
    this.reseed()
    this.rebuildStandings()
  }

  /** cars may not drive until GO */
  locked(): boolean { return this.phase === 'countdown' }

  /** begin (or re-begin, for restart) the race from the current car state */
  start(): void {
    this.reseed()
    this.phase = 'countdown'
    this.countdown = RACE.countdownTime
    this.simTime = 0
    this.raceSteps = 0
    this.finishOrder = []
    this.results = []
    this.rebuildStandings()
  }

  /** clean restart from a completed race: full state wipe, no stale rows */
  restart(): void { this.start() }

  /** advance the director one fixed step (Game's SIM_HZ accumulator) */
  update(dt: number): void {
    if (this.phase === 'countdown') {
      this.countdown -= dt
      if (this.countdown <= 0) { this.countdown = 0; this.phase = 'racing' }
      return
    }
    if (this.phase !== 'racing') return
    this.simTime += dt
    this.raceSteps++
    const L = this.lapLength
    const N = RACE.totalProgressCheckpoints

    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]
      const st = this.st[i]
      if (st.finished) continue
      const s = c.phys.s
      let d = s - st.lastS
      if (d > L / 2) d -= L
      else if (d < -L / 2) d += L
      st.lastS = s
      if (d > MAX_STEP || d < -MAX_STEP) {
        // teleport (reset/replay): re-anchor at the true station keeping the
        // completed-lap offset — a skipped station is never retro-validated
        st.sU = s + Math.floor(st.sU / L) * L
        continue
      }
      const sUPrev = st.sU
      st.sU += d
      if (d > 0) st.progress += d

      /* ordered checkpoints: only the next expected station can validate */
      while (st.cpsPassed < N) {
        const cpS = ((st.cpsPassed + 0.5) * L) / N
        const base = Math.floor(sUPrev / L) * L
        const abs = cpS + base
        if (sUPrev <= abs && st.sU > abs) {
          if (this.acceptCheckpoint(i, st.cpsPassed)) st.cpsPassed++
          else break
        } else break
      }

      /* the finish line counts only once every checkpoint is ticked */
      const prevLap = Math.floor(sUPrev / L)
      const curLap = Math.floor(st.sU / L)
      if (curLap > prevLap && st.cpsPassed >= N) {
        st.laps++
        st.cpsPassed = 0
        if (st.laps >= RACE.laps) {
          st.finished = true
          st.finishTime = this.simTime
          this.finishOrder.push(c.id)
        }
      }
    }

    this.rebuildStandings()

    if (this.finishOrder.length === this.cars.length || this.simTime > RACE.timeLimit) {
      this.phase = 'finished'
      this.results = [...this.standings]
    }
  }

  /**
   * Validate a checkpoint pass: the attempt must be for the car's NEXT
   * expected station (out-of-order passage does not count) and the car must
   * be inside the corridor at the crossing.
   */
  tryCheckpoint(carId: number, cpIndex: number): boolean {
    const i = this.cars.findIndex((c) => c.id === carId)
    if (i < 0) return false
    if (!this.acceptCheckpoint(i, cpIndex)) return false
    this.st[i].cpsPassed++
    return true
  }

  private acceptCheckpoint(i: number, cpIndex: number): boolean {
    const st = this.st[i]
    if (this.phase !== 'racing' || st.finished) return false
    if (cpIndex !== st.cpsPassed || cpIndex < 0 || cpIndex >= RACE.totalProgressCheckpoints) return false
    return Math.abs(this.cars[i].phys.lat) <= CP_LAT_LIMIT
  }

  /** live standings, finished first by time then by progress (passes) */
  standingsFor(): readonly RaceStanding[] { return this.standings }

  /** standing row for one car id — LIVE state (rubber-band + HUD input) */
  standingFor(carId: number): RaceStanding | null {
    const i = this.cars.findIndex((c) => c.id === carId)
    if (i < 0) return null
    return this.rowOf(i)
  }

  /** 0..1 completion of the field leader */
  leaderProgress(): number {
    let best = 0
    for (const st of this.st) best = Math.max(best, st.progress)
    return clamp01(best / this.lapLength)
  }

  /** position (1-based) of one car right now */
  positionOf(carId: number): number {
    const st = this.st[this.cars.findIndex((c) => c.id === carId)]
    return st ? st.position : 0
  }

  private reseed(): void {
    for (let i = 0; i < this.cars.length; i++) {
      const s = this.cars[i].phys.s
      this.st[i] = { lastS: s, sU: s, progress: 0, laps: 0, cpsPassed: 0, finished: false, finishTime: 0, position: i + 1 }
    }
  }

  private rowOf(i: number): RaceStanding {
    const st = this.st[i]
    return {
      id: this.cars[i].id,
      position: st.position,
      laps: st.laps,
      progress: st.progress,
      fraction: clamp01(st.progress / this.lapLength),
      checkpoints: st.cpsPassed,
      finished: st.finished,
      finishTime: st.finishTime,
    }
  }

  private rebuildStandings(): void {
    const rows: RaceStanding[] = this.cars.map((_, i) => this.rowOf(i))
    rows.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      if (a.finished) return a.finishTime - b.finishTime
      if (b.checkpoints !== a.checkpoints) return b.checkpoints - a.checkpoints
      if (b.progress !== a.progress) return b.progress - a.progress
      return a.id - b.id
    })
    rows.forEach((r, i) => { this.st[this.cars.findIndex((c) => c.id === r.id)].position = i + 1 })
    this.standings = rows.map((r, i) => ({ ...r, position: i + 1 }))
  }
}

const blankState = (): CarState => ({ lastS: 0, sU: 0, progress: 0, laps: 0, cpsPassed: 0, finished: false, finishTime: 0, position: 0 })
