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

From the repo root, `bash scripts/demo.sh --plugin-dir "$PWD"` records `docs/demo.cast` and converts it to `docs/demo.gif`. It builds a throwaway project, loads this checkout with `--plugin-dir` (it refuses any other path, so the live install is never recorded), drives a real session in an isolated tmux server (`tmux -L pldemo`) under `asciinema rec`, and converts the take with `agg`. It needs `tmux`, `asciinema`, `agg` (`brew install agg`), `jq`, `claude`, `python3` and `git`, and a working provider login (Bedrock, Vertex or an API key).

The session runs under an isolated HOME, `/tmp/pl-demo.XXXX/home`, so the recording shows a representative setup instead of yours: one rules file (`.claude/rules/testing.md`, a `# Testing` heading and two lines), the engine's bundled skills only, and no other plugin. The HOME holds a `.claude/settings.json` with the neutral status line, a `.claude.json` seeded with `hasCompletedOnboarding`, `lastOnboardingVersion` (the installed `claude --version`) and `theme` so no onboarding screen appears (the folder-trust menu stays and the script answers it), and a symlink `.aws` to your `~/.aws` when it exists, because SSO caches and config resolve from HOME; the script only links it, removes the link before it deletes the sandbox, and never touches the target (the AWS SDK may refresh a cached SSO token through the link, as in any session). HOME is passed as its physical path (`/private/tmp/...` on macOS): the engine reports real paths and the mod recognises `~/.claude/rules/` files by their textual prefix under HOME. On Bedrock the settings file also pins the README's full model ids (`models` and `effortModels` for `prompt-lift@inline`, the id a `--plugin-dir` plugin gets), because an alias chain is unpriced (`$?`) there and the done row must show dollars.

The provider login travels by name. The script copies only the variables on its `PROVIDER_VARS` allow-list (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `AWS_REGION`, `AWS_DEFAULT_REGION`, `AWS_PROFILE`, `ANTHROPIC_DEFAULT_FABLE_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`) from your shell environment, or failing that from the `env` object of `~/.claude/settings.json`; nothing else in that file is read. The values go to `claude` through the environment of the tmux server (a shell builtin, so they appear in no argument list), are never printed, logged or written to a file or the cast, and the script prints the variable names only.

The take makes one real Enhance call (about $0.01 to $0.20), never presses Send, and enters nothing but `/prompt-lift status`. Pass `--shots-dir DIR` to keep a screen capture of each step. Pass `--dry-run` to stop after the idle band and `/prompt-lift status`: it makes no model call (so it costs $0), starts no recorder and leaves `docs/` alone, and it fails unless the band is prompt-lift's alone, `status` lists exactly one rules file under the sandbox HOME, and neither the real home path nor the account name is on screen. Use it until the sandbox is right, then take the paid run. Every run's trust entry for its throwaway `/private/tmp/pl-demo.*` project lands in the sandbox's own `.claude.json` and goes with the sandbox, so your `~/.claude.json` is untouched.

Before conversion the script replaces the account name and the real home path in the cast with same-length placeholders and drops the tmux detach line from the end; the isolated HOME keeps both off screen, so the replacement is a safety net, and the run still fails, discarding the paid take, if the account name shows anywhere in the cast in any letter case. It warns when the cast passes 240 KiB. The take is recorded and converted inside the sandbox and moved into `docs/` only after the sanitize step, the content check and the conversion all pass, so a failed re-record leaves the committed cast and GIF untouched.
