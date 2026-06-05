// Barrel for the audio layer (Milestone 3 part: musical-time model + metronome).
// musicalTime is PURE TypeScript (no Web Audio / DOM); metronome is the Web Audio
// layer. Type-only symbols are re-exported with `export type` (verbatimModuleSyntax).

// --- musical time (pure) ---
export type { ScheduleEntry, MetronomeClick, Schedule } from './musicalTime.js';
export {
  DEFAULT_COUNT_IN_BARS,
  tickToMs,
  precomputeSchedule,
  currentNoteIndexAt,
  computeBeatClicks,
} from './musicalTime.js';

// --- metronome (Web Audio) ---
export type {
  MetronomeTick,
  AudioClock,
  MetronomeOptions,
} from './metronome.js';
export {
  Metronome,
  createMetronome,
  LOOKAHEAD_MS,
  SCHEDULER_INTERVAL_MS,
} from './metronome.js';

// --- pitch math (PURE; node-testable) ---
export {
  A4_HZ,
  A4_MIDI,
  GUITAR_MIDI_LOW,
  GUITAR_MIDI_HIGH,
  frequencyToMidiFloat,
  frequencyToMidi,
  midiToFrequency,
  centsOffNearestMidi,
  isInGuitarRange,
  isUsableDetection,
} from './pitchMath.js';

// --- onset segmentation (PURE; node-testable) ---
export type { PitchSample, SegmenterConfig } from './onsetSegmenter.js';
export {
  OnsetSegmenter,
  DEFAULT_SEGMENTER_CONFIG,
  segment,
} from './onsetSegmenter.js';

// --- live pitch detection (Web Audio) ---
export type { PitchEvent, PitchDetectorOptions } from './pitchDetector.js';
export {
  LivePitchDetector,
  ANALYSIS_WINDOW_SIZE,
  CLARITY_THRESHOLD,
  PITCHY_INTERNAL_CLARITY,
  MIN_VOLUME_DECIBELS,
  ANALYSIS_HOP_MS,
} from './pitchDetector.js';

// --- CREPE pitch detection math (PURE; node-testable; no tfjs) ---
export type { CrepeFramePitch } from './crepeMath.js';
export {
  CREPE_SAMPLE_RATE,
  CREPE_FRAME_SIZE,
  CREPE_PITCH_BINS,
  CREPE_CENTS_OFFSET,
  CREPE_CENTS_PER_BIN,
  CREPE_LOCAL_AVERAGE_RADIUS,
  binToCents,
  centsToHz,
  binToHz,
  normalizeFrame,
  resampleLinear,
  framePitchFromActivation,
} from './crepeMath.js';

// --- CREPE live pitch detection (Web Audio + tfjs; renderer-only) ---
export {
  CrepeDetector,
  loadCrepeModel,
  CREPE_MODEL_URL,
  CREPE_INFERENCE_INTERVAL_MS,
} from './crepeDetector.js';

// --- live input graph (Web Audio + getUserMedia) ---
export type {
  AudioInputDevice,
  AudioGraphOptions,
  DetectionFrame,
  DetectorKind,
} from './audioGraph.js';
export {
  AudioGraph,
  enumerateInputDevices,
  ensureMicPermission,
  RECORDING_MIME_TYPE,
  DEFAULT_DETECTOR_KIND,
} from './audioGraph.js';
