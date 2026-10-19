import type { Config } from "./config";
import type { PromptDecoration } from "claude-code";
import { insertionDecorations, wordDiffInsertions } from "./diff";
import {
  protectedTokens as _protectedTokens,
  pathTokens as _pathTokens,
  commandTokens as _commandTokens,
  stripEdges,
} from "./tokens";
import { verbClass as _verbClass, type VerbClass } from "./verb";
import {
  demoteLeadingSkill as _demoteLeadingSkill,
  DANGEROUS_SKILL_WORDS as _DANGEROUS_SKILL_WORDS,
  startsWithCommandPrefix,
  stripUnknownSkills as _stripUnknownSkills,
} from "./skills";

// Pre-call guards (spec §5.4) live in preguard.ts; post-processing (§9) here.
import { wordCount } from "./preguard";
export {
  preGuard,
  REPLY_PREFIX,
  wordCount,
  type GuardResult,
} from "./preguard";

// Post-processing

export function cleanReply(text: string): string {
  let cleaned = text.trim();

  // Strip one outer fence when the whole reply is fenced and the inside has no fence
  const fenceMatch = cleaned.match(/^```[\s\S]*?```$/);
  if (fenceMatch) {
    const inner = cleaned.slice(3, -3);
    if (!inner.includes("```")) {
      cleaned = inner.trim();
    }
  }

  // Collapse 3+ newlines to 2
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned;
}

export type Verdict =
  | { verdict: "fine" }
  | { verdict: "improve"; prompt: string; why: string; applied: string[] };

export function parseVerdict(text: string): Verdict {
  // Try to find first {...} block
  const jsonMatch = text.match(/\{[^{}]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.verdict === "fine") {
        return { verdict: "fine" };
      }
      if (
        parsed.verdict === "improve" &&
        typeof parsed.prompt === "string" &&
        parsed.prompt.trim().length > 0
      ) {
        return {
          verdict: "improve",
          prompt: parsed.prompt,
          why: typeof parsed.why === "string" ? parsed.why : "",
          applied: Array.isArray(parsed.applied) ? parsed.applied : [],
        };
      }
    } catch {
      // Fall through to plain text handling
    }
  }

  // Unparseable or invalid → improve with cleaned text
  return {
    verdict: "improve",
    prompt: cleanReply(text),
    why: "",
    applied: [],
  };
}

export function isTruncated(
  outputTokens: number,
  maxTokens: number,
  text: string,
): boolean {
  if (outputTokens >= maxTokens - 8) {
    return true;
  }
  if (outputTokens > 0.9 * maxTokens) {
    const trimmed = text.trim();
    return !/[.!?)"'\]]$/.test(trimmed);
  }
  return false;
}

/**
 * The least a draft may grow by, so a one-line draft can become the 3-4
 * sentence prompt the built-in examples teach (R15). `maxGrowthChars` still
 * wins when a user sets it below this.
 */
export const MIN_GROWTH_CHARS = 400;

export function growthAllowed(
  draftLen: number,
  maxGrowthChars: number,
): number {
  return (
    draftLen +
    Math.min(maxGrowthChars, Math.max(MIN_GROWTH_CHARS, 150 + 3 * draftLen))
  );
}

export function sentenceCount(s: string): number {
  const parts = s.split(/[.!?]+\s|\n/);
  return parts.filter((p) => p.trim().length > 0).length;
}

export function keptShare(draft: string, result: string): number {
  // Extract words of 4+ letters
  const words = (s: string) =>
    Array.from(s.matchAll(/[\p{L}\p{N}_./-]{4,}/gu), (m) => m[0]);

  // Light stem: strip one trailing ing/ed/s, then lowercase
  const stem = (w: string) => {
    let stemmed = w;
    if (stemmed.endsWith("ing")) {
      stemmed = stemmed.slice(0, -3);
    } else if (stemmed.endsWith("ed")) {
      stemmed = stemmed.slice(0, -2);
    } else if (stemmed.endsWith("s")) {
      stemmed = stemmed.slice(0, -1);
    }
    return stemmed.toLowerCase();
  };

  const draftWords = new Set(words(draft).map(stem));

  if (draftWords.size < 3) {
    return 1;
  }

  // Spec C16: the share measures deletions only, so it is the draft's distinct
  // stems the result still carries over the draft's stems. Additions never
  // lower it; growth is bounded separately (§9.5).
  const resultWords = new Set(words(result).map(stem));
  const kept = [...draftWords].filter((w) => resultWords.has(w)).length;

  return kept / draftWords.size;
}

// Re-exported from verb.ts to maintain backward compatibility
export type { VerbClass };
export const verbClass = _verbClass;

// Re-exported from tokens.ts to maintain backward compatibility
export const protectedTokens = _protectedTokens;
export const pathTokens = _pathTokens;

// Spec §9.9: shell, pipe, chaining, network and absolute-path shapes.
const RISKY_SHAPES = [
  /\b(rm|curl|wget|sudo|chmod)\s/g,
  /\|\s*sh\b/g,
  /&&/g,
  /https?:\/\/\S+/g,
  /(^|\s)\/[A-Za-z][^\s]*/g,
];

/**
 * Tokens of a risky shape the result carries that neither the draft nor the
 * selected documents do; a listed skill's `/name` mention never counts
 * (controller ruling 1). Edge punctuation is stripped before comparing, so
 * `run /review.` names the skill, not `review.`.
 */
export function riskyAdditions(
  result: string,
  known: string,
  knownSkills: ReadonlySet<string>,
): string[] {
  const knownTokens = new Set((known.match(/\S+/g) ?? []).map(stripEdges));
  const isKnownWord = (token: string): boolean =>
    /^[a-zA-Z]+$/.test(token) && new RegExp(`\\b${token}\\b`).test(known);
  const isSkill = (token: string): boolean => {
    const name = token.startsWith("/") ? token.slice(1) : token;
    return knownSkills.has(name) || knownSkills.has(`/${name}`);
  };
  const risky: string[] = [];
  for (const shape of RISKY_SHAPES) {
    for (const match of result.match(shape) ?? []) {
      const token = stripEdges(match.trim());
      if (!knownTokens.has(token) && !isKnownWord(token) && !isSkill(token)) {
        risky.push(token);
      }
    }
  }
  return risky;
}

// Re-exported from tokens.ts to maintain backward compatibility
export const commandTokens = _commandTokens;

// Re-exported from skills.ts to maintain backward compatibility
export const DANGEROUS_SKILL_WORDS = _DANGEROUS_SKILL_WORDS;
export const demoteLeadingSkill = _demoteLeadingSkill;
export const stripUnknownSkills = _stripUnknownSkills;

// Re-exported from diff.ts
export { wordDiffInsertions };

export type PostOk = {
  ok: true;
  text: string;
  why: string;
  applied: string[];
  decorations: PromptDecoration[];
  addedWords: number;
};

export type PostResult =
  PostOk | { ok: false; fine: true } | { ok: false; toast: string };

export function postProcess(a: {
  draft: string;
  reply: string;
  outputTokens: number;
  cfg: Config;
  knownSkills: ReadonlySet<string>;
  listedSkills: ReadonlySet<string>;
  descriptions: ReadonlyMap<string, string>;
  documents: string;
}): PostResult {
  // Step 2: Parse verdict
  const verdict = parseVerdict(a.reply);

  // Step 3: Fine?
  if (verdict.verdict === "fine") {
    return { ok: false, fine: true };
  }

  const result = verdict.prompt;

  // Step 4: Truncated?
  if (isTruncated(a.outputTokens, a.cfg.maxTokens, result)) {
    return {
      ok: false,
      toast: "prompt-lift: reply hit the token cap, kept your prompt",
    };
  }

  // Step 5: Empty?
  if (result.trim().length === 0) {
    return { ok: false, toast: "prompt-lift: the model returned nothing" };
  }

  // Step 6: Growth (chars AND sentences)
  const allowed = growthAllowed(a.draft.length, a.cfg.maxGrowthChars);
  if (result.length > allowed) {
    return {
      ok: false,
      toast: "prompt-lift: rewrite too long, kept your prompt",
    };
  }

  const draftSentences = sentenceCount(a.draft);
  const resultSentences = sentenceCount(result);
  if (resultSentences > draftSentences + 3) {
    return {
      ok: false,
      toast: "prompt-lift: rewrite too long, kept your prompt",
    };
  }

  // Step 7: KeptShare
  const share = keptShare(a.draft, result);
  if (share < a.cfg.keptShareFloor) {
    return {
      ok: false,
      toast: "prompt-lift: rewrite dropped too much of your prompt, kept it",
    };
  }

  // Step 8: Verb class
  const draftClass = verbClass(a.draft);
  const resultClass = verbClass(result);
  if (draftClass === "info" && resultClass === "action") {
    return {
      ok: false,
      toast: "prompt-lift: changed a question into a task, kept your prompt",
    };
  }
  if (draftClass === "action" && resultClass === "info") {
    return {
      ok: false,
      toast: "prompt-lift: changed a task into a question, kept your prompt",
    };
  }

  // Step 9: Protected tokens
  const protectedToks = protectedTokens(a.draft);
  for (const token of protectedToks) {
    if (!result.includes(token)) {
      return {
        ok: false,
        toast:
          "prompt-lift: lost a file or code reference from your draft, kept it",
      };
    }
  }

  // Step 10: Risky additions
  const known = a.draft + "\n" + a.documents;
  const risky = riskyAdditions(result, known, a.knownSkills);
  if (risky.length > 0) {
    return {
      ok: false,
      toast:
        "prompt-lift: added a command or link you did not write, kept your prompt",
    };
  }

  // Step 12: Strip unknown skills
  let processed = stripUnknownSkills(result, a.listedSkills);

  // §5.4's prefixes: a line Enter would run instead of send (§2 anti-goal)
  if (startsWithCommandPrefix(processed, a.knownSkills)) {
    return {
      ok: false,
      toast:
        "prompt-lift: rewrite starts with a command prefix, kept your prompt",
    };
  }

  // Step 13: Demote leading skill
  processed = demoteLeadingSkill(processed, {
    draft: a.draft,
    cfg: a.cfg,
    descriptions: a.descriptions,
  });

  // Unchanged?
  if (processed === a.draft) {
    return { ok: false, fine: true };
  }

  const decorations = insertionDecorations(a.draft, processed);

  const addedWords = Math.max(0, wordCount(processed) - wordCount(a.draft));

  return {
    ok: true,
    text: processed,
    why: verdict.why,
    applied: verdict.applied,
    decorations,
    addedWords,
  };
}
