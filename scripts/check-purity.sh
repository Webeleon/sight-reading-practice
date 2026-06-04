#!/usr/bin/env bash
# Purity / discipline checks for the pure modules.
# Exits 1 and prints what it found on any violation. The tsconfig.pure.json no-DOM-lib
# trick already turns most DOM/React references into compile errors; this is the
# cheap, fast, always-runnable backstop (and the only guard against Math.random()
# and ": any", which the compiler does not flag).
#
# Written to run under macOS's stock bash 3.2 (no `mapfile`, no associative arrays).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

# Pure modules: MUST NOT touch electron/react/react-dom or DOM globals.
PURE_DIRS="src/domain src/fretboard src/content src/generator src/musicxml src/evaluation"
# Seeded-randomness-only modules: Math.random() is banned.
SEEDED_DIRS="src/generator src/content"
# No-any modules.
NOANY_DIRS="src/domain src/generator src/evaluation src/persistence"

fail=0

# Echo back only the dirs that exist, so grep over a missing dir is never a "failure".
existing() {
  local out=""
  local d
  for d in $1; do
    [ -d "$d" ] && out="$out $d"
  done
  echo "$out"
}

report() {
  # $1 = human description, $2 = grep output
  echo "PURITY VIOLATION: $1" >&2
  echo "$2" >&2
  echo >&2
  fail=1
}

PURE_EXIST="$(existing "$PURE_DIRS")"
SEEDED_EXIST="$(existing "$SEEDED_DIRS")"
NOANY_EXIST="$(existing "$NOANY_DIRS")"

# 1. imports of electron / react / react-dom in pure dirs.
if [ -n "$PURE_EXIST" ]; then
  hits="$(grep -rnE "from[[:space:]]+['\"](electron|react|react-dom)['\"]|require\(['\"](electron|react|react-dom)['\"]\)|import\(['\"](electron|react|react-dom)['\"]\)" \
    --include='*.ts' --include='*.tsx' $PURE_EXIST 2>/dev/null)"
  [ -n "$hits" ] && report "electron/react/react-dom imported in a pure module" "$hits"

  # 2. DOM globals in pure dirs (word-boundary to avoid e.g. a 'documentation' identifier).
  domhits="$(grep -rnwE "document|window|navigator" \
    --include='*.ts' --include='*.tsx' $PURE_EXIST 2>/dev/null)"
  [ -n "$domhits" ] && report "DOM global (document/window/navigator) used in a pure module" "$domhits"
fi

# 3. Math.random() in seeded dirs.
if [ -n "$SEEDED_EXIST" ]; then
  randhits="$(grep -rnF "Math.random" --include='*.ts' $SEEDED_EXIST 2>/dev/null)"
  [ -n "$randhits" ] && report "Math.random() used where only seeded PRNG is allowed" "$randhits"
fi

# 4. ": any" annotation in the no-any dirs.
if [ -n "$NOANY_EXIST" ]; then
  anyhits="$(grep -rnE ":[[:space:]]*any\b" --include='*.ts' --include='*.tsx' $NOANY_EXIST 2>/dev/null)"
  [ -n "$anyhits" ] && report "\": any\" annotation found in a no-any module" "$anyhits"
fi

if [ "$fail" -ne 0 ]; then
  echo "verify:purity FAILED" >&2
  exit 1
fi

echo "verify:purity OK (no violations found)"
exit 0
