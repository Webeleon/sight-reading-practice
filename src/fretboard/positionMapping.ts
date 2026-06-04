// Position -> playable-pitch mapping.
//
// Given a NeckPosition (a rectangle of strings x frets) we enumerate the DISTINCT
// sounding pitches reachable inside it, each annotated with every string/fret combo
// that produces it. Spelling is deliberately deferred: we return MIDI + pitch class,
// and the caller spells against its key context via midiToPitch(midi, key). This keeps
// the fretboard module spelling-agnostic (one fret = different spelling per key).
//
// STRING NUMBERING IS INVERTED: string 1 = low E (MIDI 40), string 6 = high E (MIDI 64).

import type { NeckPosition, NoteName, Accidental } from '../domain/index.js';
import { pitchToMidi } from '../domain/index.js';
import { midiAt } from './fretboardModel.js';

/** One string/fret location. string 1 = low E (INVERTED convention), fret 0 = open. */
export interface StringFret {
  string: number;
  fret: number;
}

/**
 * A distinct sounding pitch playable within a position, plus the locations that
 * produce it. `pitch` is unspelled here: we expose `midi` and `pitchClass` and leave
 * name+accidental to the caller (it depends on key context).
 */
export interface PlayablePitch {
  midi: number;
  pitchClass: number; // 0-11 (C = 0)
  stringFretOptions: StringFret[];
}

/**
 * The allowed string numbers for a position, intersected with an optional subset.
 * Honors the INVERTED convention (1 = low E ... 6 = high E).
 */
function allowedStrings(
  position: NeckPosition,
  stringSubset?: number[],
): number[] {
  const out: number[] = [];
  for (let s = position.stringRange.low; s <= position.stringRange.high; s++) {
    if (stringSubset === undefined || stringSubset.includes(s)) {
      out.push(s);
    }
  }
  return out;
}

/**
 * Distinct sounding pitches playable within `position`'s fret range on the allowed
 * strings, each annotated with the string/fret options that produce it. Sorted
 * ascending by MIDI; within each pitch, options are sorted by string then fret.
 *
 * Spelling is NOT resolved here — see module header. Returns pitch-class/MIDI info
 * sufficient for the caller to spell against a Key via midiToPitch.
 *
 * @param stringSubset optional restriction to specific strings (INVERTED numbering).
 */
export function computePlayablePitches(
  position: NeckPosition,
  stringSubset?: number[],
): PlayablePitch[] {
  const byMidi = new Map<number, StringFret[]>();
  const strings = allowedStrings(position, stringSubset);

  for (const string of strings) {
    for (
      let fret = position.fretRange.low;
      fret <= position.fretRange.high;
      fret++
    ) {
      const midi = midiAt(string, fret);
      const options = byMidi.get(midi);
      if (options === undefined) {
        byMidi.set(midi, [{ string, fret }]);
      } else {
        options.push({ string, fret });
      }
    }
  }

  return [...byMidi.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([midi, options]) => ({
      midi,
      pitchClass: ((midi % 12) + 12) % 12,
      stringFretOptions: options.sort((x, y) =>
        x.string !== y.string ? x.string - y.string : x.fret - y.fret,
      ),
    }));
}

/**
 * Whether a pitch (by sounding MIDI) is playable somewhere within the position's fret
 * range on the allowed strings. Agrees with computePlayablePitches by construction.
 *
 * Accepts either a domain Pitch ({ name, accidental, octave }) or a raw MIDI number,
 * so callers that already have a spelled pitch don't have to convert. We compare by
 * sounding MIDI, so enharmonic spellings of the same sound match.
 *
 * @param stringSubset optional restriction to specific strings (INVERTED numbering).
 */
export function isPlayableInPosition(
  pitch: { name: NoteName; accidental: Accidental; octave: number } | number,
  position: NeckPosition,
  stringSubset?: number[],
): boolean {
  const midi = typeof pitch === 'number' ? pitch : pitchToMidi(pitch);
  for (const string of allowedStrings(position, stringSubset)) {
    for (
      let fret = position.fretRange.low;
      fret <= position.fretRange.high;
      fret++
    ) {
      if (midiAt(string, fret) === midi) {
        return true;
      }
    }
  }
  return false;
}
