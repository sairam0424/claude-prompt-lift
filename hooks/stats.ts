import { atom, read, update } from "claude-code";
import type { EngineInterface, ModelUsage } from "claude-code";
import type { LastUsage } from "../types";
import type { Config, Price } from "./config";
import { estimateUsd, shortModel } from "./config";
import type { Attempt, ChainOk } from "./chain";
import { hashBlock } from "./context";

// Usage bookkeeping (G5, C19): every call the chain paid for is recorded
// whatever the rewrite came to — the last-call record the band and `status`
// show, the block hash and the no-cache streak, the session totals, and the
// per-day totals kept across sessions in `$.store.stats`. The atoms are
// declared here as well as in enhance.ts: `read` and `update` validate
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
const noCacheStreak = atom(
  { plugin: "prompt-master", key: "noCacheStreak" } as const,
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

export type DayStats = { presses: number; usd: number };
export type Stats = { byDay: Record<string, DayStats> };

export const STATS_STORE_KEY = "stats";
export const EMPTY_DAY: DayStats = { presses: 0, usd: 0 };

/** What an answered call cost and whether block 0 differs from the last one. */
export type CallRecord = { usd: number; hashChanged: boolean };

/** What `toLastUsage` records beyond the call's own usage. */
export type CallFacts = {
  run: ChainOk;
  relevantCount: number;
  why: string;
  addedWords: number;
};

export function asStats(value: unknown): Stats {
  const byDay = (value as { byDay?: unknown } | null | undefined)?.byDay;
  const isRecord = typeof byDay === "object" && byDay !== null;
  return { byDay: isRecord ? (byDay as Record<string, DayStats>) : {} };
}

export function dayOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export async function recordPress(
  $: EngineInterface,
  usd: number,
): Promise<void> {
  const day = dayOf(await $.clock.now());
  const stats = asStats(await $.store.get(STATS_STORE_KEY));
  const previous = stats.byDay[day] ?? EMPTY_DAY;
  await $.store.set(STATS_STORE_KEY, {
    byDay: {
      ...stats.byDay,
      [day]: { presses: previous.presses + 1, usd: previous.usd + usd },
    },
  });
}

/** The totals every paid press adds to: the session atoms and the day's row. */
export async function recordSpend(
  $: EngineInterface,
  usd: number,
): Promise<void> {
  await update($, sessionPresses, (n) => n + 1);
  await update($, sessionUsd, (n) => n + usd);
  await recordPress($, usd);
}

/**
 * An answered call, before the rewrite is judged: its dollars, the block-0
 * hash and size, the no-cache streak, the totals, and a last-call record
 * with no rewrite facts yet (`noteRewrite` fills those in on a fill).
 */
export async function recordCall(
  $: EngineInterface,
  cfg: Config,
  a: { run: ChainOk; staticBlock: string; relevantCount: number },
): Promise<CallRecord> {
  const usd = estimateUsd(a.run.usage, a.run.model, cfg.prices);
  const hash = hashBlock(a.staticBlock);
  const previousHash = await read($, blockHash);
  const hashChanged = previousHash !== "" && previousHash !== hash;
  const facts: CallFacts = { ...a, why: "", addedWords: 0 };
  await update($, lastUsage, () => toLastUsage(facts, usd, hashChanged));
  await update($, blockHash, () => hash);
  await update($, staticChars, () => a.staticBlock.length);
  const uncached = isUncached(a.run.usage);
  await update($, noCacheStreak, (n) => (uncached ? n + 1 : 0));
  await recordSpend($, usd);
  return { usd, hashChanged };
}

/** The last-call record once a rewrite was filled: its why and added words. */
export async function noteRewrite(
  $: EngineInterface,
  facts: CallFacts,
  call: CallRecord,
): Promise<void> {
  await update($, lastUsage, () => toLastUsage(facts, call.usd, call.hashChanged));
}

/** What a chain that answered nothing still paid: each rung at its own price. */
export function attemptsUsd(
  attempts: readonly Attempt[],
  prices: Readonly<Record<string, Price>>,
): number {
  return attempts.reduce(
    (sum, attempt) => sum + estimateUsd(attempt.usage, attempt.model, prices),
    0,
  );
}

/** A reply that neither read nor wrote the prompt cache (the C19 streak). */
export function isUncached(usage: ModelUsage): boolean {
  return (
    usage.cache_read_input_tokens === 0 &&
    usage.cache_creation_input_tokens === 0
  );
}

export function describeAttempt(attempt: Attempt): string {
  return `${shortModel(attempt.model)}: ${attempt.outcome}`;
}

export function toLastUsage(
  a: CallFacts,
  usd: number,
  hashChanged: boolean,
): LastUsage {
  const usage = a.run.usage;
  return {
    model: a.run.model,
    input: usage.input_tokens,
    cached: usage.cache_read_input_tokens,
    written: usage.cache_creation_input_tokens,
    output: usage.output_tokens,
    usd,
    attempts: a.run.attempts.map(describeAttempt),
    why: a.why,
    addedWords: a.addedWords,
    skills: a.relevantCount,
    hashChanged,
  };
}
