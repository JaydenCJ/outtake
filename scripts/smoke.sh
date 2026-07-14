#!/usr/bin/env bash
# Smoke test for outtake: exercises the real CLI end to end against a
# generated sample Takeout export and a hand-made extracted tree. No
# network, idempotent, runs from a clean checkout (after `npm install`).
# Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents the surface.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in scan plan products --format --only --dest --strict --top; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Error handling: usage and unreadable inputs exit 2.
set +e
$CLI --frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI scan "$WORKDIR/nope.zip" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing file should exit 2"; }
printf 'not an archive' > "$WORKDIR/notes.txt"
$CLI scan "$WORKDIR/notes.txt" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "non-archive should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

# 4. Generate the bundled two-part sample export.
node examples/make-sample.mjs "$WORKDIR/sample" >/dev/null || fail "make-sample.mjs failed"
PART1="$WORKDIR/sample/takeout-20260412T081523Z-001.zip"
PART2="$WORKDIR/sample/takeout-20260412T081523Z-002.zip"
[ -f "$PART1" ] && [ -f "$PART2" ] || fail "sample parts not created"
echo "[smoke] sample export generated"

# 5. Scan the set: products, set detection, sizes, next steps.
SCAN_OUT="$($CLI scan "$PART1" "$PART2")" || fail "scan should exit 0"
echo "$SCAN_OUT" | grep -q 'Archive set 20260412T081523Z' || fail "set detection missing"
echo "$SCAN_OUT" | grep -q '22 files' || fail "file total wrong"
for product in 'Google Photos' 'Mail' 'Drive' 'YouTube and YouTube Music' 'Timeline' '(Takeout root)'; do
  echo "$SCAN_OUT" | grep -qF "$product" || fail "scan missing product $product"
done
echo "$SCAN_OUT" | grep -q 'Next steps' || fail "next steps section missing"
echo "$SCAN_OUT" | grep -q 'Thunderbird' || fail "Mail tooling suggestion missing"
echo "[smoke] scan ok (10 products, set detected)"

# 6. JSON output is valid and schema-tagged.
$CLI scan "$PART1" "$PART2" --format json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.schema!=='outtake/scan@1')throw new Error('bad schema');if(j.totals.files!==22)throw new Error('bad totals')})" \
  || fail "scan --format json invalid"
echo "[smoke] scan JSON ok"

# 7. A missing part is detected; --strict turns it into exit 1.
cp "$PART2" "$WORKDIR/sample/takeout-20260412T081523Z-004.zip"
GAP_OUT="$($CLI scan "$PART1" "$WORKDIR/sample/takeout-20260412T081523Z-004.zip")" || fail "gap scan should exit 0 without --strict"
echo "$GAP_OUT" | grep -q 'missing-part' || fail "missing part not reported"
set +e
$CLI scan "$PART1" "$WORKDIR/sample/takeout-20260412T081523Z-004.zip" --strict >/dev/null; STRICT_CODE=$?
set -e
[ "$STRICT_CODE" -eq 1 ] || fail "--strict should exit 1 on issues, got $STRICT_CODE"
echo "[smoke] missing-part detection + --strict ok"

# 8. Extraction plan: per-source commands, next steps, bad selection exits 2.
PLAN_OUT="$($CLI plan "$PART1" "$PART2" --only photos,mail --dest "$WORKDIR/out")" || fail "plan should exit 0"
echo "$PLAN_OUT" | grep -qF "unzip -n '$PART1' 'Takeout/Google Photos/*'" || fail "plan unzip command wrong"
echo "$PLAN_OUT" | grep -q 'Extract Mail' || fail "plan missing Mail step"
echo "$PLAN_OUT" | grep -q 'Verify the extraction' || fail "plan missing verify step"
set +e
$CLI plan "$PART1" --only frobnicator >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown --only should exit 2"; }
set -e
echo "[smoke] plan ok"

# 9. Scanning an extracted tree (no Takeout/ root) works too.
mkdir -p "$WORKDIR/tree/Mail" "$WORKDIR/tree/Keep"
printf 'From a\n' > "$WORKDIR/tree/Mail/All mail Including Spam and Trash.mbox"
printf '{}' > "$WORKDIR/tree/Keep/note.json"
TREE_OUT="$($CLI scan "$WORKDIR/tree")" || fail "dir scan should exit 0"
echo "$TREE_OUT" | grep -q 'Mail' || fail "dir scan missing Mail"
echo "$TREE_OUT" | grep -q 'Keep' || fail "dir scan missing Keep"
echo "[smoke] extracted-tree scan ok"

# 10. Product catalog: table, detail card, JSON.
RULES_COUNT="$($CLI products | tail -n +2 | wc -l)"
[ "$RULES_COUNT" -ge 25 ] || fail "products catalog too small: $RULES_COUNT"
$CLI products mail | grep -q 'Thunderbird' || fail "products mail card wrong"
$CLI products --format json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.products.length<25)throw new Error('too few')})" \
  || fail "products --format json invalid"
echo "[smoke] products catalog ok ($RULES_COUNT products)"

# 11. Determinism: two runs over the same input are byte-identical.
$CLI scan "$PART1" "$PART2" > "$WORKDIR/run1.txt"
$CLI scan "$PART1" "$PART2" > "$WORKDIR/run2.txt"
cmp -s "$WORKDIR/run1.txt" "$WORKDIR/run2.txt" || fail "repeat runs differ"
echo "[smoke] determinism ok"

echo "SMOKE OK"
