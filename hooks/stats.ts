import type { EngineInterface } from "claude-code";

// Per-day press and dollar totals, kept across sessions in `$.store.stats`.

export type DayStats = { presses: number; usd: number };
export type Stats = { byDay: Record<string, DayStats> };

const STORE_KEY = "stats";

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
  const stats = asStats(await $.store.get(STORE_KEY));
  const previous = stats.byDay[day] ?? { presses: 0, usd: 0 };
  await $.store.set(STORE_KEY, {
    byDay: {
      ...stats.byDay,
      [day]: { presses: previous.presses + 1, usd: previous.usd + usd },
    },
  });
}
