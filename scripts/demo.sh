#!/usr/bin/env bash
# Record the README demo: a real Claude Code session in a throwaway sandbox,
# driven key by key inside an isolated tmux server, recorded with asciinema and
# converted to a GIF with agg. From the repo root:
#   bash scripts/demo.sh --plugin-dir "$PWD" [--out-dir docs] [--shots-dir DIR]
# The take costs one real Enhance call (about $0.01 to $0.20 on a 10k-token
# static block). It never presses Send and never submits free text: the only
# thing entered is the in-process `/prompt-lift status` command.
set -euo pipefail

readonly COLS=110 ROWS=30                 # also the GIF grid; keep both tmux servers equal
readonly DEMO_SOCKET=pldemo REC_SOCKET=plrec SESSION=w REC_SESSION=rec
# Vague on purpose but not tiny: the growth guard allows n + min(1200, 150 + 3n)
# characters, and a 17-character draft got a paid "rewrite too long" refusal.
readonly DRAFT="fix the flaky test that fails every few CI runs"
readonly STATUS_CMD="/prompt-lift status"
readonly TRUST_TIMEOUT_S=60 BAND_TIMEOUT_S=120 ENHANCE_TIMEOUT_S=120 STEP_TIMEOUT_S=20
readonly SETTLE_S=3 IDLE_PAUSE_S=2 READ_PAUSE_S=4 END_PAUSE_S=5 TYPE_DELAY_S=0.07
readonly POLL_S=0.5 BACKSPACES=400 CAST_IDLE_LIMIT_S=2 GIF_LIMIT_BYTES=1048576 FONT_SIZE=14
# A nested session must not inherit the parent session's identity variables.
readonly PARENT_SESSION_VARS=(CLAUDECODE CLAUDE_CODE_SESSION_ID CLAUDE_CODE_MESSAGING_SOCKET
  CLAUDE_CODE_MESSAGING_TOKEN CLAUDE_CODE_CHILD_SESSION CLAUDE_PID CLAUDE_CODE_ENTRYPOINT
  CLAUDE_CODE_SESSION_ATTENDED)

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PLUGIN_DIR="" OUT_DIR="$REPO/docs" SHOTS_DIR="" WORK="" CAST="" GIF="" DEMO_STARTED="" REC_STARTED=""

die() { echo "demo.sh: $*" >&2; exit 1; }
tm() { tmux -L "$DEMO_SOCKET" "$@"; }
rec() { tmux -L "$REC_SOCKET" "$@"; }
pane() { tm capture-pane -p -t "$SESSION"; }

cleanup() {
  # Only what THIS run started: the flags are set after our own new-session, so a refused run kills nothing.
  [ -z "$DEMO_STARTED" ] || tm kill-server 2>/dev/null || true
  [ -z "$REC_STARTED" ] || rec kill-server 2>/dev/null || true
  if [[ -n "$WORK" && "$WORK" == /tmp/pl-demo.* ]]; then rm -rf -- "$WORK"; fi
}
trap cleanup EXIT; trap 'exit 130' INT TERM

# --- arguments and preflight ----------------------------------------------
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --plugin-dir) PLUGIN_DIR="${2:?--plugin-dir needs a path}"; shift 2 ;;
      --out-dir) OUT_DIR="${2:?--out-dir needs a path}"; shift 2 ;;
      --shots-dir) SHOTS_DIR="${2:?--shots-dir needs a path}"; shift 2 ;;
      -h | --help) sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
}

# The recording must load this checkout, never the live install: refuse any
# --plugin-dir that is not the repo this script lives in.
preflight() {
  [ -n "$PLUGIN_DIR" ] || die "--plugin-dir is required (use --plugin-dir \"\$PWD\" from the repo root)"
  local resolved
  resolved="$(cd "$PLUGIN_DIR" 2>/dev/null && pwd -P)" || die "no such directory: $PLUGIN_DIR"
  [ "$resolved" = "$REPO" ] || die "--plugin-dir must be $REPO (got $resolved); refusing so the live install is never recorded"
  [ -f "$REPO/.claude-plugin/plugin.json" ] || die "$REPO has no .claude-plugin/plugin.json"
  local tool
  for tool in tmux asciinema agg claude python3 git jq; do
    command -v "$tool" >/dev/null || die "missing tool: $tool (agg: brew install agg)"
  done
  { ! tm has-session 2>/dev/null && ! rec has-session 2>/dev/null; } ||
    die "a tmux server named $DEMO_SOCKET or $REC_SOCKET already runs; stop it first"
  mkdir -p "$OUT_DIR" ${SHOTS_DIR:+"$SHOTS_DIR"}
}

build_sandbox() {
  WORK="$(mktemp -d /tmp/pl-demo.XXXX)"
  CAST="$WORK/demo.cast" GIF="$WORK/demo.gif" # record and convert here: OUT_DIR is touched only by a full pass
  local project="$WORK/project"
  mkdir -p "$project/src"
  (cd "$project" && git init -q)
  cat >"$project/CLAUDE.md" <<'EOF'
# Orders service
Conventions for this repo (synthetic demo project).
- TypeScript strict mode, no `any`.
- Tests live in `tests/` and run with `npm test` (vitest).
- Time-dependent tests use fake timers, never real sleeps.
- Money is integer cents; format only at the edge.
- Commits follow conventional commits (feat, fix, chore).
- Keep functions under 40 lines; prefer early returns.
- Errors carry a stable `code` string, never just a message.
- No new dependencies without a note in the PR.
EOF
  cat >"$project/src/orders.ts" <<'EOF'
export function totalCents(lines: { cents: number; qty: number }[]): number {
  return lines.reduce((sum, line) => sum + line.cents * line.qty, 0);
}
EOF
  # Session-only overlay: the live install and other above-prompt mods stay out (the
  # engine draws ONE band) and a neutral status line keeps the account name off screen.
  cat >"$WORK/settings.json" <<'EOF'
{
  "enabledPlugins": {
    "prompt-master@claude-prompt-master": false,
    "prompt-lift@claude-prompt-lift": false,
    "token-weather@claude-code-playground-mods": false,
    "blast-radius@claude-code-playground-mods": false,
    "replay-theater@claude-code-playground-mods": false
  },
  "statusLine": { "type": "command", "command": "jq -r '.model.display_name'" }
}
EOF
  # No status bar (eats a row, shrinks the window); focus events and mouse on, else hint lines print.
  printf '%s\n' 'set -g status off' 'set -g focus-events on' 'set -g mouse on' \
    'set -g default-terminal "tmux-256color"' 'set -ga terminal-features ",*:RGB"' >"$WORK/tmux.conf"
}

screen_has() { local s; s="$(pane)"; grep -Eq -- "$1" <<<"$s"; }
dump_pane() { echo "--- screen at failure ---" >&2; pane >&2 || true; }
# wait_until <label> <timeout_s> <command...>: poll instead of sleeping blind.
wait_until() {
  local label="$1" limit="$2"; shift 2
  local deadline=$((SECONDS + limit))
  until "$@"; do
    tm has-session -t "$SESSION" 2>/dev/null || die "$label: the claude session exited"
    if [ "$SECONDS" -ge "$deadline" ]; then dump_pane; die "$label: not seen within ${limit}s"; fi
    sleep "$POLL_S"
  done
}

# Keystrokes one at a time so the cast shows typing.
type_text() {
  local text="$1" i
  for ((i = 0; i < ${#text}; i++)); do
    tm send-keys -t "$SESSION" -l -- "${text:i:1}"
    sleep "$TYPE_DELAY_S"
  done
}

# True when the prompt box holds exactly <text> (and nothing else): the last
# prompt line equals it and a rule line follows (no second draft line). The
# engine puts a no-break space after the glyph, so fold it to a plain one.
box_is_exactly() {
  local nbsp=$'\xc2\xa0' two first second
  two="$(pane | grep -A1 '^❯' | tail -n 2)"
  first="${two%%$'\n'*}" second="${two#*$'\n'}"
  first="${first#❯}" first="${first//$nbsp/ }" first="${first# }"
  first="${first%"${first##*[![:space:]]}"}"
  [[ "$first" == "$1" && "$second" == ─* ]]
}

snap() { [ -z "$SHOTS_DIR" ] || pane >"$SHOTS_DIR/$1.txt"; }
size_of() { wc -c <"$1" | tr -d ' '; }

# --- the session -----------------------------------------------------------
start_session() {
  local unset_flags="" var
  for var in "${PARENT_SESSION_VARS[@]}"; do unset_flags+=" -u $var"; done
  tm -f "$WORK/tmux.conf" new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS" -c "$WORK/project" \
    "env$unset_flags claude --strict-mcp-config --plugin-dir $(printf %q "$PLUGIN_DIR") --settings $(printf %q "$WORK/settings.json")"
  DEMO_STARTED=1
  wait_until "trust prompt" "$TRUST_TIMEOUT_S" screen_has 'Yes, I trust this folder'
  sleep "$SETTLE_S" # a key sent before the menu takes input is lost, and Enter would pick "No, exit"
  tm send-keys -t "$SESSION" Down
  wait_until "trust choice" "$STEP_TIMEOUT_S" screen_has '❯.{1,2}Yes, I trust'
  tm send-keys -t "$SESSION" Enter # the folder-trust menu, not free text
  wait_until "idle band" "$BAND_TIMEOUT_S" screen_has 'Enhance \(e\)'
  sleep "$SETTLE_S"
  local bands; bands="$(pane | grep -c 'Enhance (e)' || true)"
  [ "$bands" = 1 ] || { dump_pane; die "expected exactly one band, saw $bands (another mod draws one?)"; }
  screen_has 'Enhance \(e\).*prompt-lift:' || { dump_pane; die "the band is not prompt-lift's"; }
}

start_recorder() {
  # env -u TMUX: tmux refuses to attach from inside another tmux otherwise.
  rec -f "$WORK/tmux.conf" new-session -d -s "$REC_SESSION" -x "$COLS" -y "$ROWS" \
    "asciinema rec -q --idle-time-limit $CAST_IDLE_LIMIT_S -t 'prompt-lift demo' -c 'env -u TMUX tmux -L $DEMO_SOCKET attach -t $SESSION' $(printf %q "$CAST")"
  REC_STARTED=1
  wait_until "recorder attached" "$STEP_TIMEOUT_S" rec_shows_band
  local size; size="$(tm display-message -p -t "$SESSION" '#{window_width}x#{window_height}')"
  [ "$size" = "${COLS}x${ROWS}" ] || die "window is $size, expected ${COLS}x${ROWS}; the recorder shrank it"
}
rec_shows_band() { local s; s="$(rec capture-pane -p -t "$REC_SESSION")"; grep -Fq 'Enhance (e)' <<<"$s"; }
recorder_gone() { ! rec has-session -t "$REC_SESSION" 2>/dev/null; }

# --- the take --------------------------------------------------------------
# Order: idle band, draft, Enhance, done row, Undo, Redo, status.
drive() {
  sleep "$IDLE_PAUSE_S"; snap 1-idle
  type_text "$DRAFT"; sleep 1.5
  box_is_exactly "$DRAFT" || { dump_pane; die "the box does not hold the draft"; }
  snap 2-draft
  tm send-keys -t "$SESSION" C-x b # Enhance, from the prompt
  wait_until "enhance running" "$STEP_TIMEOUT_S" screen_has 'Cancel \(c\)'
  sleep 1; snap 3-running
  wait_until "done row" "$ENHANCE_TIMEOUT_S" enhance_settled
  sleep "$READ_PAUSE_S"; snap 4-done
  band_key u 'Redo \(u\)'; sleep "$READ_PAUSE_S"; snap 5-undone
  band_key u 'Undo \(u\)'; sleep "$READ_PAUSE_S"; snap 6-redone

  # Typing into a non-empty box appends, so empty it before the slash command.
  tm send-keys -t "$SESSION" -N "$BACKSPACES" BSpace
  wait_until "empty box" "$STEP_TIMEOUT_S" box_is_exactly ""
  type_text "$STATUS_CMD"; sleep 1
  submit_status
  wait_until "status output" "$STEP_TIMEOUT_S" screen_has 'chain:'
  sleep "$END_PAUSE_S"; snap 7-status
}

# Done row up: success. Cancel gone with no done row: the press ended without a
# rewrite (a guard refused it, or the chain failed), and its toast is still up.
enhance_settled() {
  local s; s="$(pane)" # one capture: the row can flip between two
  grep -Eq 'Send \(s\).*\$[0-9]+\.[0-9]+' <<<"$s" && return 0
  grep -Eq 'Cancel \(c\)' <<<"$s" || { echo "$s" >&2; die "Enhance ended without a rewrite; the toast above says why"; }
  return 1
}

# Focus the band, press a hotkey, wait for the button label to flip.
band_key() {
  tm send-keys -t "$SESSION" C-x Tab
  sleep 0.5
  tm send-keys -t "$SESSION" "$1"
  wait_until "band key $1" "$STEP_TIMEOUT_S" screen_has "$2"
}

# The only Enter on prompt text in this script, and only for the status
# command: a submitted free-text turn costs real money.
submit_status() {
  box_is_exactly "$STATUS_CMD" || { dump_pane; die "refusing Enter: the box is not exactly $STATUS_CMD"; }
  tm send-keys -t "$SESSION" Enter
}

stop_recorder() {
  tm detach-client -s "$SESSION"
  wait_until "recorder exit" "$STEP_TIMEOUT_S" recorder_gone
}

# Drop the tmux client's tear-down (screen clear and "[detached ...]") from the
# end of the cast, then swap the account name and home path for same-length
# placeholders (status lists ~/.claude/rules files) so the layout is unchanged.
sanitize() {
  python3 -I - "$HOME" "$(id -un)" "$@" <<'PY'
import json, sys
home, user, paths = sys.argv[1], sys.argv[2], sys.argv[3:]
TEARDOWN_WINDOW_S = 0.25
def pad(seed, n): return (seed + "_" * n)[:n]
fake_home, fake_user = pad("/Users/developer", len(home)), pad("developer", len(user))
for path in paths:
    with open(path, encoding="utf-8") as fh:
        lines = fh.readlines()
    if path.endswith(".cast"):
        times = [json.loads(line)[0] for line in lines[1:]]
        keep = len(times)
        while keep > 1 and times[keep - 1] >= times[-1] - TEARDOWN_WINDOW_S:
            keep -= 1
        if not any("[?1049l" in json.loads(line)[2] for line in lines[1 + keep:]):
            sys.exit("sanitize: no tmux tear-down at the end of the cast")
        lines = lines[: 1 + keep]
    text = "".join(lines).replace(home, fake_home).replace(user, fake_user)
    text = text.replace("\u00a0", " ")  # agg draws no-break spaces as stray glyphs
    if home in text or user in text:
        sys.exit(f"sanitize: {path} still names the account")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
PY
}

# Try gentler settings until the GIF fits under the limit.
convert() {
  local speed fps size
  for speed_fps in "1 20" "1.25 20" "1.25 12" "1.5 12"; do
    read -r speed fps <<<"$speed_fps"
    agg -q --font-size "$FONT_SIZE" --speed "$speed" --fps-cap "$fps" \
      --idle-time-limit "$CAST_IDLE_LIMIT_S" --last-frame-duration "$END_PAUSE_S" "$CAST" "$GIF"
    size="$(size_of "$GIF")"
    echo "demo.sh: agg --speed $speed --fps-cap $fps -> $size bytes"
    [ "$size" -lt "$GIF_LIMIT_BYTES" ] && return 0
  done
  echo "demo.sh: WARNING: the GIF is over 1 MiB; commit only the cast" >&2
}

check_cast() {
  local want
  for want in 'Enhance' 'Undo' 'Redo' 'restored your draft' '[$]0[.]' 'chain:'; do
    grep -Eq -- "$want" "$CAST" || die "the cast never shows: $want"
  done
}

main() {
  parse_args "$@"
  preflight
  build_sandbox
  start_session
  start_recorder
  drive
  stop_recorder
  sanitize "$CAST"; [ -z "$SHOTS_DIR" ] || sanitize "$SHOTS_DIR"/*.txt
  check_cast
  convert
  mv -f -- "$CAST" "$GIF" "$OUT_DIR/"
  echo "demo.sh: wrote $OUT_DIR/demo.cast ($(size_of "$OUT_DIR/demo.cast") bytes) and $OUT_DIR/demo.gif ($(size_of "$OUT_DIR/demo.gif") bytes)"
}

[[ "${BASH_SOURCE[0]}" != "$0" ]] || main "$@" # sourced by a test: define, do not record
