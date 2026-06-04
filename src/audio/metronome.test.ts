// Tests for the Web Audio metronome's SCHEDULING LOGIC, driven by a fake audio
// clock and a fake lookahead timer. We are not testing real sound (that is the
// live Gate-2 measurement); we are testing that:
//   * clicks are scheduled AHEAD against the audio clock (never via the timer),
//   * only future clicks within the lookahead window are scheduled per wake-up,
//   * accents land on bar downbeats,
//   * elapsed time / current click is derived from the AUDIO clock,
//   * onFinished fires once at the end and the metronome never "waits".
//
// Runs under the vitest node environment via injected fakes (no real WebAudio).

import { describe, it, expect, vi } from 'vitest';
import {
  Metronome,
  LOOKAHEAD_MS,
  SCHEDULER_INTERVAL_MS,
  type AudioClock,
} from './metronome.js';
import type { Line, LineNote, Pitch } from '../domain/index.js';
import {
  FOUR_FOUR,
  makeDuration,
  makeNeckPosition,
  TICKS_PER_QUARTER,
} from '../domain/index.js';
import type { Key } from '../domain/index.js';

const cMajor: Key = { tonic: { name: 'C', accidental: 'natural' }, mode: 'major' };
const C4: Pitch = { name: 'C', accidental: 'natural', octave: 4 };
const stubChord = { root: C4, quality: 'major' as const };

function qNote(startTick: number): LineNote {
  return {
    pitch: C4,
    duration: makeDuration('quarter'),
    startTick,
    barIndex: Math.floor(startTick / (TICKS_PER_QUARTER * 4)),
    beatPositionInBar: startTick % (TICKS_PER_QUARTER * 4),
    isStrongBeat: startTick % (TICKS_PER_QUARTER * 4) === 0,
    impliedChord: stubChord,
    chordToneRole: 'root',
    tiedToNext: false,
  };
}

/** Tiny line: 1 bar of 4 quarters in 4/4 at 120 BPM. */
function oneBarLine(): Line {
  const notes: LineNote[] = [];
  for (let i = 0; i < 4; i++) notes.push(qNote(i * TICKS_PER_QUARTER));
  return {
    id: 't',
    seed: 1,
    generatedAt: '2026-06-04T00:00:00.000Z',
    key: cMajor,
    timeSignature: FOUR_FOUR,
    position: makeNeckPosition(1, 6, 4, 8, 'V'),
    tempo: 120,
    barCount: 1,
    progression: { progressionId: 's', chords: [] },
    phraseStructure: { pattern: 'AAAB', barRoles: ['A'] },
    contourTarget: { shape: 'steady', climaxBar: 0, climaxPitch: C4, perBarTargets: [C4] },
    rhythmicMotifPlan: { perBarMotifIds: [], variations: [] },
    notes,
    generatorVersion: 'test',
    validationsPassed: [],
  };
}

/** A fake AudioContext: a settable clock and oscillator/gain spies. */
function makeFakeClock() {
  const scheduled: Array<{ when: number; freq: number }> = [];
  let now = 0;
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const ctx = {
    get currentTime() {
      return now;
    },
    setNow(t: number) {
      now = t;
    },
    createOscillator() {
      const freqParam = param();
      const o = {
        frequency: freqParam,
        connect: vi.fn(),
        start: vi.fn((when: number) => {
          scheduled.push({ when, freq: freqParam.value });
        }),
        stop: vi.fn(),
      };
      return o as unknown as OscillatorNode;
    },
    createGain() {
      const g = { gain: param(), connect: vi.fn() };
      return g as unknown as GainNode;
    },
    destination: {} as AudioDestinationNode,
  };
  return { ctx: ctx as unknown as AudioClock & { setNow(t: number): void }, scheduled };
}

/** A controllable fake interval timer: collect callbacks, fire on demand. */
function makeFakeTimer() {
  const callbacks: Array<() => void> = [];
  return {
    setIntervalFn: (cb: () => void, _ms: number) => {
      callbacks.push(cb);
      return callbacks.length; // id (1-based)
    },
    clearIntervalFn: (_id: number) => {
      callbacks.length = 0;
    },
    fireAll: () => callbacks.forEach((cb) => cb()),
  };
}

describe('Metronome scheduling', () => {
  it('on start it anchors t=0 ahead of now and schedules only the lookahead window', () => {
    const { ctx, scheduled } = makeFakeClock();
    const timer = makeFakeTimer();
    ctx.setNow(0);
    const m = new Metronome(ctx, oneBarLine(), {
      countInBars: 1,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn,
    });
    m.start();
    // t0 is 0.1s ahead; at now=0 only clicks within [0, 0.1-0.1+LOOKAHEAD] are due.
    // elapsedMs at start = (0 - 0.1)*1000 = -100ms; horizon = -100 + LOOKAHEAD(100) = 0ms.
    // No click has timeMs < 0, so nothing scheduled yet.
    expect(scheduled.length).toBe(0);
    expect(LOOKAHEAD_MS).toBeGreaterThan(SCHEDULER_INTERVAL_MS);
    m.stop();
  });

  it('schedules clicks AHEAD against the audio clock as time advances', () => {
    const { ctx, scheduled } = makeFakeClock();
    const timer = makeFakeTimer();
    ctx.setNow(0);
    const m = new Metronome(ctx, oneBarLine(), {
      countInBars: 1,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn,
    });
    m.start(); // t0 = 0.1s
    // Advance the audio clock to t0 (elapsed 0ms): the first count-in downbeat is due.
    ctx.setNow(0.1);
    timer.fireAll();
    expect(scheduled.length).toBeGreaterThanOrEqual(1);
    // The first scheduled click is at audio time t0 == 0.1s.
    expect(scheduled[0]!.when).toBeCloseTo(0.1, 6);
    m.stop();
  });

  it('schedules every click ahead and accents bar downbeats (8 clicks: 1 count-in + 1 line bar)', () => {
    const { ctx, scheduled } = makeFakeClock();
    const timer = makeFakeTimer();
    ctx.setNow(0);
    const m = new Metronome(ctx, oneBarLine(), {
      countInBars: 1,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn,
    });
    m.start();
    // Sweep the audio clock across the whole timeline, firing the scheduler.
    // total = (1 count-in + 1 line) bar * 2000ms = 4000ms -> t0 + 4.0s.
    for (let t = 0; t <= 4.2; t += 0.05) {
      ctx.setNow(0.1 + t);
      timer.fireAll();
    }
    // 2 bars * 4 beats = 8 clicks total, each scheduled exactly once.
    expect(scheduled.length).toBe(8);
    // Accented clicks (downbeats) use the higher frequency (1500). There are 2.
    const accents = scheduled.filter((s) => s.freq === 1500);
    expect(accents.length).toBe(2);
    // Click 0 (first count-in downbeat) at 0.1s, click 4 (line downbeat) at 0.1+2.0s.
    expect(scheduled[0]!.when).toBeCloseTo(0.1, 6);
    expect(scheduled[4]!.when).toBeCloseTo(2.1, 6);
    m.stop();
  });

  it('derives elapsedMs and current click from the AUDIO clock (never the timer)', () => {
    const { ctx } = makeFakeClock();
    const timer = makeFakeTimer();
    ctx.setNow(0);
    const ticks: number[] = [];
    const m = new Metronome(ctx, oneBarLine(), {
      countInBars: 1,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn,
      onTick: (t) => ticks.push(t.elapsedMs),
    });
    m.start(); // t0 = 0.1
    // Jump the audio clock straight to the line's first beat (2000ms in).
    ctx.setNow(0.1 + 2.0);
    timer.fireAll();
    const last = ticks[ticks.length - 1]!;
    expect(last).toBeCloseTo(2000, 3);
    m.stop();
  });

  it('reports inCountIn correctly across the count-in boundary', () => {
    const { ctx } = makeFakeClock();
    const timer = makeFakeTimer();
    ctx.setNow(0);
    let lastInCountIn = true;
    const m = new Metronome(ctx, oneBarLine(), {
      countInBars: 1,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn,
      onTick: (t) => {
        lastInCountIn = t.inCountIn;
      },
    });
    m.start();
    // During count-in (elapsed 500ms).
    ctx.setNow(0.1 + 0.5);
    timer.fireAll();
    expect(lastInCountIn).toBe(true);
    // After count-in, into the line (elapsed 2500ms).
    ctx.setNow(0.1 + 2.5);
    timer.fireAll();
    expect(lastInCountIn).toBe(false);
    m.stop();
  });

  it('fires onFinished exactly once at the end and never waits for the user', () => {
    const { ctx } = makeFakeClock();
    const timer = makeFakeTimer();
    ctx.setNow(0);
    const onFinished = vi.fn();
    const m = new Metronome(ctx, oneBarLine(), {
      countInBars: 1,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn,
      onFinished,
    });
    m.start();
    // Drive well past the 4000ms total; fire the scheduler many times.
    for (let t = 0; t <= 5.0; t += 0.1) {
      ctx.setNow(0.1 + t);
      timer.fireAll();
    }
    expect(onFinished).toHaveBeenCalledTimes(1);
    m.stop();
  });

  it('inserts unaccented subdivision clicks between beats (subdivision=2)', () => {
    const { ctx, scheduled } = makeFakeClock();
    const timer = makeFakeTimer();
    ctx.setNow(0);
    const m = new Metronome(ctx, oneBarLine(), {
      countInBars: 1,
      subdivision: 2,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn,
    });
    m.start();
    for (let t = 0; t <= 4.2; t += 0.05) {
      ctx.setNow(0.1 + t);
      timer.fireAll();
    }
    // 8 beats * 2 subdivisions = 16 clicks; still only 2 accents (real downbeats).
    expect(scheduled.length).toBe(16);
    expect(scheduled.filter((s) => s.freq === 1500).length).toBe(2);
    m.stop();
  });

  it('stop() is idempotent and halts scheduling', () => {
    const { ctx, scheduled } = makeFakeClock();
    const timer = makeFakeTimer();
    ctx.setNow(0);
    const m = new Metronome(ctx, oneBarLine(), {
      countInBars: 1,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn,
    });
    m.start();
    m.stop();
    m.stop(); // no throw
    const before = scheduled.length;
    ctx.setNow(2.0);
    timer.fireAll(); // callbacks were cleared; nothing should schedule
    expect(scheduled.length).toBe(before);
    expect(m.isRunning()).toBe(false);
  });
});
