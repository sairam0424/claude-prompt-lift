---
name: verify
description: Run the prompt-master mod in a real, isolated Claude Code session and observe the band, Enhance, Undo/Redo, Send and status at the terminal surface (not the test kit).
---

# Verifying prompt-master at its surface

The mod's surface is the Claude Code prompt band. `claude plugin test` is CI; this is runtime observation.

## Handle

1. Sandbox project (fresh git repo with a small `CLAUDE.md` and one source file), e.g. `mktemp -d /tmp/pm-verify.XXXX`.
2. Isolated tmux server: `tmux -L pmverify new-session -d -s w -x 150 -y 42 -c "$DIR" "claude --settings /tmp/pm-verify-settings.json"`.
   The settings file disables other mods that draw the above-prompt band (the engine draws ONE instance; token-weather,
   blast-radius and replay-theater from claude-code-playground-mods shadow it):
   `{"enabledPlugins":{"token-weather@claude-code-playground-mods":false,"blast-radius@claude-code-playground-mods":false,"replay-theater@claude-code-playground-mods":false}}`
3. Wait ~16 s, answer the trust prompt (`Down`, `Enter`), wait ~25 s. Capture with `tmux -L pmverify capture-pane -p -t w`.

## Drive

- Idle band: `[ Enhance (e) ] ctrl+x b · or ctrl+x tab, e · prompt-master: <model>`.
- Type a draft (no Enter), send `C-x b` → `[ Cancel (c) ] Enhancing with …` → ~10 s → done row with cost and the filled box.
- Band hotkeys need band focus: `C-x Tab` then `u` (Undo/Redo) or `s` (Send).
- Command path without the band: `/prompt-master <draft>`, `/prompt-master undo|status|probe`.
- A second Enhance within 5 min shows `N cached` and a sub-cent cost.
- Free probes: `yes go ahead` + Enhance → `that reads like an answer`; `see @src/x.ts` + Send → `press Enter to send; …`; empty box + Send → `nothing to send`.
- Toasts are transient: capture within ~1.5 s (`grep -oE 'prompt-master: [^│]*'`).

## Gotchas

- Clear the box with `tmux send-keys -N 400 BSpace` before typing any slash command: text typed into a non-empty box is APPENDED, and Enter then submits a real turn (the session's plugin context makes the first turn ≈ $1.7 on Fable).
- `Ctrl+U` clears only the current line of a multi-line draft.
- Every real turn (Enter or Send) clears the held Undo pair by design.
- The first Enhance of a session writes the prompt cache (~$0.15 on Fable with a 10k-token static block).
