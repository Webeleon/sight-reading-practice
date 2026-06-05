// Tests for the evaluation bridge (UI -> pure evaluation glue). Runs under the
// vitest NODE environment: although this file lives in src/ui, the functions
// under test (buildExpectedNotes / deriveSubdivision / synthesizeTake) are plain
// data transforms with no DOM dependency, so the WHOLE evaluation + synthetic
// path is exercisable here WITHOUT a guitar (live accuracy is Human Review Gate 3).

import { describe, it, expect } from 'vitest';
import type { Line, LineNote, Pitch } from '../domain/index.js';
import {
  FOUR_FOUR,
  makeDuration,
  makeNeckPosition,
  TICKS_PER_QUARTER,
} from '../domain/index.js';
import type { Key } from '../domain/index.js';
import {
  buildExpectedNotes,
  deriveSubdivision,
  synthesizeTake,
  synthesizePerfectTake,
  synthesizeKnownErrorTake,
} from './evaluationBridge.js';
import { evaluateAttempt } from '../evaluation/index.js';

const cMajor: Key = { tonic: { name: 'C', accidental: 'natural' }, mode: 'major' };
const C4: Pitch = { name: 'C', accidental: 'natural', octave: 4 };
const stubChord = { root: C4, quality: 'major' as const };

function note(
  pitch: Pitch | null,
  startTick: number,
  base: Parameters<typeof makeDuration>[0],
): LineNote {
  return {
    pitch,
    duration: makeDuration(base),
    startTick,
    barIndex: Math.floor(startTick / (TICKS_PER_QUARTER * 4)),
    beatPositionInBar: startTick % (TICKS_PER_QUARTER * 4),
    isStrongBeat: startTick % TICKS_PER_QUARTER === 0,
    impliedChord: stubChord,
    chordToneRole: 'root',
    tiedToNext: false,
  };
}

/** A 1-bar 4/4 line of 4 quarters at 120 BPM (one is a rest). */
function quarterLine(): Line {
  const notes: LineNote[] = [
    note(C4, 0, 'quarter'),
    note({ name: 'D', accidental: 'natural', octave: 4 }, TICKS_PER_QUARTER, 'quarter'),
    note(null, TICKS_PER_QUARTER * 2, 'quarter'), // rest
    note({ name: 'E', accidental: 'natural', octave: 4 }, TICKS_PER_QUARTER * 3, 'quarter'),
  ];
  return {
    id: 'q',
    seed: 1,
    generatedAt: '2026-06-05T00:00:00.000Z',
    key: cMajor,
    timeSignature: FOUR_FOUR,
    position: makeNeckPosition(1, 6, 4, 8, 'V'),
    tempo: 120,
    barCount: 1,
    progression: { progressionId: 's', chords: [] },
    phraseStructure: { pattern: 'AAAB', barRoles: ['A'] },
    contourTarget: { shape: 'steady', climaxBar: 0, climaxPitch: C4, perBarTargets: [C4] },
    rhythmicMotifPlan: { perBarMotifIds: [], variations: [] },
    notes,
    generatorVersion: 'test',
    validationsPassed: [],
  };
}

describe('buildExpectedNotes', () => {
  it('filters out rests and joins back to line.notes by index', () => {
    const { expected } = buildExpectedNotes(quarterLine(), 2);
    // 4 notes, 1 is a rest -> 3 expected notes.
    expect(expected).toHaveLength(3);
    expect(expected.map((e) => e.noteIndex)).toEqual([0, 1, 3]); // index 2 was the rest
    expect(expected.map((e) => e.expectedMidi)).toEqual([60, 62, 64]);
  });

  it('puts onsets on the schedule clock (offset by the count-in)', () => {
    const { expected, schedule } = buildExpectedNotes(quarterLine(), 2);
    // First note's onset == count-in offset (2 bars of 4/4 @120 == 4000ms).
    expect(expected[0]!.onsetMs).toBeCloseTo(schedule.countInOffsetMs, 6);
    expect(schedule.countInOffsetMs).toBeCloseTo(4000, 6);
  });
});

describe('deriveSubdivision', () => {
  it('returns quarter for an all-quarter line', () => {
    expect(deriveSubdivision(quarterLine())).toBe('quarter');
  });

  it('returns eighth when the finest note is an eighth', () => {
    const l = quarterLine();
    l.notes[1] = note({ name: 'D', accidental: 'natural', octave: 4 }, TICKS_PER_QUARTER, 'eighth');
    expect(deriveSubdivision(l)).toBe('eighth');
  });

  it('returns sixteenth when the finest note is a sixteenth', () => {
    const l = quarterLine();
    l.notes[1] = note({ name: 'D', accidental: 'natural', octave: 4 }, TICKS_PER_QUARTER, 'sixteenth');
    expect(deriveSubdivision(l)).toBe('sixteenth');
  });

  it('returns triplet when any note carries a tuplet', () => {
    const l = quarterLine();
    const trip = makeDuration('eighth', 0, { numerator: 3, denominator: 2 });
    l.notes[1] = { ...l.notes[1]!, duration: trip };
    expect(deriveSubdivision(l)).toBe('triplet');
  });
});

/** A 2-bar 4/4 line of 8 quarter notes (no rests) — long enough for the known
 *  error mix to exhibit all five classifications. MIDI 60..67 ascending. */
function eightQuarterLine(): Line {
  const notes: LineNote[] = [];
  for (let i = 0; i < 8; i++) {
    notes.push(
      note(
        { name: 'C', accidental: 'natural', octave: 4 }, // pitch is overwritten below
        i * TICKS_PER_QUARTER,
        'quarter',
      ),
    );
  }
  // Distinct ascending pitches (C4 D4 E4 F4 G4 A4 B4 C5 -> MIDI 60..72) so a
  // wrong-pitch (+1 semitone) detection never collides with a neighbour's onset.
  const names: Array<Pitch['name']> = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'];
  const octs = [4, 4, 4, 4, 4, 4, 4, 5];
  for (let i = 0; i < 8; i++) {
    notes[i] = {
      ...notes[i]!,
      pitch: { name: names[i]!, accidental: 'natural', octave: octs[i]! },
    };
  }
  return {
    id: '8q',
    seed: 2,
    generatedAt: '2026-06-05T00:00:00.000Z',
    key: cMajor,
    timeSignature: FOUR_FOUR,
    position: makeNeckPosition(1, 6, 4, 8, 'V'),
    tempo: 120,
    barCount: 2,
    progression: { progressionId: 's', chords: [] },
    phraseStructure: { pattern: 'AAAB', barRoles: ['A', 'B'] },
    contourTarget: { shape: 'steady', climaxBar: 0, climaxPitch: C4, perBarTargets: [C4, C4] },
    rhythmicMotifPlan: { perBarMotifIds: [], variations: [] },
    notes,
    generatorVersion: 'test',
    validationsPassed: [],
  };
}

describe('synthesizePerfectTake (named "Simulate perfect take")', () => {
  it('yields one in-time correct-pitch detection per expected note -> all hits', () => {
    const line = eightQuarterLine();
    const { expected } = buildExpectedNotes(line, 2);
    const take = synthesizePerfectTake(line, 2);
    expect(take).toHaveLength(expected.length);
    const result = evaluateAttempt(expected, take, {
      tempoBpm: line.tempo,
      subdivision: deriveSubdivision(line),
    });
    expect(result.hits).toBe(expected.length);
    expect(result.pitchAccuracy).toBe(1);
    expect(result.timingAccuracy).toBe(1);
    expect(result.extra).toBe(0);
  });
});

describe('synthesizeKnownErrorTake (named "Simulate take with errors")', () => {
  it('produces the FIXED mix: 2 wrong-pitch, 1 late, 1 missed, 1 extra; rest hits', () => {
    const line = eightQuarterLine();
    const { expected } = buildExpectedNotes(line, 2);
    const take = synthesizeKnownErrorTake(line, 2);
    const result = evaluateAttempt(expected, take, {
      tempoBpm: line.tempo,
      subdivision: deriveSubdivision(line),
    });
    expect(result.totalExpectedNotes).toBe(expected.length); // 8
    expect(result.wrongPitch).toBe(2);
    expect(result.late).toBe(1);
    expect(result.missed).toBe(1);
    expect(result.extra).toBe(1);
    // The remaining 4 of the 8 expected notes are clean hits.
    expect(result.hits).toBe(expected.length - 4);
  });

  it('is deterministic (same input -> identical take every call)', () => {
    const line = eightQuarterLine();
    const a = synthesizeKnownErrorTake(line, 2);
    const b = synthesizeKnownErrorTake(line, 2);
    expect(a).toEqual(b);
  });

  it('degrades gracefully on a short line without crashing', () => {
    const short = quarterLine(); // 3 expected notes (indices 0,1,3)
    const { expected } = buildExpectedNotes(short, 2);
    const take = synthesizeKnownErrorTake(short, 2);
    const result = evaluateAttempt(expected, take, {
      tempoBpm: short.tempo,
      subdivision: deriveSubdivision(short),
    });
    // Every expected note still gets exactly one classification.
    expect(
      result.hits + result.wrongPitch + result.late + result.missed,
    ).toBe(expected.length);
  });
});

describe('synthesizeTake -> evaluateAttempt (hardware-free path)', () => {
  const line = quarterLine();
  const subdivision = deriveSubdivision(line);

  it('a perfect take yields all hits and 100% on both metrics', () => {
    const { expected } = buildExpectedNotes(line, 2);
    const take = synthesizeTake(line, 2, { accuracy: 1 });
    expect(take).toHaveLength(expected.length); // one detection per expected note
    const result = evaluateAttempt(expected, take, {
      tempoBpm: line.tempo,
      subdivision,
    });
    expect(result.hits).toBe(expected.length);
    expect(result.pitchAccuracy).toBe(1);
    expect(result.timingAccuracy).toBe(1);
  });

  it('a constant late bias within the band still counts as hits', () => {
    const { expected } = buildExpectedNotes(line, 2);
    const take = synthesizeTake(line, 2, { accuracy: 1, timingBiasMs: 30 });
    const result = evaluateAttempt(expected, take, {
      tempoBpm: line.tempo,
      subdivision,
    });
    expect(result.timingAccuracy).toBe(1);
  });

  it('a degraded take (accuracy 0) produces no hits but still classifies all notes', () => {
    const { expected } = buildExpectedNotes(line, 2);
    let calls = 0;
    const rng = (): number => {
      // Force every note to degrade (roll > accuracy) and route to wrong_pitch.
      calls++;
      return calls % 2 === 0 ? 0.5 : 0.99; // alternate roll / mode picks
    };
    const take = synthesizeTake(line, 2, { accuracy: 0, rng });
    const result = evaluateAttempt(expected, take, {
      tempoBpm: line.tempo,
      subdivision,
    });
    expect(result.hits).toBe(0);
    // Every expected note is classified exactly once into one of the categories.
    expect(
      result.hits + result.wrongPitch + result.late + result.missed,
    ).toBe(expected.length);
  });

  it('extra detections surface as extras (no expected counterpart)', () => {
    const { expected } = buildExpectedNotes(line, 2);
    const take = synthesizeTake(line, 2, { accuracy: 1, extraNotes: 2 });
    const result = evaluateAttempt(expected, take, {
      tempoBpm: line.tempo,
      subdivision,
    });
    expect(result.hits).toBe(expected.length);
    expect(result.extra).toBeGreaterThanOrEqual(1);
  });
});
