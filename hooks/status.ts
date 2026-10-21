import { atom, read } from "claude-code";
import type { EngineInterface } from "claude-code";
import type { LastUsage } from "../types";
import {
  hasUnpricedAlias,
  shortModel,
  type Config,
  type Platform,
} from "./config";
import { costText, formatDollars, formatTokens } from "./chain";
import { selectInstructionFiles, type MemoryFile } from "./context";
import { resolveChainWithPlatform } from "./gather";
import { homeSpellings } from "./home";
import { capsLine, readCapStatus, type CapStatus } from "./caps";
import { dayOf, dayTotal, type DayStats } from "./ledger";
import { readTailCount } from "./tail";

// `/prompt-lift status` (spec §5.2, §12): what the mod would send and what
// it has spent, read from the engine, the state and the store; no model call.
// The atoms are declared here as well as in enhance.ts: `read` validates
// against an atom made in the calling file.

const lastUsage = atom(
  { plugin: "prompt-lift", key: "lastUsage" } as const,
  null,
);
const blockHash = atom(
  { plugin: "prompt-lift", key: "blockHash" } as const,
  "",
);
const staticChars = atom(
  { plugin: "prompt-lift", key: "staticChars" } as const,
  0,
);
const sessionPresses = atom(
  { plugin: "prompt-lift", key: "sessionPresses" } as const,
  0,
);
const sessionUsd = atom(
  { plugin: "prompt-lift", key: "sessionUsd" } as const,
  0,
);
const sessionUnpriced = atom(
  { plugin: "prompt-lift", key: "sessionUnpriced" } as const,
  0,
);

export type StatusInput = {
  chain: readonly string[];
  /** Where the session's calls go (R19): an alias rung is unpriced off the Anthropic API. */
  platform: Platform;
  last: LastUsage | null;
  session: DayStats;
  today: DayStats;
  caps: CapStatus;
  /** The whole session's cost as the engine totals it; absent where it keeps none. */
  sessionTotal?: number;
  staticChars: number;
  blockHash: string;
  skills: { included: number; total: number };
  included: readonly MemoryFile[];
  excluded: readonly MemoryFile[];
  /** The effective tail count (R10). */
  tail: number;
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

/**
 * R19: the line after `chain:` when a rung is an alias the platform leaves
 * unpriced, with the way out; none on the Anthropic API or for full ids.
 */
function aliasLines(platform: Platform, unpriced: boolean): string[] {
  if (!unpriced) {
    return [];
  }
  return [
    `aliases: unpriced on ${platform} — pin full ids in models for prices (README › Cost)`,
  ];
}

export function statusText(a: StatusInput): string {
  const conversation =
    a.tail === 0
      ? "conversation: off"
      : `conversation: last ${a.tail} messages`;
  // R19: the aliases line and the caps' note go by the same fact
  const unpriced = hasUnpricedAlias(a.chain, a.platform);
  return [
    "prompt-lift status",
    `chain: ${a.chain.join(" → ")}`,
    ...aliasLines(a.platform, unpriced),
    `last call: ${lastCallText(a.last)}`,
    `session: ${totalsText(a.session)}`,
    `today: ${totalsText(a.today)}`,
    capsLine(a.caps, unpriced),
    conversation,
    ...(a.sessionTotal === undefined
      ? []
      : [`session total (all tools): ${formatDollars(a.sessionTotal)}`]),
    `static block: ${a.staticChars} chars · hash ${a.blockHash || "none"}`,
    `skills ${a.skills.included}/${a.skills.total} (included/total)`,
    `instruction files included: ${filesText(a.included)}`,
    `instruction files excluded: ${filesText(a.excluded)}`,
  ].join("\n");
}

export async function status($: EngineInterface, cfg: Config): Promise<string> {
  const usage = await $.session.usage({ breakdown: "summary" });
  const breakdown = usage.context.breakdown;
  // The engine's own ledger, every tool included: absent where it keeps none
  const total = usage.cost?.usd;
  const homes = await homeSpellings($);
  const files = breakdown?.memoryFiles ?? [];
  const included = selectInstructionFiles(files, cfg, homes);
  const includedPaths = new Set(included.map((file) => file.path));
  const { chain, platform } = await resolveChainWithPlatform($, cfg);
  return statusText({
    chain,
    platform,
    last: await read($, lastUsage),
    session: {
      presses: await read($, sessionPresses),
      usd: await read($, sessionUsd),
      unpriced: await read($, sessionUnpriced),
    },
    // Every session's row for today summed (R24), not this writer's alone
    today: await dayTotal($, dayOf(await $.clock.now())),
    caps: await readCapStatus($, cfg),
    sessionTotal: typeof total === "number" ? total : undefined,
    staticChars: await read($, staticChars),
    blockHash: await read($, blockHash),
    skills: {
      included: breakdown?.skills?.includedSkills ?? 0,
      total: breakdown?.skills?.totalSkills ?? 0,
    },
    included,
    excluded: files.filter((file) => !includedPaths.has(file.path)),
    tail: await readTailCount($, cfg),
  });
}
