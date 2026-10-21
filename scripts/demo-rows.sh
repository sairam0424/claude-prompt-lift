#!/usr/bin/env bash
# The screen and cast readers of scripts/demo.sh, kept in their own file so both stay
# under 400 lines. Sourced by demo.sh and by demo-selftest.sh, never run: it defines
# functions and constants and does nothing else. A reader looks at the live screen
# (`pane`) or the cast ($CAST) and either answers yes or no, or stops the take through
# demo.sh's `die`; the sanitiser is the one that also rewrites what it reads. It relies
# on demo.sh's pane, pane_sgr, die, dump_pane and size_of, and on WORK, CAST, SHOTS_DIR and
# REAL_HOME.

# demo.sh sources this file and the selftest sources it again: the second time is a no-op.
[ -z "${DEMO_ROWS_LOADED:-}" ] || return 0
DEMO_ROWS_LOADED=1

# The directory submission treats 256 KiB as a per-file limit for non-image files.
readonly CAST_LIMIT_BYTES=$((256 * 1024)) CAST_WARN_BYTES=$((240 * 1024))
# The engine's banner names the provider beside the model: sanitize blanks that text, same
# width. NOTICE_RE is what no recording may show once it is blanked (grep -E and Python re,
# any case): the provider and the engine's update notice.
readonly PROVIDER_SUFFIX=' · Amazon Bedrock' NOTICE_RE='bedrock|vertex|update installed'

screen_has() { local s; s="$(pane)"; grep -Eq -- "$1" <<<"$s"; }

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

# The idle row: the headline leads, then the Enhance Button (↥ Ready [ Enhance (e) ] ...).
idle_headline() { screen_has '↥ Ready.*Enhance \(e\)'; }

# The working row: the counter in the headline and the rung strip (rungs joined by
# ` › `) after the Cancel button. A chain of one rung has no strip, so this also
# keeps the take honest about the chain it records.
enhance_running() { screen_has '↻ Enhancing [0-9]+ of [0-9]+.*Cancel \(c\).* › '; }

# Done row up: success, the cost in the headline (`✓ Enhanced $0.03`). Cancel gone
# with no done row: the press ended without a rewrite (a guard refused it, or the
# chain failed), and its row and toast say why.
enhance_settled() {
  local s; s="$(pane)" # one capture: the row can flip between two
  grep -Eq '✓ Enhanced \$[0-9]+\.[0-9]+.*Send \(s\)' <<<"$s" && return 0
  if grep -Eq '✓ Enhanced \$\?.*Send \(s\)' <<<"$s"; then
    echo "$s" >&2; die "the done row is unpriced (\$?): on Bedrock or Vertex the chain needs full model ids (README, Bedrock users)"
  fi
  grep -Eq 'Cancel \(c\)' <<<"$s" || { echo "$s" >&2; die "Enhance ended without a rewrite; the row above says why"; }
  return 1
}

# Dry run: the idle screen as the take will record it, plain and with its colour codes.
# The engine's banner names the provider beside the model and may carry an update notice:
# sanitize blanks the first and refuses any provider or update text left, so what passes
# here is what the cast would hold. Free, before any paid take.
check_idle_screen() {
  local plain="$WORK/idle-screen.txt" sgr="$WORK/idle-screen-sgr.txt"
  pane >"$plain"; pane_sgr >"$sgr"
  sanitize "$plain" "$sgr" || { dump_pane; die "the idle screen shows provider or update text the recording must not carry"; }
}

# Dry run: the status screen. The chain is priced (an unpriced one would spend the paid
# take's call and then fail on the `$?` done row), exactly one rules file sits under the
# sandbox HOME, and neither the real home nor the account name shows. Prints the
# included-files row on one line; run it in $(...) with `|| exit`, since die ends only that subshell.
check_status_screen() {
  local screen="$1" included count rules_dir="${WORK##*/}/home/.claude/rules/"
  if grep -Fq -- 'aliases: unpriced' <<<"$screen"; then
    dump_pane; die "the chain is unpriced here; the paid take would fail after the call"
  fi
  # The row wraps onto indented lines: take everything up to the "excluded" row.
  included="$(awk '/instruction files included:/ { on = 1 } /instruction files excluded:/ { on = 0 } on' <<<"$screen")"
  [ -n "$included" ] || { dump_pane; die "status prints no 'instruction files included' row"; }
  count="$({ grep -o -- '/[.]claude/rules/' <<<"$included" || true; } | wc -l | tr -d ' ')"
  { [ "$count" = 1 ] && grep -Fq -- "$rules_dir" <<<"$included"; } ||
    { dump_pane; die "expected exactly one rules file, under $WORK/home/.claude/rules/ (saw $count rules paths)"; }
  if grep -Fq -- "$REAL_HOME" <<<"$screen"; then dump_pane; die "the screen shows the real home path"; fi
  if grep -Fiq -- "$(id -un)" <<<"$screen"; then dump_pane; die "the screen shows the account name"; fi
  tr -s ' \n' ' ' <<<"${included#*included: }"
}

# Drop the tmux client's tear-down (screen clear and "[detached ...]") from the
# end of the cast, then swap the account name and the real home path for same-length
# placeholders and blank the banner's ` · Amazon Bedrock` with as many spaces, so the
# layout is unchanged. The sandbox HOME keeps the account and home off screen, so
# that part is the fail-closed net, not the mechanism (the fake home path may show).
# The replaces are literal; the check then reads the events joined, escapes
# stripped and case folded, which catches a name split by a colour change or
# written in another case, and any provider or update text left (NOTICE_RE). Any hit
# fails the run.
sanitize() {
  python3 -I - "$REAL_HOME" "$(id -un)" "$PROVIDER_SUFFIX" "$NOTICE_RE" "$@" <<'PY'
import json, re, sys
home, user, suffix, notice_re, paths = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:]
TEARDOWN_WINDOW_S = 0.25
ESCAPE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-~]|[0-~])")
def pad(seed, n): return (seed + "_" * n)[:n]
def shown(text, is_cast):
    if is_cast:  # the header, then every event's output as one stream
        header, *events = [row for row in text.split("\n") if row]
        text = header + "".join(json.loads(event)[2] for event in events)
    return ESCAPE.sub("", text).lower()
fake_home, fake_user = pad("/Users/developer", len(home)), pad("developer", len(user))
for path in paths:
    with open(path, encoding="utf-8") as fh:
        lines = fh.readlines()
    is_cast = path.endswith(".cast")
    if is_cast:
        times = [json.loads(line)[0] for line in lines[1:]]
        keep = len(times)
        while keep > 1 and times[keep - 1] >= times[-1] - TEARDOWN_WINDOW_S:
            keep -= 1
        if not any("[?1049l" in json.loads(line)[2] for line in lines[1 + keep:]):
            sys.exit("sanitize: no tmux tear-down at the end of the cast")
        lines = lines[: 1 + keep]
    text = "".join(lines).replace(home, fake_home).replace(user, fake_user)
    text = text.replace(suffix, " " * len(suffix))
    text = text.replace("\u00a0", " ")  # agg draws no-break spaces as stray glyphs
    seen = shown(text, is_cast)
    if user.lower() in seen or home.lower() in seen:
        sys.exit(f"sanitize: {path} still names the account")
    notice = re.search(notice_re, seen, re.IGNORECASE)
    if notice:
        sys.exit(f"sanitize: {path} still shows {notice.group(0)!r}")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
PY
}

# One screen shot for --shots-dir (<name> and the reader, pane or pane_sgr): read into $WORK,
# sanitised there, and only then moved into $SHOTS_DIR. A screen the sanitiser refuses stops
# the run with nothing written, so a run that dies at any step leaves no raw capture, with
# the banner's provider text, in the person's directory: each file there is already clean.
shoot() {
  [ -n "$SHOTS_DIR" ] || return 0
  local raw="$WORK/shot-$1.txt"
  "$2" >"$raw"
  sanitize "$raw" || die "the $1 shot shows provider, update or account text; nothing written to $SHOTS_DIR"
  mv -f -- "$raw" "$SHOTS_DIR/$1.txt"
}

check_cast() {
  local want
  # The glyphs are single code points, so a screen redraw cannot split them: ↥ idle,
  # ↻ enhancing, ✓ enhanced, ↶ restored.
  for want in 'Enhance' 'Undo' 'Redo' 'restored your draft' '[$]0[.]' 'chain:' '↥' '↻' '✓' '↶'; do
    grep -Eq -- "$want" "$CAST" || die "the cast never shows: $want"
  done
  # sanitize read the shown text; this reads the file that gets committed, byte for byte.
  if grep -Eiq -- "$NOTICE_RE" "$CAST"; then die "the cast shows provider or update text"; fi
  local bytes; bytes="$(size_of "$CAST")"
  [ "$bytes" -le "$CAST_WARN_BYTES" ] || echo "demo.sh: WARNING: the cast is $bytes bytes, over $((CAST_WARN_BYTES / 1024)) KiB; the directory submission limits files to $((CAST_LIMIT_BYTES / 1024)) KiB" >&2
}
