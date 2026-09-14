import { careerCups, type CareerCup } from '../config/career';
import { tracks } from '../config/tracks';
import { vehicleById, vehicles } from '../config/vehicles';
import { DEFAULT_SETTINGS } from '../progression/SaveService';
import type { TouchInput } from '../simulation/PlayerController';
import {
  CAMERA_MODES,
  CONTROL_MODES,
  QUALITY_PRESETS,
  type CameraMode,
  type ControlMode,
  type EventType,
  type GamePhase,
  type GameSettings,
  type QualityPreset,
  type SaveData,
} from '../types';

export interface UiStateInput {
  phase: GamePhase;
  controlMode: ControlMode;
}

export interface UiState {
  showTouchControls: boolean;
  showHud: boolean;
}

export interface UiActions {
  startQuickRace(trackId: string): void;
  startCareer(): void;
  resume(): void;
  restart(): void;
  backToMenu(): void;
  pause(): void;
  changeCamera(): void;
  setQuality(preset: QualityPreset): void;
  setCameraMode(mode: CameraMode): void;
  setControlMode(mode: ControlMode): void;
  setAudioVolume(volume: number): void;
  setMuted(muted: boolean): void;
  startCareerEvent(cupId: string, eventId: string): void;
  selectVehicle(vehicleId: string): void;
}

export interface HudSnapshot {
  speed: number;
  lap: number;
  totalLaps: number;
  position: number;
  vehicleCount: number;
  time: number;
  nitro: number;
  countdown: number | null;
  objective?: string;
}

export interface ResultsSnapshot {
  position: number;
  time: number;
  score: number;
  passed: boolean;
  rewardCurrency: number;
  rewardXp: number;
  unlock?: string;
}

export type MenuView = 'home' | 'career' | 'garage';

const MENU_VIEWS: MenuView[] = ['home', 'career', 'garage'];

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  race: 'Race',
  timeAttack: 'Time Attack',
  drift: 'Drift Challenge',
  nitro: 'Nitro Challenge',
};

const TOAST_DURATION_MS = 2500;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function reduceUiState(input: UiStateInput): UiState {
  const racing = input.phase === 'racing';
  return {
    showTouchControls: racing && (input.controlMode === 'touch' || input.controlMode === 'tilt'),
    showHud: input.phase === 'countdown' || input.phase === 'racing' || input.phase === 'paused',
  };
}

export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`;
}

export function formatSpeed(kmh: number): string {
  const safe = Number.isFinite(kmh) && kmh > 0 ? kmh : 0;
  return String(Math.round(safe));
}

export function formatPosition(position: number): string {
  const safe = Math.max(1, Math.floor(position));
  const hundred = safe % 100;
  if (hundred >= 11 && hundred <= 13) return `${safe}th`;
  const digit = safe % 10;
  if (digit === 1) return `${safe}st`;
  if (digit === 2) return `${safe}nd`;
  if (digit === 3) return `${safe}rd`;
  return `${safe}th`;
}

export function formatNitro(ratio: number): string {
  return `${Math.round(clamp01(Number.isFinite(ratio) ? ratio : 0) * 100)}%`;
}

export function requestTiltPermission(): Promise<boolean> {
  const deviceOrientationEvent = (globalThis as Record<string, unknown>).DeviceOrientationEvent;
  const request = (deviceOrientationEvent as { requestPermission?: unknown } | undefined)?.requestPermission;
  if (typeof request !== 'function') return Promise.resolve(true);
  return Promise.resolve()
    .then(() => (request as () => Promise<string>).call(deviceOrientationEvent))
    .then((result) => result === 'granted')
    .catch(() => false);
}

function cloneSettings(settings: GameSettings): GameSettings {
  return { ...settings, quality: { ...settings.quality } };
}

function zeroTouch(): TouchInput {
  return { gas: false, brake: false, steerLeft: false, steerRight: false, drift: false, nitro: false };
}

export class UiController {
  private readonly doc: Document;
  private readonly menu: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly settingsScreen: HTMLElement;
  private readonly pauseScreen: HTMLElement;
  private readonly resultsScreen: HTMLElement;
  private readonly touchControls: HTMLElement;
  private readonly toast: HTMLElement;

  private readonly menuViews: Record<MenuView, HTMLElement>;
  private readonly careerList: HTMLElement;
  private readonly garageList: HTMLElement;
  private readonly hudPosition: HTMLElement;
  private readonly hudTotal: HTMLElement;
  private readonly hudLap: HTMLElement;
  private readonly hudTime: HTMLElement;
  private readonly hudSpeed: HTMLElement;
  private readonly hudNitroBar: HTMLElement;
  private readonly hudObjective: HTMLElement;
  private readonly hudCountdown: HTMLElement;
  private qualityGroup!: HTMLElement;
  private cameraGroup!: HTMLElement;
  private controlGroup!: HTMLElement;
  private trackGroup!: HTMLElement;
  private quickTrackId: string = tracks[0]!.id;
  private readonly volumeInput: HTMLInputElement;
  private readonly volumeLabel: HTMLElement;
  private readonly muteInput: HTMLInputElement;
  private readonly resultsTitle: HTMLElement;
  private readonly resultsPosition: HTMLElement;
  private readonly resultsTime: HTMLElement;
  private readonly resultsScore: HTMLElement;
  private readonly resultsReward: HTMLElement;
  private readonly resultsUnlockRow: HTMLElement;
  private readonly resultsUnlock: HTMLElement;
  private readonly toastMessage: HTMLElement;

  private phase: GamePhase = 'menu';
  private settings: GameSettings = cloneSettings(DEFAULT_SETTINGS);
  private actions: UiActions | null = null;
  private settingsOpen = false;
  private save: SaveData | null = null;
  private touch: TouchInput = zeroTouch();
  private readonly touchButtons: HTMLButtonElement[] = [];
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: ParentNode = document) {
    this.doc = (root as Element).ownerDocument ?? (root as Document);
    this.menu = this.container('menu');
    this.hud = this.container('hud');
    this.settingsScreen = this.container('settings');
    this.pauseScreen = this.container('pause');
    this.resultsScreen = this.container('results');
    this.touchControls = this.container('touch-controls');
    this.toast = this.container('toast');

    const home = this.create('div', 'ui-view');
    home.id = 'menu-view-home';
    const careerView = this.create('div', 'ui-view ui-hidden');
    careerView.id = 'menu-view-career';
    const garageView = this.create('div', 'ui-view ui-hidden');
    garageView.id = 'menu-view-garage';
    this.menuViews = { home, career: careerView, garage: garageView };
    this.careerList = this.create('div', 'career-list');
    this.careerList.id = 'career-list';
    this.garageList = this.create('div', 'garage-list');
    this.garageList.id = 'garage-list';
    this.hudPosition = this.create('div', 'hud-value');
    this.hudPosition.id = 'hud-position';
    this.hudTotal = this.create('div', 'hud-total');
    this.hudTotal.id = 'hud-total';
    this.hudLap = this.create('div', 'hud-label');
    this.hudLap.id = 'hud-lap';
    this.hudTime = this.create('div', 'hud-value hud-time');
    this.hudTime.id = 'hud-time';
    this.hudSpeed = this.create('div', 'hud-value');
    this.hudSpeed.id = 'hud-speed';
    this.hudNitroBar = this.create('div', 'hud-nitro-bar');
    this.hudNitroBar.id = 'hud-nitro-bar';
    this.hudObjective = this.create('div', 'hud-objective ui-hidden');
    this.hudObjective.id = 'hud-objective';
    this.hudCountdown = this.create('div', 'hud-countdown ui-hidden');
    this.hudCountdown.id = 'hud-countdown';
    this.volumeInput = this.create('input', 'settings-volume');
    this.volumeInput.id = 'settings-volume';
    this.volumeLabel = this.create('span', 'settings-volume-value');
    this.volumeLabel.id = 'settings-volume-value';
    this.muteInput = this.create('input', 'settings-mute');
    this.muteInput.id = 'settings-mute';
    this.resultsTitle = this.create('h2', 'results-title');
    this.resultsTitle.id = 'results-title';
    this.resultsPosition = this.create('dd');
    this.resultsPosition.id = 'results-position';
    this.resultsTime = this.create('dd');
    this.resultsTime.id = 'results-time';
    this.resultsScore = this.create('dd');
    this.resultsScore.id = 'results-score';
    this.resultsReward = this.create('dd');
    this.resultsReward.id = 'results-reward';
    this.resultsUnlock = this.create('dd');
    this.resultsUnlock.id = 'results-unlock';
    this.resultsUnlockRow = this.create('div', 'result-row ui-hidden');
    this.resultsUnlockRow.id = 'results-unlock-row';
    this.toastMessage = this.create('div', 'toast');
    this.toastMessage.id = 'toast-message';

    this.buildMenu(home, careerView, garageView);
    this.buildHud();
    this.buildSettings();
    this.buildPause();
    this.buildResults();
    this.buildTouchControls();
    this.buildToast();

    this.setSettings(this.settings);
    window.addEventListener('keydown', this.handleKeyDown);
    this.showScreen('menu');
  }

  showScreen(phase: GamePhase): void {
    this.phase = phase;
    const state = reduceUiState({ phase, controlMode: this.settings.controlMode });
    this.menu.classList.toggle('ui-active', phase === 'menu');
    this.hud.classList.toggle('ui-hidden', !state.showHud);
    this.pauseScreen.classList.toggle('ui-active', phase === 'paused');
    this.resultsScreen.classList.toggle('ui-active', phase === 'results');
    this.touchControls.classList.toggle('ui-hidden', !state.showTouchControls);
    if (phase !== 'menu' && this.settingsOpen) this.closeSettings();
    if (phase !== 'countdown' && phase !== 'racing') {
      this.releaseTouchControls();
    }
  }

  private releaseTouchControls(): void {
    Object.assign(this.touch, zeroTouch());
    for (const button of this.touchButtons) {
      button.classList.remove('pressed');
    }
  }

  openSettings(): void {
    this.settingsOpen = true;
    this.settingsScreen.classList.add('ui-active');
  }

  closeSettings(): void {
    this.settingsOpen = false;
    this.settingsScreen.classList.remove('ui-active');
  }

  setMenuView(view: MenuView): void {
    for (const candidate of MENU_VIEWS) {
      this.menuViews[candidate].classList.toggle('ui-hidden', candidate !== view);
    }
  }

  selectQuickRaceTrack(trackId: string): void {
    if (!tracks.some((track) => track.id === trackId)) return;
    this.quickTrackId = trackId;
    this.selectSegment(this.trackGroup, trackId);
  }

  bindActions(actions: UiActions): void {
    this.actions = actions;
  }

  setSettings(settings: GameSettings): void {
    this.settings = cloneSettings(settings);
    this.selectSegment(this.qualityGroup, settings.quality.preset);
    this.selectSegment(this.cameraGroup, settings.cameraMode);
    this.selectSegment(this.controlGroup, settings.controlMode);
    const volume = clamp01(settings.audioVolume);
    this.volumeInput.value = String(volume);
    this.volumeLabel.textContent = `${Math.round(volume * 100)}%`;
    this.muteInput.checked = settings.muted;
  }

  setSaveData(save: SaveData): void {
    this.save = save;
    this.setSettings(save.settings);
    this.renderCareer();
    this.renderGarage();
  }

  updateHud(snapshot: HudSnapshot): void {
    this.hudSpeed.textContent = formatSpeed(snapshot.speed);
    this.hudLap.textContent = `LAP ${Math.max(1, Math.floor(snapshot.lap))}/${Math.max(1, Math.floor(snapshot.totalLaps))}`;
    this.hudPosition.textContent = formatPosition(snapshot.position);
    this.hudTotal.textContent = `/ ${Math.max(0, Math.floor(snapshot.vehicleCount))}`;
    this.hudTime.textContent = formatTime(snapshot.time);
    this.hudNitroBar.style.width = `${Math.round(clamp01(snapshot.nitro) * 100)}%`;
    const objective = snapshot.objective ?? '';
    this.hudObjective.textContent = objective;
    this.hudObjective.classList.toggle('ui-hidden', objective.length === 0);
    if (snapshot.countdown === null) {
      this.hudCountdown.classList.add('ui-hidden');
    } else {
      this.hudCountdown.classList.remove('ui-hidden');
      this.hudCountdown.textContent = String(Math.max(0, Math.floor(snapshot.countdown)));
    }
  }

  showResults(result: ResultsSnapshot): void {
    this.resultsTitle.textContent = result.passed ? 'Event Complete' : 'Race Over';
    this.resultsPosition.textContent = formatPosition(result.position);
    this.resultsTime.textContent = formatTime(result.time);
    this.resultsScore.textContent = String(Math.max(0, Math.floor(result.score)));
    this.resultsReward.textContent = `+${Math.max(0, Math.floor(result.rewardCurrency))} credits · +${Math.max(0, Math.floor(result.rewardXp))} XP`;
    const unlock = result.unlock ? vehicleById(result.unlock) : undefined;
    this.resultsUnlockRow.classList.toggle('ui-hidden', !unlock);
    this.resultsUnlock.textContent = unlock ? unlock.displayName : '';
  }

  showToast(message: string): void {
    this.toastMessage.textContent = message;
    this.toast.classList.add('ui-visible');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.classList.remove('ui-visible');
      this.toastTimer = null;
    }, TOAST_DURATION_MS);
  }

  getTouchState(): TouchInput {
    return { ...this.touch };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
  }

  private container(id: string): HTMLElement {
    const node = this.doc.getElementById(id);
    if (!node) throw new Error(`UI container #${id} is missing`);
    return node;
  }

  private create<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string | null = null,
    text: string | null = null,
  ): HTMLElementTagNameMap[K] {
    const node = this.doc.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = text;
    return node;
  }

  private addButton(parent: HTMLElement, id: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = this.create('button', 'ui-button', label);
    button.id = id;
    button.type = 'button';
    button.addEventListener('click', onClick);
    parent.appendChild(button);
    return button;
  }

  private addSegmentGroup(
    parent: HTMLElement,
    id: string,
    values: readonly string[],
    selected: string,
    onSelect: (value: string) => void,
  ): HTMLElement {
    const group = this.create('div', 'segment-group');
    group.id = id;
    for (const value of values) {
      const button = this.create('button', 'segment', titleCase(value));
      button.type = 'button';
      button.dataset.value = value;
      button.addEventListener('click', () => onSelect(value));
      group.appendChild(button);
    }
    this.selectSegment(group, selected);
    parent.appendChild(group);
    return group;
  }

  private selectSegment(group: HTMLElement, value: string): void {
    for (const child of Array.from(group.children)) {
      const button = child as HTMLButtonElement;
      button.classList.toggle('ui-selected', button.dataset.value === value);
    }
  }

  private addResultRow(parent: HTMLElement, id: string, label: string, target: HTMLElement): void {
    const row = this.create('div', 'result-row');
    row.id = id;
    const term = this.create('dt', null, label);
    row.appendChild(term);
    row.appendChild(target);
    parent.appendChild(row);
  }

  private buildMenu(home: HTMLElement, careerView: HTMLElement, garageView: HTMLElement): void {
    const panel = this.create('div', 'ui-panel menu-panel');
    panel.id = 'menu-panel';
    panel.appendChild(this.create('h1', 'ui-title', 'NEON RUSH 3D'));

    this.addButton(home, 'menu-quick-race', 'Quick Race', () => this.actions?.startQuickRace(this.quickTrackId));
    const trackGroup = this.create('fieldset', 'ui-group');
    trackGroup.id = 'menu-track-group';
    trackGroup.appendChild(this.create('legend', null, 'Track'));
    for (const track of tracks) {
      const button = this.create('button', 'segment', track.displayName);
      button.type = 'button';
      button.id = `menu-track-${track.id}`;
      button.dataset.value = track.id;
      button.addEventListener('click', () => this.selectQuickRaceTrack(track.id));
      trackGroup.appendChild(button);
    }
    this.trackGroup = trackGroup;
    this.selectSegment(trackGroup, this.quickTrackId);
    home.appendChild(trackGroup);
    this.addButton(home, 'menu-career', 'Career', () => {
      this.setMenuView('career');
      this.actions?.startCareer();
    });
    this.addButton(home, 'menu-garage', 'Garage', () => this.setMenuView('garage'));
    this.addButton(home, 'menu-settings', 'Settings', () => this.openSettings());
    panel.appendChild(home);

    const careerHeader = this.create('header', 'ui-view-header');
    careerHeader.appendChild(this.create('h2', null, 'Career'));
    this.addButton(careerHeader, 'career-back', 'Back', () => this.setMenuView('home'));
    careerView.appendChild(careerHeader);
    careerView.appendChild(this.careerList);
    panel.appendChild(careerView);

    const garageHeader = this.create('header', 'ui-view-header');
    garageHeader.appendChild(this.create('h2', null, 'Garage'));
    this.addButton(garageHeader, 'garage-back', 'Back', () => this.setMenuView('home'));
    garageView.appendChild(garageHeader);
    garageView.appendChild(this.garageList);
    panel.appendChild(garageView);

    this.menu.appendChild(panel);
  }

  private buildHud(): void {
    const topLeft = this.create('div', 'hud-corner hud-tl');
    this.hudPosition.textContent = '1st';
    this.hudTotal.textContent = '/ 6';
    this.hudLap.textContent = 'LAP 1/3';
    topLeft.append(this.hudPosition, this.hudTotal, this.hudLap);

    const topRight = this.create('div', 'hud-corner hud-tr');
    this.hudTime.textContent = '0:00.000';
    topRight.appendChild(this.hudTime);

    const bottomRight = this.create('div', 'hud-corner hud-br');
    const speedRow = this.create('div', 'hud-speed-row');
    this.hudSpeed.textContent = '0';
    speedRow.appendChild(this.hudSpeed);
    speedRow.appendChild(this.create('span', 'hud-unit', 'km/h'));
    bottomRight.appendChild(speedRow);

    const nitro = this.create('div', 'hud-nitro');
    nitro.appendChild(this.hudNitroBar);

    this.hud.append(topLeft, topRight, this.hudObjective, this.hudCountdown, bottomRight, nitro);
  }

  private buildSettings(): void {
    const panel = this.create('div', 'ui-panel settings-panel');
    panel.id = 'settings-panel';
    const header = this.create('header', 'ui-view-header');
    header.appendChild(this.create('h2', null, 'Settings'));
    this.addButton(header, 'settings-close', 'Done', () => this.closeSettings());
    panel.appendChild(header);

    const qualityGroup = this.create('fieldset', 'ui-group');
    qualityGroup.appendChild(this.create('legend', null, 'Graphics Quality'));
    this.qualityGroup = this.addSegmentGroup(
      qualityGroup,
      'quality-group',
      QUALITY_PRESETS,
      this.settings.quality.preset,
      (value) => this.actions?.setQuality(value as QualityPreset),
    );
    panel.appendChild(qualityGroup);

    const cameraGroup = this.create('fieldset', 'ui-group');
    cameraGroup.appendChild(this.create('legend', null, 'Camera'));
    this.cameraGroup = this.addSegmentGroup(
      cameraGroup,
      'camera-group',
      CAMERA_MODES,
      this.settings.cameraMode,
      (value) => this.actions?.setCameraMode(value as CameraMode),
    );
    panel.appendChild(cameraGroup);

    const controlGroup = this.create('fieldset', 'ui-group');
    controlGroup.appendChild(this.create('legend', null, 'Control Mode'));
    this.controlGroup = this.addSegmentGroup(
      controlGroup,
      'control-group',
      CONTROL_MODES,
      this.settings.controlMode,
      (value) => {
        void this.onControlSelected(value as ControlMode);
      },
    );
    panel.appendChild(controlGroup);

    const audioGroup = this.create('fieldset', 'ui-group');
    audioGroup.appendChild(this.create('legend', null, 'Audio'));
    const volumeRow = this.create('div', 'audio-row');
    const volumeLabel = this.create('label', null, 'Volume');
    volumeLabel.htmlFor = 'settings-volume';
    this.volumeInput.type = 'range';
    this.volumeInput.min = '0';
    this.volumeInput.max = '1';
    this.volumeInput.step = '0.05';
    this.volumeInput.addEventListener('input', () => {
      const value = Number.parseFloat(this.volumeInput.value);
      if (Number.isFinite(value)) this.actions?.setAudioVolume(clamp01(value));
    });
    volumeRow.append(volumeLabel, this.volumeInput, this.volumeLabel);
    const muteRow = this.create('div', 'audio-row');
    this.muteInput.type = 'checkbox';
    this.muteInput.addEventListener('change', () => this.actions?.setMuted(this.muteInput.checked));
    const muteLabel = this.create('label', null, 'Mute');
    muteLabel.htmlFor = 'settings-mute';
    muteRow.append(this.muteInput, muteLabel);
    audioGroup.append(volumeRow, muteRow);
    panel.appendChild(audioGroup);

    this.settingsScreen.appendChild(panel);
  }

  private buildPause(): void {
    const panel = this.create('div', 'ui-panel pause-panel');
    panel.id = 'pause-panel';
    panel.appendChild(this.create('h2', 'ui-title', 'Paused'));
    this.addButton(panel, 'pause-resume', 'Resume', () => this.actions?.resume());
    this.addButton(panel, 'pause-restart', 'Restart', () => this.actions?.restart());
    this.addButton(panel, 'pause-menu', 'Back to Menu', () => this.actions?.backToMenu());
    this.pauseScreen.appendChild(panel);
  }

  private buildResults(): void {
    const panel = this.create('div', 'ui-panel results-panel');
    panel.id = 'results-panel';
    panel.appendChild(this.resultsTitle);
    const grid = this.create('dl', 'results-grid');
    this.addResultRow(grid, 'results-row-position', 'Position', this.resultsPosition);
    this.addResultRow(grid, 'results-row-time', 'Time', this.resultsTime);
    this.addResultRow(grid, 'results-row-score', 'Score', this.resultsScore);
    this.addResultRow(grid, 'results-row-reward', 'Reward', this.resultsReward);
    this.resultsUnlockRow.appendChild(this.create('dt', null, 'Unlocked'));
    this.resultsUnlockRow.appendChild(this.resultsUnlock);
    grid.appendChild(this.resultsUnlockRow);
    panel.appendChild(grid);
    this.addButton(panel, 'results-restart', 'Race Again', () => this.actions?.restart());
    this.addButton(panel, 'results-menu', 'Back to Menu', () => this.actions?.backToMenu());
    this.resultsScreen.appendChild(panel);
  }

  private buildTouchControls(): void {
    const left = this.create('div', 'touch-cluster touch-left');
    left.appendChild(this.makeTouchButton('touch-left', '◀', 'Steer left', 'steerLeft'));
    left.appendChild(this.makeTouchButton('touch-right', '▶', 'Steer right', 'steerRight'));
    const right = this.create('div', 'touch-cluster touch-right');
    right.appendChild(this.makeTouchButton('touch-gas', 'GAS', 'Gas', 'gas'));
    right.appendChild(this.makeTouchButton('touch-brake', 'BRAKE', 'Brake', 'brake'));
    right.appendChild(this.makeTouchButton('touch-nitro', 'NITRO', 'Nitro', 'nitro'));
    right.appendChild(this.makeTouchButton('touch-drift', 'DRIFT', 'Drift', 'drift'));
    this.touchControls.append(left, right);
  }

  private makeTouchButton(id: string, label: string, ariaLabel: string, field: keyof TouchInput): HTMLButtonElement {
    const button = this.create('button', 'touch-button', label);
    button.id = id;
    button.type = 'button';
    button.setAttribute('aria-label', ariaLabel);
    const press = (event: Event) => {
      const pointerId = (event as PointerEvent).pointerId;
      if (pointerId !== undefined) {
        try {
          button.setPointerCapture(pointerId);
        } catch {
          // Pointer capture is unsupported or the pointer is unknown; the button still works.
        }
      }
      button.classList.add('pressed');
      this.touch[field] = true;
    };
    const release = (event: Event) => {
      const pointerId = (event as PointerEvent).pointerId;
      if (pointerId !== undefined) {
        try {
          button.releasePointerCapture(pointerId);
        } catch {
          // Release is best-effort; the button always returns to its idle state.
        }
      }
      button.classList.remove('pressed');
      this.touch[field] = false;
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    this.touchButtons.push(button);
    return button;
  }

  private buildToast(): void {
    this.toast.appendChild(this.toastMessage);
  }

  private cupUnlocked(cup: CareerCup): boolean {
    const save = this.save;
    if (!save) return true;
    for (const previous of careerCups) {
      if (previous.id === cup.id) break;
      if (!previous.events.every((event) => save.completedEvents.includes(event.id))) return false;
    }
    return true;
  }

  private eventUnlocked(cup: CareerCup, eventId: string): boolean {
    if (!this.cupUnlocked(cup)) return false;
    const save = this.save;
    if (!save) return true;
    let open = true;
    for (const event of cup.events) {
      if (event.id === eventId) return open;
      if (!save.completedEvents.includes(event.id)) open = false;
    }
    return false;
  }

  private renderCareer(): void {
    this.careerList.textContent = '';
    const save = this.save;
    for (const cup of careerCups) {
      const section = this.create('section', 'cup');
      const locked = save ? !this.cupUnlocked(cup) : false;
      if (locked) section.classList.add('locked');
      section.appendChild(this.create('h3', 'cup-title', cup.displayName));
      cup.events.forEach((event, index) => {
        const done = save?.completedEvents.includes(event.id) ?? false;
        const unlocked = save ? this.eventUnlocked(cup, event.id) : true;
        const button = this.create('button', 'event-row', null);
        button.type = 'button';
        button.dataset.eventId = event.id;
        button.dataset.cupId = cup.id;
        button.disabled = !unlocked;
        if (done) button.classList.add('done');
        const track = tracks.find((candidate) => candidate.id === event.trackId);
        button.textContent = `${index + 1}. ${EVENT_TYPE_LABELS[event.type]} · ${track?.displayName ?? event.trackId}`;
        button.addEventListener('click', () => this.actions?.startCareerEvent(cup.id, event.id));
        section.appendChild(button);
      });
      this.careerList.appendChild(section);
    }
  }

  private renderGarage(): void {
    this.garageList.textContent = '';
    const save = this.save;
    for (const vehicle of vehicles) {
      const owned = save?.ownedVehicles.includes(vehicle.id) ?? false;
      const selected = save?.selectedVehicle === vehicle.id;
      const button = this.create('button', 'vehicle-row', vehicle.displayName);
      button.type = 'button';
      button.dataset.vehicleId = vehicle.id;
      button.disabled = !owned;
      if (selected) button.classList.add('selected');
      button.appendChild(
        this.create(
          'span',
          'vehicle-detail',
          owned ? `Top speed ${Math.round(vehicle.baseSpeed * 3.6)} km/h` : 'Locked',
        ),
      );
      button.addEventListener('click', () => this.actions?.selectVehicle(vehicle.id));
      this.garageList.appendChild(button);
    }
  }

  private async onControlSelected(mode: ControlMode): Promise<void> {
    if (mode === 'tilt' && !(await requestTiltPermission())) {
      this.showToast('Motion permission denied — tilt controls unavailable');
      return;
    }
    this.actions?.setControlMode(mode);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
    ) {
      return;
    }
    const identifier = event.code || event.key;
    if (identifier === 'Escape' && this.phase === 'menu' && this.settingsOpen) {
      this.closeSettings();
      return;
    }
    const actions = this.actions;
    if (!actions) return;
    switch (identifier) {
      case 'KeyP':
      case 'p':
      case 'Escape':
        if (this.phase === 'racing') {
          actions.pause();
          event.preventDefault();
        } else if (this.phase === 'paused') {
          actions.resume();
          event.preventDefault();
        }
        break;
      case 'KeyC':
      case 'c':
        if (this.phase === 'countdown' || this.phase === 'racing') {
          actions.changeCamera();
          event.preventDefault();
        }
        break;
      case 'KeyR':
      case 'r':
        if (this.phase === 'results') {
          actions.restart();
          event.preventDefault();
        }
        break;
      case 'Enter':
        if (this.phase === 'menu' && !this.settingsOpen) {
          const active = this.doc.activeElement;
          if (!(active instanceof HTMLButtonElement)) {
            actions.startQuickRace(this.quickTrackId);
            event.preventDefault();
          }
        }
        break;
    }
  };
}
