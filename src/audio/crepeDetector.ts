// crepeDetector.ts — live monophonic pitch detection via CREPE (TensorFlow.js).
//
// A SELECTABLE alternative to LivePitchDetector (pitchy). The brief (section 4)
// anticipated this: "If accuracy is insufficient for clean single-note guitar
// input, escalate to CREPE via TensorFlow.js and flag this to the human." Live
// testing showed pitchy makes octave errors on guitar (detecting notes 1-2
// octaves down); CREPE is a CNN pitch tracker that is far more octave-robust.
//
// ============================================================================
// LAYER / CONSTRAINTS — READ THIS
// ============================================================================
//   * This file is renderer-only (tsconfig.ui): DOM / Web Audio / tfjs allowed.
//     tfjs MUST NOT leak into the pure layer — it lives ONLY here.
//   * It matches the LivePitchDetector interface EXACTLY: same constructor
//     options (PitchDetectorOptions), start()/stop(), and it emits the SAME
//     PitchEvent stream (onSample) + committed DetectedNote onsets (onNote) via
//     the SHARED OnsetSegmenter. The two detectors are drop-in interchangeable so
//     the detection-review view can A/B them.
//   * pitchy stays the DEFAULT + fallback. If the CREPE model fails to load, the
//     CALLER catches the rejected load() and falls back to pitchy with a clear
//     [CREPE] warning — this class throws a descriptive error rather than
//     silently degrading. The model is bundled LOCALLY (src/ui/public/models/
//     crepe/) so it loads same-origin under the app CSP, not from a CDN.
//   * Audio latency is OUT OF SCOPE (brief section 2), so CREPE being heavier
//     per-frame (a CNN forward pass on the main thread per rAF) is fine for the
//     prototype. We still throttle inference to roughly the analysis hop.
//
// CREPE specifics (the model is the ml5.js pitch-detection model, a standard tfjs
// LayersModel: 1024-sample input -> 360-bin sigmoid activation over pitch):
//   * resample the input to 16000 Hz mono,
//   * frame into 1024-sample windows,
//   * per-frame normalize (subtract mean, divide by std),
//   * model input shape [n,1024]; output [n,360],
//   * bin -> cents -> Hz + a local weighted average around the argmax,
//   * confidence/clarity = peak activation in [0,1]; gate low-confidence frames
//     exactly like pitchy does (CLARITY_THRESHOLD, in-guitar-range).
// The framing + post-processing math lives in the pure-ish crepeMath.ts so it is
// node-unit-testable without a DOM; this class is the Web-Audio plumbing around it.

import * as tf from '@tensorflow/tfjs';
import { frequencyToMidi, rmsLevel } from './pitchMath.js';
import {
  OnsetSegmenter,
  DEFAULT_SEGMENTER_CONFIG,
  type PitchSample,
  type SegmenterConfig,
} from './onsetSegmenter.js';
import {
  CREPE_SAMPLE_RATE,
  CREPE_FRAME_SIZE,
  normalizeFrame,
  resampleLinear,
  framePitchFromActivation,
} from './crepeMath.js';
import type { PitchDetectorOptions, PitchEvent } from './pitchDetector.js';
import { CLARITY_THRESHOLD } from './pitchDetector.js';
import type { DetectedNote } from '../evaluation/index.js';

/**
 * Where the bundled CREPE model lives, served same-origin by the renderer. In
 * dev electron-vite serves src/ui/public/* at the web root; in a prod build the
 * public/ tree is copied to the renderer output root. Either way the model.json
 * resolves to /models/crepe/model.json relative to the page — inside the app CSP
 * (default-src 'self'), NOT a remote CDN.
 */
export const CREPE_MODEL_URL = 'models/crepe/model.json';

/**
 * Minimum ms between CREPE inferences. pitchy runs every rAF (~16ms); a CREPE
 * forward pass is much heavier, and (latency being out of scope) we don't need a
 * detection every frame to segment a single monophonic line. ~32ms (~31 fps of
 * pitch) is plenty to catch onsets while keeping the main thread responsive. The
 * segmenter's frame-count thresholds (stabilityFrames=2) still trigger quickly.
 */
export const CREPE_INFERENCE_INTERVAL_MS = 32;

/**
 * Module-level model cache + warmup. The LayersModel is loaded ONCE and shared
 * across detector instances (constructing a new detector per attempt must NOT
 * re-download / re-compile the graph). loadCrepeModel() is idempotent and returns
 * the same in-flight / resolved promise.
 */
let modelPromise: Promise<tf.LayersModel> | null = null;

/**
 * Load (and cache) the bundled CREPE LayersModel, then warm it up with one dummy
 * forward pass so the first real frame isn't penalised by lazy graph compilation.
 * Rejects (with a descriptive [CREPE] error) if the model can't be fetched/parsed
 * — the CALLER is expected to catch this and fall back to pitchy.
 *
 * @param url  override the model URL (tests/Node point this at a file:// path).
 */
export function loadCrepeModel(url: string = CREPE_MODEL_URL): Promise<tf.LayersModel> {
  if (modelPromise) return modelPromise;
  modelPromise = (async (): Promise<tf.LayersModel> => {
    const t0 = Date.now();
    let model: tf.LayersModel;
    try {
      model = await tf.loadLayersModel(url);
    } catch (err) {
      // Reset so a later retry can attempt the load again.
      modelPromise = null;
      throw new Error(
        `[CREPE] failed to load model from ${url} — caller should fall back to ` +
          `pitchy. Underlying error: ${String(err)}`,
      );
    }
    // Warm up: one [1,1024] forward pass compiles kernels so the first live frame
    // doesn't stall. tf.tidy frees the intermediates.
    tf.tidy(() => {
      const dummy = tf.zeros([1, CREPE_FRAME_SIZE]);
      const out = model.predict(dummy) as tf.Tensor;
      out.dataSync(); // force execution
    });
    console.log(
      `[CREPE] model loaded + warmed up from ${url} in ${Date.now() - t0}ms ` +
        `(backend=${tf.getBackend()})`,
    );
    return model;
  })();
  return modelPromise;
}

/** Reset the module-level model cache. For tests only. */
export function _resetCrepeModelCache(): void {
  modelPromise = null;
}

/**
 * Live CREPE pitch detector. Drop-in replacement for LivePitchDetector: same
 * constructor options, start()/stop(), and emitted event contract. The model
 * must be loaded BEFORE start() (the AudioGraph/caller awaits loadCrepeModel()
 * and passes the resolved model in via options.model, or this class lazy-loads it
 * on first start()). Construction itself never blocks on the network.
 */
export class CrepeDetector {
  private readonly ctx: AudioContext;
  private readonly source: AudioNode;
  private readonly analyser: AnalyserNode;
  // Capture buffer sized to one CREPE frame WORTH of input samples at the device
  // sample rate, so that after resampling to 16kHz we have ~1024 samples.
  private readonly buffer: Float32Array<ArrayBuffer>;
  private readonly captureSize: number;
  private readonly segmenter: OnsetSegmenter;
  private readonly opts: PitchDetectorOptions;
  private readonly requestFrame: (cb: () => void) => number;
  private readonly cancelFrame: (id: number) => void;

  private model: tf.LayersModel | null;
  private rafId: number | null = null;
  private running = false;
  private lastInferenceMs = -Infinity;

  constructor(options: PitchDetectorOptions & { model?: tf.LayersModel }) {
    this.opts = options;
    this.ctx = options.context;
    this.source = options.source;
    this.model = options.model ?? null;

    // To get ~1024 samples at 16kHz we need ceil(1024 * deviceRate/16000) input
    // samples per frame. fftSize must be a power of two in [32, 32768]; we pick
    // the smallest power of two >= that requirement so one getFloatTimeDomainData
    // copy covers a full CREPE window after resampling. At 48kHz that is
    // 1024*48000/16000 = 3072 -> 4096; at 44.1kHz -> 4096 too.
    const needed = Math.ceil((CREPE_FRAME_SIZE * this.ctx.sampleRate) / CREPE_SAMPLE_RATE);
    let fft = 32;
    while (fft < needed && fft < 32768) fft *= 2;
    this.captureSize = fft;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = fft;
    this.buffer = new Float32Array(
      new ArrayBuffer(fft * Float32Array.BYTES_PER_ELEMENT),
    );

    const segCfg: SegmenterConfig = options.segmenterConfig ?? {
      ...DEFAULT_SEGMENTER_CONFIG,
      clarityFloor: CLARITY_THRESHOLD,
    };
    this.segmenter = new OnsetSegmenter(segCfg);

    this.requestFrame =
      options.requestFrame ?? ((cb) => globalThis.requestAnimationFrame(cb));
    this.cancelFrame =
      options.cancelFrame ?? ((id) => globalThis.cancelAnimationFrame(id));
  }

  /** Whether analysis is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Begin analysing. Ensures the model is loaded (lazy-loads if the caller didn't
   * pass one), connects the source tap, resets the segmenter, then starts the rAF
   * loop. If the model load REJECTS, start() rejects too so the caller can fall
   * back to pitchy. Returns a promise (LivePitchDetector.start() is sync; the
   * AudioGraph awaits this one — see the wiring task).
   */
  async start(): Promise<void> {
    if (this.running) return;
    if (!this.model) {
      this.model = await loadCrepeModel();
    }
    this.running = true;
    this.lastInferenceMs = -Infinity;
    this.segmenter.reset();
    this.source.connect(this.analyser);
    console.log(
      `[CREPE] detector start: captureWindow=${this.captureSize} ` +
        `deviceRate=${this.ctx.sampleRate} -> 16000Hz frame=${CREPE_FRAME_SIZE} ` +
        `clarityFloor=${CLARITY_THRESHOLD} inferenceEvery=${CREPE_INFERENCE_INTERVAL_MS}ms ` +
        `(tfjs main-thread CNN — latency out of scope per brief)`,
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
      // Already disconnected (graph torn down). Ignore in the prototype.
    }
    console.log('[CREPE] detector stop');
  }

  /** One analysis pass: copy the time-domain frame, run CREPE, emit events. */
  private analyseOnce(): void {
    const model = this.model;
    if (!model) return;

    this.analyser.getFloatTimeDomainData(this.buffer);

    // Read-only VU readout off the SAME raw (pre-resample, pre-normalize) buffer.
    // Does not alter detection: resampleLinear reads the untouched buffer below.
    if (this.opts.onLevel) this.opts.onLevel(rmsLevel(this.buffer));

    // Resample the device-rate window down to a 1024-sample 16kHz CREPE frame,
    // then per-frame normalize (subtract mean / divide by std).
    const resampled = resampleLinear(
      this.buffer,
      this.ctx.sampleRate,
      CREPE_SAMPLE_RATE,
      CREPE_FRAME_SIZE,
    );
    const normalized = normalizeFrame(resampled);

    // Forward pass: [1,1024] -> [1,360]. dataSync on the main thread (latency out
    // of scope). tf.tidy frees the input + output tensors.
    const activation = tf.tidy(() => {
      const input = tf.tensor2d(normalized, [1, CREPE_FRAME_SIZE]);
      const out = model.predict(input) as tf.Tensor;
      return out.dataSync() as Float32Array;
    });

    const { frequencyHz, confidence } = framePitchFromActivation(activation);

    const timeMs = this.opts.audioTimeToScheduleMs
      ? this.opts.audioTimeToScheduleMs(this.ctx.currentTime)
      : this.ctx.currentTime * 1000;
    // Below the clarity floor -> report as no-pitch (freq 0), exactly like pitchy
    // returns 0 Hz when it finds nothing, so the segmenter treats it as silence.
    const gatedFreq = confidence >= CLARITY_THRESHOLD ? frequencyHz : 0;
    const midi = frequencyToMidi(gatedFreq);

    const event: PitchEvent = {
      frequencyHz: gatedFreq,
      clarity: confidence,
      midi,
      timeMs,
    };
    this.opts.onSample?.(event);

    const sample: PitchSample = {
      timeMs,
      frequencyHz: gatedFreq,
      clarity: confidence,
    };
    const note = this.segmenter.push(sample);
    if (note !== null) {
      console.log(
        `[CREPE] note onset: midi=${note.midi} onset=${note.onsetMs.toFixed(0)}ms ` +
          `clarity=${(note.clarity ?? 0).toFixed(2)}`,
      );
      this.opts.onNote?.(note);
    }
  }

  /** The rAF analysis loop, throttled to CREPE_INFERENCE_INTERVAL_MS. */
  private loop = (): void => {
    if (!this.running) return;
    const nowMs = this.ctx.currentTime * 1000;
    if (nowMs - this.lastInferenceMs >= CREPE_INFERENCE_INTERVAL_MS) {
      this.lastInferenceMs = nowMs;
      this.analyseOnce();
    }
    this.rafId = this.requestFrame(this.loop);
  };
}
