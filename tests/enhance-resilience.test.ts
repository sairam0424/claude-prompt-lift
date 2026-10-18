import { expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import { engine, phaseOnce, press, watch, BETTER, DRAFT } from "./engine";
import { STATS_STORE_KEY } from "../hooks/stats";

// Spec §5.3 step 9 and §12, resilience: the pair Undo restores is held the
// moment the box is filled, before any cost is recorded, so a failed stats
// write costs the bookkeeping and not the result; a `running` phase no call
// backs (one a dropped environment left) is reset when a command runs, while
// a call in flight is never reset. The band's side is in band.test.tsx.

const RECORD_FAILED =
  "prompt-master: saved the result, but recording its cost failed";
const RESTORED = "prompt-master: restored your draft";
/** The pair, in the order the success path writes it. */
const PAIR = ["original", "enhanced", "isUndone", "lastDecorations"];
/** The state recording the call writes, in order; the store row follows. */
const RECORD = [
  "lastUsage",
  "blockHash",
  "staticChars",
  "noCacheStreak",
  "sessionPresses",
  "sessionUsd",
];

/** Which of the given state keys were written, in order. */
function watchWrites(on: On, keys: readonly string[]): string[] {
  const order: string[] = [];
  for (const key of keys) {
    on(
      "state.set",
      { plugin: "prompt-master", key } as never,
      ($, ev, next) => {
        order.push(key);
        return next(ev);
      },
    );
  }
  return order;
}

test("the pair is held before anything about the call is recorded", async ($, on) => {
  const e = engine(on);
  const order = watchWrites(on, [...PAIR, ...RECORD]);

  await press($, DRAFT);

  expect(e.box.text).toBe(BETTER);
  expect(order).toEqual([...PAIR, ...RECORD]);
  expect(e.store[STATS_STORE_KEY]).toBeDefined();
});

test("a failed stats write keeps the pair: Undo restores the draft and the toast says so", async ($, on) => {
  const e = engine(on, {
    denyStoreSet: { key: STATS_STORE_KEY, reason: "disk full" },
  });
  const phases = watch(on, "phase");

  await press($, DRAFT);

  expect(e.box.text).toBe(BETTER);
  expect(e.toasts).toEqual([RECORD_FAILED]);
  expect(e.logs).toHaveLength(1);
  expect(e.logs[0]).toContain("disk full");
  expect(phases).toEqual(["running", "done"]);
  expect(e.store[STATS_STORE_KEY]).toBeUndefined();

  await press($, "undo");

  expect(e.box.text).toBe(DRAFT);
  expect(e.toasts).toEqual([RECORD_FAILED, RESTORED]);
});

test("a command resets a running phase no call backs", async ($, on) => {
  const e = engine(on);
  const phases = watch(on, "phase");
  phaseOnce(on, "running");

  const r = await press($, "status");

  expect(phases).toEqual(["idle"]);
  expect((r as { text?: string }).text).toContain("prompt-master status");
  expect(e.calls).toHaveLength(0);
});

test("a command leaves a running phase alone while its call is in flight", async ($, on) => {
  const e = engine(on, { delay: true });
  const phases = watch(on, "phase");

  const run = press($, DRAFT);
  await e.modelCalled;
  await press($, "status");
  expect(phases).toEqual(["running"]);
  e.release();
  await run;

  expect(e.calls).toHaveLength(1);
  expect(e.box.text).toBe(BETTER);
  expect(phases).toEqual(["running", "done"]);
});
