// Fallback lines: returned when generation fails all MAX_OUTER_ATTEMPTS retries.
//
// fallbackLines.json holds a few pre-authored "safe" complete Line objects (generated
// programmatically from known-good configs/seeds and serialized). They always validate.
// We pick the fallback whose barCount matches the requested config, else the first one.
//
// The returned Line is re-stamped with the requested seed and the INJECTED generatedAt
// (never the system clock), so a fallback is still deterministic for a given call.
//
// Pure module: no electron/react/DOM, no `any`.

import type { Line } from '../domain/index.js';
import fallbackData from '../content/data/fallbackLines.json' with { type: 'json' };

interface FallbackFile {
  lines: Line[];
}

/** Load the pre-authored fallback lines. */
export function loadFallbackLines(): Line[] {
  return (fallbackData as unknown as FallbackFile).lines;
}

/**
 * Return a fallback Line for a requested bar count, re-stamped with the caller's seed
 * and injected timestamp so it stays deterministic. Throws if no fallback content
 * exists (a content bug we want surfaced — the prototype always ships fallbacks).
 */
export function getFallbackLine(
  barCount: number,
  seed: number,
  generatedAt: string,
): Line {
  const lines = loadFallbackLines();
  if (lines.length === 0) {
    throw new Error('[GEN] no fallback lines available');
  }
  const match = lines.find((l) => l.barCount === barCount) ?? lines[0]!;
  // Clone (JSON round-trip keeps it pure data) and re-stamp identity fields.
  const clone = JSON.parse(JSON.stringify(match)) as Line;
  clone.seed = seed;
  clone.generatedAt = generatedAt;
  clone.validationsPassed = ['fallback'];
  return clone;
}
