import { expect, test } from "claude-code/testing";
import { engine, press, watch, BETTER, DRAFT } from "./engine";

// Undo's fill can be refused as Enhance's can (C13): the toast names it the
// same way, through the one constant enhance.ts exports, and the pair and
// `isUndone` stay as they were, so the next press can try again.

const NOT_TAKEN =
  "prompt-master: the prompt box did not take the text (refused)";

test("an Undo whose fill is refused toasts the refusal and leaves the pair", async ($, on) => {
  // Only the engine itself can name a cause (`dialog`, `no_composer`); the
  // site strips one a hook writes, so a stubbed refusal reaches the mod bare.
  const e = engine(on, { fill: { isFilled: false, refusal: "dialog" } });
  // The pair as a press held it; the box is empty, so Undo acts at once
  on("state.get", { plugin: "prompt-master", key: "original" }, () => ({
    value: { value: DRAFT, version: 1 },
  }));
  on("state.get", { plugin: "prompt-master", key: "enhanced" }, () => ({
    value: { value: BETTER, version: 1 },
  }));
  const undone = watch(on, "isUndone");

  await press($, "undo");

  expect(e.fills).toHaveLength(1);
  expect(e.fills[0]?.text).toBe(DRAFT);
  expect(e.toasts).toEqual([NOT_TAKEN]);
  expect(undone).toEqual([]);
});
