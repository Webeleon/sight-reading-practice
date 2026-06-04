// Stage 2: selectProgression.
//
// Filter the progression library by bar count, difficulty compatibility, and key
// applicability; sample one uniformly (stateless, via the threaded PRNG); then
// instantiate its key-agnostic Roman numerals into concrete chords in the line's key
// with correct enharmonic spelling (delegated to domain/romanNumeralToChord).
//
// Pure module: no electron/react/DOM, seeded-PRNG only, no `any`.

import type { Key } from '../domain/index.js';
import { romanNumeralToChord } from '../domain/index.js';
import type { ConcreteProgression } from '../domain/index.js';
import type { ProgressionEntry } from '../content/progressionLibrary.js';
import type { LineConfig } from './config.js';
import type { Rng } from './prng.js';
import { pick } from './prng.js';

/** True if a progression's applicableKeys permits this key. The starter content uses
 *  "all"; the array form (e.g. ["C major"]) is matched loosely by tonic+mode string. */
function keyApplies(entry: ProgressionEntry, key: Key): boolean {
  if (entry.applicableKeys === 'all') return true;
  const tag = `${key.tonic.name}${key.tonic.accidental === 'natural' ? '' : key.tonic.accidental} ${key.mode}`;
  return entry.applicableKeys.includes(tag);
}

/** Candidate progressions for a config: matching bar count, difficulty <= config
 *  difficulty (don't hand a beginner a hard progression), and key-applicable. */
export function candidateProgressions(
  progressions: ReadonlyArray<ProgressionEntry>,
  config: LineConfig,
): ProgressionEntry[] {
  return progressions.filter(
    (p) =>
      p.barCount === config.barCount &&
      p.difficulty <= config.difficulty &&
      keyApplies(p, config.key),
  );
}

/** Tile a base progression to cover `barCount` bars by repeating it. Used when no
 *  progression matches the requested bar count exactly (e.g. odd or long bar counts):
 *  the starter library only authors 2- and 4-bar progressions, so a 6-bar line repeats
 *  a 2- or 4-bar one. Returns the tiled chord list (bar-shifted copies). */
function tileEntry(
  entry: ProgressionEntry,
  barCount: number,
): ProgressionEntry['chords'] {
  const out: ProgressionEntry['chords'] = [];
  for (let base = 0; base < barCount; base += entry.barCount) {
    for (const c of entry.chords) {
      const barIndex = base + c.barIndex;
      if (barIndex < barCount) {
        out.push({ ...c, barIndex });
      }
    }
  }
  return out;
}

/** Progressions usable as a TILING base for a bar count: difficulty/key compatible and
 *  no longer than the target. Cleanly-dividing bases are preferred by the caller; this
 *  returns all usable bases so odd bar counts (e.g. 3, 5) can tile-and-truncate. */
function tilingBases(
  progressions: ReadonlyArray<ProgressionEntry>,
  config: LineConfig,
): ProgressionEntry[] {
  const usable = progressions.filter(
    (p) =>
      p.difficulty <= config.difficulty &&
      keyApplies(p, config.key) &&
      p.barCount <= config.barCount,
  );
  // Prefer bases that divide the target evenly (cleaner harmonic repetition).
  const even = usable.filter((p) => config.barCount % p.barCount === 0);
  return even.length > 0 ? even : usable;
}

/**
 * Select a progression and instantiate it into concrete chords in the config's key.
 * Prefers an exact bar-count match; otherwise tiles a shorter compatible progression to
 * fill the requested bar count (so any 2..16 bar count works with the starter content).
 * Throws only if nothing at all is compatible (a content/difficulty mismatch worth
 * surfacing loudly).
 */
export function selectProgression(
  progressions: ReadonlyArray<ProgressionEntry>,
  config: LineConfig,
  rng: Rng,
): ConcreteProgression {
  const exact = candidateProgressions(progressions, config);

  let chosen: ProgressionEntry;
  let chords: ProgressionEntry['chords'];
  if (exact.length > 0) {
    chosen = pick(rng, exact);
    chords = chosen.chords;
  } else {
    const bases = tilingBases(progressions, config);
    if (bases.length === 0) {
      throw new Error(
        `[GEN] no progression for barCount=${config.barCount} difficulty<=${config.difficulty}`,
      );
    }
    chosen = pick(rng, bases);
    chords = tileEntry(chosen, config.barCount);
  }

  return {
    progressionId: chosen.id,
    chords: chords.map((c) => ({
      romanNumeral: c.romanNumeral,
      chord: romanNumeralToChord(c.romanNumeral, c.quality, config.key),
      barIndex: c.barIndex,
      startTick: c.startTick,
    })),
  };
}

/**
 * The concrete chord sounding at a given (barIndex, tick). Walks the progression's
 * chords (which are sorted within a bar by startTick) and returns the last one whose
 * onset is <= the query position in that bar; falls back to the most recent chord in a
 * prior bar so every position has a harmony.
 */
export function chordAt(
  progression: ConcreteProgression,
  barIndex: number,
  tick: number,
): ConcreteProgression['chords'][number] {
  let current: ConcreteProgression['chords'][number] | undefined;
  for (const c of progression.chords) {
    if (c.barIndex < barIndex) {
      current = c;
    } else if (c.barIndex === barIndex && c.startTick <= tick) {
      current = c;
    }
  }
  if (current === undefined) {
    // No chord at or before this position; use the very first chord.
    current = progression.chords[0]!;
  }
  return current;
}
