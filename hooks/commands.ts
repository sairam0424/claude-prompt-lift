import { atom, read, update } from "claude-code";
import type { CommandRunResult, EngineInterface } from "claude-code";
import type { Config } from "./config";
import { decide } from "./chain";
import { wordDiffLines } from "./diff";
import { enhance, isCallInFlight } from "./enhance";
import { resetStuckPhase, undo } from "./actions";
import {
  configuredIds,
  errorMessage,
  matchRungs,
  MODEL_STORE_KEY,
  resolveChain,
} from "./gather";
import { status } from "./status";

// The one registered command's sub-words (spec §5.2, C18): bare → the hint;
// `undo`, `status`, `diff`, `probe` when the whole argument is that word
// (any case); `model <id|alias|reset>`; anything else → Enhance the text, so
// "diff the two configs" is a draft, not the diff. There is no `send`
// sub-word: a slash command replaces the box, so it can never see the draft.
// The atoms are declared here as well as in enhance.ts: `read` and `update`
// validate against an atom made in the calling file.

const model = atom({ plugin: "prompt-lift", key: "model" } as const, "");
const original = atom(
  { plugin: "prompt-lift", key: "original" } as const,
  null,
);
const enhanced = atom(
  { plugin: "prompt-lift", key: "enhanced" } as const,
  null,
);

export const HINT =
  "prompt-lift: type /prompt-lift <your prompt>, press ctrl+x b, or click Enhance";
const MODEL_USAGE = "use /prompt-lift model <id|alias|reset>";
const NOTHING_TO_DIFF = "prompt-lift: nothing to diff";
const PROBE_PROMPT = "ping";
const PROBE_MAX_TOKENS = 8;
// A full model id as every Claude surface spells one: `claude-…` after an
// optional dotted provider prefix (`us.anthropic.`, `anthropic.`). An alias
// (`sonnet`, `haiku`, `opus`) never does; it must name a configured rung.
const MODEL_ID_PATTERN = /^(?:[\w-]+\.)*claude-/i;
// Alias pattern: fable, sonnet, haiku, opus (case-insensitive)
const ALIAS_PATTERN = /^(fable|sonnet|haiku|opus)$/i;
// Valid model id pattern: starts with letter/digit, then letters/digits/.:_-
const VALID_ID_PATTERN = /^[a-z0-9][a-z0-9.:_-]*$/i;

export type ProbeResult = { model: string; outcome: string };

export type ParseModelResult =
  | { kind: "reset" }
  | { kind: "set"; model: string }
  | { kind: "invalid"; reason: string }
  | { kind: "not-a-model-command" };

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
  const [first = "", second = ""] = tokens;

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

  // Exactly two tokens: "model <token>"
  const token = tokens[1]!;

  // Check if it's "reset"
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

export async function runCommand(
  $: EngineInterface,
  cfg: Config,
  rawArgs: string,
): Promise<CommandRunResult> {
  // A `running` no call backs would freeze the band (§5.3 resets): idle first.
  await resetStuckPhase($, isCallInFlight);
  const args = rawArgs.trim();
  if (args === "") {
    return { text: HINT };
  }

  // Check if this is a model command before other routing (Task 10b)
  const [first = ""] = args.split(/\s+/);
  if (first.toLowerCase() === "model") {
    const modelParse = parseModelArg(args);
    if (modelParse.kind === "invalid") {
      // For "model" alone, show the current first rung along with usage
      // (keep existing test behavior); for invalid tokens, show the reason
      const tokens = args.trim().split(/\s+/);
      if (tokens.length === 1) {
        return { text: await chooseModel($, cfg, "") };
      }
      return { text: modelParse.reason };
    }
    if (modelParse.kind === "not-a-model-command") {
      // Prose starting with "model" → enhance the full args string
      await enhance($, cfg, { kind: "args", text: args });
      return {};
    }
    if (modelParse.kind === "reset") {
      await $.store.delete(MODEL_STORE_KEY);
      return { text: await chainText($, cfg) };
    }
    // modelParse.kind === "set"
    return { text: await chooseModel($, cfg, modelParse.model) };
  }

  switch (args.toLowerCase()) {
    case "undo":
      await undo($);
      return {};
    case "status":
      return { text: await status($, cfg) };
    case "diff":
      return { text: await diffText($) };
    case "probe":
      return { text: await probe($, cfg) };
    default:
      await enhance($, cfg, { kind: "args", text: args });
      return {};
  }
}

/**
 * `model <id|alias|reset>`: the choice is kept in `$.store` for this machine
 * and leads the chain (`resolveChain`); `reset` returns to the configured
 * chain. An alias is stored as the configured id it names (spec C1 pins ids;
 * pricing, `effort` and the dedupe all go by the id); a choice that names no
 * rung and is not a full id is refused and nothing is stored.
 */
async function chooseModel(
  $: EngineInterface,
  cfg: Config,
  choice: string,
): Promise<string> {
  if (choice === "") {
    const chain = await resolveChain($, cfg);
    return `prompt-lift: first rung ${chain[0] ?? "none"} · ${MODEL_USAGE}`;
  }
  if (choice.toLowerCase() === "reset") {
    await $.store.delete(MODEL_STORE_KEY);
    return chainText($, cfg);
  }
  const ids = await configuredIds($, cfg);
  const matched = matchRungs(choice, ids);
  if (matched.length > 1) {
    return `prompt-lift: ${choice} names several rungs (${matched.join(", ")}) · ${MODEL_USAGE}`;
  }
  const pinned =
    matched[0] ?? (MODEL_ID_PATTERN.test(choice) ? choice : undefined);
  if (pinned === undefined) {
    return `prompt-lift: ${choice} is neither a rung of ${ids.join(" → ")} nor a full model id · ${MODEL_USAGE}`;
  }
  await $.store.set(MODEL_STORE_KEY, pinned);
  return chainText($, cfg);
}

/** The chain as it now resolves; the `model` atom follows, so the band redraws. */
async function chainText($: EngineInterface, cfg: Config): Promise<string> {
  const chain = await resolveChain($, cfg);
  const first = chain[0] ?? "";
  await update($, model, () => first);
  return `prompt-lift: first rung ${first || "none"} · chain ${chain.join(" → ")}`;
}

/** `diff`: the held pair as `- removed` / `+ inserted` runs of words. */
async function diffText($: EngineInterface): Promise<string> {
  const from = await read($, original);
  const to = await read($, enhanced);
  if (from === null || to === null) {
    return NOTHING_TO_DIFF;
  }
  const lines = wordDiffLines(from, to);
  return lines.length === 0 ? NOTHING_TO_DIFF : lines.join("\n");
}

export function probeText(results: readonly ProbeResult[]): string {
  return [
    "prompt-lift probe",
    ...results.map((r) => `${r.model}: ${r.outcome}`),
  ].join("\n");
}

/**
 * `probe`: one tiny unmarked call per rung, in chain order, each judged by
 * the chain's own `decide`; on demand only, never from a press.
 */
export async function probe($: EngineInterface, cfg: Config): Promise<string> {
  const chain = await resolveChain($, cfg);
  const results: ProbeResult[] = [];
  for (const [index, id] of chain.entries()) {
    results.push({ model: id, outcome: await probeRung($, cfg, id, index) });
  }
  return probeText(results);
}

async function probeRung(
  $: EngineInterface,
  cfg: Config,
  id: string,
  index: number,
): Promise<string> {
  try {
    const reply = await $.model.complete({
      model: id,
      prompt: PROBE_PROMPT,
      maxTokens: PROBE_MAX_TOKENS,
      timeoutMs: index === 0 ? cfg.timeoutMsFirst : cfg.timeoutMsNext,
    });
    return decide(reply, undefined, false).outcome;
  } catch (err) {
    $.ui.log(`prompt-lift: probe ${id}: ${errorMessage(err)}`, {
      to: "debug",
    });
    return "refused";
  }
}
