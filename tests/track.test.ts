import { describe, expect, it } from 'vitest';
import { TrackModel } from '../src/track/TrackModel';
import { tracks } from '../src/config/tracks';

describe('TrackModel', () => {
  it('creates a closed sampled loop', () => {
    const config = tracks[0]!;
    const track = new TrackModel(config);
    expect(track.length).toBeGreaterThan(100);
    expect(track.sampleAt(0).point).toEqual(track.sampleAt(track.length).point);
  });

  it('projects a centerline point with near-zero lateral offset', () => {
    const config = tracks[0]!;
    const track = new TrackModel(config);
    const sample = track.sampleAt(track.length * 0.25);
    const projection = track.project(sample.point);
    expect(Math.abs(projection.lateral)).toBeLessThan(0.01);
  });
});
