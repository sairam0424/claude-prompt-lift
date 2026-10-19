import type { Config } from "./config";
import { examplesText } from "./rules";

export type MemoryFile = {
  path: string;
  type: string;
  tokens: number;
};

export type SkillEntry = {
  name: string;
  source: string;
  pluginName?: string;
};

export type CommandEntry = {
  name: string;
  description: string;
  source: string;
};

export function expandHome(p: string, home: string): string {
  if (p.startsWith("~/")) {
    return home + p.slice(1);
  }
  return p;
}

export function globMatch(pattern: string, value: string): boolean {
  // Convert glob pattern to regex
  let regexPattern = "";
  for (const ch of pattern) {
    if (ch === "*") {
      regexPattern += ".*";
    } else if (ch === "?") {
      regexPattern += ".";
    } else {
      // Escape special regex characters
      regexPattern += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }

  // Anchor the pattern at both ends
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(value);
}

function isExcluded(
  path: string,
  patterns: readonly string[],
  home: string,
): boolean {
  for (const pattern of patterns) {
    const expandedPattern = expandHome(pattern, home);
    if (globMatch(expandedPattern, path)) {
      return true;
    }
  }
  return false;
}

export function selectInstructionFiles(
  files: readonly MemoryFile[],
  cfg: Config,
  home: string,
): MemoryFile[] {
  const result: MemoryFile[] = [];
  const rulesPrefix = home + "/.claude/rules/";

  for (const file of files) {
    // Always drop AutoMem
    if (file.type === "AutoMem") {
      continue;
    }

    // Keep Project, Local, Managed
    if (
      file.type === "Project" ||
      file.type === "Local" ||
      file.type === "Managed"
    ) {
      if (!isExcluded(file.path, cfg.instructionExclude, home)) {
        result.push(file);
      }
      continue;
    }

    // Keep User only if under ~/.claude/rules/
    if (file.type === "User") {
      if (file.path.startsWith(rulesPrefix)) {
        if (!isExcluded(file.path, cfg.instructionExclude, home)) {
          result.push(file);
        }
      }
      continue;
    }
  }

  return result;
}

export function selectSkillNames(
  skills: readonly SkillEntry[],
  cfg: Config,
): string[] {
  const names = new Set<string>();

  for (const skill of skills) {
    // Drop mcp source
    if (skill.source === "mcp") {
      continue;
    }

    // Check against skillExclude
    let excluded = false;
    for (const pattern of cfg.skillExclude) {
      if (globMatch(pattern, skill.name)) {
        excluded = true;
        break;
      }
    }

    if (!excluded) {
      names.add(skill.name);
    }
  }

  // Return sorted unique names
  return Array.from(names).sort();
}

export function sanitizeDescription(d: string): string | undefined {
  // Check for forbidden patterns
  const forbidden = /\b(always|never|you must|ignore|instruction)\b/i;
  if (forbidden.test(d)) {
    return undefined;
  }

  // Return first 160 chars
  return d.slice(0, 160);
}

// Envelope tag names to neutralize
const ENVELOPE_TAGS = [
  "enhancer_rules",
  "examples",
  "example",
  "draft",
  "answer",
  "project",
  "documents",
  "document",
  "source",
  "document_content",
  "skill_names",
  "relevant_skills",
  "subproject_instructions",
  "recent_conversation",
];

// Precompiled regexes for tag neutralization
const tagPattern = ENVELOPE_TAGS.join("|");
const CLOSE_TAG_RE = new RegExp(`</\\s*(${tagPattern})(\\s*)>`, "gi");
const OPEN_TAG_RE = new RegExp(`<(${tagPattern})((?:\\s[^>]*)?)>`, "gi");

export function neutralizeTags(text: string): string {
  // Neutralize closing tags first: </name> → <\/name>
  // Capture tag name and trailing whitespace separately to preserve trailing space
  let result = text.replace(CLOSE_TAG_RE, (match, tagName, trailingWS) => {
    return `<\\/${tagName}${trailingWS}>`;
  });

  // Then neutralize opening tags: <name> or <name attrs> → <\name> or <\name attrs>
  // Capture tag name and any attributes separately to preserve them
  result = result.replace(OPEN_TAG_RE, (match, tagName, attrs) => {
    return `<\\${tagName}${attrs}>`;
  });

  return result;
}

export function matchSkills(
  draft: string,
  commands: readonly CommandEntry[],
  names: ReadonlySet<string>,
  k: number,
): CommandEntry[] {
  // Extract distinct words of 4+ letters from draft, lower-cased
  const draftWords = new Set<string>();
  const words = draft.toLowerCase().split(/\s+/);
  for (const word of words) {
    // Remove punctuation and keep only alphanumeric
    const cleaned = word.replace(/[^a-z0-9]/g, "");
    if (cleaned.length >= 4) {
      draftWords.add(cleaned);
    }
  }

  // Score each command
  const scored: Array<{ command: CommandEntry; score: number }> = [];

  for (const command of commands) {
    // Only include commands whose name is in names
    if (!names.has(command.name)) {
      continue;
    }

    const searchText = (command.name + " " + command.description).toLowerCase();
    let score = 0;

    for (const word of draftWords) {
      if (searchText.includes(word)) {
        score++;
      }
    }

    if (score > 0) {
      scored.push({ command, score });
    }
  }

  // Sort by score desc, then name length asc, then name
  scored.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score; // higher score first
    }
    if (a.command.name.length !== b.command.name.length) {
      return a.command.name.length - b.command.name.length; // shorter name first
    }
    return a.command.name.localeCompare(b.command.name); // alphabetical
  });

  // Return first k
  return scored.slice(0, k).map((s) => s.command);
}

export function subprojectDir(
  draft: string,
  dirs: readonly string[],
): string | undefined {
  const lowerDraft = draft.toLowerCase();

  for (const dir of dirs) {
    const lowerDir = dir.toLowerCase();
    // Escape regex metacharacters in directory name
    const escaped = lowerDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Check if dir name appears as a separate token (surrounded by non-word chars or boundaries)
    // Using (?:^|\\W) and (?:$|\\W) instead of \\b to handle non-word chars in dir names
    const regex = new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i");
    if (regex.test(lowerDraft)) {
      return dir;
    }
  }

  return undefined;
}

/**
 * Every skill name the session lists and every command name: what the
 * post-call guards accept as a skill, and what the examples in the static
 * block are rendered against, so the two cannot disagree.
 */
export function knownSkillSet(ctx: {
  skillNames: readonly string[];
  commands: readonly { name: string }[];
}): Set<string> {
  return new Set([...ctx.skillNames, ...ctx.commands.map((c) => c.name)]);
}

export function buildStaticBlock(a: {
  rules: string;
  project: string;
  documents: readonly { path: string; text: string }[];
  skillNames: readonly string[];
  knownSkills: ReadonlySet<string>;
}): string {
  let block = "";

  // 1. Rules
  block += a.rules + "\n\n";

  // 2. Examples
  block += examplesText(a.knownSkills) + "\n\n";

  // 3. Project
  block += `<project>${neutralizeTags(a.project)}</project>\n\n`;

  // 4. Documents
  if (a.documents.length > 0) {
    block += "<documents>\n";
    for (const doc of a.documents) {
      block += "<document>";
      block += `<source>${neutralizeTags(doc.path)}</source>`;
      block += `<document_content>${neutralizeTags(doc.text)}</document_content>`;
      block += "</document>\n";
    }
    block += "</documents>\n\n";
  }

  // 5. Skill names
  if (a.skillNames.length > 0) {
    block += "<skill_names>\n";
    for (const name of a.skillNames) {
      block += neutralizeTags(name) + "\n";
    }
    block += "</skill_names>\n";
  }

  return block.trimEnd();
}

export function buildDynamicBlock(a: {
  relevant: readonly CommandEntry[];
  subproject?: { path: string; text: string };
  conversation?: readonly string[];
  draft: string;
}): string {
  let block = "";

  // 1. Relevant skills (only if non-empty)
  if (a.relevant.length > 0) {
    block += "<relevant_skills>\n";
    for (const cmd of a.relevant) {
      const sanitized = sanitizeDescription(cmd.description);
      const neutralizedName = neutralizeTags(cmd.name);
      if (sanitized === undefined) {
        // Description is forbidden, use name only
        block += `/${neutralizedName}\n`;
      } else {
        const neutralizedDesc = neutralizeTags(sanitized);
        block += `/${neutralizedName} — ${neutralizedDesc}\n`;
      }
    }
    block += "</relevant_skills>\n\n";
  }

  // 2. Subproject instructions (only if given)
  if (a.subproject) {
    block += "<subproject_instructions>\n";
    block += "<document>";
    block += `<source>${neutralizeTags(a.subproject.path)}</source>`;
    block += `<document_content>${neutralizeTags(a.subproject.text)}</document_content>`;
    block += "</document>\n";
    block += "</subproject_instructions>\n\n";
  }

  // 3. Recent conversation (only if given and non-empty)
  if (a.conversation && a.conversation.length > 0) {
    block += "<recent_conversation>\n";
    for (const msg of a.conversation) {
      block += neutralizeTags(msg) + "\n";
    }
    block += "</recent_conversation>\n\n";
  }

  // 4. Draft
  block += `<draft>${neutralizeTags(a.draft)}</draft>\n\n`;

  // 5. Final instruction
  block += "Answer with the JSON object described in the rules.";

  return block;
}

export function hashBlock(s: string): string {
  // FNV-1a 32-bit hash over UTF-16 code units
  let hash = 2166136261; // FNV offset basis

  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // XOR with lower byte
    hash ^= code & 0xff;
    hash = Math.imul(hash, 16777619); // FNV prime
    // XOR with upper byte
    hash ^= (code >> 8) & 0xff;
    hash = Math.imul(hash, 16777619);
  }

  // Convert to unsigned 32-bit and format as 8 hex chars
  const unsigned = hash >>> 0;
  return unsigned.toString(16).padStart(8, "0");
}

export function capText(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return s.slice(0, max);
}
