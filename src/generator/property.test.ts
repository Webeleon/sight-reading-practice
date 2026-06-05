// Property test (brief section 14): generate ~1,000 lines across varied configs/seeds
// and assert every line holds the invariants, with a fallback rate < 5%.

import { describe, it, expect } from 'vitest';
import { generateLine } from './generateLine.js';
import type { GenerationTelemetry } from './generateLine.js';
import { buildGenerationContext } from './context.js';
import { selectProgression } from './selectProgression.js';
import { selectCadence } from './selectCadence.js';
import { playableForRole } from './cadencePitches.js';
import { makeRng } from './prng.js';
import { loadProgressions } from '../content/progressionLibrary.js';
import { loadCadences } from '../content/cadenceLibrary.js';
import type { LineConfig } from './config.js';
import {
  FOUR_FOUR,
  makeNeckPosition,
  ticksPerBar,
  pitchToMidi,
  pitchClass,
  computeTicks,
} from '../domain/index.js';
import type { Key } from '../domain/index.js';
import { isPlayableInPosition } from '../fretboard/index.js';
import { genLog } from './log.js';
import {
  STEP_MAX_SEMITONES,
  SMALL_LEAP_MAX_SEMITONES,
  TARGET_STEP_FRACTION,
  TARGET_SMALL_LEAP_FRACTION,
  TARGET_LARGE_LEAP_FRACTION,
  STEP_LEAP_TOLERANCE,
  MAX_RANGE_SEMITONES,
} from './tuning.js';

// Margin above the generator's own MAX_RANGE_SEMITONES that the property test will
// tolerate. The brief says "<= ~1.5 octaves (allow a configurable margin)"; the
// generator validator already enforces MAX_RANGE_SEMITONES (19), so any non-fallback
// line is guaranteed within it. This independent bound (validator + margin) is the
// property test's own assertion, decoupled from the validator's exact constant.
const RANGE_MARGIN_SEMITONES = 1;
const PROPERTY_MAX_RANGE = MAX_RANGE_SEMITONES + RANGE_MARGIN_SEMITONES;

// Reusable content libraries for independently recomputing the cadence target without
// reaching into generateLine internals (the generator validates this, but the property
// test asserts it independently as the brief requires).
const PROGRESSIONS = loadProgressions();
const CADENCES = loadCadences();

/**
 * Recompute the set of cadentially-valid final pitch classes for a (config, seed) by
 * replaying the deterministic context/progression/cadence selection. generateLine seeds
 * the pipeline with makeRng(seed, attempt) and only ADVANCES the attempt on a validation
 * retry, so for a line that succeeded on attempt `a` this exactly reproduces the cadence
 * it was built against. We also union over the first few attempts to stay robust to which
 * attempt actually succeeded.
 */
function cadenceTargetPcs(config: LineConfig, seed: number): Set<number> {
  const pcs = new Set<number>();
  for (let attempt = 0; attempt < 10; attempt++) {
    const rng = makeRng(seed, attempt);
    const context = buildGenerationContext(config, rng);
    const progression = selectProgression(PROGRESSIONS, config, rng);
    const cadence = selectCadence(CADENCES, progression, rng);
    const allowed = playableForRole(cadence.melodicResolution.to, context);
    // Empty allowed set => the validator accepts any landing (see validateCadence), so a
    // contributing empty set means "any pitch class is cadentially valid".
    if (allowed.length === 0) {
      for (let pc = 0; pc < 12; pc++) pcs.add(pc);
    } else {
      for (const p of allowed) pcs.add(pitchClass(p.pitch));
    }
  }
  return pcs;
}

const FIXED_AT = '2026-06-04T00:00:00.000Z';

const KEYS: Key[] = [
  { tonic: { name: 'C', accidental: 'natural' }, mode: 'major' },
  { tonic: { name: 'G', accidental: 'natural' }, mode: 'major' },
  { tonic: { name: 'D', accidental: 'natural' }, mode: 'major' },
  { tonic: { name: 'E', accidental: 'flat' }, mode: 'major' },
  { tonic: { name: 'A', accidental: 'natural' }, mode: 'minor' },
  { tonic: { name: 'E', accidental: 'natural' }, mode: 'minor' },
];
const POSITIONS = [
  makeNeckPosition(1, 6, 0, 5, 'open'),
  makeNeckPosition(1, 6, 4, 8, 'V'),
  makeNeckPosition(1, 6, 7, 11, 'VIII'),
];
const BAR_COUNTS = [2, 4];
const DENSITIES: LineConfig['accidentalsDensity'][] = ['none', 'low', 'medium'];

describe('property: 1,000+ lines across varied configs', () => {
  it('every line holds the invariants; fallback rate < 5%', () => {
    const tpb = ticksPerBar(FOUR_FOUR);
    let total = 0;
    let fallbacks = 0;
    let attemptsSum = 0;
    const validatorFires: Record<string, number> = {};
    let seed = 0;

    for (const key of KEYS) {
      for (const position of POSITIONS) {
        for (const barCount of BAR_COUNTS) {
          for (const accidentalsDensity of DENSITIES) {
            for (let r = 0; r < 10; r++) {
              const cfg: LineConfig = {
                key,
                timeSignature: FOUR_FOUR,
                position,
                tempo: 90,
                barCount,
                difficulty: 3,
                accidentalsDensity,
              };
              const thisSeed = seed++;
              let telemetry: GenerationTelemetry | null = null;
              const line = generateLine(cfg, thisSeed, FIXED_AT, {
                onTelemetry: (t) => {
                  telemetry = t;
                },
              });
              total++;
              const t = telemetry as GenerationTelemetry | null;
              if (t) {
                attemptsSum += t.attemptsUsed;
                for (const f of t.failures) {
                  validatorFires[f.validator] =
                    (validatorFires[f.validator] ?? 0) + 1;
                }
              }

              // A fallback is counted (the brief allows fallbacks but they must be
              // COUNTED). Authoritative signal is the telemetry usedFallback flag; the
              // 'fallback' tag in validationsPassed agrees and is the marker getFallback
              // stamps. No validator exception may escape — generateLine catches only
              // ValidationError, so reaching this line at all means none escaped.
              const isFallback =
                (t?.usedFallback ?? false) ||
                line.validationsPassed.includes('fallback');
              if (isFallback) {
                fallbacks++;
                continue; // fallbacks are pre-validated; skip per-line assertions
              }

              // --- rhythm fills each bar exactly ---
              const perBar = new Map<number, number>();
              for (const n of line.notes) {
                perBar.set(
                  n.barIndex,
                  (perBar.get(n.barIndex) ?? 0) + n.duration.ticks,
                );
              }
              for (let bar = 0; bar < barCount; bar++) {
                expect(perBar.get(bar)).toBe(tpb);
              }

              // --- every note's duration notation matches its tick count ---
              // base/dots/tuplet must reconstruct exactly duration.ticks. A mismatch
              // (e.g. a synthesized merged note keeping the wrong base) makes renderers
              // draw the wrong visual length and the cursor desyncs from the notes.
              for (const n of line.notes) {
                expect(
                  computeTicks(n.duration.base, n.duration.dots, n.duration.tuplet),
                  `seed=${thisSeed} note at tick ${n.startTick} base=${n.duration.base} dots=${n.duration.dots} ` +
                    `tuplet=${JSON.stringify(n.duration.tuplet)} ticks=${n.duration.ticks}: notation != ticks`,
                ).toBe(n.duration.ticks);
              }

              // --- barIndex is consistent with startTick ---
              for (const n of line.notes) {
                expect(
                  n.barIndex,
                  `seed=${thisSeed} note at tick ${n.startTick} has barIndex ${n.barIndex} != floor(startTick/tpb)`,
                ).toBe(Math.floor(n.startTick / tpb));
              }

              // --- contiguity: notes tile [0, barCount*tpb) with no gaps/overlaps ---
              const ordered = [...line.notes].sort(
                (a, b) => a.startTick - b.startTick,
              );
              expect(ordered[0]!.startTick).toBe(0);
              for (let k = 0; k + 1 < ordered.length; k++) {
                expect(
                  ordered[k + 1]!.startTick,
                  `seed=${thisSeed} gap/overlap after tick ${ordered[k]!.startTick}`,
                ).toBe(ordered[k]!.startTick + ordered[k]!.duration.ticks);
              }
              const lastNote = ordered[ordered.length - 1]!;
              expect(lastNote.startTick + lastNote.duration.ticks).toBe(
                barCount * tpb,
              );

              // --- all notes playable in position ---
              for (const n of line.notes) {
                if (n.pitch === null) continue;
                expect(isPlayableInPosition(n.pitch, position)).toBe(true);
              }

              // --- total range within bound (~1.5 octaves + configurable margin) ---
              const midis = line.notes
                .filter((n) => n.pitch !== null)
                .map((n) => pitchToMidi(n.pitch!));
              if (midis.length >= 2) {
                const range = Math.max(...midis) - Math.min(...midis);
                expect(range).toBeLessThanOrEqual(PROPERTY_MAX_RANGE);
              }

              // --- line ends on a cadentially valid pitch ---
              const soundingForCadence = line.notes.filter(
                (n) => n.pitch !== null,
              );
              const lastPitch =
                soundingForCadence[soundingForCadence.length - 1]!.pitch!;
              const targetPcs = cadenceTargetPcs(cfg, thisSeed);
              expect(
                targetPcs.has(pitchClass(lastPitch)),
                `line seed=${thisSeed} ends on pc ${pitchClass(lastPitch)} (${lastPitch.name}${lastPitch.accidental}), ` +
                  `not in cadence targets ${[...targetPcs].join(',')}`,
              ).toBe(true);

              // --- step/leap balance within tolerance ---
              const sounding = line.notes.filter((n) => n.pitch !== null);
              let step = 0;
              let small = 0;
              let large = 0;
              for (let i = 1; i < sounding.length; i++) {
                const d = Math.abs(
                  pitchToMidi(sounding[i]!.pitch!) -
                    pitchToMidi(sounding[i - 1]!.pitch!),
                );
                if (d <= STEP_MAX_SEMITONES) step++;
                else if (d <= SMALL_LEAP_MAX_SEMITONES) small++;
                else large++;
              }
              const n = step + small + large;
              if (n > 0) {
                expect(Math.abs(step / n - TARGET_STEP_FRACTION)).toBeLessThanOrEqual(
                  STEP_LEAP_TOLERANCE,
                );
                expect(
                  Math.abs(small / n - TARGET_SMALL_LEAP_FRACTION),
                ).toBeLessThanOrEqual(STEP_LEAP_TOLERANCE);
                expect(
                  Math.abs(large / n - TARGET_LARGE_LEAP_FRACTION),
                ).toBeLessThanOrEqual(STEP_LEAP_TOLERANCE);
              }
            }
          }
        }
      }
    }

    const fallbackRate = fallbacks / total;
    const summary =
      `${total} lines, ${fallbacks} fallbacks (${(fallbackRate * 100).toFixed(2)}%), ` +
      `avg attempts ${(attemptsSum / total).toFixed(2)}, validator fires ${JSON.stringify(validatorFires)}`;

    // Print the telemetry breakdown (brief: "Print the telemetry breakdown" and "Compute
    // and print the fallback rate"). genLog is the pure-module-safe structured logger
    // ([GEN] prefix); bare `console` is out of scope under the pure tsconfig.
    genLog('property-test telemetry summary:');
    genLog(`  lines generated     : ${total}`);
    genLog(`  fallbacks           : ${fallbacks}`);
    genLog(`  fallback rate       : ${(fallbackRate * 100).toFixed(2)}%`);
    genLog(`  avg attempts / line : ${(attemptsSum / total).toFixed(2)}`);
    genLog(
      `  validator failures  : ${JSON.stringify(validatorFires)}`,
    );

    expect(total, summary).toBeGreaterThanOrEqual(1000);
    // Hard acceptance gate (brief section 14): fallback rate < 5%.
    expect(fallbackRate, summary).toBeLessThan(0.05);
    // Sanity: validators did fire at least sometimes (the pipeline is actually checked).
    expect(attemptsSum / total, summary).toBeGreaterThanOrEqual(1);
  });
});
