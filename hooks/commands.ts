import { atom, read, update } from "claude-code";
import type { CommandRunResult, EngineInterface } from "claude-code";
import type { Config } from "./config";
import { decide } from "./chain";
import { wordDiffLines } from "./diff";
import { enhance } from "./enhance";
import { undo } from "./actions";
import { errorMessage, MODEL_STORE_KEY, resolveChain } from "./gather";
import { status } from "./status";

// The one registered command's sub-words (spec §5.2, C18): bare → the hint,
// `undo`, `model`, `status`, `diff`, `probe`, anything else → Enhance the
// text. There is no `send` sub-word: a slash command replaces the box, so it
// can never see the draft. The atoms are declared here as well as in
// enhance.ts: `read` and `update` validate against an atom made in the
// calling file.

const model = atom({ plugin: "prompt-master", key: "model" } as const, "");
const original = atom(
  { plugin: "prompt-master", key: "original" } as const,
  null,
);
const enhanced = atom(
  { plugin: "prompt-master", key: "enhanced" } as const,
  null,
);

export const HINT =
  "prompt-master: type /prompt-master <your prompt>, press ctrl+x b, or click Enhance";
const MODEL_USAGE = "use /prompt-master model <id|alias|reset>";
const NOTHING_TO_DIFF = "prompt-master: nothing to diff";
const PROBE_PROMPT = "ping";
const PROBE_MAX_TOKENS = 8;

export type ProbeResult = { model: string; outcome: string };

export async function runCommand(
  $: EngineInterface,
  cfg: Config,
  rawArgs: string,
): Promise<CommandRunResult> {
  const args = rawArgs.trim();
  if (args === "") {
    return { text: HINT };
  }
  const [first = "", second = ""] = args.split(/\s+/);
  switch (first.toLowerCase()) {
    case "undo":
      await undo($);
      return {};
    case "model":
      return { text: await chooseModel($, cfg, second) };
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
 * chain. The `model` atom follows, so the band redraws with the new rung.
 */
async function chooseModel(
  $: EngineInterface,
  cfg: Config,
  choice: string,
): Promise<string> {
  if (choice === "") {
    const chain = await resolveChain($, cfg);
    return `prompt-master: first rung ${chain[0] ?? "none"} · ${MODEL_USAGE}`;
  }
  if (choice.toLowerCase() === "reset") {
    await $.store.delete(MODEL_STORE_KEY);
  } else {
    await $.store.set(MODEL_STORE_KEY, choice);
  }
  const chain = await resolveChain($, cfg);
  const first = chain[0] ?? "";
  await update($, model, () => first);
  return `prompt-master: first rung ${first || "none"} · chain ${chain.join(" → ")}`;
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
    "prompt-master probe",
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
    $.ui.log(`prompt-master: probe ${id}: ${errorMessage(err)}`, {
      to: "debug",
    });
    return "refused";
  }
}
