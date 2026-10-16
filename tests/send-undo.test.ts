import { expect, test } from "claude-code/testing";
import type { Engine as Harness } from "claude-code/testing";
import type { ModelCompleteResult, On } from "claude-code";
import {
  answered,
  engine,
  BETTER,
  DRAFT,
  GOOD,
  ROOT,
  ZERO_USAGE,
  type Engine,
} from "./engine";
import {
  decideUndo,
  sendRefusal,
  submitDraft,
  UNDO_REARM_MS,
  type SendIo,
} from "../hooks/actions";
import type { DraftReader } from "../hooks/enhance";

// Send, Undo/Redo, Cancel and the resets (spec §5.3, C3, C11, C13, C14).
//
// The split: a test's `$` carries the engine nouns alone (no state, no
// `prompt.read`), so `send` and `undo` as wholes run only with the mod's own
// `$`. Undo runs end to end through `/prompt-master undo`; Send's submit step
// (`submitDraft`) takes the prompt noun and a stub box and runs against the
// stub engine, its refusal (`sendRefusal`) is pure; the state Send then clears
// is `clearHeld`, covered by the composer, classic and session tests. The
// plugin loads in an environment of its own, so a `cancel()` the test imports
// is another instance: Cancel runs through `session.end`, which calls it.

const COMMAND = "prompt-master";
const EDITED = `${BETTER} and also the logout path`;
const BETTER_2 = `${BETTER} Keep the fix to src/auth.ts.`;
const ENTER_TOAST =
  "prompt-master: press Enter to send; @files and images only travel with Enter";
const ARM_TOAST =
  "prompt-master: box edited since Enhance; press Undo again within 10 s to discard";
const RESTORED = "prompt-master: restored your draft";
const REAPPLIED = "prompt-master: re-applied the enhanced prompt";
const NOTHING_TO_UNDO = "prompt-master: nothing to undo";
const CANCELLED = "prompt-master: cancelled, draft unchanged · $0.000";
const ABORTED: ModelCompleteResult = {
  isAnswered: false,
  reason: "aborted",
  usage: ZERO_USAGE,
};

function press($: Harness, args: string): Promise<unknown> {
  return $.command.run({ command: COMMAND, args } as never);
}

function undoCmd($: Harness): Promise<unknown> {
  return press($, "undo");
}

function improve(prompt: string): string {
  return JSON.stringify({
    verdict: "improve",
    prompt,
    why: "test",
    applied: [],
  });
}

type HeldKey = "phase" | "original" | "enhanced" | "isUndone";

/**
 * Every write of one prompt-master state key, in order. The matcher narrows
 * `e` per key literal, so a key held in a variable takes the cast.
 */
function watch(on: On, key: HeldKey): unknown[] {
  const values: unknown[] = [];
  on("state.set", { plugin: "prompt-master", key } as never, ($, ev, next) => {
    values.push(ev.value);
    return next(ev);
  });
  return values;
}

function sendIo($: Harness): SendIo {
  return $ as unknown as SendIo;
}

function boxOf(e: Engine): DraftReader {
  return {
    prompt: {
      read: async () => ({ text: e.box.text, cursor: e.box.text.length }),
    },
  };
}

/** Answers the next read of the phase with `value`, then steps aside. */
function phaseOnce(on: On, value: string): void {
  let isPending = true;
  on("state.get", { plugin: "prompt-master", key: "phase" }, ($, ev, next) => {
    if (!isPending) {
      return next(ev);
    }
    isPending = false;
    return { value: { value, version: 0 } };
  });
}

// --- Send ---

test("Send refuses @file and image drafts", () => {
  expect(sendRefusal("why does @src/a.ts break")).toBe(ENTER_TOAST);
  expect(sendRefusal("compare with [Image #2] please")).toBe(ENTER_TOAST);
  expect(sendRefusal(BETTER)).toBeUndefined();
});

test("Send with an empty box toasts", () => {
  expect(sendRefusal("")).toBe("prompt-master: nothing to send");
  expect(sendRefusal("  \n")).toBe("prompt-master: nothing to send");
});

test("submitDraft submits the box as the user and clears it", async ($, on) => {
  const e = engine(on);
  e.box.text = BETTER;

  const step = await submitDraft(sendIo($), boxOf(e));

  expect(step).toEqual({ outcome: "sent", box: "cleared" });
  expect(e.submits).toHaveLength(1);
  expect(e.submits[0]?.text).toBe(BETTER);
  expect(e.fills).toEqual([{ text: "", mode: "replace" }]);
  expect(e.box.text).toBe("");
  expect(e.toasts).toHaveLength(0);
});

test("submitDraft refuses without submitting", async ($, on) => {
  const e = engine(on);

  e.box.text = "why does @src/auth.ts break";
  expect(await submitDraft(sendIo($), boxOf(e))).toEqual({
    outcome: "refused",
    toast: ENTER_TOAST,
  });
  e.box.text = "";
  expect(await submitDraft(sendIo($), boxOf(e))).toEqual({
    outcome: "refused",
    toast: "prompt-master: nothing to send",
  });

  expect(e.submits).toHaveLength(0);
  expect(e.fills).toHaveLength(0);
});

test("submitDraft leaves a box that changed while submitting", async ($, on) => {
  const e = engine(on, {
    onSubmit: (box) => {
      box.text = "typing the next one";
    },
  });
  e.box.text = BETTER;

  const step = await submitDraft(sendIo($), boxOf(e));

  expect(step).toEqual({ outcome: "sent", box: "changed" });
  expect(e.submits).toHaveLength(1);
  expect(e.fills).toHaveLength(0);
  expect(e.box.text).toBe("typing the next one");
});

test("submitDraft reports a box that refused to clear", async ($, on) => {
  const e = engine(on, { fill: { isFilled: false } });
  e.box.text = BETTER;

  const step = await submitDraft(sendIo($), boxOf(e));

  expect(step).toEqual({ outcome: "sent", box: "kept" });
  expect(e.fills).toHaveLength(1);
  expect(e.box.text).toBe(BETTER);
});

test("submitDraft reports a dropped prompt and keeps the box", async ($, on) => {
  const e = engine(on, { drop: "a hook said no" });
  e.box.text = BETTER;

  const step = await submitDraft(sendIo($), boxOf(e));

  expect(step).toEqual({ outcome: "dropped", reason: "a hook said no" });
  expect(e.fills).toHaveLength(0);
  expect(e.box.text).toBe(BETTER);
});

// --- Undo / Redo ---

test("Undo restores and Redo re-applies", async ($, on) => {
  const e = engine(on);
  const undone = watch(on, "isUndone");
  await press($, DRAFT);
  expect(e.box.text).toBe(BETTER);

  await undoCmd($);
  expect(e.box.text).toBe(DRAFT);
  expect(e.toasts[1]).toBe(RESTORED);

  await undoCmd($);
  expect(e.box.text).toBe(BETTER);
  expect(e.toasts[2]).toBe(REAPPLIED);

  expect(undone).toEqual([false, true, false]);
  expect(e.calls).toHaveLength(1);
});

test("Undo with nothing held toasts", async ($, on) => {
  const e = engine(on);

  await undoCmd($);

  expect(e.toasts).toEqual([NOTHING_TO_UNDO]);
  expect(e.fills).toHaveLength(0);
});

test("Undo on an edited box needs a second press within 10 s", async ($, on) => {
  const e = engine(on);
  await press($, DRAFT);
  e.box.text = EDITED;

  await undoCmd($);
  expect(e.box.text).toBe(EDITED);
  expect(e.toasts[1]).toBe(ARM_TOAST);

  await e.clock.advance(5_000);
  await undoCmd($);
  expect(e.box.text).toBe(DRAFT);
  expect(e.toasts[2]).toBe(RESTORED);
});

test("the Undo re-arm window closes after 10 s", async ($, on) => {
  const e = engine(on);
  await press($, DRAFT);
  e.box.text = EDITED;

  await undoCmd($);
  await e.clock.advance(11_000);
  await undoCmd($);
  expect(e.box.text).toBe(EDITED);
  expect(e.toasts.slice(1)).toEqual([ARM_TOAST, ARM_TOAST]);

  await e.clock.advance(1_000);
  await undoCmd($);
  expect(e.box.text).toBe(DRAFT);
  expect(e.toasts[3]).toBe(RESTORED);
});

test("Redo guards an edited box the same way", async ($, on) => {
  const e = engine(on);
  await press($, DRAFT);
  await undoCmd($);
  e.box.text = "a fresh draft typed after Undo";

  await undoCmd($);
  expect(e.box.text).toBe("a fresh draft typed after Undo");
  expect(e.toasts[2]).toBe(ARM_TOAST);

  await undoCmd($);
  expect(e.box.text).toBe(BETTER);
  expect(e.toasts[3]).toBe(REAPPLIED);
});

test("a new Enhance disarms a pending Undo confirm", async ($, on) => {
  const e = engine(on, {
    replies: [answered(GOOD), answered(improve(BETTER_2))],
  });
  await press($, DRAFT);
  e.box.text = EDITED;
  await undoCmd($);
  expect(e.toasts.at(-1)).toBe(ARM_TOAST);

  e.box.text = "";
  await press($, `${DRAFT} now`);
  expect(e.box.text).toBe(BETTER_2);
  e.box.text = `${BETTER_2} and the logout path`;

  await undoCmd($);

  expect(e.box.text).toBe(`${BETTER_2} and the logout path`);
  expect(e.toasts.at(-1)).toBe(ARM_TOAST);
  expect(e.fills).toHaveLength(2);
});

test("decideUndo covers the table", () => {
  const held = {
    original: DRAFT,
    enhanced: BETTER,
    isUndone: false,
    armedAt: undefined,
    now: 1_000,
  };
  const armed = { ...held, boxText: EDITED, armedAt: 1_000 };

  expect(decideUndo({ ...held, original: null, boxText: "" })).toEqual({
    kind: "nothing",
  });
  expect(decideUndo({ ...held, boxText: BETTER })).toEqual({
    kind: "undo",
    text: DRAFT,
  });
  expect(decideUndo({ ...held, boxText: "" })).toEqual({
    kind: "undo",
    text: DRAFT,
  });
  expect(decideUndo({ ...held, boxText: EDITED })).toEqual({ kind: "arm" });
  expect(decideUndo({ ...armed, now: 1_000 + UNDO_REARM_MS })).toEqual({
    kind: "undo",
    text: DRAFT,
  });
  expect(decideUndo({ ...armed, now: 1_001 + UNDO_REARM_MS })).toEqual({
    kind: "arm",
  });
  expect(decideUndo({ ...held, isUndone: true, boxText: DRAFT })).toEqual({
    kind: "redo",
    text: BETTER,
  });
  expect(decideUndo({ ...held, isUndone: true, boxText: EDITED })).toEqual({
    kind: "arm",
  });
});

test("re-enhancing the enhanced text keeps the first original", async ($, on) => {
  const e = engine(on, {
    replies: [answered(GOOD), answered(improve(BETTER_2))],
  });
  const originals = watch(on, "original");

  await press($, DRAFT);
  e.box.text = "";
  await press($, BETTER);

  expect(e.box.text).toBe(BETTER_2);
  expect(originals).toEqual([DRAFT]);
  await undoCmd($);
  expect(e.box.text).toBe(DRAFT);
});

// --- Resets ---

test("composer submit clears original and enhanced", async ($, on) => {
  const e = engine(on);
  const originals = watch(on, "original");
  const phases = watch(on, "phase");
  await press($, DRAFT);

  await $.prompt.submit({
    text: BETTER,
    wait: false,
    origin: { kind: "composer" },
  } as never);

  expect(e.submits.map((s) => s.text)).toEqual([BETTER]);
  expect(originals).toEqual([DRAFT, null]);
  expect(phases).toEqual(["running", "done", "idle"]);
  await undoCmd($);
  expect(e.toasts[1]).toBe(NOTHING_TO_UNDO);
});

test("a composer submit a lower hook drops keeps the held pair", async ($, on) => {
  const e = engine(on, { drop: "a hook said no" });
  const originals = watch(on, "original");
  await press($, DRAFT);

  const r = await $.prompt.submit({
    text: BETTER,
    wait: false,
    origin: { kind: "composer" },
  } as never);

  expect((r as { drop?: string }).drop).toBe("a hook said no");
  expect(e.submits.map((s) => s.text)).toEqual([BETTER]);
  expect(originals).toEqual([DRAFT]);
  await undoCmd($);
  expect(e.box.text).toBe(DRAFT);
  expect(e.toasts[1]).toBe(RESTORED);
});

test("composer submit with nothing held writes no state", async ($, on) => {
  const e = engine(on);
  const originals = watch(on, "original");
  const phases = watch(on, "phase");

  await $.prompt.submit({
    text: "hello",
    wait: false,
    origin: { kind: "composer" },
  } as never);

  expect(e.submits.map((s) => s.text)).toEqual(["hello"]);
  expect(originals).toEqual([]);
  expect(phases).toEqual([]);
});

test("another plugin's submit leaves the held pair alone", async ($, on) => {
  const e = engine(on);
  await press($, DRAFT);

  await $.prompt.submit({
    text: "hello",
    wait: false,
    origin: { kind: "plugin", name: "other" },
  } as never);
  await undoCmd($);

  expect(e.box.text).toBe(DRAFT);
});

test("classic SessionStart clear resets state", async ($, on) => {
  const e = engine(on);
  await press($, DRAFT);

  await $.classic.SessionStart({ source: "clear" });
  await undoCmd($);

  expect(e.toasts[1]).toBe(NOTHING_TO_UNDO);
  expect(e.box.text).toBe(BETTER);
});

test("classic SessionStart startup and compact keep the held pair", async ($, on) => {
  const e = engine(on);
  await press($, DRAFT);

  await $.classic.SessionStart({ source: "startup" });
  await $.classic.SessionStart({ source: "compact" });
  await undoCmd($);

  expect(e.box.text).toBe(DRAFT);
});

test("a running phase is reset at session.start", async ($, on) => {
  const e = engine(on);
  const phases = watch(on, "phase");
  phaseOnce(on, "running");

  await $.session.start({
    cwd: ROOT,
    surface: "terminal",
    isInteractive: true,
  } as never);

  expect(phases).toEqual(["idle"]);
  expect(e.calls).toHaveLength(0);
});

test("a done phase is left alone at session.start", async ($, on) => {
  engine(on);
  const phases = watch(on, "phase");
  phaseOnce(on, "done");

  await $.session.start({
    cwd: ROOT,
    surface: "terminal",
    isInteractive: true,
  } as never);

  expect(phases).toEqual([]);
});

// --- Cancel ---

test("Cancel through session.end aborts the call and no fallback is tried", async ($, on) => {
  const e = engine(on, { delay: true, replies: [ABORTED, answered(GOOD)] });

  const run = press($, DRAFT);
  await e.modelCalled;
  await $.session.end({ reason: "clear" } as never);
  e.release();
  await run;

  expect(e.calls).toHaveLength(1);
  expect(e.fills).toHaveLength(0);
  expect(e.box.text).toBe("");
  expect(e.toasts).toEqual([CANCELLED]);
});
