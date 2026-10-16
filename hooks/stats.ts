import type { EngineInterface, ModelUsage } from "claude-code";
import type { LastUsage } from "../types";
import { shortModel } from "./config";
import type { Attempt, ChainOk } from "./chain";
import type { PostOk } from "./guards";

// Usage bookkeeping: the record of the last press for the band, and per-day
// press and dollar totals kept across sessions in `$.store.stats`.

export type DayStats = { presses: number; usd: number };
export type Stats = { byDay: Record<string, DayStats> };

export const STATS_STORE_KEY = "stats";
export const EMPTY_DAY: DayStats = { presses: 0, usd: 0 };

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
  a: { run: ChainOk; post: PostOk; relevantCount: number },
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
    why: a.post.why,
    addedWords: a.post.addedWords,
    skills: a.relevantCount,
    hashChanged,
  };
}
