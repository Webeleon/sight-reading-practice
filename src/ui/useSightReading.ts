// useSightReading — the Milestone 4 read-AND-evaluate loop.
//
// Disposable UI layer (Web Audio / DOM / React allowed). Builds on the Milestone 3
// read-along (metronome-driven, musical-time cursor that never waits for the user)
// and ADDS:
//   * live pitch detection (AudioGraph) anchored to the metronome's t=0, so
//     detected onsets land on the SAME clock as the expected onsets, OR a
//     SYNTHETIC take (a pre-built DetectedNote[]) so the whole path runs without
//     a guitar (the live accuracy itself is Human Review Gate 3),
//   * real-time feedback colouring that TRAILS the cursor by ~100ms
//     (TRAILING_EVALUATION_DELAY_MS) — as each note's evaluation window closes we
//     commit its colour (green hit / red wrong / grey missed),
//   * a final EvaluationResult (the pure evaluateAttempt) for the results screen,
//   * attempt_type tracking (first_read / retry_at_tempo / retry_slower) so M5 can
//     persist it; only first_read counts toward fluency (brief section 11).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Line } from '../domain/index.js';
import {
  Metronome,
  currentNoteIndexAt,
  DEFAULT_COUNT_IN_BARS,
  AudioGraph,
  type Schedule,
  type DetectionFrame,
} from '../audio/index.js';
import {
  evaluateAttempt,
  classifyNotes,
  TRAILING_EVALUATION_DELAY_MS,
  type DetectedNote,
  type ExpectedNote,
  type EvaluationResult,
  type NoteResult,
} from '../evaluation/index.js';
import type { CursorHandle, NoteFeedback } from './components/OsmdView.js';
import {
  buildExpectedNotes,
  deriveSubdivision,
} from './evaluationBridge.js';

export type Phase = 'idle' | 'countIn' | 'playing' | 'finished';

export type AttemptType = 'first_read' | 'retry_at_tempo' | 'retry_slower';

/**
 * The per-run DETECTION-REVIEW payload, in-memory only (never persisted). Exposed
 * alongside the EvaluationResult so the review screen can show what the app
 * detected, how far off it was, and replay the take:
 *   - frames:    the CONTINUOUS raw detector trace (live mode only; empty for a
 *                synthetic take, which has no per-frame data — the review then
 *                draws discrete points from `detected`).
 *   - detected:  the committed DetectedNote[] (both modes; carries freqHz in live
 *                mode for exact cents errors).
 *   - recording: the recorded-audio Blob for playback (live mode; null for
 *                synthetic, which has no mic — the audio player is hidden).
 *   - expected:  the rest-filtered ExpectedNote[] the run was read against (so the
 *                review graph can draw the expected segments without re-deriving).
 */
export interface ReviewPayload {
  frames: DetectionFrame[];
  detected: DetectedNote[];
  recording: Blob | null;
  expected: ExpectedNote[];
}

export interface UseSightReadingOptions {
  line: Line | null;
  cursor: CursorHandle | null;
  countInBars?: number;
  /** Selected input device for live detection (undefined = system default). */
  inputDeviceId?: string;
  /** When true, the metronome ALSO plays a soft tone per line note ("Hear line")
   *  so the player can hear the melody while reading. Synced to the same audio
   *  clock as the clicks (never drifts). Default handled by the caller. */
  melody?: boolean;
  /**
   * When provided, run in SYNTHETIC mode: instead of opening the mic, replay these
   * detections (already on the schedule clock) for evaluation + colouring. This is
   * the hardware-free harness for testing the evaluation/feedback/results path.
   */
  syntheticTake?: DetectedNote[] | null;
}

export interface UseSightReading {
  phase: Phase;
  isRunning: boolean;
  /** The evaluation result, available once a run finishes (else null). */
  result: EvaluationResult | null;
  /** The detection-review payload for the finished run (frames + detected +
   *  recording + expected), available alongside `result` (else null). In-memory
   *  only. The recording field may fill in slightly AFTER `result` (MediaRecorder
   *  finalises asynchronously); the object is replaced when the Blob resolves. */
  review: ReviewPayload | null;
  /** attempt_type of the run that produced `result`. */
  attemptType: AttemptType;
  /** Live count of detected notes so far (for an on-screen readout). */
  detectedCount: number;
  /** 1-based current count-in beat while phase==='countIn' (0 when not counting
   *  in). Drives the on-screen count-in indicator. */
  countInBeat: number;
  /** Total number of count-in beats (countInBars * timeSignature.beats). 0 until
   *  a run that has a line begins. */
  countInTotalBeats: number;
  /**
   * Begin a run. `type` records the attempt_type for fluency accounting.
   * `runOptions.line` overrides the hook's `line` for THIS run (so a Retry-slower
   * can run a modified tempo immediately without a re-render race), and
   * `runOptions.syntheticTake` supplies a hardware-free take for THIS run.
   */
  start: (
    type: AttemptType,
    runOptions?: { line?: Line; syntheticTake?: DetectedNote[] | null },
  ) => void;
  stop: () => void;
}

function getAudioContext(): AudioContext {
  const w = window as unknown as { __sr_audioCtx?: AudioContext };
  if (!w.__sr_audioCtx) {
    w.__sr_audioCtx = new AudioContext();
    console.log(`[AUDIO] created AudioContext (sampleRate=${w.__sr_audioCtx.sampleRate})`);
  }
  return w.__sr_audioCtx;
}

export function useSightReading(
  options: UseSightReadingOptions,
): UseSightReading {
  const {
    line,
    cursor,
    countInBars = DEFAULT_COUNT_IN_BARS,
    inputDeviceId,
    syntheticTake = null,
    melody = false,
  } = options;

  const [phase, setPhase] = useState<Phase>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [attemptType, setAttemptType] = useState<AttemptType>('first_read');
  const [detectedCount, setDetectedCount] = useState(0);
  const [countInBeat, setCountInBeat] = useState(0);
  const [countInTotalBeats, setCountInTotalBeats] = useState(0);

  const metronomeRef = useRef<Metronome | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);
  const scheduleRef = useRef<Schedule | null>(null);
  const expectedRef = useRef<ExpectedNote[]>([]);
  const detectedRef = useRef<DetectedNote[]>([]);
  const rafRef = useRef<number | null>(null);
  // Synthetic detections still pending injection (sorted by onsetMs).
  const pendingSyntheticRef = useRef<DetectedNote[]>([]);
  const syntheticCursorRef = useRef<number>(0);
  // Note indices whose colour has already been committed (live trailing feedback).
  const coloredRef = useRef<Set<number>>(new Set());
  const cursorRef = useRef<CursorHandle | null>(cursor);
  cursorRef.current = cursor;
  const attemptTypeRef = useRef<AttemptType>('first_read');
  const finishedRef = useRef(false);

  const stop = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    metronomeRef.current?.stop();
    metronomeRef.current = null;
    graphRef.current?.stop();
    graphRef.current = null;
    setIsRunning(false);
    setCountInBeat(0);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    (
      type: AttemptType,
      runOptions?: { line?: Line; syntheticTake?: DetectedNote[] | null },
    ): void => {
      const runLine = runOptions?.line ?? line;
      const take =
        runOptions && 'syntheticTake' in runOptions
          ? runOptions.syntheticTake ?? null
          : syntheticTake;
      if (!runLine) {
        console.warn('[UI] sightReading.start ignored: no line');
        return;
      }
      stop();

      const ctx = getAudioContext();
      void ctx.resume();

      const { expected, schedule } = buildExpectedNotes(runLine, countInBars);
      const subdivision = deriveSubdivision(runLine);
      scheduleRef.current = schedule;
      expectedRef.current = expected;
      detectedRef.current = [];
      coloredRef.current = new Set();
      finishedRef.current = false;
      attemptTypeRef.current = type;
      setAttemptType(type);
      setResult(null);
      setReview(null);
      setDetectedCount(0);
      // Count-in indicator: total beats across the count-in bars.
      const totalCountInBeats = countInBars * runLine.timeSignature.beats;
      setCountInTotalBeats(totalCountInBeats);
      setCountInBeat(totalCountInBeats > 0 ? 1 : 0);
      setPhase('countIn');

      // Synthetic take: queue the detections for time-ordered injection.
      pendingSyntheticRef.current = take
        ? [...take].sort((a, b) => a.onsetMs - b.onsetMs)
        : [];
      syntheticCursorRef.current = 0;

      cursorRef.current?.reset();
      cursorRef.current?.clearColors();
      cursorRef.current?.hide();

      console.log(
        `[UI] sightReading start: line=${runLine.id} type=${type} tempo=${runLine.tempo}bpm ` +
          `subdivision=${subdivision} expectedNotes=${expected.length} ` +
          `mode=${take ? 'SYNTHETIC' : 'LIVE'}`,
      );

      const metro = new Metronome(ctx, runLine, {
        countInBars,
        melody,
        onFinished: () => {
          finishedRef.current = true;
        },
      });
      metronomeRef.current = metro;
      metro.start();
      setIsRunning(true);

      // Live mode: open the mic + detector, anchored to the metronome's t=0, and
      // collect detected onsets. (Synthetic mode skips hardware entirely.)
      if (!take) {
        const graph = new AudioGraph(ctx, {
          deviceId: inputDeviceId,
          onNote: (note: DetectedNote) => {
            detectedRef.current.push(note);
            setDetectedCount(detectedRef.current.length);
          },
        });
        graphRef.current = graph;
        graph.start(metro.getStartAudioTime()).catch((err: unknown) => {
          console.error('[AUDIO] failed to start live input graph', err);
        });
      }

      const tick = (): void => {
        const m = metronomeRef.current;
        const sched = scheduleRef.current;
        if (!m || !sched) return;
        const elapsedMs = m.elapsedMs();
        const inCountIn = elapsedMs < sched.countInOffsetMs;

        // Count-in visual: the 1-based current beat, derived from elapsed time and
        // the per-beat duration (countInOffsetMs / totalBeats). Clamp to [1,total].
        if (inCountIn && totalCountInBeats > 0) {
          const beatMs = sched.countInOffsetMs / totalCountInBeats;
          const clampedMs = elapsedMs < 0 ? 0 : elapsedMs;
          const beat = Math.min(
            totalCountInBeats,
            Math.floor(clampedMs / beatMs) + 1,
          );
          setCountInBeat(beat);
        } else {
          setCountInBeat(0);
        }

        // Inject any synthetic detections whose onset time has now passed.
        if (pendingSyntheticRef.current.length > 0) {
          const pend = pendingSyntheticRef.current;
          while (
            syntheticCursorRef.current < pend.length &&
            pend[syntheticCursorRef.current]!.onsetMs <= elapsedMs
          ) {
            detectedRef.current.push(pend[syntheticCursorRef.current]!);
            syntheticCursorRef.current++;
          }
          if (detectedRef.current.length !== detectedCount) {
            setDetectedCount(detectedRef.current.length);
          }
        }

        // Drive the cursor in musical time (never waits for input).
        const noteIndex = currentNoteIndexAt(sched, elapsedMs);
        if (inCountIn) {
          cursorRef.current?.hide();
        } else {
          const cur = cursorRef.current;
          if (cur) {
            if (cur.currentIndex() < 0 && noteIndex >= 0) cur.show();
            cur.moveTo(noteIndex);
            // Read-ahead cue (brief section 13): dim the region BEHIND the cursor
            // so the eye is pulled toward the notes still to come. Fraction tracks
            // how far the cursor has progressed through the line.
            const lastIndex = sched.entries.length - 1;
            const frac = lastIndex > 0 ? noteIndex / lastIndex : 0;
            cur.setReadAheadDim(frac);
          }
        }

        // Real-time trailing feedback: commit a note's colour once the cursor has
        // passed its onset by TRAILING_EVALUATION_DELAY_MS (its timing window has
        // had time to resolve). We re-evaluate the detections gathered SO FAR
        // against the expected notes and colour any newly-resolved note.
        commitTrailingColors(elapsedMs);

        setPhase(finishedRef.current ? 'finished' : inCountIn ? 'countIn' : 'playing');

        if (elapsedMs < sched.totalDurationMs + 250) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = null;
          // End of run: stop input, do the FINAL authoritative evaluation.
          const graph = graphRef.current; // capture before clearing for review
          graph?.stop();
          graphRef.current = null;
          metronomeRef.current?.stop();
          metronomeRef.current = null;
          finalizeEvaluation(graph);
          setIsRunning(false);
        }
      };

      /** Commit colours for notes whose evaluation window has closed. */
      const commitTrailingColors = (elapsedMs: number): void => {
        const sched = scheduleRef.current;
        const cur = cursorRef.current;
        if (!sched || !cur) return;
        // Which expected notes are "resolved" (cursor passed onset + delay)?
        const newlyResolved: number[] = [];
        for (let i = 0; i < expectedRef.current.length; i++) {
          const e = expectedRef.current[i]!;
          if (coloredRef.current.has(e.noteIndex)) continue;
          if (elapsedMs >= e.onsetMs + TRAILING_EVALUATION_DELAY_MS) {
            newlyResolved.push(e.noteIndex);
          }
        }
        if (newlyResolved.length === 0) return;

        // Re-classify with the detections gathered so far; colour the resolved ones.
        const rows = classifyNotes(expectedRef.current, detectedRef.current, {
          tempoBpm: runLine.tempo,
          subdivision,
        });
        const feedback = new Map<number, NoteFeedback>();
        for (const idx of newlyResolved) {
          coloredRef.current.add(idx);
          const row = rows.find((r: NoteResult) => r.noteIndex === idx);
          feedback.set(idx, classificationToFeedback(row));
        }
        cur.colorNotes(feedback);
      };

      /** Final, authoritative evaluation + full recolour for the results screen.
       *  `graph` is the live AudioGraph for this run (null in synthetic mode), the
       *  source of the review's raw frames + recording. */
      const finalizeEvaluation = (graph: AudioGraph | null): void => {
        const evalResult = evaluateAttempt(expectedRef.current, detectedRef.current, {
          tempoBpm: runLine.tempo,
          subdivision,
        });
        // Colour EVERY expected note from the final result (covers late notes that
        // resolved after their trailing window, and any not yet coloured).
        const feedback = new Map<number, NoteFeedback>();
        for (const row of evalResult.notes) {
          if (row.noteIndex === null) continue;
          feedback.set(row.noteIndex, classificationToFeedback(row));
        }
        cursorRef.current?.colorNotes(feedback);
        cursorRef.current?.moveTo(scheduleRef.current!.entries.length - 1);
        setResult(evalResult);

        // Build the in-memory detection-review payload. Synthetic mode has no graph
        // -> no frames, no recording (the review draws discrete points from the
        // detected notes and hides the audio player). The detected/expected arrays
        // are snapshotted so a later run can't mutate this payload.
        const frames: DetectionFrame[] = graph ? graph.getFrames() : [];
        const detectedSnapshot = detectedRef.current.slice();
        const expectedSnapshot = expectedRef.current.slice();
        // Recording is null initially (and forever in synthetic mode); in live mode
        // it resolves asynchronously after the recorder flushes — patch it in then.
        setReview({
          frames,
          detected: detectedSnapshot,
          recording: null,
          expected: expectedSnapshot,
        });
        if (graph) {
          void graph.getRecording().then((blob) => {
            if (blob) {
              setReview((prev) =>
                prev ? { ...prev, recording: blob } : prev,
              );
              console.log(
                `[UI] review recording ready: ${blob.size} bytes (${blob.type})`,
              );
            }
          });
        }

        setPhase('finished');
        console.log(
          `[EVAL] attempt complete: type=${attemptTypeRef.current} ` +
            `pitchAccuracy=${(evalResult.pitchAccuracy * 100).toFixed(1)}% ` +
            `timingAccuracy=${(evalResult.timingAccuracy * 100).toFixed(1)}% ` +
            `hits=${evalResult.hits} wrong=${evalResult.wrongPitch} ` +
            `late=${evalResult.late} missed=${evalResult.missed} extra=${evalResult.extra} ` +
            `(countsTowardFluency=${attemptTypeRef.current === 'first_read'})`,
        );
        console.log(
          `[UI] review payload: frames=${frames.length} detected=${detectedSnapshot.length} ` +
            `expected=${expectedSnapshot.length} mode=${graph ? 'LIVE' : 'SYNTHETIC'}`,
        );
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    // detectedCount intentionally excluded (read via ref inside tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [line, countInBars, inputDeviceId, syntheticTake, melody, stop],
  );

  return {
    phase,
    isRunning,
    result,
    review,
    attemptType,
    detectedCount,
    countInBeat,
    countInTotalBeats,
    start,
    stop,
  };
}

/** Map an evaluation classification to a notehead feedback colour. A missing row
 *  (note not yet classified) is treated as missed (grey). */
function classificationToFeedback(row: NoteResult | undefined): NoteFeedback {
  if (!row) return 'missed';
  switch (row.classification) {
    case 'hit':
      return 'hit';
    case 'late':
      return 'hit'; // late-but-correct pitch reads as a (timing-flawed) hit colour
    case 'wrong_pitch':
      return 'wrong';
    case 'missed':
      return 'missed';
    case 'extra':
      return null; // extras have no expected notehead to colour
  }
}
