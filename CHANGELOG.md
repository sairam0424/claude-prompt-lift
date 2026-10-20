# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- On Bedrock and Vertex an alias rung (`fable`, `sonnet`, `haiku`) is unpriced (`$?`) instead of priced as the family's current generation: the engine's alias defaults lag there and the mod cannot see which id answered; `status` says `aliases: unpriced on <platform>` and points at pinning full ids. Chains of full ids are unchanged.
- A skill left out by `skillExclude` is unknown everywhere: the few-shot example falls back to its skill-neutral form and a rewrite that names the skill is refused instead of being stripped to `the … skill`.
- Example 2 says `before-and-after numbers`, so a project with a top-level `before/` directory can no longer make the path guard refuse a copy; the static block's examples text changes once (one prompt-cache miss per user).

## [0.4.2] - 2026-10-20

### Fixed
- The day ledger keeps one row per session (`spend:<day>:<writer>` in the plugin store) and sums them on read, so two sessions pressing in the same instant both count toward the machine-wide day cap; 0.4.x's single `stats` row is migrated once and rows older than seven days are pruned (catalogue review of seed PR #341). Restart open sessions after updating: a 0.4.1 session left running can lose its later presses for the day.

## [0.4.1] - 2026-10-20

### Fixed
- `instructionExclude` now also applies to a named subproject's `CLAUDE.md`; an excluded file is neither read nor sent (catalogue review of seed PR #341).
- The day ledger's read-modify-write is serialized within the session: two presses recorded in the same instant no longer lose one press and its cost (catalogue review of seed PR #341).

### Documentation
- README links the 24-second launch film (`docs/launch-poster.jpg` → the MP4 attached to the v0.4.0 release).
- README trimmed to what a user needs (3,000 words from 4,900): the upgrade guide moved to `docs/UPGRADING.md`, the development, evals and demo notes to `docs/DEVELOPMENT.md`; the launch film now autoplays as `docs/launch.gif` (800×450, 12 fps) with the MP4 linked for sound.
- Launch film v2: the whole Claude Code session inside a terminal window with camera moves, callouts and a keystroke hint (same real take); `docs/launch.gif` (now 720×405, 10 fps) and the release MP4 and poster replaced.

## [0.4.0] - 2026-10-19

### Added
- Spend caps: `sessionCapUsd` and `dayCapUsd` options (0 = off) refuse a press before any model call once the mod's own ledger of priced presses reaches them.
- `/prompt-lift cap <usd|off>` moves the session cap for this session (plain decimals only).
- The band's idle and done rows end with ` · $Y left` (`(day)` when the day cap is tighter).
- `status` prints `caps:` and `session total (all tools):` lines.
- `/prompt-lift tail on|off|<N>` controls the conversation tail for this session.
- The idle and done rows show ` · tail N` while the tail is active.
- `status` prints `conversation: off` or `conversation: last N messages`.
- `extraRules` option appends project preferences to the rewrite rules as rule 11 (up to 1,000 characters, tag-like markup neutralised).
- The default rules text is unchanged when `extraRules` is empty.
- `/prompt-lift preview <draft>` prints the dynamic block a press would send, plus the static block's size and hash: no model call by the mod, no state change, and the printed text joins the transcript, so it is capped at 2,000 characters.
- `evals/`: three headless cases for `claude plugin eval` (`01-status`, `02-preview`, `03-enhance`); `evals/results/` is ignored.
- Demo recording `docs/demo.gif` (and its cast) made by `scripts/demo.sh`.
- `scripts/demo.sh` refuses any plugin path but this checkout, sanitises the account name and home path, and leaves the committed take untouched when a re-record fails.
- README `## Data handling` disclosure and a `### Keyboard` recipe for a single-key binding.
- `homepage`, `repository`, `license` and `keywords` in the manifest.

### Changed
- Renamed from prompt-master to prompt-lift: install id `prompt-lift@claude-prompt-lift`, command `/prompt-lift`.
- The marketplace `claude-prompt-lift` carries a `renames` map from prompt-master.
- State and day statistics start fresh after the rename.
- `scripts/typecheck.sh` now enforces `noUncheckedIndexedAccess`.
- The 31 errors it exposed are fixed with local narrowings, no `!` assertions.
- Test suite reorganised into smaller files (commands, status, sub-commands, caps, toast) with typed chain fixtures.
- Sub-command parsing moved to `hooks/subcommands.ts`.

### Fixed
- Non-success paths (`already specific`, refused, not taken) record through the guarded path and toast their verdict, so a failing stats write no longer replaces the verdict and its cost with `enhance failed`.
- A stale running phase is reset to done when the original is held (idle otherwise), so Undo stays reachable.
- Re-enhancing an enhanced draft keeps the original's decorations: Redo highlights everything added since the original.
- Undo with only the original held (the enhanced half missing) restores the draft, and Redo then answers `nothing to undo`.
- Toast truncation counts code points, so an emoji on the cut stays whole.
- Send refuses `@~/` and `@server:resource` mentions as well as `@file` (email addresses stay sendable).
- A `prices` key you set wins over a built-in key it contains.
- Skill demotion names the bare skill and moves the whole trailing `[.!?]+` run after the clause (`Write a commit.` becomes `Write a commit, using the /x skill.`).
- A rewrite that is only the skill and its marks (`/review...`) is left as it is.
- An unreachable branch in skill demotion is gone.
- The `done` phase write after a recorded result is guarded: a failure keeps the result and toasts `saved the result, but the band could not be updated`.
- A hash read that throws after the answer still records the call.
- `types/index.d.ts` no longer redeclares `PromptDecoration` (the engine's exported type is used).
- A short draft may grow by at least 400 characters (`max(400, 150 + 3 × draft length)`, still capped by `maxGrowthChars`), so the `fix the login bug` example is no longer refused as `rewrite too long` after the press was billed.
- The `write a commit` example names `/commit-commands:commit` only when the session has that skill (a plain rewrite otherwise), so a copy is no longer refused as `added a command or link you did not write`.
- Rule 3 and the `fix the login bug` and `fix the typo in README` examples no longer name `CLAUDE.md` or `README.md` (`per the project's test-first rule`, `Fix the typo in README.`), so a copy is no longer refused as `named a file that does not exist` in a project with no root `CLAUDE.md` or `README.md`.
- `/prompt-lift tail` takes a plain count only: `0x6`, `1e1`, `6.0` and `+6` get the usage toast, as `cap` does.
- `preview` prints at most 2,000 characters of the dynamic block and then `… N more characters (M total)`, so its output no longer fills the context the next turn reads.
- A link or path you wrote into `extraRules` is accepted when a rewrite repeats it, instead of being refused as `added a command or link you did not write` or `named a file that does not exist`.
- `extraRules` neutralises `< tag>`, `<tag/>` and `</ tag>` as well as `<tag>`.
- The slash-menu hint lists `tail <on|off|N>` and `preview <draft>`.
- `scripts/demo.sh` moves only the cast into `docs/` and keeps its work directory when the GIF is over 1 MiB.
- The static block changes once per user at upgrade.

### Documentation
- README `### Upgrading from prompt-master` walks a 0.3.x install to `prompt-lift@claude-prompt-lift` and its moved `enabledPlugins` and `pluginConfigs` keys.
- README `## Data handling` names the path guard's `$.fs.exists` probe on file-looking paths the rewrite introduces, absolute paths included; only existence is read.

## [0.3.1] - 2026-10-18

### Changed
- One blank row between prompt-master's band and whatever the mods beneath it draw in the shared above-prompt slot.

### Documentation
- README Limits explains the shared band: hooks nest in `enabledPlugins` order, a mod listed before prompt-master that draws without passing the band through hides it; move prompt-master's entry above it and `/reload-plugins`.
- A repository `verify` skill records how to drive the mod in a sandbox Claude Code session.

## [0.3.0] - 2026-10-18

### Added
- `prices` configuration option to override the built-in price table with custom per-model pricing
- Typed chain requests and `scripts/typecheck.sh` for static type checking
- Unpriced models show `$?` and `(no price)` in status output with `unpriced calls: N` counter
- Comprehensive test coverage for stats, guards, highlighting, and cost recording

### Changed
- Reply guard now applies only to drafts under 12 words and no longer triggers on `use`, `n`, or `y` tokens
- Toasts capped at 200 characters with `why` truncated to 60 and errors to 80
- Only token-initial `@` mentions block Send (email addresses are now sendable)
- Skill demotion applies only to command-shaped leading tokens and strips against the shown listing
- Truncation is now judged on the extracted prompt text
- Undo pair is held before cost recording (failure shows `saved the result, but recording its cost failed`)
- Stale running phase is drawn as idle and reset by commands
- Press stays in flight until its phase settles
- Clearer `effortModels` and `enhanceAction` configuration descriptions

### Fixed
- True highlight offsets for insertion runs; Redo now re-applies highlights correctly
- Cap the undo refusal toast to prevent overflow
- Record every paid call's cost, including those in the failure path
- A press that fell back to a later rung is priced by every rung it paid for, not the answering rung alone (toast, `status`, session and day totals)
- Day-key stats tracking in local time

## [0.2.0] - 2026-10-17

### Added
- Public README with installation, usage, and configuration documentation
- MIT license
- Marketplace publication as `claude-prompt-master`

### Changed
- Portable defaults: `models` now defaults to `fable,sonnet,haiku` and `effortModels` to `fable,sonnet`
- Alias-aware pricing recognizes model aliases in cost calculations
- No skill exclusions by default (empty `skillExclude`)

### Fixed
- Updating from a local clone now works with `/reload-plugins` instead of requiring `claude plugin update`

## [0.1.1] - 2026-10-16

### Fixed
- Cost recording now captures every paid call and displays it in the toast
- Undo is disarmed after every successful Enhance
- Held pair is preserved when a lower hook drops the prompt
- Sub-commands route only on exact word matches
- Rewrites starting with command prefixes are now refused
- Path guard checks only file-looking tokens
- Unknown skill slashes are stripped per token
- Edge punctuation stripped from protected, path, and command tokens
- Model sub-command guards against prose and invalid model ids
- Model alias pins resolve to the configured id they name
- Test coverage for usage records, flow splitting, and guard behavior

### Changed
- Usage record builder moved to `stats.ts`
- Pre-call guards moved to `preguard.ts`
- Block preparation moved to `prepare.ts`
- `keptShare` now measures deletions only (was counting unchanged words incorrectly)

## [0.1.0] - 2026-10-16

### Added
- Initial release with core prompt enhancement functionality
- Band row UI with Enhance, Send, Undo, Cancel, and Redo buttons
- Keyboard shortcuts: `ctrl+x b` for Enhance, `ctrl+x tab` to focus band
- Commands: `/prompt-master <text>`, `model`, `status`, `diff`, `probe`, `undo`
- Model chain with automatic fallback on refusal, rate limits, timeouts, and server errors
- Cost tracking with prompt caching support
- Pre-call guards: minimum word count, maximum draft size, command/reply detection
- Post-processing guards: growth limits, kept share enforcement, risky additions detection, file existence checks
- Instruction and skill selection based on project context
- Word-level diff highlighting in enhanced prompts
- Configuration via `pluginConfigs` in settings
- Comprehensive test suite with stubbed engine and model chain
