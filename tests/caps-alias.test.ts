import { expect, test } from "claude-code/testing";
import type { Engine as Harness, Mounted } from "claude-code/testing";
import { engine, press, BEDROCK, DRAFT, FABLE, HAIKU, SONNET } from "./engine";
import { capsLine, leftText } from "../hooks/caps";
import { hasUnpricedAlias } from "../hooks/config";
import { statusText, type StatusInput } from "../hooks/status";
import { storeTotal } from "./ledger-fake";

// R9 meets R19: on Bedrock and Vertex an alias rung is unpriced, so a press on
// it never counts toward a cap. A cap over such a chain would read as
// protection it is not, so while a cap is active there the `caps:` line and
// the rows' ` left` text end with ` · alias rungs not counted`. A chain of
// full ids, the Anthropic API, and caps off carry no note.

const NOTE = "alias rungs not counted";
/** An Anthropic API model id: aliases price there. */
const API_FABLE = "claude-fable-5-1";
const DRAFT_2 = "fix the login bug in src/auth.ts please now";
const CAPS = { sessionCapUsd: 0.1, dayCapUsd: 5 };
const CAPS_LINE = "caps: session $0.10 ($0.10 left) · day $5.00 ($5.00 left)";
const STATUS: StatusInput = {
  chain: ["sonnet", HAIKU],
  platform: "bedrock",
  last: null,
  session: { presses: 0, usd: 0, unpriced: 0 },
  today: { presses: 0, usd: 0, unpriced: 0 },
  caps: { session: { cap: 0.1, left: 0.1 }, day: { cap: 5, left: 5 } },
  staticChars: 0,
  blockHash: "",
  skills: { included: 0, total: 0 },
  included: [],
  excluded: [],
  tail: 0,
};
type Band = Mounted<"terminal", "AbovePrompt">;

function mount($: Harness): Promise<Band> {
  return $.ui.mount({
    plugin: "prompt-lift",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 12,
      bodyColumns: 120,
      scroll: { offset: 0, bodyRows: 12 },
      view: {},
    },
  });
}

async function rowText(ui: Band): Promise<string> {
  const texts = await ui.findAll({ type: "Text" });
  return texts
    .filter((t) => t.text !== "lower")
    .map((t) => t.text)
    .join("");
}

async function text($: Harness, args: string): Promise<string | undefined> {
  return ((await press($, args)) as { text?: string }).text;
}

// --- the pure parts ---

test("hasUnpricedAlias: an alias rung off the Anthropic API, in any case", () => {
  expect(hasUnpricedAlias(["sonnet"], "bedrock")).toBe(true);
  expect(hasUnpricedAlias([FABLE, "Haiku"], "vertex")).toBe(true);
  expect(hasUnpricedAlias(["sonnet"], "anthropic")).toBe(false);
  expect(hasUnpricedAlias([FABLE, SONNET, HAIKU], "bedrock")).toBe(false);
  // `opus` is no alias the mod prices: unpriced everywhere, so no note (R3)
  expect(hasUnpricedAlias(["opus"], "bedrock")).toBe(false);
  expect(hasUnpricedAlias([], "bedrock")).toBe(false);
});

test("leftText and capsLine carry the note over an active cap only", () => {
  const session = { cap: 1, left: 0.75 };
  const day = { cap: 2, left: 0.3 };
  expect(leftText({}, true)).toBeUndefined();
  expect(leftText({ session }, true)).toBe(`$0.75 left · ${NOTE}`);
  expect(leftText({ session, day }, true)).toBe(`$0.30 left (day) · ${NOTE}`);
  expect(leftText({ session, day })).toBe("$0.30 left (day)");

  expect(capsLine({}, true)).toBe("caps: off");
  expect(capsLine({ session }, true)).toBe(
    `caps: session $1.00 ($0.75 left) · ${NOTE}`,
  );
  expect(capsLine({ session, day })).toBe(
    "caps: session $1.00 ($0.75 left) · day $2.00 ($0.30 left)",
  );
});

test("statusText marks the caps line where an alias rung is unpriced", () => {
  expect(statusText(STATUS)).toContain(
    `\n${CAPS_LINE} · ${NOTE}\nconversation:`,
  );
  // Caps off: nothing to mark, whatever the chain
  expect(statusText({ ...STATUS, caps: {} })).toContain(
    "\ncaps: off\nconversation:",
  );
  // Full ids on Bedrock, or the alias on the Anthropic API: every press counts
  expect(statusText({ ...STATUS, chain: [FABLE, SONNET] })).toContain(
    `\n${CAPS_LINE}\nconversation:`,
  );
  expect(statusText({ ...STATUS, platform: "anthropic" })).toContain(
    `\n${CAPS_LINE}\nconversation:`,
  );
  // `opus` is no alias the mod prices: unpriced everywhere, no note (R3)
  expect(statusText({ ...STATUS, chain: ["opus"] })).not.toContain(NOTE);
});

// --- through the engine ---

test(
  "a cap over an alias chain on Bedrock refuses nothing and says so in status, cap and the rows",
  { options: { models: "sonnet", ...CAPS } },
  async ($, on) => {
    const e = engine(on);
    const ui = await mount($);

    expect(await rowText(ui)).toMatch(
      / · \$0\.10 left · alias rungs not counted$/,
    );
    await press($, DRAFT);
    e.box.text = "";
    await press($, DRAFT_2);

    // Both presses went to the model: nothing was ever counted
    expect(e.calls).toHaveLength(2);
    expect(e.fills).toHaveLength(2);
    expect(e.toasts.every((t) => t.includes("$? · (no price)"))).toBe(true);
    expect(await storeTotal(e.store)).toEqual({
      presses: 2,
      usd: 0,
      unpriced: 2,
    });
    expect(await text($, "status")).toContain(
      `\n${CAPS_LINE} · ${NOTE}\nconversation: off\n`,
    );
    expect(await text($, "cap")).toBe(`${CAPS_LINE} · ${NOTE}`);
    expect(await rowText(ui)).toMatch(
      / · \d+ skills? · \$0\.10 left · alias rungs not counted$/,
    );
  },
);

test(
  "the same cap over full ids on Bedrock carries no note",
  { options: { ...BEDROCK, ...CAPS } },
  async ($, on) => {
    engine(on);
    const ui = await mount($);

    expect(await rowText(ui)).toMatch(/ · \$0\.10 left$/);
    await press($, DRAFT);

    expect(await text($, "cap")).not.toContain(NOTE);
    expect(await rowText(ui)).not.toContain(NOTE);
  },
);

test(
  "the same alias chain on the Anthropic API carries no note",
  { options: { models: "sonnet", ...CAPS } },
  async ($, on) => {
    engine(on, { model: API_FABLE });
    const ui = await mount($);

    expect(await rowText(ui)).toMatch(/ · \$0\.10 left$/);
    await press($, DRAFT);
    const status = (await text($, "status")) ?? "";

    expect(status).not.toContain("aliases:");
    expect(status).not.toContain(NOTE);
    expect(await rowText(ui)).not.toContain(NOTE);
  },
);
