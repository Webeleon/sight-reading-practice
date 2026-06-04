// Stage 6: selectContour.
//
// Choose an overall melodic shape (arch / invertedArch / ascending / descending /
// steady), pick a climax bar and a climax pitch in the UPPER part of the playable range,
// and derive a per-bar pitch target the strong-beat placer aims toward. The targets are
// drawn from the playable vocabulary so they are always reachable in position.
//
// Pure module: no electron/react/DOM, seeded-PRNG only, no `any`.

import type { Pitch } from '../domain/index.js';
import type { ConcreteProgression, ContourShape, ContourTarget } from '../domain/index.js';
import type { GenerationContext, PlayableNote } from './context.js';
import { nearestPlayable } from './context.js';
import type { Rng } from './prng.js';
import { pick, randInt } from './prng.js';
import { CONTOUR_WORKING_RANGE_SEMITONES } from './tuning.js';

const SHAPES: ReadonlyArray<ContourShape> = [
  'arch',
  'invertedArch',
  'ascending',
  'descending',
  'steady',
];

/** Normalized height in [0,1] that a bar's target should sit at, for a given shape.
 *  0 = bottom of the working range, 1 = top (the climax). `t` is the bar's position in
 *  [0,1] across the line; `climaxT` is where the climax bar falls. */
function shapeHeight(shape: ContourShape, t: number, climaxT: number): number {
  switch (shape) {
    case 'ascending':
      return t;
    case 'descending':
      return 1 - t;
    case 'steady':
      return 0.45; // hovers mid-range
    case 'arch':
      // Rise to the climax, then fall. Triangular peak at climaxT.
      return t <= climaxT
        ? climaxT === 0
          ? 1
          : t / climaxT
        : 1 - (t - climaxT) / Math.max(1e-6, 1 - climaxT);
    case 'invertedArch':
      // Dip to a low point at climaxT, then rise (the "climax bar" is the extreme,
      // here a low extreme). We still report the extreme bar as climaxBar.
      return t <= climaxT
        ? climaxT === 0
          ? 0
          : 1 - t / climaxT
        : (t - climaxT) / Math.max(1e-6, 1 - climaxT);
  }
}

/**
 * Build the contour target. The working pitch range is the playable vocabulary; the
 * climax pitch is sampled from the upper quartile of that range so the high point sits
 * audibly above the surrounding line.
 */
export function selectContour(
  barCount: number,
  _progression: ConcreteProgression,
  context: GenerationContext,
  rng: Rng,
): ContourTarget {
  const playable = context.playable;
  if (playable.length === 0) {
    throw new Error('[GEN] selectContour: no playable pitches in position');
  }

  const shape = pick(rng, SHAPES);

  // Climax bar: interior bar for arch/invertedArch (so there is room to rise and fall);
  // last bar for ascending; first for descending; mid for steady.
  let climaxBar: number;
  switch (shape) {
    case 'ascending':
      climaxBar = barCount - 1;
      break;
    case 'descending':
      climaxBar = 0;
      break;
    case 'steady':
      climaxBar = Math.floor(barCount / 2);
      break;
    default: {
      // arch / invertedArch: an interior bar (avoid the very first/last when possible).
      climaxBar =
        barCount <= 2 ? randInt(rng, barCount) : 1 + randInt(rng, barCount - 2);
    }
  }

  // Use a COMPRESSED register band, not the full playable span. A guitar position can
  // span ~2 octaves, but a single conjunct line should sit inside roughly one octave so
  // the strong-beat skeleton stays stepwise and the total range stays under ~1.5
  // octaves (validateMusicality). We place an OCTAVE-ish band inside the playable range.
  const fullLo = playable[0]!.midi;
  const fullHi = playable[playable.length - 1]!.midi;
  const fullSpan = Math.max(1, fullHi - fullLo);
  const WORKING_RANGE = Math.min(fullSpan, CONTOUR_WORKING_RANGE_SEMITONES);
  // Random vertical placement of the band within the available headroom, so different
  // seeds explore low/middle/high registers (but always a compact band).
  const headroom = fullSpan - WORKING_RANGE;
  const bandLo = fullLo + Math.round(rng() * headroom);
  const loMidi = bandLo;
  const hiMidi = bandLo + WORKING_RANGE;
  const span = Math.max(1, hiMidi - loMidi);

  // Climax pitch: nearest playable to the TOP of the register band.
  const climaxNote = nearestPlayable(playable, hiMidi) ?? playable[playable.length - 1]!;
  const climaxPitch: Pitch = climaxNote.pitch;

  const climaxT = barCount <= 1 ? 0 : climaxBar / (barCount - 1);

  // Per-bar targets: map each bar's shape height into the playable range, then snap to
  // the nearest playable pitch. For the climax bar use the climax pitch exactly.
  const perBarTargets: Pitch[] = [];
  for (let bar = 0; bar < barCount; bar++) {
    if (bar === climaxBar) {
      perBarTargets.push(climaxPitch);
      continue;
    }
    const t = barCount <= 1 ? 0 : bar / (barCount - 1);
    const h = shapeHeight(shape, t, climaxT); // 0..1
    const targetMidi = loMidi + h * span;
    const snapped: PlayableNote =
      nearestPlayable(playable, targetMidi) ?? climaxNote;
    perBarTargets.push(snapped.pitch);
  }

  return { shape, climaxBar, climaxPitch, perBarTargets };
}
