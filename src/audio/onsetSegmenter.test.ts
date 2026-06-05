// Tests for the PURE onset segmenter. Runs under the vitest NODE environment: the
// segmenter is DOM-free, so "when does a new note begin" is testable over a
// recorded array of synthetic pitch frames without any audio hardware (live
// detection accuracy is Human Review Gate 3).
//
// We synthesise per-frame PitchSample streams at a fixed analysis hop and assert
// the committed DetectedNote onsets: a fresh attack, a pitch change, a repeated
// (re-articulated) note across a silence gap, attack-transient debouncing, and
// clarity gating.

import { describe, it, expect } from 'vitest';
import {
  OnsetSegmenter,
  segment,
  DEFAULT_SEGMENTER_CONFIG,
  type PitchSample,
  type SegmenterConfig,
} from './onsetSegmenter.js';
import { midiToFrequency } from './pitchMath.js';

const HOP_MS = 16; // ~rAF cadence

/** Build `count` consecutive usable frames of a given MIDI note, starting at
 *  startMs, one every HOP_MS, all at the given clarity. */
function noteFrames(
  midi: number,
  count: number,
  startMs: number,
  clarity = 0.9,
): PitchSample[] {
  const out: PitchSample[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      timeMs: startMs + i * HOP_MS,
      frequencyHz: midiToFrequency(midi),
      clarity,
    });
  }
  return out;
}

/** Build `count` silence frames (clarity 0 -> unusable) starting at startMs. */
function silenceFrames(count: number, startMs: number): PitchSample[] {
  const out: PitchSample[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ timeMs: startMs + i * HOP_MS, frequencyHz: 0, clarity: 0 });
  }
  return out;
}

const cfg: SegmenterConfig = DEFAULT_SEGMENTER_CONFIG;

describe('OnsetSegmenter — single notes', () => {
  it('emits one onset for a sustained note, back-dated to the attack frame', () => {
    const samples = [
      ...silenceFrames(3, 0),
      ...noteFrames(64, 6, 100), // high E sustained
      ...silenceFrames(3, 200),
    ];
    const notes = segment(samples, cfg);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.midi).toBe(64);
    // onset is the FIRST frame of the run (100ms), not the stability-confirm frame.
    expect(notes[0]!.onsetMs).toBe(100);
    expect(notes[0]!.clarity).toBeGreaterThanOrEqual(0.9);
  });

  it('does NOT emit a note that never reaches the stability threshold', () => {
    // Only ONE usable frame (stabilityFrames default is 2) surrounded by silence.
    const samples = [
      ...silenceFrames(2, 0),
      ...noteFrames(60, 1, 50),
      ...silenceFrames(4, 70),
    ];
    expect(segment(samples, cfg)).toHaveLength(0);
  });

  it('emits nothing for pure silence', () => {
    expect(segment(silenceFrames(20, 0), cfg)).toHaveLength(0);
  });
});

describe('OnsetSegmenter — pitch changes', () => {
  it('emits a new onset when the stable pitch changes (legato slide of notes)', () => {
    const samples = [
      ...noteFrames(60, 4, 0), // C4
      ...noteFrames(62, 4, 64), // D4 (no silence between)
      ...noteFrames(64, 4, 128), // E4
    ];
    const notes = segment(samples, cfg);
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64]);
    expect(notes.map((n) => n.onsetMs)).toEqual([0, 64, 128]);
  });

  it('treats a single mid-sustain dropout frame as a continuation, not a new note', () => {
    // One unusable frame in the middle of a held note: because reArticulationGapMs
    // (60ms) exceeds a single 16ms hop, the note should NOT re-trigger... but note
    // that an unusable frame resets the run, so the run must re-stabilise. The key
    // assertion: a brief dropout does NOT produce TWO notes if the gap is short.
    const samples = [
      ...noteFrames(67, 4, 0), // G4 stable
      { timeMs: 64, frequencyHz: 0, clarity: 0 }, // 1-frame dropout (16ms gap)
      ...noteFrames(67, 4, 80), // resumes same pitch quickly
    ];
    const notes = segment(samples, cfg);
    // The short gap (16ms < 60ms reArticulationGapMs) means the resumed run is a
    // continuation: exactly one note total.
    expect(notes).toHaveLength(1);
    expect(notes[0]!.midi).toBe(67);
    expect(notes[0]!.onsetMs).toBe(0);
  });
});

describe('OnsetSegmenter — repeated (re-articulated) notes', () => {
  it('emits TWO onsets for the same pitch separated by a clear silence gap', () => {
    const samples = [
      ...noteFrames(60, 5, 0), // first C4
      ...silenceFrames(6, 80), // ~96ms of silence (> 60ms reArticulationGapMs)
      ...noteFrames(60, 5, 200), // second C4 (re-struck)
    ];
    const notes = segment(samples, cfg);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.midi)).toEqual([60, 60]);
    expect(notes[0]!.onsetMs).toBe(0);
    expect(notes[1]!.onsetMs).toBe(200);
  });
});

describe('OnsetSegmenter — clarity gating', () => {
  it('drops below-floor frames so a quiet/unclear note never onsets', () => {
    const samples = noteFrames(62, 6, 0, 0.4); // all below the 0.6 floor
    expect(segment(samples, cfg)).toHaveLength(0);
  });

  it('reports the max clarity seen across the run on the onset', () => {
    const samples = [
      { timeMs: 0, frequencyHz: midiToFrequency(64), clarity: 0.7 },
      { timeMs: 16, frequencyHz: midiToFrequency(64), clarity: 0.95 },
      { timeMs: 32, frequencyHz: midiToFrequency(64), clarity: 0.8 },
    ];
    const notes = segment(samples, cfg);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.clarity).toBeCloseTo(0.95, 5);
  });
});

describe('OnsetSegmenter — streaming reset', () => {
  it('reset() clears state so a second attempt segments independently', () => {
    const seg = new OnsetSegmenter(cfg);
    for (const s of noteFrames(60, 4, 0)) seg.push(s);
    seg.reset();
    const emitted: number[] = [];
    for (const s of noteFrames(72, 4, 0)) {
      const n = seg.push(s);
      if (n) emitted.push(n.midi);
    }
    expect(emitted).toEqual([72]); // fresh note, no leakage from before reset
  });
});

describe('OnsetSegmenter — custom config (Gate-3 tunability)', () => {
  it('honours a stricter stabilityFrames (more debounce -> later commit, same onset)', () => {
    const strict: SegmenterConfig = { ...cfg, stabilityFrames: 4 };
    // 3 frames < 4 -> no note; 4 frames -> note, onset still at the first frame.
    expect(segment(noteFrames(60, 3, 0), strict)).toHaveLength(0);
    const ok = segment(noteFrames(60, 4, 0), strict);
    expect(ok).toHaveLength(1);
    expect(ok[0]!.onsetMs).toBe(0);
  });
});
