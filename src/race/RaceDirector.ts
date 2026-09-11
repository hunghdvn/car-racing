import type { EventConfig, EventType, GamePhase } from '../types';

export const RACE_COUNTDOWN = 3;
export const RACE_DEFAULT_LAPS = 3;
export const RACE_DEFAULT_LENGTH = 1000;

export type EventLike = EventConfig | { type: EventType };

export interface RaceDirectorConfig {
  laps?: number;
  event?: EventLike | null;
  countdown?: number;
}

export interface RaceParticipant {
  id: string;
  distance: number;
}

export interface RaceTrackProbe {
  length: number;
  checkpointDistances?: number[];
}

export interface VehicleProgress {
  id: string;
  progress: number;
  finished: boolean;
  finishTime?: number;
}

export interface RacedVehicle extends VehicleProgress {
  lap: number;
  lastDistance: number;
  nextCheckpoint: number;
}

export interface VehicleRank {
  id: string;
  position: number;
  progress: number;
  finished: boolean;
  finishTime?: number;
}

export type RaceNotification =
  | { type: 'phase'; phase: GamePhase }
  | { type: 'lap'; id: string; lap: number }
  | { type: 'finish'; id: string; position: number; time: number };

export interface RaceUpdate {
  phase: GamePhase;
  time: number;
  countdownRemaining: number;
  notifications: RaceNotification[];
  standings: VehicleRank[];
}

function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}

export class RaceDirector {
  phase: GamePhase = 'menu';
  time = 0;
  countdown: number;
  requiredLaps: number;

  private configLaps?: number;
  private configEvent: EventLike | null;
  private event: EventLike | null;
  private countdownLength: number;
  private trackLength: number;
  private checkpoints: number[];
  private vehicles = new Map<string, RacedVehicle>();

  constructor(config: RaceDirectorConfig = {}) {
    this.configLaps = config.laps;
    this.configEvent = config.event ?? null;
    this.event = this.configEvent;
    this.countdownLength = config.countdown ?? RACE_COUNTDOWN;
    this.countdown = this.countdownLength;
    this.requiredLaps = RaceDirector.resolveLaps(this.event, this.configLaps);
    this.trackLength = RACE_DEFAULT_LENGTH;
    this.checkpoints = [];
  }

  start(participants: RaceParticipant[], track: RaceTrackProbe | null, event: EventLike | null): void {
    this.trackLength = track?.length ?? RACE_DEFAULT_LENGTH;
    this.checkpoints = [...(track?.checkpointDistances ?? [])].sort((a, b) => a - b);
    this.event = event ?? this.configEvent;
    this.requiredLaps = RaceDirector.resolveLaps(this.event, this.configLaps);
    this.vehicles = new Map();
    for (const participant of participants) {
      this.register(participant);
    }
    this.phase = 'countdown';
    this.time = 0;
    this.countdown = this.countdownLength;
  }

  update(delta: number, participants: RaceParticipant[]): RaceUpdate {
    const d = Math.max(0, delta);
    const notifications: RaceNotification[] = [];
    let racingDelta = 0;

    if (this.phase === 'countdown') {
      const next = this.countdown - d;
      if (next <= 0) {
        this.countdown = 0;
        this.phase = 'racing';
        notifications.push({ type: 'phase', phase: 'racing' });
        racingDelta = -next;
      } else {
        this.countdown = next;
      }
    } else if (this.phase === 'racing') {
      racingDelta = d;
    }

    if (racingDelta > 0) {
      this.time += racingDelta;
      for (const participant of participants) {
        this.advance(participant, notifications);
      }
      const vehicles = [...this.vehicles.values()];
      if (vehicles.length > 0 && vehicles.every((vehicle) => vehicle.finished)) {
        this.phase = 'results';
        notifications.push({ type: 'phase', phase: 'results' });
      }
    }

    return {
      phase: this.phase,
      time: this.time,
      countdownRemaining: this.phase === 'countdown' ? this.countdown : 0,
      notifications,
      standings: this.rankVehicles([...this.vehicles.values()]),
    };
  }

  finish(vehicleId: string): void {
    const vehicle = this.vehicles.get(vehicleId);
    if (vehicle && !vehicle.finished) {
      vehicle.finished = true;
      vehicle.finishTime = this.time;
    }
  }

  rankVehicles(vehicles: VehicleProgress[]): [VehicleRank, ...VehicleRank[]] {
    const sorted = [...vehicles].sort((a, b) => {
      if (a.finished !== b.finished) {
        return a.finished ? -1 : 1;
      }
      if (a.finished && b.finished) {
        return (a.finishTime ?? 0) - (b.finishTime ?? 0);
      }
      return b.progress - a.progress;
    });
    return sorted.map((vehicle, index) => ({
      id: vehicle.id,
      position: index + 1,
      progress: vehicle.progress,
      finished: vehicle.finished,
      finishTime: vehicle.finishTime,
    })) as [VehicleRank, ...VehicleRank[]];
  }

  private register(participant: RaceParticipant): void {
    const distance = wrap(participant.distance, this.trackLength);
    this.vehicles.set(participant.id, {
      id: participant.id,
      lap: 0,
      progress: distance / this.trackLength,
      finished: false,
      lastDistance: distance,
      nextCheckpoint: 0,
    });
  }

  private advance(participant: RaceParticipant, notifications: RaceNotification[]): void {
    let vehicle = this.vehicles.get(participant.id);
    if (!vehicle) {
      this.register(participant);
      return;
    }
    if (vehicle.finished) {
      return;
    }

    const length = this.trackLength;
    const distance = wrap(participant.distance, length);
    const raw = distance - vehicle.lastDistance;
    let crossing: 'forward' | 'backward' | null = null;
    if (raw < -length / 2) {
      crossing = 'forward';
    } else if (raw > length / 2) {
      crossing = 'backward';
    }

    if (crossing === 'forward') {
      this.passCheckpoints(vehicle, vehicle.lastDistance, distance, true);
      if (vehicle.nextCheckpoint >= this.checkpoints.length) {
        vehicle.lap += 1;
        notifications.push({ type: 'lap', id: participant.id, lap: vehicle.lap });
        if (vehicle.lap >= this.requiredLaps) {
          vehicle.finished = true;
          vehicle.finishTime = this.time;
          const position =
            [...this.vehicles.values()].filter(
              (other) => other.finished && (other.finishTime ?? 0) < (vehicle.finishTime ?? 0),
            ).length + 1;
          notifications.push({
            type: 'finish',
            id: participant.id,
            position,
            time: vehicle.finishTime,
          });
        }
      }
      vehicle.nextCheckpoint = 0;
    } else if (crossing === null && raw > 0) {
      this.passCheckpoints(vehicle, vehicle.lastDistance, distance, false);
    }

    vehicle.lastDistance = distance;
    vehicle.progress = vehicle.lap + distance / length;
  }

  private passCheckpoints(vehicle: RacedVehicle, from: number, to: number, wrapped: boolean): void {
    while (vehicle.nextCheckpoint < this.checkpoints.length) {
      const checkpoint = this.checkpoints[vehicle.nextCheckpoint]!;
      const crossed = wrapped
        ? checkpoint > from || checkpoint <= to
        : checkpoint > from && checkpoint <= to;
      if (!crossed) {
        break;
      }
      vehicle.nextCheckpoint += 1;
    }
  }

  private static resolveLaps(event: EventLike | null, fallback: number | undefined): number {
    if (event && 'requiredLaps' in event && event.requiredLaps > 0) {
      return event.requiredLaps;
    }
    return fallback ?? RACE_DEFAULT_LAPS;
  }
}
