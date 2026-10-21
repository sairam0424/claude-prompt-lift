#!/usr/bin/env bash
# Checks for scripts/demo.sh and the screen readers it sources from scripts/demo-rows.sh:
# the provider-variable allow-list, the sandbox HOME, the engine's auto-update switch,
# the Bedrock pin and the session model, what counts as Bedrock, the cleanup that never
# follows the .aws link, the dry run's unpriced-chain guard, how the take reads the
# band's rows (idle, working, done, cast glyphs), and how the sanitiser blanks the
# provider text and fails closed on provider and update notices. It sources the scripts
# and runs their functions under a FAKE real HOME, so nothing touches ~/.aws or the
# real settings; it needs bash, jq and python3, and no tmux, claude or model call
# (those are stubbed in the child shells).
# usage: bash scripts/demo-selftest.sh [repo-dir]
# The single-quoted bash -c bodies below expand in the child shell on purpose.
# shellcheck disable=SC2016
set -uo pipefail
REPO="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"
SCRIPT="$REPO/scripts/demo.sh" ROWS="$REPO/scripts/demo-rows.sh"
[ -f "$SCRIPT" ] || { echo "demo-selftest.sh: no $SCRIPT" >&2; exit 2; }
command -v jq >/dev/null || { echo "demo-selftest.sh: jq is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "demo-selftest.sh: python3 is required" >&2; exit 2; }
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
check_not() { local label="$1" rc; shift; "$@" >/dev/null 2>&1; rc=$?; if [ "$rc" = 1 ]; then ok "$label"; else bad "$label (exit $rc, want 1)"; fi; } # a clean no, run in THIS shell: 126/127 or a crash is a FAIL, not a pass

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
DRY_WORK=/tmp/pl-demo.SELFTEST; TEMP_PATHS+=("$DRY_WORK") # the dry run writes its idle capture here
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
check "the screen readers live in the sourced scripts/demo-rows.sh" test -f "$ROWS"
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
check "the engine's auto-update is off for the session" grep -qx 'DISABLE_AUTOUPDATER=1' <<<"$out"
check "the auto-update switch is passed by value, once" test "$(grep -c '^DISABLE_AUTOUPDATER=' <<<"$out")" = 1
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

# 6b. the session starts on the model the mod will call: on Bedrock the first pinned id, so
# the banner and the status line name it; off Bedrock the engine's own default, no flag
session_command() { # $@ = the session's NAME=value words; prints the command string tmux runs
  bash -c 'source "$1"; shift; WORK=/tmp/pl-demo.CMD; SESSION_ENV=("$@"); claude_command' _ "$SCRIPT" "$@"
}
bedrock_cmd="$(session_command HOME=/x CLAUDE_CODE_USE_BEDROCK=1)"
check "Bedrock: the session starts on the first pinned model id" grep -Eq -- ' --model us[.]anthropic[.]claude-fable-5-1( |$)' <<<"$bedrock_cmd"
check "Bedrock: only the first pinned id is the session model" test "$(grep -o -- '--model' <<<"$bedrock_cmd" | wc -l | tr -d ' ')" = 1
check "Bedrock: the session still loads this checkout and the overlay" grep -q -- '--strict-mcp-config --plugin-dir .* --settings /tmp/pl-demo[.]CMD/settings[.]json' <<<"$bedrock_cmd"
check "Bedrock: the parent-session variables are still unset" grep -q -- '-u CLAUDECODE .*-u CLAUDE_CONFIG_DIR' <<<"$bedrock_cmd"
plain_cmd="$(session_command HOME=/x AWS_REGION=us-east-1)"
check "off Bedrock: no --model flag (the engine's default)" bash -c '! grep -q -- "--model" <<<"$1"' _ "$plain_cmd"
check "off Bedrock: the checkout still loads" grep -q -- '--plugin-dir' <<<"$plain_cmd"
off_cmd="$(session_command HOME=/x CLAUDE_CODE_USE_BEDROCK=0)"
check "CLAUDE_CODE_USE_BEDROCK=0: no --model flag" bash -c '! grep -q -- "--model" <<<"$1"' _ "$off_cmd"

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
DRY_IDLE='Fable 5.1
↥ Ready [ Enhance (e) ] ctrl+x b · or ctrl+x tab, e · prompt-lift: fable 5.1'
dry_run_on() { # $1 = the chain row(s) of a fake status screen, $2 = the idle screen (default DRY_IDLE), $3 = a --shots-dir (default none); prints the run's output
  SCREEN="$(printf 'prompt-lift status\n%s\n%s\n' "$1" "$STATUS_REST")" IDLE="${2:-$DRY_IDLE}" SHOTS="${3:-}" bash -c '
    source "$1"
    pane() { if [ -n "${STATUSED:-}" ]; then printf "%s\n" "$SCREEN"; else printf "%s\n" "$IDLE"; fi; }
    pane_sgr() { pane; }
    run_status() { STATUSED=1; }
    sleep() { :; }
    id() { echo selftest-account; }
    KEEP_WORK=1 WORK="$2" OUT_DIR=/tmp/pl-selftest-none SHOTS_DIR="$SHOTS"
    mkdir -p "$WORK"
    dry_run
  ' _ "$SCRIPT" "$DRY_WORK" 2>&1
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
# The idle screen as the take records it: the banner's ` · Amazon Bedrock` is blanked by the
# sanitiser, any other provider text or an update notice fails the free run.
PRICED_CHAIN='chain: us.anthropic.claude-fable-5-1 → us.anthropic.claude-sonnet-5-5'
banner_run="$(dry_run_on "$PRICED_CHAIN" "$(printf '%s\n%s' 'Fable 5.1 · Amazon Bedrock' "$DRY_IDLE")")"
banner_rc=$?
check "dry run: the banner's ' · Amazon Bedrock' is blanked, not a failure" test "$banner_rc" = 0
check "dry run: a blanked banner still reports a pass" grep -q 'dry run passed' <<<"$banner_run"
update_run="$(dry_run_on "$PRICED_CHAIN" "$(printf '%s\n%s' '✔ Update installed · Restart to update' "$DRY_IDLE")")"
update_rc=$?
check "dry run: an update banner on the idle screen fails" test "$update_rc" != 0
check "dry run: an update banner is named" grep -qi 'update installed' <<<"$update_run"
check "dry run: an update banner never reports a pass" bash -c '! grep -q "dry run passed" <<<"$1"' _ "$update_run"
provider_run="$(dry_run_on "$PRICED_CHAIN" "$(printf '%s\n%s' 'Fable 5.1 via Bedrock' "$DRY_IDLE")")"
provider_rc=$?
check "dry run: provider text the blanking does not cover fails" test "$provider_rc" != 0
check "dry run: that provider text is named" grep -qi 'bedrock' <<<"$provider_run"
vertex_run="$(dry_run_on "$PRICED_CHAIN" "$(printf '%s\n%s' 'Fable 5.1 · Vertex AI' "$DRY_IDLE")")"
vertex_rc=$?
check "dry run: Vertex on the idle screen fails" test "$vertex_rc" != 0
check "dry run: Vertex is named" grep -qi 'vertex' <<<"$vertex_run"

# 7b. the shots a run leaves in --shots-dir are sanitised as they are taken, not at the end:
# a run that dies part-way leaves no capture that still shows the banner's provider text
BANNER_IDLE="$(printf '%s\n%s' 'Fable 5.1 · Amazon Bedrock' "$DRY_IDLE")"
shots_dir() { local dir; dir="$(mktemp -d /tmp/pl-selftest-home-shots.XXXX)"; TEMP_PATHS+=("$dir"); echo "$dir"; }
shot_count() { find "$1" -type f | wc -l | tr -d ' '; }
is_clean() { ! grep -rqiE 'bedrock|vertex|update installed' "$1"; } # no provider or update text under $1
has_shot() { [ -f "$1/$2" ]; }
shots_pass="$(shots_dir)"
dry_run_on "$PRICED_CHAIN" "$BANNER_IDLE" "$shots_pass" >/dev/null; shots_pass_rc=$?
check "dry run shots: a passing run succeeds with a banner on the idle screen" test "$shots_pass_rc" = 0
check "dry run shots: it writes the idle, colour-code and status shots" test "$(shot_count "$shots_pass")" = 3
check "dry run shots: the banner's provider text is blanked in every one" is_clean "$shots_pass"
# the unpriced chain stops the run AFTER the idle shot was taken
shots_late="$(shots_dir)"
dry_run_on 'chain: fable → sonnet → haiku
aliases: unpriced on bedrock — pin full ids in models for prices (README › Cost)' "$BANNER_IDLE" "$shots_late" >/dev/null; late_rc=$?
check "dry run shots: an unpriced chain still fails the run" test "$late_rc" != 0
check "dry run shots: the shot taken before the failure is there" has_shot "$shots_late" 1-idle.txt
check "dry run shots: the failure left no unsanitised capture" is_clean "$shots_late"
for notice in 'Fable 5.1 via Bedrock' '✔ Update installed · Restart to update' 'Fable 5.1 · Vertex AI'; do
  shots_bad="$(shots_dir)"
  bad_out="$(dry_run_on "$PRICED_CHAIN" "$(printf '%s\n%s' "$notice" "$DRY_IDLE")" "$shots_bad")"; bad_rc=$?
  check "dry run shots: '$notice' on the idle screen fails the run" test "$bad_rc" != 0
  check "dry run shots: '$notice' names the shot" grep -q 'the 1-idle shot' <<<"$bad_out"
  check "dry run shots: '$notice' writes no shot" test "$(shot_count "$shots_bad")" = 0
done
# a shot of the take itself (snap and snap_sgr, not only the dry run's)
take_shot() { # $1 = a fake screen, $2 = snap or snap_sgr, $3 = a shots dir; prints the output, returns the shot's status. KEEP_WORK=1 (set after the source, which resets it) keeps the EXIT trap off the shared work dir
  SCREEN="$1" SHOTS="$3" bash -c '
    source "$1"
    pane() { printf "%s\n" "$SCREEN"; }
    pane_sgr() { pane; }
    id() { echo selftest-account; }
    KEEP_WORK=1 WORK="$3" SHOTS_DIR="$SHOTS"
    mkdir -p "$WORK"
    "$2" 3-running
  ' _ "$SCRIPT" "$2" "$DRY_WORK" 2>&1
}
for shot in snap snap_sgr; do
  shots_take="$(shots_dir)"
  take_shot "$(printf '%s\n%s' '↻ Enhancing 2 of 3 [ Cancel (c) ] fable 5.1 › sonnet 5.5' 'Fable 5.1 · Amazon Bedrock')" "$shot" "$shots_take" >/dev/null; take_rc=$?
  check "$shot: a take shot with the banner succeeds" test "$take_rc" = 0
  check "$shot: it is written, with the banner blanked" bash -c '[ -f "$1/3-running.txt" ] && ! grep -qi bedrock "$1/3-running.txt"' _ "$shots_take"
  shots_take_bad="$(shots_dir)"
  take_shot 'Fable 5.1 via Bedrock' "$shot" "$shots_take_bad" >/dev/null; take_bad_rc=$?
  check "$shot: a shot the sanitiser refuses stops the take" test "$take_bad_rc" != 0
  check "$shot: and is not written" test "$(shot_count "$shots_take_bad")" = 0
done
check "take_shot: the selftest's shared work dir survives a take" test -d "$DRY_WORK"

# 8. the take reads the band's rows (0.6.0): the done headline carries the cost, the
# working row carries the counter and the rung strip, and a take that never showed
# them fails before it is recorded. The screens are the rows the mod draws. demo.sh sources
# the readers from scripts/demo-rows.sh; these checks name that file too.
DONE_ROW='✓ Enhanced $0.03 [ Enhance (e) ] [ Send (s) ] [ Undo (u) ] fable 5.1 · 1 of 3 · 2.3s · 6.8k cached'
UNPRICED_ROW='✓ Enhanced $? · (no price) [ Enhance (e) ] [ Send (s) ] [ Undo (u) ] fable 5.1 · 1 of 3'
RUNNING_ROW='↻ Enhancing 2 of 3 [ Cancel (c) ] fable 5.1 › sonnet 5.5 › haiku 5.5'
BARE_RUNNING_ROW='↻ Enhancing [ Cancel (c) ] Enhancing with fable 5.1…'
KEPT_ROW='✗ Kept as is [ Enhance (e) ] session cap $0.10 reached · /prompt-lift cap off'
IDLE_ROW='↥ Ready [ Enhance (e) ] ctrl+x b · or ctrl+x tab, e · prompt-lift: fable 5.1'
on_screen() { # $1 = a fake screen, the rest = a demo.sh function; prints its output, returns its status
  local screen="$1"; shift
  SCREEN="$screen" bash -c '
    source "$1"; source "$2"; shift 2
    pane() { printf "%s\n" "$SCREEN"; }
    "$@"
  ' _ "$SCRIPT" "$ROWS" "$@" 2>&1
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
check_not "a 0.5.0 Button row is not the idle headline" on_screen '[ Enhance (e) ] prompt-lift: fable 5.1' idle_headline
check_not "a kept-as-is row is not the idle headline" on_screen "$KEPT_ROW" idle_headline
check "the working row with its counter and strip is recognised" on_screen "$RUNNING_ROW" enhance_running
check_not "a working row with no strip is not the strip" on_screen "$BARE_RUNNING_ROW" enhance_running
check_not "a done row is not a working row" on_screen "$DONE_ROW" enhance_running

fake_cast="$(mktemp /tmp/pl-selftest-cast.XXXX)"; TEMP_PATHS+=("$fake_cast")
cast_with() { # $1 = a glyph to leave out; writes a fake cast holding every string check_cast wants
  printf '%s\n' 'Enhance Undo Redo restored your draft $0.03 chain:' ↥ ↻ ✓ ↶ | grep -vF -- "$1" >"$fake_cast"
}
cast_ok() { bash -c 'source "$1"; source "$2"; CAST="$3"; check_cast' _ "$SCRIPT" "$ROWS" "$fake_cast"; }
cast_with none
check "a cast that shows every row passes the cast check" cast_ok
for glyph in ↥ ↻ ✓ ↶; do
  cast_with "$glyph"
  cast_out="$(cast_ok 2>&1)"; cast_rc=$?
  check "a cast without $glyph fails the cast check" test "$cast_rc" != 0
  check "a cast without $glyph names it" grep -qF -- "the cast never shows: $glyph" <<<"$cast_out"
done

# The committed cast is read again as bytes: provider or update text left in it fails the take.
for notice in 'Amazon Bedrock' 'on Bedrock' 'Vertex AI' 'Update installed' 'update INSTALLED'; do
  cast_with none
  printf '%s\n' "$notice" >>"$fake_cast"
  cast_out="$(cast_ok 2>&1)"; cast_rc=$?
  check "a cast that shows '$notice' fails the cast check" test "$cast_rc" != 0
  check "a cast that shows '$notice' says so" grep -qF -- 'the cast shows provider or update text' <<<"$cast_out"
done

# 9. the sanitiser blanks the engine's ` · Amazon Bedrock` with spaces of the same length and
# fails closed on any provider or update text left (the way it fails on the account name)
BLANK=$(printf '%17s' '') # the 17 characters of ` · Amazon Bedrock`
cast_file() { # $1 = the text of one banner output event; prints the path of a fake .cast holding it
  local path; path="$(mktemp /tmp/pl-selftest-cast.XXXX)"
  mv -- "$path" "$path.cast"; path="$path.cast"; TEMP_PATHS+=("$path") # only a .cast path loses its tear-down
  jq -cn --arg text "$1" '{version: 2, width: 110, height: 30}, [0.5, "o", $text], [1.0, "o", "idle"], [9.9, "o", "bye \u001b[?1049l"]' >"$path"
  echo "$path"
}
sanitize_file() { # $1 = a file; sanitises it under a fake real HOME and account; prints the output
  HOME="$FAKE" bash -c 'source "$1"; id() { echo selftest-account; }; sanitize "$2"' _ "$SCRIPT" "$1" 2>&1
}
banner_cast="$(cast_file $'Fable 5.1 · Amazon Bedrock\r\n')"
sanitize_file "$banner_cast" >/dev/null; banner_cast_rc=$?
check "sanitize: a banner with ' · Amazon Bedrock' passes" test "$banner_cast_rc" = 0
check "sanitize: the 17 characters become 17 spaces, the layout unchanged" jq -es --arg blank "$BLANK" '.[1][2] == ("Fable 5.1" + $blank + "\r\n")' "$banner_cast"
check "sanitize: the model name stays" grep -q 'Fable 5[.]1' "$banner_cast"
check "sanitize: no Bedrock is left in the cast" bash -c '! grep -qi bedrock "$1"' _ "$banner_cast"
check "sanitize: the tear-down event is still dropped" test "$(wc -l <"$banner_cast" | tr -d ' ')" = 3
banner_txt="$(mktemp /tmp/pl-selftest-cast.XXXX)"; TEMP_PATHS+=("$banner_txt")
printf 'Fable 5.1 · Amazon Bedrock\nprompt\n' >"$banner_txt"
sanitize_file "$banner_txt" >/dev/null
check "sanitize: a plain-text capture is blanked the same way" test "$(head -n 1 "$banner_txt")" = "Fable 5.1$BLANK"
# the last is a name split by a colour change: the check reads the stream with escapes stripped
for notice in '✔ Update installed · Restart to update' 'update INSTALLED' 'Claude on Bedrock' 'bedrock' 'Vertex AI' $'Amazon \033[2mBedrock'; do
  notice_cast="$(cast_file "$notice")"
  before="$(cat "$notice_cast")"
  notice_out="$(sanitize_file "$notice_cast")"; notice_rc=$?
  check "sanitize: '${notice//$'\033'/<esc>}' fails closed" test "$notice_rc" != 0
  check "sanitize: '${notice//$'\033'/<esc>}' names the file" grep -qF -- "sanitize: $notice_cast still shows" <<<"$notice_out"
  check "sanitize: '${notice//$'\033'/<esc>}' leaves the refused cast as it was" test "$(cat "$notice_cast")" = "$before"
done
echo "---- $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
