import { expect, test } from "claude-code/testing";
import { engine, press, BETTER, DRAFT, NOW_MS } from "./engine";
import { decideUndo, sendRefusal, UNDO_REARM_MS } from "../hooks/actions";

// Send's Enter-only guard (C10, C11) and Undo's fallback for a half-held pair
// (§12): Enter-only refusal and half-held Undo fallback. send-undo.test.ts holds
// the rest of Send and Undo and must not grow.

const ENTER_TOAST =
  "prompt-lift: press Enter to send; @files and images only travel with Enter";
const ENHANCE_FAILED = "prompt-lift: enhance failed (";
const UNDO_ARM =
  "prompt-lift: box edited since Enhance; press Undo again within 10 s to discard";
const RESTORED = "prompt-lift: restored your draft";
const NOTHING_TO_UNDO = "prompt-lift: nothing to undo";

test("Send refuses @~/ and @server:resource mentions; emails stay sendable", () => {
  expect(sendRefusal("read @~/notes/todo.md first")).toBe(ENTER_TOAST);
  expect(sendRefusal("@~/.claude/CLAUDE.md says otherwise")).toBe(ENTER_TOAST);
  expect(sendRefusal("compare with @github:issue/42")).toBe(ENTER_TOAST);
  expect(sendRefusal("see @server:resource please")).toBe(ENTER_TOAST);
  // Only a token-initial @ is a mention (the anchor): emails travel with Send
  expect(sendRefusal("mail me@example.com the report")).toBeUndefined();
  expect(sendRefusal("the handle a:b@c.d is fine")).toBeUndefined();
});

const HELD = {
  original: DRAFT,
  enhanced: null,
  isUndone: false,
  armedAt: undefined,
  now: NOW_MS,
};

test("decideUndo restores the original alone when the enhanced half is missing", () => {
  // An empty box is clean; one that holds anything else takes the confirm,
  // as the mod cannot vouch for what it shows
  expect(decideUndo({ ...HELD, boxText: "" })).toEqual({
    kind: "undo",
    text: DRAFT,
  });
  expect(decideUndo({ ...HELD, boxText: BETTER })).toEqual({ kind: "arm" });
  expect(
    decideUndo({ ...HELD, boxText: BETTER, armedAt: NOW_MS - UNDO_REARM_MS }),
  ).toEqual({ kind: "undo", text: DRAFT });
  // Once the draft is back there is nothing to redo
  expect(decideUndo({ ...HELD, isUndone: true, boxText: DRAFT })).toEqual({
    kind: "nothing",
  });
  // Nothing held at all is still nothing
  expect(
    decideUndo({ ...HELD, original: null, enhanced: BETTER, boxText: "" }),
  ).toEqual({ kind: "nothing" });
});

test("an enhanced write that fails after original still lets Undo restore the draft", async ($, on) => {
  const e = engine(on);
  on("state.set", { plugin: "prompt-lift", key: "enhanced" }, () => ({
    deny: "state gone",
  }));

  await press($, DRAFT);

  expect(e.box.text).toBe(BETTER);
  expect(e.toasts).toHaveLength(1);
  expect(e.toasts[0]?.startsWith(ENHANCE_FAILED)).toBe(true);

  // The box holds a result the mod cannot vouch for: the confirm, then the draft
  await press($, "undo");
  expect(e.toasts[1]).toBe(UNDO_ARM);
  await press($, "undo");
  expect(e.box.text).toBe(DRAFT);
  expect(e.toasts[2]).toBe(RESTORED);
  // Nothing to redo: the enhanced half was never held
  await press($, "undo");
  expect(e.toasts[3]).toBe(NOTHING_TO_UNDO);
  expect(e.toasts).toHaveLength(4);
});
