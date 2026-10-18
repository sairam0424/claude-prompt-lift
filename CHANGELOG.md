# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
