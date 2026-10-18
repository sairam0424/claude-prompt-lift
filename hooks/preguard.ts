import type { Config } from "./config";

// Spec §5.4: the guards before any model call. Each refusal is one toast and
// the draft is left exactly as typed.

export const REPLY_PREFIX =
  /^\s*(yes|no|ok|okay|sure|go ahead|proceed|continue|do it|option\s+\w+)\b/i;

// Spec §5.4: threshold for short drafts (both reply prefix and question rules)
const SHORT_DRAFT_THRESHOLD = 12;

export function wordCount(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export type GuardResult = { ok: true } | { ok: false; toast: string };

export function preGuard(
  draft: string,
  cfg: Config,
  lastAssistant: string | undefined,
): GuardResult {
  const trimmed = draft.trim();

  // Check 1: Command/shell lines (starts with /, !, or #)
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("!") ||
    trimmed.startsWith("#")
  ) {
    return {
      ok: false,
      toast: "prompt-lift: commands and shell lines are sent as typed",
    };
  }

  // Check 2: Reply-like drafts
  // Either: matches REPLY_PREFIX when draft < SHORT_DRAFT_THRESHOLD words
  // Or: last assistant message ends with ? and draft < SHORT_DRAFT_THRESHOLD words
  const isReplyPrefix =
    REPLY_PREFIX.test(draft) && wordCount(draft) < SHORT_DRAFT_THRESHOLD;
  const isShortAnswerToQuestion =
    lastAssistant !== undefined &&
    lastAssistant.trim().endsWith("?") &&
    wordCount(draft) < SHORT_DRAFT_THRESHOLD;

  if (isReplyPrefix || isShortAnswerToQuestion) {
    return {
      ok: false,
      toast: "prompt-lift: that reads like an answer to Claude's question",
    };
  }

  // Check 3: Too short
  const words = wordCount(draft);
  if (words < cfg.minWords) {
    return {
      ok: false,
      toast: `prompt-lift: under ${cfg.minWords} words, nothing to enhance`,
    };
  }

  // Check 4: Too long
  if (draft.length > cfg.maxDraftChars) {
    return {
      ok: false,
      toast: `prompt-lift: over ${cfg.maxDraftChars} characters, already specific`,
    };
  }

  return { ok: true };
}
