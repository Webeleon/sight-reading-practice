import { describe, it, expect } from 'vitest';
import { FOUR_FOUR, makeNeckPosition, ticksPerBar, pitchClass } from '../domain/index.js';
import type { Key } from '../domain/index.js';
import { loadProgressions } from '../content/progressionLibrary.js';
import { loadMotifs } from '../content/motifLibrary.js';
import { loadCadences } from '../content/cadenceLibrary.js';
import { makeRng } from './prng.js';
import { buildGenerationContext } from './context.js';
import { selectProgression, candidateProgressions, chordAt } from './selectProgression.js';
import { selectCadence } from './selectCadence.js';
import { selectPhraseStructure } from './selectPhraseStructure.js';
import { planRhythm } from './planRhythm.js';
import type { LineConfig } from './config.js';
import { computeTicks, makeDuration } from '../domain/index.js';
import type { RhythmicMotifEntry } from '../content/motifLibrary.js';
import type { PhraseStructure } from '../domain/index.js';

const cMajor: Key = { tonic: { name: 'C', accidental: 'natural' }, mode: 'major' };
const PROGS = loadProgressions();
const MOTIFS = loadMotifs();
const CADS = loadCadences();

function config(overrides: Partial<LineConfig> = {}): LineConfig {
  return {
    key: cMajor,
    timeSignature: FOUR_FOUR,
    position: makeNeckPosition(1, 6, 4, 8, 'V'),
    tempo: 90,
    barCount: 4,
    difficulty: 3,
    accidentalsDensity: 'none',
    ...overrides,
  };
}

describe('buildGenerationContext', () => {
  it('returns only diatonic pitches when accidentalsDensity is none', () => {
    const ctx = buildGenerationContext(config({ accidentalsDensity: 'none' }), makeRng(1, 0));
    expect(ctx.playable.length).toBeGreaterThan(0);
    for (const p of ctx.playable) {
      expect(p.diatonic).toBe(true);
      expect(p.scaleDegree).not.toBeNull();
    }
  });

  it('exposes tonic (degree 1) and dominant (degree 5) pitches in range', () => {
    const ctx = buildGenerationContext(config(), makeRng(1, 0));
    expect(ctx.tonicPitches.length).toBeGreaterThan(0);
    expect(ctx.dominantPitches.length).toBeGreaterThan(0);
    for (const t of ctx.tonicPitches) expect(pitchClass(t.pitch)).toBe(0); // C
    for (const d of ctx.dominantPitches) expect(pitchClass(d.pitch)).toBe(7); // G
  });

  it('admits some chromatic pitches at higher density', () => {
    // Aggregate across seeds so the stochastic admission shows up.
    let chromaticSeen = false;
    for (let s = 0; s < 20 && !chromaticSeen; s++) {
      const ctx = buildGenerationContext(config({ accidentalsDensity: 'high' }), makeRng(s, 0));
      if (ctx.playable.some((p) => !p.diatonic)) chromaticSeen = true;
    }
    expect(chromaticSeen).toBe(true);
  });

  it('reports the time signature strong beats and ticksPerBar', () => {
    const ctx = buildGenerationContext(config(), makeRng(1, 0));
    expect(ctx.strongBeatTicks).toEqual([0, 960]);
    expect(ctx.ticksPerBar).toBe(ticksPerBar(FOUR_FOUR));
  });
});

describe('selectProgression', () => {
  it('only offers candidates of matching bar count and <= difficulty', () => {
    const cands = candidateProgressions(PROGS, config({ barCount: 4, difficulty: 1 }));
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.barCount).toBe(4);
      expect(c.difficulty).toBeLessThanOrEqual(1);
    }
  });

  it('instantiates Roman numerals into concrete chords in the key', () => {
    const prog = selectProgression(PROGS, config({ barCount: 4, difficulty: 1 }), makeRng(0, 0));
    expect(prog.chords.length).toBeGreaterThan(0);
    for (const c of prog.chords) {
      expect(c.chord.root).toBeDefined();
      expect(typeof c.chord.quality).toBe('string');
    }
  });

  it('is deterministic for the same rng stream', () => {
    const a = selectProgression(PROGS, config(), makeRng(9, 0));
    const b = selectProgression(PROGS, config(), makeRng(9, 0));
    expect(a.progressionId).toBe(b.progressionId);
  });

  it('chordAt returns the harmony in effect at a bar/tick', () => {
    const prog = selectProgression(PROGS, config({ barCount: 4, difficulty: 1 }), makeRng(0, 0));
    const c = chordAt(prog, 0, 0);
    expect(c.barIndex).toBe(0);
  });
});

describe('selectCadence', () => {
  it('prefers a cadence whose final degree matches the progression final', () => {
    // I-IV-V-I ends on I; an authentic cadence (to I) should be eligible.
    const prog = selectProgression(
      PROGS.filter((p) => p.id === 'I-IV-V-I'),
      config({ barCount: 4, difficulty: 1 }),
      makeRng(0, 0),
    );
    const cad = selectCadence(CADS, prog, makeRng(0, 0));
    // final chord of I-IV-V-I is I (degree i); authentic cadences resolve to I.
    expect(['authentic_perfect', 'authentic_via_supertonic', 'plagal']).toContain(cad.id);
  });
});

describe('selectPhraseStructure', () => {
  it('produces barRoles of length === barCount', () => {
    for (const bc of [2, 3, 4, 6, 8]) {
      const prog = selectProgression(
        PROGS,
        config({ barCount: bc === 2 ? 2 : 4, difficulty: 3 }),
        makeRng(0, 0),
      );
      const ph = selectPhraseStructure(bc, prog, makeRng(bc, 0));
      expect(ph.barRoles.length).toBe(bc);
    }
  });
});

describe('planRhythm', () => {
  it('fills every bar to exactly ticksPerBar', () => {
    const tpb = ticksPerBar(FOUR_FOUR);
    for (let seed = 0; seed < 30; seed++) {
      const cfg = config({ barCount: 4 });
      const prog = selectProgression(PROGS, cfg, makeRng(seed, 0));
      const ph = selectPhraseStructure(4, prog, makeRng(seed, 0));
      const rh = planRhythm(MOTIFS, cfg, ph, tpb, [0, 960], makeRng(seed, 0));
      const perBar = new Map<number, number>();
      for (const s of rh.slots) {
        perBar.set(s.barIndex, (perBar.get(s.barIndex) ?? 0) + s.duration.ticks);
      }
      for (let bar = 0; bar < 4; bar++) expect(perBar.get(bar)).toBe(tpb);
    }
  });

  it('marks downbeat (tick 0) slots as strong beats', () => {
    const cfg = config();
    const prog = selectProgression(PROGS, cfg, makeRng(0, 0));
    const ph = selectPhraseStructure(4, prog, makeRng(0, 0));
    const rh = planRhythm(MOTIFS, cfg, ph, ticksPerBar(FOUR_FOUR), [0, 960], makeRng(0, 0));
    for (const s of rh.slots) {
      if (s.beatPositionInBar === 0 || s.beatPositionInBar === 960) {
        expect(s.isStrongBeat).toBe(true);
      }
    }
  });

  // Regression: every slot's duration NOTATION (base/dots/tuplet) must reconstruct its
  // own tick count. The rhythm-variation merges (augmentation/omission) used to
  // synthesize a note that kept the wrong base while overwriting ticks, so a renderer
  // drew the wrong visual length and bars looked short (the "3-beat 4/4 bar with a
  // triplet" a human saw). Exercise difficulty 4 so the triplet motifs are in play.
  it('every slot duration notation matches its tick count (incl. triplets)', () => {
    const tpb = ticksPerBar(FOUR_FOUR);
    for (let seed = 0; seed < 200; seed++) {
      const cfg = config({ barCount: 4, difficulty: 4 });
      const prog = selectProgression(PROGS, cfg, makeRng(seed, 0));
      const ph = selectPhraseStructure(4, prog, makeRng(seed, 0));
      const rh = planRhythm(MOTIFS, cfg, ph, tpb, [0, 960], makeRng(seed, 0));
      for (const s of rh.slots) {
        expect(
          computeTicks(s.duration.base, s.duration.dots, s.duration.tuplet),
          `seed=${seed} slot at tick ${s.startTick} base=${s.duration.base} dots=${s.duration.dots} ` +
            `tuplet=${JSON.stringify(s.duration.tuplet)} ticks=${s.duration.ticks}`,
        ).toBe(s.duration.ticks);
      }
    }
  });

  // Regression for the SPECIFIC failure shape: the Charleston motif
  // (dotted-quarter 720, eighth 240, half 960). An "omission" variation merges the
  // last two events -> eighth(240)+half(960)=1200 ticks, which is NOT a single
  // notatable note. The fix must NOT emit a note whose notation disagrees with its
  // ticks; here it skips the merge so the bar stays {720, 240, 960}. Either way every
  // slot's notation must equal its ticks and the bar must still fill.
  it('does not synthesize a non-notatable merged duration (Charleston omission case)', () => {
    const tpb = ticksPerBar(FOUR_FOUR);
    const charleston: RhythmicMotifEntry = {
      id: 'charleston-fixture',
      name: 'Charleston Fixture',
      timeSignature: '4/4',
      difficulty: 3,
      durations: [makeDuration('quarter', 1), makeDuration('eighth'), makeDuration('half')],
      rhythmVocabulary: ['syncopated'],
    };
    // Force a variation on bar 1 across many seeds; whatever variation fires, the
    // result must be notatable and fill the bar (no eighth-with-1200-ticks note).
    const ph: PhraseStructure = { pattern: 'AAAB', barRoles: ['A', 'A'] };
    let sawSecondBar = false;
    for (let seed = 0; seed < 300; seed++) {
      const rh = planRhythm([charleston], config({ barCount: 2 }), ph, tpb, [0, 960], makeRng(seed, 0));
      const perBar = new Map<number, number>();
      for (const s of rh.slots) {
        // No slot may carry a tick count its notation cannot express.
        expect(computeTicks(s.duration.base, s.duration.dots, s.duration.tuplet)).toBe(
          s.duration.ticks,
        );
        // And specifically: never an eighth that claims to last 1200 ticks.
        if (s.duration.base === 'eighth' && s.duration.dots === 0 && !s.duration.tuplet) {
          expect(s.duration.ticks).toBe(240);
        }
        perBar.set(s.barIndex, (perBar.get(s.barIndex) ?? 0) + s.duration.ticks);
        if (s.barIndex === 1) sawSecondBar = true;
      }
      expect(perBar.get(0)).toBe(tpb);
      expect(perBar.get(1)).toBe(tpb);
    }
    expect(sawSecondBar).toBe(true);
  });
});
