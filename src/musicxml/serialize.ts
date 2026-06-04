// Line -> MusicXML serialization (single-voice subset).
//
// Hand-written serializer for exactly the subset the prototype needs (the brief
// says not to pull in a heavy notation library): a single part, treble clef with
// the guitar clef-octave-change of -1 (guitar reads at written pitch, treble clef,
// sounding an octave lower), one voice, key + time signatures, notes with correct
// pitch spelling (step/alter/octave), durations (dotted + tuplet), ties, and rests.
//
// Divisions are 480 (== TICKS_PER_QUARTER), so a note's <duration> in MusicXML is
// exactly its tick count — no conversion needed.
//
// Pure module: NO electron/react/DOM imports. String numbering convention does not
// apply here (this module never deals in string/fret numbers).

import type { Line, LineNote } from '../domain/line.js';
import type { Pitch, NoteName, Accidental } from '../domain/pitch.js';
import type { Key } from '../domain/key.js';
import type { TimeSignature } from '../domain/timeSignature.js';
import type { BaseDuration, Duration } from '../domain/duration.js';
import { TICKS_PER_QUARTER } from '../domain/duration.js';
import { keySignature } from '../domain/key.js';

// Divisions per quarter note. MusicXML <duration> is measured in these units, and
// we deliberately set it equal to TICKS_PER_QUARTER so duration == tick count.
const DIVISIONS = TICKS_PER_QUARTER; // 480

// MusicXML <type> name for each of our base durations.
const TYPE_NAME: Readonly<Record<BaseDuration, string>> = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  sixteenth: '16th',
  thirtySecond: '32nd',
};

// Semitone alter value for each accidental (MusicXML <alter>).
const ALTER: Readonly<Record<Accidental, number>> = {
  doubleFlat: -2,
  flat: -1,
  natural: 0,
  sharp: 1,
  doubleSharp: 2,
};

// MusicXML <accidental> display name for each accidental.
const ACCIDENTAL_NAME: Readonly<Record<Accidental, string>> = {
  doubleFlat: 'flat-flat',
  flat: 'flat',
  natural: 'natural',
  sharp: 'sharp',
  doubleSharp: 'double-sharp',
};

// Standard order in which letters take sharps / flats in a key signature.
const SHARP_ORDER: ReadonlyArray<NoteName> = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: ReadonlyArray<NoteName> = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Circle-of-fifths position: sharps are positive, flats negative, C major = 0. */
function fifthsOf(key: Key): number {
  const sig = keySignature(key);
  return 'sharps' in sig ? sig.sharps : -sig.flats;
}

/**
 * The accidental implied by the key signature for each letter (letters absent from
 * the map are natural). Used as the per-measure baseline for accidental display:
 * a note matching its key-signature accidental needs no explicit <accidental>.
 */
function signatureAccidentals(fifths: number): Map<NoteName, Accidental> {
  const out = new Map<NoteName, Accidental>();
  if (fifths > 0) {
    for (let i = 0; i < fifths; i++) out.set(SHARP_ORDER[i]!, 'sharp');
  } else if (fifths < 0) {
    for (let i = 0; i < -fifths; i++) out.set(FLAT_ORDER[i]!, 'flat');
  }
  return out;
}

// --- XML escaping ------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- A tiny indent-aware line buffer -----------------------------------------

class XmlBuffer {
  private lines: string[] = [];
  private depth = 0;

  open(tag: string): void {
    this.lines.push(`${this.pad()}<${tag}>`);
    this.depth += 1;
  }

  openAttr(tag: string, attrs: string): void {
    this.lines.push(`${this.pad()}<${tag} ${attrs}>`);
    this.depth += 1;
  }

  close(tag: string): void {
    this.depth -= 1;
    this.lines.push(`${this.pad()}</${tag}>`);
  }

  /** Leaf element with text content: <tag>value</tag>. */
  leaf(tag: string, value: string | number): void {
    this.lines.push(`${this.pad()}<${tag}>${value}</${tag}>`);
  }

  /** Self-closing element, optionally with attributes: <tag/> or <tag attr/>. */
  empty(tag: string, attrs?: string): void {
    this.lines.push(`${this.pad()}<${tag}${attrs ? ` ${attrs}` : ''}/>`);
  }

  raw(line: string): void {
    this.lines.push(`${this.pad()}${line}`);
  }

  private pad(): string {
    return '  '.repeat(this.depth);
  }

  toString(): string {
    return this.lines.join('\n');
  }
}

// --- Measure / note serialization --------------------------------------------

/** Stable key identifying a written note position on the staff: letter + octave. */
function staffKey(p: Pitch): string {
  return `${p.name}${p.octave}`;
}

function writeAttributes(xml: XmlBuffer, key: Key, ts: TimeSignature): void {
  xml.open('attributes');
  xml.leaf('divisions', DIVISIONS);

  xml.open('key');
  xml.leaf('fifths', fifthsOf(key));
  xml.leaf('mode', key.mode);
  xml.close('key');

  xml.open('time');
  xml.leaf('beats', ts.beats);
  xml.leaf('beat-type', ts.beatUnit);
  xml.close('time');

  // Treble clef, with the guitar clef-octave-change: written treble, sounds 8vb.
  xml.open('clef');
  xml.leaf('sign', 'G');
  xml.leaf('line', 2);
  xml.leaf('clef-octave-change', -1);
  xml.close('clef');

  xml.close('attributes');
}

/**
 * Decide whether an explicit <accidental> must be shown for `pitch`, given the
 * accidentals already in effect this measure. Mutates `active` to record the new
 * state. The baseline for a staff position is the key-signature accidental for its
 * letter; an explicit accidental is shown whenever the note differs from whatever
 * is currently sounding at that staff position.
 */
function needsAccidental(
  pitch: Pitch,
  sigAccidentals: ReadonlyMap<NoteName, Accidental>,
  active: Map<string, Accidental>,
): boolean {
  const sk = staffKey(pitch);
  const current = active.get(sk) ?? sigAccidentals.get(pitch.name) ?? 'natural';
  if (current === pitch.accidental) {
    return false;
  }
  active.set(sk, pitch.accidental);
  return true;
}

function writePitch(xml: XmlBuffer, pitch: Pitch): void {
  xml.open('pitch');
  xml.leaf('step', pitch.name);
  const alter = ALTER[pitch.accidental];
  if (alter !== 0) {
    xml.leaf('alter', alter);
  }
  xml.leaf('octave', pitch.octave);
  xml.close('pitch');
}

type TupletBracket = 'start' | 'stop' | 'inner' | 'none';

function writeNote(
  xml: XmlBuffer,
  ln: LineNote,
  tieStop: boolean,
  tieStart: boolean,
  tupletBracket: TupletBracket,
  sigAccidentals: ReadonlyMap<NoteName, Accidental>,
  active: Map<string, Accidental>,
): void {
  const d: Duration = ln.duration;
  const isRest = ln.pitch === null;

  // Compute accidental display BEFORE opening the element (it affects emit order,
  // but more importantly keeps the active-accidental bookkeeping in one place).
  const showAccidental =
    ln.pitch !== null && needsAccidental(ln.pitch, sigAccidentals, active);

  xml.open('note');

  if (isRest) {
    xml.empty('rest');
  } else {
    writePitch(xml, ln.pitch!);
  }

  xml.leaf('duration', d.ticks);

  // <tie> is the sounded-tie element (playback); it precedes <type>.
  if (!isRest && tieStop) xml.empty('tie', 'type="stop"');
  if (!isRest && tieStart) xml.empty('tie', 'type="start"');

  xml.leaf('voice', 1);
  xml.leaf('type', TYPE_NAME[d.base]);

  for (let i = 0; i < d.dots; i++) {
    xml.empty('dot');
  }

  if (showAccidental && ln.pitch !== null) {
    xml.leaf('accidental', ACCIDENTAL_NAME[ln.pitch.accidental]);
  }

  if (d.tuplet) {
    xml.open('time-modification');
    xml.leaf('actual-notes', d.tuplet.numerator);
    xml.leaf('normal-notes', d.tuplet.denominator);
    xml.close('time-modification');
  }

  // Notations: the curved tie marks (<tied>) and tuplet brackets live here.
  // The tuplet BRACKET is only drawn on the first (start) and last (stop) note of
  // a run; inner notes still carry <time-modification> but no bracket element.
  const drawTupletBracket = tupletBracket === 'start' || tupletBracket === 'stop';
  const needNotations =
    (!isRest && (tieStop || tieStart)) || drawTupletBracket;
  if (needNotations) {
    xml.open('notations');
    if (!isRest && tieStop) xml.empty('tied', 'type="stop"');
    if (!isRest && tieStart) xml.empty('tied', 'type="start"');
    if (tupletBracket === 'start') xml.empty('tuplet', 'type="start"');
    if (tupletBracket === 'stop') xml.empty('tuplet', 'type="stop"');
    xml.close('notations');
  }

  xml.close('note');
}

/**
 * Serialize one measure. `notes` are this measure's notes in time order.
 * `firstMeasure` toggles emission of <attributes>. Accidental state resets per
 * measure (standard notation rule).
 *
 * `tieStopFirst` indicates the measure's first note is the STOP end of a tie that
 * began in the previous measure (ties span barlines, so this is threaded in from
 * the caller).
 *
 * `tieStartLastResolves` indicates the measure's last note (if it has
 * `tiedToNext`) ties into a same-spelled first note of the NEXT measure. It gates
 * the cross-bar tie START so that a START is emitted only when it will be matched
 * by a STOP — without it a `tiedToNext` last note before a differently-spelled
 * (or absent) next-measure note would emit an orphan tie start (invalid MusicXML).
 */
function writeMeasure(
  xml: XmlBuffer,
  measureNumber: number,
  notes: LineNote[],
  key: Key,
  ts: TimeSignature,
  firstMeasure: boolean,
  sigAccidentals: ReadonlyMap<NoteName, Accidental>,
  tieStopFirst: boolean,
  tieStartLastResolves: boolean,
): void {
  xml.openAttr('measure', `number="${measureNumber}"`);
  if (firstMeasure) {
    writeAttributes(xml, key, ts);
  }

  // Active accidentals reset at the start of every measure.
  const active = new Map<string, Accidental>();

  for (let i = 0; i < notes.length; i++) {
    const ln = notes[i]!;
    const prev = i > 0 ? notes[i - 1]! : null;
    const next = i + 1 < notes.length ? notes[i + 1]! : null;

    // A note carries a tie STOP if the previous note (in this measure, or the last
    // note of the previous measure via `tieStopFirst`) tied into it and they share
    // the same spelled pitch.
    const tieStop =
      i === 0
        ? tieStopFirst
        : prev !== null &&
          prev.tiedToNext &&
          prev.pitch !== null &&
          ln.pitch !== null &&
          samePitch(prev.pitch, ln.pitch);

    // A note carries a tie START only when its `tiedToNext` will actually be
    // matched by a STOP on the next sounded note of identical spelling. For an
    // interior note that means the in-measure successor shares the spelling; for
    // the measure's last note it means the next measure's first note does
    // (`tieStartLastResolves`, computed by the caller). Gating here keeps
    // start/stop counts balanced even if `tiedToNext` is ever set across a
    // differently-spelled boundary (which would be a semantically invalid tie).
    const tieStart =
      ln.pitch !== null &&
      ln.tiedToNext &&
      (next !== null
        ? next.pitch !== null && samePitch(ln.pitch, next.pitch)
        : tieStartLastResolves);

    // Tuplet bracketing: a run is a maximal stretch of consecutive tuplet notes
    // within the measure. First note = start, last = stop, middle = inner.
    let bracket: TupletBracket = 'none';
    if (ln.duration.tuplet) {
      const prevIsTuplet = prev !== null && prev.duration.tuplet !== undefined;
      const nextIsTuplet = next !== null && next.duration.tuplet !== undefined;
      if (!prevIsTuplet) bracket = 'start';
      else if (!nextIsTuplet) bracket = 'stop';
      else bracket = 'inner';
    }

    writeNote(xml, ln, tieStop, tieStart, bracket, sigAccidentals, active);
  }

  xml.close('measure');
}

function samePitch(a: Pitch, b: Pitch): boolean {
  return a.name === b.name && a.accidental === b.accidental && a.octave === b.octave;
}

// --- Public API --------------------------------------------------------------

/**
 * Serialize a generated Line to a MusicXML 3.1 score-partwise XML string.
 *
 * Subset: single part, one voice, treble clef with clef-octave-change=-1 (guitar),
 * key + time signatures, spelled pitches, dotted/tuplet durations, ties, and rests.
 * Accidentals are shown only where needed (respecting the key signature and prior
 * accidentals in the same measure).
 */
export function serializeLineToMusicXML(line: Line): string {
  const xml = new XmlBuffer();
  const partId = 'P1';
  const fifths = fifthsOf(line.key);
  const sigAccidentals = signatureAccidentals(fifths);

  // Group notes into measures by barIndex (0-based). Measures number from 1.
  const measures: LineNote[][] = Array.from(
    { length: line.barCount },
    () => [] as LineNote[],
  );
  for (const n of line.notes) {
    const idx = n.barIndex;
    if (idx >= 0 && idx < measures.length) {
      measures[idx]!.push(n);
    } else {
      // Out-of-range bar index would corrupt the score silently; surface it.
      throw new Error(
        `[MXML] note barIndex ${idx} out of range 0..${line.barCount - 1}`,
      );
    }
  }
  // Keep each measure's notes in start-tick order.
  for (const m of measures) {
    m.sort((a, b) => a.startTick - b.startTick);
  }

  xml.raw('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  xml.raw(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  xml.openAttr('score-partwise', 'version="3.1"');

  // Identification / work header (minimal; helps MuseScore/OSMD display).
  xml.open('part-list');
  xml.openAttr('score-part', `id="${partId}"`);
  xml.leaf('part-name', esc('Guitar'));
  xml.close('score-part');
  xml.close('part-list');

  // A cross-barline tie resolves when measure i's last note has `tiedToNext` and
  // measure i+1's first note shares the same spelled pitch. We index this by the
  // STARTING measure so the START emission can be gated symmetrically with the
  // STOP emission below.
  const crossBarTieResolves: boolean[] = measures.map((m, i) => {
    if (i + 1 >= measures.length) return false;
    const last = m[m.length - 1];
    const nextFirst = measures[i + 1]![0];
    return (
      last !== undefined &&
      nextFirst !== undefined &&
      last.tiedToNext &&
      last.pitch !== null &&
      nextFirst.pitch !== null &&
      samePitch(last.pitch, nextFirst.pitch)
    );
  });

  xml.openAttr('part', `id="${partId}"`);
  for (let i = 0; i < measures.length; i++) {
    const thisMeasure = measures[i]!;
    // A tie that crosses the barline STOPS here when the previous measure's last
    // note tied into this measure's first note (same spelled pitch). That is
    // exactly `crossBarTieResolves` indexed by the previous (starting) measure.
    const tieStopFirst = i > 0 ? crossBarTieResolves[i - 1]! : false;
    writeMeasure(
      xml,
      i + 1,
      thisMeasure,
      line.key,
      line.timeSignature,
      i === 0,
      sigAccidentals,
      tieStopFirst,
      crossBarTieResolves[i]!,
    );
  }
  xml.close('part');

  xml.close('score-partwise');
  return xml.toString() + '\n';
}
