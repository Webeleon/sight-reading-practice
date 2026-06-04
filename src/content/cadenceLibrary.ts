// Cadence library: loads & validates src/content/data/cadences.json.
//
// A cadence pattern constrains the final (and optionally penultimate) note of a
// generated line: a harmonic movement (Roman numeral -> Roman numeral) paired
// with a melodic resolution (scale-degree role -> scale-degree role, with a
// motion kind). The generator selects one early (it constrains the ending) and
// places the cadence-constrained pitch first.
//
// This is a PURE module: no electron/react, no DOM globals, and (since it is in
// the seeded-randomness-only set) no use of the global random generator.
// Validation fails loudly (throws) — silent acceptance of bad content is the
// worst outcome (brief section 8).

import cadencesDoc from './data/cadences.json' with { type: 'json' };

// --- Schema enums (brief section 8) -----------------------------------------

// Scale-degree roles a melodic resolution may start from.
export type CadenceMelodicFrom =
  | 'tonic'
  | 'supertonic'
  | 'leadingTone'
  | 'mediant'
  | 'submediant'
  | 'dominant'
  | 'subdominant';

// Scale-degree roles a melodic resolution may land on.
export type CadenceMelodicTo = 'tonic' | 'mediant' | 'dominant';

// Melodic motion of the resolving interval.
export type CadenceMotion = 'stepUp' | 'stepDown' | 'leap';

export type CadenceDifficulty = 1 | 2 | 3 | 4 | 5;

export interface CadencePatternEntry {
  id: string;
  name: string;
  // Roman numerals, key-agnostic, e.g. { from: 'V', to: 'I' }.
  harmonicMovement: { from: string; to: string };
  melodicResolution: {
    from: CadenceMelodicFrom;
    to: CadenceMelodicTo;
    motion: CadenceMotion;
  };
  // When true, the generator must also constrain the penultimate note.
  constrainsPenultimate: boolean;
  difficulty: CadenceDifficulty;
}

const MELODIC_FROM: ReadonlySet<string> = new Set<CadenceMelodicFrom>([
  'tonic',
  'supertonic',
  'leadingTone',
  'mediant',
  'submediant',
  'dominant',
  'subdominant',
]);

const MELODIC_TO: ReadonlySet<string> = new Set<CadenceMelodicTo>([
  'tonic',
  'mediant',
  'dominant',
]);

const MOTIONS: ReadonlySet<string> = new Set<CadenceMotion>([
  'stepUp',
  'stepDown',
  'leap',
]);

// Accepts a Roman numeral made of the numeral letters i/v/x in either case,
// with optional trailing quality markers (7, o, +, ø, etc.). Mirrors the
// permissive front-of-string parsing in domain/chord.ts so harmonic movement
// numerals validated here are guaranteed parseable downstream.
const ROMAN_NUMERAL_RE = /^[ivxIVX]+/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assertRomanNumeral(rn: unknown, where: string): string {
  if (typeof rn !== 'string' || !ROMAN_NUMERAL_RE.test(rn)) {
    throw new Error(
      `[CONTENT] cadences: ${where} is not a parseable Roman numeral: ${JSON.stringify(rn)}`,
    );
  }
  return rn;
}

function assertEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  where: string,
): T {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(
      `[CONTENT] cadences: ${where} is not a valid enum value: ${JSON.stringify(value)} (allowed: ${[...allowed].join(', ')})`,
    );
  }
  return value as T;
}

function validateEntry(raw: unknown, index: number): CadencePatternEntry {
  const at = `entry[${index}]`;
  if (!isObject(raw)) {
    throw new Error(`[CONTENT] cadences: ${at} is not an object`);
  }

  const { id, name, harmonicMovement, melodicResolution, constrainsPenultimate, difficulty } = raw;

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`[CONTENT] cadences: ${at}.id must be a non-empty string`);
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`[CONTENT] cadences: ${at} (${id}).name must be a non-empty string`);
  }

  if (!isObject(harmonicMovement)) {
    throw new Error(`[CONTENT] cadences: ${at} (${id}).harmonicMovement must be an object`);
  }
  const from = assertRomanNumeral(harmonicMovement.from, `${at} (${id}).harmonicMovement.from`);
  const to = assertRomanNumeral(harmonicMovement.to, `${at} (${id}).harmonicMovement.to`);

  if (!isObject(melodicResolution)) {
    throw new Error(`[CONTENT] cadences: ${at} (${id}).melodicResolution must be an object`);
  }
  const melFrom = assertEnum<CadenceMelodicFrom>(
    melodicResolution.from,
    MELODIC_FROM,
    `${at} (${id}).melodicResolution.from`,
  );
  const melTo = assertEnum<CadenceMelodicTo>(
    melodicResolution.to,
    MELODIC_TO,
    `${at} (${id}).melodicResolution.to`,
  );
  const motion = assertEnum<CadenceMotion>(
    melodicResolution.motion,
    MOTIONS,
    `${at} (${id}).melodicResolution.motion`,
  );

  if (typeof constrainsPenultimate !== 'boolean') {
    throw new Error(`[CONTENT] cadences: ${at} (${id}).constrainsPenultimate must be a boolean`);
  }

  if (
    typeof difficulty !== 'number' ||
    !Number.isInteger(difficulty) ||
    difficulty < 1 ||
    difficulty > 5
  ) {
    throw new Error(`[CONTENT] cadences: ${at} (${id}).difficulty must be an integer 1..5`);
  }

  return {
    id,
    name,
    harmonicMovement: { from, to },
    melodicResolution: { from: melFrom, to: melTo, motion },
    constrainsPenultimate,
    difficulty: difficulty as CadenceDifficulty,
  };
}

/**
 * Validate an arbitrary value as a cadence array. Throws on any structural or
 * enum violation, and on duplicate ids. Exported so callers (and tests) can
 * validate content from any source, not just the bundled JSON.
 */
export function validateCadences(raw: unknown): CadencePatternEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error('[CONTENT] cadences: top-level value must be an array');
  }
  const entries = raw.map((e, i) => validateEntry(e, i));

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`[CONTENT] cadences: duplicate id "${entry.id}"`);
    }
    seen.add(entry.id);
  }

  return entries;
}

/**
 * Load and validate the bundled starter cadence library. Throws on invalid
 * content (the _meta marker is ignored; only the `cadences` array is validated).
 */
export function loadCadences(): CadencePatternEntry[] {
  const doc = cadencesDoc as { cadences?: unknown };
  const entries = validateCadences(doc.cadences);
  // NB: no success log here — `console` is not in tsconfig.pure.json's lib (no DOM,
  // no @types/node), so referencing it is a compile error under the pure build.
  // Validation throws LOUDLY on bad content, which is what load time actually requires.
  return entries;
}
