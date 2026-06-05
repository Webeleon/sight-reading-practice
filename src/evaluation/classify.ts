// evaluation/classify.ts — turn an alignment into one classification PER
// expected note, plus `extra` rows for leftover detections.
//
// PURE module: no Web Audio / DOM / React / Electron; no `any`.
//
// Classification rules (brief section 13), applied to each expected note exactly
// once given its (at most one) aligned detection:
//   - hit         : a detection paired IN-WINDOW with the right pitch.
//   - wrong_pitch : a detection paired IN-WINDOW with the wrong pitch.
//   - late        : a detection paired but past the in-band LATE bound, with
//                   the RIGHT pitch (a wrong-pitch late detection is NOT credited
//                   as a near-miss: the expected note is `missed` and the
//                   detection becomes an `extra`).
//   - missed      : no detection paired to this expected note.
// Every leftover (unpaired) detection becomes an `extra` row.

import type {
  DetectedNote,
  ExpectedNote,
  EvaluationParams,
  NoteResult,
} from './types.js';
import type { Alignment } from './align.js';
import { alignNotes } from './align.js';
import { PITCH_TOLERANCE_SEMITONES } from './tuning.js';

/** Right pitch iff detected MIDI is within PITCH_TOLERANCE_SEMITONES of expected
 *  (0 = exact match, the brief's rule). */
function pitchMatches(expectedMidi: number, detectedMidi: number): boolean {
  return Math.abs(expectedMidi - detectedMidi) <= PITCH_TOLERANCE_SEMITONES;
}

/** Build the `extra` NoteResult for an unpaired detection (expected side null,
 *  matching the persistence schema's nullable expected_* columns). */
function extraResult(d: DetectedNote): NoteResult {
  return {
    noteIndex: null,
    classification: 'extra',
    expectedMidi: null,
    expectedOnsetMs: null,
    expectedDurationMs: null,
    detectedMidi: d.midi,
    detectedOnsetMs: d.onsetMs,
    detectedDurationMs: d.durationMs ?? null,
    onsetDeltaMs: null,
  };
}

/** A `missed` NoteResult for an expected note that got no usable detection. */
function missedResult(e: ExpectedNote): NoteResult {
  return {
    noteIndex: e.noteIndex,
    classification: 'missed',
    expectedMidi: e.expectedMidi,
    expectedOnsetMs: e.onsetMs,
    expectedDurationMs: e.durationMs,
    detectedMidi: null,
    detectedOnsetMs: null,
    detectedDurationMs: null,
    onsetDeltaMs: null,
  };
}

/**
 * Classify every expected note exactly once and emit `extra` rows for leftover
 * detections. Returns rows in expected order first, then extra rows in detected
 * order. This runs alignment internally so callers get a one-call pipeline; the
 * separate alignNotes is still exported for testing/inspection.
 *
 * Note on wrong-pitch-late detections: such a detection is paired temporally but
 * is neither a `late` (wrong pitch) nor an in-band event. We RELEASE it back
 * to the extra pool so the expected note reads `missed` and the stray pitch is
 * surfaced as an `extra`, which matches a player who played the wrong note off
 * the beat.
 */
export function classifyNotes(
  expected: ExpectedNote[],
  detected: DetectedNote[],
  params: EvaluationParams,
): NoteResult[] {
  const { alignments, detections, unmatchedDetectionIndices } = alignNotes(
    expected,
    detected,
    params,
  );

  // Index the alignment by expected position for O(1) lookup.
  const byExpected = new Map<number, Alignment>();
  for (const a of alignments) byExpected.set(a.expectedIndex, a);

  // Detections we release back to the extra pool (wrong-pitch late events).
  const releasedDetectionIndices: number[] = [];

  const expectedRows: NoteResult[] = expected.map((e, ei) => {
    const a = byExpected.get(ei);
    if (a === undefined) return missedResult(e);

    const d = detections[a.detectionIndex]!;
    const right = pitchMatches(e.expectedMidi, d.midi);

    if (a.withinWindow) {
      // In-band: right pitch -> hit; wrong pitch -> wrong_pitch.
      return {
        noteIndex: e.noteIndex,
        classification: right ? 'hit' : 'wrong_pitch',
        expectedMidi: e.expectedMidi,
        expectedOnsetMs: e.onsetMs,
        expectedDurationMs: e.durationMs,
        detectedMidi: d.midi,
        detectedOnsetMs: d.onsetMs,
        detectedDurationMs: d.durationMs ?? null,
        onsetDeltaMs: a.onsetDeltaMs,
      };
    }

    // Out-of-band (past the LATE bound). Only credit as `late` if the pitch is
    // right; otherwise the expected note is missed and the detection is extra.
    if (right) {
      return {
        noteIndex: e.noteIndex,
        classification: 'late',
        expectedMidi: e.expectedMidi,
        expectedOnsetMs: e.onsetMs,
        expectedDurationMs: e.durationMs,
        detectedMidi: d.midi,
        detectedOnsetMs: d.onsetMs,
        detectedDurationMs: d.durationMs ?? null,
        onsetDeltaMs: a.onsetDeltaMs,
      };
    }

    releasedDetectionIndices.push(a.detectionIndex);
    return missedResult(e);
  });

  // Extra rows: originally-unmatched detections plus released wrong-pitch-late
  // ones, in detected order for stable output.
  const extraIndices = [...unmatchedDetectionIndices, ...releasedDetectionIndices].sort(
    (x, y) => x - y,
  );
  const extraRows: NoteResult[] = extraIndices.map((di) => extraResult(detections[di]!));

  return [...expectedRows, ...extraRows];
}
