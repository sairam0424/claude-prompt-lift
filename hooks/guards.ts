import type { Config } from "./config";

export const REPLY_PREFIX =
  /^\s*(y|yes|no|n|ok|okay|sure|go ahead|proceed|continue|do it|use|option\s+\w+)\b/i;

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
      toast: "prompt-master: commands and shell lines are sent as typed",
    };
  }

  // Check 2: Reply-like drafts
  // Either: matches REPLY_PREFIX at any length
  // Or: last assistant message ends with ? and draft < 12 words
  const isReplyPrefix = REPLY_PREFIX.test(draft);
  const isShortAnswerToQuestion =
    lastAssistant !== undefined &&
    lastAssistant.trim().endsWith("?") &&
    wordCount(draft) < 12;

  if (isReplyPrefix || isShortAnswerToQuestion) {
    return {
      ok: false,
      toast: "prompt-master: that reads like an answer to Claude's question",
    };
  }

  // Check 3: Too short
  const words = wordCount(draft);
  if (words < cfg.minWords) {
    return {
      ok: false,
      toast: `prompt-master: under ${cfg.minWords} words, nothing to enhance`,
    };
  }

  // Check 4: Too long
  if (draft.length > cfg.maxDraftChars) {
    return {
      ok: false,
      toast: `prompt-master: over ${cfg.maxDraftChars} characters, already specific`,
    };
  }

  return { ok: true };
}
