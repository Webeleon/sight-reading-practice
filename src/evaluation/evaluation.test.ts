// Tests for the PURE evaluation pipeline (Milestone 4 acceptance gate, brief
// section 14). No Web Audio / DOM — plain data in, plain result out.
//
// We synthesise detected-note sequences against known expected lines covering
// EVERY case (all-hit, wrong_pitch, late within/beyond band, missed, extra)
// plus mixed sequences, and assert:
//   - every expected note gets EXACTLY ONE classification,
//   - extras are captured separately,
//   - pitch_accuracy and timing_accuracy compute to exact expected values,
//   - the asymmetric band admits a slightly-late note that an early-by-the-
//     same-amount note would not.

import { describe, it, expect } from 'vitest';
import {
  evaluateAttempt,
  classifyNotes,
  alignNotes,
  toleranceWindow,
  onsetToleranceMs,
  summarize,
  SUBDIVISION_TOLERANCE_FACTOR,
  EARLY_TOLERANCE_FRACTION,
  LATE_TOLERANCE_FRACTION,
  CLARITY_THRESHOLD,
} from './index.js';
import type {
  DetectedNote,
  ExpectedNote,
  EvaluationParams,
  NoteResult,
} from './index.js';

// Reference params: at 120 BPM (REFERENCE_TEMPO_BPM) on a quarter grid the
// symmetric band W == BASE_ONSET_TOLERANCE_MS == 90ms, so earlyMs = 54,
// lateMs = 126. These exact numbers make the timing assertions below concrete.
const REF: EvaluationParams = { tempoBpm: 120, subdivision: 'quarter' };
const REF_WIN = toleranceWindow(REF.tempoBpm, REF.subdivision); // {early:54, late:126, sym:90}

/** Build a chromatic expected line of `n` quarter notes starting at C4 (MIDI 60),
 *  one per beat at 120 BPM (500ms apart). noteIndex == position here. */
function expectedLine(n: number, startMidi = 60, stepMs = 500): ExpectedNote[] {
  return Array.from({ length: n }, (_, i) => ({
    noteIndex: i,
    expectedMidi: startMidi + i,
    onsetMs: i * stepMs,
    durationMs: stepMs,
  }));
}

/** Find the single result row for a given expected noteIndex. */
function rowFor(notes: NoteResult[], noteIndex: number): NoteResult {
  const matches = notes.filter((n) => n.noteIndex === noteIndex);
  expect(matches.length).toBe(1); // exactly one classification per expected note
  return matches[0]!;
}

/** Assert every expected note appears exactly once and the non-extra count
 *  equals the expected total (the "exactly one classification" invariant). */
function assertOneClassificationPerExpected(
  expected: ExpectedNote[],
  notes: NoteResult[],
): void {
  for (const e of expected) {
    const matches = notes.filter((n) => n.noteIndex === e.noteIndex);
    expect(matches.length).toBe(1);
  }
  const nonExtra = notes.filter((n) => n.classification !== 'extra');
  expect(nonExtra.length).toBe(expected.length);
}

describe('tuning windows', () => {
  it('symmetric band is exactly the base at the reference tempo/quarter grid', () => {
    expect(onsetToleranceMs(120, 'quarter')).toBeCloseTo(90, 10);
    expect(REF_WIN.symmetricMs).toBeCloseTo(90, 10);
    expect(REF_WIN.earlyMs).toBeCloseTo(54, 10);
    expect(REF_WIN.lateMs).toBeCloseTo(126, 10);
  });

  it('band shrinks with faster tempo and with finer subdivision', () => {
    expect(onsetToleranceMs(240, 'quarter')).toBeLessThan(onsetToleranceMs(120, 'quarter'));
    expect(onsetToleranceMs(60, 'quarter')).toBeGreaterThan(onsetToleranceMs(120, 'quarter'));
    expect(onsetToleranceMs(120, 'sixteenth')).toBeLessThan(
      onsetToleranceMs(120, 'eighth'),
    );
    expect(onsetToleranceMs(120, 'eighth')).toBeLessThan(onsetToleranceMs(120, 'quarter'));
    // subdivision factor applied multiplicatively
    expect(onsetToleranceMs(120, 'sixteenth')).toBeCloseTo(
      90 * SUBDIVISION_TOLERANCE_FACTOR.sixteenth,
      10,
    );
  });

  it('late tolerance exceeds early tolerance (asymmetry)', () => {
    expect(LATE_TOLERANCE_FRACTION).toBeGreaterThan(EARLY_TOLERANCE_FRACTION);
    expect(REF_WIN.lateMs).toBeGreaterThan(REF_WIN.earlyMs);
  });
});

describe('all-hit sequence', () => {
  it('classifies every note as hit; metrics are 100% / 100%', () => {
    const expected = expectedLine(4);
    const detected: DetectedNote[] = expected.map((e) => ({
      midi: e.expectedMidi,
      onsetMs: e.onsetMs, // dead on
    }));

    const result = evaluateAttempt(expected, detected, REF);
    assertOneClassificationPerExpected(expected, result.notes);
    expect(result.hits).toBe(4);
    expect(result.wrongPitch).toBe(0);
    expect(result.late).toBe(0);
    expect(result.missed).toBe(0);
    expect(result.extra).toBe(0);
    expect(result.pitchAccuracy).toBe(1);
    expect(result.timingAccuracy).toBe(1);
  });
});

describe('wrong_pitch', () => {
  it('right time, wrong pitch -> wrong_pitch; counts in neither accuracy numerator', () => {
    const expected = expectedLine(4);
    const detected: DetectedNote[] = expected.map((e, i) => ({
      midi: i === 1 ? e.expectedMidi + 5 : e.expectedMidi, // note 1 wrong
      onsetMs: e.onsetMs,
    }));

    const result = evaluateAttempt(expected, detected, REF);
    assertOneClassificationPerExpected(expected, result.notes);
    expect(rowFor(result.notes, 1).classification).toBe('wrong_pitch');
    expect(result.hits).toBe(3);
    expect(result.wrongPitch).toBe(1);
    expect(result.extra).toBe(0);
    // pitch = 3/4 (wrong_pitch excluded), timing = 3/4 (only hits)
    expect(result.pitchAccuracy).toBeCloseTo(0.75, 10);
    expect(result.timingAccuracy).toBeCloseTo(0.75, 10);
  });
});

describe('late: within vs beyond the band', () => {
  it('a detection just inside lateMs is a hit, not late', () => {
    const expected = expectedLine(1);
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: REF_WIN.lateMs - 1 }, // 125ms late, inside 126
    ];
    const result = evaluateAttempt(expected, detected, REF);
    expect(rowFor(result.notes, 0).classification).toBe('hit');
    expect(result.timingAccuracy).toBe(1);
    expect(result.pitchAccuracy).toBe(1);
  });

  it('correct pitch just beyond lateMs -> late; counts for pitch but not timing', () => {
    const expected = expectedLine(1);
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: REF_WIN.lateMs + 20 }, // 146ms late, beyond 126
    ];
    const result = evaluateAttempt(expected, detected, REF);
    assertOneClassificationPerExpected(expected, result.notes);
    const row = rowFor(result.notes, 0);
    expect(row.classification).toBe('late');
    expect(row.detectedMidi).toBe(60);
    expect(result.late).toBe(1);
    expect(result.hits).toBe(0);
    expect(result.extra).toBe(0);
    // pitch = (0 hits + 1 late)/1 = 1.0, timing = 0/1 = 0
    expect(result.pitchAccuracy).toBe(1);
    expect(result.timingAccuracy).toBe(0);
  });

  it('wrong pitch beyond the band -> missed + extra, NOT late', () => {
    const expected = expectedLine(1);
    const detected: DetectedNote[] = [
      { midi: 67, onsetMs: REF_WIN.lateMs + 20 }, // wrong pitch, well late
    ];
    const result = evaluateAttempt(expected, detected, REF);
    assertOneClassificationPerExpected(expected, result.notes);
    expect(rowFor(result.notes, 0).classification).toBe('missed');
    expect(result.late).toBe(0);
    expect(result.missed).toBe(1);
    expect(result.extra).toBe(1);
    expect(result.pitchAccuracy).toBe(0);
    expect(result.timingAccuracy).toBe(0);
  });
});

describe('missed', () => {
  it('no detection at all -> every note missed; metrics 0', () => {
    const expected = expectedLine(3);
    const result = evaluateAttempt(expected, [], REF);
    assertOneClassificationPerExpected(expected, result.notes);
    expect(result.missed).toBe(3);
    expect(result.hits).toBe(0);
    expect(result.extra).toBe(0);
    expect(result.pitchAccuracy).toBe(0);
    expect(result.timingAccuracy).toBe(0);
  });
});

describe('extra', () => {
  it('a detection with no expected counterpart is captured as extra (expected fields null)', () => {
    const expected = expectedLine(2);
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 0 }, // hit note 0
      { midi: 61, onsetMs: 500 }, // hit note 1
      { midi: 75, onsetMs: 5000 }, // far in the future: no expected note
    ];
    const result = evaluateAttempt(expected, detected, REF);
    assertOneClassificationPerExpected(expected, result.notes);
    expect(result.hits).toBe(2);
    expect(result.extra).toBe(1);

    const extras = result.notes.filter((n) => n.classification === 'extra');
    expect(extras.length).toBe(1);
    const ex = extras[0]!;
    expect(ex.noteIndex).toBeNull();
    expect(ex.expectedMidi).toBeNull();
    expect(ex.expectedOnsetMs).toBeNull();
    expect(ex.expectedDurationMs).toBeNull();
    expect(ex.detectedMidi).toBe(75);
    expect(ex.detectedOnsetMs).toBe(5000);

    // extras don't affect the denominators
    expect(result.pitchAccuracy).toBe(1);
    expect(result.timingAccuracy).toBe(1);
  });
});

describe('asymmetric band: late admitted where equal-early is not', () => {
  it('a note late by D is a hit but an early-by-D note is rejected', () => {
    // Choose D strictly between earlyMs and lateMs so late passes, early fails.
    const D = (REF_WIN.earlyMs + REF_WIN.lateMs) / 2; // = 90, in (54,126)
    expect(D).toBeGreaterThan(REF_WIN.earlyMs);
    expect(D).toBeLessThan(REF_WIN.lateMs);

    // Late-by-D: in band -> hit.
    const lateExpected = expectedLine(1);
    const lateResult = evaluateAttempt(
      lateExpected,
      [{ midi: 60, onsetMs: D }],
      REF,
    );
    expect(rowFor(lateResult.notes, 0).classification).toBe('hit');

    // Early-by-D (same magnitude, opposite sign): out of band early -> NOT a
    // hit. With the right pitch but too early it cannot be a hit; the detection
    // becomes extra and the note missed (earliness is never credited as `late`).
    const earlyExpected = expectedLine(1);
    const earlyResult = evaluateAttempt(
      earlyExpected,
      [{ midi: 60, onsetMs: -D }],
      REF,
    );
    expect(rowFor(earlyResult.notes, 0).classification).not.toBe('hit');
    expect(rowFor(earlyResult.notes, 0).classification).toBe('missed');
    expect(earlyResult.extra).toBe(1);
  });
});

describe('clarity floor', () => {
  it('drops sub-threshold detections (treated as never detected)', () => {
    const expected = expectedLine(1);
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 0, clarity: CLARITY_THRESHOLD - 0.01 },
    ];
    const result = evaluateAttempt(expected, detected, REF);
    expect(rowFor(result.notes, 0).classification).toBe('missed');
    expect(result.extra).toBe(0); // dropped, not surfaced as extra
  });

  it('keeps detections at/above the floor and trusts absent clarity', () => {
    const expected = expectedLine(2);
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 0, clarity: CLARITY_THRESHOLD }, // exactly at floor
      { midi: 61, onsetMs: 500 }, // no clarity field -> trusted
    ];
    const result = evaluateAttempt(expected, detected, REF);
    expect(result.hits).toBe(2);
  });
});

describe('alignment is one-to-one (no detection steals two notes)', () => {
  it('each expected note maps to at most one detection and vice versa', () => {
    const expected = expectedLine(3);
    // Two detections crowded near note 0; only the closest should pair with it,
    // the other should pair with note 1 (its nearest free expected) or be extra.
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 10 }, // near note 0
      { midi: 61, onsetMs: 40 }, // also near note 0 but is note 1's pitch
      { midi: 62, onsetMs: 1000 }, // note 2
    ];
    const { alignments } = alignNotes(expected, detected, REF);
    const usedExpected = new Set(alignments.map((a) => a.expectedIndex));
    const usedDetections = new Set(alignments.map((a) => a.detectionIndex));
    expect(usedExpected.size).toBe(alignments.length); // no expected reused
    expect(usedDetections.size).toBe(alignments.length); // no detection reused
  });
});

describe('mixed sequence: one of every category, exact metrics', () => {
  it('hit, wrong_pitch, late, missed, and an extra all coexist with correct metrics', () => {
    // 4 expected notes, onsets 0/500/1000/1500, pitches 60/61/62/63.
    const expected = expectedLine(4);
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 0 }, // note 0: hit
      { midi: 70, onsetMs: 500 }, // note 1: wrong pitch, in band -> wrong_pitch
      { midi: 62, onsetMs: 1000 + REF_WIN.lateMs + 30 }, // note 2: right pitch, beyond band -> late
      // note 3 (onset 1500): no nearby detection -> missed
      { midi: 80, onsetMs: 9000 }, // extra
    ];

    const result = evaluateAttempt(expected, detected, REF);
    assertOneClassificationPerExpected(expected, result.notes);

    expect(rowFor(result.notes, 0).classification).toBe('hit');
    expect(rowFor(result.notes, 1).classification).toBe('wrong_pitch');
    expect(rowFor(result.notes, 2).classification).toBe('late');
    expect(rowFor(result.notes, 3).classification).toBe('missed');

    expect(result.hits).toBe(1);
    expect(result.wrongPitch).toBe(1);
    expect(result.late).toBe(1);
    expect(result.missed).toBe(1);
    expect(result.extra).toBe(1);
    expect(result.totalExpectedNotes).toBe(4);

    // pitch = (hits 1 + late 1)/4 = 0.5 ; timing = hits 1 / 4 = 0.25
    expect(result.pitchAccuracy).toBeCloseTo(0.5, 10);
    expect(result.timingAccuracy).toBeCloseTo(0.25, 10);

    // counts add up: non-extra == total expected
    expect(result.hits + result.wrongPitch + result.late + result.missed).toBe(
      result.totalExpectedNotes,
    );
  });
});

describe('noteIndex join is preserved (sparse indices survive)', () => {
  it('keeps the original line.notes index, not a dense 0..n index', () => {
    // Simulate rests filtered out: expected notes carry non-contiguous indices.
    const expected: ExpectedNote[] = [
      { noteIndex: 2, expectedMidi: 60, onsetMs: 0, durationMs: 500 },
      { noteIndex: 5, expectedMidi: 64, onsetMs: 500, durationMs: 500 },
    ];
    const detected: DetectedNote[] = [
      { midi: 60, onsetMs: 0 },
      { midi: 64, onsetMs: 500 },
    ];
    const notes = classifyNotes(expected, detected, REF);
    expect(rowFor(notes, 2).classification).toBe('hit');
    expect(rowFor(notes, 5).classification).toBe('hit');
  });
});

describe('summarize on a hand-built list (zero-note guard)', () => {
  it('an empty list yields 0 metrics, not NaN', () => {
    const result = summarize([]);
    expect(result.totalExpectedNotes).toBe(0);
    expect(result.pitchAccuracy).toBe(0);
    expect(result.timingAccuracy).toBe(0);
  });
});
