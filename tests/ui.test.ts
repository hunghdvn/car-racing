import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UiController,
  formatNitro,
  formatPosition,
  formatSpeed,
  formatTime,
  reduceUiState,
  requestTiltPermission,
} from '../src/ui/UiController';
import { createDefaultSave, DEFAULT_SETTINGS } from '../src/progression/SaveService';
import type { TouchInput } from '../src/simulation/PlayerController';

it('shows touch controls only for touch mode', () => {
  expect(reduceUiState({ phase:'racing', controlMode:'touch' }).showTouchControls).toBe(true);
  expect(reduceUiState({ phase:'racing', controlMode:'keyboard' }).showTouchControls).toBe(false);
});

const UI_IDS = ['menu', 'hud', 'settings', 'pause', 'results', 'touch-controls', 'toast'];
let activeUi: UiController | null = null;

function mountUi(): UiController {
  document.body.textContent = '';
  for (const id of UI_IDS) {
    const node = document.createElement('div');
    node.id = id;
    document.body.appendChild(node);
  }
  activeUi = new UiController();
  return activeUi;
}

afterEach(() => {
  activeUi?.destroy();
  activeUi = null;
  document.body.textContent = '';
});

function createActions() {
  return {
    startQuickRace: vi.fn(),
    startCareer: vi.fn(),
    resume: vi.fn(),
    restart: vi.fn(),
    backToMenu: vi.fn(),
    pause: vi.fn(),
    changeCamera: vi.fn(),
    setQuality: vi.fn(),
    setCameraMode: vi.fn(),
    setControlMode: vi.fn(),
    setAudioVolume: vi.fn(),
    setMuted: vi.fn(),
    startCareerEvent: vi.fn(),
    selectVehicle: vi.fn(),
    purchaseUpgrade: vi.fn(),
    equipCosmetic: vi.fn(),
  };
}

function keydown(code: string, key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key, cancelable: true }));
}

function pressPointer(element: HTMLElement, type: string, pointerId = 1): void {
  const event = new Event(type);
  Object.assign(event, { pointerId });
  element.dispatchEvent(event);
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('reduceUiState', () => {
  it('shows touch controls in touch and tilt modes without dead drive buttons', () => {
    const touch = reduceUiState({ phase: 'racing', controlMode: 'touch' });
    expect(touch.showTouchControls).toBe(true);
    expect(touch.showSteerButtons).toBe(true);
    expect(touch.showThrottleButtons).toBe(true);
    expect(touch.showActionButtons).toBe(true);

    const tilt = reduceUiState({ phase: 'racing', controlMode: 'tilt' });
    expect(tilt.showTouchControls).toBe(true);
    expect(tilt.showSteerButtons).toBe(false);
    expect(tilt.showThrottleButtons).toBe(false);
    expect(tilt.showActionButtons).toBe(true);

    expect(reduceUiState({ phase: 'racing', controlMode: 'keyboard' }).showTouchControls).toBe(false);
  });

  it('shows the in-HUD pause button during countdown and racing only', () => {
    expect(reduceUiState({ phase: 'countdown', controlMode: 'keyboard' }).showPauseButton).toBe(true);
    expect(reduceUiState({ phase: 'racing', controlMode: 'keyboard' }).showPauseButton).toBe(true);
    expect(reduceUiState({ phase: 'paused', controlMode: 'keyboard' }).showPauseButton).toBe(false);
    expect(reduceUiState({ phase: 'menu', controlMode: 'keyboard' }).showPauseButton).toBe(false);
    expect(reduceUiState({ phase: 'results', controlMode: 'keyboard' }).showPauseButton).toBe(false);
  });

  it('hides touch controls outside racing', () => {
    for (const phase of ['menu', 'countdown', 'paused', 'results'] as const) {
      expect(reduceUiState({ phase, controlMode: 'touch' }).showTouchControls).toBe(false);
      expect(reduceUiState({ phase, controlMode: 'tilt' }).showTouchControls).toBe(false);
    }
  });

  it('shows the HUD for countdown, racing and paused phases', () => {
    expect(reduceUiState({ phase: 'countdown', controlMode: 'keyboard' }).showHud).toBe(true);
    expect(reduceUiState({ phase: 'racing', controlMode: 'keyboard' }).showHud).toBe(true);
    expect(reduceUiState({ phase: 'paused', controlMode: 'keyboard' }).showHud).toBe(true);
    expect(reduceUiState({ phase: 'menu', controlMode: 'keyboard' }).showHud).toBe(false);
    expect(reduceUiState({ phase: 'results', controlMode: 'keyboard' }).showHud).toBe(false);
  });
});

describe('formatting', () => {
  it('formats race time deterministically', () => {
    expect(formatTime(0)).toBe('0:00.000');
    expect(formatTime(9.999)).toBe('0:09.999');
    expect(formatTime(65.25)).toBe('1:05.250');
    expect(formatTime(300)).toBe('5:00.000');
    expect(formatTime(-3)).toBe('0:00.000');
    expect(formatTime(Number.NaN)).toBe('0:00.000');
  });

  it('formats speed as whole km/h', () => {
    expect(formatSpeed(0)).toBe('0');
    expect(formatSpeed(123.6)).toBe('124');
    expect(formatSpeed(-8)).toBe('0');
  });

  it('formats position with ordinal suffix', () => {
    expect(formatPosition(1)).toBe('1st');
    expect(formatPosition(2)).toBe('2nd');
    expect(formatPosition(3)).toBe('3rd');
    expect(formatPosition(4)).toBe('4th');
    expect(formatPosition(11)).toBe('11th');
    expect(formatPosition(12)).toBe('12th');
    expect(formatPosition(13)).toBe('13th');
    expect(formatPosition(22)).toBe('22nd');
  });

  it('formats nitro as a bounded percentage', () => {
    expect(formatNitro(0)).toBe('0%');
    expect(formatNitro(0.55)).toBe('55%');
    expect(formatNitro(1)).toBe('100%');
    expect(formatNitro(1.4)).toBe('100%');
    expect(formatNitro(-0.4)).toBe('0%');
  });
});

describe('screen routing', () => {
  it('shows the menu on startup and routes phases', () => {
    const ui = mountUi();
    expect(document.getElementById('menu')!.classList.contains('ui-active')).toBe(true);
    expect(document.getElementById('hud')!.classList.contains('ui-hidden')).toBe(true);
    expect(document.getElementById('pause')!.classList.contains('ui-active')).toBe(false);
    expect(document.getElementById('results')!.classList.contains('ui-active')).toBe(false);
    expect(document.getElementById('touch-controls')!.classList.contains('ui-hidden')).toBe(true);

    ui.showScreen('racing');
    expect(document.getElementById('menu')!.classList.contains('ui-active')).toBe(false);
    expect(document.getElementById('hud')!.classList.contains('ui-hidden')).toBe(false);
    expect(document.getElementById('pause')!.classList.contains('ui-active')).toBe(false);

    ui.showScreen('paused');
    expect(document.getElementById('pause')!.classList.contains('ui-active')).toBe(true);
    expect(document.getElementById('hud')!.classList.contains('ui-hidden')).toBe(false);

    ui.showScreen('results');
    expect(document.getElementById('results')!.classList.contains('ui-active')).toBe(true);
    expect(document.getElementById('pause')!.classList.contains('ui-active')).toBe(false);
    expect(document.getElementById('hud')!.classList.contains('ui-hidden')).toBe(true);
  });

  it('toggles touch controls from the active control mode', () => {
    const ui = mountUi();
    ui.setSettings({ ...DEFAULT_SETTINGS, controlMode: 'touch' });
    ui.showScreen('racing');
    expect(document.getElementById('touch-controls')!.classList.contains('ui-hidden')).toBe(false);
    ui.setSettings({ ...DEFAULT_SETTINGS, controlMode: 'keyboard' });
    ui.showScreen('racing');
    expect(document.getElementById('touch-controls')!.classList.contains('ui-hidden')).toBe(true);
  });
});

describe('HUD', () => {
  it('updates speed, lap, position, time and nitro deterministically', () => {
    const ui = mountUi();
    ui.updateHud({
      speed: 210.4,
      lap: 2,
      totalLaps: 3,
      position: 3,
      vehicleCount: 6,
      time: 65.25,
      nitro: 0.4,
      countdown: null,
    });
    expect(document.getElementById('hud-speed')!.textContent).toBe('210');
    expect(document.getElementById('hud-lap')!.textContent).toBe('LAP 2/3');
    expect(document.getElementById('hud-position')!.textContent).toBe('3rd');
    expect(document.getElementById('hud-total')!.textContent).toBe('/ 6');
    expect(document.getElementById('hud-time')!.textContent).toBe('1:05.250');
    expect(document.getElementById('hud-nitro-bar')!.style.width).toBe('40%');
  });

  it('shows the countdown while counting and hides it when null', () => {
    const ui = mountUi();
    const countdown = document.getElementById('hud-countdown')!;
    ui.updateHud({ speed: 0, lap: 1, totalLaps: 3, position: 1, vehicleCount: 6, time: 0, nitro: 1, countdown: 3 });
    expect(countdown.classList.contains('ui-hidden')).toBe(false);
    expect(countdown.textContent).toBe('3');
    ui.updateHud({ speed: 0, lap: 1, totalLaps: 3, position: 1, vehicleCount: 6, time: 0, nitro: 1, countdown: null });
    expect(countdown.classList.contains('ui-hidden')).toBe(true);
  });

  it('shows the event objective when provided', () => {
    const ui = mountUi();
    const objective = document.getElementById('hud-objective')!;
    ui.updateHud({
      speed: 0,
      lap: 1,
      totalLaps: 1,
      position: 1,
      vehicleCount: 6,
      time: 0,
      nitro: 0,
      countdown: null,
      objective: 'Target 1:20.000',
    });
    expect(objective.classList.contains('ui-hidden')).toBe(false);
    expect(objective.textContent).toBe('Target 1:20.000');
    ui.updateHud({ speed: 0, lap: 1, totalLaps: 1, position: 1, vehicleCount: 6, time: 0, nitro: 0, countdown: null });
    expect(objective.classList.contains('ui-hidden')).toBe(true);
  });

  it('renders the minimap from track bounds and positions the player marker', () => {
    const ui = mountUi();
    const minimap = document.getElementById('hud-minimap')!;
    expect(minimap.classList.contains('ui-hidden')).toBe(true);
    ui.updateHud({
      speed: 0,
      lap: 1,
      totalLaps: 3,
      position: 1,
      vehicleCount: 6,
      time: 0,
      nitro: 0,
      countdown: null,
      minimap: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 50 },
          { x: 0, y: 50 },
        ],
        bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
        player: { x: 42, y: 17.5 },
      },
    });
    expect(minimap.classList.contains('ui-hidden')).toBe(false);
    const path = document.querySelector<SVGPolylineElement>('#hud-minimap polyline')!;
    expect(path.getAttribute('points')).toBe('0.00,0.00 100.00,0.00 100.00,50.00 0.00,50.00');
    const svg = document.getElementById('hud-minimap-svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0.00 -25.00 100.00 100.00');
    const marker = document.querySelector<SVGCircleElement>('#hud-minimap circle')!;
    expect(marker.getAttribute('cx')).toBe('42.00');
    expect(marker.getAttribute('cy')).toBe('17.50');
    ui.updateHud({ speed: 0, lap: 1, totalLaps: 3, position: 1, vehicleCount: 6, time: 0, nitro: 0, countdown: null });
    expect(minimap.classList.contains('ui-hidden')).toBe(true);
  });

  it('shows the live drift score only while drifting', () => {
    const ui = mountUi();
    const drift = document.getElementById('hud-drift')!;
    expect(drift.classList.contains('ui-hidden')).toBe(true);
    ui.updateHud({ speed: 120, lap: 1, totalLaps: 3, position: 2, vehicleCount: 6, time: 12.5, nitro: 0.5, countdown: null, driftScore: 123.4 });
    expect(drift.classList.contains('ui-hidden')).toBe(false);
    expect(drift.textContent).toBe('DRIFT 123');
    ui.updateHud({ speed: 120, lap: 1, totalLaps: 3, position: 2, vehicleCount: 6, time: 13.0, nitro: 0.5, countdown: null, driftScore: 0 });
    expect(drift.classList.contains('ui-hidden')).toBe(true);
  });
});

describe('results', () => {
  it('renders results with reward and unlock', () => {
    const ui = mountUi();
    ui.showScreen('results');
    ui.showResults({
      position: 1,
      time: 65.25,
      score: 100,
      passed: true,
      rewardCurrency: 150,
      rewardXp: 15,
      unlock: 'swift',
    });
    expect(document.getElementById('results-title')!.textContent).toBe('Event Complete');
    expect(document.getElementById('results-position')!.textContent).toBe('1st');
    expect(document.getElementById('results-time')!.textContent).toBe('1:05.250');
    expect(document.getElementById('results-score')!.textContent).toBe('100');
    expect(document.getElementById('results-reward')!.textContent).toBe('+150 credits · +15 XP');
    expect(document.getElementById('results-unlock')!.textContent).toBe('Volt Swift');
    expect(document.getElementById('results-unlock-row')!.classList.contains('ui-hidden')).toBe(false);
  });

  it('hides the unlock row when nothing unlocks', () => {
    const ui = mountUi();
    ui.showResults({ position: 4, time: 120.5, score: 25, passed: false, rewardCurrency: 0, rewardXp: 0 });
    expect(document.getElementById('results-title')!.textContent).toBe('Race Over');
    expect(document.getElementById('results-position')!.textContent).toBe('4th');
    expect(document.getElementById('results-unlock-row')!.classList.contains('ui-hidden')).toBe(true);
  });
});

describe('menu actions', () => {
  it('wires menu, pause and results buttons to actions', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);

    document.getElementById('menu-quick-race')!.dispatchEvent(new Event('click'));
    expect(actions.startQuickRace).toHaveBeenCalledTimes(1);

    document.getElementById('menu-career')!.dispatchEvent(new Event('click'));
    expect(actions.startCareer).toHaveBeenCalledTimes(1);
    expect(document.getElementById('menu-view-career')!.classList.contains('ui-hidden')).toBe(false);
    document.getElementById('career-back')!.dispatchEvent(new Event('click'));
    expect(document.getElementById('menu-view-home')!.classList.contains('ui-hidden')).toBe(false);

    document.getElementById('menu-garage')!.dispatchEvent(new Event('click'));
    expect(document.getElementById('menu-view-garage')!.classList.contains('ui-hidden')).toBe(false);

    document.getElementById('menu-settings')!.dispatchEvent(new Event('click'));
    expect(document.getElementById('settings')!.classList.contains('ui-active')).toBe(true);
    document.getElementById('settings-close')!.dispatchEvent(new Event('click'));
    expect(document.getElementById('settings')!.classList.contains('ui-active')).toBe(false);

    ui.showScreen('paused');
    document.getElementById('pause-resume')!.dispatchEvent(new Event('click'));
    document.getElementById('pause-restart')!.dispatchEvent(new Event('click'));
    document.getElementById('pause-menu')!.dispatchEvent(new Event('click'));
    expect(actions.resume).toHaveBeenCalledTimes(1);
    expect(actions.restart).toHaveBeenCalledTimes(1);
    expect(actions.backToMenu).toHaveBeenCalledTimes(1);

    ui.showScreen('results');
    document.getElementById('results-restart')!.dispatchEvent(new Event('click'));
    document.getElementById('results-menu')!.dispatchEvent(new Event('click'));
    expect(actions.restart).toHaveBeenCalledTimes(2);
    expect(actions.backToMenu).toHaveBeenCalledTimes(2);
  });
});

describe('settings', () => {
  it('exposes quality, camera, control, volume and mute controls', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);

    expect(document.querySelectorAll('#quality-group .segment')).toHaveLength(5);
    expect(document.querySelectorAll('#camera-group .segment')).toHaveLength(3);
    expect(document.querySelectorAll('#control-group .segment')).toHaveLength(3);

    document.querySelector<HTMLButtonElement>('#quality-group button[data-value="ultra"]')!.click();
    expect(actions.setQuality).toHaveBeenCalledWith('ultra');

    document.querySelector<HTMLButtonElement>('#camera-group button[data-value="hood"]')!.click();
    expect(actions.setCameraMode).toHaveBeenCalledWith('hood');

    document.querySelector<HTMLButtonElement>('#control-group button[data-value="touch"]')!.click();
    expect(actions.setControlMode).toHaveBeenCalledWith('touch');

    const volume = document.querySelector<HTMLInputElement>('#settings-volume')!;
    volume.value = '0.25';
    volume.dispatchEvent(new Event('input'));
    expect(actions.setAudioVolume).toHaveBeenCalledWith(0.25);

    const mute = document.querySelector<HTMLInputElement>('#settings-mute')!;
    mute.checked = true;
    mute.dispatchEvent(new Event('change'));
    expect(actions.setMuted).toHaveBeenCalledWith(true);
  });

  it('reflects saved settings into the controls', () => {
    const ui = mountUi();
    ui.setSettings({
      ...DEFAULT_SETTINGS,
      quality: { ...DEFAULT_SETTINGS.quality, preset: 'ultra' },
      controlMode: 'tilt',
      cameraMode: 'hood',
      audioVolume: 0.25,
      muted: true,
    });
    expect(
      document.querySelector<HTMLButtonElement>('#quality-group button[data-value="ultra"]')!.classList.contains(
        'ui-selected',
      ),
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>('#quality-group button[data-value="medium"]')!.classList.contains(
        'ui-selected',
      ),
    ).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>('#camera-group button[data-value="hood"]')!.classList.contains(
        'ui-selected',
      ),
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>('#control-group button[data-value="tilt"]')!.classList.contains(
        'ui-selected',
      ),
    ).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#settings-volume')!.value).toBe('0.25');
    expect(document.getElementById('settings-volume-value')!.textContent).toBe('25%');
    expect(document.querySelector<HTMLInputElement>('#settings-mute')!.checked).toBe(true);
  });
});

describe('keyboard shortcuts', () => {
  it('pauses with P, resumes with P or Escape and cycles camera with C', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);

    ui.showScreen('racing');
    keydown('KeyP', 'p');
    expect(actions.pause).toHaveBeenCalledTimes(1);

    ui.showScreen('paused');
    keydown('KeyP', 'p');
    expect(actions.resume).toHaveBeenCalledTimes(1);
    keydown('Escape', 'Escape');
    expect(actions.resume).toHaveBeenCalledTimes(2);

    ui.showScreen('racing');
    keydown('KeyC', 'c');
    expect(actions.changeCamera).toHaveBeenCalledTimes(1);
  });

  it('restarts with R only after results', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);

    ui.showScreen('racing');
    keydown('KeyR', 'r');
    expect(actions.restart).not.toHaveBeenCalled();

    ui.showScreen('results');
    keydown('KeyR', 'r');
    expect(actions.restart).toHaveBeenCalledTimes(1);
  });

  it('starts a quick race with Enter from the menu', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);

    ui.showScreen('racing');
    keydown('Enter', 'Enter');
    expect(actions.startQuickRace).not.toHaveBeenCalled();

    ui.showScreen('menu');
    keydown('Enter', 'Enter');
    expect(actions.startQuickRace).toHaveBeenCalledTimes(1);

    ui.openSettings();
    keydown('Enter', 'Enter');
    expect(actions.startQuickRace).toHaveBeenCalledTimes(1);

    ui.closeSettings();
    document.getElementById('menu-quick-race')!.focus();
    keydown('Enter', 'Enter');
    expect(actions.startQuickRace).toHaveBeenCalledTimes(1);
  });

  it('closes settings with Escape from the menu', () => {
    const ui = mountUi();
    ui.openSettings();
    expect(document.getElementById('settings')!.classList.contains('ui-active')).toBe(true);
    keydown('Escape', 'Escape');
    expect(document.getElementById('settings')!.classList.contains('ui-active')).toBe(false);
  });

  it('ignores shortcuts while a form field is the event target', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);
    ui.showScreen('racing');

    const volume = document.querySelector<HTMLInputElement>('#settings-volume')!;
    volume.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true }));
    expect(actions.pause).not.toHaveBeenCalled();
  });
});

describe('touch controls', () => {
  const buttons: Array<[string, keyof TouchInput]> = [
    ['touch-left', 'steerLeft'],
    ['touch-right', 'steerRight'],
    ['touch-gas', 'gas'],
    ['touch-brake', 'brake'],
    ['touch-nitro', 'nitro'],
    ['touch-drift', 'drift'],
  ];

  it('tracks held buttons through pointer events', () => {
    const ui = mountUi();
    for (const [id, field] of buttons) {
      const button = document.getElementById(id)!;
      pressPointer(button, 'pointerdown');
      expect(ui.getTouchState()[field]).toBe(true);
      expect(button.classList.contains('pressed')).toBe(true);
      pressPointer(button, 'pointerup');
      expect(ui.getTouchState()[field]).toBe(false);
      expect(button.classList.contains('pressed')).toBe(false);
    }
  });

  it('releases held buttons on pointercancel', () => {
    const ui = mountUi();
    const gas = document.getElementById('touch-gas')!;
    pressPointer(gas, 'pointerdown');
    expect(ui.getTouchState().gas).toBe(true);
    pressPointer(gas, 'pointercancel');
    expect(ui.getTouchState().gas).toBe(false);
  });

  it('gives touch players a visible pause button wired to actions.pause', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);
    ui.setSettings({ ...DEFAULT_SETTINGS, controlMode: 'touch' });
    ui.showScreen('racing');
    const pauseButton = document.getElementById('hud-pause')!;
    expect(pauseButton.classList.contains('ui-hidden')).toBe(false);
    pauseButton.dispatchEvent(new Event('click', { bubbles: true }));
    expect(actions.pause).toHaveBeenCalledTimes(1);
  });

  it('hides the pause button while the pause screen is shown', () => {
    const ui = mountUi();
    ui.showScreen('racing');
    const pauseButton = document.getElementById('hud-pause')!;
    expect(pauseButton.classList.contains('ui-hidden')).toBe(false);
    ui.showScreen('paused');
    expect(pauseButton.classList.contains('ui-hidden')).toBe(true);
    ui.showScreen('menu');
    expect(pauseButton.classList.contains('ui-hidden')).toBe(true);
  });

  it('keeps nitro and drift reachable while driving with tilt', () => {
    const ui = mountUi();
    ui.setSettings({ ...DEFAULT_SETTINGS, controlMode: 'tilt' });
    ui.showScreen('racing');
    const nitro = document.getElementById('touch-nitro')!;
    const drift = document.getElementById('touch-drift')!;
    const gas = document.getElementById('touch-gas')!;
    const steer = document.getElementById('touch-left')!;
    expect(nitro.classList.contains('ui-hidden')).toBe(false);
    expect(drift.classList.contains('ui-hidden')).toBe(false);
    expect(gas.classList.contains('ui-hidden')).toBe(true);
    expect(steer.classList.contains('ui-hidden')).toBe(true);
    pressPointer(nitro, 'pointerdown');
    expect(ui.getTouchState().nitro).toBe(true);
    pressPointer(nitro, 'pointerup');
    expect(ui.getTouchState().nitro).toBe(false);
  });

  it('shows the collision flash overlay only while the effect is active', () => {
    const ui = mountUi();
    ui.showScreen('racing');
    const flash = document.getElementById('hud-flash')!;
    expect(flash.style.opacity).toBe('');
    ui.setCollisionFlash(0.8);
    expect(Number.parseFloat(flash.style.opacity)).toBeGreaterThan(0.1);
    ui.setCollisionFlash(0);
    expect(flash.style.opacity).toBe('0.000');
  });
});

describe('tilt permission', () => {
  const original = (globalThis as Record<string, unknown>).DeviceOrientationEvent;

  afterEach(() => {
    (globalThis as Record<string, unknown>).DeviceOrientationEvent = original;
  });

  it('resolves true when no permission API exists', async () => {
    (globalThis as Record<string, unknown>).DeviceOrientationEvent = undefined;
    expect(await requestTiltPermission()).toBe(true);
  });

  it('resolves the iOS permission result', async () => {
    (globalThis as Record<string, unknown>).DeviceOrientationEvent = {
      requestPermission: () => Promise.resolve('granted'),
    };
    expect(await requestTiltPermission()).toBe(true);
    (globalThis as Record<string, unknown>).DeviceOrientationEvent = {
      requestPermission: () => Promise.resolve('denied'),
    };
    expect(await requestTiltPermission()).toBe(false);
  });

  it('selects tilt only after permission is granted', async () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);

    (globalThis as Record<string, unknown>).DeviceOrientationEvent = {
      requestPermission: () => Promise.resolve('denied'),
    };
    document.querySelector<HTMLButtonElement>('#control-group button[data-value="tilt"]')!.click();
    await flushMicrotasks();
    expect(actions.setControlMode).not.toHaveBeenCalled();
    expect(document.getElementById('toast-message')!.textContent).toContain('Motion permission denied');
    expect(document.getElementById('toast')!.classList.contains('ui-visible')).toBe(true);

    (globalThis as Record<string, unknown>).DeviceOrientationEvent = {
      requestPermission: () => Promise.resolve('granted'),
    };
    document.querySelector<HTMLButtonElement>('#control-group button[data-value="tilt"]')!.click();
    await flushMicrotasks();
    expect(actions.setControlMode).toHaveBeenCalledWith('tilt');
  });
});

describe('career and garage', () => {
  it('renders cups and events with lock state from the save', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);
    ui.setSaveData(createDefaultSave());
    ui.setMenuView('career');

    expect(document.querySelector<HTMLButtonElement>('[data-event-id="cup-1-event-1"]')!.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('[data-event-id="cup-1-event-2"]')!.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[data-event-id="cup-2-event-1"]')!.disabled).toBe(true);

    const completed = createDefaultSave();
    completed.completedEvents = [
      'cup-1-event-1',
      'cup-1-event-2',
      'cup-1-event-3',
      'cup-1-event-4',
      'cup-1-event-5',
    ];
    ui.setSaveData(completed);
    expect(document.querySelector<HTMLButtonElement>('[data-event-id="cup-2-event-1"]')!.disabled).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>('[data-event-id="cup-1-event-1"]')!.classList.contains('done'),
    ).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-event-id="cup-1-event-1"]')!.dispatchEvent(new Event('click'));
    expect(actions.startCareerEvent).toHaveBeenCalledWith('cup-1', 'cup-1-event-1');
  });

  it('renders vehicles with ownership and selection state', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);
    ui.setSaveData(createDefaultSave());
    ui.setMenuView('garage');

    const starter = document.querySelector<HTMLButtonElement>('[data-vehicle-id="starter"]')!;
    const apex = document.querySelector<HTMLButtonElement>('[data-vehicle-id="apex"]')!;
    expect(starter.disabled).toBe(false);
    expect(starter.classList.contains('selected')).toBe(true);
    expect(apex.disabled).toBe(true);

    starter.dispatchEvent(new Event('click'));
    expect(actions.selectVehicle).toHaveBeenCalledWith('starter');
  });
});

describe('garage upgrades and cosmetics', () => {
  it('shows currency, XP, upgrade rows with level/cost/max for the selected owned vehicle', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);
    ui.setSaveData(createDefaultSave());
    ui.setMenuView('garage');

    expect(document.getElementById('garage-status')!.textContent).toBe('0 credits · 0 XP');
    expect(document.getElementById('garage-details')!.classList.contains('ui-hidden')).toBe(false);
    expect(document.getElementById('garage-vehicle-title')!.textContent).toBe('Neon Starter');

    const rows = Array.from(document.querySelectorAll<HTMLDivElement>('#garage-upgrades .upgrade-row'));
    expect(rows.map((row) => row.dataset.slot)).toEqual(['engine', 'acceleration', 'grip', 'nitro']);
    expect(rows.map((row) => row.querySelector('.upgrade-level')!.textContent)).toEqual([
      'Lv 0/3',
      'Lv 0/3',
      'Lv 0/3',
      'Lv 0/3',
    ]);
    expect(rows.map((row) => row.querySelector('.upgrade-buy')!.textContent)).toEqual([
      '150 cr',
      '120 cr',
      '100 cr',
      '180 cr',
    ]);

    rows[0]!.querySelector<HTMLButtonElement>('.upgrade-buy')!.dispatchEvent(new Event('click'));
    expect(actions.purchaseUpgrade).toHaveBeenCalledWith('starter', 'engine');
  });

  it('marks a maxed upgrade row as MAX and disabled', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);
    const save = createDefaultSave();
    save.upgradeLevels = { 'starter:engine': 3 };
    ui.setSaveData(save);
    ui.setMenuView('garage');

    const row = document.querySelector<HTMLDivElement>('#garage-upgrades .upgrade-row[data-slot="engine"]')!;
    expect(row.querySelector('.upgrade-level')!.textContent).toBe('Lv 3/3');
    const buy = row.querySelector<HTMLButtonElement>('.upgrade-buy')!;
    expect(buy.textContent).toBe('MAX');
    expect(buy.disabled).toBe(true);
  });

  it('renders a cosmetic picker from the vehicle options and marks the equipped one', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);
    const save = createDefaultSave();
    save.cosmetics = { starter: 'paint-starter-red' };
    ui.setSaveData(save);
    ui.setMenuView('garage');

    const swatches = Array.from(document.querySelectorAll<HTMLButtonElement>('#garage-cosmetics .cosmetic-swatch'));
    expect(swatches.map((swatch) => swatch.dataset.cosmeticId)).toEqual([
      'paint-starter-silver',
      'paint-starter-red',
      'wheels-starter-steel',
    ]);
    expect(swatches[1]!.classList.contains('ui-selected')).toBe(true);
    expect(swatches[0]!.classList.contains('ui-selected')).toBe(false);
    expect(swatches[0]!.style.backgroundColor).toBe('#d7e1ec');

    swatches[2]!.dispatchEvent(new Event('click'));
    expect(actions.equipCosmetic).toHaveBeenCalledWith('starter', 'wheels-starter-steel');
  });

  it('hides the upgrade and cosmetic panels when the selected vehicle is not owned', () => {
    const ui = mountUi();
    const actions = createActions();
    ui.bindActions(actions);
    const save = createDefaultSave();
    save.selectedVehicle = 'apex';
    save.ownedVehicles = ['starter'];
    ui.setSaveData(save);
    ui.setMenuView('garage');

    expect(document.getElementById('garage-details')!.classList.contains('ui-hidden')).toBe(true);
  });
});
