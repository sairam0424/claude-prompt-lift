# prompt-lift

A Claude Code mod that turns a vague prompt into a specific one before you send it. It reads the instruction files your session loaded (the `CLAUDE.md` tree and rules files) and the skills Claude can trigger, asks a model for the smallest edit that adds the missing facts, puts the result back in the prompt box with the inserted words highlighted, and sends only when you press Send or Enter. The mod tracks costs with prompt caching support, falls back through a model chain on failures, and validates rewrites against safety guards.

The band row appears above the prompt: `[ Enhance (e) ] [ Send (s) ] [ Undo (u) ]`; `Cancel (c)` while a call runs; `Send (queues)` while a turn runs; `Redo (u)` after an Undo. Nothing runs while idle: no timers, no per-keystroke hooks, a model call happens only on a press or a command.

Formerly prompt-master; renamed in 0.4.0 — install id prompt-lift@claude-prompt-lift.

## Install

From a Claude Code session:

```
/plugin install prompt-lift --marketplace sairam0424/claude-prompt-lift
```

Claude Code asks `y` to add the marketplace, then a scope (`user` makes it available in every project).

From a shell:

```bash
claude plugin marketplace add sairam0424/claude-prompt-lift
claude plugin install prompt-lift@claude-prompt-lift
```

From a local clone (the plugin is read live from the folder, so edits show up after `/reload-plugins`):

```bash
git clone https://github.com/sairam0424/claude-prompt-lift ~/src/claude-prompt-lift
claude plugin marketplace add ~/src/claude-prompt-lift
claude plugin install prompt-lift@claude-prompt-lift
```

Then, in a session:

1. `/reload-plugins` (or start a new one)
2. `/prompt-lift probe` — one line per model; `ok` means your account can call it
3. Type a draft like "write a commit" and press Enhance — the done row shows the number of skill descriptions matched into the dynamic block (≥ 1 when a commit skill such as commit-commands:commit is installed; 0 is correct otherwise)
4. If a model shows `refused`, set `models` to the rungs your account has (see Configuration)

## Using it

Three ways to press Enhance:
- `ctrl+x b` from the prompt (the Enhance button carries the engine action `app:cycleDiffBase`; works while the diff panel is closed)
- `ctrl+x tab` to focus the band, then `e`
- `/prompt-lift <your text>`

### Send vs Enter

Both send what is in the box. Send refuses drafts with `@file` mentions or pasted images (`prompt-lift: press Enter to send; @files and images only travel with Enter`) because a plugin-submitted prompt does not expand them.

### Undo

The original is kept until you submit or `/clear`. Undo acts only when the box still holds the enhanced text (or is empty); otherwise it says `box edited since Enhance; press Undo again within 10 s to discard` and acts on the second press. Undo is two-way (Redo).

### Commands

- `/prompt-lift <text>` — enhance the text
- `/prompt-lift undo` — restore the original draft
- `/prompt-lift model <id|alias|reset>` — put a model first for this machine (`sonnet`, `haiku`, a full id) or `reset` to the configured chain
- `/prompt-lift status` — the chain, the last call, session and per-day totals, the static block size and hash
- `/prompt-lift diff` — word-level diff of the last enhancement
- `/prompt-lift probe` — one tiny call per model in the chain, reporting `ok` or the refusal

A sub-word is recognised only when it is the whole argument (any case): `/prompt-lift diff the two configs and explain` is a draft to enhance, not the diff. `model` takes exactly one token; `model the auth flow as a state machine` is a draft too.

## What is sent to the model

- The instruction files Claude Code loaded for the session: Project, Local, Managed and `~/.claude/rules/*`. Not the auto-memory index. Not `~/.claude/CLAUDE.md` or `~/CLAUDE.md` by default (`instructionExclude`).
- Every skill name Claude lists, except MCP-provided ones. Nothing else is excluded by default; a large skill catalogue costs cached tokens, so leave out the namespaces you never want named with `skillExclude` (patterns match the whole name, `*` any run, `?` one character):

  ```json
  "skillExclude": "sparc:*,swarm:*,gws-*"
  ```

- The eight skill descriptions whose words best match the draft (`relevantSkills`).
- A subproject's `CLAUDE.md` when the draft names a top-level directory of the project that has one.
- The draft. Never your conversation unless `includeConversation` is on.

The instructions and skill names form one cached block, so a second press within five minutes reads it from the cache.

## Configuration

Settings live in `/config` under `pluginConfigs` → `prompt-lift@claude-prompt-lift` → `options`, or in your settings file:

```json
{
  "pluginConfigs": {
    "prompt-lift@claude-prompt-lift": {
      "options": {
        "minWords": 4,
        "skillExclude": "sparc:*,gws-*"
      }
    }
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `models` | string | `fable,sonnet,haiku` | Comma-separated models to try in order: an alias (`fable`, `sonnet`, `haiku`), a full model id, or `session` for the session's model |
| `effortModels` | string | `fable,sonnet` | Models that accept the effort parameter; they are sent effort: low |
| `maxTokens` | number | 2000 | Maximum tokens per model completion |
| `timeoutMsFirst` | number | 30000 | Timeout for the first model attempt |
| `timeoutMsNext` | number | 15000 | Timeout for fallback model attempts |
| `minWords` | number | 3 | Minimum word count to trigger enhancement |
| `maxDraftChars` | number | 4000 | Maximum characters in the draft prompt |
| `keptShareFloor` | number | 0.5 | Minimum fraction of the draft's words the rewrite must keep |
| `maxGrowthChars` | number | 1200 | Maximum character growth allowed |
| `relevantSkills` | number | 8 | Number of relevant skill descriptions to include |
| `instructionFileMaxChars` | number | 40000 | Maximum characters read from each instruction file |
| `enhanceAction` | string | `app:cycleDiffBase` | Engine keybinding action whose chord presses Enhance from the prompt (empty disables) |
| `filePrefix` | string | `plain` | How file paths appear in the rewrite (`plain` or `at`) |
| `skillPlacement` | string | `mention` | How a matched skill is named (`mention` mid-sentence, or `run` as a leading `/name`) |
| `includeConversation` | boolean | false | Include recent conversation history |
| `conversationMessages` | number | 6 | Number of recent messages to include |
| `skillPrefixAllow` | string | `""` | Skills allowed as a leading `/name` under `run` (empty for none) |
| `instructionExclude` | string | `~/.claude/CLAUDE.md,~/CLAUDE.md` | Instruction files to leave out |
| `skillExclude` | string | `""` | Skill name patterns left out of the listing (`*` and `?` wildcards); empty sends every skill Claude lists |
| `prices` | string | | A JSON **string** (quoted and escaped, not a bare object) mapping a model id fragment to per-1M-token prices, merged over the built-in table; invalid JSON or a malformed entry is ignored with a log line. See Cost for the exact form |

The chain falls back on a refused model, an empty reply, a rate limit, a server error and a timeout; never on your Cancel, never on a 400. The toast names every attempt.

### Bedrock users

On Bedrock the aliases resolve to whatever the build maps them to, and `effortModels` is matched by exact id, so pin both keys to your cross-region inference profiles:

```json
{
  "pluginConfigs": {
    "prompt-lift@claude-prompt-lift": {
      "options": {
        "models": "us.anthropic.claude-fable-5-1,us.anthropic.claude-sonnet-5-5,us.anthropic.claude-haiku-5-5",
        "effortModels": "us.anthropic.claude-fable-5-1,us.anthropic.claude-sonnet-5-5"
      }
    }
  }
}
```

These are the ids the cost table below prices and the rungs `/prompt-lift model sonnet` names. Run `/prompt-lift probe` once: a rung your account cannot call is reported as refused.

## Cost

Prices are USD per 1M tokens, Bedrock `us.*` profiles, verified 2026-10-16:

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| Fable 5.1 | 11.00 | 55.00 | 13.75 | 0.275 |
| Sonnet 5.5 | 2.20 | 11.00 | 2.75 | 0.11 |
| Haiku 5.5 | 0.11 | 0.55 | 0.1375 | 0.011 |

The table is Bedrock `us.*` cross-region pricing, which is Anthropic's list price plus 10%; on the Anthropic API expect about 10% less. An alias prices as the current generation of its family (`fable` as Fable 5.1, `sonnet` as Sonnet 5.5, `haiku` as Haiku 5.5); an unpriced model shows `$?` and `(no price)`.

The built-in price table can be overridden with the `prices` configuration option (see Configuration). The value is a JSON **string**, so in `settings.json` it is quoted and escaped rather than written as a nested object:

```json
"prices": "{\"fable-5-1\": {\"input\": 10, \"output\": 50, \"cacheWrite\": 12.5, \"cacheRead\": 0.25}}"
```

Each key is a model id fragment (`priceFor` matches an alias whole and a full id by substring) and replaces the built-in row of the same name wholesale. Invalid JSON or a malformed entry leaves the whole table at its defaults and logs `prompt-lift: prices option ignored: <reason>` once at session start. Claude Code validates plugin options against the manifest before the hooks module loads, so any non-string `prices` value is refused at load (a number produces `Prices must be a string`; an object is refused at the options boundary) and never reaches the mod.

Typical press with defaults (≈7k static tokens, ≈1.5k dynamic, ≈400 out):
- Fable: ≈ $0.13 cold / ≈ $0.04 warm
- Sonnet: ≈ $0.027 / ≈ $0.009
- Haiku: ≈ $0.0015 / ≈ $0.0006

The cache lives 5 minutes. Every toast that follows a model call ends with the call's real dollars — a successful rewrite, `already specific, left as is`, every refusal, and a chain that failed after a paid rung — and `status` counts them all (a refused press cost the same as an accepted one). A press that fell back to a later rung is priced by every rung it paid for: `via fable 5.1: no text` on the toast means Fable's tokens are in the dollars too, not only the answering model's. `/prompt-lift model haiku` switches to Haiku.

## Why was my draft refused?

Each refusal is one toast and leaves the box exactly as typed.

Before any model call (nothing is spent):

- `prompt-lift: commands and shell lines are sent as typed` — the draft starts with `/`, `!` or `#`. Press Enter: those lines run, they are not prompts.
- `prompt-lift: that reads like an answer to Claude's question` — the draft opens like a reply (`yes`, `no`, `ok`, `sure`, `go ahead`, `option 2`, …) when under 12 words, or is under 12 words right after Claude asked a question. Answer with Enter.
- `prompt-lift: under 3 words, nothing to enhance` — fewer than `minWords` words. Add a few, or lower `minWords`.
- `prompt-lift: over 4000 characters, already specific` — longer than `maxDraftChars`. Send it as it is, or raise the cap.

After the call (the toast ends with what the call cost):

- `reply hit the token cap, kept your prompt` — the rewrite ran to `maxTokens`. Shorten the draft or raise `maxTokens`.
- `the model returned nothing` — an empty rewrite. Press again, or `/prompt-lift model sonnet`.
- `rewrite too long, kept your prompt` — it grew past the allowance (the draft plus at most `maxGrowthChars`, scaled down for short drafts: 150 characters plus three times the draft) or added more than three sentences. Raise `maxGrowthChars`, or start from a fuller draft.
- `rewrite dropped too much of your prompt, kept it` — fewer than `keptShareFloor` (50%) of your draft's words of four letters or more survived. Lower the floor if you want freer rewrites.
- `changed a question into a task, kept your prompt` / `changed a task into a question, kept your prompt` — the rewrite flipped your intent. Phrase the draft so the question or the instruction is unmistakable.
- `lost a file or code reference from your draft, kept it` — a path, `@mention` or code token from the draft is missing in the rewrite. Press again; the model is told to keep them.
- `added a command or link you did not write, kept your prompt` — the rewrite introduced `rm`, `curl`, `wget`, `sudo` or `chmod`, a pipe to `sh`, `&&`, a URL or an absolute path that appears neither in your draft nor in the instruction files. If you want it, type it yourself.
- `rewrite starts with a command prefix, kept your prompt` — the rewrite begins with `!`, `#` or a `/word` that is not a listed skill, which Enter would run instead of send.
- `named a file that does not exist, kept your prompt` — the rewrite names a file-looking path (rooted, with an extension, or under a top-level directory of the project) that is not on disk. Prose such as `CI/CD` or `and/or` is not checked.
- `draft changed while enhancing, left as is` — you kept typing. Press Enhance again when the draft is ready.
- `no model answered · fable: rate_limit → sonnet: timeout → haiku: refused` — every rung failed; the trail names each outcome. `/prompt-lift probe` tells you which models your account can call.
- `cancelled, draft unchanged` — you pressed Cancel; no fallback was tried.
- `already specific, left as is` — not a refusal: the model judged the draft fine. The call is still billed.

## Updating

- Installed from GitHub: `claude plugin update prompt-lift@claude-prompt-lift`, then restart Claude Code.
- Installed from a clone: `git pull` in the clone, then `/reload-plugins` in a session (or start a new one). The folder is read live; `claude plugin update` only refreshes the recorded version.

## Limits

- **One band above the prompt, shared by every mod.** The engine draws the above-prompt band once; hooks run in the order of `enabledPlugins` in `~/.claude/settings.json` (earlier = outer). prompt-lift always passes the band through and stacks its row above whatever the mods beneath draw, but a mod listed *before* it that draws without passing through (the playground `token-weather` does) hides prompt-lift's row entirely: no buttons, no `ctrl+x b`, only the `/prompt-lift …` commands. Fix: move the `prompt-lift@claude-prompt-lift` line above that mod's line in `enabledPlugins`, then `/reload-plugins` (or restart). `/prompt-lift status` still works while the band is hidden.
- Terminal only (no desktop footer, no VS Code)
- No timers, no per-keystroke hooks
- One band row
- Shares your account's model quota with the main turn (a rate limit on the first rung falls back to the next and the toast says so)
- The mod sends instruction file text to the model; a hostile `CLAUDE.md` in a cloned repository can attempt prompt injection. The mod neutralizes tag-like markup and instructs the model to treat context as data, but the residual risk is yours to weigh when enhancing in untrusted repositories.

## Development

The plugin is read live from its folder. `claude plugin validate .` reads the manifest and the hooks module the way the engine will; `claude plugin test .` runs `tests/*.test.ts(x)`. Neither type-checks, so `bash scripts/typecheck.sh` is the type gate, best-effort: it finds the newest `claude-code.d.ts` Claude Code extracted with its plugin-authoring skill (under `/private/tmp/claude-*/bundled-skills/`, so absent after a reboot until that skill loads again in a session), writes a temporary tsconfig over that file plus `hooks/`, `types/` and `tests/`, and runs `tsc --noEmit` through `npx`. It prints the types file it used. With no types file on the machine it says so and exits 0; with only an older cached copy it says STALE, and an error it then reports may be the old build's rather than this code's.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Sairam Ugge.
