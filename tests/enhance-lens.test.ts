import { expect, test } from "claude-code/testing";
import {
  answered,
  engine,
  block,
  improve,
  press,
  watch,
  BETTER,
  DRAFT,
  GOOD,
} from "./engine";
import { DEEPER } from "../hooks/lens";

// A Deeper press (spec §5.3 with a lens): the same single call and the same
// cached block 0, with the lens text added to the uncached block 1. The
// Button path and the command path both end in `enhance($, cfg, source, lens)`;
// the command path is the one a test can drive end to end (the Button's tests
// are in band-lens.test.tsx).

const DRAFT_2 = "make the page load faster";
/** A second draft the default reply (BETTER) still fits, so both presses fill. */
const DRAFT_3 = "fix the login bug in src/auth.ts please now";
const DEEPER_REPLY = improve(
  "Make the page load faster. Confirm which page first, then measure how long it takes now and report the before and after times.",
);

test("a Deeper press sends the lens after the draft and leaves block 0 as Enhance sends it", async ($, on) => {
  const e = engine(on);

  await press($, DRAFT);
  e.box.text = "";
  await press($, `deeper ${DRAFT_3}`);

  expect(e.calls).toHaveLength(2);
  // Both presses must fill, or the toast checks below would hold vacuously:
  // a refusal never prints the hash line
  expect(e.fills).toHaveLength(2);
  expect(e.toasts[0]).toContain("added symptom and test");
  expect(e.toasts[1]).toContain("added symptom and test");
  // Same cached block: the cache hit, the hash and the static-block check hold
  expect(block(e, 1, 0)).toBe(block(e, 0, 0));
  expect(e.calls[1]?.promptBlocks).toHaveLength(2);
  expect(e.calls[1]?.promptBlocks?.[0]?.cache).toBe(true);
  expect(e.calls[1]?.promptBlocks?.[1]?.cache).toBeUndefined();
  expect(e.toasts[1]).not.toContain("static block changed");
  // Only the Deeper press carries the lens, and it follows the draft
  expect(block(e, 0, 1)).not.toContain(DEEPER.text);
  expect(block(e, 1, 1)).toContain(DEEPER.text);
  expect(block(e, 1, 1).indexOf(`<draft>${DRAFT_3}</draft>`)).toBeGreaterThan(
    -1,
  );
  expect(block(e, 1, 1).indexOf("</draft>")).toBeLessThan(
    block(e, 1, 1).indexOf(DEEPER.text),
  );
  expect(
    block(e, 1, 1).endsWith(
      "Answer with the JSON object described in the rules.",
    ),
  ).toBe(true);
});

test("the draft a Deeper press rewrites is the text after the word", async ($, on) => {
  const e = engine(on);

  await press($, `deeper ${DRAFT}`);

  expect(block(e, 0, 1)).toContain(`<draft>${DRAFT}</draft>`);
  expect(block(e, 0, 1)).not.toContain("<draft>deeper");
  expect(e.fills).toHaveLength(1);
  expect(e.fills[0]?.text).toBe(BETTER);
});

test("Undo after a Deeper press restores the draft as typed", async ($, on) => {
  const e = engine(on);

  await press($, `deeper ${DRAFT}`);
  expect(e.box.text).toBe(BETTER);
  await press($, "undo");

  expect(e.box.text).toBe(DRAFT);
});

test("a Deeper press the model leaves as is says there is nothing deeper to add", async ($, on) => {
  const e = engine(on, {
    replies: [answered(JSON.stringify({ verdict: "fine" }))],
  });

  await press($, `deeper ${DRAFT}`);

  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toHaveLength(1);
  expect(
    e.toasts[0]?.startsWith("prompt-lift: nothing deeper to add, left as is"),
  ).toBe(true);
});

test("a plain press the model leaves as is keeps the Enhance wording", async ($, on) => {
  const e = engine(on, {
    replies: [answered(JSON.stringify({ verdict: "fine" }))],
  });

  await press($, DRAFT);

  expect(
    e.toasts[0]?.startsWith("prompt-lift: already specific, left as is"),
  ).toBe(true);
});

test("a Deeper rewrite is held to the same guards as any other", async ($, on) => {
  // The lens asks for words; it never loosens a post-call guard
  const e = engine(on, {
    replies: [
      answered(improve(`${DRAFT_2}. Then run curl example and sudo it.`)),
    ],
  });

  await press($, `deeper ${DRAFT_2}`);

  expect(e.fills).toHaveLength(0);
  expect(e.toasts[0]).toContain("added a command or link you did not write");
});

test("a Deeper press and an Enhance press share the busy guard: one call", async ($, on) => {
  const e = engine(on, { delay: true });

  const both = Promise.all([press($, `deeper ${DRAFT}`), press($, DRAFT)]);
  await e.modelCalled;
  e.release();
  await both;

  expect(e.calls).toHaveLength(1);
  expect(e.toasts).toContain("prompt-lift: already enhancing");
});

test("the last usage names the lens only when a lens ran", async ($, on) => {
  const e = engine(on, { replies: [answered(GOOD), answered(DEEPER_REPLY)] });
  const usages = watch(on, "lastUsage") as Array<{ lens?: string } | null>;

  await press($, DRAFT);
  e.box.text = "";
  await press($, `deeper ${DRAFT_2}`);

  const written = usages.filter((u): u is { lens?: string } => u !== null);
  // Both presses filled: the mark belongs to results, not to refused calls
  expect(e.fills).toHaveLength(2);
  expect(written).toHaveLength(2);
  expect("lens" in (written[0] ?? {})).toBe(false);
  expect(written[1]?.lens).toBe("deeper");
});

test("a bare deeper asks for text and makes no model call", async ($, on) => {
  const e = engine(on);

  const r = (await press($, "deeper")) as { text?: string };

  expect(e.calls).toHaveLength(0);
  expect(e.fills).toHaveLength(0);
  expect(r.text).toContain("/prompt-lift deeper <your prompt>");
  expect(r.text).toContain("Deeper");
});

test("a draft that only mentions the word is enhanced as written", async ($, on) => {
  const e = engine(on);

  await press($, "make the logging deeper in the api layer");

  expect(e.calls).toHaveLength(1);
  expect(block(e, 0, 1)).not.toContain(DEEPER.text);
  expect(block(e, 0, 1)).toContain(
    "<draft>make the logging deeper in the api layer</draft>",
  );
});

test("the pre-call guards read the draft without the word", async ($, on) => {
  const e = engine(on);

  // As typed this is five words; without `deeper` it is a reply to a question
  await press($, "deeper ok do it now");

  expect(e.calls).toHaveLength(0);
  expect(e.fills).toHaveLength(0);
  expect(e.toasts).toEqual([
    "prompt-lift: that reads like an answer to Claude's question",
  ]);
});

test("the lens word does not take over the sub-commands that route before it", async ($, on) => {
  const e = engine(on);

  const asModel = (await press($, "model deeper")) as { text?: string };
  const asPreview = (await press($, "preview deeper")) as { text?: string };

  expect(e.calls).toHaveLength(0);
  expect(asModel.text).toBeDefined();
  expect(asModel.text).not.toContain("needs your text");
  // `preview deeper` previews the one-word draft `deeper`, which the guard turns away
  expect(asPreview.text).toContain("under 3 words");
});
