// useReadAlong — the metronome-driven, musical-time cursor loop.
//
// Disposable UI layer (brief sections 2, 12, 13): Web Audio / DOM / React allowed.
//
// This is the heart of Milestone 3. It ties together:
//   * the PURE schedule (precomputeSchedule / currentNoteIndexAt) — the exact math,
//   * the Web Audio Metronome — the AUTHORITATIVE clock (it never waits for the user),
//   * a requestAnimationFrame loop that reads the metronome's audio-clock elapsed time
//     every frame and positions the OSMD cursor on whatever note is "current".
//
// We do NOT advance the cursor from a timer or from input. We READ the audio clock and
// ASK the schedule which note is current. So the cursor is as tight as the audio clock,
// and the ±20ms criterion (Gate 2) is whatever jitter the audio clock has versus the
// precomputed onset times — which we measure and report here.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Line } from '../domain/index.js';
import {
  Metronome,
  precomputeSchedule,
  currentNoteIndexAt,
  DEFAULT_COUNT_IN_BARS,
} from '../audio/index.js';
import type { Schedule } from '../audio/index.js';
import type { CursorHandle } from './components/OsmdView.js';

/** Public phase of the read-along, surfaced to the UI for transport/readout. */
export type ReadAlongPhase = 'idle' | 'countIn' | 'playing' | 'finished';

/** The live timing readout shown on screen + logged (brief section 13 + Gate 2). */
export interface TimingReadout {
  phase: ReadAlongPhase;
  /** ms since t=0 (first count-in click), from the audio clock. */
  elapsedMs: number;
  /** Current note index into line.notes (-1 during count-in). */
  currentNoteIndex: number;
  /** Total notes in the current line. */
  totalNotes: number;
  /** During count-in: which count-in beat we're on (1-based), else 0. */
  countInBeat: number;
  /** Total count-in beats. */
  countInBeats: number;
  /**
   * After the run finishes: measured deviation (ms) between when the audio clock said
   * the run ended and the schedule's expected end. This is the live evidence for the
   * ±20ms criterion (the cursor reaching the final downbeat on time). Null until done.
   */
  finalDeviationMs: number | null;
}

export interface UseReadAlongOptions {
  line: Line | null;
  cursor: CursorHandle | null;
  countInBars?: number;
  onFinished?: (deviationMs: number) => void;
}

export interface UseReadAlong {
  readout: TimingReadout;
  start: () => void;
  stop: () => void;
  isRunning: boolean;
}

const EMPTY_READOUT: TimingReadout = {
  phase: 'idle',
  elapsedMs: 0,
  currentNoteIndex: -1,
  totalNotes: 0,
  countInBeat: 0,
  countInBeats: 0,
  finalDeviationMs: null,
};

/** Lazily create one shared AudioContext for the renderer (resumed on user gesture). */
function getAudioContext(): AudioContext {
  const w = window as unknown as { __sr_audioCtx?: AudioContext };
  if (!w.__sr_audioCtx) {
    w.__sr_audioCtx = new AudioContext();
    console.log(
      `[AUDIO] created AudioContext (sampleRate=${w.__sr_audioCtx.sampleRate})`,
    );
  }
  return w.__sr_audioCtx;
}

export function useReadAlong(options: UseReadAlongOptions): UseReadAlong {
  const { line, cursor, countInBars = DEFAULT_COUNT_IN_BARS, onFinished } = options;

  const [readout, setReadout] = useState<TimingReadout>(EMPTY_READOUT);
  const [isRunning, setIsRunning] = useState(false);

  const metronomeRef = useRef<Metronome | null>(null);
  const scheduleRef = useRef<Schedule | null>(null);
  const rafRef = useRef<number | null>(null);
  // Reference timestamp (audio clock) at start; logging only.
  const startAudioRef = useRef<number>(0);
  const lastLoggedBeatRef = useRef<number>(-1);
  const finishedRef = useRef<boolean>(false);
  // Latched once at finish so the readout keeps displaying it after the loop ends.
  const finalDevRef = useRef<number | null>(null);
  // Wall-clock (schedule) ms of the FINAL DOWNBEAT — the start of the line's last
  // bar. The Gate-2 criterion is measured here (brief Milestone 3): "the cursor
  // reaches the final downbeat within ±20ms of the expected wall-clock time".
  const finalDownbeatMsRef = useRef<number>(0);
  // True once we've latched the final-downbeat deviation (latch on first frame past it).
  const downbeatLatchedRef = useRef<boolean>(false);
  const onFinishedRef = useRef<typeof onFinished>(onFinished);
  onFinishedRef.current = onFinished;
  const cursorRef = useRef<CursorHandle | null>(cursor);
  cursorRef.current = cursor;

  const stop = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    metronomeRef.current?.stop();
    metronomeRef.current = null;
    setIsRunning(false);
  }, []);

  // Cleanup on unmount / line change.
  useEffect(() => stop, [stop]);

  const start = useCallback((): void => {
    if (!line) {
      console.warn('[UI] readAlong.start ignored: no line');
      return;
    }
    // Restart cleanly if already running.
    stop();

    const ctx = getAudioContext();
    void ctx.resume();

    const schedule = precomputeSchedule(line, line.tempo, countInBars);
    scheduleRef.current = schedule;
    finishedRef.current = false;
    finalDevRef.current = null;
    downbeatLatchedRef.current = false;
    lastLoggedBeatRef.current = -1;

    const countInClicks = schedule.clicks.filter((c) => c.isCountIn).length;

    // Final downbeat = the downbeat of the line's LAST bar (the accented click of the
    // last bar). All clicks carry isCountIn + accented; the last accented non-count-in
    // click is the final downbeat. This is what the ±20ms criterion is measured at.
    const lineDownbeats = schedule.clicks.filter(
      (c) => !c.isCountIn && c.accented,
    );
    const finalDownbeat = lineDownbeats[lineDownbeats.length - 1];
    finalDownbeatMsRef.current = finalDownbeat
      ? finalDownbeat.timeMs
      : schedule.totalDurationMs;

    cursorRef.current?.reset();
    cursorRef.current?.hide();

    console.log(
      `[UI] readAlong start: line=${line.id} tempo=${line.tempo}bpm ` +
        `countInBars=${countInBars} countInOffset=${schedule.countInOffsetMs.toFixed(0)}ms ` +
        `lineDuration=${schedule.lineDurationMs.toFixed(0)}ms total=${schedule.totalDurationMs.toFixed(0)}ms`,
    );

    const metro = new Metronome(ctx, line, {
      countInBars,
      onFinished: () => {
        // End of the whole timeline. The HEADLINE Gate-2 deviation is the final-
        // downbeat measurement latched in the rAF loop (finalDevRef); here we just
        // finalize the phase and park the cursor on the last note. (We also log the
        // end-of-timeline deviation as secondary data — but it is polling-granular,
        // bounded by the ~25ms scheduler interval, so it is NOT the criterion.)
        const m = metronomeRef.current;
        const elapsed = m ? m.elapsedMs() : schedule.totalDurationMs;
        const endDev = elapsed - schedule.totalDurationMs;
        finishedRef.current = true;
        console.log(
          `[UI] readAlong end-of-timeline: elapsed=${elapsed.toFixed(1)}ms ` +
            `expectedEnd=${schedule.totalDurationMs.toFixed(1)}ms ` +
            `endDeviation=${endDev.toFixed(1)}ms (secondary; polling-granular)`,
        );
        cursorRef.current?.moveTo(schedule.entries.length - 1);
        setReadout((r) => ({
          ...r,
          phase: 'finished',
          currentNoteIndex: schedule.entries.length - 1,
          finalDeviationMs: finalDevRef.current,
        }));
        if (finalDevRef.current !== null) {
          onFinishedRef.current?.(finalDevRef.current);
        }
      },
    });
    metronomeRef.current = metro;
    metro.start();
    startAudioRef.current = ctx.currentTime; // for reference logging only
    setIsRunning(true);

    // The rAF loop: read the audio clock, find the current note, position the cursor.
    const tick = (): void => {
      const m = metronomeRef.current;
      const sched = scheduleRef.current;
      if (!m || !sched) return;
      const elapsedMs = m.elapsedMs();

      const noteIndex = currentNoteIndexAt(sched, elapsedMs);
      const inCountIn = elapsedMs < sched.countInOffsetMs;

      // Latch the FINAL-DOWNBEAT deviation the first rAF frame at/after that downbeat.
      // This is the headline Gate-2 number: at rAF (~16ms) resolution it reflects when
      // the cursor's authoritative clock actually crossed the final downbeat, vs the
      // schedule's expected time for it. (Reading the audio clock here, not a timer.)
      if (
        !downbeatLatchedRef.current &&
        elapsedMs >= finalDownbeatMsRef.current
      ) {
        downbeatLatchedRef.current = true;
        const dev = elapsedMs - finalDownbeatMsRef.current;
        finalDevRef.current = dev;
        console.log(
          `[UI] FINAL DOWNBEAT reached: elapsed=${elapsedMs.toFixed(1)}ms ` +
            `expected=${finalDownbeatMsRef.current.toFixed(1)}ms ` +
            `deviation=${dev.toFixed(1)}ms ` +
            `(criterion |deviation| <= 20ms => ${Math.abs(dev) <= 20 ? 'PASS' : 'FAIL'})`,
        );
      }

      // Drive the cursor (musical time only).
      if (inCountIn) {
        cursorRef.current?.hide();
      } else {
        const cur = cursorRef.current;
        if (cur) {
          if (cur.currentIndex() < 0 && noteIndex >= 0) cur.show();
          cur.moveTo(noteIndex);
        }
      }

      // Count-in beat readout.
      const beatMs =
        sched.countInBars > 0
          ? sched.countInOffsetMs / (countInClicks || 1)
          : 0;
      const countInBeat = inCountIn && beatMs > 0
        ? Math.min(countInClicks, Math.floor(elapsedMs / beatMs) + 1)
        : 0;

      // Per-beat console log: current note index vs expected (Gate-2 verification).
      const beatLen = sched.lineDurationMs / (line.barCount * line.timeSignature.beats);
      if (!inCountIn && beatLen > 0) {
        const beatNo = Math.floor((elapsedMs - sched.countInOffsetMs) / beatLen);
        if (beatNo !== lastLoggedBeatRef.current && beatNo >= 0) {
          lastLoggedBeatRef.current = beatNo;
          const expectedOnset =
            noteIndex >= 0 ? sched.entries[noteIndex]!.onsetMs : 0;
          console.log(
            `[UI] beat ${beatNo}: elapsed=${elapsedMs.toFixed(1)}ms ` +
              `noteIndex=${noteIndex} noteOnset=${expectedOnset.toFixed(1)}ms ` +
              `(cursor lag=${(elapsedMs - expectedOnset).toFixed(1)}ms)`,
          );
        }
      }

      setReadout({
        phase: finishedRef.current
          ? 'finished'
          : inCountIn
            ? 'countIn'
            : 'playing',
        elapsedMs,
        currentNoteIndex: noteIndex,
        totalNotes: sched.entries.length,
        countInBeat,
        countInBeats: countInClicks,
        finalDeviationMs: finalDevRef.current,
      });

      // Keep ticking until well past the end (onFinished already fired the readout).
      if (elapsedMs < sched.totalDurationMs + 250) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        metronomeRef.current?.stop();
        metronomeRef.current = null;
        setIsRunning(false);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [line, cursor, countInBars, stop]);

  return { readout, start, stop, isRunning };
}
