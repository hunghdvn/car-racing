import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { clampFrameDelta, createGame, FRAME_DELTA_CLAMP_MS } from '../src/game/Game';
import type { Game } from '../src/game/Game';
import { AudioEngine } from '../src/audio/AudioEngine';
import { UiController } from '../src/ui/UiController';
import type { Renderer } from '../src/rendering/Renderer';
import { SAVE_STORAGE_KEY, SaveService } from '../src/progression/SaveService';
import { aiProfiles } from '../src/config/ai';
import { createAIControl, type AITrackProbe, type RivalProbe } from '../src/simulation/AIController';
import type { VehicleState } from '../src/simulation/Vehicle';
import type { ObstacleConfig } from '../src/types';

it('transitions from menu to countdown to racing', () => {
  const game = createGame(null as never);
  expect(game.phase).toBe('menu');
  game.startQuickRace('city', 'starter');
  game.tick(4000);
  expect(game.phase).toBe('racing');
  game.pause();
  expect(game.phase).toBe('paused');
  game.dispose();
});

interface StandingsEntry {
  id: string;
  finished: boolean;
  position: number;
  progress: number;
  finishTime?: number;
}

interface TestRace {
  vehicles: Map<string, VehicleState>;
  configs: Map<string, { baseSpeed: number }>;
  model: AITrackProbe;
  track: { obstacles: ObstacleConfig[] };
  director: { phase: string; time: number; countdown: number };
}

interface TestGame extends Game {
  race: TestRace | null;
  playerController: { setInput(source: { keys: Record<string, boolean> }): void };
  lastStandings: StandingsEntry[];
  views: Map<string, { group: THREE.Group }>;
}

function freshGame(): TestGame {
  return createGame(null as never) as unknown as TestGame;
}

function seedCompletedEvents(eventIds: string[]): void {
  const save = new SaveService();
  save.reset();
  const data = save.load();
  data.completedEvents = eventIds;
  save.save(data);
}

function drivePlayer(game: TestGame): void {
  const race = game.race;
  if (!race) return;
  const player = race.vehicles.get('player')!;
  const rivals: RivalProbe[] = [...race.vehicles.entries()]
    .filter(([id]) => id !== 'player')
    .map(([, state]) => ({ position: state.position, heading: state.heading, speed: state.speed }));
  const input = createAIControl(player, race.model, rivals, race.track.obstacles, aiProfiles[3]!, 1 / 120);
  game.playerController.setInput({
    keys: {
      KeyW: input.throttle > 0.4,
      KeyS: input.brake > 0.4,
      KeyA: input.steer < -0.25,
      KeyD: input.steer > 0.25,
    },
  });
}

function runUntilPlayerFinish(game: TestGame, maxMs: number): void {
  let remaining = maxMs;
  while (remaining > 0) {
    drivePlayer(game);
    game.tick(200);
    remaining -= 200;
    const player = game.lastStandings.find((entry) => entry.id === 'player');
    if (player?.finished) return;
  }
}

it('shows results as soon as the player finishes, even while AI vehicles are still racing', () => {
  seedCompletedEvents(['cup-1-event-1']);
  const game = freshGame();
  game.startCareerEvent('cup-1', 'cup-1-event-2');
  expect(game.phase).toBe('countdown');
  runUntilPlayerFinish(game, 3 * 60_000);
  expect(game.phase).toBe('results');
  const playerRank = game.lastStandings.find((entry) => entry.id === 'player')!;
  expect(playerRank.finished).toBe(true);
  expect(game.lastStandings.filter((entry) => entry.id !== 'player' && !entry.finished).length).toBeGreaterThan(0);
  const frozenTime = game.race!.director.time;
  game.tick(2000);
  expect(game.phase).toBe('results');
  expect(game.race!.director.time).toBe(frozenTime);
  game.dispose();
});

it('restart returns to countdown and clears stale race state', () => {
  const game = freshGame();
  game.startQuickRace('city', 'starter');
  expect(game.phase).toBe('countdown');
  const gridPosition = { ...game.race!.vehicles.get('player')!.position };
  game.tick(4000);
  expect(game.phase).toBe('racing');
  game.pause();
  expect(game.phase).toBe('paused');
  game.restart();
  expect(game.phase).toBe('countdown');
  expect(game.race!.director.phase).toBe('countdown');
  expect(game.race!.director.time).toBe(0);
  const player = game.race!.vehicles.get('player')!;
  expect(player.speed).toBe(0);
  expect(player.driftScore).toBe(0);
  expect(player.position.x).toBeCloseTo(gridPosition.x, 3);
  expect(player.position.z).toBeCloseTo(gridPosition.z, 3);
  game.tick(4000);
  expect(game.phase).toBe('racing');
  game.dispose();
});

it('backToMenu disposes the active race and stale ticks stay in the menu', () => {
  const game = freshGame();
  game.startQuickRace('coast', 'starter');
  game.tick(4000);
  expect(game.phase).toBe('racing');
  game.backToMenu();
  expect(game.phase).toBe('menu');
  expect(game.race).toBeNull();
  game.tick(4000);
  expect(game.phase).toBe('menu');
  game.startQuickRace('mountain', 'starter');
  expect(game.phase).toBe('countdown');
  game.tick(4000);
  expect(game.phase).toBe('racing');
  game.dispose();
});

it('persists a completed career event and rewards in the save', () => {
  seedCompletedEvents(['cup-1-event-1']);
  const game = freshGame();
  game.startCareerEvent('cup-1', 'cup-1-event-2');
  expect(game.phase).toBe('countdown');
  runUntilPlayerFinish(game, 3 * 60_000);
  expect(game.phase).toBe('results');
  const stored = JSON.parse(localStorage.getItem(SAVE_STORAGE_KEY)!) as {
    completedEvents: string[];
    currency: number;
  };
  expect(stored.completedEvents).toContain('cup-1-event-1');
  expect(stored.completedEvents).toContain('cup-1-event-2');
  expect(stored.currency).toBeGreaterThan(0);
  game.dispose();
});

it('starts a quick race with the track selected in the menu', () => {
  document.body.textContent = '';
  for (const id of ['menu', 'hud', 'settings', 'pause', 'results', 'touch-controls', 'toast']) {
    const node = document.createElement('div');
    node.id = id;
    document.body.appendChild(node);
  }
  const ui = new UiController();
  const started: string[] = [];
  ui.bindActions({
    startQuickRace: (trackId) => {
      started.push(trackId);
    },
    startCareer: () => undefined,
    resume: () => undefined,
    restart: () => undefined,
    backToMenu: () => undefined,
    pause: () => undefined,
    changeCamera: () => undefined,
    setQuality: () => undefined,
    setCameraMode: () => undefined,
    setControlMode: () => undefined,
    setAudioVolume: () => undefined,
    setMuted: () => undefined,
    startCareerEvent: () => undefined,
    selectVehicle: () => undefined,
    purchaseUpgrade: () => undefined,
    equipCosmetic: () => undefined,
  });
  const quickRace = document.getElementById('menu-quick-race')!;
  quickRace.dispatchEvent(new Event('click'));
  expect(started).toEqual(['city']);
  document.getElementById('menu-track-coast')!.dispatchEvent(new Event('click'));
  expect(document.getElementById('menu-track-coast')!.classList.contains('ui-selected')).toBe(true);
  expect(document.getElementById('menu-track-city')!.classList.contains('ui-selected')).toBe(false);
  quickRace.dispatchEvent(new Event('click'));
  expect(started).toEqual(['city', 'coast']);
  ui.destroy();
  document.body.textContent = '';
});

it('falls back to the selected owned vehicle when a quick race asks for an unowned one', () => {
  document.body.textContent = '';
  for (const id of ['menu', 'hud', 'settings', 'pause', 'results', 'touch-controls', 'toast']) {
    const node = document.createElement('div');
    node.id = id;
    document.body.appendChild(node);
  }
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = {
    scene: new THREE.Scene(),
    lights: {
      hemisphere: new THREE.HemisphereLight(0x9db4d6, 0x2a3340, 0.85),
      sun: new THREE.DirectionalLight(0xeaf1ff, 1.0),
    },
    resize: () => undefined,
    setQuality: () => undefined,
    updateShadowTarget: () => undefined,
    render: () => undefined,
    dispose: () => undefined,
  } as unknown as Renderer;
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const save = new SaveService();
  save.reset();
  try {
    const ui = new UiController();
    const game = createGame({ canvas, renderer, ui, audio: new AudioEngine(), save }) as unknown as TestGame;
    game.startQuickRace('city', 'apex');
    expect(game.phase).toBe('countdown');
    const playerConfig = game.race!.configs.get('player')!;
    expect(playerConfig.baseSpeed).toBeCloseTo(48, 1);
    expect(playerConfig.baseSpeed).not.toBeCloseTo(82, 1);
    game.dispose();
    ui.destroy();
  } finally {
    vi.unstubAllGlobals();
    document.body.textContent = '';
  }
});

describe('browser frame delta clamp', () => {
  it('clamps frame deltas at FRAME_DELTA_CLAMP_MS', () => {
    expect(clampFrameDelta(16.7)).toBeCloseTo(16.7);
    expect(clampFrameDelta(FRAME_DELTA_CLAMP_MS)).toBe(FRAME_DELTA_CLAMP_MS);
    expect(clampFrameDelta(5_000)).toBe(FRAME_DELTA_CLAMP_MS);
    expect(clampFrameDelta(0)).toBe(0);
    expect(clampFrameDelta(-4)).toBe(0);
    expect(clampFrameDelta(Number.NaN)).toBe(0);
  });

  it('a huge frame delta from a backgrounded tab cannot advance the simulation beyond the clamp', () => {
    document.body.textContent = '';
    for (const id of ['menu', 'hud', 'settings', 'pause', 'results', 'touch-controls', 'toast']) {
      const node = document.createElement('div');
      node.id = id;
      document.body.appendChild(node);
    }
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const renderer = {
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(62, 16 / 9),
      lights: {
        hemisphere: new THREE.HemisphereLight(0x9db4d6, 0x2a3340, 0.85),
        sun: new THREE.DirectionalLight(0xeaf1ff, 1.0),
      },
      resize: () => undefined,
      setQuality: () => undefined,
      updateShadowTarget: () => undefined,
      render: () => undefined,
      dispose: () => undefined,
    } as unknown as Renderer;
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const save = new SaveService();
    save.reset();
    const saveData = save.load();
    saveData.cosmetics = { starter: 'paint-starter-red' };
    save.save(saveData);
    try {
      const ui = new UiController();
      const game = createGame({ canvas, renderer, ui, audio: new AudioEngine(), save }) as unknown as TestGame;
      game.startQuickRace('city', 'starter');
      expect(game.phase).toBe('countdown');
      // The equipped cosmetic maps onto the player's race visuals.
      const playerView = game.views.get('player')!;
      const bodyGroup = playerView.group.children
        .filter((child): child is THREE.Group => child instanceof THREE.Group)
        .find((group) => group.children.length > 5);
      const bodyMaterial = (bodyGroup!.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      expect(bodyMaterial.color.getHex()).toBe(0xff4d4d);
      frame!(0);
      // The tab was backgrounded for five seconds: the next rAF timestamp is 5000 ms ahead.
      frame!(5_000);
      expect(game.phase).toBe('countdown');
      expect(game.race!.director.countdown).toBeGreaterThanOrEqual(3 - FRAME_DELTA_CLAMP_MS / 1000 - 1e-9);
      game.dispose();
      ui.destroy();
    } finally {
      vi.unstubAllGlobals();
      document.body.textContent = '';
    }
  });
});
