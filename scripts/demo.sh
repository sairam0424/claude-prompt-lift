#!/usr/bin/env bash
# Record the README demo: a real Claude Code session in a throwaway sandbox,
# driven key by key inside an isolated tmux server, recorded with asciinema and
# converted to a GIF with agg. From the repo root:
#   bash scripts/demo.sh --plugin-dir "$PWD" [--out-dir docs] [--shots-dir DIR] [--dry-run] [--theme light|dark]
# The session runs under an isolated HOME ($WORK/home): one rules file
# (.claude/rules/testing.md), a settings.json with the status line only (plus, on
# Bedrock, the README's full-model-id pin so the done row shows dollars), a seeded
# .claude.json (no onboarding screen), and a symlink to the real ~/.aws so SSO
# caches still resolve. Provider variables (CLAUDE_CODE_USE_BEDROCK, AWS_REGION,
# ANTHROPIC_DEFAULT_*_MODEL and the other names in PROVIDER_VARS) are copied by
# name from the real ~/.claude/settings.json env and the parent environment;
# values are never printed. The take shows no provider text and no update notice:
# DISABLE_AUTOUPDATER=1 keeps the engine from installing an update mid-take, on
# Bedrock the session starts on the first pinned model id (the banner names the model
# the mod calls), and sanitize blanks ` · Amazon Bedrock` and refuses any provider or
# update text left; every shot for --shots-dir is sanitised as it is taken, so a run that
# dies leaves no raw capture there. --dry-run stops after the idle band and
# `/prompt-lift status` and checks the sandbox, including that the chain is priced
# (no `aliases: unpriced` row): no model call, $0, docs/ untouched. --theme seeds
# the sandbox's theme (default dark); with --shots-dir the dry run also writes
# 1-idle.txt, the idle band as plain text, and band-sgr.txt, the same screen with
# its colour codes (tmux capture-pane -e), so the band's theme colours can be
# checked on both themes for free.
# The take costs one real Enhance call (about $0.01 to $0.20 on a 10k-token
# static block). It never presses Send and never submits free text: the only
# thing entered is the in-process `/prompt-lift status` command.
# The screen and cast readers (and the sanitiser) live in scripts/demo-rows.sh.
set -euo pipefail

# Captured first: the session runs under a sandbox HOME, so the settings env, the
# .aws symlink and the sanitiser all name the real one through this.
readonly REAL_HOME="$HOME"
readonly COLS=110 ROWS=30                 # also the GIF grid; keep both tmux servers equal
readonly DEMO_SOCKET=pldemo REC_SOCKET=plrec SESSION=w REC_SESSION=rec
# The mod's own first example, vague on purpose. The growth guard allows
# n + min(1200, max(400, 150 + 3n)) characters (417 for these 17), so even a
# one-line draft can grow into a full rewrite.
readonly DRAFT="fix the login bug"
readonly STATUS_CMD="/prompt-lift status"
readonly TRUST_TIMEOUT_S=60 BAND_TIMEOUT_S=120 ENHANCE_TIMEOUT_S=120 STEP_TIMEOUT_S=20
readonly SETTLE_S=3 IDLE_PAUSE_S=2 READ_PAUSE_S=4 END_PAUSE_S=5 TYPE_DELAY_S=0.07
readonly POLL_S=0.5 BACKSPACES=400 CAST_IDLE_LIMIT_S=2 GIF_LIMIT_BYTES=1048576 FONT_SIZE=14
# Frame-readability waits, not synchronisation (wait_until does that).
readonly TYPE_SETTLE_S=1.5 STEP_PAUSE_S=1 FOCUS_SETTLE_S=0.5
# A nested session must not inherit the parent session's identity variables, nor
# a config dir that would bypass the sandbox HOME.
readonly PARENT_SESSION_VARS=(CLAUDECODE CLAUDE_CODE_SESSION_ID CLAUDE_CODE_MESSAGING_SOCKET
  CLAUDE_CODE_MESSAGING_TOKEN CLAUDE_CODE_CHILD_SESSION CLAUDE_PID CLAUDE_CODE_ENTRYPOINT
  CLAUDE_CODE_SESSION_ATTENDED CLAUDE_CONFIG_DIR)
# The only names read from the real ~/.claude/settings.json env (and from this
# process's environment): a fresh HOME has no settings, so the provider login must
# be handed over by name. Nothing else in that file is ever read.
readonly PROVIDER_VARS=(CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX AWS_REGION AWS_DEFAULT_REGION
  AWS_PROFILE ANTHROPIC_DEFAULT_FABLE_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL
  ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_SMALL_FAST_MODEL)
# On Bedrock a default alias chain is unpriced (`$?`, R19), so the done row would show no
# dollars. The sandbox then pins the README's "Bedrock users" ids (the ones the cost
# table prices) for the plugin id the engine gives a --plugin-dir load.
readonly PLUGIN_ID='prompt-lift@inline'
readonly BEDROCK_MODELS='us.anthropic.claude-fable-5-1,us.anthropic.claude-sonnet-5-5,us.anthropic.claude-haiku-5-5'
readonly BEDROCK_EFFORT_MODELS='us.anthropic.claude-fable-5-1,us.anthropic.claude-sonnet-5-5'
# The sandbox's one rules file: what `status` lists and the rewrite is written from.
readonly RULES_LINES=('A bug fix starts with a regression test that reproduces the bug.'
  'Cover the error path, not only the happy path.')

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=/dev/null
source "$REPO/scripts/demo-rows.sh" # the screen and cast readers
PLUGIN_DIR="" OUT_DIR="$REPO/docs" SHOTS_DIR="" WORK="" CAST="" GIF="" DEMO_STARTED="" REC_STARTED="" KEEP_WORK="" DRY_RUN="" THEME="dark"
SESSION_ENV=() # NAME=value words for the session: never echoed, logged or written to a file

die() { echo "demo.sh: $*" >&2; exit 1; }
tm() { tmux -L "$DEMO_SOCKET" "$@"; }
rec() { tmux -L "$REC_SOCKET" "$@"; }
pane() { tm capture-pane -p -t "$SESSION"; }
pane_sgr() { tm capture-pane -p -e -t "$SESSION"; } # with the colour codes (SGR) kept

cleanup() {
  # Only what THIS run started: the flags are set after our own new-session, so a refused run kills nothing.
  [ -z "$DEMO_STARTED" ] || tm kill-server 2>/dev/null || true
  [ -z "$REC_STARTED" ] || rec kill-server 2>/dev/null || true
  if [[ -z "$KEEP_WORK" && -n "$WORK" && "$WORK" == /tmp/pl-demo.* ]]; then
    rm -f -- "$WORK/home/.aws" # the symlink to the real ~/.aws goes first; rm -r would not follow it either
    rm -rf -- "$WORK"
  fi
}
trap cleanup EXIT; trap 'exit 130' INT TERM

# --- arguments and preflight ----------------------------------------------
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --plugin-dir) PLUGIN_DIR="${2:?--plugin-dir needs a path}"; shift 2 ;;
      --out-dir) OUT_DIR="${2:?--out-dir needs a path}"; shift 2 ;;
      --shots-dir) SHOTS_DIR="${2:?--shots-dir needs a path}"; shift 2 ;;
      --dry-run) DRY_RUN=1; shift ;;
      --theme)
        THEME="${2:?--theme needs light or dark}"
        case "$THEME" in light | dark) ;; *) die "--theme must be light or dark (got $THEME)" ;; esac
        shift 2 ;;
      -h | --help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"; exit 0 ;;
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
  if [ -z "$DRY_RUN" ]; then mkdir -p "$OUT_DIR" || die "cannot create $OUT_DIR"; fi # a dry run never touches it
  [ -z "$SHOTS_DIR" ] || mkdir -p "$SHOTS_DIR" || die "cannot create $SHOTS_DIR"
}

build_sandbox() {
  WORK="$(mktemp -d /tmp/pl-demo.XXXX)"
  CAST="$WORK/demo.cast" GIF="$WORK/demo.gif" # record and convert here: OUT_DIR is touched only by a full pass
  local project="$WORK/project"
  mkdir -p "$project/src" "$WORK/home/.claude/rules"
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
  collect_session_env
  write_settings
  build_home
  # No status bar (eats a row, shrinks the window); focus events and mouse on, else hint lines print.
  printf '%s\n' 'set -g status off' 'set -g focus-events on' 'set -g mouse on' \
    'set -g default-terminal "tmux-256color"' 'set -ga terminal-features ",*:RGB"' >"$WORK/tmux.conf"
}

# Bedrock only as the engine reads the variable: 1, true, yes or on, in any case. A set
# CLAUDE_CODE_USE_BEDROCK=0 (or false, no, off) is off, and pinning ids for it would be wrong.
uses_bedrock() {
  local word value
  for word in "${SESSION_ENV[@]}"; do
    [[ "$word" == CLAUDE_CODE_USE_BEDROCK=* ]] || continue
    value="$(tr '[:upper:]' '[:lower:]' <<<"${word#*=}")"
    case "$value" in 1 | true | yes | on) return 0 ;; esac
  done
  return 1
}

# Session-only overlay (--settings) and the sandbox user settings: a neutral status line
# keeps the account name off screen. No enabledPlugins rows: the sandbox HOME has no
# plugins, so the live install and other above-prompt mods cannot draw a band (the
# engine draws ONE); the checkout loads through --plugin-dir. On Bedrock, the model pin.
write_settings() {
  local status_command="jq -r '.model.display_name'" pins='{}'
  if uses_bedrock; then
    pins="$(jq -n --arg id "$PLUGIN_ID" --arg models "$BEDROCK_MODELS" --arg effort "$BEDROCK_EFFORT_MODELS" \
      '{pluginConfigs: {($id): {options: {models: $models, effortModels: $effort}}}}')"
  fi
  jq -n --arg command "$status_command" --argjson pins "$pins" \
    '{statusLine: {type: "command", command: $command}} + $pins' >"$WORK/settings.json"
}

# The session's HOME: what the engine reads instead of the author's ~/.claude, so the
# recording shows one rules file and the bundled skills, not a personal setup.
build_home() {
  local home="$WORK/home" version
  cp -- "$WORK/settings.json" "$home/.claude/settings.json"
  { echo '# Testing'; printf '%s\n' "${RULES_LINES[@]}"; } >"$home/.claude/rules/testing.md"
  version="$(claude --version)"
  version="${version%% *}" # "2.1.304 (Claude Code)" -> 2.1.304
  [[ "$version" =~ ^[0-9]+[.][0-9]+[.][0-9]+ ]] || die "cannot read the claude version (got: ${version:-nothing})"
  # hasCompletedOnboarding + lastOnboardingVersion keep the welcome screens away; the
  # folder-trust menu is per project and stays (start_session answers it).
  jq -n --arg version "$version" --arg theme "$THEME" \
    '{hasCompletedOnboarding: true, lastOnboardingVersion: $version, theme: $theme}' >"$home/.claude.json"
  # SSO caches and config resolve from $HOME/.aws; the link is read through, never written by this script.
  if [ -d "$REAL_HOME/.aws" ]; then ln -s "$REAL_HOME/.aws" "$home/.aws"; fi
}

# SESSION_ENV <- HOME, the engine's auto-update switch, plus each PROVIDER_VARS name found in
# this process's environment or, failing that, in the real ~/.claude/settings.json env.
# Values stay in the array. DISABLE_AUTOUPDATER=1: an engine that updates itself mid-take
# prints "Update installed" into the recording.
# HOME is the physical path: the engine reports /private/tmp/... for /tmp/..., and the
# mod recognises ~/.claude/rules files by their textual prefix under HOME.
collect_session_env() {
  local settings="$REAL_HOME/.claude/settings.json" name value names="" home
  home="$(cd "$WORK/home" && pwd -P)" || die "no sandbox home at $WORK/home"
  SESSION_ENV=("HOME=$home" "DISABLE_AUTOUPDATER=1")
  if [ -f "$settings" ]; then jq empty "$settings" 2>/dev/null || die "$settings is not valid JSON"; fi
  for name in "${PROVIDER_VARS[@]}"; do
    value="${!name:-}"
    if [ -z "$value" ] && [ -f "$settings" ]; then
      value="$(jq -r --arg name "$name" '(.env // {})[$name] // empty | tostring' "$settings")"
    fi
    if [ -n "$value" ]; then SESSION_ENV+=("$name=$value"); names+=" $name"; fi
  done
  echo "demo.sh: provider variables passed to the session (names only):${names:- none}"
  [ -n "$names" ] || echo "demo.sh: WARNING: none found; the isolated HOME has no login, so the session may ask to sign in" >&2
}

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

# A shot is sanitised before it reaches $SHOTS_DIR (shoot, in demo-rows.sh).
snap() { shoot "$1" pane; }
snap_sgr() { shoot "$1" pane_sgr; }
size_of() { wc -c <"$1" | tr -d ' '; }

# --- the session -----------------------------------------------------------
# The command tmux runs. On Bedrock the session starts on the first pinned id, so the banner
# and the status line name the model the mod calls, not the engine's default alias (the demo
# makes no main-thread turn, so this costs nothing); off Bedrock the flag is left out.
claude_command() {
  local unset_flags="" model_flag="" var
  for var in "${PARENT_SESSION_VARS[@]}"; do unset_flags+=" -u $var"; done
  if uses_bedrock; then model_flag=" --model $(printf %q "${BEDROCK_MODELS%%,*}")"; fi
  echo "env$unset_flags claude --strict-mcp-config --plugin-dir $(printf %q "$REPO") --settings $(printf %q "$WORK/settings.json")$model_flag"
}

start_session() {
  # HOME and the provider values reach `claude` through the tmux server's environment:
  # export is a builtin, so no value lands in an argument list, a file or the cast.
  (
    export "${SESSION_ENV[@]}"
    tm -f "$WORK/tmux.conf" new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS" -c "$WORK/project" "$(claude_command)"
  )
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
  idle_headline || { dump_pane; die "the idle band does not lead with ↥ Ready"; }
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
# Order: idle band (↥ Ready), draft, Enhance (↻ Enhancing with the rung strip),
# done row (✓ Enhanced with its cost), Undo (↶ Restored), Redo, status. Each step
# is asserted on the live screen, so a take that never showed the band's new rows
# fails instead of being recorded.
drive() {
  sleep "$IDLE_PAUSE_S"; snap 1-idle
  type_text "$DRAFT"; sleep "$TYPE_SETTLE_S"
  box_is_exactly "$DRAFT" || { dump_pane; die "the box does not hold the draft"; }
  snap 2-draft
  tm send-keys -t "$SESSION" C-x b # Enhance, from the prompt
  wait_until "enhance running with the rung strip" "$STEP_TIMEOUT_S" enhance_running
  sleep "$STEP_PAUSE_S"; snap 3-running
  wait_until "done row" "$ENHANCE_TIMEOUT_S" enhance_settled
  sleep "$READ_PAUSE_S"; snap 4-done
  band_key u '↶ Restored.*Redo \(u\)'; sleep "$READ_PAUSE_S"; snap 5-undone
  band_key u '✓ Enhanced.*Undo \(u\)'; sleep "$READ_PAUSE_S"; snap 6-redone

  # Typing into a non-empty box appends, so empty it before the slash command.
  tm send-keys -t "$SESSION" -N "$BACKSPACES" BSpace
  wait_until "empty box" "$STEP_TIMEOUT_S" box_is_exactly ""
  run_status
  sleep "$END_PAUSE_S"; snap 7-status
}

# Type the in-process status command and wait for its output (no model call).
run_status() {
  type_text "$STATUS_CMD"; sleep "$STEP_PAUSE_S"
  submit_status
  wait_until "status output" "$STEP_TIMEOUT_S" screen_has 'chain:'
}

# --dry-run: the idle band and `status`, then the sandbox checks. No model call, no
# recorder, nothing written to $OUT_DIR; use it until the sandbox is right.
dry_run() {
  sleep "$IDLE_PAUSE_S"
  snap 1-idle; snap_sgr band-sgr # the idle band plain, and with its colour codes
  check_idle_screen
  run_status
  sleep "$STEP_PAUSE_S"
  local screen included; screen="$(pane)"
  included="$(check_status_screen "$screen")" || exit 1
  snap 7-status
  echo "demo.sh: dry run passed: one prompt-lift band, status lists ${included% }"
  echo "demo.sh: $(grep -Eo 'skills [0-9]+/[0-9]+' <<<"$screen" | head -n 1) in status; no model call, $OUT_DIR untouched"
  [ -z "$SHOTS_DIR" ] || echo "demo.sh: theme $THEME; the idle band with its colour codes is in $SHOTS_DIR/band-sgr.txt"
}

# Focus the band, press a hotkey, wait for the button label to flip.
band_key() {
  tm send-keys -t "$SESSION" C-x Tab
  sleep "$FOCUS_SETTLE_S"
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

# Gentler settings until the GIF fits; else return 1 and keep $WORK (R13: never in $OUT_DIR).
convert() {
  local speed fps size
  for speed_fps in "1 20" "1.25 20" "1.25 12" "1.5 12"; do
    read -r speed fps <<<"$speed_fps"
    agg -q --font-size "$FONT_SIZE" --speed "$speed" --fps-cap "$fps" \
      --idle-time-limit "$CAST_IDLE_LIMIT_S" --last-frame-duration "$END_PAUSE_S" "$CAST" "$GIF" || die "agg failed (exit $?) at --speed $speed --fps-cap $fps"
    size="$(size_of "$GIF")" || die "agg wrote no GIF at --speed $speed --fps-cap $fps"
    echo "demo.sh: agg --speed $speed --fps-cap $fps -> $size bytes"
    [ "$size" -lt "$GIF_LIMIT_BYTES" ] && return 0
  done
  echo "demo.sh: WARNING: the GIF is over 1 MiB; it stays in $WORK, only the cast goes to $OUT_DIR" >&2
  KEEP_WORK=1; return 1
}

main() {
  parse_args "$@"
  preflight
  build_sandbox
  start_session
  if [ -n "$DRY_RUN" ]; then dry_run; return 0; fi
  start_recorder
  drive
  stop_recorder
  sanitize "$CAST"
  check_cast
  local out=("$CAST") file
  convert && out+=("$GIF")
  mv -f -- "${out[@]}" "$OUT_DIR/"
  for file in "${out[@]##*/}"; do echo "demo.sh: wrote $OUT_DIR/$file ($(size_of "$OUT_DIR/$file") bytes)"; done
}

[[ "${BASH_SOURCE[0]}" != "$0" ]] || main "$@" # sourced by a test: define, do not record
