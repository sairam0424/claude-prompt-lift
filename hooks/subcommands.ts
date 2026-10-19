/**
 * Sub-command parsers for /prompt-lift commands.
 * Extracted from commands.ts to keep that file under 400 lines.
 */

// Alias pattern: fable, sonnet, haiku, opus (case-insensitive)
const ALIAS_PATTERN = /^(fable|sonnet|haiku|opus)$/i;
// Valid model id pattern: starts with letter/digit, then letters/digits/.:_-
const VALID_ID_PATTERN = /^[a-z0-9][a-z0-9.:_-]*$/i;
const PLAIN_COUNT = /^\d+$/;
// The messages a `tail` count may ask for
const TAIL_MIN = 1;
const TAIL_MAX = 50;

export type ParseModelResult =
  | { kind: "reset" }
  | { kind: "set"; model: string }
  | { kind: "invalid"; reason: string }
  | { kind: "not-a-model-command" };

export type TailArg =
  | { kind: "show" }
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "set"; count: number }
  | { kind: "invalid" }
  | { kind: "prose" };

export type PreviewArg =
  { kind: "show"; draft: string } | { kind: "empty" } | { kind: "prose" };

/**
 * Parse a `/prompt-lift` command to check if it's a model command.
 * Rules:
 * - First token must be "model"
 * - Exactly one further token → set/reset/invalid
 * - Zero further tokens → invalid (usage)
 * - Three or more tokens → not-a-model-command (prose/draft)
 */
export function parseModelArg(args: string): ParseModelResult {
  const tokens = args.trim().split(/\s+/);
  const [first = "", token = ""] = tokens;

  // First token must be "model"
  if (first.toLowerCase() !== "model") {
    return { kind: "not-a-model-command" };
  }

  // Zero further tokens → invalid (usage)
  if (tokens.length === 1) {
    return {
      kind: "invalid",
      reason: "prompt-lift: usage: /prompt-lift model <id|alias|reset>",
    };
  }

  // Three or more tokens → not-a-model-command (prose)
  if (tokens.length >= 3) {
    return { kind: "not-a-model-command" };
  }

  // Exactly two tokens: "model <token>". Is it "reset"?
  if (token.toLowerCase() === "reset") {
    return { kind: "reset" };
  }

  // Check if it's a valid alias or id
  if (ALIAS_PATTERN.test(token) || VALID_ID_PATTERN.test(token)) {
    return { kind: "set", model: token };
  }

  // Invalid token
  return {
    kind: "invalid",
    reason: `prompt-lift: "${token}" is not a model id or alias`,
  };
}

/**
 * Parse `/prompt-lift tail <on|off|N>`: one token → control, more → prose.
 */
export function parseTailArg(args: string): TailArg {
  const tokens = args.trim().split(/\s+/);
  const [first = "", second = ""] = tokens;

  // First token must be "tail"
  if (first.toLowerCase() !== "tail") {
    return { kind: "prose" };
  }

  // Zero further tokens → show status
  if (tokens.length === 1) {
    return { kind: "show" };
  }

  // Three or more tokens → prose
  if (tokens.length >= 3) {
    return { kind: "prose" };
  }

  // Second token: on, off, or count
  if (second.toLowerCase() === "on") {
    return { kind: "on" };
  }
  if (second.toLowerCase() === "off") {
    return { kind: "off" };
  }

  // A count is plain digits, as `parseCapArg` takes plain decimals only:
  // `Number` would also take 0x6, 1e1, 6.0 and +6
  if (PLAIN_COUNT.test(second)) {
    const count = Number(second);
    if (count >= TAIL_MIN && count <= TAIL_MAX) {
      return { kind: "set", count };
    }
  }

  return { kind: "invalid" };
}

/**
 * Parse `/prompt-lift preview <draft>`: zero tokens → usage; one or more → show.
 */
export function parsePreviewArg(args: string): PreviewArg {
  const tokens = args.trim().split(/\s+/);
  const [first = ""] = tokens;

  // First token must be "preview"
  if (first.toLowerCase() !== "preview") {
    return { kind: "prose" };
  }

  // Zero further tokens → empty (usage)
  if (tokens.length === 1) {
    return { kind: "empty" };
  }

  // One or more tokens → show preview with the draft (everything after "preview")
  const draft = args.slice(args.toLowerCase().indexOf("preview") + 7).trim();
  return { kind: "show", draft };
}
