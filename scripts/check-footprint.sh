#!/usr/bin/env bash
# Footprint gate: a release check that the access report `claude plugin validate`
# prints for this plugin is complete, and stays complete.
#
# Usage: bash scripts/check-footprint.sh [plugin-dir]   (default: this repo)
#
# The catalogue publisher holds any release whose report is cut: the validator
# truncates a `calls` line near 1,000 characters and marks the cut `[+N chars]`
# (0.6.0 shipped `[+106 chars]`). Engine calls therefore go through the small
# wrappers in hooks/api.ts, which keeps the line short. Three checks:
#   1. neither the text nor the --json report holds a `[+N chars]` marker;
#   2. the `register.tsx calls` line is at most MAX_CALLS characters, a cushion
#      under the validator's cap (its length is printed on every run);
#   3. no `$.<ns>.<fn>(` engine call (any namespace, with or without a `<T>`
#      type-argument list) appears in hooks/ outside hooks/api.ts and
#      hooks/register.tsx (offenders are listed). A comment must not spell one.
# Exit 0 with one summary line when all pass, 1 on any failure, 2 on misuse.
set -euo pipefail

MAX_CALLS=850
MARKER='\[\+[0-9]+ chars\]'
CALL='\$\.[a-z]+\.[a-zA-Z]+(<[^(]*>)?\('
USAGE="usage: bash scripts/check-footprint.sh [plugin-dir]"

die() {
  printf 'check-footprint: %s\n%s\n' "$1" "$USAGE" >&2
  exit 2
}
case "${1:-}" in -h | --help) echo "$USAGE" && exit 0 ;; esac
[ "$#" -le 1 ] || die "too many arguments"
command -v claude >/dev/null 2>&1 || die "the claude CLI is not on PATH"
dir="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" 2>/dev/null && pwd)" ||
  die "no such directory: ${1:-}"
cd "$dir"

failed=0
fail() {
  echo "check-footprint: FAIL: $*" >&2
  failed=1
}

# 1. No truncation marker in either report. The reports are held in variables,
# not files, so the script leaves nothing behind.
no_marker() {
  if printf '%s\n' "$2" | grep -Eq "$MARKER"; then
    fail "the $1 report is truncated:"
    printf '%s\n' "$2" | grep -Eo ".{0,60}$MARKER" | head -n 3 >&2 || true
  fi
}
text="$(claude plugin validate "$dir" 2>&1)" || fail "validate (text) exited non-zero"
json="$(claude plugin validate "$dir" --json 2>&1)" || fail "validate (--json) exited non-zero"
no_marker text "$text"
no_marker json "$json"

# 2. The calls line: the text after `calls: `. Absent is a fail, so a changed
# report format cannot read as a pass.
calls="$(printf '%s\n' "$text" | grep -E 'register\.tsx calls: ' | head -n 1 || true)"
body="${calls#*calls: }"
length="${#body}"
if [ -z "$calls" ]; then
  fail "no 'register.tsx calls' line in the validate report"
else
  echo "check-footprint: register.tsx calls line: $length characters (limit $MAX_CALLS)"
  [ "$length" -le "$MAX_CALLS" ] || fail "the calls line is $length characters, over $MAX_CALLS"
fi

# 3. Engine calls only in api.ts and register.tsx. grep exits 1 for no match
# (fine) and 2 on an error (a fail).
status=0
found="$(grep -rnE "$CALL" hooks)" || status=$?
[ "$status" -le 1 ] || fail "the engine-call scan could not run (grep exit $status)"
offenders="$(printf '%s\n' "$found" | grep -vE '^hooks/(api\.ts|register\.tsx):' || true)"
if [ -n "$offenders" ]; then
  fail "engine calls outside hooks/api.ts and hooks/register.tsx (add a wrapper to api.ts):"
  printf '%s\n' "$offenders" >&2
fi

[ "$failed" -eq 0 ] || exit 1
echo "check-footprint: OK: reports complete, calls line $length/$MAX_CALLS, engine calls only in api.ts and register.tsx"
