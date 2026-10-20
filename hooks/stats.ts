import { atom, read, update } from "claude-code";
import type { EngineInterface, ModelUsage } from "claude-code";
import type { LastUsage } from "../types";
import type { Config, Platform, Price } from "./config";
import { estimateUsd, priceFor, shortModel } from "./config";
import type { Attempt, ChainOk } from "./chain";
import { hashBlock } from "./context";
import { errorMessage } from "./gather";
import {
  createLedger,
  dayOf,
  dayTotal,
  newWriterId,
  recordPress as ledgerPress,
} from "./ledger";

// Usage bookkeeping (G5, C19): every call the chain paid for is recorded
// whatever the rewrite came to — the last-call record the band and `status`
// show, the block hash and the no-cache streak, the session totals, and the
// per-day totals kept across sessions in `$.store` (ledger.ts). The atoms are
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

/**
 * This module instance's ledger (R24): one writer id for the instance's
 * lifetime, so its day rows never collide with another session's or with a
 * hot-reloaded copy's; the sum across writers is read back with `dayTotal`.
 */
const ledger = createLedger(newWriterId());

/** One press, priced or not, added to this session's row for today. */
export function recordPress(
  $: EngineInterface,
  usd: number | undefined,
): Promise<void> {
  return ledgerPress(ledger, $, usd);
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
 * spend caps are checked against (R9). The day is the whole machine's, every
 * session's row summed (R24). An unpriced press adds nothing here.
 */
export async function spentUsd($: EngineInterface): Promise<Spent> {
  const today = await dayTotal($, dayOf(await $.clock.now()));
  return { session: await read($, sessionUsd), day: today.usd };
}

/**
 * An answered call judged from the reply alone: its dollars on the platform
 * the press ran on (R19) and block 0's hash, with the hash taken as
 * unchanged. Pure, so the record is owed from the answer on (G5): a throw in
 * `assessCall`'s read still leaves one.
 */
export function judgeCall(
  cfg: Config,
  a: {
    run: ChainOk;
    staticBlock: string;
    relevantCount: number;
    platform: Platform;
  },
): AnsweredCall {
  const { platform, ...judged } = a;
  return {
    ...judged,
    usd: callUsd(a.run, cfg.prices, platform),
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
    $.ui.log(`prompt-lift: recording the cost failed: ${errorMessage(err)}`, {
      to: "debug",
    });
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
 * `$?` rather than the part. Every rung is priced on `platform`, where the
 * press ran (R19): an alias rung off the Anthropic API has no price.
 */
export function callUsd(
  run: ChainOk,
  prices: Readonly<Record<string, Price>>,
  platform: Platform,
): number | undefined {
  if (priceFor(run.model, prices, platform) === undefined) {
    return undefined;
  }
  return attemptsUsd(run.attempts, prices, platform);
}

/**
 * What a chain that answered nothing still paid: each priced rung at its own
 * price on `platform` (R19); undefined when no rung had one (R3).
 */
export function attemptsUsd(
  attempts: readonly Attempt[],
  prices: Readonly<Record<string, Price>>,
  platform: Platform,
): number | undefined {
  const priced = attempts
    .map((attempt) =>
      estimateUsd(attempt.usage, attempt.model, prices, platform),
    )
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
