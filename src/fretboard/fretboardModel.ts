// Fretboard model: for each string (1-6) and fret (0-17), the MIDI pitch produced.
//
// STRING NUMBERING IS INVERTED: string 1 = low E (MIDI 40), string 6 = high E (MIDI 64).
//
// We model only the SOUNDING pitch (MIDI / pitch-class). Spelling (note name +
// accidental) is intentionally NOT resolved here: the same fret means a different
// spelling in different key contexts, so the caller spells against its key via
// midiToPitch(midi, key). This module is the spelling-agnostic source of truth.

import { openStringMidi } from './tuning.js';

/** Highest fret modeled (inclusive). 0 = open string. */
export const MAX_FRET = 17;

/** A single physical string/fret location and the MIDI pitch it sounds. */
export interface FretboardCell {
  string: number; // 1 = low E ... 6 = high E (INVERTED convention)
  fret: number; // 0 = open
  midi: number; // sounding MIDI number
  pitchClass: number; // 0-11 (C = 0)
}

/**
 * MIDI number produced by fretting `fret` on `stringNumber`. fret 0 = open string.
 * @param stringNumber 1 = low E (MIDI 40) ... 6 = high E (MIDI 64). INVERTED convention.
 */
export function midiAt(stringNumber: number, fret: number): number {
  if (fret < 0 || fret > MAX_FRET) {
    throw new Error(`invalid fret ${fret}; expected 0..${MAX_FRET}`);
  }
  return openStringMidi(stringNumber) + fret;
}

/** Pitch class (0-11) produced at a string/fret. */
export function pitchClassAt(stringNumber: number, fret: number): number {
  return ((midiAt(stringNumber, fret) % 12) + 12) % 12;
}

/**
 * The full fretboard as a flat list of cells, string 1 first, fret 0 first.
 * 6 strings * (MAX_FRET + 1) frets.
 */
export function buildFretboardModel(): FretboardCell[] {
  const cells: FretboardCell[] = [];
  for (let string = 1; string <= 6; string++) {
    for (let fret = 0; fret <= MAX_FRET; fret++) {
      const midi = midiAt(string, fret);
      cells.push({ string, fret, midi, pitchClass: ((midi % 12) + 12) % 12 });
    }
  }
  return cells;
}
