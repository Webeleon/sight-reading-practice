// Adversarial MusicXML structural verifier (throwaway verification tool).
//
// Strategy: re-generate each line in-memory so we have the authoritative Line
// object, serialize it, parse the XML with happy-dom's DOMParser (asserting
// well-formedness), then cross-check EVERY required structural element against the
// ground-truth Line. Accidental expectations are re-derived independently here so
// we catch both redundant accidentals (already in key sig) and missing ones (true
// chromatic alterations).
//
// Run: node --import tsx scripts/verify-musicxml.mts

import { Window } from 'happy-dom';
import { generateLine } from '../src/generator/generateLine.js';
import { serializeLineToMusicXML } from '../src/musicxml/serialize.js';
import { keySignature } from '../src/domain/key.js';
import { makeNeckPosition, FOUR_FOUR } from '../src/domain/index.js';
import type { LineConfig } from '../src/generator/config.js';
import type { Line, LineNote } from '../src/domain/line.js';
import type { Key } from '../src/domain/key.js';
import type { NoteName, Accidental, Pitch } from '../src/domain/pitch.js';

const FIXED = '2026-06-04T00:00:00.000Z';

type Problem = { file: string; severity: 'critical' | 'major' | 'minor'; msg: string };
const problems: Problem[] = [];
function bug(file: string, severity: Problem['severity'], msg: string): void {
  problems.push({ file, severity, msg });
}

// --- ground-truth helpers (independent re-derivation) ------------------------

const SHARP_ORDER: NoteName[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: NoteName[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const ALTER: Record<Accidental, number> = {
  doubleFlat: -2, flat: -1, natural: 0, sharp: 1, doubleSharp: 2,
};
const ACC_NAME: Record<Accidental, string> = {
  doubleFlat: 'flat-flat', flat: 'flat', natural: 'natural', sharp: 'sharp', doubleSharp: 'double-sharp',
};
const TYPE_NAME: Record<string, string> = {
  whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', sixteenth: '16th', thirtySecond: '32nd',
};

function fifthsOf(key: Key): number {
  const s = keySignature(key);
  return 'sharps' in s ? s.sharps : -s.flats;
}
function sigAccidentals(fifths: number): Map<NoteName, Accidental> {
  const m = new Map<NoteName, Accidental>();
  if (fifths > 0) for (let i = 0; i < fifths; i++) m.set(SHARP_ORDER[i]!, 'sharp');
  else if (fifths < 0) for (let i = 0; i < -fifths; i++) m.set(FLAT_ORDER[i]!, 'flat');
  return m;
}

// Independent re-derivation of which notes SHOULD carry an explicit accidental,
// applying the standard rules: baseline is key-sig accidental for the letter;
// active accidentals reset each measure; an explicit accidental appears whenever a
// note differs from whatever is currently in effect at its staff position
// (letter+octave). Returns a per-measure array of booleans aligned to sounded notes.
function expectedAccidentals(line: Line): Map<number, boolean[]> {
  const fifths = fifthsOf(line.key);
  const sig = sigAccidentals(fifths);
  const byBar = new Map<number, LineNote[]>();
  for (const n of line.notes) {
    if (!byBar.has(n.barIndex)) byBar.set(n.barIndex, []);
    byBar.get(n.barIndex)!.push(n);
  }
  const out = new Map<number, boolean[]>();
  for (const [bar, notes] of byBar) {
    notes.sort((a, b) => a.startTick - b.startTick);
    const active = new Map<string, Accidental>();
    const flags: boolean[] = [];
    for (const n of notes) {
      if (n.pitch === null) { flags.push(false); continue; }
      const sk = `${n.pitch.name}${n.pitch.octave}`;
      const current = active.get(sk) ?? sig.get(n.pitch.name) ?? 'natural';
      if (current === n.pitch.accidental) flags.push(false);
      else { active.set(sk, n.pitch.accidental); flags.push(true); }
    }
    out.set(bar, flags);
  }
  return out;
}

// --- batch configs (mirrors the CLI batches) ---------------------------------

function key(name: NoteName, accidental: Accidental, mode: 'major' | 'minor'): Key {
  return { tonic: { name, accidental }, mode };
}
const POS = makeNeckPosition(1, 6, 4, 8, 'V');
function cfg(k: Key, acc: LineConfig['accidentalsDensity']): LineConfig {
  return { key: k, timeSignature: FOUR_FOUR, position: POS, tempo: 90, barCount: 4, difficulty: 3, accidentalsDensity: acc };
}

const batches: { name: string; cfg: LineConfig; base: number; count: number }[] = [
  { name: 'Cmaj', cfg: cfg(key('C', 'natural', 'major'), 'none'), base: 0, count: 8 },
  { name: 'F#maj', cfg: cfg(key('F', 'sharp', 'major'), 'medium'), base: 50, count: 6 },
  { name: 'Gbmaj', cfg: cfg(key('G', 'flat', 'major'), 'medium'), base: 60, count: 6 },
  { name: 'Amin', cfg: cfg(key('A', 'natural', 'minor'), 'high'), base: 70, count: 6 },
  { name: 'Cmin', cfg: cfg(key('C', 'natural', 'minor'), 'high'), base: 90, count: 6 },
  { name: 'Ebmaj', cfg: cfg(key('E', 'flat', 'major'), 'high'), base: 80, count: 6 },
  { name: 'Cbmaj', cfg: cfg(key('C', 'flat', 'major'), 'high'), base: 200, count: 4 },
  { name: 'C#min', cfg: cfg(key('C', 'sharp', 'minor'), 'high'), base: 210, count: 4 },
];

// --- DOM parse + structural checks -------------------------------------------

const window = new Window();
const DOMParser = window.DOMParser;

function txt(el: Element | null): string | null {
  return el ? (el.textContent ?? '').trim() : null;
}

function verify(file: string, line: Line, xml: string): void {
  // 1. WELL-FORMEDNESS. happy-dom's DOMParser reports parse errors as a
  // <parsererror> element in the result, OR (for some malformations) throws.
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
  } catch (e) {
    bug(file, 'critical', `XML threw on parse: ${(e as Error).message}`);
    return;
  }
  const perr = doc.querySelector('parsererror');
  if (perr) {
    bug(file, 'critical', `not well-formed: ${txt(perr)?.slice(0, 200)}`);
    return;
  }
  const root = doc.documentElement;
  if (!root || root.tagName !== 'score-partwise') {
    bug(file, 'critical', `root is not <score-partwise> (got ${root?.tagName})`);
    return;
  }

  // 2a. CLEF with clef-octave-change == -1
  const clef = doc.querySelector('clef');
  if (!clef) bug(file, 'critical', 'no <clef>');
  else {
    if (txt(clef.querySelector('sign')) !== 'G') bug(file, 'major', `clef sign not G (${txt(clef.querySelector('sign'))})`);
    if (txt(clef.querySelector('line')) !== '2') bug(file, 'major', `clef line not 2`);
    const oct = txt(clef.querySelector('clef-octave-change'));
    if (oct !== '-1') bug(file, 'critical', `clef-octave-change != -1 (got ${oct})`);
  }

  // 2b. KEY signature fifths consistent with line key
  const keyEl = doc.querySelector('key');
  if (!keyEl) bug(file, 'critical', 'no <key>');
  else {
    const fifths = txt(keyEl.querySelector('fifths'));
    const expFifths = String(fifthsOf(line.key));
    if (fifths !== expFifths) bug(file, 'critical', `fifths ${fifths} != expected ${expFifths} for key`);
    const mode = txt(keyEl.querySelector('mode'));
    if (mode !== line.key.mode) bug(file, 'minor', `mode ${mode} != ${line.key.mode}`);
  }

  // 2c. TIME signature present + consistent
  const timeEl = doc.querySelector('time');
  if (!timeEl) bug(file, 'critical', 'no <time>');
  else {
    const beats = txt(timeEl.querySelector('beats'));
    const bu = txt(timeEl.querySelector('beat-type'));
    if (beats !== String(line.timeSignature.beats)) bug(file, 'major', `beats ${beats} != ${line.timeSignature.beats}`);
    if (bu !== String(line.timeSignature.beatUnit)) bug(file, 'major', `beat-type ${bu} != ${line.timeSignature.beatUnit}`);
  }

  // 2d. DIVISIONS == 480
  const div = txt(doc.querySelector('divisions'));
  if (div !== '480') bug(file, 'critical', `divisions ${div} != 480`);

  // attributes (clef/key/time/divisions) must appear only in the FIRST measure
  const measures = Array.from(doc.querySelectorAll('measure'));
  if (measures.length !== line.barCount) bug(file, 'major', `${measures.length} measures != barCount ${line.barCount}`);
  measures.forEach((m, i) => {
    const hasAttrs = m.querySelector('attributes') !== null;
    if (i === 0 && !hasAttrs) bug(file, 'critical', 'first measure missing <attributes>');
    if (i > 0 && hasAttrs) bug(file, 'minor', `measure ${i + 1} has redundant <attributes>`);
  });

  // 3 + 2e. Per-measure note checks: pitch/rest/duration/type/accidental/ties.
  const expAcc = expectedAccidentals(line);
  // Group ground-truth notes by bar in start order, mirroring the serializer.
  const gtByBar = new Map<number, LineNote[]>();
  for (const n of line.notes) {
    if (!gtByBar.has(n.barIndex)) gtByBar.set(n.barIndex, []);
    gtByBar.get(n.barIndex)!.push(n);
  }
  for (const arr of gtByBar.values()) arr.sort((a, b) => a.startTick - b.startTick);

  const tsTicksPerBar = (line.timeSignature.beats * 480 * 4) / line.timeSignature.beatUnit;

  measures.forEach((m, mi) => {
    const noteEls = Array.from(m.querySelectorAll('note'));
    const gt = gtByBar.get(mi) ?? [];
    const flags = expAcc.get(mi) ?? [];
    if (noteEls.length !== gt.length) {
      bug(file, 'critical', `measure ${mi + 1}: ${noteEls.length} <note> elements != ${gt.length} ground-truth notes`);
      return;
    }
    let durSum = 0;
    noteEls.forEach((ne, ni) => {
      const g = gt[ni]!;
      const isRest = ne.querySelector('rest') !== null;
      const hasPitch = ne.querySelector('pitch') !== null;
      // rest vs pitch handling
      if (g.pitch === null) {
        if (!isRest) bug(file, 'critical', `m${mi + 1} note${ni}: expected <rest>, got pitch`);
        if (hasPitch) bug(file, 'critical', `m${mi + 1} note${ni}: rest has <pitch>`);
      } else {
        if (isRest) bug(file, 'critical', `m${mi + 1} note${ni}: expected pitch, got <rest>`);
        const p = ne.querySelector('pitch');
        if (p) {
          const step = txt(p.querySelector('step'));
          const oct = txt(p.querySelector('octave'));
          const alterEl = p.querySelector('alter');
          const alter = alterEl ? Number(txt(alterEl)) : 0;
          if (step !== g.pitch.name) bug(file, 'major', `m${mi + 1} note${ni}: step ${step} != ${g.pitch.name}`);
          if (oct !== String(g.pitch.octave)) bug(file, 'major', `m${mi + 1} note${ni}: octave ${oct} != ${g.pitch.octave}`);
          if (alter !== ALTER[g.pitch.accidental]) bug(file, 'critical', `m${mi + 1} note${ni}: alter ${alter} != ${ALTER[g.pitch.accidental]} for ${g.pitch.accidental}`);
          // <alter> must be omitted when 0 (serializer contract)
          if (ALTER[g.pitch.accidental] === 0 && alterEl) bug(file, 'minor', `m${mi + 1} note${ni}: redundant <alter>0</alter>`);
        }
      }
      // duration
      const d = txt(ne.querySelector('duration'));
      if (d !== String(g.duration.ticks)) bug(file, 'critical', `m${mi + 1} note${ni}: duration ${d} != ${g.duration.ticks}`);
      durSum += Number(d);
      // type
      const ty = txt(ne.querySelector('type'));
      if (ty !== TYPE_NAME[g.duration.base]) bug(file, 'major', `m${mi + 1} note${ni}: type ${ty} != ${TYPE_NAME[g.duration.base]}`);
      // dots
      const dotCount = ne.querySelectorAll('dot').length;
      if (dotCount !== g.duration.dots) bug(file, 'major', `m${mi + 1} note${ni}: ${dotCount} dots != ${g.duration.dots}`);
      // tuplet / time-modification
      const tm = ne.querySelector('time-modification');
      if (g.duration.tuplet && !tm) bug(file, 'major', `m${mi + 1} note${ni}: missing <time-modification> for tuplet`);
      if (!g.duration.tuplet && tm) bug(file, 'major', `m${mi + 1} note${ni}: spurious <time-modification>`);
      if (g.duration.tuplet && tm) {
        const an = txt(tm.querySelector('actual-notes'));
        const nn = txt(tm.querySelector('normal-notes'));
        if (an !== String(g.duration.tuplet.numerator)) bug(file, 'minor', `m${mi + 1} note${ni}: actual-notes ${an} != ${g.duration.tuplet.numerator}`);
        if (nn !== String(g.duration.tuplet.denominator)) bug(file, 'minor', `m${mi + 1} note${ni}: normal-notes ${nn} != ${g.duration.tuplet.denominator}`);
      }
      // 3. ACCIDENTAL display correctness (the key check)
      const accEl = ne.querySelector('accidental');
      const shouldShow = flags[ni] ?? false;
      if (shouldShow && !accEl) {
        bug(file, 'critical', `m${mi + 1} note${ni}: MISSING required <accidental> for ${g.pitch ? `${g.pitch.name}${g.pitch.accidental}${g.pitch.octave}` : '?'}`);
      }
      if (!shouldShow && accEl) {
        bug(file, 'critical', `m${mi + 1} note${ni}: REDUNDANT <accidental>${txt(accEl)} (already in key sig / measure state) for ${g.pitch ? `${g.pitch.name}${g.pitch.accidental}${g.pitch.octave}` : '?'}`);
      }
      if (shouldShow && accEl && g.pitch) {
        if (txt(accEl) !== ACC_NAME[g.pitch.accidental]) bug(file, 'major', `m${mi + 1} note${ni}: accidental name ${txt(accEl)} != ${ACC_NAME[g.pitch.accidental]}`);
      }
    });
    // bar fills exactly (sum of sounded durations; ties don't change a bar's fill)
    if (durSum !== tsTicksPerBar) {
      bug(file, 'critical', `m${mi + 1}: duration sum ${durSum} != ticks/bar ${tsTicksPerBar}`);
    }
  });

  // 2f. TIE handling. Each <tie>/<tied type=start> on a sounded note must be
  // matched by a stop on the next sounded note of identical spelling; orphan
  // starts/stops are a bug. We verify start/stop pairing globally across the part.
  const allNotes = Array.from(doc.querySelectorAll('note'));
  // Build the global sounded-note sequence with their spellings (in document order,
  // which is measure order then note order — matches Line note order by tick).
  type SoundedRef = { el: Element; spell: string | null; isRest: boolean };
  const seq: SoundedRef[] = allNotes.map((ne) => {
    const isRest = ne.querySelector('rest') !== null;
    const p = ne.querySelector('pitch');
    const spell = p ? `${txt(p.querySelector('step'))}|${p.querySelector('alter') ? txt(p.querySelector('alter')) : '0'}|${txt(p.querySelector('octave'))}` : null;
    return { el: ne, spell, isRest };
  });
  for (let i = 0; i < seq.length; i++) {
    const ne = seq[i]!.el;
    const tieStart = Array.from(ne.querySelectorAll('tie')).some((t) => t.getAttribute('type') === 'start');
    const tiedStart = Array.from(ne.querySelectorAll('tied')).some((t) => t.getAttribute('type') === 'start');
    if (tieStart !== tiedStart) bug(file, 'major', `note#${i}: <tie> start present=${tieStart} but <tied> start present=${tiedStart} (must agree)`);
    if (tieStart) {
      // the next sounded (non-rest) note must carry a stop and share spelling
      let j = i + 1;
      while (j < seq.length && seq[j]!.isRest) j++;
      if (j >= seq.length) { bug(file, 'major', `note#${i}: tie start has no following note to stop on`); continue; }
      const nxt = seq[j]!.el;
      const stopTie = Array.from(nxt.querySelectorAll('tie')).some((t) => t.getAttribute('type') === 'stop');
      const stopTied = Array.from(nxt.querySelectorAll('tied')).some((t) => t.getAttribute('type') === 'stop');
      if (!stopTie || !stopTied) bug(file, 'critical', `note#${i}: tie start not matched by stop on next note#${j}`);
      if (seq[i]!.spell !== seq[j]!.spell) bug(file, 'major', `note#${i}->#${j}: tied notes differ in spelling (${seq[i]!.spell} vs ${seq[j]!.spell})`);
    }
  }
  // Orphan stops: a stop with no preceding start
  for (let i = 0; i < seq.length; i++) {
    const ne = seq[i]!.el;
    const stop = Array.from(ne.querySelectorAll('tie')).some((t) => t.getAttribute('type') === 'stop');
    if (stop) {
      let j = i - 1;
      while (j >= 0 && seq[j]!.isRest) j--;
      const prevStart = j >= 0 && Array.from(seq[j]!.el.querySelectorAll('tie')).some((t) => t.getAttribute('type') === 'start');
      if (!prevStart) bug(file, 'critical', `note#${i}: tie stop with no preceding tie start`);
    }
  }
}

// --- run ---------------------------------------------------------------------

let total = 0;
let withTies = 0;
let withTuplets = 0;
let withRests = 0;
let withExplicitAcc = 0;
for (const b of batches) {
  for (let k = 0; k < b.count; k++) {
    const seed = b.base + k;
    const line = generateLine(b.cfg, seed, FIXED);
    const xml = serializeLineToMusicXML(line);
    const file = `${b.name}-seed${seed}`;
    total++;
    if (line.notes.some((n) => n.tiedToNext)) withTies++;
    if (line.notes.some((n) => n.duration.tuplet)) withTuplets++;
    if (line.notes.some((n) => n.pitch === null)) withRests++;
    const ea = expectedAccidentals(line);
    if (Array.from(ea.values()).some((arr) => arr.some(Boolean))) withExplicitAcc++;
    verify(file, line, xml);
  }
}

console.log(`\nVerified ${total} lines.`);
console.log(`Coverage: ${withTies} with ties, ${withTuplets} with tuplets, ${withRests} with rests, ${withExplicitAcc} with explicit accidentals.`);
console.log(`Problems found: ${problems.length}`);
const order = { critical: 0, major: 1, minor: 2 };
problems.sort((a, b) => order[a.severity] - order[b.severity]);
for (const p of problems) console.log(`  [${p.severity}] ${p.file}: ${p.msg}`);
if (problems.length === 0) console.log('ALL CHECKS PASSED');
