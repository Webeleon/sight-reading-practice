// Stage 5: planRhythm.
//
// Select rhythmic motif(s) and lay them out bar by bar according to the phrase
// structure (bars that share a role share a motif, so repeated phrases sound rhythmically
// alike), apply occasional subtle variations, and flatten everything to absolute-tick
// RhythmSlots. INVARIANT: each bar's slot durations sum to exactly ticksPerBar.
//
// Pure module: no electron/react/DOM, seeded-PRNG only, no `any`.

import type { Duration } from '../domain/index.js';
import { ticksToDuration } from '../domain/index.js';
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

/**
 * Merge two adjacent durations into a SINGLE notatable note of their combined length.
 * Returns null when the combined length is not a single note (e.g. eighth + half =
 * 1200 ticks is a tied pair, not one note) — the caller then skips the merge rather
 * than emit a note whose base/dots/tuplet disagree with its ticks. Both inputs share a
 * tuplet context within a motif run, so the merged note keeps that tuplet ratio; a
 * mismatch between the two tuplets is treated as un-mergeable.
 */
function mergeDurations(a: Duration, b: Duration): Duration | null {
  const aRatio = a.tuplet;
  const bRatio = b.tuplet;
  const sameTuplet =
    (aRatio === undefined && bRatio === undefined) ||
    (aRatio !== undefined &&
      bRatio !== undefined &&
      aRatio.numerator === bRatio.numerator &&
      aRatio.denominator === bRatio.denominator);
  if (!sameTuplet) return null;
  return ticksToDuration(a.ticks + b.ticks, aRatio);
}

/** Apply a subtle variation to a bar's durations. Returns the (possibly) altered
 *  durations; the total ALWAYS still sums to one bar, and EVERY returned duration's
 *  base/dots/tuplet matches its tick count (so renderers draw the right lengths).
 *  When a merge would not be a single notatable note, the variation is skipped and the
 *  original durations are returned unchanged. */
function varyDurations(
  durations: ReadonlyArray<Duration>,
  kind: 'displacement' | 'augmentation' | 'omission',
): Duration[] {
  const ds = durations.map((d) => ({ ...d }));
  switch (kind) {
    case 'displacement': {
      // Rotate the durations by one so onsets shift; total tick sum is preserved and
      // each duration is carried verbatim (already notatable).
      if (ds.length <= 1) return ds;
      const first = ds.shift()!;
      ds.push(first);
      return ds;
    }
    case 'augmentation': {
      // Merge the first two events into one note of their combined length (a longer
      // note in place of two shorter ones). Preserves total bar length.
      if (ds.length < 2) return ds;
      const merged = mergeDurations(ds[0]!, ds[1]!);
      if (merged === null) return ds; // not a single note: skip the variation
      return [merged, ...ds.slice(2)];
    }
    case 'omission': {
      // Drop the last onset by extending the previous note over it (one longer note).
      // Preserves total bar length.
      if (ds.length < 2) return ds;
      const merged = mergeDurations(ds[ds.length - 2]!, ds[ds.length - 1]!);
      if (merged === null) return ds; // not a single note: skip the variation
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
