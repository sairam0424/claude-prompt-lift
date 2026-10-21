import type { ThemeKey } from "claude-code";
import type { LastUsage } from "../types";
import { shortModel } from "./config";
import { costText, formatTokens } from "./chain";

// The row's words (spec §5.1 as R25 amends it): pure helpers for band.tsx,
// which alone touches `$`. A headline leads the row, one glyph and a state
// word in a theme key, so the colour follows the person's light or dark
// theme; the details keep their dim text. As the band's columns fall, the
// tiers drop the least needed part first.

/** The states the row draws; the verdicts and the armed window come later (R25). */
export type BandState = "idle" | "running" | "done" | "restored";

/**
 * What the band's width leaves room for (R25 width tiers): `full` keeps the
 * whole row; `noHint` drops the idle row's key hint; `compact` also drops the
 * done row's three token figures; `minimal` also drops the headline's word
 * and keeps its glyph.
 */
export type Tier = "full" | "noHint" | "compact" | "minimal";

/** Columns at and above which the idle row keeps `ctrl+x b · or ctrl+x tab, e`. */
const HINT_COLUMNS = 100;
/** Columns at and above which the done row keeps its three token figures. */
const FIGURES_COLUMNS = 80;
/** Columns at and above which the headline keeps its word beside the glyph. */
const WORD_COLUMNS = 60;

type HeadlineSpec = { glyph: string; word: string; color: ThemeKey };

/**
 * The headline per state. The glyphs are ↥ U+21A5, ↻ U+21BB, ✓ U+2713 and
 * ↶ U+21B6, all East-Asian-width N (one cell), no emoji; the colours are
 * theme keys, never raw names or hex, so each follows the theme.
 */
const HEADLINES: Record<BandState, HeadlineSpec> = {
  idle: { glyph: "↥", word: "Ready", color: "claude" },
  running: { glyph: "↻", word: "Enhancing", color: "warning" },
  done: { glyph: "✓", word: "Enhanced", color: "success" },
  restored: { glyph: "↶", word: "Restored", color: "warning" },
};

export const RESTORED_ROW = "restored your draft";
const KEY_HINT = "ctrl+x b · or ctrl+x tab, e";
/** Presses without a cache hit before the row suggests a cheaper rung (C19). */
const NO_CACHE_HINT_AFTER = 3;
const NO_CACHE_HINT = "cache not hitting — consider /prompt-lift model haiku";

export function tierOf(bodyColumns: number): Tier {
  if (bodyColumns >= HINT_COLUMNS) {
    return "full";
  }
  if (bodyColumns >= FIGURES_COLUMNS) {
    return "noHint";
  }
  if (bodyColumns >= WORD_COLUMNS) {
    return "compact";
  }
  return "minimal";
}

/**
 * What 80 columns and up (`noHint` and above) leave room for: the done row's
 * three token figures and elapsed time, and the whole rung strip; narrower,
 * all of these go first.
 */
function hasRoom(tier: Tier): boolean {
  return tier === "full" || tier === "noHint";
}

export type Headline = { text: string; color: ThemeKey };

/**
 * The headline for `state`: glyph and word, or the glyph alone when
 * `minimal`; `figure` (the running counter, the done cost) follows either.
 */
export function headline(
  state: BandState,
  tier: Tier,
  figure?: string,
): Headline {
  const { glyph, word, color } = HEADLINES[state];
  const lead = tier === "minimal" ? glyph : `${glyph} ${word}`;
  return { text: figure === undefined ? lead : `${lead} ${figure}`, color };
}

/** How a rung stands in the strip: failed before the active one, pending after. */
export type RungState = "failed" | "active" | "pending";
export type StripRung = { label: string; state: RungState };
/** The strip and its counter: rung `rung` of `rungs` runs now. */
export type Strip = { rung: number; rungs: number; runs: StripRung[] };

/**
 * The rung strip for the chain with `running` under way: every rung by its
 * short name, the ones before `running` failed (the chain advances only on
 * failure), the rest pending; under 80 columns the active rung alone.
 * Undefined when the chain does not name `running` (a stored alias that
 * matched nothing): the row falls back to `runningRowText`.
 */
export function stripOf(
  chain: readonly string[],
  running: string,
  tier: Tier,
): Strip | undefined {
  const active = chain.indexOf(running);
  if (active === -1) {
    return undefined;
  }
  const runs = chain.map((id, index): StripRung => ({
    label: shortModel(id),
    state: index < active ? "failed" : index === active ? "active" : "pending",
  }));
  return {
    rung: active + 1,
    rungs: chain.length,
    runs: hasRoom(tier) ? runs : runs.filter((run) => run.state === "active"),
  };
}

/** The running headline's counter: `N of M`, or `N/M` when `minimal`. */
export function counterText(strip: Strip, tier: Tier): string {
  return tier === "minimal"
    ? `${strip.rung}/${strip.rungs}`
    : `${strip.rung} of ${strip.rungs}`;
}

/**
 * The idle row: the keys (at `full` only) and the first rung, then what a cap
 * leaves (R9) and tail N (R10).
 */
export function idleRowText(
  firstRung: string,
  left?: string,
  tail?: number,
  tier: Tier = "full",
): string {
  return [
    ...(tier === "full" ? [KEY_HINT] : []),
    `prompt-lift: ${shortModel(firstRung)}`,
    ...(left === undefined ? [] : [left]),
    ...(tail !== undefined && tail > 0 ? [`tail ${tail}`] : []),
  ].join(" · ");
}

/** The running details when the chain does not name the running rung. */
export function runningRowText(modelId: string): string {
  return `Enhancing with ${shortModel(modelId)}…`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** `N of M`: the rung that answered of the chain's length; nothing on a 0.5.0 row. */
function rungText(usage: LastUsage): string[] {
  return usage.rungs === undefined
    ? []
    : [`${usage.attempts.length} of ${usage.rungs}`];
}

/** The press's elapsed time to a tenth of a second (`2.3s`); nothing on a 0.5.0 row. */
function elapsedText(elapsedMs: number | undefined): string[] {
  return elapsedMs === undefined ? [] : [`${(elapsedMs / 1000).toFixed(1)}s`];
}

/** The done headline's figure: the cost as `costText` renders it (R25). */
export function doneCostText(usage: LastUsage): string {
  return costText(usage.usd ?? undefined);
}

/**
 * The done row: the last call's model, the rung that answered, the press's
 * elapsed time and the three token figures (the time and the figures down to
 * 80 columns), what the rewrite added, then what a cap leaves (R9), tail N
 * (R10); the no-cache hint stays last. The cost is the headline's.
 */
export function doneRowText(
  usage: LastUsage,
  streak: number,
  left?: string,
  tail?: number,
  tier: Tier = "full",
): string {
  const figures = hasRoom(tier)
    ? [
        ...elapsedText(usage.elapsedMs),
        `${formatTokens(usage.cached)} cached`,
        `${formatTokens(usage.input + usage.written)} in`,
        `${usage.output} out`,
      ]
    : [];
  return [
    shortModel(usage.model),
    ...rungText(usage),
    ...figures,
    `+${plural(usage.addedWords, "word")}`,
    plural(usage.skills, "skill"),
    ...(left === undefined ? [] : [left]),
    ...(tail !== undefined && tail > 0 ? [`tail ${tail}`] : []),
    ...(streak >= NO_CACHE_HINT_AFTER ? [NO_CACHE_HINT] : []),
  ].join(" · ");
}
