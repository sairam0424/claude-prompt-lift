import { expect, test } from "claude-code/testing";
import {
  capPreviewBlock,
  capPreviewBlockKeepingLens,
  PREVIEW_MAX_CHARS,
} from "../hooks/subcommands";
import { DEEPER } from "../hooks/lens";
import { block, engine, press, DRAFT } from "./engine";

// `/prompt-lift preview deeper <draft>` prints what a Deeper press would send:
// the draft without the word, then the lens's words. The lens sits at the
// end of the block, where the 2,000-character cap cuts first, so only what
// precedes the lens is ever cut.

const FINAL = "Answer with the JSON object described in the rules.";

test("preview of a lens press shows the draft without the word, then the lens", async ($, on) => {
  const e = engine(on);

  const r = (await press($, `preview deeper ${DRAFT}`)) as { text: string };

  expect(e.calls).toHaveLength(0);
  expect(r.text).toContain(`<draft>${DRAFT}</draft>`);
  expect(r.text).not.toContain("<draft>deeper");
  expect(r.text).toContain(DEEPER.text);
  expect(r.text.indexOf("</draft>")).toBeLessThan(r.text.indexOf(DEEPER.text));
  expect(r.text.indexOf(DEEPER.text)).toBeLessThan(r.text.indexOf(FINAL));
});

test("preview of a plain draft carries no lens, as before", async ($, on) => {
  engine(on);

  const r = (await press($, `preview ${DRAFT}`)) as { text: string };

  expect(r.text).toContain(`<draft>${DRAFT}</draft>`);
  expect(r.text).not.toContain(DEEPER.text);
});

test("the preview of a lens press is the block a press would send", async ($, on) => {
  const e = engine(on);

  const previewed = (await press($, `preview deeper ${DRAFT}`)) as {
    text: string;
  };
  await press($, `deeper ${DRAFT}`);

  // The cap leaves a short block whole, so the sent block is inside the print
  expect(previewed.text).toContain(block(e, 0, 1));
});

test("a long draft is cut before the lens, never through it", async ($, on) => {
  engine(on);
  const longDraft = `fix the login bug in src/auth.ts please ${"and also keep going ".repeat(120)}`;

  const r = (await press($, `preview deeper ${longDraft}`)) as { text: string };

  expect(r.text).toContain("more characters");
  expect(r.text).toContain(DEEPER.text);
  expect(r.text).toContain(FINAL);
});

test("capPreviewBlockKeepingLens cuts only what precedes the lens", () => {
  const lens = "LENS WORDS.";
  const head = "x".repeat(PREVIEW_MAX_CHARS + 500);
  const whole = `${head}\n\n${lens}\n\n${FINAL}`;

  const capped = capPreviewBlockKeepingLens(whole, lens);

  expect(capped).toContain(`${lens}\n\n${FINAL}`);
  expect(capped).toContain("… ");
  expect(capped.length).toBeLessThan(whole.length);
  // With no lens, or a lens not in the block, it is the plain cap
  expect(capPreviewBlockKeepingLens(whole, "")).toBe(capPreviewBlock(whole));
  expect(capPreviewBlockKeepingLens(whole, "NOT THERE")).toBe(
    capPreviewBlock(whole),
  );
  // A short block is printed whole
  expect(capPreviewBlockKeepingLens(`a\n\n${lens}`, lens)).toBe(`a\n\n${lens}`);
});
