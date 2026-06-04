// Batch generation CLI for auditioning generator output (brief sections 5, 9, 14).
//
// Writes N MusicXML files for a config to a directory, plus a telemetry summary JSON
// (avg attempts/line, fallback count, validator-failure breakdown). Reproducible via
// --seed; determinism is guaranteed by injecting a FIXED generatedAt (never the clock).
//
// This module lives in /src/cli, which is NOT a pure module — it is allowed to do Node
// I/O (fs) and read process.argv. It does NOT, however, reach into generator internals;
// it drives the public generateLine() API and the public serializer.
//
// Usage:
//   node --import tsx src/cli/generateBatch.ts --count 30 --out out/batch
//   node --import tsx src/cli/generateBatch.ts --config myconfig.json --count 10 --out out/x
//   node --import tsx src/cli/generateBatch.ts --count 5 --out out/smoke --seed 100 \
//        --key Eb:major --position 7-11:1-6 --bars 4 --difficulty 3 --accidentals low \
//        --tempo 90
//
// Flags (CLI flags OVERRIDE values from --config):
//   --config  <path>   JSON file with a partial/full LineConfig (see DEFAULT_CONFIG).
//   --count   <N>      how many lines to generate (default 1).
//   --out     <dir>    output directory (created if missing; required).
//   --seed    <N>      base seed; line k uses (baseSeed + k). Default 0.
//   --key     <T:mode> e.g. "C:major", "Eb:major", "A:minor", "F#:minor".
//   --position<sl-sh:fl-fh> strings (1=lowE..6=highE) and frets, e.g. "1-6:4-8". Or
//             <fl-fh> for all strings, e.g. "4-8".
//   --label   <text>   neck-position display label, e.g. "V".
//   --bars    <N>      bar count 2..16 (default 4).
//   --difficulty <1-5> default 3.
//   --accidentals <none|low|medium|high> default none.
//   --tempo   <BPM>    default 90 (carried through; does not affect note choice).
//   --time    <b/u>    time signature, one of 4/4, 3/4, 6/8 (default 4/4).

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { generateLine } from '../generator/generateLine.js';
import type { GenerationTelemetry } from '../generator/generateLine.js';
import type {
  LineConfig,
  AccidentalsDensity,
  Difficulty,
} from '../generator/config.js';
import { MIN_BAR_COUNT, MAX_BAR_COUNT } from '../generator/config.js';
import { serializeLineToMusicXML } from '../musicxml/serialize.js';
import {
  FOUR_FOUR,
  THREE_FOUR,
  SIX_EIGHT,
  makeNeckPosition,
} from '../domain/index.js';
import type {
  Key,
  TimeSignature,
  NoteName,
  Accidental,
} from '../domain/index.js';

// Deterministic injected timestamp so the same flags + seed produce byte-identical
// output. The CLI never reads the system clock (matches generateLine's contract).
const FIXED_GENERATED_AT = '2026-06-04T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Logging (structured, [GEN] prefix per brief section 16). The CLI is not a pure
// module, so the real Node console is available here.
// ---------------------------------------------------------------------------

function log(message: string): void {
  console.log(`[GEN] ${message}`);
}

function fatal(message: string): never {
  console.error(`[GEN] ERROR: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/** Parse "--flag value --flag2 value2" into a string map. Bare flags (no value) map to
 *  "true". Tolerant: we want clarity/iteration speed, not a parser framework. */
function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (!tok.startsWith('--')) continue;
    const flag = tok.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out.set(flag, next);
      i++;
    } else {
      out.set(flag, 'true');
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Config building
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: LineConfig = {
  key: { tonic: { name: 'C', accidental: 'natural' }, mode: 'major' },
  timeSignature: FOUR_FOUR,
  position: makeNeckPosition(1, 6, 4, 8, 'V'),
  tempo: 90,
  barCount: 4,
  difficulty: 3,
  accidentalsDensity: 'none',
};

const ACC_GLYPH: Readonly<Record<string, Accidental>> = {
  '': 'natural',
  '#': 'sharp',
  b: 'flat',
  x: 'doubleSharp',
  bb: 'doubleFlat',
};

const NOTE_NAMES: ReadonlySet<string> = new Set([
  'C',
  'D',
  'E',
  'F',
  'G',
  'A',
  'B',
]);

/** Parse "Eb:major" / "F#:minor" / "C:major" into a Key. */
function parseKey(spec: string): Key {
  const [tonicSpec, modeSpec] = spec.split(':');
  if (tonicSpec === undefined || modeSpec === undefined) {
    fatal(`bad --key "${spec}"; expected e.g. "Eb:major" or "F#:minor"`);
  }
  const letter = tonicSpec[0]!;
  if (!NOTE_NAMES.has(letter)) fatal(`bad note name in --key "${spec}"`);
  const glyph = tonicSpec.slice(1);
  const accidental = ACC_GLYPH[glyph];
  if (accidental === undefined) fatal(`bad accidental in --key "${spec}"`);
  if (modeSpec !== 'major' && modeSpec !== 'minor') {
    fatal(`bad mode in --key "${spec}"; expected major|minor`);
  }
  return {
    tonic: { name: letter as NoteName, accidental },
    mode: modeSpec,
  };
}

/** Parse a neck position: "1-6:4-8" (strings:frets) or "4-8" (all strings, frets). */
function parsePosition(spec: string, label: string | undefined): LineConfig['position'] {
  let strings = '1-6';
  let frets = spec;
  if (spec.includes(':')) {
    const [s, f] = spec.split(':');
    strings = s!;
    frets = f!;
  }
  const [sl, sh] = strings.split('-').map((x) => Number.parseInt(x, 10));
  const [fl, fh] = frets.split('-').map((x) => Number.parseInt(x, 10));
  if (
    sl === undefined ||
    sh === undefined ||
    fl === undefined ||
    fh === undefined ||
    [sl, sh, fl, fh].some((n) => Number.isNaN(n))
  ) {
    fatal(`bad --position "${spec}"; expected "sLow-sHigh:fLow-fHigh" or "fLow-fHigh"`);
  }
  return makeNeckPosition(sl!, sh!, fl!, fh!, label);
}

function parseTimeSignature(spec: string): TimeSignature {
  switch (spec) {
    case '4/4':
      return FOUR_FOUR;
    case '3/4':
      return THREE_FOUR;
    case '6/8':
      return SIX_EIGHT;
    default:
      return fatal(`unsupported --time "${spec}"; expected 4/4, 3/4 or 6/8`);
  }
}

function parseDifficulty(spec: string): Difficulty {
  const n = Number.parseInt(spec, 10);
  if (n < 1 || n > 5 || Number.isNaN(n)) fatal(`bad --difficulty "${spec}"`);
  return n as Difficulty;
}

function parseAccidentals(spec: string): AccidentalsDensity {
  if (spec === 'none' || spec === 'low' || spec === 'medium' || spec === 'high') {
    return spec;
  }
  return fatal(`bad --accidentals "${spec}"; expected none|low|medium|high`);
}

/** Merge: DEFAULT_CONFIG < (--config file) < individual CLI flags. */
function buildConfig(args: Map<string, string>): LineConfig {
  let cfg: LineConfig = { ...DEFAULT_CONFIG };

  const configPath = args.get('config');
  if (configPath !== undefined && configPath !== 'true') {
    const raw = readFileSync(resolve(configPath), 'utf8');
    const parsed = JSON.parse(raw) as Partial<LineConfig>;
    cfg = { ...cfg, ...parsed };
  }

  if (args.has('key')) cfg.key = parseKey(args.get('key')!);
  if (args.has('time')) cfg.timeSignature = parseTimeSignature(args.get('time')!);
  if (args.has('position')) {
    cfg.position = parsePosition(args.get('position')!, args.get('label'));
  } else if (args.has('label') && cfg.position.label === undefined) {
    cfg.position = { ...cfg.position, label: args.get('label')! };
  }
  if (args.has('tempo')) cfg.tempo = Number.parseInt(args.get('tempo')!, 10);
  if (args.has('bars')) cfg.barCount = Number.parseInt(args.get('bars')!, 10);
  if (args.has('difficulty')) cfg.difficulty = parseDifficulty(args.get('difficulty')!);
  if (args.has('accidentals')) {
    cfg.accidentalsDensity = parseAccidentals(args.get('accidentals')!);
  }

  if (cfg.barCount < MIN_BAR_COUNT || cfg.barCount > MAX_BAR_COUNT) {
    fatal(`barCount ${cfg.barCount} out of range ${MIN_BAR_COUNT}..${MAX_BAR_COUNT}`);
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Telemetry aggregation
// ---------------------------------------------------------------------------

interface BatchTelemetry {
  generatorVersion: string;
  generatedAt: string;
  config: LineConfig;
  baseSeed: number;
  count: number;
  avgAttemptsPerLine: number;
  fallbackCount: number;
  fallbackRate: number;
  validatorFailureBreakdown: Record<string, number>;
  files: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function runBatch(argv: string[]): BatchTelemetry {
  const args = parseArgs(argv);

  const count = args.has('count') ? Number.parseInt(args.get('count')!, 10) : 1;
  if (Number.isNaN(count) || count < 1) fatal(`bad --count "${args.get('count')}"`);

  const outArg = args.get('out');
  if (outArg === undefined || outArg === 'true') fatal('--out <dir> is required');
  const outDir = resolve(outArg);
  mkdirSync(outDir, { recursive: true });

  const baseSeed = args.has('seed') ? Number.parseInt(args.get('seed')!, 10) : 0;
  if (Number.isNaN(baseSeed)) fatal(`bad --seed "${args.get('seed')}"`);

  const config = buildConfig(args);

  log(
    `generating ${count} line(s) | key ${config.key.tonic.name}${config.key.tonic.accidental} ${config.key.mode} | ` +
      `bars ${config.barCount} | pos ${config.position.fretRange.low}-${config.position.fretRange.high} | ` +
      `acc ${config.accidentalsDensity} | diff ${config.difficulty} | baseSeed ${baseSeed} | out ${outDir}`,
  );

  let attemptsSum = 0;
  let fallbackCount = 0;
  const validatorFailureBreakdown: Record<string, number> = {};
  const files: string[] = [];
  let generatorVersion = '';

  for (let k = 0; k < count; k++) {
    const seed = baseSeed + k;
    let telemetry: GenerationTelemetry | null = null;
    const line = generateLine(config, seed, FIXED_GENERATED_AT, {
      onTelemetry: (t) => {
        telemetry = t;
      },
    });
    generatorVersion = line.generatorVersion;

    const t = telemetry as GenerationTelemetry | null;
    if (t !== null) {
      attemptsSum += t.attemptsUsed;
      if (t.usedFallback) fallbackCount++;
      for (const f of t.failures) {
        validatorFailureBreakdown[f.validator] =
          (validatorFailureBreakdown[f.validator] ?? 0) + 1;
      }
    }

    const xml = serializeLineToMusicXML(line);
    const fallbackTag = t?.usedFallback ? '-fallback' : '';
    const fileName = `line-${String(k).padStart(4, '0')}-seed${seed}${fallbackTag}.xml`;
    writeFileSync(join(outDir, fileName), xml, 'utf8');
    files.push(fileName);
  }

  const telemetry: BatchTelemetry = {
    generatorVersion,
    generatedAt: FIXED_GENERATED_AT,
    config,
    baseSeed,
    count,
    avgAttemptsPerLine: attemptsSum / count,
    fallbackCount,
    fallbackRate: fallbackCount / count,
    validatorFailureBreakdown,
    files,
  };

  writeFileSync(
    join(outDir, 'telemetry.json'),
    JSON.stringify(telemetry, null, 2) + '\n',
    'utf8',
  );

  log(
    `done: ${count} file(s) written to ${outDir} | ` +
      `avg attempts/line ${telemetry.avgAttemptsPerLine.toFixed(2)} | ` +
      `fallbacks ${fallbackCount} (${(telemetry.fallbackRate * 100).toFixed(2)}%) | ` +
      `validator failures ${JSON.stringify(validatorFailureBreakdown)}`,
  );
  log(`telemetry summary -> ${join(outDir, 'telemetry.json')}`);

  return telemetry;
}

// Run when invoked directly (node --import tsx src/cli/generateBatch.ts ...).
// import.meta.url vs argv[1] is the idiomatic "is this the entry module?" check.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${resolve(process.argv[1])}`;
if (invokedDirectly) {
  runBatch(process.argv.slice(2));
}
