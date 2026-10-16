# prompt-master

A Claude Code mod that enhances vague prompts using your project's loaded instructions and skill catalog before you send them. The band row appears above the prompt: `[ Enhance (e) ] [ Send (s) ] [ Undo (u) ]`; `Cancel (c)` while a call runs; `Send (queues)` while a turn runs; `Redo (u)` after an Undo.

## Usage

Three ways to press Enhance:
- `ctrl+x b` from the prompt (the Enhance button carries the engine action `app:cycleDiffBase`; works while the diff panel is closed)
- `ctrl+x tab` to focus the band then `e`
- `/prompt-master <your text>`

### Send vs Enter

Both send what is in the box. Send refuses drafts with `@file` mentions or pasted images ("press Enter to send; @files and images only travel with Enter") because a plugin-submitted prompt does not expand them.

### Undo

The original is kept until you submit or `/clear`. Undo acts only when the box still holds the enhanced text (or is empty), otherwise press Undo twice within 10 seconds. Undo is two-way (Redo).

## Commands

- `/prompt-master <text>` — enhance the text
- `/prompt-master undo` — restore the original draft
- `/prompt-master model <id|alias|reset>` — switch model or reset to chain
- `/prompt-master status` — show the last call, the session and per-day totals, the block size and hash
- `/prompt-master diff` — show word-level diff of last enhancement
- `/prompt-master probe` — test each model in chain

A sub-word is recognised only when it is the whole argument (any case): `/prompt-master diff the two configs and explain` is a draft to enhance, not the diff. `model` takes exactly one token; `model the auth flow as a state machine` is a draft too.

## What Goes to the Model

The instruction files Claude Code loaded for the session (Project, Local, Managed, and `~/.claude/rules/*`; NOT the auto-memory index; NOT `~/.claude/CLAUDE.md` or `~/CLAUDE.md` by default — see `instructionExclude`), the skill names Claude actually receives (minus `mcp` and the `skillExclude` namespaces), the top-8 keyword-matched skill descriptions, a subproject's CLAUDE.md when the draft names it, and the draft. Never your conversation unless `includeConversation` is on.

## Cost Per Press

Costs with Bedrock us.* profiles (verified 2026-10-16; USD per 1M tokens):

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| Fable 5.1 | 11.00 | 55.00 | 13.75 | 0.275 |
| Sonnet 5.5 | 2.20 | 11.00 | 2.75 | 0.11 |
| Haiku 5.5 | 0.11 | 0.55 | 0.1375 | 0.011 |

Typical press with defaults (≈7k static tokens, ≈1.5k dynamic, ≈400 out):
- Fable: ≈ $0.13 cold / ≈ $0.04 warm
- Sonnet: ≈ $0.027 / ≈ $0.009
- Haiku: ≈ $0.0015 / ≈ $0.0006

The cache lives 5 minutes. Every toast that follows a model call ends with the call's real dollars — a successful rewrite, "already specific, left as is", every refusal, and a chain that failed after a paid rung — and `status` counts them all (a refused press cost the same as an accepted one). `/prompt-master model haiku` switches to Haiku.

## What Is Refused

Each refusal is one toast and leaves the box untouched. Beyond the pre-call guards (commands and shell lines, replies, too short, too long), a rewrite is refused when it hits the token cap, grows too much, drops too much of the draft, turns a question into a task or back, loses a path or `@mention` the draft had, adds a command or link you did not write, or starts with a command prefix — `!`, `#`, or a `/` that is not a listed skill — because Enter would run it. Paths and prose are told apart: a sentence may end with `src/auth.ts.` and still carry `src/auth.ts`, and only tokens that look like files (rooted, carrying an extension, or under a directory of the project root) must exist, so `CI/CD` and `and/or` pass.

## Configuration

All settings are in `/config` under `pluginConfigs.prompt-master`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `models` | string | `us.anthropic.claude-fable-5-1,us.anthropic.claude-sonnet-5-5,us.anthropic.claude-haiku-5-5` | Comma-separated list of model IDs to try in order |
| `effortModels` | string | `us.anthropic.claude-fable-5-1,us.anthropic.claude-sonnet-5-5` | Comma-separated list of models for high-effort prompts |
| `maxTokens` | number | 2000 | Maximum tokens per model completion |
| `timeoutMsFirst` | number | 30000 | Timeout for the first model attempt |
| `timeoutMsNext` | number | 15000 | Timeout for fallback model attempts |
| `minWords` | number | 3 | Minimum word count to trigger enhancement |
| `maxDraftChars` | number | 4000 | Maximum characters in the draft prompt |
| `keptShareFloor` | number | 0.5 | Minimum fraction of original words to keep |
| `maxGrowthChars` | number | 1200 | Maximum character growth allowed |
| `relevantSkills` | number | 8 | Number of relevant skills to include |
| `instructionFileMaxChars` | number | 40000 | Maximum characters to read from instruction files |
| `enhanceAction` | string | `app:cycleDiffBase` | Action to trigger after enhancement |
| `filePrefix` | string | `plain` | How to prefix file paths in prompts (`plain` or `at`) |
| `skillPlacement` | string | `mention` | How to include skills in prompts (`mention` or `run`) |
| `includeConversation` | boolean | false | Include recent conversation history in prompts |
| `conversationMessages` | number | 6 | Number of recent messages to include |
| `skillPrefixAllow` | string | `""` | Comma-separated list of allowed skill prefixes (empty for none) |
| `instructionExclude` | string | `~/.claude/CLAUDE.md,~/CLAUDE.md` | Comma-separated list of instruction files to exclude |
| `skillExclude` | string | `sparc:*,swarm:*,hive-mind:*,coordination:*,hooks:*,monitoring:*,optimization:*,analysis:*,automation:*,memory:*,expo:*,render:*,claude-seo:*,gws-*` | Comma-separated list of skill patterns to exclude |

## Limits

- Terminal only (no desktop footer, no VS Code)
- No timers, no per-keystroke hooks
- One band row
- Shares the Bedrock quota with the main turn (a Fable rate limit falls back to Sonnet and the toast says so)

## Installation

Add the local marketplace and install at user scope:

```bash
claude plugin marketplace add /Users/sairamugge/src/prompt-master
claude plugin install prompt-master@prompt-master-local --scope user
```

## Updating

The install is a copy, not a reference: `claude plugin install` records the repo's commit and copies the tree into `~/.claude/plugins/cache/prompt-master-local/prompt-master/<version>/`, and that copy is what a running session loads. Editing `~/src/prompt-master` and running `/reload-plugins` reloads the unchanged copy. After a change:

```bash
git -C ~/src/prompt-master commit -am "fix(prompt-master): …"
claude plugin update prompt-master@prompt-master-local
```

then restart Claude Code (`claude plugin update` says "restart required to apply"). The cache directory is named after `version` in `.claude-plugin/plugin.json`; bump it when a change must be told apart from the previous install, or uninstall and install again:

```bash
claude plugin uninstall prompt-master@prompt-master-local
claude plugin install prompt-master@prompt-master-local --scope user
```

The repo has no remote, so there is nothing to pull.

## First-Run Checklist

After installation, in a live Claude session:

1. `/reload-plugins`, then `/plugin` should list prompt-master as an active mod
2. `/prompt-master probe` → three `ok` lines; if a Sonnet or Haiku id is refused, set `models` in `/config` (pluginConfigs) to the ids your account enables
3. Type a vague draft, `ctrl+x tab`, `e` (or `ctrl+x b`) → the box is replaced, inserted words are underlined, a toast shows tokens and dollars (a refusal toast ends with dollars too)
4. Press Enhance again within five minutes → the toast shows a non-zero `cached` count; if it stays `(no cache)` three times the row says so
5. Press Send on a plain draft → it submits and the box clears; Undo then Redo
6. `/prompt-master status`
