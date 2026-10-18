import { expect, test } from "claude-code/testing";
import {
  answered,
  engine,
  block,
  improve,
  press,
  BETTER,
  DRAFT,
  BEDROCK,
  FABLE,
  GOOD,
  PROJECT_FILE,
  PROJECT_TEXT,
  ROOT,
  RULES_FILE,
  RULES_TEXT,
  USAGE,
} from "./engine";
import { formatDollars } from "../hooks/chain";
import { DEFAULT_PRICES, estimateUsd } from "../hooks/config";
import { expectedBoxText, readDraft, type DraftReader } from "../hooks/enhance";
import { SYSTEM } from "../hooks/rules";

// The Enhance flow end to end through the command path (spec §5.3): what a
// press sends, fills, refuses and toasts. Cost and stats live in
// enhance-cost.test.ts, the context assembly in enhance-context.test.ts.

const DRAFT_2 = "fix the login bug in src/auth.ts please now";
/** What a Fable press that answers with USAGE costs: on every toast (C19). */
const COST = formatDollars(estimateUsd(USAGE, FABLE, DEFAULT_PRICES));

test(
  "Enhance replaces the draft, caches the static block first, and toasts dollars",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on);
    const phases: unknown[] = [];
    on(
      "state.set",
      { plugin: "prompt-master", key: "phase" },
      ($, ev, next) => {
        phases.push(ev.value);
        return next(ev);
      },
    );

    const r = await press($, DRAFT);

    expect((r as { text?: string }).text).toBeUndefined();
    expect(e.box.text).toBe(BETTER);
    expect(e.calls).toHaveLength(1);
    expect(e.calls[0]?.model).toBe(FABLE);
    expect(e.calls[0]?.system).toBe(SYSTEM);
    expect(e.calls[0]?.systemBlocks).toBeUndefined();
    expect(e.calls[0]?.promptBlocks).toHaveLength(2);
    expect(e.calls[0]?.promptBlocks?.[0]?.cache).toBe(true);
    expect(e.calls[0]?.promptBlocks?.[1]?.cache).toBeUndefined();
    expect(block(e, 0, 0).startsWith("<enhancer_rules>")).toBe(true);
    expect(block(e, 0, 0)).toContain(PROJECT_TEXT);
    expect(block(e, 0, 0)).toContain("<project>W</project>");
    expect(block(e, 0, 0)).toContain("commit-commands:commit\nreview\n");
    expect(block(e, 0, 0)).not.toContain(DRAFT);
    expect(block(e, 0, 1)).toContain(`<draft>${DRAFT}</draft>`);
    expect(e.fills).toHaveLength(1);
    expect(e.fills[0]?.mode).toBe("replace");
    expect(e.fills[0]?.decorations?.length ?? 0).toBeGreaterThan(0);
    expect(e.toasts).toHaveLength(1);
    expect(e.toasts[0]?.startsWith("prompt-master: fable 5.1 ·")).toBe(true);
    expect(e.toasts[0]).toContain("$");
    expect(e.toasts[0]).toContain("added symptom and test");
    expect(e.logs).toHaveLength(0);
    expect(phases).toEqual(["running", "done"]);
  },
);

test("block 0 is identical across two different drafts", async ($, on) => {
  const e = engine(on);

  await press($, DRAFT);
  e.box.text = "";
  await press($, DRAFT_2);

  expect(e.calls).toHaveLength(2);
  expect(block(e, 1, 0)).toBe(block(e, 0, 0));
  expect(block(e, 1, 1)).not.toBe(block(e, 0, 1));
  expect(e.toasts).toHaveLength(2);
  expect(e.toasts[1]).not.toContain("static block changed");
});

test("/prompt-master <text> enhances its args when the box is empty", async ($, on) => {
  const e = engine(on);

  await press($, `  ${DRAFT}  `);

  expect(e.fills).toHaveLength(1);
  expect(e.fills[0]?.text).toBe(BETTER);
  expect(block(e, 0, 1)).toContain(`<draft>${DRAFT}</draft>`);
});

test("a reply-like draft is refused before any model call", async ($, on) => {
  const e = engine(on);

  await press($, "ok do it now");

  expect(e.calls).toHaveLength(0);
  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toEqual([
    "prompt-master: that reads like an answer to Claude's question",
  ]);
});

test("command path refuses to fill when the box is no longer empty", async ($, on) => {
  const e = engine(on, { delay: true });

  const run = press($, DRAFT);
  await e.modelCalled;
  e.box.text = "typing";
  e.release();
  await run;

  expect(e.fills).toHaveLength(0);
  expect(e.box.text).toBe("typing");
  expect(e.toasts).toEqual([
    `prompt-master: draft changed while enhancing, left as is · ${COST}`,
  ]);
});

// The button path end to end (`enhance($, cfg, { kind: "box" })`) runs only
// with the mod's own `$`: a test's `$` carries the engine nouns alone (no fs,
// state, store, model), and an inline plugin may not hand its `$` to a function
// of the test file, so the band button (Task 10) drives it through `ui.press`.
// These two pin what the box source does at step 2 (read) and step 7 (re-read).

test("the draft is the prompt box for the button and the args for the command", async () => {
  const reads: string[] = [];
  const reader: DraftReader = {
    prompt: {
      read: async () => {
        reads.push("read");
        return { text: DRAFT, cursor: DRAFT.length };
      },
    },
  };

  expect(await readDraft(reader, { kind: "box" })).toBe(DRAFT);
  expect(reads).toHaveLength(1);
  expect(await readDraft(reader, { kind: "args", text: DRAFT_2 })).toBe(
    DRAFT_2,
  );
  expect(reads).toHaveLength(1);
});

test("the box re-read expects the draft for the button and nothing for the command", () => {
  expect(expectedBoxText({ kind: "box" }, DRAFT)).toBe(DRAFT);
  expect(expectedBoxText({ kind: "args", text: DRAFT }, DRAFT)).toBe("");
});

test("two presses in one tick make one call", async ($, on) => {
  const e = engine(on, { delay: true });

  const both = Promise.all([press($, DRAFT), press($, DRAFT)]);
  await e.modelCalled;
  e.release();
  await both;

  expect(e.calls).toHaveLength(1);
  expect(e.fills).toHaveLength(1);
  expect(e.toasts).toContain("prompt-master: already enhancing");
});

test("a stale reply is dropped", async ($, on) => {
  const e = engine(on, { delay: true });
  let isStale = false;
  on(
    "state.get",
    { plugin: "prompt-master", key: "requestId" },
    ($, ev, next) =>
      isStale ? { value: { value: 999, version: 99 } } : next(ev),
  );

  const run = press($, DRAFT);
  await e.modelCalled;
  isStale = true;
  e.release();
  await run;

  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toHaveLength(0);
  expect(e.box.text).toBe("");
});

test("fill refused toasts the refusal", async ($, on) => {
  // Only the engine itself can name a cause (`dialog`, `no_composer`); the
  // site strips one a hook writes, so a stubbed refusal reaches the mod bare.
  const e = engine(on, { fill: { isFilled: false, refusal: "dialog" } });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(1);
  expect(e.box.text).toBe("");
  expect(e.toasts).toEqual([
    `prompt-master: the prompt box did not take the text (refused) · ${COST}`,
  ]);
});

test("a refused first press settles the phase back to idle", async ($, on) => {
  const e = engine(on);
  const phases: unknown[] = [];
  on("state.set", { plugin: "prompt-master", key: "phase" }, ($, ev, next) => {
    phases.push(ev.value);
    return next(ev);
  });

  await press($, "ok do it now");

  expect(e.calls).toHaveLength(0);
  expect(phases).toEqual(["running", "idle"]);
});

test("plain prose reply is filled", { options: BEDROCK }, async ($, on) => {
  const e = engine(on, { replies: [answered(BETTER)] });

  await press($, DRAFT);

  expect(e.box.text).toBe(BETTER);
  expect(e.toasts[0]?.startsWith("prompt-master: fable 5.1 ·")).toBe(true);
});

test("a capped reply leaves the box untouched", async ($, on) => {
  const e = engine(on, {
    replies: [answered(GOOD, { ...USAGE, output_tokens: 2000 })],
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(0);
  expect(e.box.text).toBe("");
  expect(e.toasts).toEqual([
    `prompt-master: reply hit the token cap, kept your prompt · ${formatDollars(
      estimateUsd({ ...USAGE, output_tokens: 2000 }, FABLE, DEFAULT_PRICES),
    )}`,
  ]);
});

test("an invented path is refused", async ($, on) => {
  const e = engine(on, {
    replies: [
      answered(
        improve("Fix the login bug in src/auth.ts and in src/nope.ts please"),
      ),
    ],
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toEqual([
    `prompt-master: named a file that does not exist, kept your prompt · ${COST}`,
  ]);
});

test("a path that exists in the project passes the path guard", async ($, on) => {
  const e = engine(on, {
    files: {
      [PROJECT_FILE]: PROJECT_TEXT,
      [RULES_FILE]: RULES_TEXT,
      [`${ROOT}/src/session.ts`]: "export const session = 1;",
    },
    replies: [
      answered(
        improve("Fix the login bug in src/auth.ts and src/session.ts please"),
      ),
    ],
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(1);
  expect(e.box.text).toContain("src/session.ts");
});

test(
  "prose with a slash such as CI/CD is not checked as a path",
  { options: BEDROCK },
  async ($, on) => {
    const e = engine(on, {
      replies: [
        answered(
          improve(
            "Fix the CI/CD pipeline and the and/or logic for the login flow please",
          ),
        ),
      ],
    });

    await press($, "fix the ci pipeline for the login flow please");

    expect(e.fills).toHaveLength(1);
    expect(e.box.text).toContain("CI/CD");
    expect(e.toasts[0]?.startsWith("prompt-master: fable 5.1 ·")).toBe(true);
  },
);

test("a path under a root directory that does not exist is refused", async ($, on) => {
  const e = engine(on, {
    replies: [
      answered(
        improve("Fix the login bug in src/auth.ts and src/session please"),
      ),
    ],
  });

  await press($, DRAFT);

  expect(e.fills).toHaveLength(0);
  expect(e.toasts[0]).toContain(
    "prompt-master: named a file that does not exist, kept your prompt",
  );
});

test("a skill mentioned in the reply is filled when that skill is listed", async ($, on) => {
  const e = engine(on, {
    replies: [
      answered(
        improve("Fix the login bug in src/auth.ts using the /review skill"),
      ),
    ],
    skills: [{ name: "review", source: "user" }],
  });

  await press($, DRAFT);

  expect(e.calls).toHaveLength(1);
  expect(e.box.text).toBe(
    "Fix the login bug in src/auth.ts using the /review skill",
  );
  expect(e.toasts).toHaveLength(1);
});

test("static block changed toast baseline: first press does not show it", async ($, on) => {
  // The " · static block changed" suffix appears when both:
  // (1) previousHash !== "" (not the first call) AND
  // (2) previousHash !== hash (memory content differs from prior call).
  // This verifies condition (1): the first press has no previous hash.
  const e = engine(on, { replies: [answered(GOOD)] });

  await press($, DRAFT);

  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]).not.toContain("static block changed");
});

test("a reply-token draft of 12+ words reaches the model", async ($, on) => {
  // Spec §5.4 (R1): reply prefix guard applies only below 12 words.
  // An 11-word draft starting with "no" is refused; a 12-word one is not.
  const elevenWords = "no I need tests for the login bug in src/auth.ts now";
  const twelveWords =
    "no I need tests for the login bug in src/auth.ts right now";
  expect(elevenWords.trim().split(/\s+/).length).toBe(11);
  expect(twelveWords.trim().split(/\s+/).length).toBe(12);
  const e = engine(on, { replies: [answered(GOOD), answered(GOOD)] });

  // 11-word draft is refused
  await press($, elevenWords);
  expect(e.calls).toHaveLength(0);
  expect(e.box.text).toBe("");
  expect(e.toasts[0]).toContain("reads like an answer");

  // 12-word draft reaches the model
  e.box.text = "";
  await press($, twelveWords);
  expect(e.calls).toHaveLength(1);
  expect(e.box.text).toBe(BETTER);
});
