import { expect, test } from "claude-code/testing";
import { engine, DRAFT } from "./engine";
import {
  detailsOf,
  headlineOf,
  mount,
  rowTexts,
  variantOf,
  type Band,
} from "./band-helpers";

// R25 part 1: the row leads with a headline, one glyph and a state word in a
// theme key, bold; the details stay dim and truncate; the primary Button of
// each state is marked `variant="primary"` (the 2.1.303 d.ts declares it).

async function expectHeadline(
  ui: Band,
  text: string,
  color: string,
): Promise<void> {
  const texts = await rowTexts(ui);
  // first in the row, before the Buttons and the details
  expect(texts[0]?.text).toBe(text);
  const head = await headlineOf(ui);
  expect(head?.text).toBe(text);
  expect(head?.props.color).toBe(color);
  expect(head?.props.bold).toBe(true);
  expect(head?.props.dimColor).toBeUndefined();
  const details = await detailsOf(ui);
  expect(details?.props.dimColor).toBe(true);
  expect(details?.props.wrap).toBe("truncate-end");
  expect(details?.props.color).toBeUndefined();
}

test("idle: ↥ Ready in claude; Enhance is the primary Button", async ($, on) => {
  engine(on);
  const ui = await mount($);

  await expectHeadline(ui, "↥ Ready", "claude");
  expect(await variantOf(ui, "enhance")).toBe("primary");
});

test("running: ↻ Enhancing in warning; Cancel is primary", async ($, on) => {
  const e = engine(on, { delay: true });
  e.box.text = DRAFT;
  const ui = await mount($);

  const run = ui.press({ key: "enhance" });
  await e.modelCalled;
  await ui.drawn();

  // the counter is the working state's (R25 part 2, tests/band-running)
  await expectHeadline(ui, "↻ Enhancing 1 of 3", "warning");
  expect(await variantOf(ui, "cancel")).toBe("primary");

  e.release();
  await run;
});

test("done: ✓ Enhanced in success; Send alone is primary", async ($, on) => {
  const e = engine(on);
  e.box.text = DRAFT;
  const ui = await mount($);

  await ui.press({ key: "enhance" });

  // the cost is the headline's (R25 part 2); an alias chain is unpriced on
  // Bedrock, so it reads as costText renders that (R3)
  await expectHeadline(ui, "✓ Enhanced $? · (no price)", "success");
  expect(await variantOf(ui, "send")).toBe("primary");
  expect(await variantOf(ui, "enhance")).toBeUndefined();
  expect(await variantOf(ui, "undo")).toBeUndefined();
});

test("restored: ↶ Restored in warning; Send stays primary", async ($, on) => {
  const e = engine(on);
  e.box.text = DRAFT;
  const ui = await mount($);
  await ui.press({ key: "enhance" });

  await ui.press({ key: "undo" });

  await expectHeadline(ui, "↶ Restored", "warning");
  expect(await variantOf(ui, "send")).toBe("primary");
  expect(await variantOf(ui, "undo")).toBeUndefined();
});

test("the glyphs are the single code points R25 names", async ($, on) => {
  const e = engine(on);
  e.box.text = DRAFT;
  const ui = await mount($);
  const glyphOf = async () => (await headlineOf(ui))?.text.codePointAt(0);

  expect(await glyphOf()).toBe(0x21a5); // ↥ idle
  await ui.press({ key: "enhance" });
  expect(await glyphOf()).toBe(0x2713); // ✓ done
  await ui.press({ key: "undo" });
  expect(await glyphOf()).toBe(0x21b6); // ↶ restored
  for (const head of ["↥", "↻", "✓", "↶"]) {
    expect([...head]).toHaveLength(1);
  }
});

test("a survey draws no headline", async ($, on) => {
  engine(on);

  const ui = await mount($, { hasSurvey: true });

  expect(await headlineOf(ui)).toBeUndefined();
  expect(await ui.find({ type: "Text", text: "lower" })).toBeDefined();
});
