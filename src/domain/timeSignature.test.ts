import { describe, it, expect } from 'vitest';
import {
  FOUR_FOUR,
  THREE_FOUR,
  SIX_EIGHT,
  ticksPerBar,
  makeTimeSignature,
} from './timeSignature.js';

describe('predefined time signatures', () => {
  it('4/4 has strong beats at ticks 0 and 960', () => {
    expect(FOUR_FOUR.beats).toBe(4);
    expect(FOUR_FOUR.beatUnit).toBe(4);
    expect(FOUR_FOUR.strongBeats).toEqual([0, 960]);
  });
  it('3/4 has a strong beat at tick 0', () => {
    expect(THREE_FOUR.beats).toBe(3);
    expect(THREE_FOUR.beatUnit).toBe(4);
    expect(THREE_FOUR.strongBeats).toEqual([0]);
  });
  it('6/8 has strong beats at ticks 0 and 720', () => {
    expect(SIX_EIGHT.beats).toBe(6);
    expect(SIX_EIGHT.beatUnit).toBe(8);
    expect(SIX_EIGHT.strongBeats).toEqual([0, 720]);
  });
});

describe('ticksPerBar', () => {
  it('4/4 = 1920', () => {
    expect(ticksPerBar(FOUR_FOUR)).toBe(1920);
  });
  it('3/4 = 1440', () => {
    expect(ticksPerBar(THREE_FOUR)).toBe(1440);
  });
  it('6/8 = 1440', () => {
    expect(ticksPerBar(SIX_EIGHT)).toBe(1440);
  });
});

describe('makeTimeSignature', () => {
  it('builds an arbitrary signature', () => {
    const ts = makeTimeSignature(2, 4, [0]);
    expect(ts).toEqual({ beats: 2, beatUnit: 4, strongBeats: [0] });
    expect(ticksPerBar(ts)).toBe(960);
  });
});

describe('JSON round-trip', () => {
  it('survives stringify/parse', () => {
    const round = JSON.parse(JSON.stringify(FOUR_FOUR));
    expect(round).toEqual(FOUR_FOUR);
  });
});
