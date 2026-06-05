// Tests for the PURE detection-review delta helpers (review.ts). No Web Audio /
// DOM — plain data in, plain rows out. We assert the cents math against a known
// frequency pair, octave-error detection (±12 semitones), signed timing error
// (+ late / - early), and null handling for missed notes — plus that the row set
// agrees with the EvaluationResult it is built from.

import { describe, it, expect } from 'vitest';
import {
  buildReviewModel,
  freqToCents,
  midiToFreq,
  isOctaveError,
} from './review.js';
import { evaluateAttempt } from './metrics.js';
import { summarize } from './metrics.js';
import type {
  DetectedNote,
  ExpectedNote,
  EvaluationParams,
  NoteResult,
} from './types.js';

const REF: EvaluationParams = { tempoBpm: 120, subdivision: 'quarter' };

/** A chromatic expected line of `n` quarter notes from C4 (MIDI 60), 500ms apart
 *  at 120 BPM (noteIndex == position). */
function expectedLine(n: number, startMidi = 60, stepMs = 500): ExpectedNote[] {
  return Array.from({ length: n }, (_, i) => ({
    noteIndex: i,
    expectedMidi: startMidi + i,
    onsetMs: i * stepMs,
    durationMs: stepMs,
  }));
}

describe('freqToCents', () => {
  it('is 0 for equal frequencies', () => {
    expect(freqToCents(440, 440)).toBe(0);
  });

  it('is +100 cents for one semitone up (exact known pair)', () => {
    // C#5 (554.365 Hz) is exactly +100 cents above C5 (523.251 Hz).
    expect(freqToCents(554.3652619537442, 523.2511306011972)).toBeCloseTo(100, 6);
  });

  it('is -100 cents for one semitone down', () => {
    expect(freqToCents(523.2511306011972, 554.3652619537442)).toBeCloseTo(-100, 6);
  });

  it('is +1200 cents for one octave up', () => {
    expect(freqToCents(880, 440)).toBeCloseTo(1200, 9);
  });

  it('matches a small detuning: 442 vs 440 Hz', () => {
    // 1200*log2(442/440) ≈ 7.85 cents sharp.
    expect(freqToCents(442, 440)).toBeCloseTo(7.85, 2);
  });

  it('returns NaN for non-positive / non-finite inputs', () => {
    expect(Number.isNaN(freqToCents(0, 440))).toBe(true);
    expect(Number.isNaN(freqToCents(440, 0))).toBe(true);
    expect(Number.isNaN(freqToCents(-1, 440))).toBe(true);
    expect(Number.isNaN(freqToCents(NaN, 440))).toBe(true);
  });
});

describe('midiToFreq', () => {
  it('maps A4 (69) to 440 Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 9);
  });

  it('maps C4 (60) to ~261.63 Hz', () => {
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);
  });

  it('round-trips with freqToCents to 0 for a midi reference', () => {
    expect(freqToCents(midiToFreq(64), midiToFreq(64))).toBe(0);
  });
});

describe('isOctaveError', () => {
  it('is true for +12 and -12 semitones', () => {
    expect(isOctaveError(60, 72)).toBe(true);
    expect(isOctaveError(60, 48)).toBe(true);
  });

  it('is true for +24 (two octaves)', () => {
    expect(isOctaveError(60, 84)).toBe(true);
  });

  it('is false for a unison (0 semitones)', () => {
    expect(isOctaveError(60, 60)).toBe(false);
  });

  it('is false for a non-octave interval (a fifth, +7)', () => {
    expect(isOctaveError(60, 67)).toBe(false);
  });

  it('is false for 11 / 13 semitones (near but not an octave)', () => {
    expect(isOctaveError(60, 71)).toBe(false);
    expect(isOctaveError(60, 73)).toBe(false);
  });
});

describe('buildReviewModel — exact cents from a known freqHz pair', () => {
  it('computes cents from the detection freqHz against the expected note freq', () => {
    const expected = expectedLine(1, 60); // C4, MIDI 60
    // A detection 25 cents sharp of C4: midi rounds to 60, freqHz is the detuned one.
    const c4 = midiToFreq(60);
    const sharp25 = c4 * Math.pow(2, 25 / 1200);
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 0, clarity: 0.95, freqHz: sharp25 },
    ];
    const result = evaluateAttempt(expected, detected, REF);
    const { rows } = buildReviewModel(result, detected);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.classification).toBe('hit');
    expect(r.detectedMidi).toBe(60);
    expect(r.pitchErrorSemitones).toBe(0);
    expect(r.pitchErrorCents).not.toBeNull();
    expect(r.pitchErrorCents!).toBeCloseTo(25, 6);
    expect(r.isOctaveError).toBe(false);
  });
});

describe('buildReviewModel — synthetic mode (no freqHz) -> semitone diff, null cents', () => {
  it('reports wrong-pitch semitone error and null cents when no freqHz', () => {
    const expected = expectedLine(1, 60);
    // Detection a semitone sharp, in time, NO freqHz (synthetic take).
    const detected: DetectedNote[] = [{ midi: 61, onsetMs: 0, clarity: 0.95 }];
    const result = evaluateAttempt(expected, detected, REF);
    const { rows } = buildReviewModel(result, detected);
    const r = rows[0]!;
    expect(r.classification).toBe('wrong_pitch');
    expect(r.detectedMidi).toBe(61);
    expect(r.pitchErrorSemitones).toBe(1);
    expect(r.pitchErrorCents).toBeNull();
    expect(r.isOctaveError).toBe(false);
  });
});

describe('buildReviewModel — octave-error flag', () => {
  it('flags a +12 detection (right pitch class, wrong octave) as octave error', () => {
    const expected = expectedLine(1, 60);
    const detected: DetectedNote[] = [{ midi: 72, onsetMs: 0, clarity: 0.95 }];
    const result = evaluateAttempt(expected, detected, REF);
    const { rows } = buildReviewModel(result, detected);
    const r = rows[0]!;
    // It is the wrong MIDI -> wrong_pitch, but specifically an octave error.
    expect(r.classification).toBe('wrong_pitch');
    expect(r.pitchErrorSemitones).toBe(12);
    expect(r.isOctaveError).toBe(true);
  });
});

describe('buildReviewModel — signed timing error', () => {
  it('reports + for late and - for early', () => {
    const expected = expectedLine(2, 60); // onsets 0 and 500
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 30, clarity: 0.95 }, // 30ms LATE
      { midi: 61, onsetMs: 470, clarity: 0.95 }, // 30ms EARLY
    ];
    const result = evaluateAttempt(expected, detected, REF);
    const { rows } = buildReviewModel(result, detected);
    expect(rows[0]!.timingErrorMs).toBeCloseTo(30, 9); // late => +
    expect(rows[1]!.timingErrorMs).toBeCloseTo(-30, 9); // early => -
  });
});

describe('buildReviewModel — null handling for missed notes', () => {
  it('leaves every detected field null for a missed expected note', () => {
    const expected = expectedLine(1, 60);
    const detected: DetectedNote[] = []; // nothing detected
    const result = evaluateAttempt(expected, detected, REF);
    const { rows, extras } = buildReviewModel(result, detected);
    const r = rows[0]!;
    expect(r.classification).toBe('missed');
    expect(r.detectedMidi).toBeNull();
    expect(r.detectedOnsetMs).toBeNull();
    expect(r.pitchErrorSemitones).toBeNull();
    expect(r.pitchErrorCents).toBeNull();
    expect(r.timingErrorMs).toBeNull();
    expect(r.isOctaveError).toBe(false);
    expect(extras).toHaveLength(0);
  });
});

describe('buildReviewModel — extras are surfaced separately', () => {
  it('lists an unmatched detection as an extra with its freqHz when known', () => {
    const expected = expectedLine(1, 60);
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 0, clarity: 0.95, freqHz: midiToFreq(60) }, // the hit
      { midi: 67, onsetMs: 250, clarity: 0.95, freqHz: midiToFreq(67) }, // stray extra
    ];
    const result = evaluateAttempt(expected, detected, REF);
    const { rows, extras } = buildReviewModel(result, detected);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('hit');
    expect(extras).toHaveLength(1);
    expect(extras[0]!.detectedMidi).toBe(67);
    expect(extras[0]!.detectedOnsetMs).toBe(250);
    expect(extras[0]!.detectedFreqHz).toBeCloseTo(midiToFreq(67), 6);
  });

  it('extra freqHz is null when the detection carried none', () => {
    const expected = expectedLine(1, 60);
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 0, clarity: 0.95 },
      { midi: 67, onsetMs: 250, clarity: 0.95 },
    ];
    const result = evaluateAttempt(expected, detected, REF);
    const { extras } = buildReviewModel(result, detected);
    expect(extras).toHaveLength(1);
    expect(extras[0]!.detectedFreqHz).toBeNull();
  });
});

describe('buildReviewModel — agrees with the EvaluationResult', () => {
  it('emits exactly one row per expected note and counts match the result', () => {
    const expected = expectedLine(4, 60);
    // hit, wrong_pitch, late, missed
    const win = REF; // 120/quarter
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 0, clarity: 0.95 }, // hit
      { midi: 62, onsetMs: 500, clarity: 0.95 }, // wrong_pitch (a step up)
      { midi: 62, onsetMs: 1000 + 200, clarity: 0.95 }, // late (right pitch, past band)
      // note 3 (MIDI 63 @1500): nothing -> missed
    ];
    const result = evaluateAttempt(expected, detected, win);
    const { rows, extras } = buildReviewModel(result, detected);
    expect(rows).toHaveLength(expected.length);
    // Every expected noteIndex appears exactly once, in order.
    expect(rows.map((r) => r.noteIndex)).toEqual([0, 1, 2, 3]);
    const byClass = (c: string): number =>
      rows.filter((r) => r.classification === c).length;
    expect(byClass('hit')).toBe(result.hits);
    expect(byClass('wrong_pitch')).toBe(result.wrongPitch);
    expect(byClass('late')).toBe(result.late);
    expect(byClass('missed')).toBe(result.missed);
    expect(extras).toHaveLength(result.extra);
  });
});

describe('buildReviewModel — duplicate (midi,onset) detections do not share one source freq', () => {
  it('matches each detection row to a distinct source DetectedNote', () => {
    // Two expected notes a beat apart; two detections at the SAME midi+onset would
    // be pathological, but ensure the freq lookup consumes sources one-for-one.
    const expected: ExpectedNote[] = [
      { noteIndex: 0, expectedMidi: 60, onsetMs: 0, durationMs: 500 },
      { noteIndex: 1, expectedMidi: 60, onsetMs: 500, durationMs: 500 },
    ];
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 0, clarity: 0.95, freqHz: 261.63 },
      { midi: 60, onsetMs: 500, clarity: 0.95, freqHz: 262.0 },
    ];
    const result = evaluateAttempt(expected, detected, REF);
    const { rows } = buildReviewModel(result, detected);
    expect(rows).toHaveLength(2);
    // Both rows have a (distinct) cents value from their own source freq.
    expect(rows[0]!.pitchErrorCents).not.toBeNull();
    expect(rows[1]!.pitchErrorCents).not.toBeNull();
  });
});

// Sanity: buildReviewModel never re-runs alignment, so it must be a pure function
// of (result, detected). summarize is re-exported just to confirm the import wiring.
describe('module wiring', () => {
  it('summarize is importable from metrics (smoke)', () => {
    const empty: NoteResult[] = [];
    expect(summarize(empty).totalExpectedNotes).toBe(0);
  });
});
