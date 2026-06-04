// Top-level orchestrator: generateLine.
//
// Runs the full pipeline (stages 1-10). The PRNG is seeded ONCE per attempt from
// (seed, attempt); on a ValidationError the whole pipeline reruns with the attempt
// counter advanced, so each retry differs while a given (config, seed, generatedAt) is
// always byte-identical. After MAX_OUTER_ATTEMPTS, a fallback line is returned.
//
// DETERMINISM IS MANDATORY: generatedAt is an INJECTED parameter; this file must never
// read the system clock (the clock-reading and current-timestamp APIs are grep-banned in
// this module). The line id is derived from (seed + config), not from a clock or
// crypto-random source.
//
// Pure module: no electron/react/DOM, seeded-PRNG only, no `any`.

import type { Line } from '../domain/index.js';
import type { ProgressionEntry } from '../content/progressionLibrary.js';
import type { RhythmicMotifEntry } from '../content/motifLibrary.js';
import type { CadencePatternEntry } from '../content/cadenceLibrary.js';
import { loadProgressions } from '../content/progressionLibrary.js';
import { loadMotifs } from '../content/motifLibrary.js';
import { loadCadences } from '../content/cadenceLibrary.js';

import type { LineConfig } from './config.js';
import { ValidationError, DEFAULT_BAR_COUNT } from './config.js';
import { MAX_OUTER_ATTEMPTS } from './tuning.js';
import { makeRng } from './prng.js';
import { buildGenerationContext } from './context.js';
import { selectProgression } from './selectProgression.js';
import { selectCadence } from './selectCadence.js';
import { selectPhraseStructure } from './selectPhraseStructure.js';
import { planRhythm } from './planRhythm.js';
import { selectContour } from './selectContour.js';
import { placeStrongBeatPitches } from './placeStrongBeats.js';
import { fillWeakBeatPitches } from './fillWeakBeats.js';
import { annotateNotes } from './annotateNotes.js';
import {
  validatePosition,
  validateCadence,
  validateMusicality,
} from './validators.js';
import { getFallbackLine } from './fallback.js';
import { genWarn } from './log.js';

/** Generator version stamp written onto every Line (and persisted). Bump on changes
 *  that alter output, so old persisted lines stay attributable. */
export const GENERATOR_VERSION = 'gen-0.1.0';

/** Per-line generation telemetry, surfaced via the CLI for tuning (brief section 9). */
export interface GenerationTelemetry {
  attemptsUsed: number; // 1..MAX_OUTER_ATTEMPTS (+1 if it fell back)
  usedFallback: boolean;
  failures: Array<{ attempt: number; validator: string; message: string }>;
}

/** Loaded content libraries. Bundled by default; injectable for tests/fallback authoring. */
export interface ContentLibraries {
  progressions: ReadonlyArray<ProgressionEntry>;
  motifs: ReadonlyArray<RhythmicMotifEntry>;
  cadences: ReadonlyArray<CadencePatternEntry>;
}

let cachedContent: ContentLibraries | null = null;
function defaultContent(): ContentLibraries {
  if (cachedContent === null) {
    cachedContent = {
      progressions: loadProgressions(),
      motifs: loadMotifs(),
      cadences: loadCadences(),
    };
  }
  return cachedContent;
}

/** Options for advanced callers (fallback authoring disables the fallback path so a
 *  failure surfaces rather than silently substituting a not-yet-authored line). */
export interface GenerateOptions {
  content?: ContentLibraries;
  /** When false, a run that exhausts retries THROWS instead of returning a fallback.
   *  Used only to author the fallback JSON itself. Default true. */
  allowFallback?: boolean;
  /** Optional sink for the telemetry of the most recent call. */
  onTelemetry?: (t: GenerationTelemetry) => void;
}

/** Deterministic line id from (seed + config) — NOT a clock/random UUID, so the same
 *  inputs always produce the same id. Format mimics a UUID for the schema's TEXT id. */
function deriveId(config: LineConfig, seed: number): string {
  const basis = `${seed}|${JSON.stringify(config)}`;
  // FNV-1a 32-bit over the basis, expanded to a uuid-shaped hex string.
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Derive 4 32-bit words by re-hashing with salts (deterministic).
  const word = (salt: number): string => {
    let x = h ^ Math.imul(salt + 1, 0x9e3779b1);
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
    x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
    x ^= x >>> 15;
    return (x >>> 0).toString(16).padStart(8, '0');
  };
  const a = word(1);
  const b = word(2);
  const c = word(3);
  const d = word(4);
  return `${a}-${b.slice(0, 4)}-${b.slice(4)}-${c.slice(0, 4)}-${c.slice(4)}${d}`;
}

/** One pipeline pass. Throws ValidationError on a recoverable failure. */
function runPipeline(
  config: LineConfig,
  seed: number,
  generatedAt: string,
  attempt: number,
  content: ContentLibraries,
): Line {
  const rng = makeRng(seed, attempt);

  const context = buildGenerationContext(config, rng);
  const progression = selectProgression(content.progressions, config, rng);
  const cadence = selectCadence(content.cadences, progression, rng);
  const phraseStructure = selectPhraseStructure(config.barCount, progression, rng);
  const rhythm = planRhythm(
    content.motifs,
    config,
    phraseStructure,
    context.ticksPerBar,
    context.strongBeatTicks,
    rng,
  );
  const contour = selectContour(config.barCount, progression, context, rng);
  const strongPitches = placeStrongBeatPitches(
    progression,
    rhythm.slots,
    contour,
    cadence,
    context,
    context.ticksPerBar,
    rng,
  );
  const pitched = fillWeakBeatPitches(
    progression,
    rhythm.slots,
    strongPitches,
    context,
    rng,
  );
  const notes = annotateNotes(progression, pitched);

  validatePosition(notes, config.position);
  validateCadence(notes, cadence, context);
  validateMusicality(notes, contour);

  return {
    id: deriveId(config, seed),
    seed,
    generatedAt,
    key: config.key,
    timeSignature: config.timeSignature,
    position: config.position,
    tempo: config.tempo,
    barCount: config.barCount,
    progression,
    phraseStructure,
    contourTarget: contour,
    rhythmicMotifPlan: rhythm.motifPlan,
    notes,
    generatorVersion: GENERATOR_VERSION,
    validationsPassed: ['validatePosition', 'validateCadence', 'validateMusicality'],
  };
}

/**
 * Generate a melodic line. Deterministic in (config, seed, generatedAt): calling twice
 * with the same arguments yields byte-identical JSON.stringify output.
 *
 * @param config      what to generate (key, time sig, position, tempo, bars, difficulty, accidentals)
 * @param seed        numeric PRNG seed (the only randomness source)
 * @param generatedAt INJECTED ISO timestamp — never read from the system clock here
 * @param options     content injection / fallback toggle / telemetry sink
 */
export function generateLine(
  config: LineConfig,
  seed: number,
  generatedAt: string,
  options: GenerateOptions = {},
): Line {
  const content = options.content ?? defaultContent();
  const allowFallback = options.allowFallback ?? true;

  // Normalize bar count default (keep config otherwise untouched for id determinism).
  const cfg: LineConfig =
    config.barCount && config.barCount > 0
      ? config
      : { ...config, barCount: DEFAULT_BAR_COUNT };

  const failures: GenerationTelemetry['failures'] = [];

  for (let attempt = 0; attempt < MAX_OUTER_ATTEMPTS; attempt++) {
    try {
      const line = runPipeline(cfg, seed, generatedAt, attempt, content);
      options.onTelemetry?.({
        attemptsUsed: attempt + 1,
        usedFallback: false,
        failures,
      });
      return line;
    } catch (err) {
      if (err instanceof ValidationError) {
        failures.push({
          attempt,
          validator: err.validator,
          message: err.message,
        });
        continue; // retry with the RNG advanced
      }
      throw err; // non-recoverable: let it crash (brief section 16)
    }
  }

  genWarn(
    `all ${MAX_OUTER_ATTEMPTS} attempts failed for seed ${seed} (barCount ${cfg.barCount}); using fallback. ` +
      `Validators fired: ${failures.map((f) => f.validator).join(', ')}`,
  );

  if (!allowFallback) {
    throw new Error(
      `[GEN] generation failed after ${MAX_OUTER_ATTEMPTS} attempts and fallback is disabled (seed ${seed})`,
    );
  }

  const fallback = getFallbackLine(cfg.barCount, seed, generatedAt);
  options.onTelemetry?.({
    attemptsUsed: MAX_OUTER_ATTEMPTS + 1,
    usedFallback: true,
    failures,
  });
  return fallback;
}
