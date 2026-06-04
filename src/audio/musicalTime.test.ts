// Tests for the PURE musical-time model (no Web Audio / no DOM). This is the
// deterministic, autonomously-verifiable core of the Milestone 3 acceptance
// criteria: it is the basis of the brief's "+/-20ms cursor at the final
// downbeat" check (real audio jitter is then measured live at Gate 2).

import { describe, it, expect } from 'vitest';
import {
  tickToMs,
  precomputeSchedule,
  currentNoteIndexAt,
  computeBeatClicks,
  DEFAULT_COUNT_IN_BARS,
} from './musicalTime.js';
import type { Line, LineNote, Pitch } from '../domain/index.js';
import {
  FOUR_FOUR,
  THREE_FOUR,
  makeDuration,
  makeNeckPosition,
  ticksPerBar,
  TICKS_PER_QUARTER,
  pitchToMidi,
} from '../domain/index.js';
import type { Key } from '../domain/index.js';

const cMajor: Key = { tonic: { name: 'C', accidental: 'natural' }, mode: 'major' };

// A throwaway chord stub: musicalTime never inspects impliedChord, so a minimal
// valid Chord is enough to satisfy the LineNote type.
const stubChord = {
  root: { name: 'C', accidental: 'natural', octave: 4 } as Pitch,
  quality: 'major' as const,
};

/** Build a LineNote at an absolute tick with a quarter-note duration by default. */
function note(
  startTick: number,
  pitch: Pitch | null,
  ticks = TICKS_PER_QUARTER,
): LineNote {
  return {
    pitch,
    duration:
      ticks === TICKS_PER_QUARTER
        ? makeDuration('quarter')
        : ticks === TICKS_PER_QUARTER / 2
          ? makeDuration('eighth')
          : ticks === TICKS_PER_QUARTER * 4
            ? makeDuration('whole')
            : { base: 'quarter', dots: 0, ticks },
    startTick,
    barIndex: Math.floor(startTick / (TICKS_PER_QUARTER * 4)),
    beatPositionInBar: startTick % (TICKS_PER_QUARTER * 4),
    isStrongBeat: startTick % (TICKS_PER_QUARTER * 4) === 0,
    impliedChord: stubChord,
    chordToneRole: 'root',
    tiedToNext: false,
  };
}

const C4: Pitch = { name: 'C', accidental: 'natural', octave: 4 };
const E4: Pitch = { name: 'E', accidental: 'natural', octave: 4 };
const G4: Pitch = { name: 'G', accidental: 'natural', octave: 4 };

/** A 4-bar 4/4 line of straight quarter notes (16 notes, ticks 0..7200). */
function fourBarQuarters(tempo: number): Line {
  const notes: LineNote[] = [];
  const q = TICKS_PER_QUARTER;
  for (let i = 0; i < 16; i++) {
    notes.push(note(i * q, i % 3 === 0 ? C4 : i % 3 === 1 ? E4 : G4));
  }
  return makeLine(notes, FOUR_FOUR, 4, tempo);
}

function makeLine(
  notes: LineNote[],
  ts = FOUR_FOUR,
  barCount = 4,
  tempo = 120,
): Line {
  return {
    id: 'test-line',
    seed: 1,
    generatedAt: '2026-06-04T00:00:00.000Z',
    key: cMajor,
    timeSignature: ts,
    position: makeNeckPosition(1, 6, 4, 8, 'V'),
    tempo,
    barCount,
    progression: { progressionId: 'stub', chords: [] },
    phraseStructure: { pattern: 'AAAB', barRoles: ['A', 'A', 'A', 'B'] },
    contourTarget: {
      shape: 'arch',
      climaxBar: 2,
      climaxPitch: G4,
      perBarTargets: [C4, E4, G4, C4],
    },
    rhythmicMotifPlan: { perBarMotifIds: [], variations: [] },
    notes,
    generatorVersion: 'test',
    validationsPassed: [],
  };
}

describe('tickToMs', () => {
  it('converts a quarter note (480 ticks) to 500ms at 120 BPM', () => {
    expect(tickToMs(TICKS_PER_QUARTER, 120)).toBeCloseTo(500, 9);
  });

  it('converts a quarter note to 1000ms at 60 BPM', () => {
    expect(tickToMs(TICKS_PER_QUARTER, 60)).toBeCloseTo(1000, 9);
  });

  it('converts a quarter note to 600ms at 100 BPM', () => {
    expect(tickToMs(TICKS_PER_QUARTER, 100)).toBeCloseTo(600, 9);
  });

  it('scales linearly: a whole note (1920 ticks) is 4 quarters', () => {
    expect(tickToMs(TICKS_PER_QUARTER * 4, 120)).toBeCloseTo(2000, 9);
  });

  it('is zero at tick zero', () => {
    expect(tickToMs(0, 120)).toBe(0);
  });
});

describe('precomputeSchedule — count-in offset', () => {
  it('defaults to 2 bars of count-in', () => {
    expect(DEFAULT_COUNT_IN_BARS).toBe(2);
    const line = fourBarQuarters(120);
    const sched = precomputeSchedule(line, 120);
    // 2 bars of 4/4 at 120 BPM = 2 * 4 * 500ms = 4000ms.
    expect(sched.countInOffsetMs).toBeCloseTo(4000, 9);
  });

  it('honors a configurable count-in bar count', () => {
    const line = fourBarQuarters(120);
    const sched0 = precomputeSchedule(line, 120, 0);
    expect(sched0.countInOffsetMs).toBe(0);
    const sched1 = precomputeSchedule(line, 120, 1);
    expect(sched1.countInOffsetMs).toBeCloseTo(2000, 9);
  });

  it('count-in scales with tempo', () => {
    const line = fourBarQuarters(60);
    const sched = precomputeSchedule(line, 60, 2);
    // 2 bars of 4/4 at 60 BPM = 2 * 4 * 1000ms = 8000ms.
    expect(sched.countInOffsetMs).toBeCloseTo(8000, 9);
  });
});

describe('precomputeSchedule — final downbeat timing (the +/-20ms basis)', () => {
  it('places the final downbeat (bar 4, note index 12) at count-in + 6000ms', () => {
    const line = fourBarQuarters(120);
    const sched = precomputeSchedule(line, 120); // 2-bar count-in default
    // Note index 12 is the downbeat of bar 4 (ticks = 12 * 480 = 5760).
    // Within the line: 12 quarters * 500ms = 6000ms after line start.
    // Plus the 2-bar count-in (4000ms) => onset at 10000ms wall-clock.
    const finalDownbeat = sched.entries[12]!;
    expect(finalDownbeat.noteIndex).toBe(12);
    expect(finalDownbeat.onsetMs).toBeCloseTo(10000, 6);
  });

  it('the FINAL downbeat CLICK lands at count-in + (4 bars * 4 beats * 500ms)', () => {
    // The brief's wording: "4 bars * 4 beats * 500ms = 8000ms after the line
    // start, plus the 2-bar count-in = 2000ms". The bar-start downbeat after the
    // 4th bar (i.e. the moment the line's musical content has fully elapsed) is
    // the end of the line. We assert the line END click is at 4000 + 8000.
    const line = fourBarQuarters(120);
    const sched = precomputeSchedule(line, 120);
    // line content = 4 bars * 4 * 500 = 8000ms; + 4000ms count-in = 12000ms.
    expect(sched.lineDurationMs).toBeCloseTo(8000, 6);
    expect(sched.totalDurationMs).toBeCloseTo(12000, 6);
  });

  it('first note onset equals exactly the count-in offset', () => {
    const line = fourBarQuarters(120);
    const sched = precomputeSchedule(line, 120);
    expect(sched.entries[0]!.onsetMs).toBeCloseTo(4000, 9);
    expect(sched.entries[0]!.noteIndex).toBe(0);
  });

  it('carries expectedMidi for pitched notes and null for rests', () => {
    const notes = [note(0, C4), note(480, null), note(960, G4, 960)];
    const line = makeLine(notes, FOUR_FOUR, 1, 120);
    const sched = precomputeSchedule(line, 120, 0);
    expect(sched.entries[0]!.expectedMidi).toBe(pitchToMidi(C4));
    expect(sched.entries[1]!.expectedMidi).toBeNull();
    expect(sched.entries[2]!.expectedMidi).toBe(pitchToMidi(G4));
  });

  it('computes per-note durationMs from the note duration', () => {
    const line = fourBarQuarters(120);
    const sched = precomputeSchedule(line, 120, 0);
    for (const e of sched.entries) {
      expect(e.durationMs).toBeCloseTo(500, 9);
    }
  });
});

describe('currentNoteIndexAt', () => {
  const line = fourBarQuarters(120);
  const sched = precomputeSchedule(line, 120); // 4000ms count-in

  it('returns -1 before the line starts (during count-in)', () => {
    expect(currentNoteIndexAt(sched, 0)).toBe(-1);
    expect(currentNoteIndexAt(sched, 3999)).toBe(-1);
  });

  it('returns 0 exactly at the first note onset', () => {
    expect(currentNoteIndexAt(sched, 4000)).toBe(0);
  });

  it('returns the right index in the middle of a note', () => {
    // Note 0 spans 4000..4500; note 1 spans 4500..5000.
    expect(currentNoteIndexAt(sched, 4250)).toBe(0);
    expect(currentNoteIndexAt(sched, 4499.9)).toBe(0);
    expect(currentNoteIndexAt(sched, 4500)).toBe(1);
    expect(currentNoteIndexAt(sched, 4750)).toBe(1);
  });

  it('is correct at every note boundary (onset of each note)', () => {
    for (let i = 0; i < 16; i++) {
      const onset = 4000 + i * 500;
      expect(currentNoteIndexAt(sched, onset)).toBe(i);
    }
  });

  it('returns the last note index after the final note onset', () => {
    expect(currentNoteIndexAt(sched, 11750)).toBe(15);
  });

  it('returns the last note index even past the end of the line', () => {
    // Last note ends at 12000; the cursor parks on the last note.
    expect(currentNoteIndexAt(sched, 12000)).toBe(15);
    expect(currentNoteIndexAt(sched, 99999)).toBe(15);
  });
});

describe('computeBeatClicks — count-in + accents', () => {
  it('emits count-in clicks before the line and bar clicks during it', () => {
    const line = fourBarQuarters(120);
    const clicks = computeBeatClicks(line, 120); // 2 count-in bars + 4 line bars
    // 4/4: 4 beats per bar. (2 count-in + 4 line) * 4 = 24 clicks.
    expect(clicks.length).toBe(24);
  });

  it('accents the downbeat of every bar (count-in and line)', () => {
    const line = fourBarQuarters(120);
    const clicks = computeBeatClicks(line, 120);
    const accented = clicks.filter((c) => c.accented);
    // One accent per bar => 6 bars total.
    expect(accented.length).toBe(6);
    // Every accented click sits exactly on a bar boundary (multiple of 2000ms).
    for (const c of accented) {
      expect(c.timeMs % 2000).toBeCloseTo(0, 6);
    }
  });

  it('first click is at time 0, every click is 500ms apart at 120 BPM', () => {
    const line = fourBarQuarters(120);
    const clicks = computeBeatClicks(line, 120);
    expect(clicks[0]!.timeMs).toBe(0);
    expect(clicks[0]!.accented).toBe(true);
    for (let i = 1; i < clicks.length; i++) {
      expect(clicks[i]!.timeMs - clicks[i - 1]!.timeMs).toBeCloseTo(500, 6);
    }
  });

  it('flags which clicks belong to the count-in', () => {
    const line = fourBarQuarters(120);
    const clicks = computeBeatClicks(line, 120);
    const countIn = clicks.filter((c) => c.isCountIn);
    expect(countIn.length).toBe(8); // 2 bars * 4 beats
    // The first non-count-in click coincides with the line start (4000ms).
    const firstLine = clicks.find((c) => !c.isCountIn)!;
    expect(firstLine.timeMs).toBeCloseTo(4000, 6);
  });

  it('handles 3/4 (3 beats per bar, accent on beat 1 only)', () => {
    const q = TICKS_PER_QUARTER;
    const notes = [note(0, C4), note(q, E4), note(2 * q, G4)];
    // Patch barIndex/beatPosition for 3/4 manually (ticksPerBar = 1440).
    const tpb = ticksPerBar(THREE_FOUR);
    for (const n of notes) {
      n.barIndex = Math.floor(n.startTick / tpb);
      n.beatPositionInBar = n.startTick % tpb;
      n.isStrongBeat = n.beatPositionInBar === 0;
    }
    const line = makeLine(notes, THREE_FOUR, 1, 120);
    const clicks = computeBeatClicks(line, 120, 1); // 1 count-in bar + 1 line bar
    expect(clicks.length).toBe(6); // 2 bars * 3 beats
    expect(clicks.filter((c) => c.accented).length).toBe(2); // one per bar
  });
});
