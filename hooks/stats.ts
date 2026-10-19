import { atom, read, update } from "claude-code";
import type { EngineInterface, ModelUsage } from "claude-code";
import type { LastUsage } from "../types";
import type { Config, Price } from "./config";
import { estimateUsd, priceFor, shortModel } from "./config";
import type { Attempt, ChainOk } from "./chain";
import { hashBlock } from "./context";
import { errorMessage } from "./gather";

// Usage bookkeeping (G5, C19): every call the chain paid for is recorded
// whatever the rewrite came to — the last-call record the band and `status`
// show, the block hash and the no-cache streak, the session totals, and the
// per-day totals kept across sessions in `$.store.stats`. The atoms are
// declared here as well as in enhance.ts: `read` and `update` validate
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
const noCacheStreak = atom(
  { plugin: "prompt-lift", key: "noCacheStreak" } as const,
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

/**
 * A day's (or the session's) totals: `usd` adds only the calls the price
 * table covers; `unpriced` counts the calls it does not (R3).
 */
export type DayStats = { presses: number; usd: number; unpriced: number };
export type Stats = { byDay: Record<string, DayStats> };

export const STATS_STORE_KEY = "stats";
export const EMPTY_DAY: DayStats = { presses: 0, usd: 0, unpriced: 0 };

/**
 * What an answered press cost (every rung it paid for, see `callUsd`;
 * undefined when the answering model has no price) and whether block 0
 * differs from the last one: the facts the toasts show.
 */
export type CallRecord = { usd: number | undefined; hashChanged: boolean };

/**
 * An answered call as `assessCall` judges it and `recordCall` writes it: the
 * record and what it was judged from.
 */
export type AnsweredCall = CallRecord & {
  run: ChainOk;
  staticBlock: string;
  relevantCount: number;
  hash: string;
};

/** What `toLastUsage` records beyond the call's own usage. */
export type CallFacts = {
  run: ChainOk;
  relevantCount: number;
  why: string;
  addedWords: number;
};

/** What a filled rewrite added; a call that filled nothing has none. */
export type Rewrite = Pick<CallFacts, "why" | "addedWords">;
const NO_REWRITE: Rewrite = { why: "", addedWords: 0 };

export function asStats(value: unknown): Stats {
  const byDay = (value as { byDay?: unknown } | null | undefined)?.byDay;
  const isRecord = typeof byDay === "object" && byDay !== null;
  return { byDay: isRecord ? (byDay as Record<string, DayStats>) : {} };
}

/** The stats day key: the local `YYYY-MM-DD`, month and day padded (R6). */
export function dayOf(nowMs: number): string {
  const date = new Date(nowMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The day's row; a row written before unpriced calls were counted reads as
 * zero of them.
 */
export function dayRow(stats: Stats, day: string): DayStats {
  return { ...EMPTY_DAY, ...stats.byDay[day] };
}

/** A call added to a row: priced, it adds its dollars; unpriced, a count. */
export function addCall(row: DayStats, usd: number | undefined): DayStats {
  return {
    presses: row.presses + 1,
    usd: usd === undefined ? row.usd : row.usd + usd,
    unpriced: usd === undefined ? row.unpriced + 1 : row.unpriced,
  };
}

export async function recordPress(
  $: EngineInterface,
  usd: number | undefined,
): Promise<void> {
  const day = dayOf(await $.clock.now());
  const stats = asStats(await $.store.get(STATS_STORE_KEY));
  await $.store.set(STATS_STORE_KEY, {
    byDay: { ...stats.byDay, [day]: addCall(dayRow(stats, day), usd) },
  });
}

/**
 * The totals every answered press adds to, priced or not: the session atoms
 * and the day's row (an unpriced press counts, with no dollars).
 */
export async function recordSpend(
  $: EngineInterface,
  usd: number | undefined,
): Promise<void> {
  await update($, sessionPresses, (n) => n + 1);
  if (usd === undefined) {
    await update($, sessionUnpriced, (n) => n + 1);
  } else {
    await update($, sessionUsd, (n) => n + usd);
  }
  await recordPress($, usd);
}

/** What the two windows have spent in priced dollars (unpriced presses add nothing). */
export type Spent = { session: number; day: number };

/**
 * What the session and the day have spent in priced dollars: the windows the
 * spend caps are checked against (R9). An unpriced press adds nothing here.
 */
export async function spentUsd($: EngineInterface): Promise<Spent> {
  const stats = asStats(await $.store.get(STATS_STORE_KEY));
  return {
    session: await read($, sessionUsd),
    day: dayRow(stats, dayOf(await $.clock.now())).usd,
  };
}

/**
 * An answered call judged from the reply alone: its dollars and block 0's
 * hash, with the hash taken as unchanged. Pure, so the record is owed from
 * the answer on (G5): a throw in `assessCall`'s read still leaves one.
 */
export function judgeCall(
  cfg: Config,
  a: { run: ChainOk; staticBlock: string; relevantCount: number },
): AnsweredCall {
  return {
    ...a,
    usd: callUsd(a.run, cfg.prices),
    hash: hashBlock(a.staticBlock),
    hashChanged: false,
  };
}

/**
 * The judged call with whether block 0's hash changed. Reads only, so a fill
 * can hold the pair before `recordCall` writes (§5.3 step 9).
 */
export async function assessCall(
  $: EngineInterface,
  judged: AnsweredCall,
): Promise<AnsweredCall> {
  const previousHash = await read($, blockHash);
  const hashChanged = previousHash !== "" && previousHash !== judged.hash;
  return { ...judged, hashChanged };
}

/**
 * The writes for an answered call, whatever the rewrite came to: the
 * last-call record (with the rewrite's why and added words once it was
 * filled), the block-0 hash and size, the no-cache streak, and the totals.
 */
export async function recordCall(
  $: EngineInterface,
  call: AnsweredCall,
  rewrite: Rewrite = NO_REWRITE,
): Promise<void> {
  const facts: CallFacts = {
    run: call.run,
    relevantCount: call.relevantCount,
    why: rewrite.why,
    addedWords: rewrite.addedWords,
  };
  await update($, lastUsage, () =>
    toLastUsage(facts, call.usd, call.hashChanged),
  );
  await update($, blockHash, () => call.hash);
  await update($, staticChars, () => call.staticBlock.length);
  const uncached = isUncached(call.run.usage);
  await update($, noCacheStreak, (n) => (uncached ? n + 1 : 0));
  await recordSpend($, call.usd);
}

/**
 * `recordCall` for a path that goes on whatever happens to the record: a
 * write that fails is logged to debug and reported as false, never thrown.
 */
export async function recordOrLog(
  $: EngineInterface,
  call: AnsweredCall,
  rewrite?: Rewrite,
): Promise<boolean> {
  try {
    await recordCall($, call, rewrite);
    return true;
  } catch (err) {
    $.ui.log(
      `prompt-lift: recording the cost failed: ${errorMessage(err)}`,
      { to: "debug" },
    );
    return false;
  }
}

/**
 * What an answered press cost: every rung the chain paid for, the failed
 * ones before the answer included (G5; spec §15: a fallback after Fable's
 * cold write costs both models' cold writes). The answering rung is the last
 * of `attempts`, so its own cost is in the sum; a failed rung with no price
 * adds nothing, as in a failed chain (ruled). Undefined when the answering
 * model has no price (R3): a total with an unknown part is unknown, and reads
 * `$?` rather than the part.
 */
export function callUsd(
  run: ChainOk,
  prices: Readonly<Record<string, Price>>,
): number | undefined {
  if (priceFor(run.model, prices) === undefined) {
    return undefined;
  }
  return attemptsUsd(run.attempts, prices);
}

/**
 * What a chain that answered nothing still paid: each priced rung at its own
 * price; undefined when no rung had one (R3).
 */
export function attemptsUsd(
  attempts: readonly Attempt[],
  prices: Readonly<Record<string, Price>>,
): number | undefined {
  const priced = attempts
    .map((attempt) => estimateUsd(attempt.usage, attempt.model, prices))
    .filter((usd): usd is number => usd !== undefined);
  if (priced.length === 0) {
    return undefined;
  }
  return priced.reduce((sum, usd) => sum + usd, 0);
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
  usd: number | undefined,
  hashChanged: boolean,
): LastUsage {
  // The token columns are the answering rung's; `usd` is the whole press's
  const usage = a.run.usage;
  return {
    model: a.run.model,
    input: usage.input_tokens,
    cached: usage.cache_read_input_tokens,
    written: usage.cache_creation_input_tokens,
    output: usage.output_tokens,
    // State is JSON: an unknown price persists as null, not undefined
    usd: usd ?? null,
    attempts: a.run.attempts.map(describeAttempt),
    why: a.why,
    addedWords: a.addedWords,
    skills: a.relevantCount,
    hashChanged,
  };
}
