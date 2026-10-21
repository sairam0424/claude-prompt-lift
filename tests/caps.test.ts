import { expect, test } from "claude-code/testing";
import type { Engine as Harness, Mounted } from "claude-code/testing";
import type { ModelUsage } from "claude-code";
import {
  answered,
  block,
  engine,
  press,
  watch,
  BETTER,
  DRAFT,
  FABLE,
  GOOD,
  TODAY,
} from "./engine";
import {
  DEFAULT_PRICES,
  estimateUsd,
  parseOptions,
  type Config,
} from "../hooks/config";
import {
  capReachedToast,
  capsLine,
  capStatus,
  leftText,
  parseCapArg,
} from "../hooks/caps";
import { doneRowText, idleRowText } from "../hooks/band-row";
import { spendKey } from "../hooks/ledger";
import { statusText, type StatusInput } from "../hooks/status";
import type { LastUsage } from "../types";
import { storeTotal } from "./ledger-fake";
import { detailsText as rowText } from "./band-helpers";

// Spend caps (R9): a press is refused before any model call once the mod's
// own ledger shows the session or the day at its cap; the rows show what is
// left; `/prompt-lift cap` moves the session cap for this session only.

const OPUS = "us.anthropic.claude-opus-4-1";
/** An Anthropic API session model: the alias chain prices there (R19). */
const API_FABLE = "claude-fable-5-1";
const DRAFT_2 = "fix the login bug in src/auth.ts please now";
/** A Fable press that costs $0.15 to the cent: 12k uncached input tokens. */
const PRICEY: ModelUsage = {
  input_tokens: 12000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 6800,
  output_tokens: 310,
};
const SESSION_REACHED =
  "prompt-lift: session cap $0.10 reached · /prompt-lift cap off";
const DAY_REACHED = "prompt-lift: day cap $0.50 reached";
const CAP_OFF = "prompt-lift: session cap off for this session";
const CAP_USAGE = "prompt-lift: cap takes dollars, e.g. /prompt-lift cap 2.50";
const SESSION_LINE =
  "caps: session $1.00 ($0.85 left) · day $5.00 ($4.85 left)";
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
/** A 0.5.0 row's done text: the cost is the headline's, no rung or time (R25). */
const DONE_ROW =
  "fable 5.1 · 6.8k cached · 1.4k in · 310 out · +12 words · 1 skill";
type Band = Mounted<"terminal", "AbovePrompt">;

function caps(sessionCapUsd: number, dayCapUsd: number) {
  return parseOptions({ sessionCapUsd, dayCapUsd });
}

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

async function text($: Harness, args: string): Promise<string | undefined> {
  return ((await press($, args)) as { text?: string }).text;
}

// --- the numbers ---

test("the cap options default to off and refuse anything but dollars", () => {
  expect(parseOptions({}).sessionCapUsd).toBe(0);
  expect(parseOptions({}).dayCapUsd).toBe(0);
  expect(caps(2.5, 10).sessionCapUsd).toBe(2.5);
  expect(caps(2.5, 10).dayCapUsd).toBe(10);
  expect(caps(-1, Number.NaN).sessionCapUsd).toBe(0);
  expect(caps(-1, Number.NaN).dayCapUsd).toBe(0);
  expect(caps(Number.POSITIVE_INFINITY, 0).sessionCapUsd).toBe(0);
  expect(estimateUsd(PRICEY, FABLE, DEFAULT_PRICES)?.toFixed(2)).toBe("0.15");
});

test("parseCapArg follows the model rule: one token sets, more is a draft", () => {
  expect(parseCapArg("cap")).toEqual({ kind: "show" });
  expect(parseCapArg("CAP")).toEqual({ kind: "show" });
  expect(parseCapArg("cap 2.50")).toEqual({ kind: "set", usd: 2.5 });
  expect(parseCapArg("cap off")).toEqual({ kind: "set", usd: 0 });
  expect(parseCapArg("cap OFF")).toEqual({ kind: "set", usd: 0 });
  expect(parseCapArg("cap 0")).toEqual({ kind: "set", usd: 0 });
  expect(parseCapArg("cap -1")).toEqual({ kind: "invalid" });
  expect(parseCapArg("cap abc")).toEqual({ kind: "invalid" });
  expect(parseCapArg("cap Infinity")).toEqual({ kind: "invalid" });
  expect(parseCapArg("cap the budget talk")).toEqual({ kind: "prose" });
  expect(parseCapArg("model cap")).toEqual({ kind: "prose" });
});

test("the rows append what is left before the no-cache hint", () => {
  expect(idleRowText(FABLE, "$0.85 left")).toBe(
    "ctrl+x b · or ctrl+x tab, e · prompt-lift: fable 5.1 · $0.85 left",
  );
  expect(doneRowText(LAST, 0, "$0.85 left")).toBe(`${DONE_ROW} · $0.85 left`);
  expect(doneRowText(LAST, 3, "$0.30 left (day)")).toBe(
    `${DONE_ROW} · $0.30 left (day) · cache not hitting — consider /prompt-lift model haiku`,
  );
});

test("statusText prints the caps after today and the engine's total after", () => {
  const a: StatusInput = {
    chain: [FABLE],
    platform: "anthropic",
    last: null,
    session: { presses: 1, usd: 0.15, unpriced: 0 },
    today: { presses: 1, usd: 0.15, unpriced: 0 },
    caps: { session: { cap: 1, left: 0.85 }, day: { cap: 5, left: 4.85 } },
    sessionTotal: 12.34,
    staticChars: 0,
    blockHash: "",
    skills: { included: 0, total: 0 },
    included: [],
    excluded: [],
    tail: 0,
  };
  expect(statusText(a)).toContain(
    `today: 1 press · $0.15\n${SESSION_LINE}\nconversation: off\nsession total (all tools): $12.34\nstatic block:`,
  );
  const off = statusText({ ...a, caps: {}, sessionTotal: undefined });
  expect(off).toContain(
    "today: 1 press · $0.15\ncaps: off\nconversation: off\nstatic block:",
  );
  expect(off).not.toContain("session total");
});

// --- through the engine ---

test("with no cap a press is never refused and the rows carry no suffix", async ($, on) => {
  const e = engine(on, { replies: [answered(GOOD, PRICEY)] });
  const ui = await mount($);

  expect(await rowText(ui)).not.toContain(" left");
  e.box.text = DRAFT;
  await ui.press({ key: "enhance" });

  expect(e.calls).toHaveLength(1);
  expect(e.box.text).toBe(BETTER);
  expect(await rowText(ui)).not.toContain(" left");
  expect(await text($, "status")).toContain("\ncaps: off\n");
  expect(await text($, "cap")).toBe("caps: off");
});

test(
  "a press at the session cap is refused before any call and records nothing",
  { options: { sessionCapUsd: 0.1 } },
  async ($, on) => {
    const e = engine(on, {
      model: API_FABLE,
      replies: [answered(GOOD, PRICEY)],
    });
    const phases = watch(on, "phase");
    const presses = watch(on, "sessionPresses");

    await press($, DRAFT);
    e.box.text = "";
    await press($, DRAFT_2);

    expect(e.calls).toHaveLength(1);
    expect(e.fills).toHaveLength(1);
    expect(e.toasts).toHaveLength(2);
    expect(e.toasts[1]).toBe(SESSION_REACHED);
    expect(presses).toEqual([1]);
    expect((await storeTotal(e.store)).presses).toBe(1);
    // The refusal settles the phase where it stood: the held pair keeps Send
    expect(phases).toEqual(["running", "done", "running", "done"]);
  },
);

test(
  "cap <usd> lifts the session cap for this session and cap off removes it",
  { options: { sessionCapUsd: 0.1 } },
  async ($, on) => {
    const e = engine(on, {
      model: API_FABLE,
      replies: [answered(GOOD, PRICEY), answered(GOOD, PRICEY), answered(GOOD)],
    });
    const overrides = watch(on, "capOverride");
    const ui = await mount($);

    await press($, DRAFT);
    e.box.text = "";
    await press($, DRAFT_2);
    expect(e.calls).toHaveLength(1);
    // the refusal stays in the row until the next action; a command ends it
    expect(await rowText(ui)).toContain("session cap $0.10 reached");
    await press($, "cap");
    expect(await rowText(ui)).toContain(" · $0.00 left");

    expect(await press($, "cap 1")).toEqual({});
    expect(e.toasts[2]).toBe("prompt-lift: session cap $1.00 for this session");
    expect(await rowText(ui)).toContain(" · $0.85 left");
    await press($, DRAFT_2);
    expect(e.calls).toHaveLength(2);

    // $0.30 spent now: a lower override is hit at once
    await press($, "cap 0.2");
    e.box.text = "";
    await press($, DRAFT_2);
    expect(e.calls).toHaveLength(2);
    expect(e.toasts.at(-1)).toBe(
      "prompt-lift: session cap $0.20 reached · /prompt-lift cap off",
    );

    expect(await press($, "cap off")).toEqual({});
    expect(e.toasts.at(-1)).toBe(CAP_OFF);
    expect(await rowText(ui)).not.toContain(" left");
    await press($, DRAFT_2);
    expect(e.calls).toHaveLength(3);
    expect(overrides).toEqual([1, 0.2, 0]);
  },
);

test(
  "the done row shows $0.85 left after a $0.15 press under a $1 cap",
  { options: { sessionCapUsd: 1 } },
  async ($, on) => {
    const e = engine(on, {
      model: API_FABLE,
      replies: [answered(GOOD, PRICEY)],
    });
    const ui = await mount($);

    expect(
      (await rowText(ui)).endsWith(" · prompt-lift: fable · $1.00 left"),
    ).toBe(true);
    e.box.text = DRAFT;
    await ui.press({ key: "enhance" });

    expect(e.box.text).toBe(BETTER);
    expect(await rowText(ui)).toMatch(
      / · \+\d+ words? · \d+ skills? · \$0\.85 left$/,
    );
  },
);

test(
  "a tighter day cap is shown as the day's, counts other sessions and has no override",
  { options: { sessionCapUsd: 1, dayCapUsd: 0.5 } },
  async ($, on) => {
    const e = engine(on, {
      model: API_FABLE,
      replies: [answered(GOOD, PRICEY), answered(GOOD)],
    });
    // Another session today spent $0.40 of the day's $0.50: its own row (R24)
    e.store[spendKey(TODAY, "other")] = { presses: 2, usd: 0.4, unpriced: 0 };
    const ui = await mount($);

    expect(await rowText(ui)).toContain(" · $0.10 left (day)");
    e.box.text = DRAFT;
    await ui.press({ key: "enhance" });
    expect(e.calls).toHaveLength(1);
    expect(await rowText(ui)).toContain(" · $0.00 left (day)");

    e.box.text = "";
    await press($, DRAFT_2);
    expect(e.toasts.at(-1)).toBe(DAY_REACHED);
    await press($, "cap off");
    await press($, DRAFT_2);
    await press($, "cap 9");
    await press($, DRAFT_2);
    expect(e.calls).toHaveLength(1);
    expect(e.toasts.filter((t) => t === DAY_REACHED)).toHaveLength(3);
    expect(await text($, "status")).toContain(
      "\ncaps: session $9.00 ($8.85 left) · day $0.50 ($0.00 left)\n",
    );
  },
);

test(
  "status prints the caps and the engine's whole-session total; cap alone prints the caps",
  { options: { sessionCapUsd: 1, dayCapUsd: 5 } },
  async ($, on) => {
    engine(on, {
      model: API_FABLE,
      replies: [answered(GOOD, PRICEY)],
      sessionCostUsd: 12.34,
    });

    await press($, DRAFT);

    expect(await text($, "status")).toContain(
      `\n${SESSION_LINE}\nconversation: off\nsession total (all tools): $12.34\nstatic block:`,
    );
    expect(await text($, "cap")).toBe(SESSION_LINE);
  },
);

test(
  "an unpriced press never counts against a cap",
  { options: { models: OPUS, sessionCapUsd: 0.1 } },
  async ($, on) => {
    const e = engine(on);

    await press($, DRAFT);
    e.box.text = "";
    await press($, DRAFT_2);
    const status = (await text($, "status")) ?? "";

    expect(e.calls).toHaveLength(2);
    expect(e.fills).toHaveLength(2);
    expect(status).toContain("session: 2 presses · $0.000 · unpriced calls: 2");
    expect(status).toContain("\ncaps: session $0.10 ($0.10 left)\n");
  },
);

test("cap with anything but dollars is refused; longer text is a draft", async ($, on) => {
  const e = engine(on);
  const overrides = watch(on, "capOverride");

  expect(await text($, "cap abc")).toBe(CAP_USAGE);
  expect(await text($, "cap -1")).toBe(CAP_USAGE);
  expect(e.calls).toHaveLength(0);

  await press($, "cap the budget for this sprint");

  // A draft, not a cap: it went to the model as typed
  expect(e.calls).toHaveLength(1);
  expect(block(e, 0, 1)).toContain("cap the budget for this sprint");
  expect(overrides).toEqual([]);
});
