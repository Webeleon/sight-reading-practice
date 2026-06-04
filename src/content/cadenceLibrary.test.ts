import { describe, it, expect } from 'vitest';
import {
  loadCadences,
  validateCadences,
  type CadencePatternEntry,
} from './cadenceLibrary.js';

describe('loadCadences — bundled starter content', () => {
  it('loads and validates without throwing', () => {
    expect(() => loadCadences()).not.toThrow();
  });

  it('returns at least the 4 brief-required cadence types', () => {
    const cadences = loadCadences();
    expect(cadences.length).toBeGreaterThanOrEqual(4);
  });

  it('includes an authentic cadence (V -> I, leadingTone -> tonic, stepUp)', () => {
    const cadences = loadCadences();
    const authentic = cadences.find(
      (c) =>
        c.harmonicMovement.from === 'V' &&
        c.harmonicMovement.to === 'I' &&
        c.melodicResolution.from === 'leadingTone' &&
        c.melodicResolution.to === 'tonic' &&
        c.melodicResolution.motion === 'stepUp',
    );
    expect(authentic).toBeDefined();
  });

  it('includes an authentic cadence via supertonic (V -> I, supertonic -> tonic, stepDown)', () => {
    const cadences = loadCadences();
    const viaSupertonic = cadences.find(
      (c) =>
        c.harmonicMovement.from === 'V' &&
        c.harmonicMovement.to === 'I' &&
        c.melodicResolution.from === 'supertonic' &&
        c.melodicResolution.to === 'tonic' &&
        c.melodicResolution.motion === 'stepDown',
    );
    expect(viaSupertonic).toBeDefined();
  });

  it('includes a half cadence (any -> V)', () => {
    const cadences = loadCadences();
    const half = cadences.find((c) => c.harmonicMovement.to === 'V');
    expect(half).toBeDefined();
  });

  it('includes a plagal cadence (IV -> I)', () => {
    const cadences = loadCadences();
    const plagal = cadences.find(
      (c) => c.harmonicMovement.from === 'IV' && c.harmonicMovement.to === 'I',
    );
    expect(plagal).toBeDefined();
  });

  it('every entry has a unique id', () => {
    const cadences = loadCadences();
    const ids = new Set(cadences.map((c) => c.id));
    expect(ids.size).toBe(cadences.length);
  });

  it('every entry round-trips through JSON', () => {
    const cadences = loadCadences();
    expect(JSON.parse(JSON.stringify(cadences))).toEqual(cadences);
  });
});

// Minimal valid template used to build broken variants for the failure tests.
const VALID: CadencePatternEntry = {
  id: 'test_valid',
  name: 'Test Valid',
  harmonicMovement: { from: 'V', to: 'I' },
  melodicResolution: { from: 'leadingTone', to: 'tonic', motion: 'stepUp' },
  constrainsPenultimate: true,
  difficulty: 1,
};

describe('validateCadences — fails loudly on invalid content', () => {
  it('accepts a valid array', () => {
    expect(() => validateCadences([VALID])).not.toThrow();
  });

  it('throws when the top-level value is not an array', () => {
    expect(() => validateCadences({ not: 'an array' })).toThrow();
  });

  it('throws on an invalid melodicResolution.from enum', () => {
    const broken = [{ ...VALID, melodicResolution: { ...VALID.melodicResolution, from: 'notADegree' } }];
    expect(() => validateCadences(broken)).toThrow();
  });

  it('throws on an invalid melodicResolution.to enum', () => {
    const broken = [{ ...VALID, melodicResolution: { ...VALID.melodicResolution, to: 'subdominant' } }];
    expect(() => validateCadences(broken)).toThrow();
  });

  it('throws on an invalid melodicResolution.motion enum', () => {
    const broken = [{ ...VALID, melodicResolution: { ...VALID.melodicResolution, motion: 'slide' } }];
    expect(() => validateCadences(broken)).toThrow();
  });

  it('throws on a difficulty out of the 1..5 range', () => {
    const broken = [{ ...VALID, difficulty: 7 }];
    expect(() => validateCadences(broken)).toThrow();
  });

  it('throws on an unparseable harmonic Roman numeral', () => {
    const broken = [{ ...VALID, harmonicMovement: { from: 'Z', to: 'I' } }];
    expect(() => validateCadences(broken)).toThrow();
  });

  it('throws on duplicate ids', () => {
    expect(() => validateCadences([VALID, { ...VALID }])).toThrow();
  });

  it('throws on a missing required field', () => {
    const { name, ...withoutName } = VALID;
    void name;
    expect(() => validateCadences([withoutName])).toThrow();
  });
});
