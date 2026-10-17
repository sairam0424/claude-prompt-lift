import { expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import { answered, engine, press, BETTER, DRAFT } from "./engine";

/**
 * Test for Redo decorations (spec C15, ruling R5): the decorations from the
 * original Enhance are persisted in state and re-applied when Redo fills the
 * enhanced text back.
 */

function undoCmd($): Promise<unknown> {
  return press($, "undo");
}

test("Redo re-applies the decorations from the original Enhance", async ($, on: On) => {
  const e = engine(on);
  answered(on, BETTER);

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
