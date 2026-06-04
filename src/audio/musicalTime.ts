// musicalTime.ts — the PURE musical-time model.
//
// This module is intentionally DEPENDENCY-FREE of Web Audio / DOM / Electron /
// React. It is plain TypeScript over the pure domain types and is fully unit-
// testable under the vitest node environment. It is the deterministic core of
// Milestone 3: the metronome (metronome.ts) and the cursor (UI) both read their
// timing from the schedule this module precomputes, so the "cursor reaches the
// final downbeat within +/-20ms" criterion reduces to: (a) this math is exact
// (verified here), and (b) the live audio clock tracks it within jitter
// (measured at Gate 2).
//
// Time model: a Line stores note onsets as absolute TICKS from line start
// (480 ticks / quarter). We convert ticks -> milliseconds against the tempo
// (BPM is beats-per-minute where a beat is a quarter note in /4 meters; we use
// the standard "quarter == one beat at this BPM" convention throughout, which is
// what the metronome and the brief's worked example assume). On top of the line
// we prepend a COUNT-IN of N bars (default 2). All wall-clock times in a Schedule
// are measured from t=0 == the very first count-in click; the line's own content
// therefore begins at `countInOffsetMs`.

import type { Line, LineNote } from '../domain/index.js';
import { TICKS_PER_QUARTER, ticksPerBar, pitchToMidi } from '../domain/index.js';

/** Default count-in length in bars (brief sections 12 & 13). */
export const DEFAULT_COUNT_IN_BARS = 2;

/** One precomputed note in wall-clock time. `noteIndex` indexes back into
 *  line.notes so the cursor / evaluation can join against the original Line. */
export interface ScheduleEntry {
  /** Index into line.notes. */
  noteIndex: number;
  /** Onset in ms from the very first count-in click (t=0). */
  onsetMs: number;
  /** Duration of this note/rest in ms. */
  durationMs: number;
  /** MIDI number of the expected pitch, or null for a rest. */
  expectedMidi: number | null;
}

/** A metronome click in wall-clock time (ms from the first count-in click). */
export interface MetronomeClick {
  /** Time in ms from t=0 (the first count-in click). */
  timeMs: number;
  /** True on the downbeat of a bar (gets the accented click sound). */
  accented: boolean;
  /** True while still in the count-in (before the line's first note). */
  isCountIn: boolean;
  /** 0-based bar index this click belongs to, counting count-in bars from 0 and
   *  the line's first bar from `countInBars`. Useful for logging/debugging. */
  barIndex: number;
  /** 0-based beat index within the bar (0 == downbeat). */
  beatInBar: number;
}

/** The full precomputed timeline for a line at a given tempo + count-in. */
export interface Schedule {
  /** Per-note entries, in note order (same order as line.notes). */
  entries: ScheduleEntry[];
  /** ms from t=0 to the line's first beat (== total count-in length). */
  countInOffsetMs: number;
  /** ms of the line's musical content (barCount bars), excluding count-in. */
  lineDurationMs: number;
  /** countInOffsetMs + lineDurationMs: the wall-clock end of the whole timeline. */
  totalDurationMs: number;
  /** Metronome clicks (count-in + line), so the metronome and cursor share one
   *  authoritative timeline. */
  clicks: MetronomeClick[];
  /** Echoed for convenience (callers often need these alongside the schedule). */
  tempoBpm: number;
  countInBars: number;
}

/**
 * Convert an absolute tick offset to milliseconds at a given tempo.
 *
 * One quarter note == TICKS_PER_QUARTER ticks == one beat. At `tempoBpm` beats
 * per minute, one beat lasts 60000 / tempoBpm ms, so one tick lasts
 * (60000 / tempoBpm) / TICKS_PER_QUARTER ms. Linear in `tick`, exact at tick 0.
 */
export function tickToMs(tick: number, tempoBpm: number): number {
  const msPerQuarter = 60000 / tempoBpm;
  return (tick / TICKS_PER_QUARTER) * msPerQuarter;
}

/** ms of one bar of the line's time signature at the given tempo. */
function barDurationMs(line: Line, tempoBpm: number): number {
  return tickToMs(ticksPerBar(line.timeSignature), tempoBpm);
}

/** Beats per bar, derived from the time signature (numerator). */
function beatsPerBar(line: Line): number {
  return line.timeSignature.beats;
}

/** ms of one beat (one beat-unit note) at the given tempo. NOTE: the beat unit
 *  may not be a quarter (e.g. 6/8 counts in dotted-quarter beats musically, but
 *  for a simple metronome we click the notated beat unit = an eighth here). We
 *  derive the beat duration directly from barDuration / beats so it is always
 *  internally consistent with barDurationMs. */
function beatDurationMs(line: Line, tempoBpm: number): number {
  return barDurationMs(line, tempoBpm) / beatsPerBar(line);
}

/**
 * Precompute the wall-clock timeline for a line.
 *
 * @param line       the generated Line (notes carry absolute startTick).
 * @param tempoBpm   playback tempo in BPM (quarter == beat).
 * @param countInBars number of count-in bars to prepend (default 2).
 */
export function precomputeSchedule(
  line: Line,
  tempoBpm: number,
  countInBars: number = DEFAULT_COUNT_IN_BARS,
): Schedule {
  const countInOffsetMs = countInBars * barDurationMs(line, tempoBpm);
  const lineDurationMs = line.barCount * barDurationMs(line, tempoBpm);
  const totalDurationMs = countInOffsetMs + lineDurationMs;

  const entries: ScheduleEntry[] = line.notes.map((n: LineNote, i: number) => ({
    noteIndex: i,
    onsetMs: countInOffsetMs + tickToMs(n.startTick, tempoBpm),
    durationMs: tickToMs(n.duration.ticks, tempoBpm),
    expectedMidi: n.pitch === null ? null : pitchToMidi(n.pitch),
  }));

  const clicks = computeBeatClicks(line, tempoBpm, countInBars);

  return {
    entries,
    countInOffsetMs,
    lineDurationMs,
    totalDurationMs,
    clicks,
    tempoBpm,
    countInBars,
  };
}

/**
 * Which note in the schedule is "current" at `elapsedMs` (ms from t=0, the first
 * count-in click). This is the cursor lookup: it never re-queries OSMD.
 *
 * - Returns -1 before the line's first note onset (i.e. during the count-in),
 *   so the cursor stays hidden/parked until the line begins.
 * - Returns the index of the last note whose onset is <= elapsedMs otherwise.
 * - After the final note (even past the end of the timeline) it parks on the
 *   last note index, so the results screen can show the final note highlighted.
 *
 * Implemented as a binary search over the (monotonically increasing) onset
 * times for O(log n) lookups at the 60fps cursor tick.
 */
export function currentNoteIndexAt(schedule: Schedule, elapsedMs: number): number {
  const entries = schedule.entries;
  if (entries.length === 0) return -1;
  if (elapsedMs < entries[0]!.onsetMs) return -1;

  let lo = 0;
  let hi = entries.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid]!.onsetMs <= elapsedMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Compute the metronome click track: `countInBars` count-in bars followed by the
 * line's `barCount` bars, one click per beat, the downbeat of each bar accented.
 * Times are ms from t=0 (the first count-in click); the line's first note onset
 * coincides with the first non-count-in click.
 */
export function computeBeatClicks(
  line: Line,
  tempoBpm: number,
  countInBars: number = DEFAULT_COUNT_IN_BARS,
): MetronomeClick[] {
  const beats = beatsPerBar(line);
  const beatMs = beatDurationMs(line, tempoBpm);
  const totalBars = countInBars + line.barCount;

  const clicks: MetronomeClick[] = [];
  for (let bar = 0; bar < totalBars; bar++) {
    for (let beat = 0; beat < beats; beat++) {
      const globalBeat = bar * beats + beat;
      clicks.push({
        timeMs: globalBeat * beatMs,
        accented: beat === 0,
        isCountIn: bar < countInBars,
        barIndex: bar,
        beatInBar: beat,
      });
    }
  }
  return clicks;
}
