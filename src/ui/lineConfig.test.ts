// Tests for hydrateUiConfig — the PURE "remember last-used" merge that rebuilds a
// UiConfig from the persisted (possibly partial / stale) config, falling back to
// DEFAULT_UI_CONFIG and clamping indices/numbers so a config written by another
// build never selects a missing option. No DOM / persistence here.

import { describe, it, expect } from 'vitest';
import {
  hydrateUiConfig,
  DEFAULT_UI_CONFIG,
  KEY_CHOICES,
  POSITION_CHOICES,
} from './lineConfig.js';

describe('hydrateUiConfig', () => {
  it('falls back to defaults for an empty config', () => {
    expect(hydrateUiConfig({})).toEqual(DEFAULT_UI_CONFIG);
  });

  it('keeps valid persisted values', () => {
    const saved = { keyIndex: 1, positionIndex: 3, barCount: 8, tempo: 90 };
    expect(hydrateUiConfig(saved)).toEqual(saved);
  });

  it('merges partial configs (missing fields use defaults)', () => {
    expect(hydrateUiConfig({ tempo: 200 })).toEqual({
      ...DEFAULT_UI_CONFIG,
      tempo: 200,
    });
  });

  it('clamps out-of-range key/position indices to defaults', () => {
    const out = hydrateUiConfig({
      keyIndex: KEY_CHOICES.length, // one past the end
      positionIndex: -1,
    });
    expect(out.keyIndex).toBe(DEFAULT_UI_CONFIG.keyIndex);
    expect(out.positionIndex).toBe(DEFAULT_UI_CONFIG.positionIndex);
  });

  it('clamps tempo + bar count to the stepper bounds', () => {
    expect(hydrateUiConfig({ tempo: 1000 }).tempo).toBe(300);
    expect(hydrateUiConfig({ tempo: 1 }).tempo).toBe(30);
    expect(hydrateUiConfig({ barCount: 99 }).barCount).toBe(16);
    expect(hydrateUiConfig({ barCount: 0 }).barCount).toBe(2);
  });

  it('rejects non-integer / non-finite values', () => {
    expect(hydrateUiConfig({ keyIndex: 1.5 }).keyIndex).toBe(
      DEFAULT_UI_CONFIG.keyIndex,
    );
    expect(hydrateUiConfig({ tempo: Number.NaN }).tempo).toBe(
      DEFAULT_UI_CONFIG.tempo,
    );
    expect(
      hydrateUiConfig({ positionIndex: Number.POSITIVE_INFINITY }).positionIndex,
    ).toBe(DEFAULT_UI_CONFIG.positionIndex);
  });

  it('only emits valid indices into the choice arrays', () => {
    const out = hydrateUiConfig({ keyIndex: 999, positionIndex: 999 });
    expect(KEY_CHOICES[out.keyIndex]).toBeDefined();
    expect(POSITION_CHOICES[out.positionIndex]).toBeDefined();
  });
});
