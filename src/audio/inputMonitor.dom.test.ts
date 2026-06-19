// Tests for InputLevelMonitor's wiring under happy-dom (no real Web Audio): open
// the input, tap it with an AnalyserNode, expose a smoothed RMS level, and release
// the mic on stop. We fake the Web Audio + getUserMedia pieces (like
// audioGraph.dom.test.ts). The level MATH itself lives in pitchMath.rmsLevel /
// micMeter and is unit-tested separately; here we only verify the plumbing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputLevelMonitor } from './inputMonitor.js';

// --- fakes -----------------------------------------------------------------

/** A fake AnalyserNode whose time-domain buffer is a constant `signal` (so RMS is
 *  deterministic and non-zero when we want the meter to move). */
function fakeAnalyser(signal: number): AnalyserNode {
  return {
    fftSize: 1024,
    getFloatTimeDomainData: (buf: Float32Array) => buf.fill(signal),
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AnalyserNode;
}

const connect = vi.fn();
const disconnect = vi.fn();
const resume = vi.fn(async () => {});

/** A fake AudioContext exposing only what InputLevelMonitor touches. `state` lets
 *  us drive the suspended→resume path. */
function fakeContext(signal: number, state: AudioContextState = 'running'): AudioContext {
  return {
    state,
    sampleRate: 48000,
    resume,
    createMediaStreamSource: () =>
      ({ connect, disconnect }) as unknown as MediaStreamAudioSourceNode,
    createAnalyser: () => fakeAnalyser(signal),
  } as unknown as AudioContext;
}

const trackStop = vi.fn();
function fakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: trackStop } as unknown as MediaStreamTrack],
  } as unknown as MediaStream;
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  connect.mockClear();
  disconnect.mockClear();
  resume.mockClear();
  trackStop.mockClear();
  getUserMedia = vi.fn(async () => fakeStream());
  (navigator as unknown as { mediaDevices: unknown }).mediaDevices = { getUserMedia };
});

afterEach(() => {
  delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
});

// --- tests -----------------------------------------------------------------

describe('InputLevelMonitor', () => {
  it('opens the chosen device with instrument constraints and taps it', async () => {
    const m = new InputLevelMonitor(fakeContext(0.5));
    await m.start('scarlett-2i2');

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const constraints = getUserMedia.mock.calls[0]![0] as { audio: MediaTrackConstraints };
    expect(constraints.audio.deviceId).toEqual({ exact: 'scarlett-2i2' });
    // raw instrument signal — no voice DSP.
    expect(constraints.audio.echoCancellation).toBe(false);
    expect(constraints.audio.noiseSuppression).toBe(false);
    expect(constraints.audio.autoGainControl).toBe(false);
    // source tapped into the analyser.
    expect(connect).toHaveBeenCalledTimes(1);
    m.stop();
  });

  it('omits the deviceId constraint when none is given (system default)', async () => {
    const m = new InputLevelMonitor(fakeContext(0));
    await m.start();
    const constraints = getUserMedia.mock.calls[0]![0] as { audio: MediaTrackConstraints };
    expect(constraints.audio.deviceId).toBeUndefined();
    m.stop();
  });

  it('reports a smoothed level that rises toward the input RMS', async () => {
    const m = new InputLevelMonitor(fakeContext(0.5)); // constant 0.5 -> RMS 0.5
    await m.start();
    const first = m.getLevel();
    const second = m.getLevel();
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first); // exponential smoothing climbs each frame
    expect(second).toBeLessThan(0.5); // but has not reached the target yet
    m.stop();
  });

  it('resumes a suspended context so the tap produces data', async () => {
    const m = new InputLevelMonitor(fakeContext(0.5, 'suspended'));
    await m.start();
    expect(resume).toHaveBeenCalledTimes(1);
    m.stop();
  });

  it('releases the mic and goes silent on stop()', async () => {
    const m = new InputLevelMonitor(fakeContext(0.5));
    await m.start();
    m.getLevel();
    m.stop();
    expect(trackStop).toHaveBeenCalledTimes(1); // mic track stopped
    expect(disconnect).toHaveBeenCalled();
    expect(m.getLevel()).toBe(0); // no analyser after stop
  });

  it('returns 0 before start() (no analyser yet)', () => {
    const m = new InputLevelMonitor(fakeContext(0.5));
    expect(m.getLevel()).toBe(0);
  });

  it('does not leak a hot mic if stopped mid-getUserMedia', async () => {
    // stop() races ahead of the in-flight getUserMedia; the resolved stream must be
    // released rather than wired up.
    let resolveStream!: (s: MediaStream) => void;
    getUserMedia.mockImplementationOnce(
      () => new Promise<MediaStream>((res) => { resolveStream = res; }),
    );
    const m = new InputLevelMonitor(fakeContext(0.5));
    const starting = m.start();
    m.stop(); // tear down before the device opens
    resolveStream(fakeStream());
    await starting;
    expect(trackStop).toHaveBeenCalled(); // the late stream's track was stopped
    expect(connect).not.toHaveBeenCalled(); // never wired into the graph
  });
});
