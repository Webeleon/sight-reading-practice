import { describe, it, expect } from 'vitest';
import {
  TICKS_PER_QUARTER,
  makeDuration,
  durationToTicks,
} from './duration.js';

describe('TICKS_PER_QUARTER', () => {
  it('is 480', () => {
    expect(TICKS_PER_QUARTER).toBe(480);
  });
});

describe('makeDuration / durationToTicks — brief-stated values', () => {
  it('quarter = 480', () => {
    expect(makeDuration('quarter').ticks).toBe(480);
  });
  it('dotted quarter = 720', () => {
    const d = makeDuration('quarter', 1);
    expect(d.ticks).toBe(720);
    expect(durationToTicks(d)).toBe(720);
  });
  it('triplet eighth = 160', () => {
    // an eighth (240) played in a triplet: 240 * 2/3 = 160
    const d = makeDuration('eighth', 0, { numerator: 3, denominator: 2 });
    expect(d.ticks).toBe(160);
  });
  it('sixteenth = 120', () => {
    expect(makeDuration('sixteenth').ticks).toBe(120);
  });
});

describe('base durations', () => {
  it('whole=1920 half=960 quarter=480 eighth=240 sixteenth=120 thirtySecond=60', () => {
    expect(makeDuration('whole').ticks).toBe(1920);
    expect(makeDuration('half').ticks).toBe(960);
    expect(makeDuration('quarter').ticks).toBe(480);
    expect(makeDuration('eighth').ticks).toBe(240);
    expect(makeDuration('sixteenth').ticks).toBe(120);
    expect(makeDuration('thirtySecond').ticks).toBe(60);
  });
});

describe('dots', () => {
  it('single dot adds half', () => {
    expect(makeDuration('half', 1).ticks).toBe(1440); // 960 + 480
  });
  it('double dot adds half + quarter', () => {
    expect(makeDuration('half', 2).ticks).toBe(1680); // 960 + 480 + 240
    expect(makeDuration('quarter', 2).ticks).toBe(840); // 480 + 240 + 120
  });
});

describe('tuplet', () => {
  it('quarter triplet = 320 (480 * 2/3)', () => {
    expect(makeDuration('quarter', 0, { numerator: 3, denominator: 2 }).ticks).toBe(
      320,
    );
  });
  it('preserves tuplet field on the Duration', () => {
    const d = makeDuration('eighth', 0, { numerator: 3, denominator: 2 });
    expect(d.tuplet).toEqual({ numerator: 3, denominator: 2 });
  });
  it('omits tuplet field when none given', () => {
    expect(makeDuration('quarter').tuplet).toBeUndefined();
  });
});

describe('JSON round-trip', () => {
  it('survives stringify/parse', () => {
    const d = makeDuration('eighth', 1, { numerator: 3, denominator: 2 });
    const round = JSON.parse(JSON.stringify(d));
    expect(round).toEqual(d);
  });
});
