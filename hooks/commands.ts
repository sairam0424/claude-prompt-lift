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
  lastAssistantText,
} from "./gather";
import {
  parseModelArg,
  parseTailArg,
  parsePreviewArg,
  type ParseModelResult,
  type TailArg,
  type PreviewArg,
} from "./subcommands";
import { preGuard } from "./guards";
import { status } from "./status";
import {
  capDollars,
  capsLine,
  parseCapArg,
  readCapStatus,
  CAP_USAGE,
  type CapArg,
} from "./caps";
import { readTailCount } from "./tail";
import { prepare } from "./prepare";
import { hashBlock } from "./context";

// The one registered command's sub-words (spec §5.2, C18): bare → the hint;
// `undo`, `status`, `diff`, `probe` when the whole argument is that word
// (any case); `model <id|alias|reset>` and `cap <usd|off>` (R9); anything
// else → Enhance the text, so
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
const capOverride = atom(
  { plugin: "prompt-lift", key: "capOverride" } as const,
  null,
);
const tailOverride = atom(
  { plugin: "prompt-lift", key: "tailOverride" } as const,
  null,
);

const TAIL_USAGE =
  "prompt-lift: tail takes on, off or a count 1-50, e.g. /prompt-lift tail 6";

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

export type ProbeResult = { model: string; outcome: string };

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

  // `cap` follows the same rule (R9): one argument is the cap, more is prose
  const capArg = parseCapArg(args);
  if (capArg.kind !== "prose") {
    return runCap($, cfg, capArg);
  }

  // `tail` follows the same rule (R10): one argument is a control, more is prose
  const tailArg = parseTailArg(args);
  if (tailArg.kind !== "prose") {
    return runTail($, cfg, tailArg);
  }

  // `preview` follows the same rule: one argument is a control, more is prose
  const previewArg = parsePreviewArg(args);
  if (previewArg.kind !== "prose") {
    return runPreview($, cfg, previewArg);
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

/**
 * `cap <usd|off>`: the session cap for this session only, kept in state
 * rather than the store (a budget for now, not a setting); `cap` alone prints
 * the caps as `status` does. The day cap is an option only (R9).
 */
async function runCap(
  $: EngineInterface,
  cfg: Config,
  arg: Exclude<CapArg, { kind: "prose" }>,
): Promise<CommandRunResult> {
  if (arg.kind === "invalid") {
    return { text: CAP_USAGE };
  }
  if (arg.kind === "show") {
    return { text: capsLine(await readCapStatus($, cfg)) };
  }
  await update($, capOverride, () => arg.usd);
  $.ui.toast(
    arg.usd === 0
      ? "prompt-lift: session cap off for this session"
      : `prompt-lift: session cap ${capDollars(arg.usd)} for this session`,
  );
  return {};
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

async function runTail(
  $: EngineInterface,
  cfg: Config,
  arg: Exclude<TailArg, { kind: "prose" }>,
): Promise<CommandRunResult> {
  if (arg.kind === "show") {
    const count = await readTailCount($, cfg);
    const state =
      count === 0 ? "conversation off" : `conversation last ${count} messages`;
    return { text: `prompt-lift: ${state} · /prompt-lift tail on|off|<count>` };
  }

  if (arg.kind === "invalid") {
    return { text: TAIL_USAGE };
  }

  if (arg.kind === "off") {
    await update($, tailOverride, () => 0);
    return { text: "prompt-lift: tail off this session" };
  }

  // arg.kind === "on" or "set"
  const count = arg.kind === "on" ? cfg.conversationMessages : arg.count;
  await update($, tailOverride, () => count);
  return { text: `prompt-lift: tail on · last ${count} messages this session` };
}

async function runPreview(
  $: EngineInterface,
  cfg: Config,
  arg: Exclude<PreviewArg, { kind: "prose" }>,
): Promise<CommandRunResult> {
  if (arg.kind === "empty") {
    return {
      text: "prompt-lift: preview takes a draft, e.g. /prompt-lift preview write a commit",
    };
  }

  // arg.kind === "show"
  const draft = arg.draft;
  const rows = await $.session.messages();

  // Run the same preGuard as enhance does
  const guard = preGuard(draft, cfg, lastAssistantText(rows));
  if (!guard.ok) {
    return { text: guard.toast };
  }

  // Gather context and prepare exactly as a press would
  const prepared = await prepare($, cfg, draft, rows);

  // Format the output: dynamic block, then static block info
  const hash = hashBlock(prepared.staticBlock);
  const chars = prepared.staticBlock.length;

  const output = [
    "--- dynamic block (sent uncached) ---",
    prepared.dynamicBlock,
    "",
    `--- static block: ${chars} chars · hash ${hash} ---`,
  ].join("\n");

  return { text: output };
}
