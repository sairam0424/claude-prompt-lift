import { expect, test } from "claude-code/testing";
import type { Engine as Harness } from "claude-code/testing";
import type { ModelCompleteResult, On } from "claude-code";
import {
  answered,
  engine,
  press,
  watch,
  BEDROCK,
  BETTER,
  DRAFT,
  FABLE,
  GOOD,
  ROOT,
  USAGE,
  ZERO_USAGE,
} from "./engine";
import {
  detailsText,
  headlineOf,
  headlineText,
  keys,
  mount,
  variantOf,
} from "./band-helpers";
import { costText } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";

// R25, the verdict row: a press that ends without a fill leaves its reason in
// the row, headline and the toast's own words, until the next action (a press,
// Enter, any /prompt-lift command, session.start). The 4-second toast is
// unchanged. Nothing times the row out: `settle` writes `lastVerdict`, the
// band reads it, and the next action writes it away.

const FINE = answered(JSON.stringify({ verdict: "fine" }));
const FINE_REASON = "already specific, left as is";
const GUARD_REASON = "commands and shell lines are sent as typed";
const ABORTED: ModelCompleteResult = {
  isAnswered: false,
  reason: "aborted",
  usage: ZERO_USAGE,
};
const RATE_LIMITED: ModelCompleteResult = {
  isAnswered: false,
  reason: "api-error",
  error: "rate_limit",
  status: 429,
  usage: ZERO_USAGE,
};
const FABLE_USD = estimateUsd(USAGE, FABLE, DEFAULT_PRICES);
const FABLE_COST = costText(FABLE_USD);
/** What a press that paid for nothing shows: the bare figure, no "(no price)". */
const FREE = costText(0);
/** A box line the guards refuse before any call: it starts with a slash. */
const COMMAND_LINE = "/clear the screen and start over please";
const ENTER = {
  text: "hello there",
  wait: false,
  origin: { kind: "composer" },
} as never;

/** The row after a refusal before any call, from a fresh engine. */
async function refusedRow($: Harness, on: On) {
  const e = engine(on);
  const verdicts = watch(on, "lastVerdict");
  e.box.text = COMMAND_LINE;
  const ui = await mount($);
  await ui.press({ key: "enhance" });
  return { e, verdicts, ui };
}

test(
  "a fine verdict keeps ✗ Kept as is and its cost in the row; the next press clears it",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, { replies: [FINE, answered(GOOD)] });
    const verdicts = watch(on, "lastVerdict");
    e.box.text = DRAFT;
    const ui = await mount($);

    await ui.press({ key: "enhance" });

    expect(e.toasts).toEqual([`prompt-lift: ${FINE_REASON} · ${FABLE_COST}`]);
    expect(verdicts).toEqual([
      { kind: "refused", text: FINE_REASON, usd: FABLE_USD },
    ]);
    const head = await headlineOf(ui);
    expect(head?.text).toBe("✗ Kept as is");
    expect(head?.props.color).toBe("warning");
    expect(head?.props.bold).toBe(true);
    expect(await detailsText(ui)).toBe(`${FINE_REASON} · ${FABLE_COST}`);
    expect(await keys(ui)).toEqual(["enhance"]);
    expect(await variantOf(ui, "enhance")).toBe("primary");

    // a new press clears it: the phase goes to running, the verdict to null
    await ui.press({ key: "enhance" });

    expect(verdicts).toEqual([
      { kind: "refused", text: FINE_REASON, usd: FABLE_USD },
      null,
    ]);
    expect(e.box.text).toBe(BETTER);
    expect(await headlineText(ui)).toBe(`✓ Enhanced ${FABLE_COST}`);
  },
);

test(
  "a chain that answers nothing keeps ✗ Failed in error with the attempt trail",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, {
      replies: [RATE_LIMITED, RATE_LIMITED, RATE_LIMITED],
    });
    const verdicts = watch(on, "lastVerdict");
    e.box.text = DRAFT;
    const ui = await mount($);

    await ui.press({ key: "enhance" });

    expect(e.calls).toHaveLength(3);
    const toast = e.toasts[0] ?? "";
    expect(
      toast.startsWith("prompt-lift: no model answered · fable 5.1: "),
    ).toBe(true);
    // the row repeats the toast's words, less the prefix
    const words = toast.replace(/^prompt-lift: /, "");
    expect(words).toMatch(/ · \$0\.000$/);
    expect(verdicts).toEqual([
      { kind: "failed", text: words.replace(/ · \$0\.000$/, ""), usd: 0 },
    ]);
    const head = await headlineOf(ui);
    expect(head?.text).toBe("✗ Failed");
    expect(head?.props.color).toBe("error");
    expect(await detailsText(ui)).toBe(words);
    expect(await keys(ui)).toEqual(["enhance"]);
  },
);

test(
  "a cancelled press keeps ✗ Cancelled · draft unchanged in warning",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, { delay: true, replies: [ABORTED, answered(GOOD)] });
    const verdicts = watch(on, "lastVerdict");
    e.box.text = DRAFT;
    const ui = await mount($);

    const run = ui.press({ key: "enhance" });
    await e.modelCalled;
    await ui.press({ key: "cancel" });
    e.release();
    await run;

    expect(e.toasts).toEqual([
      `prompt-lift: cancelled, draft unchanged · ${FREE}`,
    ]);
    expect(verdicts).toEqual([
      { kind: "cancelled", text: "draft unchanged", usd: 0 },
    ]);
    const head = await headlineOf(ui);
    expect(head?.text).toBe("✗ Cancelled");
    expect(head?.props.color).toBe("warning");
    expect(await detailsText(ui)).toBe(`draft unchanged · ${FREE}`);
    expect(await keys(ui)).toEqual(["enhance"]);
    expect(e.box.text).toBe(DRAFT);
  },
);

test(
  "a refusal after a done press keeps the three done Buttons",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);
    e.box.text = DRAFT;
    const ui = await mount($);
    await ui.press({ key: "enhance" });
    expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);

    // a second press on the enhanced box, with a line the guards refuse
    e.box.text = COMMAND_LINE;
    await ui.press({ key: "enhance" });

    expect(e.calls).toHaveLength(1);
    expect(e.toasts.at(-1)).toBe(`prompt-lift: ${GUARD_REASON}`);
    expect(await headlineText(ui)).toBe("✗ Kept as is");
    expect(await detailsText(ui)).toBe(`${GUARD_REASON} · ${FREE}`);
    expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
    expect(await variantOf(ui, "send")).toBe("primary");
  },
);

test(
  "Undo is the next action: it ends the verdict and the restored row is drawn",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);
    const verdicts = watch(on, "lastVerdict");
    e.box.text = DRAFT;
    const ui = await mount($);
    await ui.press({ key: "enhance" });
    e.box.text = COMMAND_LINE;
    await ui.press({ key: "enhance" });
    expect(await headlineText(ui)).toBe("✗ Kept as is");
    // the box shows the enhanced text again, so Undo acts on this press
    e.box.text = BETTER;

    await ui.press({ key: "undo" });

    expect(e.box.text).toBe(DRAFT);
    expect(verdicts).toEqual([
      { kind: "refused", text: GUARD_REASON, usd: 0 },
      null,
    ]);
    expect(await headlineText(ui)).toBe("↶ Restored");
  },
);

test("Enter clears the verdict", async ($, on) => {
  const { e, verdicts, ui } = await refusedRow($, on);
  expect(await headlineText(ui)).toBe("✗ Kept as is");
  expect(verdicts).toHaveLength(1);

  await $.prompt.submit(ENTER);

  expect(e.submits).toHaveLength(1);
  expect(verdicts).toEqual([
    { kind: "refused", text: GUARD_REASON, usd: 0 },
    null,
  ]);
  expect(await headlineText(ui)).toBe("↥ Ready");
});

test("an Enter the engine drops leaves the verdict in the row", async ($, on) => {
  const e = engine(on, { drop: "a hook said no" });
  const verdicts = watch(on, "lastVerdict");
  e.box.text = COMMAND_LINE;
  const ui = await mount($);
  await ui.press({ key: "enhance" });

  await $.prompt.submit(ENTER);

  expect(verdicts).toHaveLength(1);
  expect(await headlineText(ui)).toBe("✗ Kept as is");
});

test("any /prompt-lift command clears the verdict", async ($, on) => {
  const { verdicts, ui } = await refusedRow($, on);
  expect(await headlineText(ui)).toBe("✗ Kept as is");

  await press($, "status");

  expect(verdicts).toEqual([
    { kind: "refused", text: GUARD_REASON, usd: 0 },
    null,
  ]);
  expect(await headlineText(ui)).toBe("↥ Ready");
});

test("session.start clears the verdict", async ($, on) => {
  const { verdicts, ui } = await refusedRow($, on);
  expect(await headlineText(ui)).toBe("✗ Kept as is");

  await $.session.start({
    cwd: ROOT,
    surface: "terminal",
    isInteractive: true,
  } as never);

  expect(verdicts).toEqual([
    { kind: "refused", text: GUARD_REASON, usd: 0 },
    null,
  ]);
  expect(await headlineText(ui)).toBe("↥ Ready");
});

test("below 60 columns the verdict headline keeps its glyph alone", async ($, on) => {
  const e = engine(on);
  e.box.text = COMMAND_LINE;
  const ui = await mount($, { bodyColumns: 50 });

  await ui.press({ key: "enhance" });

  expect(await headlineText(ui)).toBe("✗");
  expect(await detailsText(ui)).toBe(`${GUARD_REASON} · ${FREE}`);
});
