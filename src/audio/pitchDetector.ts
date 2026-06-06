// pitchDetector.ts — live monophonic pitch detection over a Web Audio input.
//
// Web-Audio/UI layer (tsconfig.ui): DOM / Web Audio globals allowed. NOT a pure
// module. The PURE math it relies on (frequencyToMidi, clarity gating, onset
// segmentation) lives in pitchMath.ts + onsetSegmenter.ts and is node-tested.
//
// ============================================================================
// WORKLET vs ANALYSER — READ THIS (and see LEARNINGS.md "Audio worklet bundling")
// ============================================================================
// The brief (section 12) asks for pitch detection in an AudioWorkletNode to keep
// it off the main thread, BUT explicitly permits a main-thread AnalyserNode
// fallback for this throwaway if worklet bundling under electron-vite proves too
// fiddly — and to document the fallback LOUDLY. We took the fallback, on purpose:
//
//   * An AudioWorklet processor must be a SEPARATE module loaded by URL via
//     audioWorklet.addModule(url). Under electron-vite that means a second
//     rollup input emitting a worklet bundle, then resolving its hashed URL at
//     runtime in both dev (Vite dev server) and prod (file://) — and the worklet
//     scope has no DOM/module niceties, so pitchy has to be bundled INTO it.
//     That is real, fiddly plumbing whose only payoff is moving FFT work off the
//     main thread — which the brief says we are explicitly NOT evaluating for
//     latency/perf (sections 1 & 12). Not worth it for a prototype.
//   * The AnalyserNode approach is bullet-proof to bundle (no extra entry, no URL
//     resolution): one AnalyserNode + a requestAnimationFrame poll that copies the
//     time-domain buffer and runs pitchy on the main thread. At ~16ms/frame the
//     CPU cost of one McLeod pass on 2048 samples is negligible for a single
//     monophonic line.
//
// If a future build needs the worklet (e.g. heavier CREPE detection), the seam is
// clean: this class owns the analysis loop; only the "get the next time-domain
// frame + run the detector" step would move into a processor. The emitted-event
// contract (onSample / onNote) would not change.
// ============================================================================

import { PitchDetector as PitchyDetector } from 'pitchy';
import { frequencyToMidi, rmsLevel } from './pitchMath.js';
import {
  OnsetSegmenter,
  DEFAULT_SEGMENTER_CONFIG,
  type PitchSample,
  type SegmenterConfig,
} from './onsetSegmenter.js';
import type { DetectedNote } from '../evaluation/index.js';

/**
 * Analysis window size in samples (brief section 12: "~2048 samples"). pitchy/MPM
 * wants a power-of-two window; 2048 at 44.1/48kHz covers ~43-46ms — long enough
 * to resolve the lowest guitar fundamental (low E ~82Hz needs ~12ms/period, so
 * 2048 gives several periods) and short enough to localise onsets.
 */
export const ANALYSIS_WINDOW_SIZE = 2048;

/**
 * Clarity floor below which a detection is too unreliable to trust (brief section
 * 12: "ignore detections below a clarity threshold"). pitchy clarity for a clean
 * single guitar note through an interface should sit well above this; this
 * placeholder (0.6) must be re-measured against a real guitar at Gate 3 — see
 * LEARNINGS.md. NOTE: kept numerically aligned with the evaluation layer's own
 * CLARITY_THRESHOLD (evaluation/tuning.ts) and the segmenter's clarityFloor so a
 * frame the detector accepts is also one evaluation would accept.
 */
export const CLARITY_THRESHOLD = 0.6;

/**
 * pitchy's INTERNAL clarity threshold (MPM constant k). We set it a touch BELOW
 * our CLARITY_THRESHOLD so pitchy still RETURNS a (freq, clarity) pair for
 * borderline frames and WE do the gating with our named constant — rather than
 * pitchy silently zeroing them. 0.5 keeps weak-but-real attacks reportable.
 */
export const PITCHY_INTERNAL_CLARITY = 0.5;

/**
 * Minimum input volume (dB, <= 0) below which pitchy returns clarity 0. Filters
 * room hum / fret noise / the gap between notes so silence reads as silence. -40
 * dB is a permissive floor (a plugged-in clean guitar note is far louder); raise
 * toward -30 if background noise causes spurious detections at Gate 3.
 */
export const MIN_VOLUME_DECIBELS = -40;

/**
 * Approximate analysis hop in ms — informational. We actually poll on
 * requestAnimationFrame (~16ms at 60fps), so this is the expected cadence used to
 * reason about the segmenter's frame-count thresholds (see onsetSegmenter.ts).
 */
export const ANALYSIS_HOP_MS = 16;

/** A single per-frame detection event (raw, pre-segmentation). */
export interface PitchEvent {
  /** detected fundamental in Hz (0 when no pitch). */
  frequencyHz: number;
  /** pitchy clarity in [0,1]. */
  clarity: number;
  /** nearest integer MIDI (NaN when no usable pitch). */
  midi: number;
  /** schedule-clock ms (t=0 == first count-in click) of this frame. */
  timeMs: number;
}

export interface PitchDetectorOptions {
  /** AudioContext the source node belongs to (provides sampleRate). */
  context: AudioContext;
  /** The node to analyse (a MediaStreamSource for the live input). */
  source: AudioNode;
  /** Maps an AudioContext.currentTime (seconds) to schedule-clock ms (t=0 ==
   *  first count-in click). The audioGraph supplies this so detected onsets land
   *  on the SAME clock as the expected onsets. If omitted, ms-since-start is used. */
  audioTimeToScheduleMs?: (audioTimeSeconds: number) => number;
  /** Called for EVERY analysis frame (raw, pre-segmentation) — for live readout
   *  / debugging (e.g. show the detected note name as you play). */
  onSample?: (event: PitchEvent) => void;
  /** Called when the segmenter COMMITS a new note onset — this is what feeds the
   *  evaluation pipeline (DetectedNote { midi, onsetMs, clarity }). */
  onNote?: (note: DetectedNote) => void;
  /** Called once per analysis frame with the RAW (unsmoothed) RMS amplitude in
   *  [0,1] of the SAME time-domain buffer the detector just analysed — purely a
   *  read-only readout for a VU meter. Computing/reporting it CANNOT change any
   *  detection result (it does not touch the buffer or the detector). A silent
   *  frame (all zeros) reports 0. Optional; omit it and no level is computed. */
  onLevel?: (level: number) => void;
  /** Override the onset-segmentation tuning (defaults to DEFAULT_SEGMENTER_CONFIG
   *  with clarityFloor pinned to CLARITY_THRESHOLD). */
  segmenterConfig?: SegmenterConfig;
  /** Injectable rAF/cancel for tests; defaults to window.requestAnimationFrame. */
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
}

/**
 * Live pitch detector. Construct with an AudioContext + a source node, call
 * start() to begin analysing, stop() to halt. Emits raw per-frame events
 * (onSample) and committed note onsets (onNote, via the pure OnsetSegmenter).
 */
export class LivePitchDetector {
  private readonly ctx: AudioContext;
  private readonly source: AudioNode;
  private readonly analyser: AnalyserNode;
  private readonly detector: PitchyDetector<Float32Array>;
  // Explicit ArrayBuffer-backed buffer so getFloatTimeDomainData (which the lib
  // types as Float32Array<ArrayBuffer>) accepts it.
  private readonly buffer: Float32Array<ArrayBuffer>;
  private readonly segmenter: OnsetSegmenter;
  private readonly opts: PitchDetectorOptions;
  private readonly requestFrame: (cb: () => void) => number;
  private readonly cancelFrame: (id: number) => void;

  private rafId: number | null = null;
  private running = false;

  constructor(options: PitchDetectorOptions) {
    this.opts = options;
    this.ctx = options.context;
    this.source = options.source;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = ANALYSIS_WINDOW_SIZE; // time-domain window == window size
    this.buffer = new Float32Array(
      new ArrayBuffer(this.analyser.fftSize * Float32Array.BYTES_PER_ELEMENT),
    );

    this.detector = PitchyDetector.forFloat32Array(this.analyser.fftSize);
    this.detector.clarityThreshold = PITCHY_INTERNAL_CLARITY;
    this.detector.minVolumeDecibels = MIN_VOLUME_DECIBELS;

    const segCfg: SegmenterConfig = options.segmenterConfig ?? {
      ...DEFAULT_SEGMENTER_CONFIG,
      clarityFloor: CLARITY_THRESHOLD,
    };
    this.segmenter = new OnsetSegmenter(segCfg);

    this.requestFrame =
      options.requestFrame ??
      ((cb) => globalThis.requestAnimationFrame(cb));
    this.cancelFrame =
      options.cancelFrame ?? ((id) => globalThis.cancelAnimationFrame(id));
  }

  /** Whether analysis is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /** Begin analysing. Connects the source to the analyser (a passive tap — the
   *  analyser is NOT connected to the destination, so input is never echoed to
   *  the speakers). Resets the segmenter for a fresh attempt. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.segmenter.reset();
    this.source.connect(this.analyser);
    console.log(
      `[AUDIO] pitch detector start: window=${ANALYSIS_WINDOW_SIZE} ` +
        `sampleRate=${this.ctx.sampleRate} clarityFloor=${CLARITY_THRESHOLD} ` +
        `(AnalyserNode main-thread detector — see pitchDetector.ts header)`,
    );
    this.loop();
  }

  /** Stop analysing and disconnect the analyser tap. Idempotent. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.rafId !== null) {
      this.cancelFrame(this.rafId);
      this.rafId = null;
    }
    try {
      this.source.disconnect(this.analyser);
    } catch {
      // Already disconnected (e.g. graph torn down). Ignore in the prototype.
    }
    console.log('[AUDIO] pitch detector stop');
  }

  /** One analysis pass: copy the time-domain frame, run pitchy, emit events. */
  private analyseOnce(): void {
    // copy current time-domain samples into our buffer.
    this.analyser.getFloatTimeDomainData(this.buffer);
    // Read-only VU readout off the SAME buffer (before findPitch, so even if a
    // future change reused the buffer it'd be the analysed frame). Does not alter
    // detection: findPitch sees the identical, untouched buffer.
    if (this.opts.onLevel) this.opts.onLevel(rmsLevel(this.buffer));
    const [frequencyHz, clarity] = this.detector.findPitch(
      this.buffer,
      this.ctx.sampleRate,
    );
    const timeMs = this.opts.audioTimeToScheduleMs
      ? this.opts.audioTimeToScheduleMs(this.ctx.currentTime)
      : this.ctx.currentTime * 1000;
    const midi = frequencyToMidi(frequencyHz);

    this.opts.onSample?.({ frequencyHz, clarity, midi, timeMs });

    const sample: PitchSample = { timeMs, frequencyHz, clarity };
    const note = this.segmenter.push(sample);
    if (note !== null) {
      console.log(
        `[AUDIO] note onset: midi=${note.midi} onset=${note.onsetMs.toFixed(0)}ms ` +
          `clarity=${(note.clarity ?? 0).toFixed(2)}`,
      );
      this.opts.onNote?.(note);
    }
  }

  /** The rAF analysis loop. */
  private loop = (): void => {
    if (!this.running) return;
    this.analyseOnce();
    this.rafId = this.requestFrame(this.loop);
  };
}
