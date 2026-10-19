import { expect, test } from "claude-code/testing";
import type { Engine as Harness } from "claude-code/testing";
import type { On, PromptFillArgs } from "claude-code";
import { answered, engine, press, BETTER, DRAFT } from "./engine";

/**
 * Test for Redo decorations (spec C15, ruling R5): the decorations from the
 * original Enhance are persisted in state and re-applied when Redo fills the
 * enhanced text back; after a re-enhance of the enhanced text they cover
 * everything added since the original Undo restores.
 */

/** A second round on the enhanced text. */
const MORE = `${BETTER} Keep the fix small.`;

function undoCmd($: Harness): Promise<unknown> {
  return press($, "undo");
}

/** The runs a fill paints, as the text they cover. */
function painted(fill: PromptFillArgs | undefined, text: string): string[] {
  return (fill?.decorations ?? []).map((d) => text.slice(d.start, d.end));
}

test("Redo re-applies the decorations from the original Enhance", async ($, on: On) => {
  const e = engine(on, { replies: [answered(BETTER)] });

  // Step 1: Enhance the draft
  await press($, DRAFT);

  // The fill from Enhance should have decorations
  expect(e.fills).toHaveLength(1);
  const enhanceFill = e.fills[0];
  expect(enhanceFill).toBeDefined();
  expect(enhanceFill?.decorations).toBeDefined();
  expect(enhanceFill?.decorations?.length).toBeGreaterThan(0);
  const originalDecorations = enhanceFill?.decorations;

  // Step 2: Undo to restore the original draft
  await undoCmd($);

  // The Undo fill should not have decorations
  expect(e.fills).toHaveLength(2);
  const undoFill = e.fills[1];
  expect(undoFill).toBeDefined();
  expect(undoFill?.decorations).toBeUndefined();
  expect(e.box.text).toBe(DRAFT);

  // Step 3: Redo to re-apply the enhanced text
  await undoCmd($);

  // The Redo fill should have the same decorations as the original Enhance
  expect(e.fills).toHaveLength(3);
  const redoFill = e.fills[2];
  expect(redoFill).toBeDefined();
  expect(redoFill?.decorations).toBeDefined();
  expect(redoFill?.decorations).toEqual(originalDecorations);
  expect(e.box.text).toBe(BETTER);
});

test("Redo after a re-enhance highlights everything added since the original", async ($, on: On) => {
  const e = engine(on, { replies: [answered(BETTER), answered(MORE)] });

  await press($, DRAFT);
  // The command path wants an empty box; the second round is on the result
  e.box.text = "";
  await press($, BETTER);

  expect(e.box.text).toBe(MORE);
  // The second fill paints its own round alone
  const second = painted(e.fills[1], MORE).join(" ");
  expect(second).toContain("Keep the fix small.");
  expect(second).not.toContain("where the session");

  await undoCmd($);
  expect(e.box.text).toBe(DRAFT);

  await undoCmd($);
  expect(e.box.text).toBe(MORE);
  // Redo paints both rounds: the kept original is what it is measured from
  const redo = painted(e.fills[3], MORE).join(" ");
  expect(redo).toContain("where the session");
  expect(redo).toContain("Keep the fix small.");
});
