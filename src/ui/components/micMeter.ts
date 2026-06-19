// micMeter — PURE mapping from a single smoothed input level to the 12 "MIC CHECK"
// bars (the visual "needle" the DevicePicker caption promises). No DOM / Web Audio
// here so it's node-testable; the live level itself comes from InputLevelMonitor.
//
// Calibration deliberately mirrors the console VU meter (App.tsx VU_PROFILE) so the
// mic-check needle and the in-take VU read the same loudness the same way.

/** Per-bar weights — a gentle left-of-centre hump, matching the design `.bars`. */
export const MIC_VU_PROFILE: readonly number[] = [
  0.42, 0.62, 0.5, 0.78, 0.66, 0.9, 1, 0.82, 0.7, 0.56, 0.46, 0.36,
];

/** Faint baseline height (%) each bar rests at when the input is silent. */
export const MIC_BAR_FLOOR = 4;

/**
 * Perceptual gain applied to sqrt(level). Instrument RMS through an interface is
 * small (a strummed low E sits around ~0.1); a linear map left the meter "barely
 * moving". sqrt expands the quiet end and the gain puts a normal note near the top
 * of the scale, so the needle actually reads as a needle.
 */
export const MIC_GAIN = 2.2;

/** One rendered bar: a height percentage (0..100) and whether it's tipped hot. */
export interface MicBar {
  height: number;
  hot: boolean;
}

/** Map a smoothed input level (RMS) onto the perceptual 0..1 the meter draws. */
export function micMeterNorm(level: number): number {
  const lvl = Number.isFinite(level) && level > 0 ? level : 0;
  return Math.min(1, Math.sqrt(lvl) * MIC_GAIN);
}

/**
 * Map a smoothed input level (RMS) onto the meter bars. At silence every bar rests
 * on MIC_BAR_FLOOR (a flat line); as you play they rise into the hump and the
 * loudest profile bars tip into the flux/hot colour above a threshold. The same
 * mapping drives the console VU and the mic-check needle so the two read alike.
 */
export function micMeterBars(level: number): MicBar[] {
  const norm = micMeterNorm(level);
  return MIC_VU_PROFILE.map((p) => ({
    height: Math.max(MIC_BAR_FLOOR, Math.min(100, norm * 100 * p)),
    hot: p >= 0.95 && norm * p > 0.55,
  }));
}
