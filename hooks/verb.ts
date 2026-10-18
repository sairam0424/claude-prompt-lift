/**
 * Verb classification utilities for the prompt-lift mod.
 * Extracted from guards.ts to maintain file size discipline.
 */

export type VerbClass = "info" | "action" | "other";

export function verbClass(s: string): VerbClass {
  const INFO = new Set([
    "suggest",
    "explain",
    "review",
    "list",
    "show",
    "describe",
    "compare",
    "what",
    "why",
    "how",
    "is",
    "are",
    "does",
    "should",
  ]);
  const ACTION = new Set([
    "fix",
    "add",
    "change",
    "implement",
    "refactor",
    "remove",
    "write",
    "create",
    "update",
    "make",
    "delete",
    "rename",
    "move",
    "build",
  ]);

  let text = s.trim().toLowerCase();

  // Drop leading politeness
  text = text.replace(/^(can you|could you|please)\s+/i, "");

  const firstWord = text.split(/\s+/)[0];
  if (INFO.has(firstWord)) {
    return "info";
  }
  if (ACTION.has(firstWord)) {
    return "action";
  }
  return "other";
}
