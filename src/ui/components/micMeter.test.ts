// Tests for the PURE mic-check meter mapping (no DOM / Web Audio). Maps a single
// smoothed input level (0..1, the live RMS the InputLevelMonitor produces) onto
// the 12 "MIC CHECK" bars — the visual "needle" the card promises. Calibration
// mirrors the console VU meter (App.tsx VU_PROFILE) so the two read the same.

import { describe, it, expect } from 'vitest';
import { MIC_VU_PROFILE, MIC_BAR_FLOOR, micMeterBars } from './micMeter.js';

describe('micMeterBars', () => {
  it('returns one bar per profile weight', () => {
    expect(micMeterBars(0.3)).toHaveLength(MIC_VU_PROFILE.length);
  });

  it('rests on the floor with no bar hot at silence', () => {
    const bars = micMeterBars(0);
    expect(bars.every((b) => b.height === MIC_BAR_FLOOR)).toBe(true);
    expect(bars.some((b) => b.hot)).toBe(false);
  });

  it('treats negative / non-finite levels as silence (no NaN heights)', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bars = micMeterBars(bad);
      expect(bars.every((b) => b.height === MIC_BAR_FLOOR)).toBe(true);
      expect(bars.every((b) => b.hot === false)).toBe(true);
    }
  });

  it('rises monotonically with level and clamps each bar at 100', () => {
    const quiet = micMeterBars(0.02);
    const loud = micMeterBars(0.3);
    for (let i = 0; i < MIC_VU_PROFILE.length; i++) {
      expect(loud[i].height).toBeGreaterThanOrEqual(quiet[i].height);
      expect(loud[i].height).toBeLessThanOrEqual(100);
    }
  });

  it('lifts a normal note well off the floor (was "barely moving")', () => {
    // A typical strummed note (~0.1 RMS) should read as a clear needle, not a nub.
    const peakIdx = MIC_VU_PROFILE.indexOf(Math.max(...MIC_VU_PROFILE));
    expect(micMeterBars(0.1)[peakIdx].height).toBeGreaterThan(50);
  });

  it('tips the loudest profile bars into "hot" only on strong input', () => {
    // p>=0.95 bars only — a near-silent signal lights no bar hot, a loud one does.
    expect(micMeterBars(0.004).some((b) => b.hot)).toBe(false);
    const loud = micMeterBars(0.9);
    const peakIdx = MIC_VU_PROFILE.indexOf(Math.max(...MIC_VU_PROFILE));
    expect(loud[peakIdx].hot).toBe(true);
    // a low-weight bar never goes hot, however loud.
    const minIdx = MIC_VU_PROFILE.indexOf(Math.min(...MIC_VU_PROFILE));
    expect(micMeterBars(1).every((b, i) => (i === minIdx ? !b.hot : true))).toBe(true);
  });
});
