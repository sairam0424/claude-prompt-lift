import { expect, test } from "claude-code/testing";
import {
  answered,
  engine,
  block,
  improve,
  BEDROCK,
  BETTER,
  DRAFT,
  FABLE,
  GOOD,
  USAGE,
} from "./engine";
import { costText } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";
import { DEEPER } from "../hooks/lens";
import {
  detailsText,
  headlineText,
  keys,
  label,
  mount,
  variantOf,
  widen,
} from "./band-helpers";

// The Deeper Button (the lens in hooks/lens.ts): beside Enhance whenever the
// band shows Enhance, absent while a press runs, one call per press, and its
// result named in the headline. The Button runs with the mod's own `$`, so
// these presses are the box path of a lens end to end.

const COST = costText(estimateUsd(USAGE, FABLE, DEFAULT_PRICES));
/** A model with no price row: the done headline reads `$? · (no price)`. */
const OPUS = "us.anthropic.claude-opus-4-1";
const DEEPER_REPLY = improve(
  `${BETTER} Confirm which session expiry applies first.`,
);

test(
  "the idle band draws Deeper beside Enhance: its own key, label, hotkey, no chord",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);

    const ui = await mount($);

    const found = await ui.findAll({ type: "Button" });
    expect(found.map((b) => b.key)).toEqual(["enhance", "deeper"]);
    const deeper = found[1];
    expect(deeper?.props.label).toBe("Deeper (d)");
    expect(deeper?.props.hotkey).toBe("d");
    // The Enhance chord belongs to Enhance alone
    expect(deeper?.props.action).toBeUndefined();
    expect(deeper?.props.variant).toBeUndefined();
    expect(found[0]?.props.action).toBe("app:cycleDiffBase");
    expect(found[0]?.props.variant).toBe("primary");
    expect(e.calls).toHaveLength(0);
  },
);

test(
  "Deeper drops its hotkey legend under 100 columns; Enhance keeps its own",
  { options: BEDROCK },
  async ($, on) => {
    engine(on);
    const ui = await mount($);

    for (const columns of [120, 100]) {
      await widen(ui, columns);
      expect(await label(ui, "deeper")).toBe("Deeper (d)");
    }
    for (const columns of [99, 80, 79, 60, 50]) {
      await widen(ui, columns);
      expect(await label(ui, "deeper")).toBe("Deeper");
      expect(await label(ui, "enhance")).toBe("Enhance (e)");
      // The hotkey itself is the Button's prop, so the legend is all that goes
      expect((await ui.find({ key: "deeper" }))?.props.hotkey).toBe("d");
    }
  },
);

test(
  "no Deeper Button while a press runs",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, { delay: true });
    e.box.text = DRAFT;
    const ui = await mount($);

    const run = ui.press({ key: "deeper" });
    await e.modelCalled;
    await ui.drawn();

    expect(await keys(ui)).toEqual(["cancel"]);
    e.release();
    await run;
  },
);

test("yields to a survey", { options: BEDROCK }, async ($, on) => {
  engine(on);

  const ui = await mount($, { hasSurvey: true });

  expect(await keys(ui)).toEqual([]);
});

test(
  "Deeper sends the box through the lens and names the result in the headline",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);
    e.box.text = DRAFT;
    const ui = await mount($);

    await ui.press({ key: "deeper" });

    expect(e.calls).toHaveLength(1);
    expect(block(e, 0, 1)).toContain(`<draft>${DRAFT}</draft>`);
    expect(block(e, 0, 1)).toContain(DEEPER.text);
    expect(e.box.text).toBe(BETTER);
    expect(await headlineText(ui)).toBe(`✓ Deepened ${COST}`);
    expect(await keys(ui)).toEqual(["enhance", "deeper", "send", "undo"]);
    expect(await variantOf(ui, "deeper")).toBeUndefined();
    expect(await variantOf(ui, "send")).toBe("primary");
  },
);

test(
  "pressing Enhance after Undo names the next result Enhanced again",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);
    e.box.text = DRAFT;
    const ui = await mount($);

    await ui.press({ key: "deeper" });
    await ui.press({ key: "undo" });
    expect(e.box.text).toBe(DRAFT);
    expect(await headlineText(ui)).toBe("↶ Restored");
    await ui.press({ key: "enhance" });

    expect(e.calls).toHaveLength(2);
    expect(block(e, 1, 1)).not.toContain(DEEPER.text);
    expect(await headlineText(ui)).toBe(`✓ Enhanced ${COST}`);
  },
);

test(
  "Enhance then Deeper then Undo restores the draft as first typed",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, { replies: [answered(GOOD), answered(DEEPER_REPLY)] });
    e.box.text = DRAFT;
    const ui = await mount($);

    await ui.press({ key: "enhance" });
    expect(e.box.text).toBe(BETTER);
    await ui.press({ key: "deeper" });

    // The second press rewrote the enhanced text, with the lens
    expect(block(e, 1, 1)).toContain(`<draft>${BETTER}</draft>`);
    expect(block(e, 1, 1)).toContain(DEEPER.text);
    expect(e.box.text).toBe(
      `${BETTER} Confirm which session expiry applies first.`,
    );
    expect(await headlineText(ui)).toBe(`✓ Deepened ${COST}`);

    await ui.press({ key: "undo" });

    expect(e.box.text).toBe(DRAFT);
  },
);

test(
  "a draft the model leaves as is keeps both Buttons and says nothing deeper to add",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, {
      replies: [answered(JSON.stringify({ verdict: "fine" }))],
    });
    e.box.text = DRAFT;
    const ui = await mount($);

    await ui.press({ key: "deeper" });

    expect(e.box.text).toBe(DRAFT);
    expect(await headlineText(ui)).toBe("✗ Kept as is");
    expect(
      (await detailsText(ui)).startsWith("nothing deeper to add, left as is"),
    ).toBe(true);
    expect(await keys(ui)).toEqual(["enhance", "deeper"]);
  },
);

test(
  "Enhance and Deeper in one tick make one call",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, { delay: true });
    e.box.text = DRAFT;
    const ui = await mount($);

    const both = Promise.all([
      ui.press({ key: "enhance" }),
      ui.press({ key: "deeper" }),
    ]);
    await e.modelCalled;
    e.release();
    await both;

    expect(e.calls).toHaveLength(1);
    expect(e.toasts).toContain("prompt-lift: already enhancing");
  },
);

test(
  "the Deepened headline narrows like any other: the word goes under 60 columns",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);
    e.box.text = DRAFT;
    const ui = await mount($);

    await ui.press({ key: "deeper" });
    await widen(ui, 70);
    expect(await headlineText(ui)).toBe(`✓ Deepened ${COST}`);
    await widen(ui, 50);
    expect(await headlineText(ui)).toBe(`✓ ${COST}`);
  },
);

// The engine clips a row that is too wide at its right edge, and the done
// row's rightmost Buttons are Send and Undo; an unpriced chain's headline
// (`✓ Enhanced $? · (no price)`) is 26 cells. So the done family draws Deeper
// only where the row has room (80 columns and up), and the idle row always.
test(
  "the done family draws Deeper only from 80 columns; the idle row always does",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);
    e.box.text = DRAFT;
    const ui = await mount($);
    await widen(ui, 70);
    expect(await keys(ui)).toEqual(["enhance", "deeper"]);

    await ui.press({ key: "enhance" });

    for (const columns of [120, 100, 99, 80]) {
      await widen(ui, columns);
      expect(await keys(ui)).toEqual(["enhance", "deeper", "send", "undo"]);
    }
    await widen(ui, 100);
    expect(await label(ui, "deeper")).toBe("Deeper (d)");
    await widen(ui, 90);
    expect(await label(ui, "deeper")).toBe("Deeper");
    // Narrower, the row is the one it was before the Button existed
    for (const columns of [79, 70, 60, 50]) {
      await widen(ui, columns);
      expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
    }
    // Undo turns the same family into Restored/Redo: the same rule
    await ui.press({ key: "undo" });
    await widen(ui, 70);
    expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
    await widen(ui, 120);
    expect(await keys(ui)).toEqual(["enhance", "deeper", "send", "undo"]);
    expect(await headlineText(ui)).toBe("↶ Restored");
  },
);

test(
  "the unpriced done row fits an 80-column band: Undo is not clipped by Deeper",
  { options: { models: OPUS } },
  async ($, on) => {
    const e = engine(on);
    e.box.text = DRAFT;
    const ui = await mount($);

    await ui.press({ key: "deeper" });
    await widen(ui, 80);

    // An alias chain off the Anthropic API is unpriced: the long headline
    expect(await headlineText(ui)).toBe("✓ Deepened $? · (no price)");
    // 26 (headline) + Enhance 15 + Deeper 10 + Send 12 + Undo 12 + 4 gaps
    const cells = 26 + 15 + 10 + 12 + 12 + 4;
    expect(cells).toBeLessThanOrEqual(80);
    expect(await keys(ui)).toEqual(["enhance", "deeper", "send", "undo"]);
    expect(await label(ui, "deeper")).toBe("Deeper");
  },
);
