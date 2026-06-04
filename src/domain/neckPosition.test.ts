import { describe, it, expect } from 'vitest';
import { makeNeckPosition } from './neckPosition.js';
import type { NeckPosition } from './neckPosition.js';

describe('makeNeckPosition', () => {
  it('builds a 5th-position fifth-fret region across all 6 strings', () => {
    const pos = makeNeckPosition(1, 6, 4, 8, 'V');
    expect(pos).toEqual<NeckPosition>({
      stringRange: { low: 1, high: 6 },
      fretRange: { low: 4, high: 8 },
      label: 'V',
    });
  });

  it('omits label when not provided', () => {
    const pos = makeNeckPosition(1, 6, 0, 4);
    expect(pos.label).toBeUndefined();
    expect(pos.stringRange).toEqual({ low: 1, high: 6 });
    expect(pos.fretRange).toEqual({ low: 0, high: 4 });
  });

  it('JSON round-trips', () => {
    const pos = makeNeckPosition(1, 6, 4, 8, 'V');
    expect(JSON.parse(JSON.stringify(pos))).toEqual(pos);
  });
});
