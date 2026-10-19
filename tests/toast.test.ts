import { expect, test } from "claude-code/testing";
import type { ModelUsage } from "claude-code";
import {
  capToast,
  costText,
  cut,
  formatDollars,
  usageText,
  TOAST_MAX,
  WHY_MAX,
} from "../hooks/chain";

// The text of a toast (spec §12; R2, R3): one line of at most 200 chars, the
// model's `why` cut to 60, and `$? · (no price)` for a model the price table
// does not cover.

const OPUS = "us.anthropic.claude-opus-4-1";
const HAIKU = "us.anthropic.claude-haiku-5-5";
const NO_USAGE: ModelUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};
const WARM: ModelUsage = {
  input_tokens: 1400,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 6800,
  output_tokens: 310,
};

test("formatDollars prints $? for a cost no price table covers", async () => {
  expect(formatDollars(undefined)).toBe("$?");
  expect(formatDollars(0.04027)).toBe("$0.04");
  expect(formatDollars(0.006)).toBe("$0.006");
  expect(formatDollars(0)).toBe("$0.000");
});

test("costText says why there are no dollars", async () => {
  expect(costText(undefined)).toBe("$? · (no price)");
  expect(costText(0.04027)).toBe("$0.04");
});

test("usageText shows $? and (no price) for an unpriced model", async () => {
  const text = usageText({
    model: OPUS,
    usage: WARM,
    usd: undefined,
    why: "added the symptom",
    attempts: [{ model: OPUS, outcome: "ok", usage: NO_USAGE }],
  });

  expect(text).toBe(
    `prompt-lift: ${OPUS} · 6.8k cached · 1.4k in · 310 out · $? · (no price) · added the symptom`,
  );
  expect(text).not.toContain("$0");
});

test("usageText cuts the why to WHY_MAX chars with an ellipsis", async () => {
  const text = usageText({
    model: HAIKU,
    usage: WARM,
    usd: 0.006,
    why: "w".repeat(WHY_MAX + 40),
    attempts: [{ model: HAIKU, outcome: "ok", usage: NO_USAGE }],
  });

  expect(WHY_MAX).toBe(60);
  expect(text).toContain(` · ${"w".repeat(WHY_MAX - 1)}…`);
  expect(text).not.toContain("w".repeat(WHY_MAX));
});

test("cut keeps text within max and marks what it dropped", async () => {
  expect(cut("short", 10)).toBe("short");
  expect(cut("0123456789", 10)).toBe("0123456789");
  expect(cut("0123456789x", 10)).toBe("012345678…");
  expect(cut("0123456789x", 10).length).toBe(10);
  expect(cut("", 10)).toBe("");
});

test("cut counts characters, so an emoji on the cut is kept whole", async () => {
  // Five characters in six UTF-16 code units: a code-unit slice would leave
  // a lone surrogate before the ellipsis
  expect(cut("ab😀cd", 4)).toBe("ab😀…");
  expect(Array.from(cut("ab😀cd", 4))).toHaveLength(4);
  expect(cut("😀😀😀", 3)).toBe("😀😀😀");
  expect(cut("😀😀😀x", 3)).toBe("😀😀…");
});

test("capToast makes one line of at most TOAST_MAX chars", async () => {
  expect(TOAST_MAX).toBe(200);
  expect(capToast("a\nb\n\nc\td  e")).toBe("a b c d e");
  expect(capToast("  padded  ")).toBe("padded");
  expect(capToast("y".repeat(TOAST_MAX))).toBe("y".repeat(TOAST_MAX));

  const long = capToast("x".repeat(TOAST_MAX + 100));
  expect(long.length).toBe(TOAST_MAX);
  expect(long.endsWith("…")).toBe(true);

  // Whitespace collapses before the cut, so wrapped text is not cut short
  const lines = Array.from({ length: 60 }, () => "ab");
  expect(capToast(lines.join("\n"))).toBe(lines.join(" "));
});
