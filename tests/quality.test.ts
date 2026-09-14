import { expect, it } from 'vitest';
import {
  PRESET_LEVELS,
  PRESET_MATRIX,
  QualityManager,
  type DeviceCapabilities,
} from '../src/quality/QualityManager';
import type { QualitySettings } from '../src/types';

const desktop: DeviceCapabilities = { hardwareConcurrency: 8, maxTouchPoints: 0 };
const phone: DeviceCapabilities = { hardwareConcurrency: 4, maxTouchPoints: 5 };

it('lowers resolution when sustained FPS is below target', () => {
  const manager = new QualityManager('auto');
  for (let i = 0; i < 180; i++) manager.recordFrame(28);
  expect(manager.recommendPreset()).toBe('low');
});

it('keeps auto at the default level before slow frames persist', () => {
  const manager = new QualityManager('auto', desktop);
  for (let i = 0; i < 60; i++) manager.recordFrame(28);
  expect(manager.recommendPreset()).toBe('medium');
});

it('starts auto one step lower on a constrained device and never goes below low', () => {
  const manager = new QualityManager('auto', phone);
  expect(manager.recommendPreset()).toBe('low');
  for (let i = 0; i < 400; i++) manager.recordFrame(28);
  expect(manager.recommendPreset()).toBe('low');
});

it('upgrades after ten fast seconds and stays at the ultra cap', () => {
  const manager = new QualityManager('auto', desktop);
  for (let i = 0; i < 1000; i++) manager.recordFrame(10);
  expect(manager.recommendPreset()).toBe('high');
  for (let i = 0; i < 1000; i++) manager.recordFrame(10);
  expect(manager.recommendPreset()).toBe('ultra');
});

it('keeps a fixed preset without adapting', () => {
  const manager = new QualityManager('high', desktop);
  for (let i = 0; i < 500; i++) manager.recordFrame(40);
  expect(manager.recommendPreset()).toBe('high');
  expect(manager.adaptiveEnabled).toBe(false);
  expect(manager.settings.shadows).toBe(true);
});

it('resets adaptation state when a new preset is applied', () => {
  const manager = new QualityManager('auto', desktop);
  for (let i = 0; i < 100; i++) manager.recordFrame(28);
  manager.applyPreset('ultra', desktop);
  expect(manager.recommendPreset()).toBe('ultra');
  expect(manager.adaptiveEnabled).toBe(false);
  for (let i = 0; i < 300; i++) manager.recordFrame(28);
  expect(manager.recommendPreset()).toBe('ultra');
});

it('publishes settings through the apply callback when the preset changes', () => {
  const applied: QualitySettings[] = [];
  const manager = new QualityManager('auto', desktop, (settings) => applied.push(settings));
  expect(applied).toHaveLength(1);
  expect(applied[0]?.preset).toBe('auto');
  expect(applied[0]?.adaptiveEnabled).toBe(true);
  expect(applied[0]?.resolutionScale).toBe(1);
  expect(applied[0]?.shadows).toBe(true);
  for (let i = 0; i < 180; i++) manager.recordFrame(28);
  expect(applied).toHaveLength(2);
  expect(applied[1]?.resolutionScale).toBe(0.75);
  expect(applied[1]?.shadows).toBe(false);
  expect(applied[1]?.postProcessing).toBe(false);
});

it('maps every preset level to the documented resolution and effect profile', () => {
  expect(PRESET_LEVELS).toEqual(['low', 'medium', 'high', 'ultra']);
  expect(PRESET_MATRIX.low).toMatchObject({
    resolutionScale: 0.75,
    shadows: false,
    postProcessing: false,
  });
  expect(PRESET_MATRIX.medium.resolutionScale).toBe(1);
  expect(PRESET_MATRIX.high.pixelRatio).toBe(1.5);
  expect(PRESET_MATRIX.ultra).toMatchObject({
    pixelRatio: 2,
    shadows: true,
    antiAliasing: true,
    textureQuality: 'high',
    postProcessing: true,
  });
});
