#!/usr/bin/env bash
# Checks for the sandbox builders in scripts/demo.sh: the provider-variable
# allow-list, the sandbox HOME, the Bedrock pin and what counts as Bedrock, the
# cleanup that never follows the .aws link, the dry run's unpriced-chain guard,
# and how the take reads the band's rows (idle, working, done, cast glyphs). It sources the script and runs its functions under a FAKE real HOME,
# so nothing touches ~/.aws or the real settings; it needs bash and jq, and no
# tmux, claude or model call (those are stubbed in the child shells).
# usage: bash scripts/demo-selftest.sh [repo-dir]
# The single-quoted bash -c bodies below expand in the child shell on purpose.
# shellcheck disable=SC2016
set -uo pipefail
REPO="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"
SCRIPT="$REPO/scripts/demo.sh"
[ -f "$SCRIPT" ] || { echo "demo-selftest.sh: no $SCRIPT" >&2; exit 2; }
command -v jq >/dev/null || { echo "demo-selftest.sh: jq is required" >&2; exit 2; }
PASS=0 FAIL=0
# The checks name their own provider variables: the developer's must not leak in.
unset CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX AWS_REGION AWS_DEFAULT_REGION AWS_PROFILE \
  ANTHROPIC_DEFAULT_FABLE_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL \
  ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_SMALL_FAST_MODEL
# build_home asks `claude --version` and build_sandbox runs `git init`: stand-ins,
# exported so every child shell below sees them.
claude() { echo "2.1.0 (Claude Code)"; }
git() { :; }
export -f claude git
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }
check() { local label="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$label"; else bad "$label"; fi; }

# Every temp path this run makes goes in TEMP_PATHS and the one EXIT trap deletes them. Only
# the two shapes this script and demo.sh's build_sandbox create are ever deleted.
TEMP_PATHS=()
cleanup_temp() {
  local path
  for path in ${TEMP_PATHS[@]+"${TEMP_PATHS[@]}"}; do
    case "$path" in
      /tmp/pl-selftest-home* | /tmp/pl-demo.*)
        rm -f -- "$path/home/.aws" # a sandbox's symlink to the fake .aws goes first
        rm -rf -- "$path" ;;
      /tmp/pl-selftest-cast.*) rm -f -- "$path" ;;
    esac
  done
}
trap cleanup_temp EXIT
is_tracked() { # $1 = a path; true when it is a non-empty member of TEMP_PATHS
  local path
  [ -n "$1" ] || return 1
  for path in ${TEMP_PATHS[@]+"${TEMP_PATHS[@]}"}; do
    [ "$path" = "$1" ] && return 0
  done
  return 1
}
FAKE="$(mktemp -d /tmp/pl-selftest-home.XXXX)"; TEMP_PATHS+=("$FAKE")
FAKE2="$(mktemp -d /tmp/pl-selftest-home2.XXXX)"; TEMP_PATHS+=("$FAKE2")
FAKE3="$(mktemp -d /tmp/pl-selftest-home3.XXXX)"; TEMP_PATHS+=("$FAKE3")
mkdir -p "$FAKE/.claude" "$FAKE/.aws/sso" "$FAKE2/.claude" "$FAKE3/.claude"
echo "sentinel" >"$FAKE/.aws/sso/token-sentinel"
SECRET_SENTINEL="SECRET-SENTINEL-$$"
cat >"$FAKE/.claude/settings.json" <<EOF
{"env": {"CLAUDE_CODE_USE_BEDROCK": "1", "AWS_REGION": "us-east-1",
         "GITHUB_PERSONAL_ACCESS_TOKEN": "$SECRET_SENTINEL", "SOME_OTHER": "$SECRET_SENTINEL",
         "ANTHROPIC_DEFAULT_SONNET_MODEL": "from-settings-model"}}
EOF
echo '{"env": {"SOME_OTHER": "x"}}' >"$FAKE2/.claude/settings.json"

# 1. usage text and refusal
help_text="$(bash "$SCRIPT" --help)"
check "--help documents --dry-run" grep -q -- '--dry-run' <<<"$help_text"
check "--help documents the isolated HOME" grep -qi 'isolated HOME' <<<"$help_text"
check "--help documents --theme" grep -q -- '--theme light|dark' <<<"$help_text"
refusal="$(bash "$SCRIPT" --plugin-dir /tmp 2>&1 || true)"
check "a foreign --plugin-dir is still refused" grep -q 'must be' <<<"$refusal"
theme_refusal="$(bash "$SCRIPT" --theme blue 2>&1 || true)"
check "an unknown --theme is refused before anything runs" grep -q 'must be light or dark' <<<"$theme_refusal"

# 2. env allow-list: only named variables, parent env wins, nothing else leaks
out="$(HOME="$FAKE" AWS_REGION=parent-region bash -c '
  source "$1"
  WORK="$2/work"
  mkdir -p "$WORK/home"
  collect_session_env
  printf "%s\n" "${SESSION_ENV[@]}"
' _ "$SCRIPT" "$FAKE" 2>&1)"
check "HOME is the sandbox home, as a physical path" grep -Eqx "HOME=.*/work/home" <<<"$out"
check "HOME has no symlink component left" bash -c 'h="$(sed -n "s/^HOME=//p" <<<"$1")"; [ "$h" = "$(cd "$h" && pwd -P)" ]' _ "$out"
check "allow-listed settings var is copied" grep -qx 'CLAUDE_CODE_USE_BEDROCK=1' <<<"$out"
check "allow-listed model var is copied" grep -qx 'ANTHROPIC_DEFAULT_SONNET_MODEL=from-settings-model' <<<"$out"
check "the parent environment wins over settings" grep -qx 'AWS_REGION=parent-region' <<<"$out"
check "a non-allow-listed settings var is never copied" bash -c '! grep -q "$1" <<<"$2"' _ "$SECRET_SENTINEL" "$out"
check "the names line carries no values" bash -c '! grep -E "provider variables" <<<"$1" | grep -q -e "from-settings-model" -e "parent-region"' _ "$out"

# 3. sandbox HOME layout and a cleanup that never follows the .aws symlink
layout="$(HOME="$FAKE" bash -c '
  source "$1"
  build_sandbox
  echo "WORK=$WORK"
  cleanup
  [ ! -e "$WORK" ] && echo "workgone"
' _ "$SCRIPT" 2>&1)"
first_work="$(sed -n 's/^WORK=//p' <<<"$layout")"; TEMP_PATHS+=("$first_work")
check "the first sandbox is tracked in TEMP_PATHS" is_tracked "$first_work"
check "build_sandbox then cleanup ran" grep -q workgone <<<"$layout"
check "cleanup did not follow the .aws symlink" test -f "$FAKE/.aws/sso/token-sentinel"

layout2="$(HOME="$FAKE" bash -c '
  source "$1"
  KEEP_WORK=1
  build_sandbox
  echo "WORK=$WORK"
' _ "$SCRIPT" 2>&1)"
W="$(sed -n 's/^WORK=//p' <<<"$layout2")"; TEMP_PATHS+=("$W")
check "home rules file has the heading and two lines" test "$(wc -l <"$W/home/.claude/rules/testing.md" | tr -d ' ')" = 3
check "rules heading" grep -qx '# Testing' "$W/home/.claude/rules/testing.md"
check "rules line 1" grep -qx 'A bug fix starts with a regression test that reproduces the bug.' "$W/home/.claude/rules/testing.md"
check "rules line 2" grep -qx 'Cover the error path, not only the happy path.' "$W/home/.claude/rules/testing.md"
check ".claude.json seeds onboarding" jq -e '.hasCompletedOnboarding == true and .theme == "dark" and (.lastOnboardingVersion | test("^[0-9]+[.][0-9]+[.][0-9]+"))' "$W/home/.claude.json"
check "Bedrock: user settings = statusLine + the pin for prompt-lift@inline" jq -e '(keys | sort) == ["pluginConfigs","statusLine"] and (.pluginConfigs | keys) == ["prompt-lift@inline"] and (.pluginConfigs["prompt-lift@inline"].options.models | test("^us[.]anthropic[.]claude-fable-5-1,"))' "$W/home/.claude/settings.json"
check "Bedrock: --settings overlay equals the user settings" cmp "$W/settings.json" "$W/home/.claude/settings.json"
check "--settings overlay has no enabledPlugins" jq -e 'has("enabledPlugins") | not' "$W/settings.json"
check "statusLine command is the neutral one" jq -e '.statusLine.command == "jq -r '"'"'.model.display_name'"'"'"' "$W/settings.json"
check ".aws is a symlink to the real one" test "$(readlink "$W/home/.aws")" = "$FAKE/.aws"
check "no real-home path in any sandbox file but the symlink" bash -c '! grep -rIl --exclude-dir=.aws -- "$1" "$2" >/dev/null' _ "$FAKE" "$W/home"

# 3b. --theme light seeds the sandbox's theme (the default, dark, is checked above)
layout_light="$(HOME="$FAKE" bash -c '
  source "$1"
  KEEP_WORK=1 THEME=light
  build_sandbox
  echo "WORK=$WORK"
' _ "$SCRIPT" 2>&1)"
WL="$(sed -n 's/^WORK=//p' <<<"$layout_light")"; TEMP_PATHS+=("$WL")
check "--theme light: .claude.json seeds a light theme" jq -e '.theme == "light" and .hasCompletedOnboarding == true' "$WL/home/.claude.json"

# 4. off Bedrock (an API-key setup) the overlay is the status line alone
layout3="$(env -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX HOME="$FAKE2" bash -c '
  source "$1"
  KEEP_WORK=1
  build_sandbox
  echo "WORK=$WORK"
' _ "$SCRIPT" 2>&1)"
W3="$(sed -n 's/^WORK=//p' <<<"$layout3")"; TEMP_PATHS+=("$W3")
check "no Bedrock variable is passed" bash -c '! grep -q "provider variables.*BEDROCK" <<<"$1"' _ "$layout3"
check "API key setup: overlay is statusLine only" jq -e 'keys == ["statusLine"]' "$W3/settings.json"
check "no .aws link when the real home has none" test ! -e "$W3/home/.aws"

# 5. what counts as Bedrock is the engine's own truthiness: 1, true, yes, on, any case
is_bedrock() { # $@ = the session's NAME=value words; prints yes or no
  bash -c 'source "$1"; shift; SESSION_ENV=("$@"); if uses_bedrock; then echo yes; else echo no; fi' _ "$SCRIPT" "$@"
}
for value in 1 true yes on TRUE Yes ON oN; do
  check "uses_bedrock: CLAUDE_CODE_USE_BEDROCK=$value is Bedrock" test "$(is_bedrock HOME=/x "CLAUDE_CODE_USE_BEDROCK=$value")" = yes
done
for value in 0 false no off FALSE No "" 2 bedrock; do
  check "uses_bedrock: CLAUDE_CODE_USE_BEDROCK=${value:-(empty)} is not Bedrock" test "$(is_bedrock HOME=/x "CLAUDE_CODE_USE_BEDROCK=$value")" = no
done
check "uses_bedrock: no variable is not Bedrock" test "$(is_bedrock HOME=/x AWS_REGION=us-east-1)" = no
check "uses_bedrock: only the Bedrock variable counts" test "$(is_bedrock HOME=/x CLAUDE_CODE_USE_VERTEX=1)" = no

# 6. an explicit off value gets no Bedrock pin in the sandbox
layout4="$(CLAUDE_CODE_USE_BEDROCK=0 HOME="$FAKE3" bash -c '
  source "$1"
  KEEP_WORK=1
  build_sandbox
  echo "WORK=$WORK"
' _ "$SCRIPT" 2>&1)"
W4="$(sed -n 's/^WORK=//p' <<<"$layout4")"; TEMP_PATHS+=("$W4")
check "CLAUDE_CODE_USE_BEDROCK=0 is still passed by name" grep -q 'provider variables.*CLAUDE_CODE_USE_BEDROCK' <<<"$layout4"
check "CLAUDE_CODE_USE_BEDROCK=0: overlay is statusLine only" jq -e 'keys == ["statusLine"]' "$W4/settings.json"

# 7. the dry run fails closed on an unpriced chain, so the free run protects the paid take
STATUS_REST='last call: none yet
session: 0 presses · $0.000
today: 0 presses · $0.000
caps: off
conversation: off
static block: 4383 chars · hash 1e1b97d7
skills 4/4 (included/total)
instruction files included: /private/tmp/pl-demo.SELFTEST/home/.claude/rules/testing.md (50 tokens)
instruction files excluded: none'
dry_run_on() { # $1 = the chain row(s) of a fake status screen; prints the run's output
  SCREEN="$(printf 'prompt-lift status\n%s\n%s\n' "$1" "$STATUS_REST")" bash -c '
    source "$1"
    pane() { printf "%s\n" "$SCREEN"; }
    run_status() { :; }
    sleep() { :; }
    id() { echo selftest-account; }
    KEEP_WORK=1 WORK=/tmp/pl-demo.SELFTEST OUT_DIR=/tmp/pl-selftest-none
    dry_run
  ' _ "$SCRIPT" 2>&1
}
priced="$(dry_run_on 'chain: us.anthropic.claude-fable-5-1 → us.anthropic.claude-sonnet-5-5')"
priced_rc=$?
check "dry run: a priced chain passes" test "$priced_rc" = 0
check "dry run: a priced chain says so" grep -q 'dry run passed' <<<"$priced"
unpriced="$(dry_run_on 'chain: fable → sonnet → haiku
aliases: unpriced on bedrock — pin full ids in models for prices (README › Cost)')"
unpriced_rc=$?
check "dry run: an unpriced chain fails" test "$unpriced_rc" != 0
check "dry run: an unpriced chain says the take would fail after the call" grep -q 'the chain is unpriced here; the paid take would fail after the call' <<<"$unpriced"
check "dry run: an unpriced chain shows the screen" grep -q 'aliases: unpriced on bedrock' <<<"$unpriced"
check "dry run: an unpriced chain never reports a pass" bash -c '! grep -q "dry run passed" <<<"$1"' _ "$unpriced"

# 8. the take reads the band's rows (0.6.0): the done headline carries the cost, the
# working row carries the counter and the rung strip, and a take that never showed
# them fails before it is recorded. The screens are the rows the mod draws.
DONE_ROW='✓ Enhanced $0.03 [ Enhance (e) ] [ Send (s) ] [ Undo (u) ] fable 5.1 · 1 of 3 · 2.3s · 6.8k cached'
UNPRICED_ROW='✓ Enhanced $? · (no price) [ Enhance (e) ] [ Send (s) ] [ Undo (u) ] fable 5.1 · 1 of 3'
RUNNING_ROW='↻ Enhancing 2 of 3 [ Cancel (c) ] fable 5.1 › sonnet 5.5 › haiku 5.5'
BARE_RUNNING_ROW='↻ Enhancing [ Cancel (c) ] Enhancing with fable 5.1…'
KEPT_ROW='✗ Kept as is [ Enhance (e) ] session cap $0.10 reached · /prompt-lift cap off'
IDLE_ROW='↥ Ready [ Enhance (e) ] ctrl+x b · or ctrl+x tab, e · prompt-lift: fable 5.1'
on_screen() { # $1 = a fake screen, the rest = a demo.sh function; prints its output, returns its status
  local screen="$1"; shift
  SCREEN="$screen" bash -c '
    source "$1"; shift
    pane() { printf "%s\n" "$SCREEN"; }
    "$@"
  ' _ "$SCRIPT" "$@" 2>&1
}
check "the done headline with its cost settles the press" on_screen "$DONE_ROW" enhance_settled
unpriced_done="$(on_screen "$UNPRICED_ROW" enhance_settled)"; unpriced_done_rc=$?
check "an unpriced done headline fails the take" test "$unpriced_done_rc" != 0
check "an unpriced done headline says the chain needs full ids" grep -q 'the done row is unpriced' <<<"$unpriced_done"
on_screen "$RUNNING_ROW" enhance_settled >/dev/null; running_settled_rc=$?
check "a working row has not settled yet" test "$running_settled_rc" = 1
kept_settled="$(on_screen "$KEPT_ROW" enhance_settled)"; kept_settled_rc=$?
check "a kept-as-is row (no Cancel, no rewrite) fails the take" test "$kept_settled_rc" != 0
check "a kept-as-is row says the press ended without a rewrite" grep -q 'Enhance ended without a rewrite' <<<"$kept_settled"
check "the idle headline leads the idle row" on_screen "$IDLE_ROW" idle_headline
check "a 0.5.0 Button row is not the idle headline" bash -c '! "$@"' _ on_screen '[ Enhance (e) ] prompt-lift: fable 5.1' idle_headline
check "a kept-as-is row is not the idle headline" bash -c '! "$@"' _ on_screen "$KEPT_ROW" idle_headline
check "the working row with its counter and strip is recognised" on_screen "$RUNNING_ROW" enhance_running
check "a working row with no strip is not the strip" bash -c '! "$@"' _ on_screen "$BARE_RUNNING_ROW" enhance_running
check "a done row is not a working row" bash -c '! "$@"' _ on_screen "$DONE_ROW" enhance_running

fake_cast="$(mktemp /tmp/pl-selftest-cast.XXXX)"; TEMP_PATHS+=("$fake_cast")
cast_with() { # $1 = a glyph to leave out; writes a fake cast holding every string check_cast wants
  printf '%s\n' 'Enhance Undo Redo restored your draft $0.03 chain:' ↥ ↻ ✓ ↶ | grep -vF -- "$1" >"$fake_cast"
}
cast_ok() { bash -c 'source "$1"; CAST="$2"; check_cast' _ "$SCRIPT" "$fake_cast"; }
cast_with none
check "a cast that shows every row passes the cast check" cast_ok
for glyph in ↥ ↻ ✓ ↶; do
  cast_with "$glyph"
  cast_out="$(cast_ok 2>&1)"; cast_rc=$?
  check "a cast without $glyph fails the cast check" test "$cast_rc" != 0
  check "a cast without $glyph names it" grep -qF -- "the cast never shows: $glyph" <<<"$cast_out"
done

echo "---- $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
