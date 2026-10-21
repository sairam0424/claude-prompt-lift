import { expect, test } from "claude-code/testing";
import { engine, BEDROCK, DRAFT, FABLE } from "./engine";
import {
  detailsText,
  headlineText,
  keys,
  mount,
  stripRuns,
  widen,
} from "./band-helpers";
import { doneRowText, idleRowText, tierOf } from "../hooks/band-row";
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
};
const FULL_DONE =
  "fable 5.1 · 6.8k cached · 1.4k in · 310 out · $0.04 · +12 words · 1 skill";

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

test("done text drops the three token figures under 80 columns only", () => {
  expect(doneRowText(LAST, 0, undefined, undefined, "full")).toBe(FULL_DONE);
  expect(doneRowText(LAST, 0, undefined, undefined, "noHint")).toBe(FULL_DONE);
  expect(doneRowText(LAST, 0, undefined, undefined, "compact")).toBe(
    "fable 5.1 · $0.04 · +12 words · 1 skill",
  );
  expect(doneRowText(LAST, 3, "$0.30 left (day)", 6, "minimal")).toBe(
    `fable 5.1 · $0.04 · +12 words · 1 skill · $0.30 left (day) · tail 6 · ${NO_CACHE_HINT}`,
  );
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
  "done row: the figures at 120 and 90, gone at 70, the glyph alone at 50",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);
    e.box.text = DRAFT;
    const ui = await mount($);
    await ui.press({ key: "enhance" });

    const full = await detailsText(ui);
    expect(
      full?.startsWith("fable 5.1 · 6.8k cached · 1.4k in · 310 out · $"),
    ).toBe(true);
    expect(await headlineText(ui)).toBe("✓ Enhanced");

    await widen(ui, 90);
    expect(await detailsText(ui)).toBe(full);
    expect(await headlineText(ui)).toBe("✓ Enhanced");

    await widen(ui, 70);
    const compact = await detailsText(ui);
    expect(compact?.startsWith("fable 5.1 · $")).toBe(true);
    expect(compact).not.toContain(" cached");
    expect(compact).not.toContain(" in · ");
    expect(compact).not.toContain(" out · ");
    expect(compact).toContain("words · ");
    expect(await headlineText(ui)).toBe("✓ Enhanced");

    await widen(ui, 50);
    expect(await detailsText(ui)).toBe(compact);
    expect(await headlineText(ui)).toBe("✓");
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
