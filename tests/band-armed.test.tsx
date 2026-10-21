import { expect, test } from "claude-code/testing";
import type { Engine as Harness } from "claude-code/testing";
import type { On } from "claude-code";
import {
  engine,
  watch,
  BEDROCK,
  BETTER,
  DRAFT,
  FABLE,
  USAGE,
  type EngineOptions,
} from "./engine";
import {
  detailsText,
  headlineOf,
  headlineText,
  keys,
  mount,
  variantOf,
  type Band,
} from "./band-helpers";
import { UNDO_REARM_MS } from "../hooks/actions";
import { costText } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";

// R25, the armed-Undo marker: Undo on a box edited since Enhance arms a 10 s
// confirm window (C13) that lives in module state, not `$.state`, so the press
// asks for a redraw (`$.ui.invalidate("ui.render")`) and the band reads the
// window with one clock read per draw. No timer: after the window the marker
// drops at the next redraw, whatever causes it.

const EDITED = `${BETTER} and also the logout path`;
const ARMED_DETAILS =
  "box edited since Enhance · press Undo again to discard it";
const DONE = `✓ Enhanced ${costText(estimateUsd(USAGE, FABLE, DEFAULT_PRICES))}`;
const COMMAND_LINE = "/clear the screen and start over please";

/** Every event name the mod asked to be redrawn, in order. */
function invalidations(on: On): string[] {
  const seen: string[] = [];
  on("ui.invalidate", ($, e, next) => {
    seen.push(e.event);
    return next(e);
  });
  return seen;
}

/** An enhanced box the person then edited, with the band mounted over it. */
async function editedAfterEnhance(
  $: Harness,
  on: On,
  opts: EngineOptions = {},
): Promise<{ e: ReturnType<typeof engine>; ui: Band }> {
  const e = engine(on, opts);
  e.box.text = DRAFT;
  const ui = await mount($);
  await ui.press({ key: "enhance" });
  e.box.text = EDITED;
  return { e, ui };
}

test(
  "Undo on an edited box draws ↶ Undo? and asks the band to redraw",
  { options: BEDROCK },
  async ($, on) => {
    const redraws = invalidations(on);
    const { e, ui } = await editedAfterEnhance($, on);
    expect(await headlineText(ui)).toBe(DONE);
    expect(redraws).toEqual([]);

    await ui.press({ key: "undo" });

    expect(redraws).toEqual(["ui.render"]);
    expect(e.box.text).toBe(EDITED);
    expect(e.toasts.at(-1)).toBe(
      "prompt-lift: box edited since Enhance; press Undo again within 10 s to discard",
    );
    const head = await headlineOf(ui);
    expect(head?.text).toBe("↶ Undo?");
    expect(head?.props.color).toBe("warning");
    expect(head?.props.bold).toBe(true);
    expect(await detailsText(ui)).toBe(ARMED_DETAILS);
    // the done Buttons stay: a second Undo is what the marker asks for
    expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
    expect(await variantOf(ui, "send")).toBe("primary");
  },
);

test(
  "a second Undo inside the window restores the draft and the marker goes",
  { options: BEDROCK },
  async ($, on) => {
    const { e, ui } = await editedAfterEnhance($, on);
    await ui.press({ key: "undo" });
    expect(await headlineText(ui)).toBe("↶ Undo?");

    await e.clock.advance(5_000);
    await ui.press({ key: "undo" });

    expect(e.box.text).toBe(DRAFT);
    expect(await headlineText(ui)).toBe("↶ Restored");
    expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
  },
);

test(
  "the marker drops at the next redraw after the window, with no timer to end it",
  { options: BEDROCK },
  async ($, on) => {
    const { e, ui } = await editedAfterEnhance($, on);
    await ui.press({ key: "undo" });
    expect(await headlineText(ui)).toBe("↶ Undo?");

    // nothing ticks: time passing alone redraws nothing
    await e.clock.advance(UNDO_REARM_MS + 1_000);
    expect(await headlineText(ui)).toBe("↶ Undo?");

    await ui.redraw();

    expect(await headlineText(ui)).toBe(DONE);
    expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
    // the window is closed for the Undo press too: it arms again
    await ui.press({ key: "undo" });
    expect(e.box.text).toBe(EDITED);
    expect(await headlineText(ui)).toBe("↶ Undo?");
  },
);

test(
  "the marker shows for as long as a second Undo would restore: the window's last millisecond included",
  { options: BEDROCK },
  async ($, on) => {
    const { e, ui } = await editedAfterEnhance($, on);
    await ui.press({ key: "undo" });

    await e.clock.advance(UNDO_REARM_MS);
    await ui.redraw();
    expect(await headlineText(ui)).toBe("↶ Undo?");

    await e.clock.advance(1);
    await ui.redraw();
    expect(await headlineText(ui)).toBe(DONE);
  },
);

test(
  "Undo on an edited box ends a verdict the row still showed",
  { options: BEDROCK },
  async ($, on) => {
    const verdicts = watch(on, "lastVerdict");
    const e = engine(on);
    e.box.text = DRAFT;
    const ui = await mount($);
    await ui.press({ key: "enhance" });
    e.box.text = COMMAND_LINE;
    await ui.press({ key: "enhance" });
    expect(await headlineText(ui)).toBe("✗ Kept as is");

    await ui.press({ key: "undo" });

    expect(verdicts.at(-1)).toBeNull();
    expect(await headlineText(ui)).toBe("↶ Undo?");
    await e.clock.advance(UNDO_REARM_MS + 1);
    await ui.redraw();
    expect(await headlineText(ui)).toBe(DONE);
  },
);

test(
  "a new fill ends the window: the marker is not drawn over the new result",
  { options: BEDROCK },
  async ($, on) => {
    const { e, ui } = await editedAfterEnhance($, on);
    await ui.press({ key: "undo" });
    expect(await headlineText(ui)).toBe("↶ Undo?");

    // the person Enhances again: the fill disarms the window of the old pair
    e.box.text = DRAFT;
    await ui.press({ key: "enhance" });

    expect(await headlineText(ui)).toBe(DONE);
  },
);

test(
  "a second Undo the box refuses disarms the window and the marker goes at once",
  { options: BEDROCK },
  async ($, on) => {
    const redraws = invalidations(on);
    const opts: EngineOptions = {};
    const { e, ui } = await editedAfterEnhance($, on, opts);
    await ui.press({ key: "undo" });
    expect(await headlineText(ui)).toBe("↶ Undo?");
    expect(redraws).toEqual(["ui.render"]);

    // the restore is refused: no fill, so no state write follows the disarm
    opts.fill = { isFilled: false, refusal: "dialog" };
    await e.clock.advance(5_000);
    await ui.press({ key: "undo" });

    expect(e.box.text).toBe(EDITED);
    expect(e.toasts.at(-1)).toBe(
      "prompt-lift: the prompt box did not take the text (refused)",
    );
    // the disarm asks for its own redraw, since nothing else will
    expect(redraws).toEqual(["ui.render", "ui.render"]);
    expect(await headlineText(ui)).toBe(DONE);
    expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
  },
);
