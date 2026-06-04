// Stage 5: planRhythm.
//
// Select rhythmic motif(s) and lay them out bar by bar according to the phrase
// structure (bars that share a role share a motif, so repeated phrases sound rhythmically
// alike), apply occasional subtle variations, and flatten everything to absolute-tick
// RhythmSlots. INVARIANT: each bar's slot durations sum to exactly ticksPerBar.
//
// Pure module: no electron/react/DOM, seeded-PRNG only, no `any`.

import type { Duration } from '../domain/index.js';
import type { PhraseStructure, RhythmicMotifPlan } from '../domain/index.js';
import type { RhythmicMotifEntry } from '../content/motifLibrary.js';
import type { LineConfig } from './config.js';
import type { Rng } from './prng.js';
import { pick } from './prng.js';
import { RHYTHM_VARIATION_PROBABILITY } from './tuning.js';
import type { RhythmSlot } from './types.js';

export interface RhythmPlan {
  slots: RhythmSlot[];
  motifPlan: RhythmicMotifPlan;
}

/** Motifs usable for a config: matching time signature and difficulty <= config. */
function candidateMotifs(
  motifs: ReadonlyArray<RhythmicMotifEntry>,
  config: LineConfig,
): RhythmicMotifEntry[] {
  const tsLabel = `${config.timeSignature.beats}/${config.timeSignature.beatUnit}`;
  const out = motifs.filter(
    (m) => m.timeSignature === tsLabel && m.difficulty <= config.difficulty,
  );
  if (out.length === 0) {
    throw new Error(
      `[GEN] no motif for timeSignature=${tsLabel} difficulty<=${config.difficulty}`,
    );
  }
  return out;
}

/** Apply a subtle variation to a bar's durations. Returns the (possibly) altered
 *  durations; the total ALWAYS still sums to one bar. */
function varyDurations(
  durations: ReadonlyArray<Duration>,
  kind: 'displacement' | 'augmentation' | 'omission',
): Duration[] {
  const ds = durations.map((d) => ({ ...d }));
  switch (kind) {
    case 'displacement': {
      // Rotate the durations by one so onsets shift; total tick sum is preserved.
      if (ds.length <= 1) return ds;
      const first = ds.shift()!;
      ds.push(first);
      return ds;
    }
    case 'augmentation': {
      // Merge the first two events into one of their combined length (a longer note
      // in place of two shorter ones). Preserves total bar length.
      if (ds.length < 2) return ds;
      const a = ds[0]!;
      const b = ds[1]!;
      const mergedTicks = a.ticks + b.ticks;
      // Keep it simple & JSON-safe: synthesize a duration record carrying the merged
      // tick count. base/dots are notational hints; ticks is authoritative downstream.
      const merged: Duration = { base: a.base, dots: a.dots, ticks: mergedTicks };
      return [merged, ...ds.slice(2)];
    }
    case 'omission': {
      // Turn the LAST event into a rest by merging it into the previous note's length,
      // i.e. drop an onset. Preserves total bar length. (We extend the previous note.)
      if (ds.length < 2) return ds;
      const last = ds[ds.length - 1]!;
      const prev = ds[ds.length - 2]!;
      const merged: Duration = {
        base: prev.base,
        dots: prev.dots,
        ticks: prev.ticks + last.ticks,
      };
      return [...ds.slice(0, ds.length - 2), merged];
    }
  }
}

/**
 * Plan the rhythm for the whole line. One motif is chosen per DISTINCT phrase role so
 * repeated bars share a rhythm; per-bar variations are applied with
 * RHYTHM_VARIATION_PROBABILITY (never to the first bar, to establish the motif).
 */
export function planRhythm(
  motifs: ReadonlyArray<RhythmicMotifEntry>,
  config: LineConfig,
  phraseStructure: PhraseStructure,
  ticksPerBar: number,
  strongBeatTicks: ReadonlyArray<number>,
  rng: Rng,
): RhythmPlan {
  const candidates = candidateMotifs(motifs, config);

  // Assign one motif id per distinct role (A/B/C...). Same role -> same motif.
  const motifByRole = new Map<string, RhythmicMotifEntry>();
  for (const role of phraseStructure.barRoles) {
    if (!motifByRole.has(role)) {
      motifByRole.set(role, pick(rng, candidates));
    }
  }

  const slots: RhythmSlot[] = [];
  const perBarMotifIds: string[] = [];
  const variations: RhythmicMotifPlan['variations'] = [];
  const strongSet = new Set(strongBeatTicks);

  for (let bar = 0; bar < phraseStructure.barRoles.length; bar++) {
    const role = phraseStructure.barRoles[bar]!;
    const motif = motifByRole.get(role)!;
    perBarMotifIds.push(motif.id);

    let durations: Duration[] = motif.durations.map((d) => ({ ...d }));

    // Maybe apply a subtle variation (not to bar 0).
    if (bar > 0 && rng() < RHYTHM_VARIATION_PROBABILITY) {
      const kinds: Array<'displacement' | 'augmentation' | 'omission'> = [
        'displacement',
        'augmentation',
        'omission',
      ];
      const kind = pick(rng, kinds);
      durations = varyDurations(durations, kind);
      variations.push({ barIndex: bar, kind });
    }

    // Flatten to absolute-tick slots.
    let offset = 0;
    const barStart = bar * ticksPerBar;
    for (const d of durations) {
      slots.push({
        startTick: barStart + offset,
        duration: d,
        barIndex: bar,
        beatPositionInBar: offset,
        isStrongBeat: strongSet.has(offset),
        isRest: false,
      });
      offset += d.ticks;
    }
    // INVARIANT guard: the motif (and every variation) must exactly fill the bar.
    if (offset !== ticksPerBar) {
      throw new Error(
        `[GEN] rhythm for bar ${bar} sums to ${offset}, expected ${ticksPerBar} (motif ${motif.id})`,
      );
    }
  }

  return { slots, motifPlan: { perBarMotifIds, variations } };
}
