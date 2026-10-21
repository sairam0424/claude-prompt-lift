import { expect, test } from "claude-code/testing";
import { engine, BEDROCK, DRAFT, FABLE, USAGE } from "./engine";
import {
  detailsText,
  headlineText,
  keys,
  mount,
  stripRuns,
  widen,
} from "./band-helpers";
import { doneRowText, idleRowText, stripOf, tierOf } from "../hooks/band-row";
import { costText } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";
import type { LastUsage } from "../types";

// R25 width tiers, from `e.props.bodyColumns`: at 100 and up the whole row;
// 80-99 the idle key hint goes; under 80 the done row's three token figures
// and the strip's other rungs go; under 60 the headline keeps its glyph alone
// (the running counter as `N/M`). The kit's `redraw(props)` is the engine
// handing the hook new props, as a narrower terminal does.

const NO_CACHE_HINT = "cache not hitting — consider /prompt-lift model haiku";
const LAST: LastUsage = {
  model: FABLE,
  input: 1400,
  cached: 6800,
  written: 0,
  output: 310,
  usd: 0.04027,
  attempts: ["fable 5.1: ok"],
  why: "added symptom and test",
  addedWords: 12,
  skills: 1,
  hashChanged: false,
  rungs: 1,
  elapsedMs: 2300,
};
const FULL_DONE =
  "fable 5.1 · 1 of 1 · 2.3s · 6.8k cached · 1.4k in · 310 out · +12 words · 1 skill";
/** What a Fable press on the stub's usage costs, as the done headline shows it. */
const FABLE_COST = costText(estimateUsd(USAGE, FABLE, DEFAULT_PRICES));

// --- pure tiers ---

test("tierOf: the steps are at 100, 80 and 60 columns", () => {
  expect(tierOf(120)).toBe("full");
  expect(tierOf(100)).toBe("full");
  expect(tierOf(99)).toBe("noHint");
  expect(tierOf(80)).toBe("noHint");
  expect(tierOf(79)).toBe("compact");
  expect(tierOf(60)).toBe("compact");
  expect(tierOf(59)).toBe("minimal");
  expect(tierOf(0)).toBe("minimal");
});

test("idle text keeps the key hint at full only; the rest stays", () => {
  expect(idleRowText(FABLE, "$0.85 left", 6, "full")).toBe(
    "ctrl+x b · or ctrl+x tab, e · prompt-lift: fable 5.1 · $0.85 left · tail 6",
  );
  expect(idleRowText(FABLE, "$0.85 left", 6, "noHint")).toBe(
    "prompt-lift: fable 5.1 · $0.85 left · tail 6",
  );
  expect(idleRowText(FABLE, undefined, undefined, "compact")).toBe(
    "prompt-lift: fable 5.1",
  );
  expect(idleRowText(FABLE, undefined, undefined, "minimal")).toBe(
    "prompt-lift: fable 5.1",
  );
});

test("done text drops the token figures and the elapsed time under 80 columns only", () => {
  expect(doneRowText(LAST, 0, undefined, undefined, "full")).toBe(FULL_DONE);
  expect(doneRowText(LAST, 0, undefined, undefined, "noHint")).toBe(FULL_DONE);
  expect(doneRowText(LAST, 0, undefined, undefined, "compact")).toBe(
    "fable 5.1 · 1 of 1 · +12 words · 1 skill",
  );
  expect(doneRowText(LAST, 3, "$0.30 left (day)", 6, "minimal")).toBe(
    `fable 5.1 · 1 of 1 · +12 words · 1 skill · $0.30 left (day) · tail 6 · ${NO_CACHE_HINT}`,
  );
});

// The running strip also yields to the room beside the headline (`↻ Enhancing
// 1 of 3`, 18 cells), the primary Cancel Button (`[ Cancel (c) ]`, 14) and
// the two gaps: at 80 columns that leaves 46 cells for the labels and their
// ` › ` separators.
const LONG_CHAIN = [
  "us.anthropic.claude-opus-4-1-20250805-v1:0",
  "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "us.anthropic.claude-3-5-haiku-20241022-v1:0",
];

test("stripOf: rungs that fit keep every rung, however wide the tier", () => {
  const strip = stripOf(
    [FABLE, "x".repeat(20), "x".repeat(23)],
    FABLE,
    "full",
    120,
  );
  expect(strip?.runs.map((run) => run.label)).toEqual([
    "fable 5.1",
    "x".repeat(20),
    "x".repeat(23),
  ]);
  expect(strip).toMatchObject({ rung: 1, rungs: 3 });
});

test("stripOf: full ids that do not fit collapse to the active rung at a wide tier", () => {
  const strip = stripOf(LONG_CHAIN, LONG_CHAIN[1] ?? "", "full", 120);
  expect(strip?.runs).toEqual([{ label: LONG_CHAIN[1], state: "active" }]);
  // the counter still counts the whole chain
  expect(strip).toMatchObject({ rung: 2, rungs: 3 });
});

test("stripOf: the labels fit when they take the room exactly, not one cell more", () => {
  const first = "x".repeat(20);
  const exact = stripOf([first, "y".repeat(23)], first, "noHint", 80);
  expect(exact?.runs).toHaveLength(2);
  const over = stripOf([first, "y".repeat(24)], first, "noHint", 80);
  expect(over?.runs).toEqual([{ label: first, state: "active" }]);
  // a wider band takes the same labels back
  expect(
    stripOf([first, "y".repeat(24)], first, "noHint", 81)?.runs,
  ).toHaveLength(2);
});

test("stripOf: under 80 columns the active rung alone, as before", () => {
  const strip = stripOf([FABLE, "y"], FABLE, "compact", 70);
  expect(strip?.runs).toEqual([{ label: "fable 5.1", state: "active" }]);
});

test("stripOf: an empty running id is the chain's first rung; an unnamed id has no strip", () => {
  const chain = [FABLE, "y"];
  expect(stripOf(chain, "", "full", 120)).toEqual(
    stripOf(chain, FABLE, "full", 120),
  );
  expect(stripOf(chain, "", "full", 120)).toMatchObject({ rung: 1, rungs: 2 });
  expect(stripOf(chain, "z", "full", 120)).toBeUndefined();
  expect(stripOf([], "", "full", 120)).toBeUndefined();
});

// --- the drawing ---

test(
  "idle row: the hint at 120, gone at 90 and 70, the glyph alone at 50",
  { options: BEDROCK },
  async ($, on) => {
    engine(on);
    const ui = await mount($);

    expect(await detailsText(ui)).toBe(idleRowText(FABLE));
    expect(await headlineText(ui)).toBe("↥ Ready");

    await widen(ui, 90);
    expect(await detailsText(ui)).toBe("prompt-lift: fable 5.1");
    expect(await headlineText(ui)).toBe("↥ Ready");

    await widen(ui, 70);
    expect(await detailsText(ui)).toBe("prompt-lift: fable 5.1");
    expect(await headlineText(ui)).toBe("↥ Ready");

    await widen(ui, 50);
    expect(await detailsText(ui)).toBe("prompt-lift: fable 5.1");
    expect(await headlineText(ui)).toBe("↥");
    expect(await keys(ui)).toEqual(["enhance"]);
  },
);

test(
  "done row: the figures at 120 and 90, gone at 70, the glyph and cost alone at 50",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);
    e.box.text = DRAFT;
    const ui = await mount($);
    await ui.press({ key: "enhance" });

    const full = await detailsText(ui);
    expect(
      full.startsWith("fable 5.1 · 1 of 3 · 0.0s · 6.8k cached · 1.4k in · 310 out · +"),
    ).toBe(true);
    expect(await headlineText(ui)).toBe(`✓ Enhanced ${FABLE_COST}`);

    await widen(ui, 90);
    expect(await detailsText(ui)).toBe(full);
    expect(await headlineText(ui)).toBe(`✓ Enhanced ${FABLE_COST}`);

    await widen(ui, 70);
    const compact = await detailsText(ui);
    expect(compact.startsWith("fable 5.1 · 1 of 3 · +")).toBe(true);
    expect(compact).not.toContain(" cached");
    expect(compact).not.toContain(" in · ");
    expect(compact).not.toContain(" out · ");
    expect(compact).not.toContain("0.0s");
    expect(compact).toContain("words · ");
    expect(await headlineText(ui)).toBe(`✓ Enhanced ${FABLE_COST}`);

    await widen(ui, 50);
    expect(await detailsText(ui)).toBe(compact);
    expect(await headlineText(ui)).toBe(`✓ ${FABLE_COST}`);
    expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
  },
);

test(
  "running row: the whole strip at 120 and 90, the active rung alone at 70, ↻ 1/3 at 50",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, { delay: true });
    e.box.text = DRAFT;
    const ui = await mount($);
    const run = ui.press({ key: "enhance" });
    await e.modelCalled;
    await ui.drawn();

    expect(await headlineText(ui)).toBe("↻ Enhancing 1 of 3");
    expect(await detailsText(ui)).toBe("fable 5.1 › sonnet 5.5 › haiku 5.5");
    expect(await stripRuns(ui)).toHaveLength(3);

    await widen(ui, 90);
    expect(await headlineText(ui)).toBe("↻ Enhancing 1 of 3");
    expect(await detailsText(ui)).toBe("fable 5.1 › sonnet 5.5 › haiku 5.5");

    await widen(ui, 70);
    expect(await headlineText(ui)).toBe("↻ Enhancing 1 of 3");
    expect(await detailsText(ui)).toBe("fable 5.1");
    expect((await stripRuns(ui)).map((r) => r.props.bold)).toEqual([true]);

    await widen(ui, 50);
    expect(await headlineText(ui)).toBe("↻ 1/3");
    expect(await detailsText(ui)).toBe("fable 5.1");
    expect(await keys(ui)).toEqual(["cancel"]);

    e.release();
    await run;
  },
);

test(
  "a widened band gets its hint back",
  { options: BEDROCK },
  async ($, on) => {
    engine(on);
    const ui = await mount($);

    await widen(ui, 50);
    expect(await headlineText(ui)).toBe("↥");

    await widen(ui, 120);
    expect(await headlineText(ui)).toBe("↥ Ready");
    expect(await detailsText(ui)).toBe(idleRowText(FABLE));
  },
);
