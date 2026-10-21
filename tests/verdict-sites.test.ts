import { expect, test } from "claude-code/testing";
import {
  answered,
  engine,
  improve,
  press,
  watch,
  BEDROCK,
  BETTER,
  DRAFT,
  FABLE,
  USAGE,
} from "./engine";
import { TODAY_PREFIX } from "./ledger-fake";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";

// R25: which of the Enhance flow's toast sites write `lastVerdict`, and what.
// Every ending that fills nothing and belongs to this press writes one, with
// the toast's reason (less its prefix and cost) and the press's dollars:
// absent when no call was made, null when the call has no price. Deliberately
// without one: the busy refusal (the press under way is not this one), a
// superseded press (a newer press owns the row), and the success paths,
// whose toasts follow a fill. The row side is tests/band-verdict.test.tsx.

const PAID = estimateUsd(USAGE, FABLE, DEFAULT_PRICES);
const MISSING_PATH_REPLY =
  "Fix the login bug in src/auth.ts where the session expires after sign-in; follow docs/STYLE.md.";

test("a draft the guards refuse is refused before any call, with no cost", async ($, on) => {
  const e = engine(on);
  const verdicts = watch(on, "lastVerdict");

  await press($, "/clear the screen and start over please");

  expect(e.calls).toHaveLength(0);
  expect(verdicts).toEqual([
    {
      kind: "refused",
      text: "commands and shell lines are sent as typed",
      usd: undefined,
    },
  ]);
});

test(
  "a window at its cap is refused before the call, with no cost",
  { options: { ...BEDROCK, sessionCapUsd: 0.01 } },
  async ($, on) => {
    const e = engine(on);
    const verdicts = watch(on, "lastVerdict");
    await press($, DRAFT);
    expect(verdicts).toEqual([]);

    e.box.text = "";
    await press($, DRAFT);

    expect(e.calls).toHaveLength(1);
    expect(verdicts).toEqual([
      {
        kind: "refused",
        text: "session cap $0.01 reached · /prompt-lift cap off",
        usd: undefined,
      },
    ]);
  },
);

test(
  "a post-call guard refusal is refused, with the call's dollars",
  { options: BEDROCK },
  async ($, on) => {
    engine(on, { replies: [answered(improve(BETTER.repeat(30)))] });
    const verdicts = watch(on, "lastVerdict");

    await press($, DRAFT);

    expect(verdicts).toEqual([
      {
        kind: "refused",
        text: "rewrite too long, kept your prompt",
        usd: PAID,
      },
    ]);
  },
);

test(
  "a named file that does not exist is refused, with the call's dollars",
  { options: BEDROCK },
  async ($, on) => {
    engine(on, { replies: [answered(improve(MISSING_PATH_REPLY))] });
    const verdicts = watch(on, "lastVerdict");

    await press($, DRAFT);

    expect(verdicts).toEqual([
      {
        kind: "refused",
        text: "named a file that does not exist, kept your prompt",
        usd: PAID,
      },
    ]);
  },
);

test(
  "a draft that changed while enhancing is refused, with the call's dollars",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, { delay: true });
    const verdicts = watch(on, "lastVerdict");

    const run = press($, DRAFT);
    await e.modelCalled;
    // the command path expects an empty box; typing on is a changed draft
    e.box.text = "typed on while it ran";
    e.release();
    await run;

    expect(verdicts).toEqual([
      {
        kind: "refused",
        text: "draft changed while enhancing, left as is",
        usd: PAID,
      },
    ]);
  },
);

test(
  "a prompt box that does not take the text is a failure",
  { options: BEDROCK },
  async ($, on) => {
    engine(on, { fill: { isFilled: false, refusal: "dialog" } });
    const verdicts = watch(on, "lastVerdict");

    await press($, DRAFT);

    expect(verdicts).toEqual([
      {
        kind: "failed",
        text: "the prompt box did not take the text (refused)",
        usd: PAID,
      },
    ]);
  },
);

test(
  "an empty chain is a failure with no cost",
  { options: { models: "" } },
  async ($, on) => {
    const e = engine(on);
    const verdicts = watch(on, "lastVerdict");

    await press($, DRAFT);

    expect(e.calls).toHaveLength(0);
    expect(e.toasts).toEqual(["prompt-lift: no models configured"]);
    expect(verdicts).toEqual([
      { kind: "failed", text: "no models configured", usd: undefined },
    ]);
  },
);

test(
  "an error after the model answered is a failure that costs what the call cost",
  { options: BEDROCK },
  async ($, on) => {
    engine(on, { denyFill: "composer gone" });
    const verdicts = watch(on, "lastVerdict");

    await press($, DRAFT);

    expect(verdicts).toHaveLength(1);
    const [verdict] = verdicts as { kind: string; text: string; usd: number }[];
    expect(verdict?.kind).toBe("failed");
    expect(verdict?.text.startsWith("enhance failed (")).toBe(true);
    expect(verdict?.usd).toBe(PAID);
  },
);

test("an error before any call is a failure with no cost", async ($, on) => {
  engine(on, { denyMessages: "no transcript" });
  const verdicts = watch(on, "lastVerdict");

  await press($, DRAFT);

  expect(verdicts).toHaveLength(1);
  const [verdict] = verdicts as { kind: string; text: string; usd?: number }[];
  expect(verdict?.kind).toBe("failed");
  expect(verdict?.text.startsWith("enhance failed (")).toBe(true);
  expect(verdict?.usd).toBeUndefined();
});

test("an unpriced model's refusal carries null, not zero", async ($, on) => {
  engine(on, {
    replies: [answered(JSON.stringify({ verdict: "fine" }))],
  });
  const verdicts = watch(on, "lastVerdict");

  await press($, DRAFT);

  // the default chain is aliases, which no price table row names off Anthropic
  expect(verdicts).toEqual([
    { kind: "refused", text: "already specific, left as is", usd: null },
  ]);
});

test(
  "a press the box took writes no verdict, even when its record failed",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, {
      denyStoreSet: { key: TODAY_PREFIX, reason: "disk full" },
    });
    const verdicts = watch(on, "lastVerdict");

    await press($, DRAFT);

    expect(e.box.text).toBe(BETTER);
    expect(e.toasts).toHaveLength(1);
    expect(verdicts).toEqual([]);
  },
);

test(
  "a second press while one runs is told it is busy and writes no verdict",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, { delay: true });
    const verdicts = watch(on, "lastVerdict");

    const first = press($, DRAFT);
    await e.modelCalled;
    await press($, DRAFT);
    e.release();
    await first;

    expect(e.toasts[0]).toBe("prompt-lift: already enhancing");
    expect(verdicts).toEqual([]);
  },
);
