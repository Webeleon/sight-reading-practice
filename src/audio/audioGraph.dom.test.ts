// Tests for the AudioGraph's DETECTION-REVIEW capture: MediaRecorder lifecycle
// (start -> chunks -> stop -> assembled Blob) and raw-frame collection. Runs under
// happy-dom (which has Blob/URL but NOT AudioContext/MediaRecorder), so we fake the
// Web Audio + MediaRecorder pieces. Live pitch-detection ACCURACY is Human Review
// Gate 3 and not tested here; we only verify the in-memory capture plumbing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioGraph, RECORDING_MIME_TYPE } from './audioGraph.js';

// --- fakes -----------------------------------------------------------------

/** A fake AnalyserNode whose time-domain buffer is silent (pitchy -> no pitch),
 *  so the detector's single synchronous analysis pass is cheap and deterministic. */
function fakeAnalyser(): AnalyserNode {
  return {
    fftSize: 2048,
    getFloatTimeDomainData: (buf: Float32Array) => buf.fill(0),
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AnalyserNode;
}

/** A fake AudioContext exposing only what AudioGraph + LivePitchDetector touch. */
function fakeContext(): AudioContext {
  return {
    currentTime: 1.5,
    sampleRate: 48000,
    createMediaStreamSource: () =>
      ({ connect: vi.fn(), disconnect: vi.fn() }) as unknown as MediaStreamAudioSourceNode,
    createAnalyser: () => fakeAnalyser(),
  } as unknown as AudioContext;
}

/** A fake MediaStream with a stoppable track. */
function fakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: vi.fn() } as unknown as MediaStreamTrack],
  } as unknown as MediaStream;
}

/** A controllable fake MediaRecorder: records the constructor mimeType, lets the
 *  test push data chunks, and fires ondataavailable+onstop on stop(). */
interface FakeRecorderControl {
  instances: FakeRecorder[];
}
class FakeRecorder {
  static control: FakeRecorderControl = { instances: [] };
  static supported = new Set<string>([RECORDING_MIME_TYPE, 'audio/webm']);
  static isTypeSupported(t: string): boolean {
    return FakeRecorder.supported.has(t);
  }
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  private pending: Blob[] = [];
  constructor(_stream: MediaStream, opts?: MediaRecorderOptions) {
    this.mimeType = opts?.mimeType ?? '';
    FakeRecorder.control.instances.push(this);
  }
  /** Queue a chunk to be emitted (flushed on stop, like a real recorder's tail). */
  pushChunk(bytes: number): void {
    this.pending.push(new Blob([new Uint8Array(bytes)], { type: this.mimeType }));
  }
  start(_timeslice?: number): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    for (const chunk of this.pending) {
      this.ondataavailable?.({ data: chunk } as unknown as BlobEvent);
    }
    this.pending = [];
    this.onstop?.();
  }
}

let origRAF: typeof globalThis.requestAnimationFrame | undefined;
let origCAF: typeof globalThis.cancelAnimationFrame | undefined;

beforeEach(() => {
  FakeRecorder.control.instances = [];
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder =
    FakeRecorder as unknown;
  // getUserMedia returns our fake stream.
  (navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: vi.fn(async () => fakeStream()),
  };
  // The detector schedules its next pass via rAF; make it a no-op so the loop does
  // not spin during the test (we only need the single synchronous first pass).
  origRAF = globalThis.requestAnimationFrame;
  origCAF = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (() => 0) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
});

afterEach(() => {
  if (origRAF) globalThis.requestAnimationFrame = origRAF;
  if (origCAF) globalThis.cancelAnimationFrame = origCAF;
  delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
});

// --- tests -----------------------------------------------------------------

describe('AudioGraph recording lifecycle', () => {
  it('records the take and resolves getRecording() with the assembled Blob', async () => {
    const ctx = fakeContext();
    const g = new AudioGraph(ctx, { record: true, captureFrames: false });
    await g.start(1.0);

    expect(FakeRecorder.control.instances).toHaveLength(1);
    const rec = FakeRecorder.control.instances[0]!;
    expect(rec.mimeType).toBe(RECORDING_MIME_TYPE); // preferred MIME selected
    expect(rec.state).toBe('recording');

    // Simulate some recorded audio, then stop the graph.
    rec.pushChunk(100);
    rec.pushChunk(50);
    g.stop();

    const blob = await g.getRecording();
    expect(blob).not.toBeNull();
    expect(blob!.size).toBe(150);
    expect(blob!.type).toBe(RECORDING_MIME_TYPE);
  });

  it('resolves getRecording() to null when no audio data was captured', async () => {
    const ctx = fakeContext();
    const g = new AudioGraph(ctx, { record: true, captureFrames: false });
    await g.start(1.0);
    g.stop(); // no chunks pushed
    await expect(g.getRecording()).resolves.toBeNull();
  });

  it('resolves getRecording() to null when recording is disabled', async () => {
    const ctx = fakeContext();
    const g = new AudioGraph(ctx, { record: false });
    await g.start(1.0);
    expect(FakeRecorder.control.instances).toHaveLength(0); // recorder never made
    g.stop();
    await expect(g.getRecording()).resolves.toBeNull();
  });

  it('falls back to audio/webm when the preferred codec is unsupported', async () => {
    FakeRecorder.supported = new Set<string>(['audio/webm']); // drop opus
    const ctx = fakeContext();
    const g = new AudioGraph(ctx, { record: true });
    await g.start(1.0);
    expect(FakeRecorder.control.instances[0]!.mimeType).toBe('audio/webm');
    g.stop();
    // restore for other tests
    FakeRecorder.supported = new Set<string>([RECORDING_MIME_TYPE, 'audio/webm']);
  });

  it('resolves getRecording() to null when MediaRecorder is unavailable', async () => {
    delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    const ctx = fakeContext();
    const g = new AudioGraph(ctx, { record: true });
    await g.start(1.0);
    g.stop();
    await expect(g.getRecording()).resolves.toBeNull();
  });
});

describe('AudioGraph frame capture', () => {
  it('captures at least the first synchronous detector frame on the schedule clock', async () => {
    const ctx = fakeContext(); // currentTime 1.5s, t0 passed as 1.0s -> tMs ~500
    const g = new AudioGraph(ctx, { captureFrames: true, record: false });
    await g.start(1.0);
    g.stop();
    const frames = g.getFrames();
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const f = frames[0]!;
    // (currentTime - t0) * 1000 == (1.5 - 1.0) * 1000 == 500ms on the schedule clock.
    expect(f.tMs).toBeCloseTo(500, 6);
    // Silent buffer -> pitchy finds no pitch: freq 0, midi NaN.
    expect(f.freqHz).toBe(0);
    expect(Number.isNaN(f.midi)).toBe(true);
    expect(typeof f.clarity).toBe('number');
  });

  it('returns an empty frame array when capture is disabled', async () => {
    const ctx = fakeContext();
    const g = new AudioGraph(ctx, { captureFrames: false, record: false });
    await g.start(1.0);
    g.stop();
    expect(g.getFrames()).toHaveLength(0);
  });

  it('forwards onSample to the caller while also capturing the frame', async () => {
    const ctx = fakeContext();
    const onSample = vi.fn();
    const g = new AudioGraph(ctx, { captureFrames: true, record: false, onSample });
    await g.start(1.0);
    g.stop();
    expect(onSample).toHaveBeenCalled();
    expect(g.getFrames().length).toBe(onSample.mock.calls.length);
  });
});
