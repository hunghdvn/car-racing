import type { QualityPreset, QualitySettings } from '../types';

export interface DeviceCapabilities {
  readonly hardwareConcurrency: number;
  readonly maxTouchPoints: number;
}

export type QualityLevel = Exclude<QualityPreset, 'auto'>;

export const PRESET_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export const PRESET_MATRIX: Readonly<
  Record<QualityLevel, Omit<QualitySettings, 'preset' | 'adaptiveEnabled'>>
> = {
  low: {
    resolutionScale: 0.75,
    pixelRatio: 1,
    shadows: false,
    antiAliasing: false,
    textureQuality: 'low',
    particleBudget: 250,
    propDensity: 0.5,
    postProcessing: false,
  },
  medium: {
    resolutionScale: 1,
    pixelRatio: 1.5,
    shadows: true,
    antiAliasing: true,
    textureQuality: 'medium',
    particleBudget: 500,
    propDensity: 1,
    postProcessing: false,
  },
  high: {
    resolutionScale: 1,
    pixelRatio: 1.5,
    shadows: true,
    antiAliasing: true,
    textureQuality: 'high',
    particleBudget: 900,
    propDensity: 1,
    postProcessing: true,
  },
  ultra: {
    resolutionScale: 1,
    pixelRatio: 2,
    shadows: true,
    antiAliasing: true,
    textureQuality: 'high',
    particleBudget: 1500,
    propDensity: 1,
    postProcessing: true,
  },
};

const WINDOW_FRAMES = 60;
const SLOW_TARGET_FPS = 50;
const FAST_TARGET_FPS = 58;
const DOWNGRADE_SECONDS = 3;
const UPGRADE_SECONDS = 10;

export function defaultCapabilities(): DeviceCapabilities {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    hardwareConcurrency: nav?.hardwareConcurrency || 4,
    maxTouchPoints: nav?.maxTouchPoints || 0,
  };
}

export function isConstrainedDevice(capabilities: DeviceCapabilities): boolean {
  const cores = Number.isFinite(capabilities.hardwareConcurrency)
    ? capabilities.hardwareConcurrency
    : 4;
  if (cores <= 4) return true;
  return capabilities.maxTouchPoints > 0 && cores <= 6;
}

function levelIndex(level: QualityLevel): number {
  return PRESET_LEVELS.indexOf(level);
}

function defaultLevel(capabilities: DeviceCapabilities): QualityLevel {
  return isConstrainedDevice(capabilities) ? 'low' : 'medium';
}

function buildSettings(
  preset: QualityPreset,
  level: QualityLevel,
  adaptiveEnabled: boolean,
): QualitySettings {
  return { ...PRESET_MATRIX[level], preset, adaptiveEnabled };
}

export class QualityManager {
  private readonly onApply: (settings: QualitySettings) => void;
  private selection: QualityPreset = 'auto';
  private adaptive = false;
  private maxLevel: QualityLevel = 'medium';
  private level: QualityLevel = 'medium';
  private active: QualitySettings = buildSettings('auto', 'medium', false);
  private readonly frames: number[] = new Array<number>(WINDOW_FRAMES).fill(0);
  private frameHead = 0;
  private frameCount = 0;
  private frameSum = 0;
  private secondMs = 0;
  private slowSeconds = 0;
  private fastSeconds = 0;

  constructor(
    preset: QualityPreset = 'auto',
    capabilities: DeviceCapabilities = defaultCapabilities(),
    onApply: (settings: QualitySettings) => void = () => {},
  ) {
    this.onApply = onApply;
    this.applyPreset(preset, capabilities);
  }

  get adaptiveEnabled(): boolean {
    return this.adaptive;
  }

  get settings(): QualitySettings {
    return this.active;
  }

  applyPreset(preset: QualityPreset, capabilities: DeviceCapabilities): void {
    this.selection = preset;
    this.adaptive = preset === 'auto';
    this.level = preset === 'auto' ? defaultLevel(capabilities) : preset;
    this.maxLevel = preset === 'auto' ? 'ultra' : preset;
    this.frameHead = 0;
    this.frameCount = 0;
    this.frameSum = 0;
    this.secondMs = 0;
    this.slowSeconds = 0;
    this.fastSeconds = 0;
    this.active = buildSettings(preset, this.level, this.adaptive);
    this.onApply(this.active);
  }

  recordFrame(deltaMs: number): void {
    if (!this.adaptive || deltaMs <= 0) return;
    this.pushFrame(deltaMs);
    this.secondMs += deltaMs;
    while (this.secondMs >= 1000) {
      this.secondMs -= 1000;
      this.evaluateSecond();
    }
  }

  recommendPreset(): QualityPreset {
    return this.level;
  }

  private pushFrame(deltaMs: number): void {
    const slot = this.frameHead;
    if (this.frameCount === WINDOW_FRAMES) {
      this.frameSum -= this.frames[slot]!;
    } else {
      this.frameCount += 1;
    }
    this.frames[slot] = deltaMs;
    this.frameHead = (slot + 1) % WINDOW_FRAMES;
    this.frameSum += deltaMs;
  }

  private averageFrameMs(): number {
    if (this.frameCount === 0) return 0;
    return this.frameSum / this.frameCount;
  }

  private evaluateSecond(): void {
    if (this.frameCount === 0) return;
    const fps = 1000 / this.averageFrameMs();
    if (fps < SLOW_TARGET_FPS) {
      this.slowSeconds += 1;
      this.fastSeconds = 0;
      if (this.slowSeconds >= DOWNGRADE_SECONDS) this.settle(this.step(this.level, -1));
    } else if (fps > FAST_TARGET_FPS) {
      this.fastSeconds += 1;
      this.slowSeconds = 0;
      if (this.fastSeconds >= UPGRADE_SECONDS) this.settle(this.step(this.level, 1));
    } else {
      this.slowSeconds = 0;
      this.fastSeconds = 0;
    }
  }

  private step(level: QualityLevel, direction: -1 | 1): QualityLevel {
    const max = levelIndex(this.maxLevel);
    const target = Math.max(0, Math.min(max, levelIndex(level) + direction));
    return PRESET_LEVELS[target] ?? 'medium';
  }

  private settle(level: QualityLevel): void {
    this.slowSeconds = 0;
    this.fastSeconds = 0;
    if (level === this.level) return;
    this.level = level;
    this.active = buildSettings(this.selection, level, this.adaptive);
    this.onApply(this.active);
  }
}
