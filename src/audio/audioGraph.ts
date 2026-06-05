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

/**
 * One lightweight RAW detector frame captured during a LIVE run, on the SAME
 * schedule clock as everything else (tMs from the metronome's t=0 == first
 * count-in click). Unlike a committed DetectedNote (one per played note) there is
 * one of these per analysis frame (~rAF cadence), so the review screen can draw a
 * CONTINUOUS detected-pitch trace and make octave errors / timing drift visible.
 * `freqHz`/`midi` are 0/NaN on silent frames (pitchy found no pitch).
 */
export interface DetectionFrame {
  /** schedule-clock ms (t=0 == first count-in click) of this frame. */
  tMs: number;
  /** detected fundamental in Hz (0 when no pitch). */
  freqHz: number;
  /** pitchy clarity in [0,1]. */
  clarity: number;
  /** nearest integer MIDI (NaN when no usable pitch). */
  midi: number;
}

/**
 * MIME type we ask MediaRecorder to record the take in. WebM/Opus is what
 * Chromium (and therefore Electron) supports natively for MediaRecorder; an
 * <audio> element plays it back from an object URL without any decoder plumbing.
 * If the runtime rejects it we fall back to the browser default (empty string) —
 * see startRecorder. Documented in LEARNINGS.md.
 */
export const RECORDING_MIME_TYPE = 'audio/webm;codecs=opus';

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
  /**
   * When true, capture EVERY raw detector frame into an in-memory buffer for the
   * detection-review screen's continuous pitch trace. Retrieve it after stop()
   * via getFrames(). Default true (the frames are cheap and the review needs them).
   */
  captureFrames?: boolean;
  /**
   * When true, record the input MediaStream via MediaRecorder for the whole run
   * so the review screen can replay the take. Retrieve the Blob after stop() via
   * getRecording(). Default true; silently no-ops if MediaRecorder is unavailable.
   */
  record?: boolean;
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

  // --- detection-review capture (in-memory only) ---------------------------
  /** Raw per-frame trace for the review's continuous pitch graph. */
  private frames: DetectionFrame[] = [];
  /** MediaRecorder recording the input for replay, and its accumulated chunks. */
  private recorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  /** The actual MIME type the recorder used (for the playback Blob + logging). */
  private recordingMimeType = '';
  /**
   * Promise resolving to the recorded-audio Blob (or null) for the LAST run. We
   * use a promise because MediaRecorder finalises asynchronously: stop() requests
   * the final chunk and the recorder's `onstop` (after the trailing
   * `ondataavailable`) assembles + resolves the Blob. getRecording() returns this.
   */
  private recordingPromise: Promise<Blob | null> = Promise.resolve(null);
  private resolveRecording: (blob: Blob | null) => void = () => {};

  constructor(ctx: AudioContext, options: AudioGraphOptions = {}) {
    this.ctx = ctx;
    this.opts = options;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * The raw detector frames captured during the last run (continuous pitch trace
   * for the review graph). Empty if frame capture was disabled or nothing ran.
   * A defensive copy so callers can keep it past the next run.
   */
  getFrames(): DetectionFrame[] {
    return this.frames.slice();
  }

  /**
   * The recorded-audio Blob from the last run for review playback, or null when
   * recording was disabled / unavailable / produced no data. In-memory only (no
   * persistence): the caller turns it into an object URL for an <audio> element.
   * RESOLVES after stop() once MediaRecorder has flushed its final chunk (it
   * finalises asynchronously), so await this AFTER stop() to get the full take.
   */
  getRecording(): Promise<Blob | null> {
    return this.recordingPromise;
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

    // Fresh per-run review capture state.
    this.frames = [];
    this.recordedChunks = [];
    this.recordingMimeType = '';
    const captureFrames = this.opts.captureFrames !== false; // default ON
    const record = this.opts.record !== false; // default ON

    // A fresh deferred for THIS run's recording. If recording is off / fails to
    // start, resolve it null immediately so getRecording() never hangs.
    this.recordingPromise = new Promise<Blob | null>((resolve) => {
      this.resolveRecording = resolve;
    });

    // Start recording the take for review playback (in-memory). Best-effort: a
    // runtime without MediaRecorder simply yields no recording (synthetic-style).
    if (record) {
      this.startRecorder(this.stream);
    } else {
      this.resolveRecording(null);
    }

    const mapper: PitchDetectorOptions['audioTimeToScheduleMs'] = (t) =>
      (t - audioT0Seconds) * 1000;

    // Wrap onSample to also collect the raw frame (on the schedule clock) for the
    // review's continuous trace, then forward to the caller's onSample.
    const onSample: PitchDetectorOptions['onSample'] = (event: PitchEvent) => {
      if (captureFrames) {
        this.frames.push({
          tMs: event.timeMs,
          freqHz: event.frequencyHz,
          clarity: event.clarity,
          midi: event.midi,
        });
      }
      this.opts.onSample?.(event);
    };

    this.detector = new LivePitchDetector({
      context: this.ctx,
      source: this.sourceNode,
      audioTimeToScheduleMs: mapper,
      onSample,
      onNote: this.opts.onNote,
    });
    this.detector.start();
    this.running = true;
    console.log(
      `[AUDIO] audio graph running (captureFrames=${captureFrames} record=${record})`,
    );
  }

  /**
   * Begin recording `stream` for review playback. WebM/Opus where supported,
   * falling back to the runtime default codec, falling back to no recording if
   * MediaRecorder is missing entirely. Chunks accumulate via ondataavailable and
   * are assembled into a single Blob in stop(). In-memory only.
   */
  private startRecorder(stream: MediaStream): void {
    if (typeof MediaRecorder === 'undefined') {
      console.warn('[AUDIO] MediaRecorder unavailable; take will not be recorded');
      this.resolveRecording(null);
      return;
    }
    // Pick the best supported MIME type. isTypeSupported is itself optional on
    // some implementations, so guard it.
    let mimeType = '';
    const canCheck = typeof MediaRecorder.isTypeSupported === 'function';
    if (!canCheck || MediaRecorder.isTypeSupported(RECORDING_MIME_TYPE)) {
      mimeType = RECORDING_MIME_TYPE;
    } else if (MediaRecorder.isTypeSupported('audio/webm')) {
      mimeType = 'audio/webm';
    } // else leave '' -> let the implementation choose its default

    try {
      const rec = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      this.recordingMimeType = rec.mimeType || mimeType;
      rec.ondataavailable = (e: BlobEvent): void => {
        if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
      };
      // onstop fires AFTER the final ondataavailable, so the chunk list is
      // complete here — assemble the Blob and resolve the per-run promise.
      rec.onstop = (): void => {
        if (this.recordedChunks.length > 0) {
          const type = this.recordingMimeType || 'audio/webm';
          const blob = new Blob(this.recordedChunks, { type });
          console.log(
            `[AUDIO] recording finished: ${this.recordedChunks.length} chunk(s), ` +
              `${blob.size} bytes, type=${type}`,
          );
          this.resolveRecording(blob);
        } else {
          console.log('[AUDIO] recording finished: no data captured');
          this.resolveRecording(null);
        }
        this.recordedChunks = [];
      };
      // Timeslice so chunks accumulate periodically (a take that ends abruptly
      // still has data); the final partial chunk arrives on stop().
      rec.start(1000);
      this.recorder = rec;
      console.log(
        `[AUDIO] recording take (mimeType=${this.recordingMimeType || '(default)'})`,
      );
    } catch (err) {
      console.warn('[AUDIO] MediaRecorder failed to start; no recording', err);
      this.recorder = null;
      this.resolveRecording(null);
    }
  }

  /** Stop the recorder (if any); its `onstop` assembles + resolves the Blob. */
  private finishRecorder(): void {
    const rec = this.recorder;
    this.recorder = null;
    if (!rec) {
      // No active recorder: ensure the promise is resolved so getRecording()
      // never hangs (covers a stop() with recording disabled or already done).
      this.resolveRecording(null);
      return;
    }
    try {
      if (rec.state !== 'inactive') {
        rec.stop(); // fires a final ondataavailable then onstop (resolves the Blob)
      } else {
        this.resolveRecording(null);
      }
    } catch (err) {
      console.warn('[AUDIO] error stopping MediaRecorder', err);
      this.resolveRecording(null);
    }
  }

  /** Stop analysis and release the microphone / device. Idempotent. */
  stop(): void {
    if (!this.running && !this.stream) return;
    this.running = false;
    this.finishRecorder();
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
    console.log(
      `[AUDIO] audio graph stopped (mic released; frames=${this.frames.length}; ` +
        `recording finalising async)`,
    );
  }
}
