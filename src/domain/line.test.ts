import { describe, it, expect } from 'vitest';
import type {
  Line,
  LineNote,
  ChordToneRole,
  ConcreteProgression,
  PhraseStructure,
  ContourTarget,
  RhythmicMotifPlan,
} from './line.js';
import type { Chord } from './chord.js';
import type { Pitch } from './pitch.js';
import { makeDuration } from './duration.js';
import { FOUR_FOUR } from './timeSignature.js';
import { makeNeckPosition } from './neckPosition.js';

const cMajorChord: Chord = {
  root: { name: 'C', accidental: 'natural', octave: 4 },
  quality: 'major',
};
const cPitch: Pitch = { name: 'C', accidental: 'natural', octave: 4 };

function sampleLine(): Line {
  const progression: ConcreteProgression = {
    progressionId: 'I-IV-V-I',
    chords: [
      { romanNumeral: 'I', chord: cMajorChord, barIndex: 0, startTick: 0 },
    ],
  };
  const phraseStructure: PhraseStructure = {
    pattern: 'AAAB',
    barRoles: ['A', 'A', 'A', 'B'],
  };
  const contourTarget: ContourTarget = {
    shape: 'arch',
    climaxBar: 2,
    climaxPitch: { name: 'G', accidental: 'natural', octave: 4 },
    perBarTargets: [cPitch, cPitch, cPitch, cPitch],
  };
  const rhythmicMotifPlan: RhythmicMotifPlan = {
    perBarMotifIds: ['straight-quarters', 'straight-quarters', 'straight-quarters', 'straight-quarters'],
    variations: [],
  };
  const note: LineNote = {
    pitch: cPitch,
    duration: makeDuration('quarter'),
    startTick: 0,
    barIndex: 0,
    beatPositionInBar: 0,
    isStrongBeat: true,
    impliedChord: cMajorChord,
    chordToneRole: 'root',
    tiedToNext: false,
  };
  return {
    id: '11111111-1111-1111-1111-111111111111',
    seed: 42,
    generatedAt: '2026-06-04T00:00:00.000Z',
    key: { tonic: { name: 'C', accidental: 'natural' }, mode: 'major' },
    timeSignature: FOUR_FOUR,
    position: makeNeckPosition(1, 6, 0, 4, 'open'),
    tempo: 120,
    barCount: 4,
    progression,
    phraseStructure,
    contourTarget,
    rhythmicMotifPlan,
    notes: [note],
    generatorVersion: 'test',
    validationsPassed: ['position', 'cadence'],
  };
}

describe('Line types', () => {
  it('a rest is represented by pitch === null', () => {
    const rest: LineNote = {
      pitch: null,
      duration: makeDuration('quarter'),
      startTick: 0,
      barIndex: 0,
      beatPositionInBar: 0,
      isStrongBeat: false,
      impliedChord: cMajorChord,
      chordToneRole: 'nonChordTone',
      tiedToNext: false,
    };
    expect(rest.pitch).toBeNull();
  });

  it('all ChordToneRole values are assignable', () => {
    const roles: ChordToneRole[] = [
      'root',
      'third',
      'fifth',
      'seventh',
      'passing',
      'neighbor',
      'appoggiatura',
      'escape',
      'chromatic',
      'chordTone',
      'nonChordTone',
    ];
    expect(roles.length).toBe(11);
  });
});

describe('Line JSON round-trip', () => {
  it('a full Line survives stringify/parse identically', () => {
    const line = sampleLine();
    const round = JSON.parse(JSON.stringify(line));
    expect(round).toEqual(line);
  });

  it('round-trips a rest note (null pitch survives)', () => {
    const line = sampleLine();
    line.notes.push({
      pitch: null,
      duration: makeDuration('eighth'),
      startTick: 480,
      barIndex: 0,
      beatPositionInBar: 480,
      isStrongBeat: false,
      impliedChord: cMajorChord,
      chordToneRole: 'nonChordTone',
      tiedToNext: false,
    });
    const round = JSON.parse(JSON.stringify(line)) as Line;
    expect(round.notes[1]!.pitch).toBeNull();
    expect(round).toEqual(line);
  });
});
