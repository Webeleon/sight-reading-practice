// Progression library loader + validator.
//
// Loads src/content/data/progressions.json (PLACEHOLDER starter content; see brief
// section 8) and validates it loudly. The progressions feed the generator's
// selectProgression stage: each entry's key-agnostic Roman numerals are later
// instantiated into concrete chords in the line's key via
// domain/romanNumeralToChord.
//
// Validation policy (brief section 8): fail loudly (throw) on any invalid content —
// "silent acceptance of bad content is the worst outcome." We validate: barIndex in
// range, Roman numerals parseable, quality enums valid, difficulty in 1..5, unique
// ids, applicableKeys well-formed, and that every bar of the progression is covered
// by at least one chord (so the generator never sees a harmonically empty bar).
//
// Pure module: no electron/react/DOM, only seeded PRNG (none needed here), no any-typing.

import type { TriadQuality, SeventhQuality } from '../domain/index.js';
import progressionsData from './data/progressions.json' with { type: 'json' };

export type ChordQuality = TriadQuality | SeventhQuality;

export interface ProgressionChord {
  /** Key-agnostic Roman numeral, e.g. 'ii', 'V7', 'I'. */
  romanNumeral: string;
  /** Explicit chord quality used to instantiate the chord in a concrete key. */
  quality: ChordQuality;
  /** 0-based bar this chord lands in; must be within [0, barCount). */
  barIndex: number;
  /** Tick offset within the bar; 0 = downbeat. */
  startTick: number;
}

export interface ProgressionEntry {
  id: string;
  name: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  barCount: number;
  chords: ProgressionChord[];
  tags: string[];
  applicableKeys: 'all' | string[];
}

// --- enum allow-lists --------------------------------------------------------

const VALID_QUALITIES: ReadonlySet<string> = new Set<ChordQuality>([
  'major',
  'minor',
  'diminished',
  'augmented',
  'major7',
  'minor7',
  'dominant7',
  'minorMajor7',
  'halfDiminished',
  'fullyDiminished',
  'augmentedMajor7',
  'augmented7',
]);

const VALID_DEGREES: ReadonlySet<string> = new Set([
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'vii',
]);

/**
 * A Roman numeral is "parseable" if it begins with a run of Roman-numeral letters
 * (i/v, either case) that names a known scale degree 1..7. Trailing quality markers
 * (7, o, +, ø, dim, etc.) are ignored here — the explicit `quality` field is
 * authoritative, mirroring domain/chord.ts parseRoman. Returns the degree letters
 * (lowercased) so the caller can report a precise error.
 */
function parseableRomanDegree(rn: string): string | null {
  const match = rn.match(/^[ivIV]+/);
  if (!match) {
    return null;
  }
  const letters = match[0].toLowerCase();
  return VALID_DEGREES.has(letters) ? letters : null;
}

// --- structural narrowing of the raw JSON ------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(message: string): never {
  throw new Error(`[CONTENT] invalid progressions content: ${message}`);
}

function asProgressionEntry(raw: unknown, index: number): ProgressionEntry {
  if (!isRecord(raw)) {
    fail(`entry #${index} is not an object`);
  }
  const where = isRecord(raw) && typeof raw.id === 'string' ? raw.id : `#${index}`;

  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    fail(`entry ${where} has a missing/empty id`);
  }
  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    fail(`progression "${raw.id}" has a missing/empty name`);
  }
  if (
    typeof raw.difficulty !== 'number' ||
    !Number.isInteger(raw.difficulty) ||
    raw.difficulty < 1 ||
    raw.difficulty > 5
  ) {
    fail(`progression "${raw.id}" has difficulty ${String(raw.difficulty)} (must be an integer 1..5)`);
  }
  if (
    typeof raw.barCount !== 'number' ||
    !Number.isInteger(raw.barCount) ||
    raw.barCount < 1
  ) {
    fail(`progression "${raw.id}" has barCount ${String(raw.barCount)} (must be a positive integer)`);
  }
  if (!Array.isArray(raw.chords) || raw.chords.length === 0) {
    fail(`progression "${raw.id}" has no chords`);
  }
  if (!Array.isArray(raw.tags)) {
    fail(`progression "${raw.id}" has a non-array tags field`);
  }
  for (const tag of raw.tags) {
    if (typeof tag !== 'string') {
      fail(`progression "${raw.id}" has a non-string tag`);
    }
  }
  if (
    raw.applicableKeys !== 'all' &&
    !(Array.isArray(raw.applicableKeys) && raw.applicableKeys.every((k) => typeof k === 'string'))
  ) {
    fail(`progression "${raw.id}" applicableKeys must be "all" or an array of strings`);
  }

  const difficulty = raw.difficulty as 1 | 2 | 3 | 4 | 5;
  const barCount = raw.barCount;
  const chords = raw.chords.map((c, ci) => asProgressionChord(c, raw.id as string, ci, barCount));

  return {
    id: raw.id,
    name: raw.name,
    difficulty,
    barCount,
    chords,
    tags: raw.tags as string[],
    applicableKeys: raw.applicableKeys === 'all' ? 'all' : (raw.applicableKeys as string[]),
  };
}

function asProgressionChord(
  raw: unknown,
  progId: string,
  chordIndex: number,
  barCount: number,
): ProgressionChord {
  if (!isRecord(raw)) {
    fail(`progression "${progId}" chord #${chordIndex} is not an object`);
  }
  if (typeof raw.romanNumeral !== 'string') {
    fail(`progression "${progId}" chord #${chordIndex} has a non-string romanNumeral`);
  }
  if (parseableRomanDegree(raw.romanNumeral) === null) {
    fail(`progression "${progId}" chord #${chordIndex} has unparseable romanNumeral "${raw.romanNumeral}"`);
  }
  if (typeof raw.quality !== 'string' || !VALID_QUALITIES.has(raw.quality)) {
    fail(`progression "${progId}" chord #${chordIndex} has invalid quality "${String(raw.quality)}"`);
  }
  if (
    typeof raw.barIndex !== 'number' ||
    !Number.isInteger(raw.barIndex) ||
    raw.barIndex < 0 ||
    raw.barIndex >= barCount
  ) {
    fail(
      `progression "${progId}" chord #${chordIndex} barIndex ${String(raw.barIndex)} out of range [0, ${barCount})`,
    );
  }
  if (
    typeof raw.startTick !== 'number' ||
    !Number.isInteger(raw.startTick) ||
    raw.startTick < 0
  ) {
    fail(`progression "${progId}" chord #${chordIndex} has invalid startTick ${String(raw.startTick)}`);
  }

  return {
    romanNumeral: raw.romanNumeral,
    quality: raw.quality as ChordQuality,
    barIndex: raw.barIndex,
    startTick: raw.startTick,
  };
}

/**
 * Validate an already-shaped array of ProgressionEntry. Throws on the first problem
 * found. Exposed (not just used internally) so tests can feed deliberately-broken
 * fixtures, and so callers that build progressions in memory can re-validate.
 *
 * Cross-entry and structural-but-already-typed checks live here: unique ids, every
 * bar covered by a chord. (Field-level shape/enum/range checks happen during
 * asProgressionEntry when loading from JSON; this function re-runs the equivalents
 * so an in-memory fixture is held to the same standard.)
 */
export function validateProgressions(entries: ProgressionEntry[]): ProgressionEntry[] {
  const seenIds = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    // Re-run field-level validation by round-tripping each entry through the same
    // narrowing path. This catches in-memory fixtures that bypass JSON loading.
    const e = asProgressionEntry(entries[i], i);

    if (seenIds.has(e.id)) {
      fail(`duplicate progression id "${e.id}"`);
    }
    seenIds.add(e.id);

    // Every bar must be covered by at least one chord so the generator never sees a
    // harmonically empty bar.
    const coveredBars = new Set(e.chords.map((c) => c.barIndex));
    for (let bar = 0; bar < e.barCount; bar++) {
      if (!coveredBars.has(bar)) {
        fail(`progression "${e.id}" has no chord in bar ${bar} (barCount ${e.barCount})`);
      }
    }
  }

  return entries;
}

interface RawProgressionsFile {
  progressions: unknown;
}

/**
 * Load and validate the starter progressions JSON. Throws loudly on any invalid
 * content. Returns the validated entries.
 *
 * @returns the validated ProgressionEntry list (length >= 12 for the starter set).
 */
export function loadProgressions(): ProgressionEntry[] {
  const file = progressionsData as unknown as RawProgressionsFile;
  if (!Array.isArray(file.progressions)) {
    fail('top-level "progressions" is missing or not an array');
  }
  const shaped = file.progressions.map((raw, i) => asProgressionEntry(raw, i));
  return validateProgressions(shaped);
}
