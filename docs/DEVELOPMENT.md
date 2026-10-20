# Development

Back to the [README](../README.md).

The plugin is read live from its folder. `claude plugin validate .` reads the manifest and the hooks module the way the engine will; `claude plugin test .` runs `tests/*.test.ts(x)`. Neither type-checks, so `bash scripts/typecheck.sh` is the type gate, best-effort: it finds the newest `claude-code.d.ts` Claude Code extracted with its plugin-authoring skill (under `/private/tmp/claude-*/bundled-skills/`, so absent after a reboot until that skill loads again in a session), writes a temporary strict tsconfig (with `noUncheckedIndexedAccess`) over that file plus `hooks/`, `types/` and `tests/`, and runs `tsc --noEmit` through `npx`. It prints the types file it used. With no types file on the machine it says so and exits 0; with only an older cached copy it says STALE, and an error it then reports may be the old build's rather than this code's.

## Evals

`evals/` holds three cases for `claude plugin eval`, which loads only this plugin into a throwaway `claude -p` session and matches a regex against that session's trace:

- `01-status`: `/prompt-lift status` must print the `chain:` row. No model call.
- `02-preview`: `/prompt-lift preview <draft>` must print the `dynamic block (sent uncached)` marker. No model call.
- `03-enhance`: `/prompt-lift <draft>` runs the Enhance chain once (`runs: 1`, one model call). A headless run has no prompt box, so the rewrite is refused (`no_composer`) and the mod says so in a toast; the trace records that toast as a `ui_toast` line ending with the call's price. The case passes when that toast carries a real price, which shows the chain reached a model. It does not grade the rewrite. It needs working provider credentials and a chain rung with a price in the table: without them the toast reads `no model answered` or carries `$?`, and the case goes red. A call cheap enough to render as `$0.000` is rejected as well, by the grader's `(?!0\.000)` guard.

Run it from a shell that has your provider variables (Bedrock or Anthropic), because each run inherits them:

```bash
claude plugin eval . --ablation none --no-publish
```

`--ablation none` drops the default no-plugin baseline arm, which sends the same text to the session model as plain chat: it costs money and says nothing about this plugin. `--no-publish` keeps the HTML report local; without it the report is also published to claude.ai when the account supports that. Add `--trust-plugin` to skip the first-run trust prompt in CI. Results go to `evals/results/`, which is gitignored.

Measured on 2026-10-19 with Claude Code 2.1.303: 7 runs in 47 s, 3 of 3 cases passing, and the harness billed $0.00, because the one model call is made by the mod and priced by the mod (its toast showed $0.01 in that run, $0.03 in an earlier one). The same suite with the default baseline arm cost $0.42, all of it in the baseline arms.

## Demo

From the repo root, `bash scripts/demo.sh --plugin-dir "$PWD"` records `docs/demo.cast` and converts it to `docs/demo.gif`. It builds a throwaway project, loads this checkout with `--plugin-dir` (it refuses any other path, so the live install is never recorded), drives a real session in an isolated tmux server (`tmux -L pldemo`) under `asciinema rec`, and converts the take with `agg`. It needs `tmux`, `asciinema`, `agg` (`brew install agg`), `jq`, `claude`, `python3` and `git`, and the provider variables of a working Claude Code login. Every run leaves a trust entry for its throwaway `/private/tmp/pl-demo.*` project in `~/.claude.json`; the script does not remove it.

The take makes one real Enhance call (about $0.01 to $0.20), never presses Send, and enters nothing but `/prompt-lift status`. Pass `--shots-dir DIR` to keep a screen capture of each step. Before conversion the script replaces the account name and home path in the cast with same-length placeholders (the status output lists `~/.claude/rules` files) and drops the tmux detach line from the end; it then fails the run, discarding the paid take, if the account name still shows anywhere in the cast in any letter case, and warns when the cast passes 240 KiB. The take is recorded and converted inside the sandbox and moved into `docs/` only after the sanitize step, the content check and the conversion all pass, so a failed re-record leaves the committed cast and GIF untouched.
