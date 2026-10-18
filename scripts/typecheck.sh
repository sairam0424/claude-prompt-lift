#!/usr/bin/env bash
# Best-effort type check of hooks/ and tests/ against the engine's own
# claude-code.d.ts. `claude plugin test` does not type-check, so this is the
# one type gate; it is a dev aid, not a test gate: with no types file on the
# machine it says so and exits 0.
#
# The engine writes the types when the plugin-authoring skill loads, under
# /private/tmp/claude-*/bundled-skills/<build>/<hash>/plugin-authoring/types/;
# the newest by mtime is this machine's current build. /private/tmp is wiped
# by a reboot, so the file can be absent until that skill loads again. A
# cached copy from an older build is the fallback, flagged STALE: an error it
# reports may be the old build's, not this code's.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundled_glob='/private/tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts'
stale_cache="$HOME/.cache/claim-verify/claude-code.d.ts"

shopt -s nullglob
candidates=( $bundled_glob )
shopt -u nullglob

dts=""
if [ "${#candidates[@]}" -gt 0 ]; then
  dts="$(ls -t "${candidates[@]}" | head -n 1)"
elif [ -f "$stale_cache" ]; then
  dts="$stale_cache"
  echo "typecheck: STALE types: no bundled claude-code.d.ts under $bundled_glob;" >&2
  echo "typecheck: falling back to $stale_cache ($(head -n 1 "$stale_cache"))." >&2
  echo "typecheck: load the plugin-authoring skill in a Claude Code session to get this build's types." >&2
else
  echo "typecheck: no claude-code.d.ts on this machine; nothing to check against (exit 0)."
  echo "typecheck: load the plugin-authoring skill in a Claude Code session, then run again."
  exit 0
fi

echo "typecheck: types $dts"
echo "typecheck: $(head -n 1 "$dts")"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The options the types file's header gives for a hooks module: no DOM lib
# (the environment has none, and its Text would shadow the element), JSX
# against the global `h` and `Fragment`. The header's recipe also sets
# noUncheckedIndexedAccess; this code does not pass that yet, so it is left
# out here.
cat > "$tmp/tsconfig.json" <<JSON
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "types": [],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  },
  "files": ["$dts"],
  "include": ["$root/hooks", "$root/types", "$root/tests"]
}
JSON

# `-p typescript@5` names the package: it ships two binaries (tsc, tsserver),
# so a bare `npx typescript@5` cannot pick one.
cd "$root"
npx -y -p typescript@5 tsc --noEmit -p "$tmp/tsconfig.json"
