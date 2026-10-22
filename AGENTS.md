# Repository Guidelines

## Project Structure & Module Organization
prompt-lift is a Claude Code mod: an in-process TypeScript hooks module, not a Node app. `hooks/hooks.json` points at `hooks/register.tsx`, which registers the hooks and the `/prompt-lift` command. An Enhance press runs `enhance.ts`: `gather.ts` and `context.ts` read the session, `prepare.ts` builds a cached static block and a dynamic block, `chain.ts` calls the model rungs with fallback, `preguard.ts` and `guards.ts` refuse or post-check, and `record.ts` keeps the pair Undo restores. `band.tsx` draws the one-row band from `band-row.tsx`. Spend lives in `ledger.ts`, `stats.ts` and `caps.ts`, and `types/index.d.ts` declares the state keys.

Engine calls go through a wrapper in `hooks/api.ts` (only `register.tsx` keeps two of its own); otherwise the validator's access report is cut (see `docs/DEVELOPMENT.md`). There are no timers: the band redraws on state writes. `evals/` holds three eval cases; `scripts/` the demo recorder and the gates.

## Build, Test, and Development Commands
No build step; the plugin is read live from this folder.
```bash
claude plugin test .                                 # exits 1 on a failure
claude plugin validate .
bash scripts/typecheck.sh                            # the type gate
bash scripts/check-footprint.sh                      # release gate: validator report not cut
shellcheck scripts/*.sh && bash scripts/demo-selftest.sh
bash scripts/demo.sh --plugin-dir "$PWD" --dry-run   # a real session, no model call
claude plugin eval . --ablation none --no-publish    # three cases, one cheap model call
```

## Coding Style & Naming Conventions
No linter or formatter config is committed; match the existing Prettier style: two spaces, double quotes, semicolons, trailing commas, about 80 columns. Hooks files stay under about 400 lines, so split before growing. Band colours are theme keys, never hex.

## Testing Guidelines
Tests import their kit from `claude-code/testing`; `tests/engine.ts` builds the stub engine and `tests/band-helpers.ts` the band scaffolding. Name files `tests/<area>.test.ts(x)`. They are hermetic: mocked clock, in-memory files.

`claude plugin test .` is the gate: its exit code (1 on a failure) is the verdict, and `--filter` is ignored. The undocumented per-file mode (`--file <abs-path> <folder>`) always exits 0: read the `failure` or `error` field of its report line, then finish with the full run.

## Commit & Pull Request Guidelines
History uses Conventional Commits scoped `prompt-lift` (`fix(prompt-lift): …`), the why in the body, no `Co-Authored-By` trailer. Each release adds a `CHANGELOG.md` entry, bumps the version only in `.claude-plugin/plugin.json`, and is a `vX.Y.Z` tag on `main`.

## Agent Instructions
Work in a git worktree, never in an installed checkout. In a real session, Enter on a non-empty prompt box submits a paid turn; `.claude/skills/verify/SKILL.md` shows how to drive the band safely.
