import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { aiProfiles } from '../config/ai';
import { tracks } from '../config/tracks';
import { applyUpgrades, cosmeticValues, upgradeDefinitions, vehicleById, vehicles } from '../config/vehicles';
import { CareerService } from '../progression/CareerService';
import { SaveService } from '../progression/SaveService';
import { EventRunner, type EventState } from '../race/EventRunner';
import { RaceDirector, type RaceParticipant, type RaceUpdate, type VehicleRank } from '../race/RaceDirector';
import { CameraRig } from '../rendering/CameraRig';
import { EffectsSystem } from '../rendering/EffectsSystem';
import { Renderer, canvasViewport } from '../rendering/Renderer';
import type { TrackMeshes } from '../rendering/TrackMesh';
import { VehicleView } from '../rendering/VehicleView';
import { WeatherSystem } from '../rendering/WeatherSystem';
import { WorldBuilder, type WorldGroup } from '../rendering/WorldBuilder';
import { createAIControl, type AIProfile, type RivalProbe } from '../simulation/AIController';
import {
  createCollisionState,
  resolveCollisions,
  type CollisionReport,
  type CollisionState,
} from '../simulation/CollisionSystem';
import { createPlayerController, type PlayerController } from '../simulation/PlayerController';
import { integrateVehicle, type ControlInput, type VehicleState } from '../simulation/Vehicle';
import { TrackModel } from '../track/TrackModel';
import { formatTime, type HudSnapshot, type UiActions, type UiController } from '../ui/UiController';
import {
  CAMERA_MODES,
  type CameraMode,
  type ControlMode,
  type EnvironmentVariant,
  type EventConfig,
  type EventInstance,
  type GamePhase,
  type GameSettings,
  type QualityPreset,
  type QualitySettings,
  type SaveData,
  type TrackConfig,
  type Vec3,
  type VehicleConfig,
} from '../types';
import { defaultCapabilities, QualityManager } from '../quality/QualityManager';

export const SIM_HZ = 120;

const SIM_STEP_MS = 1000 / SIM_HZ;
const QUALITY_FRAME_CLAMP_MS = 100;
export const FRAME_DELTA_CLAMP_MS = 100;
const MAX_STEPS_PER_TICK = 600;
const CAR_RADIUS = 1.05;
const PLAYER_ID = 'player';
const PLAYER_COLOR = 0x00e5ff;
const RIM_COLOR = 0x8b98a9;
const AI_COLORS = [0xff2e88, 0xffd166, 0x9d4edd, 0x3dffa0, 0xff7847];
const DRIFT_MIN_SPEED = 6;

const UPGRADE_FAILURE_MESSAGES: Record<string, string> = {
  'unknown-vehicle': 'Unknown vehicle',
  'vehicle-not-owned': 'Vehicle not owned',
  'unknown-slot': 'Unknown upgrade',
  'max-level': 'Upgrade already at max level',
  'insufficient-currency': 'Not enough credits',
};

const COSMETIC_FAILURE_MESSAGES: Record<string, string> = {
  'unknown-vehicle': 'Unknown vehicle',
  'vehicle-not-owned': 'Vehicle not owned',
  'unknown-cosmetic': 'Unknown cosmetic',
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function clampFrameDelta(deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
  return Math.min(deltaMs, FRAME_DELTA_CLAMP_MS);
}

function quickRaceEvent(track: TrackConfig): EventConfig {
  return {
    id: `quick-${track.id}`,
    type: 'race',
    trackId: track.id,
    requiredLaps: track.lapCount,
    targetTime: 0,
    targetScore: 0,
    reward: { currency: 0, xp: 0 },
  };
}

export interface GameDependencies {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  readonly ui: UiController;
  readonly audio: AudioEngine;
  readonly save: SaveService;
}

export interface Game {
  readonly phase: GamePhase;
  startQuickRace(trackId: string, vehicleId: string): void;
  startCareerEvent(cupId: string, eventId: string): void;
  pause(): void;
  resume(): void;
  restart(): void;
  backToMenu(): void;
  tick(deltaMs: number): void;
  dispose(): void;
}

interface RaceSession {
  trackId: string;
  vehicleId: string;
  track: TrackConfig;
  model: TrackModel;
  variant: EnvironmentVariant;
  director: RaceDirector;
  collision: CollisionState;
  event: EventInstance | null;
  eventConfig: EventConfig | null;
  careerEventId: string | null;
  vehicles: Map<string, VehicleState>;
  configs: Map<string, VehicleConfig>;
  profiles: Map<string, AIProfile>;
  hints: Map<string, number>;
  initialNitro: Map<string, number>;
  maxSpeed: Map<string, number>;
  objective: string;
}

interface BeginRaceParams {
  trackId: string;
  vehicleId: string;
  event: EventInstance | null;
  eventConfig: EventConfig | null;
  careerEventId: string | null;
}

class GameImpl {
  private readonly saveService: SaveService;
  private readonly career: CareerService;
  private readonly playerController: PlayerController;
  private saveData: SaveData;
  private phaseInternal: GamePhase = 'menu';
  private paused = false;
  private disposed = false;

  private race: RaceSession | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: Renderer | null = null;
  private ui: UiController | null = null;
  private audio: AudioEngine | null = null;
  private rig: CameraRig | null = null;
  private worldBuilder: WorldBuilder | null = null;
  private world: WorldGroup | null = null;
  private trackMeshes: TrackMeshes | null = null;
  private weather: WeatherSystem | null = null;
  private effects: EffectsSystem | null = null;
  private quality: QualityManager | null = null;
  private views = new Map<string, VehicleView>();
  private keys: Record<string, boolean> = {};
  private accumulator = 0;
  private simTimeMs = 0;
  private lastCountdown: number | null = null;
  private lastInputs = new Map<string, ControlInput>();
  private lastStandings: VehicleRank[] = [];
  private worldPropDensity = 1;
  private rafId: number | null = null;
  private lastFrameMs: number | null = null;

  constructor(deps: GameDependencies | null) {
    const saveService =
      deps?.save ??
      new SaveService(globalThis.localStorage, (context, error) => {
        console.warn(`[neon-rush] save ${context} failed`, error);
      });
    this.saveService = saveService;
    this.career = new CareerService({
      load: () => saveService.load(),
      save: (data: SaveData) => saveService.save(data),
    });
    this.saveData = saveService.load();
    this.playerController = createPlayerController(this.saveData.settings.controlMode);
    if (!deps) return;
    this.canvas = deps.canvas;
    this.renderer = deps.renderer;
    this.ui = deps.ui;
    this.audio = deps.audio;
    this.rig = new CameraRig();
    this.worldBuilder = new WorldBuilder();
    this.quality = new QualityManager(
      this.saveData.settings.quality.preset,
      defaultCapabilities(),
      (settings) => this.applyQuality(settings),
    );
    this.effects = new EffectsSystem(this.renderer.scene, this.quality.settings);
    this.rig.setMode(this.saveData.settings.cameraMode);
    this.audio.setVolume(this.saveData.settings.audioVolume);
    this.audio.setMuted(this.saveData.settings.muted);
    this.audio.setMusicPhase('menu');
    this.ui.setSaveData(this.saveData);
    this.ui.showScreen('menu');
    this.ui.bindActions(this.createActions());
    this.ui.bindCareer(this.career);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('deviceorientation', this.handleOrientation);
    window.addEventListener('pointerdown', this.wakeAudio, { once: true });
    window.addEventListener('keydown', this.wakeAudio, { once: true });
    this.handleResize();
    this.rafId = requestAnimationFrame(this.frameLoop);
  }

  get phase(): GamePhase {
    return this.phaseInternal;
  }

  startQuickRace(trackId: string, vehicleId: string): void {
    if (this.disposed) return;
    if (this.phaseInternal !== 'menu' && this.phaseInternal !== 'results') return;
    const requested = vehicleId || this.saveData.selectedVehicle;
    const vehicle = this.saveData.ownedVehicles.includes(requested) ? requested : this.saveData.selectedVehicle;
    this.beginRace({
      trackId,
      vehicleId: vehicle,
      event: null,
      eventConfig: null,
      careerEventId: null,
    });
  }

  startCareerEvent(cupId: string, eventId: string): void {
    if (this.disposed) return;
    if (this.phaseInternal !== 'menu' && this.phaseInternal !== 'results') return;
    const outcome = this.career.startEvent(cupId, eventId);
    if (!outcome.ok || !outcome.event) {
      this.ui?.showToast(outcome.reason === 'event-locked' ? 'Event is locked' : 'Unknown event');
      return;
    }
    this.saveData = outcome.save ?? this.saveData;
    const instance = this.career.eventVariant(outcome.event, this.saveData);
    this.beginRace({
      trackId: outcome.event.trackId,
      vehicleId: this.saveData.selectedVehicle,
      event: instance,
      eventConfig: outcome.event,
      careerEventId: eventId,
    });
  }

  pause(): void {
    if (this.disposed || this.paused) return;
    const director = this.race?.director;
    if (!director || (director.phase !== 'countdown' && director.phase !== 'racing')) return;
    this.paused = true;
    this.phaseInternal = 'paused';
    this.ui?.showScreen('paused');
    this.audio?.setMusicPhase('paused');
    this.audio?.setEngineState(0, 0, 0);
  }

  resume(): void {
    if (this.disposed || !this.paused || this.phaseInternal !== 'paused') return;
    this.paused = false;
    this.phaseInternal = this.race?.director.phase ?? 'menu';
    this.ui?.showScreen(this.phaseInternal);
    this.audio?.setMusicPhase(this.phaseInternal);
  }

  restart(): void {
    if (this.disposed) return;
    const race = this.race;
    if (!race) return;
    const event = race.eventConfig ? this.career.eventVariant(race.eventConfig, this.saveData) : null;
    this.beginRace({
      trackId: race.trackId,
      vehicleId: race.vehicleId,
      event,
      eventConfig: race.eventConfig,
      careerEventId: race.careerEventId,
    });
  }

  backToMenu(): void {
    if (this.disposed) return;
    this.disposeRaceVisuals();
    this.race = null;
    this.paused = false;
    this.accumulator = 0;
    this.simTimeMs = 0;
    this.lastCountdown = null;
    this.lastStandings = [];
    this.playerController.reset();
    this.phaseInternal = 'menu';
    this.ui?.showScreen('menu');
    this.audio?.setMusicPhase('menu');
  }

  tick(deltaMs: number): void {
    if (this.disposed) return;
    const delta = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
    this.quality?.recordFrame(Math.min(delta, QUALITY_FRAME_CLAMP_MS));
    if (delta > 0 && !this.paused) {
      this.accumulator += delta;
      let steps = 0;
      while (this.accumulator >= SIM_STEP_MS && steps < MAX_STEPS_PER_TICK) {
        this.accumulator -= SIM_STEP_MS;
        this.stepSimulation(1 / SIM_HZ);
        steps += 1;
      }
    }
    this.renderFrame(delta / 1000);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('deviceorientation', this.handleOrientation);
    window.removeEventListener('pointerdown', this.wakeAudio);
    window.removeEventListener('keydown', this.wakeAudio);
    this.disposeRaceVisuals();
    this.effects?.dispose();
    this.effects = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.rig = null;
    this.quality = null;
    this.audio?.dispose();
    this.audio = null;
    this.ui?.destroy();
    this.ui = null;
    this.race = null;
  }

  private createActions(): UiActions {
    return {
      startQuickRace: (trackId) => this.startQuickRace(trackId, this.saveData.selectedVehicle),
      startCareer: () => undefined,
      resume: () => this.resume(),
      restart: () => this.restart(),
      backToMenu: () => this.backToMenu(),
      pause: () => this.pause(),
      changeCamera: () => this.cycleCamera(),
      setQuality: (preset) => this.setQualityPreset(preset),
      setCameraMode: (mode) => this.setCameraMode(mode),
      setControlMode: (mode) => this.setControlMode(mode),
      setAudioVolume: (volume) => this.setAudioVolume(volume),
      setMuted: (muted) => this.setMuted(muted),
      startCareerEvent: (cupId, eventId) => this.startCareerEvent(cupId, eventId),
      selectVehicle: (vehicleId) => this.selectVehicle(vehicleId),
      purchaseUpgrade: (vehicleId, slot) => this.purchaseUpgrade(vehicleId, slot),
      equipCosmetic: (vehicleId, cosmeticId) => this.equipCosmetic(vehicleId, cosmeticId),
    };
  }

  private readonly frameLoop = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frameLoop);
    const raw = this.lastFrameMs === null ? 0 : now - this.lastFrameMs;
    this.lastFrameMs = now;
    this.tick(clampFrameDelta(raw));
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.keys[event.code] = true;
    this.playerController.setInput({ keys: this.keys });
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys[event.code] = false;
    this.playerController.setInput({ keys: this.keys });
  };

  private readonly handleResize = (): void => {
    const viewport = this.canvas ? canvasViewport(this.canvas) : null;
    if (!viewport || !this.renderer || !this.rig) return;
    this.renderer.resize(viewport.width, viewport.height);
    this.rig.resize(viewport.width, viewport.height);
  };

  private readonly handleOrientation = (event: DeviceOrientationEvent): void => {
    this.playerController.setInput({ beta: event.beta ?? 0, gamma: event.gamma ?? 0 });
  };

  private readonly wakeAudio = (): void => {
    const audio = this.audio;
    if (!audio) return;
    audio.start();
    audio.setMusicPhase(this.phaseInternal);
  };

  private beginRace(params: BeginRaceParams): void {
    this.disposeRaceVisuals();
    const track = tracks.find((candidate) => candidate.id === params.trackId) ?? tracks[0]!;
    const base = vehicleById(params.vehicleId) ?? vehicles[0]!;
    const config = applyUpgrades(base, this.saveData.upgradeLevels);
    const variant = params.event
      ? params.event.variant
      : track.variants[0] ?? { nightFactor: 0, weather: 'clear' };
    const model = new TrackModel(track);
    const director = new RaceDirector({
      laps: params.eventConfig?.requiredLaps ?? track.lapCount,
      event: params.event ?? null,
    });
    const vehicleStates = new Map<string, VehicleState>();
    const configs = new Map<string, VehicleConfig>();
    const profiles = new Map<string, AIProfile>();
    const hints = new Map<string, number>();
    const initialNitro = new Map<string, number>();
    const maxSpeed = new Map<string, number>();
    const width = track.width;
    const cells: Array<{ distance: number; lateral: number }> = [
      { distance: 0, lateral: -width * 0.22 },
    ];
    aiProfiles.forEach((_profile, index) => {
      cells.push({
        distance: -(7 + index * 8),
        lateral: index % 2 === 0 ? width * 0.22 : -width * 0.22,
      });
    });
    let index = 0;
    for (const cell of cells) {
      const id = index === 0 ? PLAYER_ID : `ai-${index - 1}`;
      const sample = model.sampleAt(cell.distance);
      const position: Vec3 = {
        x: sample.point.x + sample.left.x * cell.lateral,
        y: sample.point.y,
        z: sample.point.z + sample.left.z * cell.lateral,
      };
      vehicleStates.set(id, {
        position,
        heading: Math.atan2(sample.tangent.x, sample.tangent.z),
        velocity: { x: 0, y: 0, z: 0 },
        speed: 0,
        nitro: config.nitroCapacity,
        driftScore: 0,
        offroad: false,
        finished: false,
      });
      configs.set(id, config);
      initialNitro.set(id, config.nitroCapacity);
      maxSpeed.set(id, 0);
      if (index > 0) profiles.set(id, aiProfiles[index - 1]!);
      index += 1;
    }
    const participants: RaceParticipant[] = [];
    for (const [id, state] of vehicleStates) {
      const distance = model.project(state.position).distance;
      hints.set(id, distance);
      participants.push({ id, distance });
    }
    director.start(
      participants,
      { length: model.length, checkpointDistances: track.checkpointDistances },
      params.event ?? null,
    );
    this.race = {
      trackId: track.id,
      vehicleId: base.id,
      track,
      model,
      variant,
      director,
      collision: createCollisionState(),
      event: params.event,
      eventConfig: params.eventConfig,
      careerEventId: params.careerEventId,
      vehicles: vehicleStates,
      configs,
      profiles,
      hints,
      initialNitro,
      maxSpeed,
      objective: this.objectiveFor(params.event),
    };
    this.lastInputs = new Map();
    this.lastStandings = director.update(0, participants).standings;
    this.accumulator = 0;
    this.simTimeMs = 0;
    this.lastCountdown = null;
    this.paused = false;
    this.phaseInternal = director.phase;
    this.playerController.reset();
    this.ui?.showScreen(this.phaseInternal);
    this.audio?.setMusicPhase(this.phaseInternal);
    this.buildRaceVisuals();
    this.ui?.updateHud(this.buildHudSnapshot());
  }

  private buildRaceVisuals(snapCamera = true): void {
    const race = this.race;
    if (!race || !this.renderer || !this.rig || !this.quality || !this.worldBuilder) return;
    const quality = this.quality.settings;
    const world = this.worldBuilder.build(race.track.environment, race.model, race.variant, quality);
    this.world = world;
    this.worldPropDensity = quality.propDensity;
    this.renderer.scene.add(world);
    const meshes = race.model.createMeshes();
    this.trackMeshes = meshes;
    this.renderer.scene.add(meshes.group);
    const bounds = new THREE.Box3(
      new THREE.Vector3(race.track.minimapBounds.minX, 0, race.track.minimapBounds.minY),
      new THREE.Vector3(race.track.minimapBounds.maxX, 34, race.track.minimapBounds.maxY),
    );
    this.weather = new WeatherSystem(this.renderer.scene, this.renderer.lights, quality, bounds);
    this.weather.setVariant(race.variant);
    this.views = new Map();
    for (const [id, state] of race.vehicles) {
      const color =
        id === PLAYER_ID ? PLAYER_COLOR : AI_COLORS[Number(id.slice(3)) % AI_COLORS.length] ?? PLAYER_COLOR;
      const view = new VehicleView(color, RIM_COLOR);
      if (id === PLAYER_ID) {
        const cosmeticId = this.saveData.cosmetics[race.vehicleId];
        const cosmetic = cosmeticId ? cosmeticValues[cosmeticId] : undefined;
        if (cosmetic) view.setCosmetic(cosmetic.body ?? color, cosmetic.rim ?? RIM_COLOR);
      }
      view.group.position.set(state.position.x, state.position.y, state.position.z);
      view.group.rotation.y = state.heading;
      this.renderer.scene.add(view.group);
      this.views.set(id, view);
    }
    this.rig.setMode(this.saveData.settings.cameraMode);
    if (snapCamera) {
      const player = race.vehicles.get(PLAYER_ID)!;
      this.rig.snap({ position: player.position, heading: player.heading, speed: 0 });
    }
  }

  private disposeRaceVisuals(): void {
    const scene = this.renderer?.scene;
    if (scene) {
      if (this.world) {
        scene.remove(this.world);
        this.world.dispose();
        this.world = null;
      }
      if (this.trackMeshes) {
        scene.remove(this.trackMeshes.group);
        this.trackMeshes.dispose();
        this.trackMeshes = null;
      }
      if (this.weather) {
        this.weather.dispose();
        this.weather = null;
      }
    }
    for (const view of this.views.values()) {
      view.group.parent?.remove(view.group);
      view.dispose();
    }
    this.views.clear();
  }

  private applyQuality(settings: QualitySettings): void {
    this.renderer?.setQuality(settings);
    this.weather?.setQuality(settings);
    this.effects?.setQuality(settings);
    if (this.race && this.world && settings.propDensity !== this.worldPropDensity) {
      this.disposeRaceVisuals();
      this.buildRaceVisuals(false);
    }
  }

  private setQualityPreset(preset: QualityPreset): void {
    if (this.disposed) return;
    this.updateSettings((settings) => {
      settings.quality.preset = preset;
    });
    this.quality?.applyPreset(preset, defaultCapabilities());
  }

  private setCameraMode(mode: CameraMode): void {
    if (this.disposed) return;
    this.updateSettings((settings) => {
      settings.cameraMode = mode;
    });
    this.rig?.setMode(mode);
  }

  private cycleCamera(): void {
    if (this.disposed) return;
    const current = this.saveData.settings.cameraMode;
    const next = CAMERA_MODES[(CAMERA_MODES.indexOf(current) + 1) % CAMERA_MODES.length]!;
    this.setCameraMode(next);
  }

  private setControlMode(mode: ControlMode): void {
    if (this.disposed) return;
    this.updateSettings((settings) => {
      settings.controlMode = mode;
    });
    this.playerController.setMode(mode);
    if (mode === 'tilt') this.playerController.calibrate();
  }

  private setAudioVolume(volume: number): void {
    if (this.disposed) return;
    this.updateSettings((settings) => {
      settings.audioVolume = clamp01(volume);
    });
    this.audio?.setVolume(this.saveData.settings.audioVolume);
  }

  private setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.updateSettings((settings) => {
      settings.muted = muted;
    });
    this.audio?.setMuted(muted);
    if (!muted) this.audio?.setMusicPhase(this.phaseInternal);
  }

  private selectVehicle(vehicleId: string): void {
    if (this.disposed || this.phaseInternal !== 'menu') return;
    if (!this.saveData.ownedVehicles.includes(vehicleId)) return;
    this.saveData = { ...this.saveData, selectedVehicle: vehicleId };
    this.saveService.save(this.saveData);
    this.ui?.setSaveData(this.saveData);
    this.ui?.showToast('Vehicle selected');
  }

  private purchaseUpgrade(vehicleId: string, slot: string): void {
    if (this.disposed || this.phaseInternal !== 'menu') return;
    const outcome = this.career.purchaseUpgrade(vehicleId, slot);
    if (!outcome.ok) {
      this.ui?.showToast(UPGRADE_FAILURE_MESSAGES[outcome.reason ?? 'unknown-vehicle'] ?? 'Upgrade failed');
      return;
    }
    this.saveData = this.saveService.load();
    this.ui?.setSaveData(this.saveData);
    const name = upgradeDefinitions[slot]?.name ?? slot;
    this.ui?.showToast(`${name} upgraded to Lv ${outcome.level}`);
  }

  private equipCosmetic(vehicleId: string, cosmeticId: string): void {
    if (this.disposed || this.phaseInternal !== 'menu') return;
    const outcome = this.career.equipCosmetic(vehicleId, cosmeticId);
    if (!outcome.ok) {
      this.ui?.showToast(COSMETIC_FAILURE_MESSAGES[outcome.reason ?? 'unknown-cosmetic'] ?? 'Cosmetic unavailable');
      return;
    }
    this.saveData = outcome.save ?? this.saveData;
    this.ui?.setSaveData(this.saveData);
    this.ui?.showToast('Cosmetic equipped');
  }

  private updateSettings(mutate: (settings: GameSettings) => void): void {
    const settings: GameSettings = {
      ...this.saveData.settings,
      quality: { ...this.saveData.settings.quality },
    };
    mutate(settings);
    this.saveData = { ...this.saveData, settings };
    this.saveService.save(this.saveData);
    this.ui?.setSettings(settings);
  }

  private objectiveFor(event: EventInstance | EventConfig | null): string {
    if (!event) return '';
    if (event.type === 'timeAttack') return `Target ${formatTime(event.targetTime)}`;
    if (event.type === 'drift') return `Drift score ${Math.round(event.targetScore)}+`;
    if (event.type === 'nitro') return `Score ${Math.round(event.targetScore)}+`;
    return '';
  }

  private samplePlayerInput(): ControlInput {
    const ui = this.ui;
    const mode = this.playerController.mode;
    if (ui && (mode === 'touch' || mode === 'tilt')) {
      this.playerController.setInput(ui.getTouchState());
    }
    return this.playerController.sample(this.simTimeMs);
  }

  private stepSimulation(step: number): void {
    const race = this.race;
    if (!race) {
      this.simTimeMs += step * 1000;
      return;
    }
    const director = race.director;
    const racing = director.phase === 'racing';
    if (racing) {
      const inputs = new Map<string, ControlInput>();
      inputs.set(PLAYER_ID, this.samplePlayerInput());
      for (const [id, profile] of race.profiles) {
        const state = race.vehicles.get(id)!;
        const rivals: RivalProbe[] = [];
        for (const [otherId, other] of race.vehicles.entries()) {
          if (otherId === id) continue;
          rivals.push({ position: other.position, heading: other.heading, speed: other.speed });
        }
        inputs.set(id, createAIControl(state, race.model, rivals, race.track.obstacles, profile, step));
      }
      for (const [id, state] of race.vehicles) {
        const next = integrateVehicle(state, race.configs.get(id)!, inputs.get(id)!, race.model, step);
        race.vehicles.set(id, next);
        race.maxSpeed.set(id, Math.max(race.maxSpeed.get(id) ?? 0, next.speed));
      }
      this.lastInputs = inputs;
      const bodies = [...race.vehicles.entries()].map(([id, state]) => ({
        id,
        position: state.position,
        radius: CAR_RADIUS,
        velocity: state.velocity,
        speed: state.speed,
      }));
      const report = resolveCollisions(bodies, race.track.obstacles, race.collision);
      for (const body of bodies) {
        const state = race.vehicles.get(body.id)!;
        state.speed = Math.hypot(body.velocity.x, body.velocity.z);
      }
      this.handleImpacts(race, report);
    }
    const participants: RaceParticipant[] = [];
    for (const [id, state] of race.vehicles) {
      const hint = racing ? race.hints.get(id) : undefined;
      const distance = racing ? race.model.project(state.position, hint).distance : race.hints.get(id) ?? 0;
      if (racing) race.hints.set(id, distance);
      participants.push({ id, distance });
    }
    const update = director.update(step, participants);
    this.lastStandings = update.standings;
    this.handleDirectorUpdate(update);
    this.simTimeMs += step * 1000;
  }

  private handleImpacts(race: RaceSession, report: CollisionReport): void {
    for (const impact of report.events) {
      if (impact.a !== PLAYER_ID && impact.b !== PLAYER_ID) continue;
      const strength = Math.min(1, impact.magnitude / 18);
      this.audio?.playCollision(strength);
      if (!this.effects) continue;
      const otherId = impact.a === PLAYER_ID ? impact.b : impact.a;
      let position: Vec3 | undefined;
      if (otherId.startsWith('obstacle:')) {
        position = race.track.obstacles[Number(otherId.slice('obstacle:'.length))]?.position;
      } else {
        position = race.vehicles.get(otherId)?.position;
      }
      const player = race.vehicles.get(PLAYER_ID)!;
      this.effects.spawnImpact(position ?? player.position, strength);
      this.rig?.addShake(strength);
    }
  }

  private handleDirectorUpdate(update: RaceUpdate): void {
    if (update.phase === 'countdown') {
      const value = Math.ceil(update.countdownRemaining);
      if (value !== this.lastCountdown) {
        this.lastCountdown = value;
        this.audio?.playCountdown(value);
      }
      return;
    }
    if (update.phase === 'racing') {
      if (this.lastCountdown !== 0) {
        this.lastCountdown = 0;
        this.audio?.playCountdown(0);
      }
      if (this.phaseInternal === 'countdown') {
        this.phaseInternal = 'racing';
        this.ui?.showScreen('racing');
        this.audio?.setMusicPhase('racing');
      }
    }
    for (const notification of update.notifications) {
      if (notification.type === 'finish' && notification.id === PLAYER_ID) {
        this.audio?.playFinish();
        this.finishRace(update);
        return;
      }
      if (notification.type === 'phase' && notification.phase === 'results') {
        this.finishRace(update);
        return;
      }
    }
  }

  private finishRace(update: RaceUpdate): void {
    const race = this.race!;
    this.paused = false;
    race.director.phase = 'results';
    this.phaseInternal = 'results';
    const player = race.vehicles.get(PLAYER_ID)!;
    const config = race.configs.get(PLAYER_ID)!;
    const playerRank = update.standings.find((entry) => entry.id === PLAYER_ID);
    const position = playerRank?.position ?? update.standings.length;
    const finishTime = playerRank?.finished ? (playerRank.finishTime ?? 0) : 0;
    const initialNitro = race.initialNitro.get(PLAYER_ID) ?? 0;
    const eventState: EventState = {
      position,
      finishTime: playerRank?.finished ? finishTime : undefined,
      driftScore: player.driftScore,
      nitroUsed: initialNitro > 0 ? 1 - player.nitro / initialNitro : 0,
      topSpeedRatio: clamp01((race.maxSpeed.get(PLAYER_ID) ?? 0) / config.baseSpeed),
    };
    const event = race.event ?? quickRaceEvent(race.track);
    const result = EventRunner.evaluate(event, eventState);
    if (race.careerEventId && race.eventConfig) {
      const outcome = this.career.completeEvent(race.careerEventId, {
        passed: result.passed,
        score: result.score,
        reward: result.reward,
        bestMetric: result.bestMetric,
        time: finishTime > 0 ? finishTime : undefined,
      });
      this.saveData = outcome.save;
    }
    this.ui?.setSaveData(this.saveData);
    this.ui?.showResults({
      position,
      time: finishTime,
      score: result.score,
      passed: result.passed,
      rewardCurrency: result.reward.currency,
      rewardXp: result.reward.xp,
      unlock: result.reward.unlock,
    });
    this.ui?.showScreen('results');
    this.audio?.setMusicPhase('results');
    this.audio?.setEngineState(0, 0, 0);
  }

  private buildHudSnapshot(): HudSnapshot {
    const race = this.race!;
    const player = race.vehicles.get(PLAYER_ID)!;
    const config = race.configs.get(PLAYER_ID)!;
    const rank = this.lastStandings.find((entry) => entry.id === PLAYER_ID);
    const progress = rank?.progress ?? 0;
    return {
      speed: player.speed * 3.6,
      lap: Math.min(race.director.requiredLaps, Math.max(1, Math.floor(progress) + 1)),
      totalLaps: race.director.requiredLaps,
      position: rank?.position ?? 1,
      vehicleCount: race.vehicles.size,
      time: race.director.time,
      nitro: config.nitroCapacity > 0 ? player.nitro / config.nitroCapacity : 0,
      countdown: race.director.phase === 'countdown' ? Math.ceil(race.director.countdown) : null,
      objective: race.objective,
      driftScore: player.driftScore,
      minimap: {
        points: this.trackMeshes?.minimapPoints ?? [],
        bounds: race.track.minimapBounds,
        player: { x: player.position.x, y: player.position.z },
      },
    };
  }

  private renderFrame(delta: number): void {
    const renderer = this.renderer;
    const rig = this.rig;
    if (!renderer || !rig) return;
    const race = this.race;
    if (race) {
      const player = race.vehicles.get(PLAYER_ID)!;
      const animate = this.phaseInternal === 'racing' || this.phaseInternal === 'countdown';
      if (animate) {
        rig.update({ position: player.position, heading: player.heading, speed: player.speed }, delta);
        this.weather?.update(delta);
        for (const [id, state] of race.vehicles) {
          const view = this.views.get(id);
          if (!view) continue;
          view.group.position.set(state.position.x, state.position.y, state.position.z);
          view.group.rotation.y = state.heading;
          const input = this.lastInputs.get(id);
          const nitroActive = Boolean(input?.nitro && state.nitro > 0 && (input?.throttle ?? 0) > 0);
          view.update(state.speed, input?.steer ?? 0, input?.drift ?? false, nitroActive, delta);
        }
        renderer.updateShadowTarget({
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
        });
        if (this.phaseInternal === 'racing') {
          const input = this.lastInputs.get(PLAYER_ID);
          if (input?.nitro && player.nitro > 0 && (input?.throttle ?? 0) > 0) {
            this.effects?.spawnNitro(player.position);
          }
          if (input?.drift && player.speed > DRIFT_MIN_SPEED) {
            this.effects?.spawnDrift(player.position);
          }
        }
        if (this.audio) {
          const maxSpeed = race.configs.get(PLAYER_ID)!.baseSpeed;
          const input = this.lastInputs.get(PLAYER_ID);
          this.audio.setEngineState(
            clamp01(player.speed / maxSpeed),
            input?.nitro && player.nitro > 0 && (input?.throttle ?? 0) > 0 ? 1 : 0,
            input?.drift && player.speed > DRIFT_MIN_SPEED ? 1 : 0,
          );
        }
      }
      if (this.ui) this.ui.updateHud(this.buildHudSnapshot());
    }
    this.effects?.update(delta);
    if (this.ui && this.effects) this.ui.setCollisionFlash(this.effects.flash);
    renderer.render(renderer.scene, rig.camera, delta);
  }
}

export function createGame(deps: GameDependencies | null): Game {
  return new GameImpl(deps);
}
