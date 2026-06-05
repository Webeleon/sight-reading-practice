// evaluation/align.ts — match detected notes to expected notes by onset time
// within the (tempo/subdivision-scaled, asymmetric) tolerance band.
//
// PURE module: no Web Audio / DOM / React / Electron; no `any`.
//
// Contract:
//  - Each expected note maps to AT MOST ONE detection.
//  - Each detection maps to AT MOST ONE expected note.
//  - Detections below the clarity floor are dropped first (treated as never
//    detected) — see CLARITY_THRESHOLD.
//  - Detections that match no expected note within the LATE-extended search
//    horizon become `extra` events (returned as leftover indices).
//
// Matching strategy: a greedy nearest-onset assignment. We consider all
// (expected, detection) candidate pairs whose onset delta is inside the search
// horizon, sort them by absolute onset delta (closest first), and assign each
// pair only if BOTH sides are still free. Closest-in-time wins, which keeps the
// pairing stable and intuitive for a monophonic line. PITCH is NOT used to
// align — alignment is purely temporal — so a right-time/wrong-pitch detection
// still claims its expected note (and is later classified `wrong_pitch`), rather
// than leaking through as an `extra`.

import type { DetectedNote, ExpectedNote, EvaluationParams } from './types.js';
import { CLARITY_THRESHOLD, toleranceWindow } from './tuning.js';

/** A confirmed pairing of one expected note to one detection. */
export interface Alignment {
  /** Index into the ExpectedNote[] array passed to alignNotes. */
  expectedIndex: number;
  /** Index into the (clarity-filtered) DetectedNote[] — see `detections`. */
  detectionIndex: number;
  /** detected.onsetMs - expected.onsetMs (positive = late). */
  onsetDeltaMs: number;
  /** True if the delta is inside the asymmetric in-band bounds; false if the
   *  detection is correct-time-ish but past the LATE bound (a `late` candidate
   *  living in the extended search horizon). */
  withinWindow: boolean;
}

/** Result of aligning: confirmed pairings, plus the surviving detections and the
 *  detection indices that matched nothing (the `extra` candidates). `detections`
 *  is the clarity-filtered list that all detectionIndex values refer to. */
export interface AlignmentResult {
  alignments: Alignment[];
  /** Clarity-filtered detections (the array detectionIndex refers to). */
  detections: DetectedNote[];
  /** Indices into `detections` that were not paired to any expected note. */
  unmatchedDetectionIndices: number[];
  /** Indices into the expected[] array that received no detection. */
  unmatchedExpectedIndices: number[];
}

/**
 * How far past the in-band LATE bound a detection may still be considered a
 * candidate for an expected note (so it can be classified `late` rather than
 * spuriously becoming an `extra` while the expected note becomes `missed`). We
 * extend the late horizon by this multiple of the symmetric band. This is a
 * SEARCH horizon only; whether a pairing counts as on-time vs late is decided by
 * `withinWindow` against the true asymmetric bounds.
 */
const LATE_SEARCH_HORIZON_MULTIPLIER = 3;

/** Drop detections below the clarity floor (absent clarity = trusted). */
export function filterByClarity(detections: DetectedNote[]): DetectedNote[] {
  return detections.filter(
    (d) => d.clarity === undefined || d.clarity >= CLARITY_THRESHOLD,
  );
}

interface Candidate {
  expectedIndex: number;
  detectionIndex: number;
  onsetDeltaMs: number;
  absDelta: number;
  withinWindow: boolean;
}

/**
 * Align detected notes to expected notes purely by onset time.
 *
 * @param expected   expected notes (already rest-filtered) in any order; indices
 *                   in the result refer to THIS array's positions.
 * @param detected   raw detections; clarity-filtered internally.
 * @param params     tempo + subdivision (drive the tolerance band).
 */
export function alignNotes(
  expected: ExpectedNote[],
  detected: DetectedNote[],
  params: EvaluationParams,
): AlignmentResult {
  const detections = filterByClarity(detected);
  const win = toleranceWindow(params.tempoBpm, params.subdivision);
  const searchLate = win.symmetricMs * LATE_SEARCH_HORIZON_MULTIPLIER;
  // Earliness horizon stays at the true in-band early bound: a detection well
  // before an onset belongs to nothing here (it is either an extra or a hit for
  // an earlier expected note), so we don't widen the early side.
  const searchEarly = win.earlyMs;

  // Build all candidate pairs inside the search horizon.
  const candidates: Candidate[] = [];
  for (let ei = 0; ei < expected.length; ei++) {
    const e = expected[ei]!;
    for (let di = 0; di < detections.length; di++) {
      const d = detections[di]!;
      const delta = d.onsetMs - e.onsetMs; // positive = late
      if (delta < -searchEarly || delta > searchLate) continue;
      const withinWindow = delta >= -win.earlyMs && delta <= win.lateMs;
      candidates.push({
        expectedIndex: ei,
        detectionIndex: di,
        onsetDeltaMs: delta,
        absDelta: Math.abs(delta),
        withinWindow,
      });
    }
  }

  // Greedy: prefer in-band pairs over out-of-band (late) ones, then closest
  // in absolute time. Stable, intuitive for a monophonic line.
  candidates.sort((a, b) => {
    if (a.withinWindow !== b.withinWindow) return a.withinWindow ? -1 : 1;
    return a.absDelta - b.absDelta;
  });

  const expectedTaken = new Array<boolean>(expected.length).fill(false);
  const detectionTaken = new Array<boolean>(detections.length).fill(false);
  const alignments: Alignment[] = [];

  for (const c of candidates) {
    if (expectedTaken[c.expectedIndex] || detectionTaken[c.detectionIndex]) {
      continue;
    }
    expectedTaken[c.expectedIndex] = true;
    detectionTaken[c.detectionIndex] = true;
    alignments.push({
      expectedIndex: c.expectedIndex,
      detectionIndex: c.detectionIndex,
      onsetDeltaMs: c.onsetDeltaMs,
      withinWindow: c.withinWindow,
    });
  }

  const unmatchedExpectedIndices: number[] = [];
  for (let ei = 0; ei < expected.length; ei++) {
    if (!expectedTaken[ei]) unmatchedExpectedIndices.push(ei);
  }
  const unmatchedDetectionIndices: number[] = [];
  for (let di = 0; di < detections.length; di++) {
    if (!detectionTaken[di]) unmatchedDetectionIndices.push(di);
  }

  return {
    alignments,
    detections,
    unmatchedDetectionIndices,
    unmatchedExpectedIndices,
  };
}
