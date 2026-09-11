import { describe, expect, it } from 'vitest';
import {
  CAMERA_MODES,
  CONTROL_MODES,
  GAME_PHASES,
  QUALITY_PRESETS,
} from '../src/types';

describe('shared contracts', () => {
  it('defines every required game phase', () => {
    expect(GAME_PHASES).toEqual(['menu', 'countdown', 'racing', 'paused', 'results']);
  });

  it('defines every required quality and input mode', () => {
    expect(QUALITY_PRESETS).toEqual(['auto', 'low', 'medium', 'high', 'ultra']);
    expect(CONTROL_MODES).toEqual(['keyboard', 'touch', 'tilt']);
    expect(CAMERA_MODES).toEqual(['chase', 'hood', 'cinematic']);
  });
});
