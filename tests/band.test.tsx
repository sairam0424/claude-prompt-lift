import { expect, test } from "claude-code/testing";
import type { Engine as Harness, Mounted } from "claude-code/testing";
import type { ModelCompleteResult, ModelUsage } from "claude-code";
import {
  answered,
  engine,
  BETTER,
  DRAFT,
  FABLE,
  GOOD,
  USAGE,
  ZERO_USAGE,
} from "./engine";
import {
  doneRowText,
  idleRowText,
  runningRowText,
  RESTORED_ROW,
} from "../hooks/band";
import type { LastUsage } from "../types";

// The band (spec §5.1; C12, C17, C19): one row chained above the engine's own
// band content. Its buttons run with the mod's own `$`, which is how the box
// path of Enhance, Send with `asUser` and Cancel get their end-to-end tests.

const PLUGIN = "prompt-master";
const SURFACE = "terminal" as const;
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
};
type Props = typeof PROPS;
type Band = Mounted<typeof SURFACE, "AbovePrompt">;

const ENTER_TOAST =
  "prompt-master: press Enter to send; @files and images only travel with Enter";
const CANCELLED = "prompt-master: cancelled, draft unchanged";
const BUSY = "prompt-master: already enhancing";
const DRAFT_CHANGED =
  "prompt-master: draft changed while enhancing, left as is";
const NO_CACHE_HINT = "cache not hitting — consider /prompt-master model haiku";
const ABORTED: ModelCompleteResult = {
  isAnswered: false,
  reason: "aborted",
  usage: ZERO_USAGE,
};
const UNCACHED: ModelUsage = {
  input_tokens: 8200,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 310,
};
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

function mount($: Harness, extra: Partial<Props> = {}): Promise<Band> {
  return $.ui.mount({
    plugin: PLUGIN,
    surface: SURFACE,
    component: "AbovePrompt",
    props: { ...PROPS, ...extra },
  });
}

async function keys(ui: Band): Promise<(string | undefined)[]> {
  return (await ui.findAll({ type: "Button" })).map((b) => b.key);
}

async function label(ui: Band, key: string): Promise<unknown> {
  return (await ui.find({ type: "Button", key }))?.props.label;
}

async function rowText(ui: Band): Promise<string> {
  const texts = await ui.findAll({ type: "Text" });
  return texts
    .filter((t) => t.text !== "lower")
    .map((t) => t.text)
    .join("");
}

// --- pure row text ---

test("idle row names the keys and the first rung", () => {
  expect(idleRowText(FABLE)).toBe(
    "ctrl+x b · or ctrl+x tab, e · prompt-master: fable 5.1",
  );
  expect(runningRowText("us.anthropic.claude-sonnet-5-5")).toBe(
    "Enhancing with sonnet 5.5…",
  );
});

test("done row shows the usage, the added words and the skills", () => {
  expect(doneRowText(LAST, 0)).toBe(
    "fable 5.1 · 6.8k cached · 1.4k in · 310 out · $0.04 · +12 words · 1 skill",
  );
  expect(doneRowText({ ...LAST, skills: 2, addedWords: 1 }, 2)).toBe(
    "fable 5.1 · 6.8k cached · 1.4k in · 310 out · $0.04 · +1 word · 2 skills",
  );
  expect(doneRowText(LAST, 3)).toBe(
    `fable 5.1 · 6.8k cached · 1.4k in · 310 out · $0.04 · +12 words · 1 skill · ${NO_CACHE_HINT}`,
  );
});

// --- the drawing ---

test("idle band shows Enhance only and keeps the lower drawing", async ($, on) => {
  const e = engine(on);

  const ui = await mount($);

  const found = await ui.findAll({ type: "Button" });
  expect(found.map((b) => b.key)).toEqual(["enhance"]);
  expect(found[0]?.props.label).toBe("Enhance (e)");
  expect(found[0]?.props.hotkey).toBe("e");
  expect(found[0]?.props.action).toBe("app:cycleDiffBase");
  expect(await ui.find({ type: "Text", text: "lower" })).toBeDefined();
  expect(await rowText(ui)).toBe(idleRowText(FABLE));
  expect(e.calls).toHaveLength(0);
});

test("yields to a survey", async ($, on) => {
  engine(on);

  const ui = await mount($, { hasSurvey: true });

  expect(await keys(ui)).toEqual([]);
  expect(await ui.find({ type: "Text", text: "lower" })).toBeDefined();
});

test("the idle row follows /prompt-master model haiku as its hint says", async ($, on) => {
  const e = engine(on);
  const ui = await mount($);

  await $.command.run({ command: PLUGIN, args: "model haiku" } as never);

  expect(await rowText(ui)).toBe(idleRowText("us.anthropic.claude-haiku-5-5"));
  expect(await rowText(ui)).toContain("prompt-master: haiku 5.5");
  expect(e.store.model).toBe("us.anthropic.claude-haiku-5-5");
  expect(e.calls).toHaveLength(0);
});

test(
  "Enhance button carries no action when the option is empty",
  { options: { enhanceAction: "" } },
  async ($, on) => {
    engine(on);

    const ui = await mount($);

    const enhance = await ui.find({ type: "Button", key: "enhance" });
    expect(enhance).toBeDefined();
    expect(enhance?.props.action).toBeUndefined();
    expect(enhance?.props.hotkey).toBe("e");
  },
);

test("Enhance fills the box; Send and Undo follow; Undo turns to Redo", async ($, on) => {
  const e = engine(on);
  e.box.text = DRAFT;
  const ui = await mount($);

  await ui.press({ key: "enhance" });

  expect(e.box.text).toBe(BETTER);
  expect(e.calls).toHaveLength(1);
  expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
  expect(await label(ui, "send")).toBe("Send (s)");
  expect(await label(ui, "undo")).toBe("Undo (u)");
  expect((await ui.find({ key: "send" }))?.props.hotkey).toBe("s");
  expect((await ui.find({ key: "undo" }))?.props.hotkey).toBe("u");
  const row = await rowText(ui);
  expect(
    row.startsWith("fable 5.1 · 6.8k cached · 1.4k in · 310 out · $"),
  ).toBe(true);
  expect(row).toContain("words · ");
  expect(row).toContain("skill");

  await ui.press({ key: "undo" });

  expect(e.box.text).toBe(DRAFT);
  expect(await label(ui, "undo")).toBe("Redo (u)");
  expect(await rowText(ui)).toBe(RESTORED_ROW);

  await ui.press({ key: "undo" });

  expect(e.box.text).toBe(BETTER);
  expect(await label(ui, "undo")).toBe("Undo (u)");
  expect(e.calls).toHaveLength(1);
});

test("the button path leaves a box that changed while enhancing", async ($, on) => {
  const e = engine(on, { delay: true });
  e.box.text = DRAFT;
  const ui = await mount($);

  const run = ui.press({ key: "enhance" });
  await e.modelCalled;
  e.box.text = `${DRAFT} and the logout path`;
  e.release();
  await run;

  expect(e.fills).toHaveLength(0);
  expect(e.box.text).toBe(`${DRAFT} and the logout path`);
  expect(e.toasts).toEqual([DRAFT_CHANGED]);
  expect(await keys(ui)).toEqual(["enhance"]);
});

test("two Enhance presses in one tick make one call", async ($, on) => {
  const e = engine(on);
  e.box.text = DRAFT;
  const ui = await mount($);

  await Promise.all([
    ui.press({ key: "enhance" }),
    ui.press({ key: "enhance" }),
  ]);

  expect(e.calls).toHaveLength(1);
  expect(e.box.text).toBe(BETTER);
  expect(e.toasts).toContain(BUSY);
});

test("Send submits the enhanced text as the user and clears the box", async ($, on) => {
  const e = engine(on);
  e.box.text = DRAFT;
  const ui = await mount($);
  await ui.press({ key: "enhance" });

  await ui.press({ key: "send" });

  expect(e.submits).toHaveLength(1);
  expect(e.submits[0]?.text).toBe(BETTER);
  expect(e.submits[0]?.asUser).toBe(true);
  expect(e.box.text).toBe("");
  expect(await keys(ui)).toEqual(["enhance"]);
});

test("Send refuses a box with an @file", async ($, on) => {
  const e = engine(on);
  e.box.text = DRAFT;
  const ui = await mount($);
  await ui.press({ key: "enhance" });
  e.box.text = `${BETTER} see @src/auth.ts`;

  await ui.press({ key: "send" });

  expect(e.submits).toHaveLength(0);
  expect(e.toasts.at(-1)).toBe(ENTER_TOAST);
  expect(await keys(ui)).toEqual(["enhance", "send", "undo"]);
});

test("Cancel while running stops the call and tries no fallback", async ($, on) => {
  const e = engine(on, { delay: true, replies: [ABORTED, answered(GOOD)] });
  e.box.text = DRAFT;
  const ui = await mount($);

  const run = ui.press({ key: "enhance" });
  await e.modelCalled;
  expect(await keys(ui)).toEqual(["cancel"]);
  expect(await label(ui, "cancel")).toBe("Cancel (c)");
  expect((await ui.find({ key: "cancel" }))?.props.hotkey).toBe("c");
  expect(await rowText(ui)).toBe(runningRowText(FABLE));
  await ui.press({ key: "cancel" });
  e.release();
  await run;

  expect(e.calls).toHaveLength(1);
  expect(e.fills).toHaveLength(0);
  expect(e.box.text).toBe(DRAFT);
  expect(e.toasts).toEqual([CANCELLED]);
  expect(await keys(ui)).toEqual(["enhance"]);
});

test("Send says queues while a turn runs and Enhance stays live", async ($, on) => {
  const e = engine(on);
  e.box.text = DRAFT;
  const ui = await mount($, { isWorking: true });

  await ui.press({ key: "enhance" });

  expect(e.calls).toHaveLength(1);
  expect(e.box.text).toBe(BETTER);
  expect(await label(ui, "send")).toBe("Send (queues)");
  expect(await label(ui, "enhance")).toBe("Enhance (e)");
});

test("after three no-cache presses the row hints at haiku", async ($, on) => {
  const e = engine(on, {
    replies: [
      answered(GOOD, UNCACHED),
      answered(GOOD, UNCACHED),
      answered(GOOD, UNCACHED),
    ],
  });
  const ui = await mount($);

  for (let press = 0; press < 3; press += 1) {
    e.box.text = DRAFT;
    await ui.press({ key: "enhance" });
    expect((await rowText(ui)).includes(NO_CACHE_HINT)).toBe(press === 2);
  }

  expect(e.calls).toHaveLength(3);
});

test("a cached press ends the no-cache streak", async ($, on) => {
  const e = engine(on, {
    replies: [
      answered(GOOD, UNCACHED),
      answered(GOOD, UNCACHED),
      answered(GOOD, UNCACHED),
      answered(GOOD, USAGE),
    ],
  });
  const ui = await mount($);

  for (let press = 0; press < 4; press += 1) {
    e.box.text = DRAFT;
    await ui.press({ key: "enhance" });
  }

  expect(await rowText(ui)).not.toContain(NO_CACHE_HINT);
});
