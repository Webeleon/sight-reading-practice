// metronome.ts — the sample-accurate Web Audio metronome.
//
// This is the AUTHORITATIVE musical clock for the whole read-along: the cursor
// follows THIS clock, not detected input, and it NEVER waits for the user
// (brief sections 12 & 13).
//
// Timing discipline (the whole point of this file):
//   * We do NOT use setInterval/setTimeout to MAKE sound. Timers are jittery
//     (4ms+ clamping, GC pauses, tab throttling) and would smear the beat.
//   * Instead a periodic LOOKAHEAD loop (a coarse ~25ms timer) wakes up, looks
//     a small window (~100ms) into the future on the Web Audio clock
//     (AudioContext.currentTime), and SCHEDULES every click whose time falls in
//     that window via oscillator.start(when) — sample-accurate against the audio
//     hardware clock. The timer only decides WHEN WE SCHEDULE, never WHEN SOUND
//     PLAYS. This is the standard "A Tale of Two Clocks" pattern.
//
// The musical timeline (click times, count-in offset) comes from the PURE
// musicalTime module so the metronome and the cursor read one shared schedule.
//
// This file lives in the Web-Audio/UI layer (tsconfig.ui), so DOM/WebAudio
// globals are allowed here. It is NOT a pure module.

import type { Line } from '../domain/index.js';
import type { Schedule, MetronomeClick } from './musicalTime.js';
import { precomputeSchedule, DEFAULT_COUNT_IN_BARS } from './musicalTime.js';

/** How far ahead (ms) we look each scheduling tick: any click landing within
 *  [now, now + LOOKAHEAD_MS] gets scheduled this wake-up. Must comfortably
 *  exceed SCHEDULER_INTERVAL_MS so no click is ever missed between wake-ups. */
export const LOOKAHEAD_MS = 100;

/** How often (ms) the lookahead loop wakes up to schedule. Coarse on purpose —
 *  it only schedules; the audio clock plays. */
export const SCHEDULER_INTERVAL_MS = 25;

/** Click sound parameters (a short pitched blip; accented = higher + louder). */
const CLICK_FREQ_ACCENT = 1500;
const CLICK_FREQ_NORMAL = 1000;
const CLICK_GAIN_ACCENT = 0.5;
const CLICK_GAIN_NORMAL = 0.3;
const CLICK_DURATION_S = 0.04; // 40ms blip

/** Reported once per scheduling tick so the cursor can follow the audio clock. */
export interface MetronomeTick {
  /** Seconds on the AudioContext clock at this report. */
  audioTime: number;
  /** ms elapsed since the metronome's t=0 (the first count-in click). This is the
   *  value to feed into currentNoteIndexAt. */
  elapsedMs: number;
  /** Index of the most recent click that has SOUNDED at/just-before now, or -1
   *  if none have sounded yet. */
  currentClickIndex: number;
  /** True while still in the count-in (line content not started yet). */
  inCountIn: boolean;
  /** True once elapsedMs has passed the end of the whole timeline. */
  finished: boolean;
}

/** Minimal slice of AudioContext we use — typed so tests can pass a fake. */
export interface AudioClock {
  readonly currentTime: number;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  readonly destination: AudioDestinationNode;
}

export interface MetronomeOptions {
  /** Count-in bars before the line (default 2). */
  countInBars?: number;
  /** Subdivision multiplier: clicks per notated beat. 1 = beat only (default),
   *  2 = eighth-note subdivisions, 4 = sixteenths. Subdivision clicks are never
   *  accented; only true bar downbeats are. */
  subdivision?: number;
  /** Called every scheduling tick (~SCHEDULER_INTERVAL_MS) with the current
   *  audio-clock-derived musical time, so the cursor can advance. */
  onTick?: (tick: MetronomeTick) => void;
  /** Called once when the whole timeline (count-in + line) has elapsed. */
  onFinished?: () => void;
  /** Injectable timer (for tests). Defaults to window.setInterval/clearInterval. */
  setIntervalFn?: (cb: () => void, ms: number) => number;
  clearIntervalFn?: (id: number) => void;
}

/** Build the (possibly subdivided) click list from the base schedule. The base
 *  schedule already has one click per beat with correct accents; for subdivision
 *  > 1 we insert (subdivision-1) unaccented clicks between each beat. */
function buildClicks(schedule: Schedule, subdivision: number): MetronomeClick[] {
  if (subdivision <= 1) return schedule.clicks;
  const base = schedule.clicks;
  const out: MetronomeClick[] = [];
  for (let i = 0; i < base.length; i++) {
    const c = base[i]!;
    // ms between this beat and the next (assume uniform; last beat reuses prev gap).
    const next = base[i + 1];
    const prev = base[i - 1];
    const beatGap = next
      ? next.timeMs - c.timeMs
      : prev
        ? c.timeMs - prev.timeMs
        : 0;
    const subGap = beatGap / subdivision;
    for (let s = 0; s < subdivision; s++) {
      out.push({
        timeMs: c.timeMs + s * subGap,
        accented: s === 0 && c.accented, // only the real downbeat is accented
        isCountIn: c.isCountIn,
        barIndex: c.barIndex,
        beatInBar: c.beatInBar,
      });
    }
  }
  return out;
}

/**
 * The metronome. Construct with an AudioContext (or compatible AudioClock) and a
 * Line; call start() to begin (with count-in) and stop() to halt. The metronome
 * owns the authoritative timeline; the cursor reads `onTick` to follow it.
 */
export class Metronome {
  private readonly ctx: AudioClock;
  private readonly schedule: Schedule;
  private readonly clicks: MetronomeClick[];
  private readonly opts: Required<
    Pick<MetronomeOptions, 'countInBars' | 'subdivision'>
  > &
    MetronomeOptions;
  private readonly setIntervalFn: (cb: () => void, ms: number) => number;
  private readonly clearIntervalFn: (id: number) => void;

  /** AudioContext time (seconds) that corresponds to elapsedMs == 0. Set on start. */
  private startAudioTime = 0;
  /** Index of the next click not yet scheduled. */
  private nextClickToSchedule = 0;
  private timerId: number | null = null;
  private running = false;
  private finishedFired = false;

  constructor(ctx: AudioClock, line: Line, options: MetronomeOptions = {}) {
    this.ctx = ctx;
    const countInBars = options.countInBars ?? DEFAULT_COUNT_IN_BARS;
    const subdivision = Math.max(1, Math.floor(options.subdivision ?? 1));
    this.schedule = precomputeSchedule(line, line.tempo, countInBars);
    this.clicks = buildClicks(this.schedule, subdivision);
    this.opts = { ...options, countInBars, subdivision };
    // Default to the real timers; tests inject fakes.
    this.setIntervalFn =
      options.setIntervalFn ??
      ((cb, ms) => globalThis.setInterval(cb, ms) as unknown as number);
    this.clearIntervalFn =
      options.clearIntervalFn ??
      ((id) => globalThis.clearInterval(id as unknown as ReturnType<typeof setInterval>));
  }

  /** The shared precomputed schedule (cursor/evaluation read it). */
  getSchedule(): Schedule {
    return this.schedule;
  }

  /** Whether the metronome is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Start the metronome. t=0 (the first count-in click) is anchored a hair in
   * the future so the very first click can still be scheduled cleanly. After
   * this returns, the lookahead loop drives everything.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.finishedFired = false;
    this.nextClickToSchedule = 0;
    // Anchor t=0 slightly ahead of "now" so the first click is schedulable.
    this.startAudioTime = this.ctx.currentTime + 0.1;
    console.log(
      `[AUDIO] metronome start: t0=${this.startAudioTime.toFixed(3)}s ` +
        `clicks=${this.clicks.length} countInBars=${this.opts.countInBars} ` +
        `subdivision=${this.opts.subdivision} total=${this.schedule.totalDurationMs.toFixed(0)}ms`,
    );
    // Schedule once immediately so a fake-timer test sees output without waiting.
    this.scheduleTick();
    this.timerId = this.setIntervalFn(
      () => this.scheduleTick(),
      SCHEDULER_INTERVAL_MS,
    );
  }

  /** Stop the metronome and clear the lookahead loop. Idempotent. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timerId !== null) {
      this.clearIntervalFn(this.timerId);
      this.timerId = null;
    }
    console.log('[AUDIO] metronome stop');
  }

  /** Current elapsed ms from t=0, derived from the AUDIO clock (authoritative). */
  elapsedMs(): number {
    return (this.ctx.currentTime - this.startAudioTime) * 1000;
  }

  /** The AudioContext time (seconds) that corresponds to schedule t=0 (the first
   *  count-in click). Set on start(); the audio-input graph anchors its detected-
   *  onset clock to this so detections share the expected-onset (schedule) clock. */
  getStartAudioTime(): number {
    return this.startAudioTime;
  }

  /**
   * One lookahead pass: schedule every click whose time lands within the next
   * LOOKAHEAD_MS, emit a tick report, and fire onFinished once at the end.
   * The audio clock — not this timer's cadence — determines when clicks sound.
   */
  private scheduleTick(): void {
    if (!this.running) return;
    const nowMs = this.elapsedMs();
    const horizonMs = nowMs + LOOKAHEAD_MS;

    while (
      this.nextClickToSchedule < this.clicks.length &&
      this.clicks[this.nextClickToSchedule]!.timeMs < horizonMs
    ) {
      const click = this.clicks[this.nextClickToSchedule]!;
      const when = this.startAudioTime + click.timeMs / 1000;
      // Guard against scheduling in the past (e.g. a long GC pause); clamp to now.
      this.scheduleClick(Math.max(when, this.ctx.currentTime), click.accented);
      this.nextClickToSchedule++;
    }

    this.emitTick(nowMs);

    if (nowMs >= this.schedule.totalDurationMs && !this.finishedFired) {
      this.finishedFired = true;
      console.log(
        `[AUDIO] metronome finished at ${nowMs.toFixed(1)}ms ` +
          `(expected ${this.schedule.totalDurationMs.toFixed(1)}ms, ` +
          `deviation ${(nowMs - this.schedule.totalDurationMs).toFixed(1)}ms)`,
      );
      this.opts.onFinished?.();
    }
  }

  /** Emit a MetronomeTick from the current audio time so the cursor can follow. */
  private emitTick(nowMs: number): void {
    if (!this.opts.onTick) return;
    // Index of the most-recent click that has already sounded (<= now).
    let currentClickIndex = -1;
    let inCountIn = true;
    for (let i = 0; i < this.clicks.length; i++) {
      if (this.clicks[i]!.timeMs <= nowMs) {
        currentClickIndex = i;
        inCountIn = this.clicks[i]!.isCountIn;
      } else {
        break;
      }
    }
    this.opts.onTick({
      audioTime: this.ctx.currentTime,
      elapsedMs: nowMs,
      currentClickIndex,
      inCountIn: currentClickIndex < 0 ? true : inCountIn,
      finished: nowMs >= this.schedule.totalDurationMs,
    });
  }

  /** Schedule a single click blip at `when` (seconds, audio clock). */
  private scheduleClick(when: number, accented: boolean): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accented ? CLICK_FREQ_ACCENT : CLICK_FREQ_NORMAL;
    const peak = accented ? CLICK_GAIN_ACCENT : CLICK_GAIN_NORMAL;
    // Tiny attack + exponential-ish decay so the blip is a click, not a tone.
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.001);
    gain.gain.linearRampToValueAtTime(0, when + CLICK_DURATION_S);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(when);
    osc.stop(when + CLICK_DURATION_S);
  }
}

/** Convenience factory: build a metronome from a Line (tempo read from the Line). */
export function createMetronome(
  ctx: AudioClock,
  line: Line,
  options: MetronomeOptions = {},
): Metronome {
  return new Metronome(ctx, line, options);
}
