import { describe, it, expect } from 'vitest';
import {
  validatePosition,
  validateMusicality,
} from './validators.js';
import { ValidationError } from './config.js';
import { makeNeckPosition, makeDuration } from '../domain/index.js';
import type { Pitch, LineNote, Chord, ContourTarget } from '../domain/index.js';

const p = (name: Pitch['name'], octave: number): Pitch => ({
  name,
  accidental: 'natural',
  octave,
});

const cMajorChord: Chord = { root: p('C', 4), quality: 'major' };

function note(pitch: Pitch | null, startTick: number, barIndex: number): LineNote {
  return {
    pitch,
    duration: makeDuration('quarter'),
    startTick,
    barIndex,
    beatPositionInBar: startTick % 1920,
    isStrongBeat: startTick % 960 === 0,
    impliedChord: cMajorChord,
    chordToneRole: 'chordTone',
    tiedToNext: false,
  };
}

describe('validatePosition', () => {
  it('passes when all notes are within the position', () => {
    const pos = makeNeckPosition(1, 6, 4, 8, 'V');
    // G3 (MIDI 55) is playable in 5th position (open G string is 3rd string fret 0,
    // but on the D string fret 5 = G3, within frets 4-8). C4=60 on G string fret 5.
    const notes = [note(p('C', 4), 0, 0)];
    expect(() => validatePosition(notes, pos)).not.toThrow();
  });

  it('throws when a note is unplayable in the position', () => {
    const pos = makeNeckPosition(1, 6, 4, 8, 'V');
    // E2 (MIDI 40, open low E) is NOT reachable in frets 4-8.
    const notes = [note(p('E', 2), 0, 0)];
    expect(() => validatePosition(notes, pos)).toThrow(ValidationError);
  });
});

describe('validateMusicality', () => {
  const arch: ContourTarget = {
    shape: 'steady', // steady skips the peak-bar requirement
    climaxBar: 1,
    climaxPitch: p('G', 4),
    perBarTargets: [p('C', 4), p('G', 4), p('E', 4), p('C', 4)],
  };

  // A ~70/25/5 mix base line (8 intervals): 6 steps, 2 small leaps, 0 large.
  // step/leap = 6/8=0.75, smallLeap=2/8=0.25, large=0 -> within 0.18 tolerance.
  const cleanNotes: LineNote[] = [
    note(p('C', 4), 0, 0), // start
    note(p('D', 4), 480, 0), // +2 step
    note(p('E', 4), 960, 0), // +2 step
    note(p('F', 4), 1440, 0), // +1 step
    note(p('A', 4), 1920, 1), // +4 small leap
    note(p('G', 4), 2400, 1), // -2 step
    note(p('E', 4), 2880, 1), // -3 small leap
    note(p('F', 4), 3360, 1), // +1 step
    note(p('G', 4), 3840, 2), // +2 step
  ];

  it('passes a realistic ~70/25/5 line', () => {
    expect(() => validateMusicality(cleanNotes, arch)).not.toThrow();
  });

  it('throws on >3 identical pitches in a row', () => {
    // Keep the step/leap mix in band (some small leaps) but include a run of 4 identical
    // pitches so the REPEATS check is what fires, not the balance check.
    const notes = [
      note(p('C', 4), 0, 0),
      note(p('F', 4), 480, 0), // +5 small leap
      note(p('D', 4), 960, 0), // -3 small leap
      note(p('D', 4), 1440, 0), // 0 step
      note(p('D', 4), 1920, 1), // 0 step
      note(p('D', 4), 2400, 1), // 0 step -> 4 D's in a row
      note(p('E', 4), 2880, 1), // +2 step
      note(p('F', 4), 3360, 1), // +1 step
      note(p('G', 4), 3840, 2), // +2 step
      note(p('A', 4), 4320, 2), // +2 step
      note(p('G', 4), 4800, 2), // -2 step
    ];
    // mix: 8 steps, 2 small leaps, 0 large over 10 intervals -> 0.80/0.20/0.00, in band.
    expect(() => validateMusicality(notes, arch)).toThrow(/identical/);
  });

  it('throws when total range exceeds ~1.5 octaves', () => {
    // Mix kept in the 70/25/5 band (7 steps, 3 small leaps over 10 intervals) but the
    // ascent crosses far more than 19 semitones overall so the RANGE check is what fires.
    const notes = [
      note(p('C', 3), 0, 0), // MIDI 48
      note(p('D', 3), 480, 0), // +2 step
      note(p('E', 3), 960, 0), // +2 step
      note(p('G', 3), 1440, 0), // +3 small leap (55)
      note(p('A', 3), 1920, 1), // +2 step (57)
      note(p('B', 3), 2400, 1), // +2 step (59)
      note(p('D', 4), 2880, 1), // +3 small leap (62)
      note(p('E', 4), 3360, 1), // +2 step (64)
      note(p('F', 4), 3840, 2), // +1 step (65)
      note(p('A', 4), 4320, 2), // +4 small leap (69)
      note(p('B', 4), 4800, 2), // +2 step (71) -> range 71-48 = 23 > 19
    ];
    expect(() => validateMusicality(notes, arch)).toThrow(/range/);
  });

  it('throws when the step/leap mix is too leap-heavy', () => {
    // All large leaps -> way outside the 70/25/5 tolerance.
    const notes = [
      note(p('C', 4), 0, 0),
      note(p('A', 4), 480, 0), // +9
      note(p('B', 3), 960, 0), // -10
      note(p('A', 4), 1440, 0), // +10
    ];
    expect(() => validateMusicality(notes, arch)).toThrow(/step\/leap/);
  });
});
