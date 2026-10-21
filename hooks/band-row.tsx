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

/** The three token figures stay at `noHint` and above (80 columns and up). */
function keepsFigures(tier: Tier): boolean {
  return tier === "full" || tier === "noHint";
}

export type Headline = { text: string; color: ThemeKey };

/** The headline for `state`: glyph and word, or the glyph alone when `minimal`. */
export function headline(state: BandState, tier: Tier): Headline {
  const { glyph, word, color } = HEADLINES[state];
  return { text: tier === "minimal" ? glyph : `${glyph} ${word}`, color };
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

export function runningRowText(modelId: string): string {
  return `Enhancing with ${shortModel(modelId)}…`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The done row: the last call's usage (its three token figures down to 80
 * columns), what the rewrite added, then what a cap leaves (R9), tail N
 * (R10); the no-cache hint stays last.
 */
export function doneRowText(
  usage: LastUsage,
  streak: number,
  left?: string,
  tail?: number,
  tier: Tier = "full",
): string {
  const figures = keepsFigures(tier)
    ? [
        `${formatTokens(usage.cached)} cached`,
        `${formatTokens(usage.input + usage.written)} in`,
        `${usage.output} out`,
      ]
    : [];
  return [
    shortModel(usage.model),
    ...figures,
    costText(usage.usd ?? undefined),
    `+${plural(usage.addedWords, "word")}`,
    plural(usage.skills, "skill"),
    ...(left === undefined ? [] : [left]),
    ...(tail !== undefined && tail > 0 ? [`tail ${tail}`] : []),
    ...(streak >= NO_CACHE_HINT_AFTER ? [NO_CACHE_HINT] : []),
  ].join(" · ");
}
