import { describe, it, expect } from 'vitest';
import { serializeLineToMusicXML } from './serialize.js';
import type {
  Line,
  LineNote,
  ConcreteProgression,
  PhraseStructure,
  ContourTarget,
  RhythmicMotifPlan,
} from '../domain/line.js';
import type { Chord } from '../domain/chord.js';
import type { Pitch } from '../domain/pitch.js';
import type { Key } from '../domain/key.js';
import type { TimeSignature } from '../domain/timeSignature.js';
import {
  makeDuration,
  computeTicks,
  type BaseDuration,
} from '../domain/duration.js';
import { FOUR_FOUR, THREE_FOUR, ticksPerBar } from '../domain/timeSignature.js';
import { makeNeckPosition } from '../domain/neckPosition.js';
import { generateLine } from '../generator/generateLine.js';
import type { LineConfig } from '../generator/config.js';

// --- Fixture helpers ---------------------------------------------------------

const cMajorChord: Chord = {
  root: { name: 'C', accidental: 'natural', octave: 4 },
  quality: 'major',
};

function p(name: Pitch['name'], accidental: Pitch['accidental'], octave: number): Pitch {
  return { name, accidental, octave };
}

function note(partial: Partial<LineNote> & Pick<LineNote, 'pitch' | 'duration' | 'startTick'>): LineNote {
  return {
    barIndex: 0,
    beatPositionInBar: 0,
    isStrongBeat: false,
    impliedChord: cMajorChord,
    chordToneRole: 'chordTone',
    tiedToNext: false,
    ...partial,
  };
}

/** Build a Line from a key, time signature, bar count, and a flat note list.
 *  The boilerplate generator-shape fields are filled with valid placeholders. */
function buildLine(
  key: Key,
  ts: TimeSignature,
  barCount: number,
  notes: LineNote[],
): Line {
  const progression: ConcreteProgression = {
    progressionId: 'test',
    chords: [{ romanNumeral: 'I', chord: cMajorChord, barIndex: 0, startTick: 0 }],
  };
  const phraseStructure: PhraseStructure = {
    pattern: 'AAAB',
    barRoles: Array.from({ length: barCount }, (_, i) => (i === barCount - 1 ? 'B' : 'A')),
  };
  const contourTarget: ContourTarget = {
    shape: 'steady',
    climaxBar: 0,
    climaxPitch: p('C', 'natural', 4),
    perBarTargets: Array.from({ length: barCount }, () => p('C', 'natural', 4)),
  };
  const rhythmicMotifPlan: RhythmicMotifPlan = {
    perBarMotifIds: Array.from({ length: barCount }, () => 'm'),
    variations: [],
  };
  return {
    id: '11111111-1111-1111-1111-111111111111',
    seed: 1,
    generatedAt: '2026-06-04T00:00:00.000Z',
    key,
    timeSignature: ts,
    position: makeNeckPosition(1, 6, 0, 4, 'open'),
    tempo: 120,
    barCount,
    progression,
    phraseStructure,
    contourTarget,
    rhythmicMotifPlan,
    notes,
    generatorVersion: 'test',
    validationsPassed: [],
  };
}

const C_MAJOR: Key = { tonic: { name: 'C', accidental: 'natural' }, mode: 'major' };
const G_MAJOR: Key = { tonic: { name: 'G', accidental: 'natural' }, mode: 'major' };
const F_MAJOR: Key = { tonic: { name: 'F', accidental: 'natural' }, mode: 'major' };
const A_MINOR: Key = { tonic: { name: 'A', accidental: 'natural' }, mode: 'minor' };

// Count occurrences of a substring.
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// Extract the text of the first <key>...</key> block, etc.
function block(xml: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  const end = xml.indexOf(close, start);
  if (start === -1 || end === -1) return '';
  return xml.slice(start + open.length, end);
}

// --- Tests -------------------------------------------------------------------

describe('serializeLineToMusicXML — score structure', () => {
  it('is well-formed XML with declaration and DOCTYPE and a score-partwise root', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('whole'), startTick: 0, isStrongBeat: true }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('-//Recordare//DTD MusicXML');
    expect(xml).toContain('<score-partwise');
    expect(xml).toContain('</score-partwise>');
    // Tags are balanced (every opener of these key tags is closed).
    for (const tag of ['part-list', 'part', 'measure', 'attributes']) {
      expect(count(xml, `<${tag}`)).toBeGreaterThan(0);
      expect(count(xml, `</${tag}>`)).toBeGreaterThan(0);
    }
  });

  it('declares one part wired to a single part-list entry', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(count(xml, '<score-part ')).toBe(1);
    expect(count(xml, '<part ')).toBe(1);
    // The <part id> must reference the <score-part id>.
    const partId = /<score-part id="([^"]+)"/.exec(xml)?.[1];
    expect(partId).toBeTruthy();
    expect(xml).toContain(`<part id="${partId}">`);
  });

  it('emits divisions of 480 (one quarter = 480 ticks)', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(xml).toContain('<divisions>480</divisions>');
  });

  it('emits a treble clef with clef-octave-change of -1 (guitar convention)', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    const clef = block(xml, 'clef');
    expect(clef).toContain('<sign>G</sign>');
    expect(clef).toContain('<line>2</line>');
    expect(clef).toContain('<clef-octave-change>-1</clef-octave-change>');
  });
});

describe('serializeLineToMusicXML — key and time signatures', () => {
  it('C major: fifths 0, mode major', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const key = block(serializeLineToMusicXML(line), 'key');
    expect(key).toContain('<fifths>0</fifths>');
    expect(key).toContain('<mode>major</mode>');
  });

  it('G major: fifths 1', () => {
    const line = buildLine(G_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('G', 'natural', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const key = block(serializeLineToMusicXML(line), 'key');
    expect(key).toContain('<fifths>1</fifths>');
  });

  it('F major: fifths -1', () => {
    const line = buildLine(F_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('F', 'natural', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const key = block(serializeLineToMusicXML(line), 'key');
    expect(key).toContain('<fifths>-1</fifths>');
  });

  it('A minor: fifths 0, mode minor', () => {
    const line = buildLine(A_MINOR, FOUR_FOUR, 1, [
      note({ pitch: p('A', 'natural', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const key = block(serializeLineToMusicXML(line), 'key');
    expect(key).toContain('<fifths>0</fifths>');
    expect(key).toContain('<mode>minor</mode>');
  });

  it('time signature 4/4', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const time = block(serializeLineToMusicXML(line), 'time');
    expect(time).toContain('<beats>4</beats>');
    expect(time).toContain('<beat-type>4</beat-type>');
  });

  it('time signature 3/4', () => {
    const line = buildLine(C_MAJOR, THREE_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('half', 1), startTick: 0 }),
    ]);
    const time = block(serializeLineToMusicXML(line), 'time');
    expect(time).toContain('<beats>3</beats>');
    expect(time).toContain('<beat-type>4</beat-type>');
  });

  it('attributes (divisions/key/time/clef) appear only in the first measure', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 2, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('whole'), startTick: 0, barIndex: 0 }),
      note({ pitch: p('D', 'natural', 4), duration: makeDuration('whole'), startTick: 1920, barIndex: 1 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(count(xml, '<divisions>')).toBe(1);
    expect(count(xml, '<clef>')).toBe(1);
    expect(count(xml, '<measure ')).toBe(2);
  });
});

describe('serializeLineToMusicXML — pitch spelling', () => {
  it('a natural note has step/octave and no alter', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const pitchBlock = block(serializeLineToMusicXML(line), 'pitch');
    expect(pitchBlock).toContain('<step>C</step>');
    expect(pitchBlock).toContain('<octave>4</octave>');
    expect(pitchBlock).not.toContain('<alter>');
  });

  it('a sharp note emits alter 1', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('F', 'sharp', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const pitchBlock = block(serializeLineToMusicXML(line), 'pitch');
    expect(pitchBlock).toContain('<step>F</step>');
    expect(pitchBlock).toContain('<alter>1</alter>');
    expect(pitchBlock).toContain('<octave>4</octave>');
  });

  it('a flat note emits alter -1', () => {
    const line = buildLine(F_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('B', 'flat', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const pitchBlock = block(serializeLineToMusicXML(line), 'pitch');
    expect(pitchBlock).toContain('<step>B</step>');
    expect(pitchBlock).toContain('<alter>-1</alter>');
  });

  it('a double-sharp emits alter 2', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('F', 'doubleSharp', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const pitchBlock = block(serializeLineToMusicXML(line), 'pitch');
    expect(pitchBlock).toContain('<alter>2</alter>');
  });
});

describe('serializeLineToMusicXML — accidental display', () => {
  it('shows no explicit accidental for a note already in the key signature (F# in G major)', () => {
    const line = buildLine(G_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('F', 'sharp', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    // alter still present (sounding pitch), but no <accidental> element needed.
    expect(xml).toContain('<alter>1</alter>');
    expect(xml).not.toContain('<accidental>');
  });

  it('shows an explicit sharp accidental for F# in C major (not in the signature)', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('F', 'sharp', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(xml).toContain('<accidental>sharp</accidental>');
  });

  it('shows an explicit natural when cancelling a key-signature accidental (F natural in G major)', () => {
    const line = buildLine(G_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('F', 'natural', 4), duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(xml).toContain('<accidental>natural</accidental>');
  });

  it('does not repeat an accidental for the same pitch later in the same measure', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('F', 'sharp', 4), duration: makeDuration('half'), startTick: 0, barIndex: 0 }),
      note({ pitch: p('F', 'sharp', 4), duration: makeDuration('half'), startTick: 240, barIndex: 0 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    // First F# needs the accidental; the second (same measure, same pitch) does not.
    expect(count(xml, '<accidental>sharp</accidental>')).toBe(1);
  });

  it('re-shows the accidental in a new measure', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 2, [
      note({ pitch: p('F', 'sharp', 4), duration: makeDuration('whole'), startTick: 0, barIndex: 0 }),
      note({ pitch: p('F', 'sharp', 4), duration: makeDuration('whole'), startTick: 1920, barIndex: 1 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(count(xml, '<accidental>sharp</accidental>')).toBe(2);
  });
});

describe('serializeLineToMusicXML — durations, dots, types', () => {
  it('a quarter note emits duration 480 and type quarter', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('quarter'), startTick: 0 }),
      note({ pitch: null, duration: makeDuration('half', 1), startTick: 480 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(xml).toContain('<duration>480</duration>');
    expect(xml).toContain('<type>quarter</type>');
  });

  it('a dotted quarter emits duration 720, type quarter, and one <dot/>', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('quarter', 1), startTick: 0 }),
      note({ pitch: null, duration: makeDuration('quarter'), startTick: 720 }),
      note({ pitch: null, duration: makeDuration('eighth'), startTick: 1200 }),
      note({ pitch: null, duration: makeDuration('eighth'), startTick: 1440 }),
      note({ pitch: null, duration: makeDuration('quarter'), startTick: 1680 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(xml).toContain('<duration>720</duration>');
    expect(count(xml, '<dot/>')).toBe(1);
  });

  it('maps base durations to MusicXML type names (eighth -> eighth, sixteenth -> 16th)', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('eighth'), startTick: 0 }),
      note({ pitch: p('D', 'natural', 4), duration: makeDuration('sixteenth'), startTick: 240 }),
      note({ pitch: null, duration: makeDuration('sixteenth'), startTick: 360 }),
      note({ pitch: null, duration: makeDuration('half', 1), startTick: 480 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(xml).toContain('<type>eighth</type>');
    expect(xml).toContain('<type>16th</type>');
  });
});

describe('serializeLineToMusicXML — tuplets', () => {
  it('an eighth triplet emits time-modification 3/2 and tuplet notations', () => {
    const trip = makeDuration('eighth', 0, { numerator: 3, denominator: 2 });
    expect(trip.ticks).toBe(160);
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: trip, startTick: 0 }),
      note({ pitch: p('D', 'natural', 4), duration: trip, startTick: 160 }),
      note({ pitch: p('E', 'natural', 4), duration: trip, startTick: 320 }),
      note({ pitch: null, duration: makeDuration('half', 1), startTick: 480 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    const tm = block(xml, 'time-modification');
    expect(tm).toContain('<actual-notes>3</actual-notes>');
    expect(tm).toContain('<normal-notes>2</normal-notes>');
    expect(xml).toContain('<tuplet type="start"');
    expect(xml).toContain('<tuplet type="stop"');
  });
});

describe('serializeLineToMusicXML — rests', () => {
  it('a rest emits <rest/> and a duration but no <pitch>', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: null, duration: makeDuration('whole'), startTick: 0 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(xml).toContain('<rest/>');
    expect(xml).toContain('<duration>1920</duration>');
    expect(xml).not.toContain('<pitch>');
  });

  it('a mix of rest and note: the note has a pitch, the rest does not', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('half'), startTick: 0 }),
      note({ pitch: null, duration: makeDuration('half'), startTick: 960 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(count(xml, '<note>')).toBe(2);
    expect(count(xml, '<rest/>')).toBe(1);
    expect(count(xml, '<pitch>')).toBe(1);
  });
});

describe('serializeLineToMusicXML — ties', () => {
  it('a tied pair emits tie start on the first note and tie stop on the second', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 2, [
      note({
        pitch: p('C', 'natural', 4),
        duration: makeDuration('whole'),
        startTick: 0,
        barIndex: 0,
        tiedToNext: true,
      }),
      note({
        pitch: p('C', 'natural', 4),
        duration: makeDuration('whole'),
        startTick: 1920,
        barIndex: 1,
        tiedToNext: false,
      }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
    // Notations carry the curved <tied> element too.
    expect(xml).toContain('<tied type="start"/>');
    expect(xml).toContain('<tied type="stop"/>');
  });

  // Regression: an orphan tie start must never be emitted. A `tiedToNext:true`
  // note whose successor is DIFFERENTLY spelled (no possible STOP) must NOT emit
  // a tie START — otherwise the output is a tie that never resolves (1 start /
  // 0 stops): well-formed but semantically invalid MusicXML.
  it('does not emit a tie start when the next note has a different pitch (within a bar)', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({
        pitch: p('C', 'natural', 5),
        duration: makeDuration('half'),
        startTick: 0,
        barIndex: 0,
        tiedToNext: true,
      }),
      note({
        pitch: p('D', 'natural', 5),
        duration: makeDuration('half'),
        startTick: 960,
        barIndex: 0,
        tiedToNext: false,
      }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(count(xml, '<tie type="start"/>')).toBe(0);
    expect(count(xml, '<tie type="stop"/>')).toBe(0);
    expect(count(xml, '<tied type="start"/>')).toBe(0);
    expect(count(xml, '<tied type="stop"/>')).toBe(0);
  });

  it('does not emit an orphan tie start across a barline when the next measure differs', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 2, [
      note({
        pitch: p('C', 'natural', 4),
        duration: makeDuration('whole'),
        startTick: 0,
        barIndex: 0,
        tiedToNext: true,
      }),
      note({
        pitch: p('D', 'natural', 4),
        duration: makeDuration('whole'),
        startTick: 1920,
        barIndex: 1,
        tiedToNext: false,
      }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(count(xml, '<tie type="start"/>')).toBe(0);
    expect(count(xml, '<tie type="stop"/>')).toBe(0);
  });

  it('does not emit a tie start when tiedToNext is set on the very last note (nothing follows)', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({
        pitch: p('C', 'natural', 4),
        duration: makeDuration('whole'),
        startTick: 0,
        barIndex: 0,
        tiedToNext: true,
      }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(count(xml, '<tie type="start"/>')).toBe(0);
    expect(count(xml, '<tie type="stop"/>')).toBe(0);
  });

  // Invariant: across any serialized line, tie starts and tie stops are balanced
  // (every start has its matching stop). Mix valid and invalid tie intents.
  it('keeps tie start and stop counts balanced even with a mix of matched and unmatched ties', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 2, [
      // bar 0: C4 ties to a same-pitch C4 within the bar (valid -> 1 start/1 stop)
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('half'), startTick: 0, barIndex: 0, tiedToNext: true }),
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('half'), startTick: 960, barIndex: 0, tiedToNext: true }),
      // last note of bar 0 (the C4 above) ties into bar 1's first note, which is a
      // DIFFERENT pitch (D4) -> must NOT start a cross-bar tie.
      note({ pitch: p('D', 'natural', 4), duration: makeDuration('whole'), startTick: 1920, barIndex: 1, tiedToNext: false }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(count(xml, '<tie type="start"/>')).toBe(count(xml, '<tie type="stop"/>'));
    expect(count(xml, '<tied type="start"/>')).toBe(count(xml, '<tied type="stop"/>'));
    // Exactly one valid tie pair (the within-bar C4-C4).
    expect(count(xml, '<tie type="start"/>')).toBe(1);
    expect(count(xml, '<tie type="stop"/>')).toBe(1);
  });
});

describe('serializeLineToMusicXML — voice and staff', () => {
  it('every note declares voice 1', () => {
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: makeDuration('half'), startTick: 0 }),
      note({ pitch: p('D', 'natural', 4), duration: makeDuration('half'), startTick: 960 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    expect(count(xml, '<voice>1</voice>')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Each rendered <measure> must FILL THE BAR two ways: by <duration> (the tick
// total) AND by the VISUAL notation (<type> + <dot/> + <time-modification>),
// because renderers (OSMD / MuseScore) lay notes out from the notation, not from
// <duration>. A note whose <type>/<dots>/<time-modification> disagrees with its
// <duration> makes a bar look short (e.g. a "3-beat" 4/4 bar) and desyncs the
// tick-driven cursor from the drawn notes. (Regression: this was the bug a human
// saw — a 4/4 bar that rendered as quarter + half = 3 beats, with a triplet line.)
// ---------------------------------------------------------------------------

const TYPE_TO_BASE: Readonly<Record<string, BaseDuration>> = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  '16th': 'sixteenth',
  '32nd': 'thirtySecond',
};

/** Split a serialized score into per-measure XML chunks (the inner content of each
 *  <measure>...</measure>), in order. */
function measureChunks(xml: string): string[] {
  return [...xml.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)].map((m) => m[1]!);
}

/** Sum of <duration> values in one measure chunk (the authoritative tick total). */
function measureDurationSum(measure: string): number {
  return [...measure.matchAll(/<duration>(\d+)<\/duration>/g)].reduce(
    (acc, m) => acc + Number(m[1]),
    0,
  );
}

/**
 * Sum of the VISUAL tick length of every <note> in one measure, derived ONLY from its
 * notation (<type>, <dot/>, <time-modification>) — i.e. exactly what a renderer draws.
 * Must equal the bar length, otherwise the bar looks wrong even if <duration> is right.
 */
function measureVisualSum(measure: string): number {
  const notes = [...measure.matchAll(/<note>([\s\S]*?)<\/note>/g)].map((m) => m[1]!);
  let sum = 0;
  for (const n of notes) {
    const type = /<type>([^<]+)<\/type>/.exec(n)?.[1];
    if (type === undefined) {
      throw new Error(`[TEST] note has no <type>: ${n}`);
    }
    const base = TYPE_TO_BASE[type];
    if (base === undefined) {
      throw new Error(`[TEST] unknown <type> ${type}`);
    }
    const dots = (n.match(/<dot\/>/g)?.length ?? 0) as 0 | 1 | 2;
    const actual = /<actual-notes>(\d+)<\/actual-notes>/.exec(n)?.[1];
    const normal = /<normal-notes>(\d+)<\/normal-notes>/.exec(n)?.[1];
    const tuplet =
      actual !== undefined && normal !== undefined
        ? { numerator: Number(actual), denominator: Number(normal) }
        : undefined;
    sum += computeTicks(base, dots, tuplet);
  }
  return sum;
}

describe('serializeLineToMusicXML — every measure fills the bar (duration AND visual)', () => {
  it('hand-built triplet bar: both <duration> and visual notation sum to the bar', () => {
    // An eighth-triplet group (3*160=480) then a dotted half (1440) -> 1920 ticks.
    const trip = makeDuration('eighth', 0, { numerator: 3, denominator: 2 });
    const line = buildLine(C_MAJOR, FOUR_FOUR, 1, [
      note({ pitch: p('C', 'natural', 4), duration: trip, startTick: 0, isStrongBeat: true }),
      note({ pitch: p('D', 'natural', 4), duration: trip, startTick: 160 }),
      note({ pitch: p('E', 'natural', 4), duration: trip, startTick: 320 }),
      note({ pitch: p('F', 'natural', 4), duration: makeDuration('half', 1), startTick: 480 }),
    ]);
    const xml = serializeLineToMusicXML(line);
    const tpb = ticksPerBar(FOUR_FOUR);
    const [measure] = measureChunks(xml);
    expect(measureDurationSum(measure!)).toBe(tpb);
    expect(measureVisualSum(measure!)).toBe(tpb);
  });

  it('generated lines (incl. triplets) — EVERY measure fills the bar both ways', () => {
    const tpb = ticksPerBar(FOUR_FOUR);
    const keys: Key[] = [C_MAJOR, G_MAJOR, A_MINOR];
    const positions = [
      makeNeckPosition(1, 6, 0, 5, 'open'),
      makeNeckPosition(1, 6, 4, 8, 'V'),
    ];
    const barCounts = [2, 4];
    // difficulty 4 admits the triplet/sixteenth motifs the property test never reaches.
    const difficulties: LineConfig['difficulty'][] = [3, 4];
    const densities: LineConfig['accidentalsDensity'][] = ['none', 'low', 'medium'];

    let total = 0;
    let withTriplet = 0;
    let seed = 0;
    for (const key of keys) {
      for (const position of positions) {
        for (const barCount of barCounts) {
          for (const difficulty of difficulties) {
            for (const accidentalsDensity of densities) {
              for (let r = 0; r < 6; r++) {
                const cfg: LineConfig = {
                  key,
                  timeSignature: FOUR_FOUR,
                  position,
                  tempo: 90,
                  barCount,
                  difficulty,
                  accidentalsDensity,
                };
                const line = generateLine(cfg, seed++, '2026-06-04T00:00:00.000Z');
                total++;
                if (line.notes.some((n) => n.duration.tuplet !== undefined)) {
                  withTriplet++;
                }
                const xml = serializeLineToMusicXML(line);
                const chunks = measureChunks(xml);
                expect(chunks.length).toBe(barCount);
                chunks.forEach((chunk, mi) => {
                  expect(
                    measureDurationSum(chunk),
                    `seed=${seed - 1} measure ${mi} <duration> sum`,
                  ).toBe(tpb);
                  expect(
                    measureVisualSum(chunk),
                    `seed=${seed - 1} measure ${mi} VISUAL (type/dots/tuplet) sum`,
                  ).toBe(tpb);
                });
              }
            }
          }
        }
      }
    }
    // Confirm the run actually exercised triplet motifs (otherwise the regression
    // path wouldn't be covered).
    expect(total).toBeGreaterThan(100);
    expect(withTriplet, 'expected some generated lines to contain triplets').toBeGreaterThan(0);
  });
});
