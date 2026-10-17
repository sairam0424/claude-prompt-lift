import { atom, read } from "claude-code";
import type { EngineInterface } from "claude-code";
import type { LastUsage } from "../types";
import type { Config } from "./config";
import { shortModel } from "./config";
import { costText, formatDollars, formatTokens } from "./chain";
import { selectInstructionFiles, type MemoryFile } from "./context";
import { resolveChain } from "./gather";
import {
  asStats,
  dayOf,
  dayRow,
  STATS_STORE_KEY,
  type DayStats,
} from "./stats";

// `/prompt-master status` (spec §5.2, §12): what the mod would send and what
// it has spent, read from the engine, the state and the store; no model call.
// The atoms are declared here as well as in enhance.ts: `read` validates
// against an atom made in the calling file.

const lastUsage = atom(
  { plugin: "prompt-master", key: "lastUsage" } as const,
  null,
);
const blockHash = atom(
  { plugin: "prompt-master", key: "blockHash" } as const,
  "",
);
const staticChars = atom(
  { plugin: "prompt-master", key: "staticChars" } as const,
  0,
);
const sessionPresses = atom(
  { plugin: "prompt-master", key: "sessionPresses" } as const,
  0,
);
const sessionUsd = atom(
  { plugin: "prompt-master", key: "sessionUsd" } as const,
  0,
);
const sessionUnpriced = atom(
  { plugin: "prompt-master", key: "sessionUnpriced" } as const,
  0,
);

export type StatusInput = {
  chain: readonly string[];
  last: LastUsage | null;
  session: DayStats;
  today: DayStats;
  staticChars: number;
  blockHash: string;
  skills: { included: number; total: number };
  included: readonly MemoryFile[];
  excluded: readonly MemoryFile[];
};

function cacheWord(last: LastUsage): string {
  if (last.cached > 0) {
    return "cache hit";
  }
  return last.written > 0 ? "cache written" : "cache miss";
}

function lastCallText(last: LastUsage | null): string {
  if (last === null) {
    return "none yet";
  }
  return [
    shortModel(last.model),
    `${formatTokens(last.cached)} cached`,
    `${formatTokens(last.input + last.written)} in`,
    `${last.output} out`,
    costText(last.usd ?? undefined),
    cacheWord(last),
    last.hashChanged ? "static block changed" : "static block unchanged",
  ].join(" · ");
}

/**
 * Presses and priced dollars; the unpriced calls are named only when there
 * were some (R3).
 */
function totalsText(stats: DayStats): string {
  const presses = stats.presses === 1 ? "1 press" : `${stats.presses} presses`;
  const unpriced =
    stats.unpriced > 0 ? [`unpriced calls: ${stats.unpriced}`] : [];
  return [presses, formatDollars(stats.usd), ...unpriced].join(" · ");
}

function filesText(files: readonly MemoryFile[]): string {
  if (files.length === 0) {
    return "none";
  }
  return files.map((file) => `${file.path} (${file.tokens} tokens)`).join(", ");
}

export function statusText(a: StatusInput): string {
  return [
    "prompt-master status",
    `chain: ${a.chain.join(" → ")}`,
    `last call: ${lastCallText(a.last)}`,
    `session: ${totalsText(a.session)}`,
    `today: ${totalsText(a.today)}`,
    `static block: ${a.staticChars} chars · hash ${a.blockHash || "none"}`,
    `skills ${a.skills.included}/${a.skills.total} (included/total)`,
    `instruction files included: ${filesText(a.included)}`,
    `instruction files excluded: ${filesText(a.excluded)}`,
  ].join("\n");
}

export async function status($: EngineInterface, cfg: Config): Promise<string> {
  const breakdown = (await $.session.usage({ breakdown: "summary" })).context
    .breakdown;
  const home = (await $.env.get("HOME")) ?? "";
  const files = breakdown?.memoryFiles ?? [];
  const included = selectInstructionFiles(files, cfg, home);
  const includedPaths = new Set(included.map((file) => file.path));
  const stats = asStats(await $.store.get(STATS_STORE_KEY));
  return statusText({
    chain: await resolveChain($, cfg),
    last: await read($, lastUsage),
    session: {
      presses: await read($, sessionPresses),
      usd: await read($, sessionUsd),
      unpriced: await read($, sessionUnpriced),
    },
    today: dayRow(stats, dayOf(await $.clock.now())),
    staticChars: await read($, staticChars),
    blockHash: await read($, blockHash),
    skills: {
      included: breakdown?.skills?.includedSkills ?? 0,
      total: breakdown?.skills?.totalSkills ?? 0,
    },
    included,
    excluded: files.filter((file) => !includedPaths.has(file.path)),
  });
}
