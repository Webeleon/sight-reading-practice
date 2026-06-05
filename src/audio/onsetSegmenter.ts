// onsetSegmenter.ts — PURE note-onset segmentation.
//
// The pitch detector produces a CONTINUOUS stream of per-frame pitch samples
// (one every ~analysis-hop ms while audio flows). The evaluation pipeline,
// however, consumes discrete DetectedNote ONSET records { midi, onsetMs,
// clarity } (one per note the player actually struck). This module bridges the
// two: it decides WHEN a new note begins.
//
// IMPORTANT: like pitchMath.ts this file lives under src/audio (tsconfig.ui) but
// uses NO Web Audio / DOM / React / Electron — it is plain arithmetic over plain
// PitchSample records, so it is unit-testable in the vitest NODE environment.
// Keep it pure. (No `any`.)
//
// SEGMENTATION MODEL (a new onset is emitted when):
//   1. a stable pitch APPEARS after silence/unusable frames (a fresh attack), OR
//   2. the stable pitch CHANGES to a different MIDI note (the player moved), OR
//   3. the SAME pitch is RE-ARTICULATED after a clear silence gap (a repeated
//      note — e.g. two quarter Cs in a row), detected via a gap of unusable
//      frames longer than RE_ARTICULATION_GAP_MS between two same-pitch runs.
// A note is only committed once it has been STABLE for STABILITY_FRAMES
// consecutive usable frames (debounce against attack-transient pitch jumps and
// one-off detector glitches). The onset timestamp reported is the time of the
// FIRST frame of the stable run (the true attack), not the frame that confirmed
// stability — so onsets stay tight to the beat for evaluation.

import { frequencyToMidi, isUsableDetection } from './pitchMath.js';
import type { DetectedNote } from '../evaluation/index.js';

/**
 * One raw per-frame reading from the pitch detector, on the SAME clock as the
 * schedule (t=0 == first count-in click). The audio layer timestamps each frame
 * from the metronome's elapsed-ms so detected onsets align with expected onsets.
 */
export interface PitchSample {
  /** ms on the schedule clock at which this analysis frame was captured. */
  timeMs: number;
  /** detected fundamental in Hz (0 when pitchy found no pitch). */
  frequencyHz: number;
  /** pitchy clarity in [0,1]. */
  clarity: number;
}

/** Tunable thresholds for onset segmentation. NAMED + documented in one place so
 *  the human can calibrate "what is a note" at Gate 3 against a real guitar. */
export interface SegmenterConfig {
  /**
   * Clarity floor passed through to isUsableDetection: frames below this are
   * treated as silence (no usable pitch). Mirrors the detector's CLARITY_THRESHOLD
   * so the segmenter and detector agree on "is this a real note frame".
   */
  clarityFloor: number;
  /**
   * Consecutive usable frames at the SAME MIDI required before a note is
   * committed. Debounces the pitchy attack transient (the first frame or two of a
   * pluck often reads a harmonic / wrong octave). 2 frames at a ~10-20ms hop is a
   * few-tens-of-ms attack guard — small enough not to delay onset reporting (we
   * back-date the onset to the run's first frame).
   */
  stabilityFrames: number;
  /**
   * Silence (unusable-frame) duration in ms that must elapse between two runs of
   * the SAME MIDI before the second run counts as a NEW (re-articulated) note
   * rather than a continuation. Shorter than the shortest expected note gap so
   * repeated notes register, longer than incidental one-frame dropouts mid-sustain.
   */
  reArticulationGapMs: number;
}

/** Default segmenter tuning. Hop-size-agnostic where possible; frame counts
 *  assume a ~10-20ms analysis hop (see pitchDetector.ts ANALYSIS_HOP_MS). These
 *  are placeholders pending real-guitar calibration at Gate 3 (see LEARNINGS). */
export const DEFAULT_SEGMENTER_CONFIG: SegmenterConfig = {
  clarityFloor: 0.6,
  stabilityFrames: 2,
  reArticulationGapMs: 60,
};

/** Internal state of the streaming segmenter (so it can run live, frame by frame,
 *  AND be driven all-at-once by a test over a recorded sample array). */
interface SegmenterState {
  /** MIDI of the run currently being confirmed/sustained, or null if in silence. */
  runMidi: number | null;
  /** schedule-clock ms of the first frame of the current run (the candidate onset). */
  runStartMs: number;
  /** how many consecutive usable same-MIDI frames seen in the current run. */
  runFrames: number;
  /** best (max) clarity seen so far in the current run (reported on the onset). */
  runMaxClarity: number;
  /** frequency (Hz) of the highest-clarity frame in the current run — the
   *  REPRESENTATIVE fundamental reported on the onset as DetectedNote.freqHz, so
   *  the detection-review layer can compute an exact cents error. Tracked
   *  alongside runMaxClarity (updated whenever a new clarity high-water mark is
   *  seen). 0 until the first usable frame of a run. */
  runBestFreqHz: number;
  /** whether the current run has already been EMITTED as a committed note. */
  runEmitted: boolean;
  /** schedule-clock ms of the most recent USABLE frame (for gap measurement). */
  lastUsableMs: number;
  /** MIDI of the most recently COMMITTED note (for re-articulation gap logic). */
  lastEmittedMidi: number | null;
  /** schedule-clock ms of the last frame that ENDED a usable run (silence began). */
  lastRunEndMs: number;
}

function freshState(): SegmenterState {
  return {
    runMidi: null,
    runStartMs: 0,
    runFrames: 0,
    runMaxClarity: 0,
    runBestFreqHz: 0,
    runEmitted: false,
    lastUsableMs: -Infinity,
    lastEmittedMidi: null,
    lastRunEndMs: -Infinity,
  };
}

/**
 * A streaming onset segmenter. Feed it pitch samples one at a time (live) via
 * `push`; it returns a freshly-committed DetectedNote on the frame that confirms
 * a note (or null otherwise). Call `reset()` between attempts. The pure
 * `segment()` convenience function below runs a whole recorded array through one
 * of these — that is what the unit tests exercise.
 */
export class OnsetSegmenter {
  private readonly cfg: SegmenterConfig;
  private state: SegmenterState = freshState();

  constructor(config: SegmenterConfig = DEFAULT_SEGMENTER_CONFIG) {
    this.cfg = config;
  }

  /** Clear all state for a new attempt. */
  reset(): void {
    this.state = freshState();
  }

  /**
   * Process one frame. Returns a DetectedNote IF this frame committed a new note
   * onset, else null. Onset time is back-dated to the run's first frame.
   *
   * Gap handling (the subtle part): a silence frame ends the active pitch RUN,
   * but does NOT immediately forget which note we last committed. When usable
   * audio resumes at the SAME pitch, we re-articulate (emit a second note) only
   * if the silence lasted longer than reArticulationGapMs; a brief dropout (a
   * single glitch frame mid-sustain) resumes the SAME note and is suppressed.
   */
  push(sample: PitchSample): DetectedNote | null {
    const s = this.state;
    const usable = isUsableDetection(
      sample.frequencyHz,
      sample.clarity,
      this.cfg.clarityFloor,
    );

    if (!usable) {
      // Silence / unusable frame: end any active run. Record when usable audio
      // last sounded so the NEXT usable frame can measure the silence gap and
      // decide continuation vs re-articulation. Keep lastEmittedMidi intact.
      if (s.runMidi !== null) {
        s.lastRunEndMs = s.lastUsableMs;
      }
      s.runMidi = null;
      s.runFrames = 0;
      s.runEmitted = false;
      return null;
    }

    const midi = frequencyToMidi(sample.frequencyHz);
    const gapSinceUsableMs = sample.timeMs - s.lastUsableMs;

    if (s.runMidi === midi) {
      // Continuation of the active run (no intervening silence reset it).
      s.runFrames += 1;
      if (sample.clarity > s.runMaxClarity) {
        s.runMaxClarity = sample.clarity;
        s.runBestFreqHz = sample.frequencyHz; // representative freq = clearest frame
      }
    } else {
      // Start of a NEW pitch run (silence reset runMidi to null, or the pitch
      // changed). Decide if it should be SUPPRESSED as a short-gap continuation
      // of the just-committed same-pitch note rather than a fresh onset.
      const isShortGapResumeOfSamePitch =
        s.runMidi === null && // we came out of silence (not a pitch change)
        s.lastEmittedMidi === midi && // same note we last committed
        gapSinceUsableMs <= this.cfg.reArticulationGapMs; // dropout, not a rest

      s.runMidi = midi;
      s.runStartMs = sample.timeMs;
      s.runFrames = 1;
      s.runMaxClarity = sample.clarity;
      s.runBestFreqHz = sample.frequencyHz; // first frame's freq is the best so far
      // A short-gap resume is pre-marked emitted so it never produces a 2nd note.
      s.runEmitted = isShortGapResumeOfSamePitch;
    }
    s.lastUsableMs = sample.timeMs;

    // Commit the note the moment it has been stable long enough, exactly once.
    if (!s.runEmitted && s.runFrames >= this.cfg.stabilityFrames) {
      s.runEmitted = true;
      s.lastEmittedMidi = midi;
      return {
        midi,
        onsetMs: s.runStartMs, // back-dated to the attack frame
        clarity: s.runMaxClarity,
        freqHz: s.runBestFreqHz, // representative fundamental (clearest frame)
      };
    }
    return null;
  }
}

/**
 * PURE convenience: run a full array of recorded pitch samples through a fresh
 * segmenter and return all committed onsets in time order. This is the function
 * the node unit tests drive (and the synthetic-take harness can reuse). Samples
 * must be in nondecreasing timeMs order.
 */
export function segment(
  samples: ReadonlyArray<PitchSample>,
  config: SegmenterConfig = DEFAULT_SEGMENTER_CONFIG,
): DetectedNote[] {
  const seg = new OnsetSegmenter(config);
  const out: DetectedNote[] = [];
  for (const sample of samples) {
    const note = seg.push(sample);
    if (note !== null) out.push(note);
  }
  return out;
}
