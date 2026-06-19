// lineConfig.ts — UI-side default config + fresh-line generation.
//
// Disposable UI layer (brief sections 2, 5). This is the ONE place the UI is EXEMPT
// from the seeded-PRNG / clock-free rules: it may pick a fresh random seed per line
// and read the real wall-clock for the generatedAt ISO string. The generator itself
// stays deterministic (seed + generatedAt are INJECTED, never read inside it).

import {
  FOUR_FOUR,
  makeNeckPosition,
  type Key,
  type NeckPosition,
  type Line,
} from '../domain/index.js';
import { generateLine, type LineConfig } from '../generator/index.js';

/** A small menu of keys for the config panel (functional, not exhaustive). */
export const KEY_CHOICES: ReadonlyArray<{ label: string; key: Key }> = [
  { label: 'C major', key: { tonic: { name: 'C', accidental: 'natural' }, mode: 'major' } },
  { label: 'G major', key: { tonic: { name: 'G', accidental: 'natural' }, mode: 'major' } },
  { label: 'D major', key: { tonic: { name: 'D', accidental: 'natural' }, mode: 'major' } },
  { label: 'F major', key: { tonic: { name: 'F', accidental: 'natural' }, mode: 'major' } },
  { label: 'A minor', key: { tonic: { name: 'A', accidental: 'natural' }, mode: 'minor' } },
  { label: 'E minor', key: { tonic: { name: 'E', accidental: 'natural' }, mode: 'minor' } },
];

/** A small menu of neck positions (string range full neck; fret windows). */
export const POSITION_CHOICES: ReadonlyArray<{ label: string; position: NeckPosition }> = [
  { label: 'Open (0-4)', position: makeNeckPosition(1, 6, 0, 4, 'Open') },
  { label: 'II (1-5)', position: makeNeckPosition(1, 6, 1, 5, 'II') },
  { label: 'V (4-8)', position: makeNeckPosition(1, 6, 4, 8, 'V') },
  { label: 'VII (6-10)', position: makeNeckPosition(1, 6, 6, 10, 'VII') },
];

/** The editable, UI-facing config (subset surfaced in the panel; rest defaulted). */
export interface UiConfig {
  keyIndex: number;
  positionIndex: number;
  barCount: number;
  tempo: number;
}

/** Sensible defaults (brief section 3: 4 bars, default config). */
export const DEFAULT_UI_CONFIG: UiConfig = {
  keyIndex: 0, // C major
  positionIndex: 2, // V position (4-8)
  barCount: 4,
  tempo: 120,
};

/** Rebuild a UiConfig from the persisted (possibly partial or stale) config,
 *  falling back to DEFAULT_UI_CONFIG for any missing or out-of-range field. This
 *  is how the practice config "remembers" its last-used values across launches:
 *  the App seeds uiConfig from this on mount. Indices are clamped to the current
 *  KEY_CHOICES / POSITION_CHOICES length, and tempo/bars to the stepper bounds, so
 *  a config written by an older/newer build never selects a missing option. */
export function hydrateUiConfig(saved: {
  tempo?: number;
  keyIndex?: number;
  positionIndex?: number;
  barCount?: number;
}): UiConfig {
  const idx = (v: number | undefined, len: number, fallback: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < len ? v : fallback;
  const num = (
    v: number | undefined,
    lo: number,
    hi: number,
    fallback: number,
  ): number =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.round(Math.min(hi, Math.max(lo, v)))
      : fallback;
  return {
    keyIndex: idx(saved.keyIndex, KEY_CHOICES.length, DEFAULT_UI_CONFIG.keyIndex),
    positionIndex: idx(
      saved.positionIndex,
      POSITION_CHOICES.length,
      DEFAULT_UI_CONFIG.positionIndex,
    ),
    barCount: num(saved.barCount, 2, 16, DEFAULT_UI_CONFIG.barCount),
    tempo: num(saved.tempo, 30, 300, DEFAULT_UI_CONFIG.tempo),
  };
}

/** Turn the UI config into a generator LineConfig. */
export function toLineConfig(ui: UiConfig): LineConfig {
  const key = KEY_CHOICES[ui.keyIndex]?.key ?? KEY_CHOICES[0]!.key;
  const position =
    POSITION_CHOICES[ui.positionIndex]?.position ?? POSITION_CHOICES[0]!.position;
  return {
    key,
    timeSignature: FOUR_FOUR,
    position,
    tempo: ui.tempo,
    barCount: ui.barCount,
    difficulty: 2,
    accidentalsDensity: 'low',
  };
}

/** Pick a fresh 32-bit seed (UI may use Math.random — only the generator is banned). */
export function freshSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/** Generate a brand-new line from the UI config with a fresh seed + current timestamp. */
export function generateFreshLine(ui: UiConfig): Line {
  const config = toLineConfig(ui);
  const seed = freshSeed();
  const generatedAt = new Date().toISOString();
  const line = generateLine(config, seed, generatedAt, {
    onTelemetry: (t) =>
      console.log(
        `[UI] generated line: seed=${seed} attempts=${t.attemptsUsed} ` +
          `fallback=${t.usedFallback}`,
      ),
  });
  console.log(
    `[UI] new line ${line.id}: key=${ui.keyIndex} pos=${ui.positionIndex} ` +
      `bars=${line.barCount} tempo=${line.tempo} notes=${line.notes.length}`,
  );
  return line;
}
