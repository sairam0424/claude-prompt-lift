/**
 * Skill placement and filtering utilities for the prompt-master mod.
 * Extracted from guards.ts to maintain file size discipline.
 */

import type { Config } from "./config";

export const DANGEROUS_SKILL_WORDS =
  /\b(push|deploy|merge|ship|delete|publish|release)\b/i;

export function demoteLeadingSkill(
  result: string,
  a: {
    draft: string;
    cfg: Config;
    descriptions: ReadonlyMap<string, string>;
  },
): string {
  const tokens = result.split(/\s+/);
  if (tokens.length === 0) {
    return result;
  }

  const first = tokens[0];
  if (!first.startsWith("/")) {
    return result;
  }

  const skillName = first.slice(1);
  const description =
    a.descriptions.get(skillName) || a.descriptions.get(first);

  // Check conditions for keeping at the front
  const runAllowed =
    a.cfg.skillPlacement === "run" &&
    (a.cfg.skillPrefixAllow.includes(skillName) ||
      a.cfg.skillPrefixAllow.includes(first));

  // Check for dangerous words in description
  const isDangerous = description && DANGEROUS_SKILL_WORDS.test(description);

  // Check for overlapping words in draft
  let hasOverlap = false;
  if (description) {
    const descWords =
      description.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];
    const draftWords = new Set(
      (a.draft.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).map((w) => {
        // Light stem
        if (w.endsWith("ing")) return w.slice(0, -3);
        if (w.endsWith("ed")) return w.slice(0, -2);
        if (w.endsWith("s")) return w.slice(0, -1);
        return w;
      }),
    );

    const distinctMatches = new Set(
      descWords
        .map((w) => {
          // Light stem
          if (w.endsWith("ing")) return w.slice(0, -3);
          if (w.endsWith("ed")) return w.slice(0, -2);
          if (w.endsWith("s")) return w.slice(0, -1);
          return w;
        })
        .filter((w) => draftWords.has(w)),
    );

    hasOverlap = distinctMatches.size >= 2;
  }

  // If conditions met and not dangerous, keep at front
  if (runAllowed && hasOverlap && !isDangerous) {
    return result;
  }

  // Otherwise, move to end as a mention
  const rest = tokens.slice(1).join(" ");
  if (rest.length === 0) {
    return result;
  }

  // Capitalize first word of rest
  const capitalized = rest.charAt(0).toUpperCase() + rest.slice(1);
  return `${capitalized}, using the ${first} skill`;
}
