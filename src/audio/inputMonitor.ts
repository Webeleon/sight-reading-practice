// InputLevelMonitor — a lightweight, standalone live input-level meter for the
// "MIC CHECK" card. It exists so the picker's needle can jump as you play BEFORE
// any take is running: the full AudioGraph only reports level inside a take's
// loop, but a mic check has to work cold.
//
// It is deliberately minimal: open the chosen input, tap it with an AnalyserNode
// (passive — never connected to the destination, so nothing is echoed to the
// speakers), and expose a smoothed RMS level. No detection, no recording. The
// caller polls getLevel() once per animation frame and calls stop() to release
// the mic (e.g. while a real take takes over the device).

import { rmsLevel } from './pitchMath.js';
import { INPUT_LEVEL_SMOOTHING } from './audioGraph.js';

/** AnalyserNode window for the level tap. Smaller than the detector's — we only
 *  need a stable RMS, not pitch resolution. */
export const MONITOR_FFT_SIZE = 1024;

export class InputLevelMonitor {
  private readonly ctx: AudioContext;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer = new Float32Array(MONITOR_FFT_SIZE);
  private level = 0;
  private stopped = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /**
   * Open the input device and start tapping its level. Resolves once the graph
   * is live. Safe to call once per monitor; rejects if getUserMedia is
   * unavailable or denied (the caller already surfaces permission state).
   */
  async start(deviceId?: string): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('[AUDIO] getUserMedia unavailable; cannot start mic monitor');
    }
    // Same instrument-friendly constraints as the take graph — raw signal, no
    // voice DSP mangling the guitar.
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (deviceId) audioConstraints.deviceId = { exact: deviceId };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    // The effect may have torn us down while getUserMedia was in flight; if so,
    // release this stream immediately rather than leaking a hot mic.
    if (this.stopped) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.stream = stream;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = MONITOR_FFT_SIZE;
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser); // passive tap; not wired to destination
    console.log(`[AUDIO] mic monitor start device=${deviceId ?? '(default)'}`);
  }

  /**
   * Read the current input frame and return the smoothed level (0..~1). Returns
   * the last value (decaying toward 0) before start() completes or after stop().
   */
  getLevel(): number {
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.buffer);
      const raw = rmsLevel(this.buffer);
      this.level += (raw - this.level) * INPUT_LEVEL_SMOOTHING;
    }
    return this.level;
  }

  /** Stop the tap and release the mic. Idempotent. */
  stop(): void {
    this.stopped = true;
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // already disconnected — ignore.
      }
      this.source = null;
    }
    this.analyser = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.level = 0;
    console.log('[AUDIO] mic monitor stop');
  }
}
