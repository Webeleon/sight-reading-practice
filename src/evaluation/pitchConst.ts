// evaluation/pitchConst.ts — the tuning-reference constants the review math needs.
//
// PURE module: no Web Audio / DOM / React / Electron; no `any`.
//
// These mirror the SAME named constants in src/audio/pitchMath.ts (A4 = 440 Hz =
// MIDI 69). They are duplicated here ON PURPOSE so the pure evaluation layer does
// not import from the audio layer (a layering inversion): evaluation stays a pure
// function of plain data with no transitive dependency on Web Audio code. If the
// reference pitch is ever retuned for Gate 3, update BOTH places (a one-line grep).

/** A4 reference frequency (concert A). 440 Hz == MIDI 69. */
export const A4_HZ = 440;

/** MIDI number of the A4 reference. */
export const A4_MIDI = 69;
