// audioGraph.ts — the live input audio graph: device -> MediaStreamSource ->
// pitch detector. Owns getUserMedia, the AudioContext source node, and the
// detector lifecycle. Exposes detected-note events to the UI.
//
// Web-Audio/UI layer (tsconfig.ui): getUserMedia / MediaStream / Web Audio
// allowed. NOT pure.
//
// Clock contract: the metronome is the authoritative musical clock and reports
// its t=0 as an AudioContext time. We pass the detector an audioTimeToScheduleMs
// mapper anchored to that t=0 so DETECTED onsets land on the SAME ms clock as the
// EXPECTED onsets (the schedule). That is what makes evaluation's onset alignment
// meaningful (brief section 13).

import {
  LivePitchDetector,
  type PitchEvent,
  type PitchDetectorOptions,
} from './pitchDetector.js';
import type { DetectedNote } from '../evaluation/index.js';

/** A selectable audio input device (from enumerateDevices). */
export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

/**
 * Enumerate audio INPUT devices. NOTE: device labels are only populated AFTER the
 * user has granted microphone permission once (a browser/Electron privacy rule),
 * so the picker should request permission first (see ensureMicPermission) and
 * then enumerate, or labels will be blank. Returns [] outside a DOM/secure
 * context (e.g. during SSR/test) rather than throwing.
 */
export async function enumerateInputDevices(): Promise<AudioInputDevice[]> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    console.warn('[AUDIO] enumerateDevices unavailable (no mediaDevices)');
    return [];
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  const inputs = all
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Input ${i + 1}`,
    }));
  console.log(`[AUDIO] enumerated ${inputs.length} audio input device(s)`);
  return inputs;
}

/**
 * Request microphone permission once so device labels become available and the
 * chosen interface can be opened. Returns true on grant. Immediately stops the
 * probe stream — we only needed the permission, not the audio. Safe to call
 * repeatedly (the OS caches the grant).
 */
export async function ensureMicPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    console.warn('[AUDIO] getUserMedia unavailable; cannot request mic permission');
    return false;
  }
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
    console.log('[AUDIO] microphone permission granted');
    return true;
  } catch (err) {
    console.warn('[AUDIO] microphone permission denied / unavailable', err);
    return false;
  }
}

export interface AudioGraphOptions {
  /** Device to open, or undefined for the system default input. */
  deviceId?: string;
  /** Raw per-frame pitch events (live readout / debugging). */
  onSample?: (event: PitchEvent) => void;
  /** Committed note onsets that feed evaluation. */
  onNote?: (note: DetectedNote) => void;
}

/**
 * The live input graph. Lifecycle:
 *   const g = new AudioGraph(ctx, opts);
 *   await g.start(audioT0Seconds);  // open device, build detector, begin analysis
 *   ...                             // onNote fires as the player plays
 *   g.stop();                       // halt detector, release the mic
 *
 * `start` takes the metronome's t=0 (AudioContext seconds) so detected onsets are
 * timestamped on the schedule clock. Pass it the same value the metronome
 * anchored to (the audio time at its first count-in click).
 */
export class AudioGraph {
  private readonly ctx: AudioContext;
  private readonly opts: AudioGraphOptions;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private detector: LivePitchDetector | null = null;
  private running = false;

  constructor(ctx: AudioContext, options: AudioGraphOptions = {}) {
    this.ctx = ctx;
    this.opts = options;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Open the selected input, wire MediaStreamSource -> detector, start analysing.
   *
   * @param audioT0Seconds  the AudioContext.currentTime that corresponds to
   *                        schedule t=0 (the metronome's first count-in click). All
   *                        detected onsets are reported relative to this so they
   *                        share the expected-onset clock.
   */
  async start(audioT0Seconds: number): Promise<void> {
    if (this.running) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('[AUDIO] getUserMedia unavailable; cannot start audio graph');
    }

    // Disable the browser's voice-processing DSP — it mangles instrument input.
    // We want the raw guitar signal, not a cleaned-up "voice".
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (this.opts.deviceId) {
      audioConstraints.deviceId = { exact: this.opts.deviceId };
    }

    console.log(
      `[AUDIO] opening input device=${this.opts.deviceId ?? '(default)'} ` +
        `t0=${audioT0Seconds.toFixed(3)}s`,
    );
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
    });
    this.sourceNode = this.ctx.createMediaStreamSource(this.stream);

    const mapper: PitchDetectorOptions['audioTimeToScheduleMs'] = (t) =>
      (t - audioT0Seconds) * 1000;

    this.detector = new LivePitchDetector({
      context: this.ctx,
      source: this.sourceNode,
      audioTimeToScheduleMs: mapper,
      onSample: this.opts.onSample,
      onNote: this.opts.onNote,
    });
    this.detector.start();
    this.running = true;
    console.log('[AUDIO] audio graph running');
  }

  /** Stop analysis and release the microphone / device. Idempotent. */
  stop(): void {
    if (!this.running && !this.stream) return;
    this.running = false;
    this.detector?.stop();
    this.detector = null;
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        /* already disconnected */
      }
      this.sourceNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    console.log('[AUDIO] audio graph stopped (mic released)');
  }
}
