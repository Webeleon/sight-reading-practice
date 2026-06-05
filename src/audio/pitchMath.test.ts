// Tests for the PURE pitch/frequency helpers. Runs under the vitest NODE
// environment (no Web Audio / DOM): these helpers are deliberately DOM-free so
// frequency->MIDI conversion and clarity gating are testable without hardware
// (the live detector accuracy is Human Review Gate 3).

import { describe, it, expect } from 'vitest';
import {
  A4_HZ,
  GUITAR_MIDI_LOW,
  GUITAR_MIDI_HIGH,
  frequencyToMidiFloat,
  frequencyToMidi,
  midiToFrequency,
  centsOffNearestMidi,
  isInGuitarRange,
  isUsableDetection,
} from './pitchMath.js';

describe('frequencyToMidi', () => {
  it('maps concert A (440 Hz) to MIDI 69 exactly', () => {
    expect(frequencyToMidiFloat(A4_HZ)).toBeCloseTo(69, 10);
    expect(frequencyToMidi(A4_HZ)).toBe(69);
  });

  it('maps middle C (~261.63 Hz) to MIDI 60', () => {
    expect(frequencyToMidi(261.6256)).toBe(60);
  });

  it('maps standard-tuning guitar open strings to their MIDI numbers', () => {
    // E2/A2/D3/G3/B3/E4 == MIDI 40,45,50,55,59,64 (string 1..6, low to high).
    const open: Array<[number, number]> = [
      [82.41, 40], // low E (E2)
      [110.0, 45], // A2
      [146.83, 50], // D3
      [196.0, 55], // G3
      [246.94, 59], // B3
      [329.63, 64], // high E (E4)
    ];
    for (const [hz, midi] of open) {
      expect(frequencyToMidi(hz)).toBe(midi);
    }
  });

  it('round-trips midi -> frequency -> midi across the guitar range', () => {
    for (let m = GUITAR_MIDI_LOW; m <= GUITAR_MIDI_HIGH; m++) {
      expect(frequencyToMidi(midiToFrequency(m))).toBe(m);
    }
  });

  it('returns NaN for non-positive / invalid frequencies (pitchy 0 Hz "no pitch")', () => {
    expect(Number.isNaN(frequencyToMidi(0))).toBe(true);
    expect(Number.isNaN(frequencyToMidi(-5))).toBe(true);
    expect(Number.isNaN(frequencyToMidiFloat(Number.NaN))).toBe(true);
  });

  it('rounds to the nearest semitone (a slightly sharp/flat note still snaps)', () => {
    // A4 + ~30 cents is still nearest A4 (MIDI 69).
    const sharpA = midiToFrequency(69 + 0.3);
    expect(frequencyToMidi(sharpA)).toBe(69);
    // A4 + ~70 cents snaps up to A#4 (MIDI 70).
    const verySharpA = midiToFrequency(69 + 0.7);
    expect(frequencyToMidi(verySharpA)).toBe(70);
  });
});

describe('centsOffNearestMidi', () => {
  it('is ~0 for an in-tune note', () => {
    expect(centsOffNearestMidi(A4_HZ)).toBeCloseTo(0, 6);
  });
  it('reports ~+30 cents for a 30-cent-sharp note', () => {
    expect(centsOffNearestMidi(midiToFrequency(69.3))).toBeCloseTo(30, 4);
  });
  it('reports ~-25 cents for a 25-cent-flat note', () => {
    expect(centsOffNearestMidi(midiToFrequency(60 - 0.25))).toBeCloseTo(-25, 4);
  });
});

describe('isInGuitarRange', () => {
  it('accepts the documented guitar MIDI band [40,88] inclusive', () => {
    expect(isInGuitarRange(GUITAR_MIDI_LOW)).toBe(true);
    expect(isInGuitarRange(GUITAR_MIDI_HIGH)).toBe(true);
    expect(isInGuitarRange(64)).toBe(true);
  });
  it('rejects out-of-range / non-finite values (octave errors, noise, NaN)', () => {
    expect(isInGuitarRange(GUITAR_MIDI_LOW - 1)).toBe(false); // octave-low artifact
    expect(isInGuitarRange(GUITAR_MIDI_HIGH + 1)).toBe(false); // harmonic artifact
    expect(isInGuitarRange(Number.NaN)).toBe(false);
  });
});

describe('isUsableDetection (clarity gating)', () => {
  const floor = 0.6;
  it('accepts a clear, in-range note at/above the clarity floor', () => {
    expect(isUsableDetection(A4_HZ, 0.95, floor)).toBe(true);
    expect(isUsableDetection(A4_HZ, floor, floor)).toBe(true); // boundary is inclusive
  });
  it('rejects a note below the clarity floor (unreliable detection)', () => {
    expect(isUsableDetection(A4_HZ, floor - 0.01, floor)).toBe(false);
    expect(isUsableDetection(A4_HZ, 0, floor)).toBe(false); // pitchy "no pitch" clarity
  });
  it('rejects a clear-but-out-of-range detection (e.g. sub-bass hum at high clarity)', () => {
    const subBass = midiToFrequency(GUITAR_MIDI_LOW - 12); // an octave below low E
    expect(isUsableDetection(subBass, 0.99, floor)).toBe(false);
  });
  it('rejects a 0 Hz / NaN-clarity frame (silence)', () => {
    expect(isUsableDetection(0, 0, floor)).toBe(false);
    expect(isUsableDetection(A4_HZ, Number.NaN, floor)).toBe(false);
  });
});
